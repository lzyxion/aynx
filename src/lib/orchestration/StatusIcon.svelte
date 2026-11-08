<script lang="ts">
  // **상태 낱말 앞의 작은 그림**(2026-10-30 실기 다듬기) — 낱말 → 그림 표는 `model/status-icon.ts` 머리말 하나(여기는 그리기만).
  // 재생 · 검토는 움직이는 `EqBars`(움직임 줄이기면 멈춘다), 나머지는 인라인 획 SVG(이모지 없음) — 색만이 아니라 모양이 다르다.
  // 글자 옆 장식이라 `aria-hidden`(뜻은 바로 뒤의 상태 낱말이 말한다).
  import type { StatusIcon } from "./model/status-icon";
  import EqBars from "./EqBars.svelte";

  let { icon, size = 12 }: { icon: StatusIcon; size?: number } = $props();
</script>

<span class="si" data-status-icon={icon} aria-hidden="true" style:--si={`${size}px`}>
  {#if icon === "playing" || icon === "reviewing"}
    <EqBars state={icon} size={size} />
  {:else}
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      {#if icon === "attention"}
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path>
      {:else if icon === "paused"}
        <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"></rect><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"></rect>
      {:else if icon === "waiting"}
        <circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>
      {:else if icon === "done"}
        <path d="M4.5 12.5l5 5 10-11"></path>
      {:else if icon === "failed"}
        <circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6M15 9l-6 6"></path>
      {:else if icon === "stopped"}
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"></rect>
      {:else}
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"></circle>
      {/if}
    </svg>
  {/if}
</span>

<style>
  .si {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    min-width: var(--si);
    height: var(--si);
    color: var(--fg-3);
  }
  .si svg {
    display: block;
  }
  .si[data-status-icon="attention"],
  .si[data-status-icon="paused"] {
    color: var(--warn);
  }
  .si[data-status-icon="waiting"] {
    color: var(--accent);
  }
  .si[data-status-icon="done"] {
    color: var(--ok);
  }
  .si[data-status-icon="failed"] {
    color: var(--err, var(--warn));
  }
</style>
