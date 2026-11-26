<script lang="ts">
	let {
		show = false,
		onDisk = '',
		mine = '',
		labels,
		onclose,
		onreload,
		onkeep,
	}: {
		show?: boolean;
		onDisk?: string;
		mine?: string;
		language?: string;
		labels: { onDisk: string; mine: string; reload: string; keepMine: string; close: string };
		onclose: () => void;
		onreload: () => void;
		onkeep: () => void;
	} = $props();

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onclose();
		}
	}
</script>

<svelte:window on:keydown={show ? onKeyDown : undefined} />

{#if show}
	<div class="diff-overlay" role="dialog" aria-modal="true">
		<div class="diff-head">
			<span class="diff-label">{labels.onDisk}</span>
			<span class="diff-label">{labels.mine}</span>
			<div class="diff-actions">
				<button class="diff-action" onclick={onreload}>{labels.reload}</button>
				<button class="diff-action primary" onclick={onkeep}>{labels.keepMine}</button>
				<button class="diff-action" onclick={onclose}>{labels.close}</button>
			</div>
		</div>
		<div class="diff-body"><pre aria-label={labels.onDisk}>{onDisk}</pre><pre aria-label={labels.mine}>{mine}</pre></div>
	</div>
{/if}

<style>
	.diff-overlay {
		position: fixed;
		inset: 36px 0 0 0;
		z-index: 40001;
		display: flex;
		flex-direction: column;
		background: var(--color-canvas-default);
	}

	.diff-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-bottom: 1px solid var(--color-border-default);
		font-size: 12px;
		color: var(--color-fg-muted);
	}

	.diff-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diff-actions {
		display: flex;
		gap: 8px;
		flex: none;
	}

	.diff-action {
		padding: 4px 10px;
		border: 1px solid var(--color-action-border);
		border-radius: 6px;
		background: var(--color-canvas-subtle);
		color: var(--color-fg-default);
		font-size: 12px;
		cursor: pointer;
	}

	.diff-action.primary {
		background: var(--color-primary-action-bg);
		border-color: var(--color-accent-emphasis);
		color: var(--color-primary-action-fg);
	}

	.diff-body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		overflow: auto;
	}
	.diff-body pre { margin: 0; padding: 1em; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--color-fg-default); }
</style>
