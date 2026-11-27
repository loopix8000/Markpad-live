<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { getEditorToolbarTools } from '../utils/editorToolbar.js';
	import { editorReadingPosition } from '../utils/editorPosition.js';
	import { clipboardMarkdown, embedFile, writeSelection } from '../live/clipboard.js';
	import type { LiveEditor } from '../live/editor.js';
	import { settings, wheelZoomFactor } from '../stores/settings.svelte.js';
	import { tabManager } from '../stores/tabs.svelte.js';
	import { fontFamilyValue } from '../utils/fontFamily.js';
	import { t } from '../utils/i18n.js';
	import { asBufferLine, editorTopLineForTabAnchor, lineCoordinates, type BufferLine } from '../utils/lineCoordinates.js';
	import type { ScrollSyncPosition } from '../utils/scrollSync.js';
	import { countWords } from '../utils/wordCount.js';
	import Modal from './Modal.svelte';
	import '@milkdown/kit/prose/view/style/prosemirror.css';
	import '@milkdown/kit/prose/tables/style/tables.css';

	let { tabId, value, language, sourceMode = false, focusOnMount = true, onswitchmode, readOnly, zoomLevel, sharedCursor, onscrollsync, oncursor, onerror } = $props<{
		tabId: string; value: string; language: string; sourceMode?: boolean; focusOnMount?: boolean; onswitchmode?: () => void; readOnly: boolean; zoomLevel: number;
		sharedCursor: { line: number; column: number } | null;
		onscrollsync: (position: ScrollSyncPosition) => void;
		oncursor: (line: BufferLine, column: number) => void;
		onerror: (message: string) => void;
	}>();
	let host: HTMLDivElement;
	let pane: HTMLDivElement;
	let live = $state.raw<LiveEditor>();
	let cursor = $state({ line: 1, column: 1 });
	let words = $state(0);
	let failed = $state(false);
	let dialog = $state<'link' | 'image' | null>(null);
	let address = $state('');
	let palette = $state(false);
	let filter = $state('');
	const actions = $derived(getEditorToolbarTools(settings.editorToolbarOrder).filter(tool =>
		t(tool.labelKey, settings.language).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())));
	let findOpen = $state(false);
	let query = $state('');
	let missed = $state(false);
	let searchInput = $state<HTMLInputElement>();
	let drag = $state<{ x: number; y: number; height: number } | null>(null);
	let lastEditable: boolean | undefined;
	let pending: (() => void) | undefined;
	const path = $derived(tabManager.activeTab?.path ?? '');
	const writable = () => !readOnly && tabManager.activeTabId === tabId;
	function sync(instance: LiveEditor) {
		instance.load(value, sourceMode || language !== 'markdown', path);
		if (lastEditable !== writable()) {
			lastEditable = writable();
			instance.view.setProps({ editable: writable });
		}
	}
	onMount(() => {
		let current = true;
		const id = tabId;
		const wheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			settings.zoomBy(wheelZoomFactor(e.deltaY));
		};
		pane.addEventListener('wheel', wheel, { passive: false });
		import('../live/editor.js').then(module => current ? module.openLiveEditor(id, sourceMode ? 'source' : 'live') : undefined).then(instance => {
			if (!instance || !current || tabManager.activeTabId !== id) return;
			host.append(instance.root);
			instance.host = {
				editable: writable, path: () => path,
				changed: text => { if (writable() && tabManager.activeTab?.rawContent !== text) tabManager.updateTabRawContent(id, text); },
				cursor: (line, column) => {
					cursor = { line, column };
					oncursor(asBufferLine(line), column);
					if (settings.typewriterMode && instance.view.hasFocus() && !instance.view.composing) {
						const caret = instance.view.coordsAtPos(instance.view.state.selection.head);
						pane.scrollTop += caret.top - pane.getBoundingClientRect().top - pane.clientHeight / 2;
					}
				},
				command: runEditorAction,
			};
			const restored = !!instance.source && instance.source.text === value;
			sync(instance);
			live = instance;
			instance.view.dom.setAttribute('aria-label', t(sourceMode ? 'menu.sourceEditor' : 'menu.liveEditor', settings.language));
			if (focusOnMount) instance.view.focus();
			if (restored) pane.scrollTop = instance.scroll;
			else if (sharedCursor) setCursor(sharedCursor.line, sharedCursor.column);
			else {
				const tab = tabManager.activeTab;
				if (tab && tab.anchorLine > 0) {
					const line = editorTopLineForTabAnchor(lineCoordinates(instance.source.text), tab.anchorLine);
					syncScrollToPosition({section: 'body', line, ratio: tab.scrollPercentage ?? 0});
				} else pane.scrollTop = (tab?.scrollPercentage ?? 0) * (pane.scrollHeight - pane.clientHeight);
			}
			pending?.();
			if (instance.view.hasFocus()) instance.reportCursor();
		}).catch(reason => { if (current) { failed = true; onerror(String(reason)); } });
		return () => {
			current = false;
			pane.removeEventListener('wheel',wheel);
			if (live) {
				if (live.view.hasFocus()) flushPositionTo(id);
				live.scroll = pane.scrollTop;
				live.host = undefined;
				live.root.remove();
			}
		};
	});
	$effect(() => {
		const instance = live;
		void [value, language, readOnly, path, sourceMode];
		if (instance) untrack(() => sync(instance));
	});
	$effect(() => {
		const source = value;
		if (!settings.statusBar || !settings.wordCount) return;
		const timer = setTimeout(() => { words = countWords(source); }, 250);
		return () => clearTimeout(timer);
	});

	export function scrollSyncPosition(): ScrollSyncPosition | null {
		if (!live) return null;
		const rect = pane.getBoundingClientRect();
		const pos = live.view.posAtCoords({ left: rect.left + rect.width / 2, top: rect.top + 2 })?.pos;
		const index = pos == null ? 0 : live.view.state.doc.resolve(pos).index(0);
		const line = sourceMode && pos != null
			? asBufferLine(1 + (live.view.state.doc.textBetween(0, pos).match(/\n/g)?.length ?? 0))
			: asBufferLine(live.source.lines[index] ?? 1);
		const ratio = pane.scrollTop / Math.max(1,pane.scrollHeight - pane.clientHeight);
		return { section: line <= lineCoordinates(live.source.text).frontMatterLines ? 'frontmatter' : 'body', ratio, line };
	}
	let following = false;
	export function syncScrollToPosition(position: ScrollSyncPosition, options?: {cursorIntoView?: boolean}) {
		if (!live) { pending = () => syncScrollToPosition(position, options); return; }
		following = true;
		if (position.line) {
			const pos = live.position(Math.floor(position.line));
			const rect = live.view.coordsAtPos(pos);
			pane.scrollTop += rect.top - pane.getBoundingClientRect().top;
			if (options?.cursorIntoView) live.select(pos);
		} else pane.scrollTop = position.ratio * (pane.scrollHeight - pane.clientHeight);
		requestAnimationFrame(() => { following = false; });
	}
	export function focus() { live?.view.focus(); }
	export function setCursor(line: number, column: number) {
		if (!live) { pending = () => setCursor(line,column); return; }
		live.select(live.position(line,column));
	}
	export function revealSourceRange(from: number, to: number) {
		if (!live) { pending = () => revealSourceRange(from,to); return; }
		live.select(live.position(from),live.position(to,Number.MAX_SAFE_INTEGER));
		live.view.focus();
	}
	export function revealHeader(line: BufferLine | null, text: string) {
		if (!live) { pending = () => revealHeader(line,text); return; }
		if (line != null) setCursor(line,1);
		else live.view.state.doc.forEach((n,p) => { if (n.type.name === 'heading' && n.textContent === text) live?.select(p + 1); });
	}
	export function flushPositionTo(id: string) {
		if (id !== tabId || !live) return;
		const position = scrollSyncPosition();
		if (!position) return;
		const reading = editorReadingPosition({ scrollTop: pane.scrollTop, contentHeight: pane.scrollHeight,
			viewportHeight: pane.clientHeight, topLine: position.line ?? null, text: live.source.text });
		if (reading.scrollPercentage != null) tabManager.updateTabScrollPercentage(id,reading.scrollPercentage);
		if (reading.anchorLine != null) tabManager.updateTabAnchorLine(id,reading.anchorLine);
	}
	export function updateDragCaret(x: number, y: number) {
		if (!live || !writable()) return;
		const hit = live.view.posAtCoords({left:x,top:y});
		if (!hit) { hideDragCaret(); return; }
		const r = live.view.coordsAtPos(hit.pos);
		drag = { x:r.left, y:r.top, height:r.bottom-r.top };
	}
	export function hideDragCaret() { drag = null; }

	export async function handleDroppedFile(file: string, x: number, y: number) {
		const instance = live;
		if (!instance || !writable()) return;
		const hit = instance.view.posAtCoords({left:x,top:y});
		if (hit) instance.select(hit.pos);
		const state = instance.view.state;
		try {
			const embed = await embedFile(file,path,settings.imageDirectory);
			if (instance.host && writable() && state === instance.view.state) instance.insert(embed);
		} catch (reason) { onerror(String(reason)); }
	}

	export async function pasteFromClipboard() {
		const instance = live;
		if (!instance || !writable()) return;
		const state = instance.view.state;
		const dest = path;
		try {
			const text = await clipboardMarkdown(dest,settings.imageDirectory,settings.macosImageScaling);
			if (!text || !instance.host || !writable() || state !== instance.view.state) return;
			instance.view.focus();
			if (!sourceMode && language === 'markdown' && !state.selection.empty && /^https?:\/\/\S+$/i.test(text) && !state.selection.$from.parent.type.spec.code)
				instance.view.dispatch(state.tr.addMark(state.selection.from,state.selection.to,state.schema.marks.link.create({href:text})));
			else instance.insert(text);
		} catch (reason) { onerror(String(reason)); }
	}
	export async function copyToClipboard() {
		if (live) try { await writeSelection(live,false); } catch (reason) { onerror(String(reason)); }
	}
	export async function cutToClipboard() {
		if (live && writable()) try { await writeSelection(live,true); } catch (reason) { onerror(String(reason)); }
	}
	export function undo() { runEditorAction('undo'); }
	export function redo() { runEditorAction('redo'); }
	export function selectAll() { runEditorAction('selectAll'); }
	export async function triggerFind() { findOpen = true; await tick(); searchInput?.focus(); searchInput?.select(); }
	function find(back = false) { missed = !live?.find(query,back); }
	export function runEditorAction(id: string, payload?: {rows?:number; cols?:number}) {
		if (!live) return;
		if (id === 'switch-editor') { onswitchmode?.(); return; }
		if (id === 'command-palette' && sourceMode) return;
		if (id === 'command-palette') { filter = ''; palette = true; return; }
		if (id === 'find') { void triggerFind(); return; }
		if (id === 'copy') { void copyToClipboard(); return; }
		if (id === 'cut') { void cutToClipboard(); return; }
		if (id === 'paste') { void pasteFromClipboard(); return; }
		live.view.focus();
		if ((id === 'fmt-link' || id === 'fmt-image') && writable()) {
			const {selection} = live.view.state;
			const image = selection.$from.nodeAfter;
			address = id === 'fmt-image' && image?.type.name === 'image' ? image.attrs.src :
				selection.$from.marks().find(m => m.type.name === 'link')?.attrs.href ?? '';
			dialog = id === 'fmt-image' ? 'image' : 'link';
			return;
		}
		live.action(id,payload?.rows,payload?.cols);
	}
	function applyAddress() {
		if (!live || !writable()) return;
		const { state, dispatch } = live.view;
		const {from,to,$from: start} = state.selection;
		const url = address.trim();
		const tr = state.tr;
		if (dialog === 'image') {
			const image = start.nodeAfter;
			if (url && image?.type.name === 'image') tr.setNodeAttribute(from,'src',url);
			else if (url) tr.replaceSelectionWith(state.schema.nodes.image.create({src:url,alt:state.doc.textBetween(from,to)}));
		} else {
			const mark = state.schema.marks.link;
			let a = from, b = to;
			const current = mark.isInSet(start.marks()) ?? mark.isInSet(start.nodeAfter?.marks ?? []);
			if (a === b && current) {
				while (a > start.start() && current.isInSet(state.doc.resolve(a).nodeBefore?.marks ?? [])) a--;
				while (b < start.end() && current.isInSet(state.doc.resolve(b).nodeAfter?.marks ?? [])) b++;
			}
			if (a === b && url) { tr.insertText(url,a); b += url.length; }
			tr.removeMark(a,b,mark);
			if (url) tr.addMark(a,b,mark.create({href:url}));
		}
		dispatch(tr.scrollIntoView());
		dialog = null;
		live.view.focus();
	}
