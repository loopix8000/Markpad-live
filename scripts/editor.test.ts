import assert from 'node:assert/strict';
import { describe,test } from 'node:test';
import postcss from 'postcss';

// Monaco's own default — the editor does not set `wordSeparators`, so this is
// what the classifier is built with in the app.

import { getSupportedLanguages,type LanguageCode,t,type Translation,type TranslationKey } from '../src/lib/utils/i18n.js';
import { translations } from './allTranslations.js';
import { readSource } from './sourceTree.js';
import { editorLanguageFor } from '../src/lib/utils/editorLanguage.js';
import { MARKDOWN_LINK_EXTENSIONS } from '../src/lib/utils/markdownLinks.js';
import { markdownKindColors,monacoTokenRules,PREVIEW_KIND_VARS } from '../src/lib/utils/theme.js';
import { resolveExportImagePath } from '../src/lib/utils/exportHtml.js';
import { DEFAULT_IMAGE_DIRECTORY,documentParentDir,encodeImageDestination,imageEmbed,resolveImageDirectory } from '../src/lib/utils/imageEmbed.js';
import { resolveDocumentRelativePath } from '../src/lib/utils/markdown.js';

// WHAT THIS FILE COVERS, AND WHAT IT DOES NOT
//
// Covered for real: the translation table. `t()` is imported and called, so the
// key-exists / falls-back / distinct-label assertions are genuine behaviour.
//
// Not covered: Monaco's runtime. Editor.svelte is a Svelte component and cannot
// be imported here, so "the context menu is rebuilt when the language changes"
// and "no action id is registered twice" are pinned by reading the component's
// source. Those assertions prove the code is *written* that way, not that
// Monaco behaves that way when the effect re-runs — verifying that needs a
// running editor.
describe('context menu labels', () => {
	const supported = getSupportedLanguages().map((l) => l.code);

	/**
	 * Does `lang`'s own dictionary define `key`, without the English fallback?
	 *
	 * `t()` falls back to English, so `assert.notEqual(t(key, lang), key)` can only
	 * fail when ENGLISH lacks the key — which each caller below already asserts one
	 * line earlier. The 26-language loop around it restated that 26 times and could
	 * not see the regression it was written for: deleting the German
	 * `menu.inlineCode` entry left the whole suite green while the German context
	 * menu rendered the English label.
	 *
	 * These labels are held to a stricter bar than the dictionary at large.
	 * A locale may leave keys untranslated (`LocaleTable` is partial), because nobody should have to translate
	 * a new English string 25 times before landing it. That trade does not apply
	 * here: this is a fixed list of a dozen context-menu entries, all 26 languages
	 * define all of them today, and adding an eleventh action means adding a row to
	 * FORMATTING_ACTIONS by hand — so the cost is visible where it is incurred.
	 */
	function defines(lang: LanguageCode, key: string): boolean {
		let node: string | Translation | undefined = translations[lang];
		for (const part of key.split('.')) {
			if (typeof node !== 'object' || node === null || !(part in node)) return false;
			node = node[part];
		}
		return typeof node === 'string';
	}

	// The markdown formatting entries that used to be English string literals.
	const FORMATTING_ACTIONS: ReadonlyArray<[actionId: string, key: TranslationKey, englishLabel: string]> = [
		['fmt-strikethrough', 'menu.strikethrough', 'Strikethrough'],
		['fmt-inline-code', 'menu.inlineCode', 'Inline Code'],
		['fmt-code-block', 'menu.codeBlock', 'Code Block'],
		['fmt-quote', 'menu.quote', 'Quote'],
		['fmt-heading-1', 'menu.heading1', 'Heading 1'],
		['fmt-heading-2', 'menu.heading2', 'Heading 2'],
		['fmt-heading-3', 'menu.heading3', 'Heading 3'],
		['fmt-bullet-list', 'menu.bulletList', 'Bullet List'],
		['fmt-numbered-list', 'menu.numberedList', 'Numbered List'],
		['fmt-checklist', 'menu.checklist', 'Checklist'],
		['fmt-link', 'menu.link', 'Link'],
	];

	test('the formatting labels exist in English and are translated in every language', () => {
		for (const [, key, englishLabel] of FORMATTING_ACTIONS) {
			assert.equal(t(key, 'en'), englishLabel, `${key} is defined for English`);
			for (const lang of supported) {
				// `defines`, not `t(...) !== key` — see the note on the helper.
				assert.ok(
					defines(lang as LanguageCode, key),
					`${key} is translated for ${lang}; it currently falls back to the English label`,
				);
				assert.ok(t(key, lang as LanguageCode).length > 0, `${key} is non-empty for ${lang}`);
			}
		}
	});
});

