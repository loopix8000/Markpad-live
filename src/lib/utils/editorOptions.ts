export function editorReadOnly(tab: { isTruncated?: boolean }): boolean {
	return tab.isTruncated === true;
}
