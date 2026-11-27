import { Editor, commandsCtx, editorViewCtx, editorViewOptionsCtx, parserCtx, rootCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { commonmark, createCodeBlockCommand, createCodeBlockInputRule, imageSchema, listItemSchema, syncHeadingIdPlugin, toggleEmphasisCommand, toggleInlineCodeCommand, toggleStrongCommand, docSchema, textSchema, wrapInBlockquoteCommand, wrapInBulletListCommand, wrapInHeadingCommand, wrapInOrderedListCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, addRowAfterCommand, addRowBeforeCommand, insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { closeHistory, redo, undo } from '@milkdown/kit/prose/history';
import { keydownHandler } from '@milkdown/kit/prose/keymap';
import { AllSelection, EditorState, NodeSelection, Selection, TextSelection } from '@milkdown/kit/prose/state';
import { Slice } from '@milkdown/kit/prose/model';
import { toggleMark } from '@milkdown/kit/prose/commands';
import { underline, serializeUnderline } from './underline.js';
import { addColumnAfter, deleteColumn } from '@milkdown/kit/prose/tables';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import { $node, $view } from '@milkdown/kit/utils';
import { SHORTCUTS } from '../utils/shortcuts.js';
import { localSrc } from '../utils/markdown.js';
import { closeCodeFence, editableFenceSchema, openCodeFence } from './codeFence.js';
import { frontmatter, math, protectSource, sourceBlock, SourceDocument } from './source.js';
import { markRangeAt } from './markRange.js';
import { trackLiveTab } from './tabs.js';

type Host = {
	editable(): boolean;
	path(): string;
	changed(value: string): void;
	cursor(line: number, column: number): void;
	command(action: string): void;
};
type Surface = 'live' | 'source';
type TabEditors = { panes: Map<Surface, Promise<LiveEditor>>; lastEdit?: { editor: LiveEditor; text: string } };
const pool = new Map<string, TabEditors>();

// 원문 편집에서는 전체 선택이나 줄 삭제 후에도 일반 Markdown 입력 규칙이 실행되지 않는다.
const sourceDoc = $node('doc', () => ({ ...docSchema.schema, content: 'source_block' }));

export function openLiveEditor(id: string, surface: Surface = 'live'): Promise<LiveEditor> {
	let group = pool.get(id);
	if (!group) {
		const panes = new Map<Surface, Promise<LiveEditor>>();
		group = { panes };
		pool.set(id, group);
		trackLiveTab(id, { dispose() {
			pool.delete(id);
			for (const pending of panes.values()) void pending.then(editor => editor.destroy(), () => {});
		} });
	}
	const { panes } = group;
	const existing = panes.get(surface);
	if (existing) return existing;
	const instance = new LiveEditor(surface, group);
	const pending = instance.create().then(() => instance);
	panes.set(surface, pending);
	void pending.catch(() => { if (panes.get(surface) === pending) panes.delete(surface); });
	return pending;
}

export class LiveEditor {
	readonly root = document.createElement('div');
	private milk = Editor.make();
	private ctx!: Ctx;
	view!: EditorView;
	source!: SourceDocument;
	host?: Host;
	scroll = 0;
	private literal?: boolean;
	private path = '';

	constructor(private readonly surface: Surface, private readonly group: TabEditors) {}

	async create() {
		const keys = Object.fromEntries(SHORTCUTS.filter(s => /^(fmt-|table-|insert-table)/.test(s.id))
			.flatMap(s => s.chords.map(chord => [chord.replaceAll('+', '-').replace(/[A-Z]$/, c => c.toLowerCase()), () => {
				this.host?.command(s.id);
				return true;
			}])));
		const formatting = keydownHandler(keys);
		const images = $view(imageSchema.node, () => node => {
			const dom = document.createElement('img');
			const url = localSrc(String(node.attrs.src), this.host?.path() ?? this.path);
			if (url) dom.src = url;
			dom.alt = node.attrs.alt || '';
			if (node.attrs.title) dom.title = node.attrs.title;
			return { dom };
		});
		const tasks = $view(listItemSchema.node, () => (node, view, getPos) => {
			const dom = document.createElement('li');
			const contentDOM = document.createElement('div');
			if (typeof node.attrs.checked === 'boolean') {
				dom.className = 'live-task';
				const box = document.createElement('input');
				box.type = 'checkbox';
				box.contentEditable = 'false';
				box.checked = node.attrs.checked;
				box.setAttribute('aria-label', node.textContent || '[ ]');
				box.onchange = () => {
					const pos = getPos();
					if (this.host?.editable() && pos != null) view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', box.checked));
					else box.checked = node.attrs.checked;
				};
				dom.append(box);
			}
			dom.append(contentDOM);
			return { dom, contentDOM, stopEvent: event => event.target instanceof HTMLInputElement };
		});
		this.milk.config(ctx => {
			this.ctx = ctx;
			ctx.set(rootCtx, this.root);
			ctx.update(remarkStringifyOptionsCtx, options => ({
				...options, handlers: { ...options.handlers, underline: serializeUnderline },
			}));
			ctx.set(editorViewOptionsCtx, {
				editable: () => !!this.host?.editable(),
				decorations: state => {
					const { $from } = state.selection;
					if (!$from.parent.isTextblock) return null;
					return DecorationSet.create(state.doc, [Decoration.node($from.before(), $from.after(), { class: 'live-current' })]);
				},
				attributes: { 'aria-label': 'Markdown', 'aria-multiline': 'true' },
				handleKeyDown: (view, event) => {
					if (event.isComposing || view.composing || event.keyCode === 229 || event.getModifierState('AltGraph')) return false;
					const mod = event.ctrlKey || event.metaKey;
					if (event.key === 'Enter' && !mod && !event.altKey && !event.shiftKey && this.host?.editable() &&
						closeCodeFence(view.state, view.dispatch)) return true;
					if (!this.literal && ((mod && event.key.toLowerCase() === 'p' && !event.altKey && !event.shiftKey) || event.key === 'F1')) {
						this.host?.command('command-palette');
						return true;
					}
					if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
						this.host?.command('switch-editor');
						return true;
					}
					if (this.literal && mod && event.key.toLowerCase() === 'a') {
						this.action('selectAll');
						return true;
					}
					if (!this.literal && mod && event.key === 'Enter' && !event.altKey && this.host?.editable()) {
						const inserted = ctx.get(commandsCtx).call(event.shiftKey ? addRowBeforeCommand.key : addRowAfterCommand.key);
						if (!inserted) {
							const state = view.state;
							const head = state.selection.$head;
							const pos = head.depth ? (event.shiftKey ? head.before(1) : head.after(1)) : head.pos;
							const tr = state.tr.insert(pos, state.schema.nodes.paragraph.create());
							view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
						}
						return true;
					}
					if (mod && !event.shiftKey && !event.altKey && ['v','c','x','f'].includes(event.key.toLowerCase())) {
						this.host?.command(({v:'paste', c:'copy', x:'cut', f:'find'} as Record<string,string>)[event.key.toLowerCase()]);
						return true;
					}
					return !this.literal && formatting(view, event);
				},
				handlePaste: (_view, event) => {
					if (!this.host?.editable()) return false;
					const data = event.clipboardData;
					if (data?.files.length) { this.host.command('paste'); return true; }
					const text = data?.getData('text/plain');
					if (!text) return false;
					this.insert(text);
					return true;
				},
				clipboardTextSerializer: () => this.selectedMarkdown(),
				handleDoubleClickOn: (_view, _pos, node, nodePos) => {
					if (node.type.name !== 'image') return false;
					this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, nodePos)));
					this.host?.command('fmt-image');
					return true;
				},
				// 인라인 코드를 더블클릭하면 단어 대신 코드 전체를 선택한다.
				handleDoubleClick: (view, pos, event) => {
					const code = view.state.schema.marks.inlineCode;
					if (!code || !(event.target instanceof Element) || !event.target.closest('code')) return false;
					const range = markRangeAt(view.state.doc, pos, code);
					if (!range) return false;
					view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
					return true;
				},
			});
		});
		if (this.surface === 'source') {
			this.milk.use(docSchema).use(sourceDoc).use(textSchema).use(sourceBlock);
		} else {
			this.milk.use(underline).use(frontmatter).use(math).use(protectSource)
				// 첫 번째 block 타입이 새 문단이 되므로 원문 보존 노드는 일반 문단 뒤에 등록한다.
				.use(commonmark.filter(p => p !== syncHeadingIdPlugin && p !== createCodeBlockInputRule))
				.use(editableFenceSchema).use(openCodeFence).use(sourceBlock).use(gfm).use(images).use(tasks);
		}
		await this.milk.use(history).create();
		this.view = this.ctx.get(editorViewCtx);
		this.view.setProps({
			dispatchTransaction: tr => {
				if (tr.docChanged && !this.host?.editable()) return;
				const previous = this.view.state;
				const next = previous.apply(tr);
				this.view.updateState(next);
				if (next.doc !== previous.doc) {
					const text = this.source.write(next.doc);
					this.group.lastEdit = { editor: this, text };
					this.host?.changed(text);
				}
				if (!next.selection.eq(previous.selection) || tr.docChanged) this.reportCursor();
			},
		});
	}

	load(text: string, literal: boolean, path: string) {
		if (this.source?.text === text && literal === this.literal) {
			if (path !== this.path) {
				this.path = path;
				this.view.state.doc.descendants((node, pos) => {
					if (node.type.name !== 'image') return;
					const image = this.view.nodeDOM(pos);
					const src = localSrc(String(node.attrs.src), path);
					if (image instanceof HTMLImageElement) {
						if (src) image.src = src;
						else image.removeAttribute('src');
					}
				});
			}
			return;
		}
		const peer = this.group.lastEdit;
		const fromOtherPane = this.source && peer?.text === text && peer.editor !== this && this.path === path && this.literal === literal;
		this.literal = literal;
		this.path = path;
		this.source = new SourceDocument(this.ctx, text, literal);
		if (fromOtherPane) {
			const state = this.view.state;
			const target = this.source.doc;
			const start = state.doc.content.findDiffStart(target.content);
			if (start === null) return;
			const end = state.doc.content.findDiffEnd(target.content)!;
			const overlap = Math.max(0, start - Math.min(end.a, end.b));
			let tr = state.tr.replace(start, end.a + overlap, target.slice(start, end.b + overlap));
			if (!tr.doc.eq(target)) tr = state.tr.replaceWith(0, state.doc.content.size, target.content);
			this.view.updateState(state.apply(tr));
			return;
		}
		this.view.updateState(EditorState.create({ doc: this.source.doc, plugins: this.view.state.plugins }));
	}
	destroy() { this.host = undefined; return this.milk.destroy(); }
	reportCursor() {
		const { $head } = this.view.state.selection;
		const before = $head.parent.isTextblock ? $head.parent.textBetween(0, $head.parentOffset, '\n') : '';
		const lines = before.split(/\r\n|\n|\r/);
		this.host?.cursor((this.source.lines[$head.index(0)] ?? 1) + lines.length - 1, lines.at(-1)!.length + 1);
	}
	position(line: number, column = 1) {
		const { doc } = this.view.state;
		const index = this.source.indexAt(line);
		const start = doc.resolve(0).posAtIndex(index, 0);
		const block = doc.child(index);
		const first = Selection.near(doc.resolve(Math.min(start + 1, doc.content.size)));
		if (!block.isTextblock) return first.from;
		const lines = block.textContent.split('\n');
		const row = Math.min(lines.length - 1, Math.max(0, line - this.source.lines[index]));
		const offset = lines.slice(0, row).reduce((n, s) => n + s.length + 1, 0);
		return start + 1 + Math.min(block.content.size, offset + Math.min(Math.max(0,column - 1), lines[row].length));
	}
	select(from: number, to = from) {
		const { doc, tr } = this.view.state;
		this.view.dispatch(tr.setSelection(TextSelection.between(doc.resolve(from), doc.resolve(to))).scrollIntoView());
	}
	selectedMarkdown() {
		const { selection, doc } = this.view.state;
		if (selection.empty) return '';
		if (selection instanceof AllSelection) return this.source.text;
		if (selection.$from.sameParent(selection.$to) && selection.$from.parent.type.spec.code)
			return doc.textBetween(selection.from, selection.to);
		return this.ctx.get(serializerCtx)(doc.cut(selection.from, selection.to)).replace(/\n$/, '');
	}
	insert(text: string) {
		if (!this.host?.editable()) return;
		const { selection } = this.view.state;
		const tr = closeHistory(this.view.state.tr);
		if (this.literal || selection.$from.parent.type.spec.code) this.view.dispatch(tr.insertText(text).scrollIntoView());
		else {
			const doc = this.ctx.get(parserCtx)(text);
			// 일반 문단의 양끝만 기존 문장에 이어 붙이고 코드·표·목록의 블록 구조는 유지한다.
			const paragraph = this.view.state.schema.nodes.paragraph;
			const slice = new Slice(doc.content, doc.firstChild?.type === paragraph ? 1 : 0, doc.lastChild?.type === paragraph ? 1 : 0);
			this.view.dispatch(tr.replaceSelection(slice).scrollIntoView());
		}
	}
	find(query: string, back: boolean) {
		if (!query) return false;
		const { doc, selection } = this.view.state;
		const positions: number[] = [];
		doc.descendants((node, pos) => {
			if (!node.isText) return;
			const text = node.text!.toLowerCase();
			const needle = query.toLowerCase();
			for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) positions.push(pos + i);
		});
		const pos = back ? positions.findLast(p => p < selection.from) ?? positions.at(-1) : positions.find(p => p >= selection.to) ?? positions[0];
		if (pos == null) return false;
		this.select(pos, pos + query.length);
		return true;
	}
	action(id: string, rows = 2, cols = 3) {
		const { state, dispatch } = this.view;
		if (id === 'selectAll') {
			const selection = this.literal && state.doc.childCount === 1
				? TextSelection.create(state.doc, 1, state.doc.content.size - 1)
				: new AllSelection(state.doc);
			dispatch(state.tr.setSelection(selection));
			return;
		}
		if (this.literal && id !== 'undo' && id !== 'redo') return;
		if (!this.host?.editable()) return;
		const cmd = this.ctx.get(commandsCtx);
		switch (id) {
			case 'undo': return undo(state, dispatch);
			case 'redo': return redo(state, dispatch);
			case 'fmt-bold': return cmd.call(toggleStrongCommand.key);
			case 'fmt-italic': return cmd.call(toggleEmphasisCommand.key);
			case 'fmt-inline-code': return cmd.call(toggleInlineCodeCommand.key);
			case 'fmt-strikethrough': return cmd.call(toggleStrikethroughCommand.key);
			case 'fmt-code-block': return cmd.call(createCodeBlockCommand.key);
			case 'fmt-quote': return cmd.call(wrapInBlockquoteCommand.key);
			case 'fmt-numbered-list': return cmd.call(wrapInOrderedListCommand.key);
			case 'fmt-bullet-list': return cmd.call(wrapInBulletListCommand.key);
			case 'fmt-heading-1': case 'fmt-heading-2': case 'fmt-heading-3': return cmd.call(wrapInHeadingCommand.key, Number(id.at(-1)));
			case 'table-insert-column': return addColumnAfter(state, dispatch);
			case 'table-delete-column': return deleteColumn(state, dispatch);
			case 'insert-table-simple': case 'insert-table-grid': return cmd.call(insertTableCommand.key, { row: Math.max(2,rows), col: Math.max(1,cols) });
			case 'edit-source': {
				const index = state.selection.$from.index(0);
				const node = state.doc.maybeChild(index);
				if (!node) return;
				if (node.type.name === 'source_block') return;
				const text = this.source.blockText(node);
				const pos = state.doc.resolve(0).posAtIndex(index,0);
				const block = state.schema.nodes.source_block.create(null,text ? state.schema.text(text) : undefined);
				const tr = state.tr.replaceWith(pos,pos+node.nodeSize,block);
				dispatch(tr.setSelection(TextSelection.create(tr.doc,pos+1)).scrollIntoView());
				break;
			}
			case 'fmt-checklist': {
				const inside = () => {
					const { $from } = this.view.state.selection;
					for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'list_item') return $from.before(d);
				};
				if (inside() == null) cmd.call(wrapInBulletListCommand.key);
				const pos = inside();
				if (pos != null) {
					const checked = this.view.state.doc.nodeAt(pos)?.attrs.checked;
					dispatch(this.view.state.tr.setNodeAttribute(pos,'checked',checked == null ? false : !checked));
				}
				break;
			}
			case 'fmt-underline': return toggleMark(state.schema.marks.underline)(state, dispatch);
		}
	}
}
