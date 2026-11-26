type LiveTab = { dispose(): void };
const editors = new Map<string, LiveTab>();

export function trackLiveTab(id: string, tab: LiveTab) {
	editors.get(id)?.dispose();
	editors.set(id, tab);
}

export function retainLiveEditors(ids: Iterable<string>) {
	const open = new Set(ids);
	for (const [id, tab] of editors) {
		if (!open.has(id)) {
			editors.delete(id);
			tab.dispose();
		}
	}
}
