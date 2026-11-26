import assert from 'node:assert/strict';

import { viewerCommandFor, type KeyContext, type ViewerCommand } from '../src/lib/utils/viewerKeymap.js';
import { viewerCommandTable, type ViewerCommandHost } from '../src/lib/utils/viewerCommands.js';
export type Chord = string;

const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Meta'] as const;

export function label(parts: {
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	keyName: string;
}): string {
	const mods = [
		parts.ctrlKey && 'Ctrl',
		parts.shiftKey && 'Shift',
		parts.altKey && 'Alt',
		parts.metaKey && 'Meta',
	].filter(Boolean) as Array<(typeof MODIFIER_ORDER)[number]>;
	return [...MODIFIER_ORDER.filter((m) => mods.includes(m)), parts.keyName].join('+');
}

export const PLATFORMS = [
	{ name: 'macOS', osType: 'macos', mac: true },
	{ name: 'Windows', osType: 'windows', mac: false },
	{ name: 'Linux', osType: 'linux', mac: false },
] as const;

const FUZZ_KEYS: Array<{ keyName: string; key: string; code: string }> = [
	...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => ({
		keyName: c.toUpperCase(),
		key: c,
		code: `Key${c.toUpperCase()}`,
	})),
	...'0123456789'.split('').map((c) => ({
		keyName: c,
		key: c,
		code: `Digit${c}`,
	})),
	{ keyName: 'Tab', key: 'Tab', code: 'Tab' },
	{ keyName: 'PageUp', key: 'PageUp', code: 'PageUp' },
	{ keyName: 'PageDown', key: 'PageDown', code: 'PageDown' },
	{ keyName: 'LeftArrow', key: 'ArrowLeft', code: 'ArrowLeft' },
	{ keyName: 'RightArrow', key: 'ArrowRight', code: 'ArrowRight' },
	{ keyName: 'F4', key: 'F4', code: 'F4' },
	{ keyName: 'F5', key: 'F5', code: 'F5' },
	{ keyName: '\\', key: '\\', code: 'Backslash' },
	{ keyName: 'OEM_102', key: '\\', code: 'IntlBackslash' },
	{ keyName: '[', key: '[', code: 'BracketLeft' },
	{ keyName: ']', key: ']', code: 'BracketRight' },
	{ keyName: '.', key: '.', code: 'Period' },
	{ keyName: ',', key: ',', code: 'Comma' },
	{ keyName: '-', key: '-', code: 'Minus' },
	{ keyName: '=', key: '=', code: 'Equal' },
];

/**
 * Reading the document, not editing it, with nothing in front of it — the state
 * every caller of `documentKeymap` is asking about.
 *
 * `editorHasFocus: false` is the reporter's scenario in #153 (preview mode) and
 * the one in which the app's own chords, rather than Monaco's, are supposed to
 * answer.
 */
function readingContext(osType: string): KeyContext {
	return {
		mode: 'app',
		osType: osType as KeyContext['osType'],
		isSplit: false,
		overlayOpen: false,
		dialogOpen: false,
		isEditing: false,
		editorHasFocus: false,
	};
}

/**
 * Which command the document-level dispatcher means by each chord.
 *
 * The dispatcher is IMPORTED and called — `viewerCommandFor` is a plain
 * function of the keystroke and a seven-field context, so there is nothing to
 * extract, transpile or stand in for. It used to be the body of
 * `handleKeyDown` inside MarkdownViewer.svelte, and getting at it meant slicing
 * the function out of the component by name, running it through
 * `ts.transpileModule`, and evaluating it inside a `with` block whose scope
 * object answered EVERY free identifier with a recording stub.
 *
 * That last part is why the extraction was worth doing. A stub is indexable,
 * callable and self-similar, which makes it a plausible answer to a question the
 * harness has never heard of — and its result compares false to everything. #649
 * hit exactly that: `platformOf(...)` inside the handler resolved to a stub,
 * every `=== 'macos'` test against it was false, and the harness cheerfully
 * reported 610 answered chords where the app answers 51. The failure was silent
 * in both directions, because a stub neither throws nor refuses.
 *
 * Nothing here can go that way again. `viewerCommandFor` closes over nothing, so
 * a dependency it grows is a compile error at this call site rather than a stub.
 */
