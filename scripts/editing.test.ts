import assert from 'node:assert/strict';
import { after,before,describe,test } from 'node:test';


import { installShimDom,parseHtml } from './renderProtocolDom.ts';
import { DEFAULT_REFERENCE_STYLE,headingReference,headingSlug,preferredReferenceStyle,referenceForTab } from '../src/lib/utils/headingReference.js';
import { findSeedFromSelection,seedFindBar } from '../src/lib/utils/findSeed.js';
import { addFrontMatterListItems,getFrontMatterListItems,frontMatterFenceLines,getMarkdownBodyWithoutFrontMatter,parseFrontMatter,removeFrontMatterListItem,updateFrontMatterField,updateFrontMatterListItem } from '../src/lib/utils/frontMatter.js';
import { getMarkdownLinkTarget,hasMarkdownLinkExtension,resolveMarkdownTargetPath } from '../src/lib/utils/markdownLinks.js';

describe('callout marker', () => {
	// The shim globals are this block's alone: install them for its tests and put
	// back whatever was there before.
	const SHIM_GLOBALS = ['DOMParser', 'document', 'Node', 'NodeFilter'] as const;
	const saved = new Map<string, PropertyDescriptor | undefined>();
	let processMarkdownHtml: (typeof import('../src/lib/utils/markdown.ts'))['processMarkdownHtml'];
	before(async () => {
		for (const name of SHIM_GLOBALS) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		installShimDom();
		({ processMarkdownHtml } = await import('../src/lib/utils/markdown.ts'));
	});
	after(() => {
		for (const [name, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete (globalThis as Record<string, unknown>)[name];
		}
	});

	// Only the text a quote opens with can make it a callout, as in Obsidian and
	// GitHub. The marker used to be looked for in every text node of the quote, so
	// a `[!note]` shown in inline code, a code block or a nested quote turned the
	// whole quote into a callout and the matched text was deleted.

	function render(html: string) {
		return parseHtml(processMarkdownHtml(html, '/doc.md', new Set()));
	}

	test('a marker in inline code is text, not a callout', () => {
		const root = render('<blockquote>\n<p>Use <code>[!note]</code> to make a callout</p>\n</blockquote>');
		assert.equal(root.querySelector('.markdown-alert'), null);
		assert.equal(root.querySelector('code')?.textContent, '[!note]');
	});

	test('a marker at the top of a code block is text, not a callout', () => {
		const root = render('<blockquote>\n<pre><code>[!warning] Title\n</code></pre>\n</blockquote>');
		assert.equal(root.querySelector('.markdown-alert'), null);
		assert.equal(root.querySelector('code')?.textContent, '[!warning] Title\n');
	});

	test('a callout in a nested quote leaves the outer quote alone', () => {
		const root = render(
			'<blockquote>\n<p>Outer</p>\n<blockquote>\n<p>[!tip] Inner</p>\n</blockquote>\n</blockquote>',
		);
		const outer = root.querySelector('blockquote');
		assert.ok(outer, 'the outer quote is still a quote');
		assert.equal(outer.querySelector('p')?.textContent, 'Outer');
		const tip = outer.querySelector('.markdown-alert-tip');
		assert.ok(tip, 'the inner quote is the callout');
		assert.equal(tip.querySelector('.callout-title-inner')?.textContent, 'Inner');
	});

	test('a quote that opens with the marker is still a callout, fold and title included', () => {
		const root = render('<blockquote>\n<p>[!note]+ My title<br />\nbody</p>\n</blockquote>');
		const callout = root.querySelector('.markdown-alert-note');
		assert.ok(callout);
		assert.ok(callout.classList.contains('callout-foldable'));
		assert.equal(callout.querySelector('.callout-title-inner')?.textContent, 'My title');
		assert.match(callout.querySelector('.content-inner')?.textContent ?? '', /body/);
	});
});

/**
 * #200: "implement some function which slugify titles and purpose those as
 * #targets for URL of link".
 *
 * Half of it already worked — comrak renders an `id` onto every heading and
 * `[…](#that-id)` jumps to it — but nothing offered the ids, so writing one
 * meant doing comrak's anchorizer by hand: lowercase, drop the punctuation it
 * drops, hyphenate the spaces, and remember that a repeated heading is
 * numbered. Getting it wrong produces a link that looks right and lands
 * nowhere.
 *
 * The list comes from Rust, from the renderer's own parse and anchorizer
 * (`outline`, pinned against the rendered `id=` attributes in
 * `lib.rs`). What is asserted here is the other half: WHERE a heading is the
 * answer, and what gets written when it is — the two link syntaxes take
 * different text, which is the part that is easy to get backwards.
 */
describe('copy reference style', () => {
	/* ------------------------------------------------------ reading the document */

	test('a document that links one way gets another of the same', () => {
		assert.equal(
			preferredReferenceStyle('See [[Setup#Install]] for details.\n'),
			'wikilink',
		);
		assert.equal(
			preferredReferenceStyle('See [Install](setup.md#install) for details.\n'),
			'inline',
		);
		// A same-document anchor counts as well — it is the same spelling.
		assert.equal(preferredReferenceStyle('Back to [the top](#introduction).\n'), 'inline');
		// And a bare note link, which the renderer leaves literal, still says what
		// the writer's habit is.
		assert.equal(preferredReferenceStyle('See [[Setup]].\n'), 'wikilink');
	});

	test('silence and disagreement both fall back to what the menu always did', () => {
		assert.equal(DEFAULT_REFERENCE_STYLE, 'wikilink');
		assert.equal(preferredReferenceStyle(''), DEFAULT_REFERENCE_STYLE);
		assert.equal(preferredReferenceStyle('# A document\n\nWith no links at all.\n'), DEFAULT_REFERENCE_STYLE);
		assert.equal(
			preferredReferenceStyle('Both [[Setup#Install]] and [Install](setup.md#install).\n'),
			DEFAULT_REFERENCE_STYLE,
			'a document using both is not evidence of either',
		);
		// An ordinary link with no anchor is not evidence: every document has those.
		assert.equal(preferredReferenceStyle('See [the site](https://example.com).\n'), DEFAULT_REFERENCE_STYLE);
	});

	test('a document ABOUT markdown does not vote with its examples', () => {
		// `samples/stress-test.md` and this project's own notes are full of
		// both spellings inside fences. Counting those would make the syntax
		// documentation the loudest voice in every vault.
		const teaching = [
			'# Linking',
			'',
			'```markdown',
			'[[Setup#Install]]',
			'```',
			'',
			'Prose with [an anchor](setup.md#install) in it.',
			'',
		].join('\n');

		assert.equal(preferredReferenceStyle(teaching), 'inline', 'the fenced example must not count');

		const tildeFenced = '~~~md\n[[Setup#Install]]\n~~~\n\nSee [x](a.md#b).\n';
		assert.equal(preferredReferenceStyle(tildeFenced), 'inline', 'tilde fences too');
	});

	/* ------------------------------------------------------------ writing it out */

	test('each style is written the way its own resolver reads it', () => {
		const heading = { text: 'Setup', slug: 'setup', fileName: 'notes.md' as string | null };

		// The wikilink drops the extension — `process_wikilinks` appends `.md`
		// itself — and names the heading by its TEXT.
		assert.equal(headingReference({ ...heading, style: 'wikilink' }), '[[notes#Setup]]');
		// The CommonMark form keeps it, because that is how the frontend claims a
		// link for local navigation, and names the heading by its rendered id.
		assert.equal(headingReference({ ...heading, style: 'inline' }), '[Setup](notes.md#setup)');
	});

	test('the wikilink drops only an extension the renderer would add back', () => {
		// `process_wikilinks` appends `.md` to a target with no extension, so
		// `[[note#Setup]]` reaches `note.md` and never `note.markdown`.
		const reference = (fileName: string) =>
			headingReference({ text: 'Setup', slug: 'setup', fileName, style: 'wikilink' });
		assert.equal(reference('note.markdown'), '[[note.markdown#Setup]]');
		assert.equal(reference('notes.txt'), '[[notes.txt#Setup]]');
		// Left as `v1.2`, the target would read as having a `.2` extension.
		assert.equal(reference('v1.2.md'), '[[v1.2.md#Setup]]');
		assert.equal(reference('v1.2 spec.md'), '[[v1.2 spec#Setup]]');
	});

	test('an unsaved document has no file to name', () => {
		const heading = { text: 'Setup', slug: 'setup', fileName: null };
		assert.equal(headingReference({ ...heading, style: 'wikilink' }), '#Setup');
		assert.equal(headingReference({ ...heading, style: 'inline' }), '[Setup](#setup)');
	});

	test('the CommonMark form survives a filename with a space and a bracketed heading', () => {
		// `[Setup](my notes.md#setup)` stops at the space; `[Notes [draft](…)` ends
		// its label early. Neither can happen in the wikilink form, which is part
		// of why this only applies to one of them.
		assert.equal(
			headingReference({ text: 'Setup', slug: 'setup', fileName: 'my notes.md', style: 'inline' }),
			'[Setup](<my notes.md#setup>)',
		);
		assert.equal(
			headingReference({ text: 'Notes [draft', slug: 'notes-draft', fileName: null, style: 'inline' }),
			'[Notes \\[draft](#notes-draft)',
		);
	});

	test('a repeated heading is addressable, because the slug comes from the render', () => {
		// comrak numbers them; recomputing the id here would drift from that.
		assert.equal(
			headingReference({ text: 'Objectives', slug: 'objectives-1', fileName: 'n.md', style: 'inline' }),
			'[Objectives](n.md#objectives-1)',
		);
	});
});

describe('find seed', () => {
	/** A `Selection` as far as `findSeedFromSelection` is concerned. */
	function selecting(text: string, where: 'preview' | 'elsewhere' | 'caret' = 'preview') {
		const node = where === 'elsewhere' ? 'outside' : 'inside';
		return { isCollapsed: where === 'caret', anchorNode: node, focusNode: node, toString: () => text } as unknown as Selection;
	}

	/** The rendered document. `contains` is the only question the seed asks of it. */
	const preview = { contains: (node: unknown) => node === 'inside' } as unknown as Node;

	test('what Cmd/Ctrl+F starts from, given what is selected', () => {
		const seed = (s: Selection | null, root: Node | null = preview) => findSeedFromSelection(s, root);

		assert.equal(seed(selecting('deterministic')), 'deterministic');
		// Across `**bold**`, a link or inline code the selection spans several text
		// nodes; reading only one would leave the feature off in the commonest case.
		assert.equal(seed(selecting('bold word')), 'bold word');
		assert.equal(seed(selecting('  spaced  ')), 'spaced', 'a double-click drags the trailing space in');

		// Empty means "leave the box alone" — a repeated Cmd/Ctrl+F re-focuses the
		// previous query (#559) rather than wiping it.
		assert.equal(seed(selecting('first\nsecond')), '', 'multi-line: Monaco’s rule in the other pane');
		assert.equal(seed(selecting('   ')), '', 'whitespace only');
		assert.equal(seed(selecting('x', 'caret')), '', 'a caret with nothing selected');
		assert.equal(seed(selecting('x', 'elsewhere')), '', 'selected in a modal or the tab strip');
		assert.equal(seed(null), '', 'no selection');
		assert.equal(seed(selecting('x'), null), '', 'no preview on screen');
	});

	test('the seed is wired to the find bar', () => {
		const queries: string[] = [];
		const bar = { setQuery: (value: string) => void queries.push(value) };

		seedFindBar(bar, selecting('deterministic'), preview);
		// Nothing to seed leaves the previous query alone.
		seedFindBar(bar, selecting('x', 'caret'), preview);
		seedFindBar(null, selecting('no bar yet'), preview);

		assert.deepEqual(queries, ['deterministic']);
	});
});

describe('front matter parsing and editing', () => {
	const planMarkdown = `---
type: plan
name: dflex-logger-onoff-dir-synlog
title: "Sterowanie loggerami dFLEX: on/off domyslnie OFF"
project: "dflex"
keywords: [logger, synlog, appconfig, onoff, codesite]
created: 2026-06-26T18:29:35+02:00
status: in-progress
---

## Summary

Body text.
`;

	test('parseFrontMatter extracts top-level YAML metadata and body', () => {
		const parsed = parseFrontMatter(planMarkdown);

		assert.equal(parsed.exists, true);
		assert.equal(parsed.valid, true);
		assert.equal(parsed.body, '## Summary\n\nBody text.\n');
		assert.deepEqual(
			parsed.fields.map((field) => [field.key, field.kind, field.displayValue]),
			[
				['type', 'string', 'plan'],
				['name', 'string', 'dflex-logger-onoff-dir-synlog'],
				['title', 'string', 'Sterowanie loggerami dFLEX: on/off domyslnie OFF'],
				['project', 'string', 'dflex'],
				['keywords', 'list', 'logger, synlog, appconfig, onoff, codesite'],
				['created', 'string', '2026-06-26T18:29:35+02:00'],
				['status', 'string', 'in-progress'],
			],
		);
	});

	test('parseFrontMatter ignores thematic breaks outside the first document line', () => {
		const markdown = `# Title

---

Body`;
		const parsed = parseFrontMatter(markdown);

		assert.equal(parsed.exists, false);
		assert.equal(parsed.body, markdown);
		assert.equal(getMarkdownBodyWithoutFrontMatter(markdown), markdown);
	});

	test('parseFrontMatter strips invalid front matter from rendered body but keeps the error', () => {
		const parsed = parseFrontMatter(`---
title: [broken
---

# Body
`);

		assert.equal(parsed.exists, true);
		assert.equal(parsed.valid, false);
		assert.match(parsed.error || '', /Flow sequence|unexpected|end/i);
		assert.equal(parsed.body, '# Body\n');
		assert.deepEqual(parsed.fields, []);
	});

	test('updateFrontMatterField updates one property without changing markdown body', () => {
		const updated = updateFrontMatterField(planMarkdown, 'status', 'done');
		const parsed = parseFrontMatter(updated);

		assert.equal(parsed.exists, true);
		assert.equal(parsed.valid, true);
		assert.equal(parsed.fields.find((field) => field.key === 'status')?.displayValue, 'done');
		assert.equal(parsed.body, '## Summary\n\nBody text.\n');
	});

	test('updateFrontMatterField preserves CRLF documents', () => {
		const markdown = '---\r\nname: old\r\ntags:\r\n  - one\r\n---\r\n\r\nText\r\n';
		const updated = updateFrontMatterField(markdown, 'name', 'new');

		assert.match(updated, /^---\r\nname: new\r\ntags:/);
		assert.equal(parseFrontMatter(updated).body, 'Text\r\n');
	});

	test('getFrontMatterListItems returns string tag values for YAML lists', () => {
		const parsed = parseFrontMatter(planMarkdown);
		const keywords = parsed.fields.find((field) => field.key === 'keywords');

		assert.ok(keywords);
		assert.deepEqual(getFrontMatterListItems(keywords), ['logger', 'synlog', 'appconfig', 'onoff', 'codesite']);
	});

	test('front matter tag helpers add, edit, and remove tags predictably', () => {
		const original = ['logger', 'synlog'];

		assert.deepEqual(addFrontMatterListItems(original, [' appconfig ']), ['logger', 'synlog', 'appconfig']);
		assert.deepEqual(addFrontMatterListItems(original, ['logger']), ['logger', 'synlog']);
		assert.deepEqual(addFrontMatterListItems(original, [' ', 'synlog', 'codesite, onoff']), ['logger', 'synlog', 'codesite', 'onoff']);
		assert.deepEqual(updateFrontMatterListItem(original, 1, ' syslog '), ['logger', 'syslog']);
		assert.deepEqual(updateFrontMatterListItem(original, 1, 'logger'), ['logger', 'synlog']);
		assert.deepEqual(updateFrontMatterListItem(original, 1, ' '), ['logger', 'synlog']);
		assert.deepEqual(removeFrontMatterListItem(original, 0), ['synlog']);
	});

	test('updateFrontMatterField writes edited keywords as a YAML list', () => {
		const updated = updateFrontMatterField(planMarkdown, 'keywords', ['logger', 'synlog']);
		const parsed = parseFrontMatter(updated);
		const keywords = parsed.fields.find((field) => field.key === 'keywords');

		assert.ok(keywords);
		assert.deepEqual(getFrontMatterListItems(keywords), ['logger', 'synlog']);
		assert.equal(parsed.body, '## Summary\n\nBody text.\n');
	});
});

describe('front matter versus a prose block', () => {
	// A document may open with a thematic break and then use a setext underline for
	// its first heading. That looks exactly like a front matter block, but the text
	// between the rules is prose, not metadata, so it has to survive into the body.
	const proseBetweenRules = `---
Lead paragraph
---

Body starts here.
`;

	test('a leading --- block that is not a YAML mapping stays in the rendered body', () => {
		const parsed = parseFrontMatter(proseBetweenRules);

		assert.equal(parsed.exists, false);
		assert.equal(parsed.valid, true);
		assert.equal(parsed.raw, '');
		assert.deepEqual(parsed.fields, []);
		assert.deepEqual(parsed.data, {});
		assert.equal(parsed.body, proseBetweenRules);
		assert.equal(getMarkdownBodyWithoutFrontMatter(proseBetweenRules), proseBetweenRules);
	});

	test('prose that spans several lines between the rules is not swallowed either', () => {
		const markdown = '---\nline one\nline two\n---\n\nBody\n';
		const parsed = parseFrontMatter(markdown);

		assert.equal(parsed.exists, false);
		assert.equal(parsed.body, markdown);
	});

	test('a leading --- block holding a bare YAML sequence is not metadata', () => {
		const markdown = '---\n- one\n- two\n---\n\nBody\n';
		const parsed = parseFrontMatter(markdown);

		assert.equal(parsed.exists, false);
		assert.equal(parsed.body, markdown);
	});

	test('front matter that is a mapping keeps working, including empty and string-valued ones', () => {
		const empty = parseFrontMatter('---\n---\n\nBody\n');
		assert.equal(empty.exists, true);
		assert.equal(empty.valid, true);
		assert.deepEqual(empty.fields, []);
		assert.equal(empty.body, 'Body\n');

		const blank = parseFrontMatter('---\n\n---\n\nBody\n');
		assert.equal(blank.exists, true);
		assert.equal(blank.body, 'Body\n');

		const stringValued = parseFrontMatter('---\ntitle: hello\n---\n\nBody\n');
		assert.equal(stringValued.exists, true);
		assert.equal(stringValued.valid, true);
		assert.deepEqual(
			stringValued.fields.map((field) => [field.key, field.kind, field.displayValue]),
			[['title', 'string', 'hello']],
		);
		assert.equal(stringValued.body, 'Body\n');

		const crlf = parseFrontMatter('---\r\ntitle: hello\r\n---\r\n\r\nBody\r\n');
		assert.equal(crlf.exists, true);
		assert.equal(crlf.body, 'Body\r\n');
	});

	test('a malformed mapping is still reported as broken front matter rather than body', () => {
		const parsed = parseFrontMatter('---\ntitle: [broken\n---\n\n# Body\n');

		assert.equal(parsed.exists, true);
		assert.equal(parsed.valid, false);
		assert.equal(parsed.body, '# Body\n');
	});

	test('an unresolved alias in the block is broken front matter, not an exception', () => {
		const parsed = parseFrontMatter('---\n**bold**\n---\n\n# Body\n');

		assert.equal(parsed.exists, true);
		assert.equal(parsed.valid, false);
		assert.match(parsed.error ?? '', /alias/i);
		assert.equal(parsed.body, '# Body\n');
	});

	// The editor's analyses (headings, folds, colours) run in Rust on the whole
	// buffer and blank the front matter lines first, so the closing `---` does not
	// underline the YAML into a heading. Rust used to find those lines itself, with
	// any two leading `---` lines, and blanked a thematic break plus the prose
	// under it that the preview renders. Now it is told, by the same rule.
	test('the front matter line count includes both fences', async (t) => {
		assert.equal(frontMatterFenceLines('---\n\n# Title\n\nSome intro text.\n\n---\n\n## Part 2\n'), 0);
		assert.equal(frontMatterFenceLines('# Plain\n'), 0);
		assert.equal(frontMatterFenceLines('---\ntitle: x\ntags: [a]\n---\n\n# Body\n'), 4);
		assert.equal(frontMatterFenceLines('\uFEFF--- \r\ntitle: x\r\n  ---\r\n# Body\r\n'), 3);
		assert.equal(frontMatterFenceLines('---\n---\n'), 2);
		// No newline after the closing fence: it is still one of the lines.
		assert.equal(frontMatterFenceLines('---\ntitle: x\n---'), 3);
		// Malformed is still front matter: the preview strips it too.
		assert.equal(frontMatterFenceLines('---\ntitle: [broken\n---\n'), 3);

	});
});

// `[[Notes#Setup]]` — the exact string the "Copy Reference" context-menu item
// writes to the clipboard — used to render as literal text: the Rust
// preprocessor only understood the same-document form `[[#Setup]]`. It now
// emits a plain markdown link, and these tests pin the *shape* of the href it
// emits against the frontend that has to claim it. The Rust side owns the
// other half of this contract in src-tauri/src/lib.rs (`copy_reference_output_
// becomes_a_real_link` and friends); if either half moves, the other fails.
//
// Scope: only the heading-bearing forms (`[[#h]]`, `[[file#h]]`, and their
// `|alias` variants) are rewritten. Obsidian's bare note link `[[Notes]]` is
// a separate feature, not this defect, and is left literal.
//
// Not covered here: whether the file exists, and the actual tab-opening (that
// runs inside MarkdownViewer.svelte and needs a live webview). These tests
// only prove the href is recognized as a local markdown target and decodes
// back to the path and anchor the document asked for.
describe('wikilink file targets', () => {
	// href values as produced by process_wikilinks() in src-tauri/src/lib.rs.
	// Only the heading-bearing forms appear: a wikilink with no `#` is
	// deliberately left as literal text and never reaches the frontend at all.
	const cases: { wikilink: string; href: string; path: string; hash: string }[] = [
		{ wikilink: '[[Notes#Setup]]', href: 'Notes.md#setup', path: 'Notes.md', hash: 'setup' },
		{ wikilink: '[[docs/Guide#Setup]]', href: 'docs/Guide.md#setup', path: 'docs/Guide.md', hash: 'setup' },
		{ wikilink: '[[docs/Guide#1. 概述|Overview]]', href: 'docs/Guide.md#1-概述', path: 'docs/Guide.md', hash: '1-概述' },
		{ wikilink: '[[My Notes (v2)#Setup]]', href: 'My%20Notes%20%28v2%29.md#setup', path: 'My Notes (v2).md', hash: 'setup' },
		{ wikilink: '[[Notes#^abc123]]', href: 'Notes.md#abc123', path: 'Notes.md', hash: 'abc123' },
		{ wikilink: '[[log.txt#Errors]]', href: 'log.txt#errors', path: 'log.txt', hash: 'errors' },
	];

	test('every href the wikilink rewriter emits is claimed as a local markdown target', () => {
		for (const { wikilink, href, path, hash } of cases) {
			const target = getMarkdownLinkTarget(href);
			assert.notEqual(target, null, `${wikilink} -> ${href} was not claimed as a markdown link`);
			assert.equal(target?.path, path, `${wikilink} resolved to the wrong path`);
			assert.equal(target?.hash, hash, `${wikilink} resolved to the wrong anchor`);
		}
	});

	test('a bare note name without the appended extension would not be claimed', () => {
		// This is why the rewriter appends ".md": Obsidian omits the extension,
		// but getMarkdownLinkTarget() keys entirely off it, and an unclaimed href
		// falls through to the external-URL opener instead of opening a tab.
		assert.equal(hasMarkdownLinkExtension('Notes'), false);
		assert.equal(getMarkdownLinkTarget('Notes#setup'), null);
	});

	test('wikilink targets resolve relative to the document that contains them', () => {
		const target = getMarkdownLinkTarget('docs/Guide.md#1-概述');
		assert.notEqual(target, null);
		assert.equal(resolveMarkdownTargetPath('/vault/index.md', target!), '/vault/docs/Guide.md');
	});

	test('non-markdown wikilink targets are left literal rather than emitted as links', () => {
		// The rewriter declines these (`wikilinks_to_files_the_viewer_cannot_open_
		// stay_literal`); this asserts the reason — the frontend would not claim
		// them either.
		assert.equal(getMarkdownLinkTarget('report.pdf#Intro'), null);
		assert.equal(getMarkdownLinkTarget('diagram.svg#part'), null);
	});
});

describe('copy reference wiring', () => {
	test('every Copy Reference entry writes the spelling the buffer is written in', () => {
		// The preview's heading menu, the outline's right-click and the outline's
		// context menu all build the string here. They built it inline before,
		// which is how they came to disagree about the filename.
		const inline = { path: 'C:\\notes\\setup.md', rawContent: 'See [Install](other.md#install).\n' };
		assert.equal(referenceForTab('Setup', 'setup', inline), '[Setup](setup.md#setup)');
		// The buffer, not the file on disk: an unsaved edit already counts.
		assert.equal(referenceForTab('Setup', 'setup', { ...inline, rawContent: 'See [[Other#Install]].\n' }), '[[setup#Setup]]');
		assert.equal(referenceForTab('Setup', 'setup', { path: null, rawContent: '' }), '#Setup');
		assert.equal(referenceForTab('Setup', 'setup', undefined), '#Setup');
	});

	test('the id is taken off the rendered element rather than recomputed', () => {
		// comrak can put it on an anchor nested inside the heading.
		const anchor = { id: 'setup-1' };
		const heading = (id: string) =>
			({ id, querySelector: (selector: string) => (selector === 'a.anchor' ? anchor : null) }) as unknown as Element;
		assert.equal(headingSlug(heading('setup')), 'setup');
		assert.equal(headingSlug(heading('')), 'setup-1');
	});
});
