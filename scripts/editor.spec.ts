import assert from 'node:assert/strict';
import { describe,test } from 'vitest';

import { countWords } from '../src/lib/utils/wordCount.js';
import { contextMenuFor,editorContextMenuItems,type EditorMenuPane } from '../src/lib/utils/viewerContextMenu.js';
import { type LanguageCode } from '../src/lib/utils/i18n.js';
import { translations } from './allTranslations.js';

/*
 * The status bar counted `text.match(/\S+/g)` and then kept only the tokens
 * matching `\w` — `[A-Za-z0-9_]`. Both halves are Latin-only assumptions, and
 * together they made a Chinese or Japanese paragraph worth nothing: one token,
 * no `\w` in it, dropped. A document with no Latin characters read "0 字".
 *
 * The reported case is milder only by accident — the sentence happened to
 * contain "18", so the whole line survived the filter as a single word.
 */
describe('word count', () => {
	test('a CJK paragraph is counted per character, not as one token', () => {
		// github.com/sftwrdotdev/Markpad/issues/691, verbatim. 18 Han characters
		// plus 12 space-separated words; the app used to say 12.
		const document =
			'尊敬的开发者您好，这里应该有18个中文字符。\n' +
			'Dear developers, there are 18 Chinese characters in the above text.';
		assert.equal(countWords(document), 30);
	});

	test('a document with no Latin characters is not zero', () => {
		// The failure the issue did not reach, and the one that matters more.
		assert.equal(countWords('中文文档没有任何拉丁字母'), 12);
		assert.equal(countWords('日本語のテキストです'), 10);
	});

	test('CJK punctuation is not a word', () => {
		// `，` and `。` are Script=Common, so they reach the whitespace pass and
		// have to be filtered there, exactly like `.` and `,`.
		assert.equal(countWords('你好，世界。'), 4);
		assert.equal(countWords('Hello, world.'), 2);
	});

	test('a number wedged between CJK characters stays its own word', () => {
		// Removing the CJK run instead of spacing it would glue `18` to `年`'s
		// neighbours across the gap.
		assert.equal(countWords('第1章和第2章'), 7);
	});

	test('a script with no ASCII in it is not zero either', () => {
		// The `\w` filter was `[A-Za-z0-9_]`, so it dropped these tokens whole.
		// Korean is spaced, so the whitespace pass is the right unit for it — three
		// words, not eight syllables.
		assert.equal(countWords('안녕하세요 반갑습니다 여러분'), 3);
		assert.equal(countWords('Привет мир'), 2);
		assert.equal(countWords('Γειά σου κόσμε'), 3);
	});

	test('Latin counting is unchanged', () => {
		assert.equal(countWords(''), 0);
		assert.equal(countWords('   \n\t  '), 0);
		assert.equal(countWords('Hello world'), 2);
		assert.equal(countWords('one\ntwo\tthree'), 3);
		// Punctuation-only tokens were already excluded and still are. `___` is a
		// horizontal rule and now goes with them: it used to count as a word only
		// because `_` is in `\w`.
		assert.equal(countWords('--- *** ### ___'), 0);
	});
});

describe('editor context menu (#261)', () => {
	test('a right-click in the editor gets the editor menu, before any other rule claims it', () => {
		// Monaco takes input through a hidden `<textarea>`, so the carve-out that
		// leaves real text fields their native menu would claim every right-click
		// in the editor if it came first (#261/#266, then #207).
		const root = document.createElement('div');
		root.innerHTML = '<div class="live-scroll"><div class="view-lines"><span>text</span></div><textarea class="inputarea"></textarea></div>';
		for (const target of root.querySelectorAll('span, textarea')) {
			assert.equal(contextMenuFor(target, { modalOpen: false, inApp: true }), 'editor', target.tagName);
		}
	});

	/** A pane that records which of its functions ran. */
	function recordingPane(): { pane: EditorMenuPane; calls: string[] } {
		const calls: string[] = [];
		const record = (name: string) => () => void calls.push(name);
		return {
			calls,
			pane: {
				undo: record('undo'),
				redo: record('redo'),
				cutToClipboard: record('cutToClipboard'),
				copyToClipboard: record('copyToClipboard'),
				pasteFromClipboard: record('pasteFromClipboard'),
				selectAll: record('selectAll'),
				runEditorAction: (id) => void calls.push(`runEditorAction:${id}`),
			},
		};
	}

	const click = (items: ReturnType<typeof editorContextMenuItems>, label: string) => {
		const item = items.find((entry) => entry.label === label);
		assert.ok(item?.onClick, `no "${label}" item`);
		item.onClick();
	};

	test('every label the editor menu asks for exists in every language', () => {
		// A missing key does not throw: `t()` falls back to English, so a
		// forgotten locale shows one English item in an otherwise translated
		// menu (#261). Each label must be one the language itself defines.
		for (const [code, table] of Object.entries(translations)) {
			const own = new Set(Object.values(table.menu ?? {}));
			for (const item of editorContextMenuItems(() => null, code as LanguageCode, 'linux')) {
				if (item.label) assert.ok(own.has(item.label), `${code}: "${item.label}" is not in its own menu table`);
			}
		}
	});

	test('the editor menu runs the same three functions the keyboard runs', () => {
		// One implementation per operation is the whole point: six entry points
		// (three keys, three menu items) and three functions. A menu item wired to
		// its own inline implementation would drift from the shortcut silently.
		const { pane, calls } = recordingPane();
		const items = editorContextMenuItems(() => pane, 'en', 'macos');

		click(items, 'Cut');
		click(items, 'Copy');
		click(items, 'Paste');

		assert.deepEqual(calls, ['cutToClipboard', 'copyToClipboard', 'pasteFromClipboard']);
	});
});
