import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { commands } from '../src/lib/bindings.js';
import { clipboardMarkdown, embedFile, writeSelection } from '../src/lib/live/clipboard.js';
import { openLiveEditor, type LiveEditor } from '../src/lib/live/editor.js';
import { retainLiveEditors } from '../src/lib/live/tabs.js';

const open: LiveEditor[] = [];
async function edit(id: string, text: string, literal = false) {
	const editor = await openLiveEditor(id);
	document.body.append(editor.root);
	editor.host = { editable: () => true, path: () => '', changed: () => {}, cursor: () => {}, command: id => editor.action(id) };
	editor.load(text,literal,'');
	open.push(editor);
	return editor;
}
afterEach(() => {
	vi.restoreAllMocks();
	for (const e of open.splice(0)) e.root.remove();
	retainLiveEditors([]);
});

test('a new or cleared Markdown tab starts in a paragraph and accepts toolbar formatting', async () => {
	const e = await edit('untitled', '');
	const { schema } = e.view.state;
	assert.equal(schema.topNodeType.contentMatch.defaultType?.name, 'paragraph');
	assert.equal(e.view.state.selection.$from.parent.type.name, 'paragraph');
	e.view.dispatch(e.view.state.tr.insertText('본문'));
	e.select(1, 3);
	e.action('fmt-bold');
	assert.equal(e.view.dom.querySelector('p > strong')?.textContent, '본문');
	assert.equal(e.source.text, '**본문**');
	e.action('selectAll');
	e.view.dispatch(e.view.state.tr.deleteSelection());
	assert.equal(e.view.state.selection.$from.parent.type.name, 'paragraph');
});

function enter(e: LiveEditor) {
	const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
	e.view.dom.dispatchEvent(event);
	assert.ok(event.defaultPrevented);
}

test('a fence typed between two ordinary paragraphs produces an editable code block', async () => {
	const e = await edit('typed-fence', '');
	e.view.dispatch(e.view.state.tr.insertText('??'));
	enter(e);
	e.view.dispatch(e.view.state.tr.insertText('```js'));
	enter(e);
	assert.equal(e.view.state.selection.$from.parent.type.name, 'code_block');
	e.view.dispatch(e.view.state.tr.insertText('asdasd'));
	enter(e);
	e.view.dispatch(e.view.state.tr.insertText('```'));
	enter(e);
	e.view.dispatch(e.view.state.tr.insertText('다음 문단'));
	assert.deepEqual(Array.from(e.view.dom.children, n => [n.tagName, n.textContent]), [
		['P', '??'], ['PRE', 'asdasd'], ['P', '다음 문단'],
	]);
	assert.equal(e.view.dom.querySelector('pre')?.dataset.language, 'js');
	const reopened = await edit('typed-reopened', e.source.text);
	assert.equal(reopened.view.dom.querySelector('pre > code')?.textContent, 'asdasd');
	assert.equal(reopened.view.dom.querySelectorAll('p').length, 2);
});

test('pasting a fenced block retains the code wrapper even when the selection is in prose', async () => {
	const e = await edit('paste-fence', '앞뒤');
	e.select(2);
	e.insert('```\nasdasd\n```');
	assert.deepEqual(Array.from(e.view.dom.children, n => [n.tagName, n.textContent]), [
		['P', '앞'], ['PRE', 'asdasd'], ['P', '뒤'],
	]);
});

test('pasting prose and fenced Markdown into a blank tab shows both blocks', async () => {
	const e = await edit('paste-document', '');
	e.insert('??\n\n```\nasdasd\n```');
	assert.deepEqual(Array.from(e.view.dom.children, node => [node.tagName, node.textContent]), [
		['P', '??'], ['PRE', 'asdasd'],
	]);
	e.select(2);
	e.insert('**사이**');
	assert.equal(e.view.dom.querySelector('p')?.textContent, '?사이?');
	assert.equal(e.view.dom.querySelector('p > strong')?.textContent, '사이');
});

