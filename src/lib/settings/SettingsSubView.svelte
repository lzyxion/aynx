<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";

  let {
    title,
    back,
    backAria,
    onback,
    children,
  }: {
    title: string;
    /** 뒤로 가기 글자 — 돌아갈 요약의 이름 */
    back: string;
    backAria: string;
    onback: () => void;
    children: Snippet;
  } = $props();

  let backBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    backBtn?.focus({ preventScroll: true });
  });
</script>

<div class="sub-head">
  <button
    type="button"
    class="btn btn-sm btn-ghost back"
    aria-label={backAria}
    bind:this={backBtn}
    onclick={onback}
  >
    <UiIcon name="chevron-left" size={14} />
    <span>{back}</span>
  </button>
  <h4 class="sub-title">{title}</h4>
</div>

{@render children()}

<style>
  .sub-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: calc(-1 * var(--space-2));
    color: var(--fg-2);
  }

  .back:hover {
    color: var(--fg-1);
  }

  .sub-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--fg-1);
  }
</style>
