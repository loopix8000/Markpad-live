import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { closeHistory } from '@milkdown/kit/prose/history';
import { textblockTypeInputRule } from '@milkdown/kit/prose/inputrules';
import { TextSelection, type Command } from '@milkdown/kit/prose/state';
import { $inputRule } from '@milkdown/kit/utils';

// 직접 연 펜스만 Enter로 닫는다. 기존 문서의 코드 예제에 들어 있는 백틱은 본문으로 보존한다.
export const editableFenceSchema = codeBlockSchema.extendSchema(base => ctx => {
	const spec = base(ctx);
	return { ...spec, attrs: { ...spec.attrs, inputFence: { default: null } } };
});

export const openCodeFence = $inputRule(ctx => textblockTypeInputRule(
	/^ {0,3}(`{3,}|~{3,})([\w+.#-]*)[ \n]$/,
	codeBlockSchema.type(ctx),
	match => ({ inputFence: match[1], language: match[2] }),
));

export const closeCodeFence: Command = (state, dispatch) => {
	const { $from, empty } = state.selection;
	const block = $from.parent;
	const fence = block.attrs.inputFence;
	if (!empty || block.type !== state.schema.nodes.code_block || typeof fence !== 'string' ||
		$from.parentOffset !== block.content.size) return false;

	const text = block.textContent;
	const newline = text.lastIndexOf('\n');
	const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text.slice(newline + 1))?.[1];
	if (!closing?.startsWith(fence)) return false;
	const paragraph = state.schema.nodes.paragraph;
	const index = $from.indexAfter(-1);
	if (!$from.node(-1).canReplaceWith(index, index, paragraph)) return false;

	if (dispatch) {
		const tr = closeHistory(state.tr).delete($from.start() + Math.max(0, newline), $from.pos);
		const after = tr.mapping.map($from.after());
		tr.setNodeAttribute($from.before(), 'inputFence', null);
		tr.insert(after, paragraph.create());
		dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
	}
	return true;
};