test('a shorter fence inside a code example remains literal', async () => {
	const e = await edit('long-fence', '');
	e.view.dispatch(e.view.state.tr.insertText('````md'));
	enter(e);
	e.view.dispatch(e.view.state.tr.insertText('```'));
	enter(e);
	assert.equal(e.view.state.selection.$from.parent.type.name, 'code_block');
	e.view.dispatch(e.view.state.tr.insertText('````'));
	enter(e);
	assert.equal(e.view.dom.querySelector('pre > code')?.textContent, '```');
	assert.equal(e.view.state.selection.$from.parent.type.name, 'paragraph');
});

test('edits rendered Markdown and preserves the other source blocks and CRLFs through undo, redo and reopen', async () => {
	const raw = '\uFEFF---\r\ntitle: 원문\r\n---\r\n\r\nSetext\r\n======\r\n\r\n수정\r\n\r\n*  __굵게__\r\n\r\n[x][REF]\r\n\r\n[REF]: <a.md> "title"\r\n\r\n> [!NOTE]\r\n> [[위키]]\r\n';
	const e = await edit('a',raw);
	assert.equal(e.source.text,raw);
	assert.equal(e.view.dom.querySelector('h1')?.textContent,'Setext');
	assert.equal(e.view.dom.querySelector('strong')?.textContent,'굵게');
	const pos = e.position(8);
	e.view.dispatch(e.view.state.tr.insertText('한글 ',pos));
	const edited = raw.replace('수정','한글 수정');
	assert.equal(e.source.text,edited);
	await edit('b','다른 탭');
	assert.equal(await openLiveEditor('a'),e);
	e.action('undo');
	assert.equal(e.source.text,raw);
	e.action('redo');
	assert.equal(e.source.text,edited);
	const reopened = await edit('c',edited);
	assert.equal(reopened.source.text,edited);
	assert.equal(reopened.view.state.doc.textContent,e.view.state.doc.textContent);
});
test('GFM editing, raw extensions, clipboard insertion and external replacement', async () => {
	const e = await edit('a','- [x] 작업\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n$x$\n\n~~~mermaid\ngraph LR\n~~~\n\n각주[^1]\n\n[^1]: 주석');
	assert.ok(e.view.dom.querySelector('table'));
	assert.equal(e.view.dom.querySelector('input')?.checked,true);
	assert.ok(e.view.dom.textContent?.includes('$x$'));
	const checkbox = e.view.dom.querySelector('input')!;
	checkbox.click();
	assert.match(e.source.text,/\[ \] 작업/);
	e.load('새 문서',false,'');
	e.action('undo');
	assert.equal(e.source.text,'새 문서');
	e.select(1,5);
	e.action('fmt-bold');
	assert.match(e.source.text,/\*\*새 문서\*\*/);
	e.insert('![그림](https://example.com/photo.png)');
	assert.ok(e.view.dom.querySelector('img'));
});
test('a literal document keeps markup as text and read-only transactions cannot change it', async () => {
	const e = await edit('x','const a = "**x**";\r\n',true);
	assert.equal(e.view.dom.querySelector('strong'),null);
	const raw = e.source.text;
	e.host!.editable = () => false;
	e.view.dispatch(e.view.state.tr.insertText('x',1));
	assert.equal(e.source.text,raw);
});
test('a document over one megabyte retains unedited blocks on the last paragraph edit', { timeout: 30000 }, async () => {
	const body = ' 한글과 Latin 문장을 함께 편집합니다.'.repeat(10);
	const blocks = Array.from({length:3000},(_,i) => '문단 ' + i + body + ' __강조__');
	const source = blocks.join('\n\n');
	assert.ok(new TextEncoder().encode(source).byteLength > 1_000_000);
	const e = await edit('large',source);
	const pos = e.position(5999);
	e.view.dispatch(e.view.state.tr.insertText('끝 ',pos));
	const unchanged = source.slice(0,source.lastIndexOf('문단 2999'));
	assert.equal(e.source.text.slice(0,unchanged.length),unchanged);
	assert.ok(e.source.text.includes('끝 문단 2999'));
});

