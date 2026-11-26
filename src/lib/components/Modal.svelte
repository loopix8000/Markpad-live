<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { t } from '../utils/i18n.js';
	import { settings } from '../stores/settings.svelte.js';
	import { handleModalBackdropContextMenu } from '../utils/modalContextMenu.js';

	let {
		show,
		title,
		message,
		kind = 'info',
		showSave = false,
		saveLabel,
		showInput = false,
		inputValue = $bindable(''),
		confirmLabel,
		confirmDisabled = false,
		children,
		onkeydown,
		onconfirm,
		onsave,
		oncancel,
	} = $props<{
		show: boolean;
		title: string;
		message: string;
		kind?: 'info' | 'warning' | 'error';
		showSave?: boolean;
		saveLabel?: string;
		showInput?: boolean;
		inputValue?: string;
		confirmLabel: string;
		confirmDisabled?: boolean;
		/** Content under the message, such as the window list of the open-file picker. */
		children?: Snippet;
		/**
		 * Sees every key before the dialog's own handling, for keys that
		 * content in `children` owns, such as arrow keys in a list. Calling
		 * `preventDefault` stops the dialog from handling that key as well.
		 */
		onkeydown?: (e: KeyboardEvent) => void;
		onconfirm: () => void;
		onsave?: () => void;
		oncancel: () => void;
	}>();

	let modalContent = $state<HTMLDivElement>();
	let inputElement = $state<HTMLInputElement>();
	let previousActiveElement: HTMLElement | null = null;

	$effect(() => {
		if (show) {
			previousActiveElement = document.activeElement as HTMLElement;
			const focusTimer = setTimeout(() => {
				if (showInput && inputElement) {
					inputElement.focus();
					inputElement.select();
					return;
				}
				const focusable = modalContent?.querySelector<HTMLButtonElement>('button.primary:not(:disabled)');
				if (focusable) {
					focusable.focus();
				} else {
					modalContent?.focus();
				}
			}, 50);
			return () => clearTimeout(focusTimer);
		} else if (previousActiveElement) {
			previousActiveElement.focus();
			previousActiveElement = null;
		}
	});

	function handleKeydown(e: KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return;
		onkeydown?.(e);
		if (e.defaultPrevented) return;
		// While the user is typing in the input, plain letters are text —
		// the y/n confirm/cancel shortcuts must not fire.
		const typingInInput = showInput && e.target === inputElement;
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
		if (e.key === 'Enter') {
			if (e.target instanceof HTMLButtonElement && e.target.closest('.modal-footer')) return;
			e.preventDefault();
			if (showSave && onsave) {
				onsave();
			} else if (!confirmDisabled) {
				onconfirm();
			}
		}
		if (!typingInInput && !showSave && !confirmDisabled && e.key.toLowerCase() === 'y' && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			onconfirm();
		}
		if (!typingInInput && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey) {
			e.preventDefault();
			oncancel();
		}
		if (e.ctrlKey && e.key === 's' && showSave && onsave) {
			e.preventDefault();
			onsave();
		}

		// Focus trap
		if (e.key === 'Tab') {
			const focusableElements = modalContent?.querySelectorAll('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [];
			if (focusableElements.length === 0) return;
			const first = focusableElements[0] as HTMLElement;
			const last = focusableElements[focusableElements.length - 1] as HTMLElement;

			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}
	}

	function handleBackdropClick() {
		oncancel();
	}
</script>

{#if show}
	<div
		class="modal-backdrop"
		transition:fade={{ duration: 150 }}
		onclick={handleBackdropClick}
		oncontextmenu={handleModalBackdropContextMenu}
		role="presentation">
		<div
			class="modal-content {kind}"
			bind:this={modalContent}
			transition:scale={{ duration: 200, start: 0.95 }}
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-label={title}
			aria-modal="true"
			tabindex="-1"
			onkeydown={handleKeydown}>
			<div class="modal-header">
				<h3>{title}</h3>
			</div>
			<div class="modal-body">
				{#if message}<p>{message}</p>{/if}
				{#if showInput}
					<input class="modal-input" type="text" aria-label={message || title} bind:this={inputElement} bind:value={inputValue} spellcheck="false" />
				{/if}
				{@render children?.()}
			</div>
			<div class="modal-footer">
				{#if showSave}
					<button type="button" class="dialog-action discard" disabled={confirmDisabled} onclick={onconfirm}>{confirmLabel}</button>
					{/if}
				{#if kind !== 'error'}
					<button type="button" class="dialog-action" onclick={oncancel}>{t('settings.cancel', settings.language)}</button>
				{/if}
					{#if showSave}
					<button type="button" class="dialog-action primary" onclick={onsave}>{saveLabel ?? t('settings.save', settings.language)}</button>
				{:else}
					<button type="button" class="dialog-action primary" disabled={confirmDisabled} onclick={onconfirm}>{confirmLabel}</button>
					{/if}
				</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 30000;
	}

	.modal-content {
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		width: 400px;
		max-width: 90vw;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
		overflow: hidden;
		font-family: var(--win-font);
	}

	.modal-header {
		padding: 20px 24px 12px 24px;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--color-fg-default);
	}

	.modal-body {
		padding: 0 24px 24px 24px;
	}

	.modal-body p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--color-fg-muted);
	}

	.modal-input {
		margin-top: 12px;
		width: 100%;
		box-sizing: border-box;
		padding: 6px 10px;
		font-size: 14px;
		font-family: inherit;
		color: var(--color-fg-default);
		background: var(--color-canvas-default);
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		outline: none;
	}

	.modal-input:focus {
		border-color: var(--color-accent-fg);
	}

	.modal-footer {
		padding: 16px 24px;
		background: var(--color-canvas-subtle);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		border-top: 1px solid var(--color-border-muted);
	}

	.discard {
		margin-inline-end: auto;
		color: var(--color-action-danger-fg);
		border-color: currentColor;
	}
</style>
