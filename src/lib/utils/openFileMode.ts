import type { TranslationKey } from './i18n.js';
/**
 * What an already-open document opens AS — the preference behind #183.
 *
 * One choice rather than two switches. `isEditing` and `isSplit` are
 * independent flags on the tab, so a preference expressed as two booleans can
 * say "editor AND split", which is not a state the reader can be in: split view
 * wins the layout (`MarkdownViewer`'s pane flex reads `isSplit` first) and the
 * editor flag would only decide where closing the split lands. The question the
 * reader is actually answering has three answers, so it is stored as three.
 *
 * This does NOT cover a new empty document — `Ctrl+N` has its own preference
 * (`newFileDefaultMode`), because "what should an empty buffer open as" and
 * "what should a file I picked open as" are not the same question.
 */
export type OpenFileMode = 'preview' | 'editor' | 'split' | 'source';

export const DEFAULT_OPEN_FILE_MODE: OpenFileMode = 'editor';

/** The Settings select, in order: the one control, with its three answers. */
export const OPEN_FILE_MODE_OPTIONS: readonly { value: OpenFileMode; labelKey: TranslationKey }[] = [
	{ value: 'editor', labelKey: 'menu.liveEditor' },
	{ value: 'split', labelKey: 'menu.splitView' },
	{ value: 'source', labelKey: 'menu.sourceEditor' },
	{ value: 'preview', labelKey: 'settings.preview' },
];

export function isOpenFileMode(value: unknown): value is OpenFileMode {
	return value === 'preview' || value === 'editor' || value === 'split' || value === 'source';
}

// 저장된 모드와 이전 설정의 명시적인 미리보기 선택을 유지한다.
export function resolveOpenFileMode(stored: string | null, legacyStartInEditor: string | null): OpenFileMode {
	if (stored !== null) return isOpenFileMode(stored) ? stored : DEFAULT_OPEN_FILE_MODE;

	return legacyStartInEditor === 'false' ? 'preview' : DEFAULT_OPEN_FILE_MODE;
}
