import { commands } from '../bindings.js';
import { routeDroppedFile } from '../utils/fileDrop.js';
import { documentParentDir, imageEmbed, resolveImageDirectory } from '../utils/imageEmbed.js';
import type { LiveEditor } from './editor.js';

export async function writeSelection(editor: LiveEditor, cut: boolean) {
	const state = editor.view.state;
	const { selection, doc } = state;
	let { from, to } = selection;
	let text = editor.selectedMarkdown();
	if (selection.empty && selection.$from.parent.isTextblock) {
		const block = selection.$from.parent;
		const offset = selection.$from.parentOffset;
		const inlineText = block.textBetween(0, block.content.size, '\n', node => node.type.name === 'hardbreak' ? '\n' : '\uFFFC');
		const left = inlineText.slice(0, offset);
		const start = Math.max(left.lastIndexOf('\n'), left.lastIndexOf('\r')) + 1;
		const ending = /\r\n|[\r\n]/.exec(inlineText.slice(offset));
		const end = ending ? offset + ending.index + ending[0].length : inlineText.length;
		from = selection.$from.start() + start;
		to = selection.$from.start() + end;
		text = doc.textBetween(from, to, '\n', node => node.type.name === 'hardbreak' ? '\n' : node.attrs.alt ?? '');
	}
	if (!text) return;
	await commands.clipboardWriteText(text);
	if (cut && editor.host?.editable() && state === editor.view.state) editor.view.dispatch(state.tr.deleteRange(from, to));
}

export async function embedFile(file: string, path: string, imageDirectory: string): Promise<string> {
	const dir = documentParentDir(path);
	if (dir == null) return '![](' + await commands.readFileAsDataUrl(file) + ')';
	return imageEmbed(await commands.copyFileToImg(file, dir, resolveImageDirectory(imageDirectory, path)));
}

export async function clipboardMarkdown(path: string, imageDirectory: string, scale: boolean): Promise<string> {
	const files = await commands.clipboardReadFileList().catch(() => []);
	const embeds: string[] = [];
	for (const file of files) {
		if (routeDroppedFile(file, 'editor') === 'insert') embeds.push(await embedFile(file, path, imageDirectory));
	}
	if (embeds.length) return embeds.join('\n');
	const pixels = await commands.clipboardReadImage(scale).catch(() => null);
	if (!pixels) return commands.clipboardReadText();
	const dir = documentParentDir(path);
	if (dir == null) return '![](data:image/png;base64,' + pixels + ')';
	return imageEmbed(await commands.saveImage(dir, 'paste_' + Date.now() + '.png', pixels, resolveImageDirectory(imageDirectory, path)));
}
