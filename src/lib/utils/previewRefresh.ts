// 편집 중에는 목차를 갱신할 때에만 미리보기 HTML을 다시 만든다.
export function refreshesPreviewCache(
	tab: { isSplit: boolean; rawContent?: string },
	isEditing: () => boolean,
	showToc: () => boolean,
): boolean {
	return (tab.isSplit || isEditing()) && showToc() && tab.rawContent !== undefined;
}
