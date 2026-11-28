import type { MarkType, Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

// pos에 걸쳐 있거나 맞닿은 mark 구간 전체를 돌려준다. 같은 mark가 이어진 형제 노드도 하나로 합친다.
export function markRangeAt(doc: Node, pos: number, type: MarkType): { from: number; to: number } | null {
	const $pos = doc.resolve(pos);
	const parent = $pos.parent;
	if (!parent.inlineContent) return null;
	const has = (i: number) => i >= 0 && i < parent.childCount && !!type.isInSet(parent.child(i).marks);
	let index = $pos.index();
	// 마지막 글자 오른쪽 절반을 누르면 위치가 코드 끝에 걸리므로 앞 노드를 본다.
	if (!has(index)) {
		if ($pos.textOffset === 0 && has(index - 1)) index--;
		else return null;
	}
	let first = index;
	let last = index;
	while (has(first - 1)) first--;
	while (has(last + 1)) last++;
	let from = $pos.start();
	for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
	let to = from;
	for (let i = first; i <= last; i++) to += parent.child(i).nodeSize;
	return { from, to };
}

// 더블클릭한 대상이 인라인 코드이면 코드 전체를 선택한다. 선택했으면 true.
export function selectInlineCode(view: EditorView, pos: number, target: EventTarget | null): boolean {
	const code = view.state.schema.marks.inlineCode;
	if (!code || !(target instanceof Element) || !target.closest('code')) return false;
	const range = markRangeAt(view.state.doc, pos, code);
	if (!range) return false;
	const { state } = view;
	if (state.selection.from !== range.from || state.selection.to !== range.to)
		view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to)));
	return true;
}