describe('editor language', () => {
	test('every extension the preview renders as Markdown is edited as Markdown', () => {
		// The editor kept its own copy of the list, without `txt`: a `.txt` note
		// rendered as Markdown in the preview and showed as plain text in the editor.
		for (const ext of MARKDOWN_LINK_EXTENSIONS) {
			assert.equal(editorLanguageFor(`/notes/a.${ext}`), 'markdown', ext);
			assert.equal(editorLanguageFor(`/notes/a.${ext.toUpperCase()}`), 'markdown', ext);
		}
	});

	test('other files keep their own grammar, and an untitled buffer is Markdown', () => {
		assert.equal(editorLanguageFor(''), 'markdown');
		assert.equal(editorLanguageFor('/src/a.ts'), 'typescript');
		assert.equal(editorLanguageFor('/var/app.log'), 'plaintext');
		assert.equal(editorLanguageFor('/notes/constructor'), 'plaintext');
	});
});

// #676: an imported VS Code theme colours TextMate scopes, Monaco's markdown
// tokenizer emits names of its own, and until now nothing renamed one into the
// other — so `markup.bold` reached `defineTheme` and matched nothing.
describe('markdown token colours', () => {
	const rulesFor = (tokenColors: unknown) => monacoTokenRules(tokenColors);

	const tokens = (tokenColors: unknown) => rulesFor(tokenColors).map((rule) => rule.token);

	test('an emphasis scope also arrives under the token Monaco emits', () => {
		const rules = rulesFor([
			{ scope: 'markup.bold', settings: { foreground: '#ff0000', fontStyle: 'bold' } },
			{ scope: 'markup.italic', settings: { foreground: '#00ff00' } },
			{ scope: ['markup.inline.raw', 'markup.underline.link'], settings: { foreground: '#0000ff' } },
		]);

		const byToken = new Map(rules.map((rule) => [rule.token, rule]));
		assert.deepEqual(byToken.get('strong'), { token: 'strong', foreground: 'ff0000', fontStyle: 'bold' });
		assert.equal(byToken.get('emphasis')?.foreground, '00ff00');
		assert.equal(byToken.get('variable')?.foreground, '0000ff');
		assert.equal(byToken.get('string.link')?.foreground, '0000ff');

		// The scope keeps its own rule too — it is inert, not wrong.
		assert.ok(byToken.has('markup.bold'));
	});

	test('a language-qualified scope is renamed too, and a shorter neighbour is not', () => {
		assert.ok(tokens([{ scope: 'markup.bold.markdown', settings: { foreground: '#ff0000' } }]).includes('strong'));
		assert.ok(tokens([{ scope: 'markup.italic.markdown', settings: { foreground: '#ff0000' } }]).includes('emphasis'));

		// `markup.underline` is underlined text, not a link, and must not take the
		// link colour on the strength of a shared prefix.
		assert.deepEqual(tokens([{ scope: 'markup.underline', settings: { foreground: '#ff0000' } }]), ['markup.underline']);
	});

	test('a colour-only rule leaves the base theme to keep bold and italic', () => {
		// Monaco reads a missing `fontStyle` as NotSet and keeps what is already on
		// the token — `vs`/`vs-dark` define `strong: bold` and `emphasis: italic`.
		// Spelling it `regular` here instead would flatten the text the theme was
		// only asked to colour.
		const rule = rulesFor([{ scope: 'markup.bold', settings: { foreground: '#ff0000' } }]).find((r) => r.token === 'strong');
		assert.ok(rule, 'the alias must exist before its fontStyle means anything');
		assert.equal(rule.fontStyle, undefined);
	});

	test('scopes written as one comma-separated string are split', () => {
		// Left whole, the comma is part of the token name and the entry colours
		// nothing — the same silent miss as the missing rename.
		assert.deepEqual(
			tokens([{ scope: 'comment, markup.bold', settings: { foreground: '#ff0000' } }]),
			['comment', 'markup.bold', 'strong'],
		);
	});

	test('an unusable entry is dropped rather than passed to defineTheme', () => {
		// A non-hex foreground makes `defineTheme` throw, which drops the whole
		// editor theme, so it cannot reach it — alias or not.
		assert.deepEqual(tokens([{ scope: 'markup.bold', settings: { foreground: 'red' } }]), []);
		assert.deepEqual(tokens([{ scope: 'markup.bold', settings: {} }]), []);
		assert.deepEqual(tokens([{ settings: { foreground: '#ff0000' } }]), []);
		assert.deepEqual(tokens(undefined), []);
	});

	// #682: the same scopes, read as colours rather than as Monaco rules, because
	// the preview renders the constructs as HTML and takes them through CSS.

	test('a theme\'s Markdown scopes are readable as a colour per construct', () => {
		const colors = markdownKindColors([
			{ scope: 'markup.bold.markdown', settings: { foreground: '#ff0000' } },
			{ scope: ['markup.heading', 'markup.quote'], settings: { foreground: '#00ff00' } },
			{ scope: 'markup.underline.link', settings: { foreground: '#0000ff', fontStyle: 'underline' } },
			// Not Markdown, and not a colour: neither may reach the preview.
			{ scope: 'keyword.control', settings: { foreground: '#123456' } },
			{ scope: 'markup.italic', settings: { fontStyle: 'italic' } },
		]);

		assert.equal(colors.get('strong'), 'ff0000');
		assert.equal(colors.get('heading'), '00ff00');
		assert.equal(colors.get('quote'), '00ff00');
		assert.equal(colors.get('link'), '0000ff');
		assert.equal(colors.has('emph'), false);
		assert.equal([...colors.keys()].length, 4);
	});

	test('a theme with no token colours at all leaves the preview alone', () => {
		// The built-in themes, and a theme file that only paints the workbench. An
		// empty map writes no variable, and every rule falls back to what the
		// stylesheet already said.
		for (const tokenColors of [undefined, null, [], 'markup.bold']) {
			assert.equal(markdownKindColors(tokenColors).size, 0);
		}
	});
});

