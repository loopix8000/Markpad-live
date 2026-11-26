import { beforeEach,describe,expect,test } from 'vitest';

import { clearVscodeTheme,loadVscodeTheme } from '../src/lib/utils/theme.js';

/**
 * Choosing a VS Code theme and then another theme before the first finished
 * loading left the window in the VS Code theme while the setting said the other
 * one, and a failed load reset the setting to `system` over the newer choice.
 *
 * Two awaits sit between the choice and the paint: the `read_vscode_theme`
 * round-trip, and Monaco's first `import()` inside the parse. The test holds
 * each open and makes the newer choice inside it.
 */
describe('stale theme load', () => {
	const THEME = JSON.stringify({ type: 'dark', colors: { 'editor.background': '#101010' } });

	/** What the `light` branch of the viewer's theme effect does. */
	function chooseLight(clear = clearVscodeTheme) {
		document.documentElement.dataset.theme = 'light';
		document.documentElement.dataset.themeType = 'light';
		clear();
	}

	function deferred<T>() {
		let resolve!: (value: T) => void;
		let reject!: (reason: unknown) => void;
		const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
		return { promise, resolve, reject };
	}

	beforeEach(() => {
		delete document.documentElement.dataset.theme;
		delete document.documentElement.dataset.themeType;
		document.getElementById('vscode-theme-style')?.remove();
	});

	test('a theme read that returns after a newer choice does not paint over it', async () => {
		const read = deferred<string>();
		const load = loadVscodeTheme('Dark Thing', () => read.promise);

		chooseLight();
		read.resolve(THEME);

		expect(await load).toBe(false);
		expect(document.documentElement.dataset.theme).toBe('light');
		expect(document.getElementById('vscode-theme-style')).toBeNull();
	});

	test('a theme read that fails after a newer choice does not report the failure', async () => {
		const read = deferred<string>();
		const load = loadVscodeTheme('Missing', () => read.promise);

		chooseLight();
		read.reject(new Error('no such theme'));

		// The viewer resets the setting to `system` on a rejection.
		expect(await load).toBe(false);
	});

	test('a theme read that fails while it is still the choice does report it', async () => {
		await expect(loadVscodeTheme('Missing', () => Promise.reject(new Error('no such theme')))).rejects.toThrow(
			'no such theme',
		);
	});
});

describe('theme CSS validation', () => {
	test('[P1-C-3] the injected style tag is built only from validated values', async () => {

		const hostile = JSON.stringify({
			type: 'dark',
			colors: {
				'editor.background': 'red; } body { display: none } :root {',
				'editor.foreground': '#abcdef</style><img src=x onerror=alert(1)>',
				'textLink.foreground': '#123456',
			},
		});

		expect(await loadVscodeTheme('Hostile', async () => hostile)).toBe(true);

		const style = document.getElementById('vscode-theme-style')!;
		expect(style.children.length).toBe(0);
		expect(style.textContent).not.toMatch(/display: none|onerror|<img|<\/style>/);
		// A rejected value is a missing one: the default stands in for it.
		expect(style.textContent).toContain('--color-canvas-default: #1e1e1e;');
		expect(style.textContent).toContain('--color-fg-default: #d4d4d4;');
		expect(style.textContent).toContain('--color-accent-fg: #123456;');
	});
});
