import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { commands } from '../bindings.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ViewerWindowEntry } from '../utils/viewerWindows.js';

type UpdatePhase =
	| 'idle'
	| 'checking'
	| 'up-to-date'
	| 'available'
	| 'package-managed'
	| 'downloading'
	| 'error';

type ErrorSource = 'check' | 'download' | 'install';

/** 시작 직후에는 창 복원과 파일 열기가 먼저 끝나도록 잠시 기다린다. */
export const AUTO_CHECK_DELAY_MS = 5_000;
/** 오래 켜 두는 경우를 위해 주기적으로 다시 확인한다. */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

class UpdateStore {
	phase = $state<UpdatePhase>('idle');
	show = $state(false);
	current = $state('');
	latest = $state('');
	downloaded = $state(0);
	total = $state(0);
	errorMsg = $state('');
	errorSource = $state<ErrorSource>('check');
	notes = $state('');
	/** Windows open beside this one when an install was last asked for (#767). */
	otherWindows = $state<ViewerWindowEntry[]>([]);
	#pending: Update | null = null;
	#checkToken = 0;
	#autoTimer: ReturnType<typeof setTimeout> | null = null;
	#autoStarted = false;
	/** 이번 실행에서 사용자가 닫은 버전. 자동 확인은 같은 버전을 다시 띄우지 않는다. */
	#dismissedVersion = '';

	async openDialog() {
		if (this.show) return;
		this.show = true;
		await this.runCheck();
	}

	/**
	 * 창이 복원을 마친 뒤 부른다. 실행당 처음 묻는 창 하나만 확인을 맡아(`claimUpdateWatch`)
	 * 잠시 뒤 백그라운드로 확인하고, 이후 주기적으로 다시 확인한다. 다른 창은 아무것도
	 * 하지 않으므로 대화상자가 창마다 뜨지 않는다.
	 */
	async startAutoCheck() {
		if (this.#autoStarted) return;
		this.#autoStarted = true;
		const mine = await commands.claimUpdateWatch().catch(() => false);
		if (!mine || !this.#autoStarted) return;
		const tick = async () => {
			await this.checkInBackground();
			if (this.#autoTimer) this.#autoTimer = setTimeout(tick, AUTO_CHECK_INTERVAL_MS);
		};
		this.#autoTimer = setTimeout(tick, AUTO_CHECK_DELAY_MS);
	}

	stopAutoCheck() {
		if (this.#autoTimer) clearTimeout(this.#autoTimer);
		this.#autoTimer = null;
		this.#autoStarted = false;
	}

	/**
	 * 대화상자를 열지 않고 확인한다. 새 버전이 있을 때만 대화상자를 띄우고,
	 * 최신이거나 확인에 실패하면 아무것도 보여 주지 않는다.
	 */
	async checkInBackground() {
		// 사용자가 대화상자로 확인하거나 설치하는 중이면 끼어들지 않는다.
		if (this.show || this.phase !== 'idle') return;
		await this.runCheck();
		// 확인하는 사이에 사용자가 직접 대화상자를 열었다면 그 결과를 그대로 보여 준다.
		if (this.show) return;
		// runCheck가 phase를 바꾸므로, 위의 비교로 좁혀진 타입을 다시 넓혀 읽는다.
		const phase = this.phase as UpdatePhase;
		if (phase === 'available' && this.latest !== this.#dismissedVersion) {
			this.show = true;
			return;
		}
		this.phase = 'idle';
		this.#clearResult();
	}

	close() {
		if (this.phase === 'downloading') return;
		if (this.phase === 'available') this.#dismissedVersion = this.latest;
		this.#checkToken++;
		this.show = false;
		this.phase = 'idle';
		this.#clearResult();
	}

	/** Forget the last check's result, so a new one starts clean. */
	#clearResult() {
		this.errorMsg = '';
		this.errorSource = 'check';
		this.notes = '';
		this.latest = '';
		this.downloaded = 0;
		this.total = 0;
		this.otherWindows = [];
		this.#pending = null;
	}

	async runCheck() {
		if (this.phase === 'checking' || this.phase === 'downloading') return;

		const token = ++this.#checkToken;
		this.phase = 'checking';
		this.#clearResult();

		try {
			// Ask whether this install can update itself BEFORE checking, not
			// after. A `.deb`, `.rpm` or snap install passes the check happily —
			// latest.json publishes `linux-x86_64` and every Linux build asks for
			// exactly that key — and then fails at install time, because the
			// updater's only Linux strategy is renaming a file over the running
			// binary. Being offered an update that cannot be installed is worse
			// than not being offered one, so the question is asked first and the
			// dialog says where updates actually come from. See #570.
			if (!(await commands.selfUpdateSupported())) {
				if (token !== this.#checkToken) return;
				this.phase = 'package-managed';
				return;
			}
			if (token !== this.#checkToken) return;

			// Cache the running app's version after the first successful fetch.
			// Tauri reads it from the bundle once at startup so subsequent calls
			// only return the cached value, but keeping it stable across
			// retries makes intent clearer.
			if (!this.current) {
				const v = await getVersion();
				if (token !== this.#checkToken) return;
				this.current = v;
			}

			const u = await check();
			if (token !== this.#checkToken) return;
			if (u) {
				this.#pending = u;
				this.latest = u.version;
				this.notes = u.body ?? '';
				this.phase = 'available';
			} else {
				this.phase = 'up-to-date';
			}
		} catch (e) {
			if (token !== this.#checkToken) return;
			this.errorMsg = e instanceof Error ? e.message : String(e);
			this.phase = 'error';
		}
	}

	async startDownload(settleForExit: () => Promise<boolean>) {
		if (this.phase !== 'available' || !this.#pending) return;

		const update = this.#pending;
		this.#checkToken++;
		this.phase = 'downloading';
		this.downloaded = 0;
		this.total = 0;

		// An install ends every window at once, and only this one reviews its
		// unsaved tabs and writes the session. So the others close first, each
		// through its own close review, and the update waits on offer (#767).
		// No list to go on is how this behaved before it asked.
		const windows = (await commands.listViewerWindows().catch(() => null)) ?? [];
		this.otherWindows = windows.filter((window) => window.label !== getCurrentWindow().label);
		if (this.otherWindows.length > 0) {
			this.phase = 'available';
			return;
		}

		// Installing ends the process without closing the window, so the close
		// path's work — unsaved tabs, the restore snapshot — runs first (#761).
		// Cancelling it keeps the update on offer.
		if (!(await settleForExit())) {
			this.phase = 'available';
			return;
		}

		// Two separate try blocks so the error attribution is precise:
		// downloadAndInstall failures map to errorSource='download' (the
		// download or signature-verify failed), while a relaunch() failure
		// maps to errorSource='install' (the new binary is on disk but the
		// OS refused to restart — user just needs to quit and reopen).
		try {
			await update.downloadAndInstall((event) => {
				if (event.event === 'Started') {
					this.total = event.data.contentLength ?? 0;
				} else if (event.event === 'Progress') {
					this.downloaded += event.data.chunkLength;
				}
			});
		} catch (e) {
			this.errorMsg = e instanceof Error ? e.message : String(e);
			this.errorSource = 'download';
			this.phase = 'error';
			return;
		}

		try {
			await relaunch();
		} catch (e) {
			this.errorMsg = e instanceof Error ? e.message : String(e);
			this.errorSource = 'install';
			this.phase = 'error';
		}
	}
}

export const updateStore = new UpdateStore();
