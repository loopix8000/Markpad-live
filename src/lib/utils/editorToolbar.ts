import { shortcutLabel } from './shortcuts.js';
import { applyMove, getAdjacentMove, getReorderMove, type ToolbarMove } from './toolbarMove.js';
import type { TranslationKey } from './i18n.js';

type EditorToolbarGroup = 'inline' | 'block' | 'list' | 'insert';

export type EditorToolbarTool = {
	id: string;
	label: string;
	/** The app menu's i18n key for this command, so the toolbar names it the same way. */
	labelKey: TranslationKey;
	shortcut?: (modifier: 'Ctrl' | 'Cmd') => string;
	group: EditorToolbarGroup;
};

/**
 * The buttons, without their shortcut hints — those come from the registry.
 *
 * A tool id IS the Monaco action id, which is also the registry id, so a button
 * and the shortcut it advertises cannot be attached to different commands.
 */
const BASE_TOOLBAR_TOOLS: ReadonlyArray<Omit<EditorToolbarTool, 'shortcut'>> = [
	{ id: 'fmt-bold', label: 'B', labelKey: 'menu.bold', group: 'inline' },
	{ id: 'fmt-italic', label: 'I', labelKey: 'menu.italic', group: 'inline' },
	{ id: 'fmt-underline', label: 'U', labelKey: 'menu.underline', group: 'inline' },
	{ id: 'fmt-strikethrough', label: 'S', labelKey: 'menu.strikethrough', group: 'inline' },
	{ id: 'fmt-inline-code', label: '`', labelKey: 'menu.inlineCode', group: 'inline' },
	{ id: 'fmt-code-block', label: '{}', labelKey: 'menu.codeBlock', group: 'block' },
	{ id: 'fmt-quote', label: '>', labelKey: 'menu.quote', group: 'block' },
	{ id: 'fmt-heading-1', label: 'H1', labelKey: 'menu.heading1', group: 'block' },
	{ id: 'fmt-heading-2', label: 'H2', labelKey: 'menu.heading2', group: 'block' },
	{ id: 'fmt-heading-3', label: 'H3', labelKey: 'menu.heading3', group: 'block' },
	{ id: 'fmt-bullet-list', label: '-', labelKey: 'menu.bulletList', group: 'list' },
	{ id: 'fmt-numbered-list', label: '1.', labelKey: 'menu.numberedList', group: 'list' },
	{ id: 'fmt-checklist', label: '[ ]', labelKey: 'menu.checklist', group: 'list' },
	{ id: 'fmt-link', label: '[]', labelKey: 'menu.link', group: 'insert' },
	{ id: 'fmt-image', label: 'Image', labelKey: 'menu.image', group: 'insert' },
	{ id: 'insert-table-simple', label: '#', labelKey: 'menu.insertTable', group: 'insert' },
];

/**
 * The tooltip hint is read from `shortcuts.ts`, so a tool with no registry row
 * advertises nothing.
 */
const EDITOR_TOOLBAR_TOOLS: EditorToolbarTool[] = BASE_TOOLBAR_TOOLS.map((tool) =>
	shortcutLabel(tool.id, 'Ctrl') === undefined
		? { ...tool }
		: { ...tool, shortcut: (modifier: 'Ctrl' | 'Cmd') => shortcutLabel(tool.id, modifier)! },
);

export const DEFAULT_EDITOR_TOOLBAR_ORDER = EDITOR_TOOLBAR_TOOLS.map((tool) => tool.id);

const knownToolbarIds = new Set(DEFAULT_EDITOR_TOOLBAR_ORDER);

export function normalizeEditorToolbarOrder(order: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];

	for (const id of order ?? []) {
		if (!knownToolbarIds.has(id) || normalized.includes(id)) continue;
		normalized.push(id);
	}

	for (const id of DEFAULT_EDITOR_TOOLBAR_ORDER) {
		if (!normalized.includes(id)) normalized.push(id);
	}

	return normalized;
}

export function normalizeEditorToolbarHidden(hidden: readonly string[] | null | undefined): string[] {
	const normalized: string[] = [];

	for (const id of hidden ?? []) {
		if (!knownToolbarIds.has(id) || normalized.includes(id)) continue;
		normalized.push(id);
	}

	return normalized;
}

export function getEditorToolbarTools(order: readonly string[] | null | undefined): EditorToolbarTool[] {
	const byId = new Map(EDITOR_TOOLBAR_TOOLS.map((tool) => [tool.id, tool]));
	return normalizeEditorToolbarOrder(order).map((id) => byId.get(id)!).filter(Boolean);
}

export function getVisibleEditorToolbarTools(
	order: readonly string[] | null | undefined,
	hidden: readonly string[] | null | undefined,
): EditorToolbarTool[] {
	const hiddenIds = new Set(normalizeEditorToolbarHidden(hidden));
	return getEditorToolbarTools(order).filter((tool) => !hiddenIds.has(tool.id));
}

export function getEditorToolbarReorderMove(
	order: readonly string[],
	draggedId: string,
	targetId: string,
): ToolbarMove | null {
	return getReorderMove(normalizeEditorToolbarOrder(order), draggedId, targetId);
}

export function getEditorToolbarAdjacentMove(
	order: readonly string[],
	id: string,
	direction: 'up' | 'down',
): ToolbarMove | null {
	return getAdjacentMove(normalizeEditorToolbarOrder(order), id, direction);
}

export function applyEditorToolbarMove(order: readonly string[], move: ToolbarMove): string[] {
	return applyMove(normalizeEditorToolbarOrder(order), move);
}
