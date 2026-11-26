import { parserCtx, remarkCtx, schemaCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as DocNode } from '@milkdown/kit/prose/model';
import { $node, $remark } from '@milkdown/kit/utils';
import type { RootContent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import { parseUnderlines } from './underline.js';
import type { Literal } from 'unist';

interface LiveSource extends Literal { type: 'liveSource'; value: string }
declare module 'mdast' {
	interface RootContentMap { liveSource: LiveSource }
}

import remarkMath from 'remark-math';

export const frontmatter = $remark('liveFrontmatter', () => remarkFrontmatter, ['yaml']);
export const math = $remark('liveMath', () => remarkMath);

export const sourceBlock = $node('source_block', () => ({
	group: 'block', content: 'text*', marks: '', code: true, defining: true,
	toDOM: () => ['pre', { class: 'source-block' }, ['code', 0]],
	parseMarkdown: {
		match: node => node.type === 'liveSource',
		runner: (state, node, type) => {
			state.openNode(type);
			if (node.value) state.addText(String(node.value));
			state.closeNode();
		},
	},
	toMarkdown: {
		match: node => node.type.name === 'source_block',
		runner: (state, node) => { state.addNode('html', undefined, node.textContent); },
	},
}));

function needsSource(node: RootContent): boolean {
	if (['yaml', 'math', 'inlineMath', 'definition', 'linkReference', 'imageReference', 'html'].includes(node.type)) return true;
	if (node.type === 'code' && node.meta) return true;
	return 'children' in node && node.children.some(child => needsSource(child));
}

// 인라인 참조와 원시 HTML은 공통 마크다운 변환이 실행되기 전에 보관한다.
export const protectSource = $remark('liveSource', () => () => (tree, file) => {
	const source = String(file);
	for (const [index,node] of tree.children.entries()) {
		parseUnderlines(node);
		const raw = source.slice(node.position?.start.offset, node.position?.end.offset);
		if (needsSource(node) || (node.type !== 'code' && /\[\[|^\s*>\s*\[!|==[^=\n]+==|\+\+[^+\n]+\+\+|\^\[|(?:^|\n):\s/.test(raw))) {
			tree.children[index] = { type: 'liveSource', value: raw, position: node.position };
		}
	}
});

type Block = { node: DocNode; text: string; gap: string; lines: number; index: number };
const breaks = (s: string) => s.match(/\r\n|\r|\n/g)?.length ?? 0;

// 편집 DOM이 줄바꿈을 LF로 돌려줘도 수정한 범위 밖의 CRLF와 혼합 줄바꿈은 보존한다.
function replaceLiteralText(previous: string, edited: string, eol: string): string {
	if (previous === edited) return previous;
	const before = previous.replace(/\r\n?/g, '\n');
	const after = edited.replace(/\r\n?/g, '\n');
	let start = 0;
	let end = 0;
	const limit = Math.min(before.length, after.length);
	while (start < limit && before[start] === after[start]) start++;
	while (end < limit - start && before[before.length-1-end] === after[after.length-1-end]) end++;
	let rawStart = 0;
	let rawEnd = previous.length;
	for (let i = 0; i < start; i++) rawStart += previous.startsWith('\r\n',rawStart) ? 2 : 1;
	for (let i = 0; i < end; i++) rawEnd -= previous.slice(rawEnd-2,rawEnd) === '\r\n' ? 2 : 1;
	return previous.slice(0,rawStart) + after.slice(start,after.length-end).replace(/\n/g,eol) + previous.slice(rawEnd);
}

export class SourceDocument {
	private readonly original: Block[] = [];
	private readonly cached = new WeakMap<DocNode, Block>();
	private prefix = '';
	private suffix = '';
	private readonly eol: string;
	readonly doc: DocNode;
	lines: number[] = [];
	text: string;

	constructor(private ctx: Ctx, source: string, private readonly literal: boolean) {
		this.text = source;
		this.eol = source.match(/\r\n|\n|\r/)?.[0] ?? '\n';
		const schema = ctx.get(schemaCtx);
		const remark = ctx.get(remarkCtx);
		const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
		const body = source.slice(bom.length);
		const spans = literal ? [] : remark.parse(body).children.map(node => node.position!);
		let doc: DocNode | undefined;
		try {
			if (!literal) doc = ctx.get(parserCtx)(body);
		} catch { /* 해석할 수 없는 문서는 원문 전체를 편집한다. */ }
		if (!doc || (spans.length && spans.length !== doc.childCount)) {
			const block = schema.nodes.source_block.create(null, body ? schema.text(body) : undefined);
			this.doc = schema.topNodeType.create(null, block);
			this.prefix = bom;
			this.remember(block, body, '', 0);
		} else {
			this.doc = doc;
			this.prefix = bom + (spans.length ? body.slice(0, spans[0].start.offset) : '');
			this.suffix = spans.length ? body.slice(spans.at(-1)!.end.offset) : body;
			doc.forEach((node, _pos, index) => {
				const span = spans[index];
				const text = span ? body.slice(span.start.offset, span.end.offset) : '';
				const gap = index ? body.slice(spans[index - 1].end.offset, span.start.offset) : '';
				this.remember(node, text, gap, index);
			});
		}
		this.write(this.doc);
	}

	private remember(node: DocNode, text: string, gap: string, index: number) {
		const block = { node, text, gap, index, lines: breaks(text) };
		this.original.push(block);
		this.cached.set(node, block);
	}

	write(doc: DocNode): string {
		if (this.literal) {
			const body = doc.textBetween(0, doc.content.size, '\n');
			this.text = this.prefix + replaceLiteralText(this.text.slice(this.prefix.length), body, this.eol);
			this.lines = [1];
			return this.text;
		}
		const parts = [this.prefix];
		const starts: number[] = [];
		let line = 1 + breaks(this.prefix);
		let previous = -1;
		doc.forEach((node, _pos, index) => {
			let block = this.cached.get(node);
			const base = this.original[index];
			if (!block && base?.node.eq(node)) block = base;
			if (!block) {
				const raw = node.type.name === 'source_block' ? node.textContent :
					this.ctx.get(serializerCtx)(doc.type.create(null, node)).replace(/\n$/, '');
				const text = raw.replace(/\r\n|\r|\n/g, this.eol);
				block = { node, text, index: base?.index ?? -1, gap: base?.gap ?? '', lines: breaks(text) };
				this.cached.set(node, block);
			}
			let gap = '';
			if (index) {
				gap = block.index >= 0 && block.index === previous + 1 ? block.gap : this.eol.repeat(2);
				if (!gap || (breaks(gap) < 2 && node.type.name === 'paragraph' && doc.child(index - 1).type.name === 'paragraph')) gap = this.eol.repeat(2);
			}
			parts.push(gap, block.text);
			line += breaks(gap);
			starts.push(line);
			line += block.lines;
			previous = block.index;
		});
		this.lines = starts;
		parts.push(this.suffix);
		this.text = parts.join('');
		return this.text;
	}

	blockText(node: DocNode): string {
		return this.cached.get(node)?.text ?? this.ctx.get(serializerCtx)(this.doc.type.create(null,node)).replace(/\n$/, '');
	}

	indexAt(line: number): number {
		let low = 0;
		let high = this.lines.length;
		while (low + 1 < high) {
			const mid = (low + high) >>> 1;
			if (this.lines[mid] <= line) low = mid;
			else high = mid;
		}
		return low;
	}
}