export function documentKeymap(osType: string): Map<Chord, ViewerCommand> {
	const context = readingContext(osType);
	const map = new Map<Chord, ViewerCommand>();

	for (const primary of [
		{ ctrlKey: false, metaKey: false },
		{ ctrlKey: true, metaKey: false },
		{ ctrlKey: false, metaKey: true },
	]) {
		for (const shiftKey of [false, true]) {
			for (const altKey of [false, true]) {
				for (const entry of FUZZ_KEYS) {
					const command = viewerCommandFor(
						{ ...primary, shiftKey, altKey, key: entry.key, code: entry.code, target: null },
						context,
					);
					if (command) map.set(label({ ...primary, shiftKey, altKey, keyName: entry.keyName }), command);
				}
			}
		}
	}
	assert.ok(
		map.size > 15,
		`the document dispatcher answered ${map.size} chords; the harness is not running the real function`,
	);
	return map;
}

/**
 * What each `ViewerCommand` reaching the keyboard does, as the names of the
 * host members it touched: `'appExit'` for a call, `'settings.previewMaxWidth'`
 * for a read, `'settings.showTabs='` for a write.
 *
 * Runs the real `viewerCommandTable` (`viewerCommands.ts`) against a recording
 * host: any member the table asks for exists and is logged, so a command that
 * reached for something the host type never had (`addHomeTab`) shows up by
 * name. The active tab is `'tab-1'`, so split view has a tab to toggle.
 */
export function viewerCommandCalls(): Record<ViewerCommand, string[]> {
	let calls: string[] = [];
	const recording = (prefix: string, fields: Record<string, unknown>) =>
		new Proxy(fields, {
			get(target, prop) {
				const name = prefix + String(prop);
				calls.push(name);
				if (prop in target) return target[prop as string];
				return () => {
					calls.push(`${name}()`);
					return Promise.resolve();
				};
			},
			set(target, prop, value) {
				calls.push(`${prefix}${String(prop)}=`);
				target[prop as string] = value;
				return true;
			},
		});
	const host = recording('', {
		settings: recording('settings.', { previewFullWidth: true, previewMaxWidth: 880, showTabs: true }),
		tabManager: recording('tabManager.', { activeTabId: 'tab-1' }),
	}) as unknown as ViewerCommandHost;
	const table = viewerCommandTable(host);

	const reachable = new Set<ViewerCommand>();
	for (const platform of PLATFORMS) for (const command of documentKeymap(platform.osType).values()) reachable.add(command);
	const result = {} as Record<ViewerCommand, string[]>;
	for (const command of reachable) {
		calls = [];
		table[command]();
		// A call shows up twice, as the read and then the call; keep the call.
		result[command] = calls.filter((name) => !calls.includes(`${name}()`)).map((name) => name.replace(/\(\)$/, ''));
	}
	return result;
}

// ------------------------------------- the nameless commands, and their handlers


/** One `editor.addCommand(binding, handler, when)` call, as Monaco is handed it. */
const MONACO_KEY_NAMES: Record<string, string> = {
	Left: 'LeftArrow',
	Right: 'RightArrow',
};

/**
 * A registry chord as the harness spells the same chord.
 *
 * The registry is written for a reader (`Mod+Shift+E`); Monaco's decoder emits
 * `Shift+Meta+E` on macOS and `Ctrl+Shift+E` elsewhere, in its own modifier
 * order. Translating in this direction — registry into harness — rather than
 * the other way keeps the registry human-facing, and a mistake here makes
 * assertions FAIL rather than pass, because the comparison is against chords
 * the real code produced.
 */
export function toMonacoLabel(chord: string, mac: boolean): Chord {
	return chord
		.split(' ') // a chord SEQUENCE ("Mod+K T") is two chords
		.map((single) => {
			const parts = single.split('+');
			const key = parts.pop()!;
			const mods = new Set(parts);
			const ctrl = mods.has('Ctrl') || (mods.has('Mod') && !mac);
			// A literal `Meta` stays Meta on every platform, the same way a literal
			// `Ctrl` does. The registry has no such row — the chords that need this
			// spelling are the unadvertised ones named in
			// DOCUMENT_CHORDS_NOT_ADVERTISED, which are written in registry syntax so
			// the exemption list and the registry read alike.
			const meta = mods.has('Meta') || (mods.has('Mod') && mac);
			return [
				ctrl && 'Ctrl',
				mods.has('Shift') && 'Shift',
				mods.has('Alt') && 'Alt',
				meta && 'Meta',
				MONACO_KEY_NAMES[key] ?? key,
			]
				.filter(Boolean)
				.join('+');
		})
		.join(' ');
}