/*
	The link the app writes for a pasted or dropped image has to name the file
	Rust just created — after a CommonMark parse, and after each of Markpad's
	two readers has had its way with the result.

	So every case below is checked end to end, through the real readers:

	  parse    the destination CommonMark hands the renderer, per its grammar
	  preview  `processMarkdownHtml`: decodeURIComponent, then resolve
	  export   `resolveExportImagePath`, imported here, not modelled

	The one thing modelled rather than run is comrak, which is Rust. Its
	`escape_href` (comrak 0.54, src/html.rs) is the identity on everything
	`encodeImageDestination` emits: its safe set covers the unreserved ASCII we
	pass through, it copies a `%` verbatim when two hex digits follow, and the
	two characters it does rewrite — `&` to `&amp;`, `'` to `&#x27;` — are
	undone by the HTML parser before either reader sees them. Passing the
	destination straight to the readers is therefore faithful, and
	`the escapes comrak passes through unchanged` below pins the assumption
	that matters.
*/
describe('image embed', () => {
	/**
	 * The destination CommonMark reads out of `![alt](…)`: it ends at the first
	 * ASCII space or control character, and parentheses count only while balanced.
	 * This is where `photo).png` loses its tail, so the fix has to be visible here
	 * before anything downstream is worth checking.
	 */
	function parseDestination(embed: string): string {
		const open = embed.indexOf('](');
		assert.notEqual(open, -1, `not an inline image: ${embed}`);

		let depth = 1;
		let i = open + 2;
		for (; i < embed.length; i++) {
			const char = embed[i];
			if (char.charCodeAt(0) <= 0x20) break;
			if (char === '\\') {
				i++;
				continue;
			}
			if (char === '(') depth++;
			if (char === ')' && --depth === 0) break;
		}
		return embed.slice(open + 2, i);
	}

	/** What the preview does with a `src` in `processMarkdownHtml`. */
	function previewResolves(destination: string, tabPath: string): string {
		return resolveDocumentRelativePath(tabPath, decodeURIComponent(destination));
	}

	const TAB_PATH = '/home/u/notes/note.md';

	/**
	 * `relPath` is what `save_image` / `copy_file_to_img` return: the image
	 * directory and the file name joined with `/`, relative to the document.
	 */
	function roundTrips(relPath: string, expectedFile: string) {
		const destination = parseDestination(imageEmbed(relPath));

		assert.equal(
			destination,
			encodeImageDestination(relPath),
			'CommonMark truncated the destination',
		);
		assert.equal(previewResolves(destination, TAB_PATH), expectedFile, 'preview');
		assert.equal(resolveExportImagePath(destination, TAB_PATH), expectedFile, 'export');
	}

	test('a file name whose # would otherwise become an anchor', () => {
		// The report: `![alt](img/note#1.png)` exports as `img/note`.
		roundTrips('img/note#1.png', '/home/u/notes/img/note#1.png');
		assert.equal(imageEmbed('img/note#1.png'), '![alt](img/note%231.png)');
	});

	test('spaces, which were the only thing the old code escaped', () => {
		roundTrips('img/my photo.png', '/home/u/notes/img/my photo.png');
		assert.equal(imageEmbed('img/my photo.png'), '![alt](img/my%20photo.png)');
	});

	test('an unbalanced parenthesis, which ends the link early', () => {
		roundTrips('img/photo).png', '/home/u/notes/img/photo).png');
		roundTrips('img/photo(1.png', '/home/u/notes/img/photo(1.png');
	});

	test('balanced parentheses, which CommonMark allows and we encode anyway', () => {
		// Legal unescaped, so this is a deliberate cost: one rule beats a paren
		// counter, and both spellings name the same file at every reader.
		roundTrips('img/photo (1).png', '/home/u/notes/img/photo (1).png');
	});

	test('a ? , which the export resolver reads as a query string', () => {
		roundTrips('img/really?.png', '/home/u/notes/img/really?.png');
	});

	test('a literal % , which decodes back into a different name unencoded', () => {
		// comrak copies `%20` through untouched, so an unencoded `50%20off.png`
		// reaches decodeURIComponent and comes out as `50 off.png`.
		roundTrips('img/50%20off.png', '/home/u/notes/img/50%20off.png');
		assert.equal(imageEmbed('img/50%20off.png'), '![alt](img/50%2520off.png)');
	});

	test('a backslash, which CommonMark reads as an escape', () => {
		// Encoded for the parse — unencoded, `\(` is an escape and the destination
		// comes out as `img/a(b.png`, a different file.
		assert.equal(imageEmbed('img/a\\(b.png'), '![alt](img/a%5C%28b.png)');
		assert.equal(parseDestination(imageEmbed('img/a\\(b.png')), 'img/a%5C%28b.png');

		// Not round-tripped, and this is the one case that cannot be: both readers
		// resolve through a path splitter that counts `\` as a directory separator
		// on purpose, because a Windows author writes `![](img\a.png)` and means
		// one. See resolveDocumentRelativePath in src/lib/utils/markdown.ts. A
		// POSIX file whose *name* contains a backslash is unreachable through a
		// Markpad link however it is spelled, so nothing here can fix it.
		assert.equal(
			previewResolves('img/a%5C%28b.png', TAB_PATH),
			'/home/u/notes/img/a/(b.png',
		);
	});

	test('an imageDirectory carrying the same characters', () => {
		roundTrips('my imgs #1/photo.png', '/home/u/notes/my imgs #1/photo.png');
		roundTrips('assets (old)/a?.png', '/home/u/notes/assets (old)/a?.png');
	});

	test('an empty imageDirectory, whose leading slash is not an absolute path', () => {
		// Rust joins with `/`, so an empty setting yields `/photo.png`; left alone
		// it resolves to the filesystem root at both readers.
		roundTrips('/photo #1.png', '/home/u/notes/photo #1.png');
		assert.equal(imageEmbed('/photo #1.png'), '![alt](photo%20%231.png)');
	});

	test('non-ASCII names stay readable in the document', () => {
		// The reason encodeURI/encodeURIComponent were not used: both would write
		// `%E5%9B%BE%E7%89%87/…` into a file a person reads.
		assert.equal(imageEmbed('图片/截图.png'), '![alt](图片/截图.png)');
		roundTrips('图片/截图 1.png', '/home/u/notes/图片/截图 1.png');
	});

	test('the escapes comrak passes through unchanged', () => {
		// Every byte we emit is either in comrak's HREF_SAFE set or a `%` followed
		// by two hex digits, which its escape_href copies verbatim. If this ever
		// fails, the destination is being double-escaped on the way to the HTML.
		const safe = /^(?:[-_.+!*(),#@?=;:/$~a-zA-Z0-9]|%[0-9A-F]{2}|[^\x00-\x7f])*$/;
		for (const relPath of ['img/note#1.png', 'img/my photo.png', 'img/50%20off.png']) {
			assert.match(encodeImageDestination(relPath), safe);
		}
	});

	test('angle brackets would need the export resolver changed to work', () => {
		// The other candidate, and the form headingReference.ts uses for spaces and
		// parentheses. It answers the CommonMark grammar and nothing else: the `#`
		// reaches the readers raw, and the export resolver — correctly, for a URL —
		// treats it as a fragment. Recorded so the choice is not re-litigated from
		// memory; if this ever starts returning the whole path, angle brackets are
		// back on the table.
		assert.equal(parseDestination('![alt](<img/note#1.png>)'), '<img/note#1.png>');
		assert.equal(resolveExportImagePath('img/note#1.png', TAB_PATH), '/home/u/notes/img/note');
		assert.equal(resolveExportImagePath('img/a?.png', TAB_PATH), '/home/u/notes/img/a');
	});

	test('documentParentDir refuses a path with no directory in it', () => {
		assert.equal(documentParentDir('/home/u/notes/note.md'), '/home/u/notes');
		assert.equal(documentParentDir('C:\\notes\\note.md'), 'C:\\notes');
		assert.equal(documentParentDir('note.md'), null);
	});

	test('${filename} expands to the document name, so each document can own its images', () => {
		assert.equal(
			resolveImageDirectory('${filename}.assets', '/home/u/notes/trip.md'),
			'trip.assets',
		);
		assert.equal(
			resolveImageDirectory('${filename}.assets', 'C:\\notes\\trip.md'),
			'trip.assets',
		);
		// The extension comes off at the last dot; a leading dot is a name, not an
		// extension.
		assert.equal(resolveImageDirectory('${filename}', '/n/archive.tar.md'), 'archive.tar');
		assert.equal(resolveImageDirectory('${filename}', '/n/.gitignore'), '.gitignore');
		// No token, no expansion: the setting stays the literal folder name it has
		// always been, and an empty one still means the default.
		assert.equal(resolveImageDirectory('img', '/n/trip.md'), 'img');
		assert.equal(resolveImageDirectory('', '/n/trip.md'), DEFAULT_IMAGE_DIRECTORY);
	});

	test('a $ in the document name is not read as a replacement pattern', () => {
		// `String.replace` reads `$&` and `$'` in the *replacement* as the match and
		// the text after it, so a document named `$&.md` would have written the
		// literal token back out and created a folder called `${filename}.assets`.
		assert.equal(resolveImageDirectory('${filename}.assets', '/n/$&.md'), '$&.assets');
		assert.equal(resolveImageDirectory('${filename}', "/n/$'.md"), "$'");
	});
});

describe('editor colours against the stylesheet', () => {
	const styles = postcss.parse(readSource('src/styles.css'));

	/** A `--color-*` value from the top-level rule whose selector list is exactly `selector`. */
	function paletteColor(selector: string, name: string): string {
		let value: string | undefined;
		styles.each((node) => {
			if (value !== undefined || node.type !== 'rule' || node.selector !== selector) return;
			node.walkDecls(`--color-${name}`, (decl) => {
				value ??= decl.value;
			});
		});
		assert.ok(value, `styles.css must define --color-${name} under ${selector}`);
		assert.match(value, /^#[0-9a-fA-F]{6}$/);
		return value.slice(1).toLowerCase();
	}

	test('every construct colour the importer writes is read by the stylesheet', () => {
		// #676: the importer writes `--md-strong`, `styles.css` reads it, and no
		// type or import holds them together. Renaming one silently drops the colour.
		const readWithFallback = new Set<string>();
		styles.walkDecls((decl) => {
			for (const match of decl.value.matchAll(/var\(\s*(--[\w-]+)\s*,/g)) readWithFallback.add(match[1]);
		});
		for (const [kind, cssVar] of PREVIEW_KIND_VARS) {
			// The comma is the fallback. Without one, a construct the theme does not
			// name renders with no colour at all rather than with the value the rule
			// carried before the import.
			assert.ok(readWithFallback.has(cssVar), `${cssVar} is written for \`${kind}\` and read by no rule with a fallback`);
		}
	});
});