test('toolbar commands operate on the rendered selection and underline survives reopen', async () => {
	const e = await edit('format','내용');
	e.select(1,3);
	e.action('fmt-underline');
	assert.equal(e.source.text,'<u>내용</u>');
	const copy = await edit('again',e.source.text);
	assert.equal(copy.view.dom.querySelector('u')?.textContent,'내용');
	for (const [action,selector] of [
		['fmt-heading-2','h2'], ['fmt-italic','em'], ['fmt-strikethrough','del,s'],
		['fmt-inline-code','code'], ['fmt-code-block','pre'], ['fmt-quote','blockquote'],
		['fmt-numbered-list','ol'], ['fmt-bullet-list','ul'], ['fmt-checklist','input[type=checkbox]'],
		['insert-table-simple','table'],
	]) {
		e.load('새 단락',false,'');
		e.select(1,5);
		e.action(action);
		assert.ok(e.view.dom.querySelector(selector),action);
	}
});
test('source editing exposes original spelling and allows entering extension syntax', async () => {
	const e = await edit('raw','제목\n====\n\n내용');
	e.select(1);
	e.action('edit-source');
	assert.equal(e.view.dom.querySelector('.source-block')?.textContent,'제목\n====');
	assert.equal(e.source.text,'제목\n====\n\n내용');
	e.select(1,8);
	e.insert('[[다른 노트]]');
	assert.equal(e.source.text,'[[다른 노트]]\n\n내용');
});

test('pasted and dropped images use the document directory or embed bytes in an untitled note', async () => {
	vi.spyOn(commands,'clipboardReadFileList').mockResolvedValue([]);
	vi.spyOn(commands,'clipboardReadImage').mockResolvedValue('cGl4ZWxz');
	const save = vi.spyOn(commands,'saveImage').mockResolvedValue('note.assets/붙여 넣기.png');
	assert.equal(await clipboardMarkdown('/notes/note.md','${filename}.assets',false),'![alt](note.assets/붙여%20넣기.png)');
	assert.equal(save.mock.calls[0][0],'/notes');
	assert.equal(save.mock.calls[0][3],'note.assets');
	assert.equal(await clipboardMarkdown('','img',false),'![](data:image/png;base64,cGl4ZWxz)');
	const copy = vi.spyOn(commands,'copyFileToImg').mockResolvedValue('img/new.png');
	assert.equal(await embedFile('/photos/new.png','/notes/note.md','img'),'![alt](img/new.png)');
	assert.deepEqual(copy.mock.calls[0],['/photos/new.png','/notes','img']);
});
test('cut waits for the clipboard write and never removes content from a reloaded document', async () => {
	const e = await edit('cut','first');
	e.select(1,6);
	let finish!: () => void;
	vi.spyOn(commands,'clipboardWriteText').mockImplementation(() => new Promise(resolve => { finish = () => resolve(null); }));
	const pending = writeSelection(e,true);
	e.load('second',false,'');
	finish();
	await pending;
	assert.equal(e.source.text,'second');
});

test('literal editing keeps mixed line endings and Markdown punctuation across select-all and paste', async () => {
	const e = await edit('literal','a\r\nb\nc',true);
	e.view.dispatch(e.view.state.tr.insertText('!',2));
	assert.equal(e.source.text,'a!\r\nb\nc');
	e.action('fmt-heading-1');
	assert.equal(e.source.text,'a!\r\nb\nc');
	e.action('selectAll');
	e.insert('# plain **text**');
	assert.equal(e.source.text,'# plain **text**');
});

test('cut at a caret inside multiline source removes only the current line', async () => {
	const e = await edit('cut-line','first\r\nsecond\r\nthird',true);
	e.select(9);
	const write = vi.spyOn(commands,'clipboardWriteText').mockResolvedValue(null);
	await writeSelection(e,true);
	assert.deepEqual(write.mock.calls,[['second\r\n']]);
	assert.equal(e.source.text,'first\r\nthird');
});

