<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * `ok` 켜짐 · `bad` 실패 · `warn` 일부만 · `idle` 있지만 쉬는 중(확인 중 포함) · `off` 없음(빈 점) · `info` 값만 있는 칩(점 없음).
   * 색 면의 글자는 container 의 짝 글자색이다 — 색 그대로의 글자는 12px 에서 대비가 4.5:1 에 못 미친다.
   */
  type Tone = "ok" | "bad" | "warn" | "idle" | "off" | "info";

  let { tone, children, ...rest }: { tone: Tone; children: Snippet } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span class="status-chip {tone}" {...rest}>
  {#if tone !== "info"}<i class="dot {tone}" aria-hidden="true"></i>{/if}
  {@render children()}
</span>

<style>
  .status-chip {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
    color: var(--fg-2);
    background: var(--m3-surface-container-highest);
    border-radius: 999px;
  }

  .status-chip.ok {
    color: var(--on-ok-soft);
    background: var(--ok-soft);
  }

  .status-chip.bad {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }

  .status-chip.warn {
    color: var(--on-warn-soft);
    background: var(--warn-soft);
  }

  .dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .dot.ok {
    background: var(--ok);
  }

  .dot.bad {
    background: var(--err);
  }

  .dot.warn {
    background: var(--warn);
  }

  .dot.off {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--fg-3);
  }
</style>
