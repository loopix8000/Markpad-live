import type { Node } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { findInText, type FindOptions } from '../utils/findText.js';

export interface FindQuery extends FindOptions {
	text: string;
}

export interface FindStatus {
	/** 찾은 개수. `truncated`이면 상한에서 멈춘 값이다. */
	count: number;
	/** 지금 가리키는 결과의 순번(0부터). 없으면 -1. */
	active: number;
	truncated: boolean;
}

interface Range {
	from: number;
	to: number;
}

interface FindState {
	ranges: Range[];
	active: number;
	truncated: boolean;
	decorations: DecorationSet;
}

type FindMeta = { refresh?: true; active?: number };

export const MAX_FIND_MATCHES = 5000;
export const FIND_MATCH_CLASS = 'live-find-match';

const key = new PluginKey<FindState>('live-find');
// 글자가 아닌 인라인 노드(이미지, 줄바꿈, 수식)는 크기만큼 이 글자로 채워 위치 계산을 맞추고, 결과가 그 노드를 넘지 않게 한다.
const OBJECT = '￼';

// 대소문자를 무시할 때 글자 수가 바뀌는 문자(İ 등)는 그대로 둬서 문자열 위치와 문서 위치가 어긋나지 않게 한다.
function fold(text: string): string {
	let out = '';
	for (const c of text) {
		const lower = c.toLowerCase();
		out += lower.length === c.length ? lower : c;
	}
	return out;
}

/**
 * 문서에서 `query`가 나오는 구간을 문서 순서대로 돌려준다.
 *
 * 글자 노드 하나씩 찾으면 굵게·기울임·링크처럼 mark가 바뀌는 곳에서 글자가 나뉘어 그 경계를 넘는 구절을
 * 놓친다. 그래서 텍스트 블록 하나의 글자를 이어 붙여 찾는다. 블록 경계는 넘지 않는다.
 */
export function findRanges(doc: Node, query: FindQuery, limit = MAX_FIND_MATCHES): { ranges: Range[]; truncated: boolean } {
	const ranges: Range[] = [];
	if (!query.text) return { ranges, truncated: false };
	const needle = query.caseSensitive ? query.text : fold(query.text);
	const options = { caseSensitive: true, wholeWord: query.wholeWord };
	let truncated = false;
	doc.descendants((node, pos) => {
		if (truncated) return false;
		if (!node.isTextblock) return true;
		let text = '';
		node.forEach(child => { text += child.isText ? child.text! : OBJECT.repeat(child.nodeSize); });
		// 블록 안의 글자 위치 i는 문서 위치 pos + 1 + i다. 모든 인라인 노드가 크기만큼 글자를 차지하기 때문이다.
		for (const i of findInText(query.caseSensitive ? text : fold(text), needle, options)) {
			if (ranges.length >= limit) {
				truncated = true;
				break;
			}
			ranges.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length });
		}
		return false;
	});
	return { ranges, truncated };
}

function decorate(doc: Node, ranges: Range[], active: number): DecorationSet {
	return DecorationSet.create(doc, ranges.map((r, i) =>
		Decoration.inline(r.from, r.to, { class: i === active ? `${FIND_MATCH_CLASS} active` : FIND_MATCH_CLASS })));
}

/** `query()`가 돌려주는 찾을 말로 결과를 표시하는 ProseMirror 플러그인. 찾을 말을 바꾼 뒤에는 `refreshFind`를 보낸다. */
export function findPlugin(query: () => FindQuery): Plugin<FindState> {
	// active는 찾은 결과로 정한다. 결과를 얻기 전에는 몇 번째를 가리킬지 알 수 없는 경우가 있어서다.
	const build = (doc: Node, active: (ranges: Range[]) => number): FindState => {
		const { ranges, truncated } = findRanges(doc, query());
		const index = ranges.length ? Math.min(Math.max(active(ranges), -1), ranges.length - 1) : -1;
		return { ranges, active: index, truncated, decorations: decorate(doc, ranges, index) };
	};
	return new Plugin<FindState>({
		key,
		state: {
			init: (_, state) => build(state.doc, () => -1),
			apply(tr, value, _old, state) {
				const meta = tr.getMeta(key) as FindMeta | undefined;
				if (meta?.refresh) return build(state.doc, () => meta.active ?? -1);
				if (tr.docChanged) {
					// 편집으로 결과가 바뀌어도 가리키던 결과 근처에 머문다.
					const previous = value.ranges[value.active];
					if (!previous) return build(state.doc, () => -1);
					const at = tr.mapping.map(previous.from);
					return build(state.doc, ranges => {
						const index = ranges.findIndex(r => r.to > at);
						return index < 0 ? ranges.length - 1 : index;
					});
				}
				if (meta?.active !== undefined && meta.active !== value.active)
					return { ...value, active: meta.active, decorations: decorate(state.doc, value.ranges, meta.active) };
				return value;
			},
		},
		props: { decorations: state => key.getState(state)?.decorations },
	});
}

export function findStatus(state: EditorState): FindStatus {
	const value = key.getState(state);
	return { count: value?.ranges.length ?? 0, active: value?.active ?? -1, truncated: value?.truncated ?? false };
}

/** 찾을 말이 바뀌었을 때: 다시 찾고, 선택 위치 이후의 첫 결과를 가리킨다. `query`는 플러그인에 준 것과 같아야 한다. */
export function refreshFind(state: EditorState, query: FindQuery): Transaction {
	const { ranges } = findRanges(state.doc, query);
	const from = state.selection.from;
	const index = ranges.findIndex(r => r.from >= from);
	return pointAt(state.tr.setMeta(key, { refresh: true, active: ranges.length ? (index < 0 ? 0 : index) : -1 }), ranges, index < 0 ? 0 : index);
}

/** 다음(또는 이전) 결과로 옮기는 트랜잭션. 결과가 없으면 null. */
export function stepFind(state: EditorState, back: boolean): Transaction | null {
	const value = key.getState(state);
	if (!value || value.ranges.length === 0) return null;
	const { ranges } = value;
	const { from, to } = state.selection;
	// 가리키는 결과에서 출발하고, 사용자가 커서를 옮겼으면 그 커서에서 출발한다.
	const current = ranges[value.active];
	const onCurrent = current && current.from === from && current.to === to;
	let index: number;
	if (onCurrent) index = (value.active + (back ? -1 : 1) + ranges.length) % ranges.length;
	else if (back) {
		index = ranges.findLastIndex(r => r.from < from);
		if (index < 0) index = ranges.length - 1;
	} else {
		index = ranges.findIndex(r => r.from >= to);
		if (index < 0) index = 0;
	}
	return pointAt(state.tr.setMeta(key, { active: index }), ranges, index);
}

function pointAt(tr: Transaction, ranges: Range[], index: number): Transaction {
	const range = ranges[index];
	if (!range) return tr;
	return tr.setSelection(TextSelection.create(tr.doc, range.from, range.to)).scrollIntoView();
}
