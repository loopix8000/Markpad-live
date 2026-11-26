import { $mark } from '@milkdown/kit/utils';
import type { PhrasingContent, RootContent } from 'mdast';
import type { Handle } from 'mdast-util-to-markdown';
import type { Parent } from 'unist';

interface Underline extends Parent {
	type: 'underline';
	children: PhrasingContent[];
}
declare module 'mdast' {
	interface PhrasingContentMap { underline: Underline }
	interface RootContentMap { underline: Underline }
}

export const serializeUnderline: Handle = (node, _parent, state, info) =>
	'<u>' + state.containerPhrasing(node, info) + '</u>';

export const underline = $mark('underline', () => ({
	parseDOM: [{ tag: 'u' }],
	toDOM: () => ['u', 0],
	parseMarkdown: {
		match: node => node.type === 'underline',
		runner: (state, node, mark) => { state.openMark(mark); state.next(node.children); state.closeMark(mark); },
	},
	toMarkdown: {
		match: mark => mark.type.name === 'underline',
		runner: (state, mark) => { state.withMark(mark, 'underline'); },
	},
}));

export function parseUnderlines(node: RootContent) {
	if (!('children' in node)) return;
	for (const child of node.children) parseUnderlines(child);
	if (node.type !== 'paragraph' && node.type !== 'heading' && node.type !== 'tableCell') return;
	const children = node.children;
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.type !== 'html' || child.value.toLowerCase() !== '<u>') continue;
		const end = children.findIndex((n, j) => j > i && n.type === 'html' && n.value.toLowerCase() === '</u>');
		if (end > i) children.splice(i, end - i + 1, { type: 'underline', children: children.slice(i+1,end) });
	}
}