</script>

{#if findOpen}
	<form class="live-find" onsubmit={e => { e.preventDefault(); find(); }}>
		<input bind:this={searchInput} bind:value={query} aria-label={t('find.placeholder',settings.language)} placeholder={t('find.placeholder',settings.language)}
			oninput={() => missed = false} onkeydown={e => { if (e.key === 'Escape') { findOpen = false; live?.view.focus(); } }} />
		{#if missed}<span role="status">{t('find.noMatches',settings.language)}</span>{/if}
		<button type="button" aria-label={t('find.previous',settings.language)} onclick={() => find(true)}>↑</button>
		<button type="submit" aria-label={t('find.next',settings.language)}>↓</button>
		<button type="button" aria-label={t('find.close',settings.language)} onclick={() => { findOpen = false; live?.view.focus(); }}>×</button>
	</form>
{/if}
<div class="live-scroll" bind:this={pane} onscroll={() => { const p = scrollSyncPosition(); if (p && !following) onscrollsync(p); }}>
	<div class="live-body" class:markdown-body={!sourceMode} class:source-body={sourceMode} class:focused={settings.focusMode} class:nowrap={settings.wordWrap === 'off'} bind:this={host}
		style:--live-font={fontFamilyValue(settings.editorFont, sourceMode ? 'monospace' : 'sans-serif')}
		style:--live-size={settings.editorFontSize * zoomLevel / 100 + 'px'}></div>
	{#if failed}<pre>{value}</pre>{/if}
</div>
{#if drag}<div class="drop-caret" style:left={drag.x+'px'} style:top={drag.y+'px'} style:height={drag.height+'px'}></div>{/if}

{#if settings.statusBar}
	<div class="live-status">
		<span>{t('editor.status.lineCol',settings.language).replace('{{line}}',String(cursor.line)).replace('{{col}}',String(cursor.column))}</span>
		{#if settings.wordCount}<span>{t('editor.status.words',settings.language).replace('{{count}}',String(words))}</span>{/if}
		<span>{language}</span><span>{tabManager.activeTab?.encoding ?? 'UTF-8'}</span>
	</div>
{/if}
<Modal show={palette} title={t('menu.commandPalette',settings.language)} message="" showInput bind:inputValue={filter}
	confirmLabel={t('editor.runCommand', settings.language)} confirmDisabled={actions.length === 0}
	onkeydown={e => { if (e.key === 'Enter' && e.target instanceof HTMLButtonElement && e.target.closest('.palette-list')) { e.preventDefault(); e.target.click(); } }}
	onconfirm={() => { if (actions[0]) { palette = false; runEditorAction(actions[0].id); } }}
	oncancel={() => { palette = false; }}>
	<div class="palette-list">
		{#each actions as tool (tool.id)}
			<button onclick={() => { palette = false; runEditorAction(tool.id); }}>{t(tool.labelKey,settings.language)}</button>
		{/each}
	</div>
</Modal>
<Modal show={dialog !== null} title={dialog === 'image' ? t('menu.image',settings.language) : t('menu.link',settings.language)}
	message="URL" showInput bind:inputValue={address} confirmLabel={t('editor.apply', settings.language)}
	onconfirm={applyAddress} oncancel={() => { dialog = null; live?.view.focus(); }} />

<style>
	.live-scroll { flex: 1; min-height: 0; overflow: auto; background: var(--color-canvas-default); color: var(--color-fg-default); }
	.live-body {
		--gutter: clamp(1em, 4%, 3em);
		font-family: var(--live-font);
		font-size: var(--live-size);
		line-height: 1.6;
		max-width: var(--live-width);
		margin: auto;
		padding: 1.25em max(var(--gutter), var(--editor-inset-right, 0px)) 3em max(var(--gutter), var(--editor-inset-left, 0px));
		box-sizing: border-box;
	}
	.live-body :global(.ProseMirror) { min-height: 65vh; overflow-wrap: anywhere; outline: none; }
	.live-body :global(.ProseMirror:focus-visible) { caret-color: var(--color-accent-fg); }
	.live-body :global(.live-task) { display: flex; gap: .5em; align-items: flex-start; list-style: none; }
	.live-body :global(.live-task > div) { flex: 1; min-width: 0; }
	.focused :global(.ProseMirror :is(p,h1,h2,h3,h4,h5,h6,pre):not(.live-current)) { opacity: .5; }
	.nowrap :global(.ProseMirror p) { white-space: pre; }
	.live-body :global(pre) { white-space: pre-wrap; }
	.source-body :global(pre.source-block) { margin: 0; padding: 0; background: transparent; }
	.source-body :global(pre.source-block code) { font: inherit; }
	.source-body :global(.ProseMirror) { min-height: max(65vh, 6em); }
	.source-body.nowrap :global(pre.source-block) { white-space: pre; }
	.live-body :global(.selectedCell) { background: var(--color-accent-subtle); }
	.live-status, .live-find { display: flex; flex: none; align-items: center; gap: 1em; padding: 4px 12px; color: var(--color-fg-muted); background: var(--color-canvas-subtle); font-size: 12px; }
	.live-find input { min-width: 6em; color: inherit; background: var(--color-canvas-default); }
	.palette-list { display: grid; max-height: 40vh; overflow: auto; }
	.palette-list button { text-align: start; padding: .4em .7em; color: inherit; background: transparent; border: 0; }
	.palette-list button:is(:hover,:focus-visible) { background: var(--color-canvas-subtle); }
	.drop-caret { position: fixed; pointer-events: none; width: 2px; background: var(--color-accent-fg); z-index: 5; }
</style>