test('live and source surfaces share Markdown while keeping independent editable selections', async () => {
	const live = await edit('shared','');
	const source = await openLiveEditor('shared','source');
	document.body.append(source.root);
	open.push(source);
	source.host = { ...live.host!, changed: text => live.load(text,false,'') };
	live.host!.changed = text => source.load(text,true,'');
	source.load('',true,'');
	live.view.dispatch(live.view.state.tr.insertText('제목'));
	live.action('fmt-heading-1');
	assert.equal(source.view.state.doc.textContent, '# 제목');
	assert.equal(source.view.dom.querySelector('h1'),null);
	source.action('selectAll');
	source.insert('## 원문\n\n**강조**');
	assert.equal(live.view.dom.querySelector('h2')?.textContent,'원문');
	assert.equal(live.view.dom.querySelector('strong')?.textContent,'강조');
	source.action('undo');
	assert.equal(live.view.dom.querySelector('h1')?.textContent,'제목');
	source.action('redo');
	assert.equal(live.source.text,'## 원문\n\n**강조**');
	assert.equal(await openLiveEditor('shared','source'),source);
});

function doubleClickCode(e: LiveEditor, pos: number, target: Element) {
	const event = new MouseEvent('dblclick');
	Object.defineProperty(event, 'target', { value: target });
	return e.view.someProp('handleDoubleClick', f => f(e.view, pos, event));
}

test('double-clicking inline code selects the whole code span instead of one word', async () => {
	const e = await edit('dblclick-code', '앞 `/DATA/nfa/assets/css` 뒤');
	const code = e.view.dom.querySelector('code')!;
	const start = 3;
	const end = start + '/DATA/nfa/assets/css'.length;
	for (const pos of [start, start + 7, end]) {
		assert.ok(doubleClickCode(e, pos, code), String(pos));
		assert.deepEqual([e.view.state.selection.from, e.view.state.selection.to], [start, end]);
		assert.equal(e.selectedMarkdown(), '/DATA/nfa/assets/css');
	}
	e.select(1);
	assert.ok(!doubleClickCode(e, 1, e.view.dom.querySelector('p')!));
	assert.equal(e.view.state.selection.from, 1);
});

// 예전에는 두 번째 mousedown에서 ProseMirror가 단어 하나(`complaint`)를 먼저 선택하고,
// 코드 전체 선택은 mouseup에서야 이뤄져 선택이 한 박자 늦게 넓어졌다.
test('the second mousedown of a double-click selects the whole inline code before the button is released', async () => {
	const e = await edit('dblclick-code-down', '앞 `/nfa/communication/complaint/template` 뒤');
	const code = e.view.dom.querySelector('code')!;
	const start = 3;
	const end = start + '/nfa/communication/complaint/template'.length;
	const inside = start + '/nfa/communication/'.length + 2;
	vi.spyOn(e.view, 'posAtCoords').mockReturnValue({ pos: inside, inside: -1, affinity: 0 });
	// jsdom에는 레이아웃이 없어서 ProseMirror가 선택을 화면에 스크롤할 때 쓰는 좌표도 고정한다.
	vi.spyOn(e.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
	for (const detail of [1, 2])
		code.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail, clientX: 10, clientY: 10 }));
	await Promise.resolve();
	assert.deepEqual([e.view.state.selection.from, e.view.state.selection.to], [start, end]);
	window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});

// 예전에는 작업 목록 안의 인라인 코드를 골라 복사하면 `* [ ] ` 표시와 백틱까지 함께 복사됐다.
test('copying text chosen inside inline code copies only that text, without backticks or list markers', async () => {
	const path = '/DATA/nfa/nfa.war/nfa/communication/complaint/template';
	const e = await edit('copy-code', `* [ ] \`${path}\` 뒤`);
	let start = 0;
	e.view.state.doc.descendants((node, pos) => { if (node.isText && node.text === path) start = pos; });
	assert.ok(doubleClickCode(e, start + 3, e.view.dom.querySelector('code')!));
	const write = vi.spyOn(commands, 'clipboardWriteText').mockResolvedValue(null);
	await writeSelection(e, false);
	assert.deepEqual(write.mock.calls, [[path]]);
	e.select(start + 1, start + 5);
	assert.equal(e.selectedMarkdown(), path.slice(1, 5));
	e.select(start, start + path.length + 2);
	assert.equal(e.selectedMarkdown(), `\`${path}\` 뒤`.slice(0, path.length + 4));
});
