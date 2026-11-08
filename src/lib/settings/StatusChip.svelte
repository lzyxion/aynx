<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * 설정의 **상태 칩 한 벌**(2026-11-05 · 목업 V2Gc8whrqUWN76GmksHaZf A안) — 메신저 채널 · AI 에이전트 · 원격 접속 · 세션 서버.
   * 면은 늘 같은 회색이고 상태는 점 색이 말한다. 범위 같은 분류 표시는 `.slist-pill`, 위험 경고는 `WarnChip` 이다.
   *
   * `ok` 켜짐 · `bad` 실패 · `warn` 일부만 · `idle` 있지만 쉬는 중(확인 중 포함) · `off` 없음(빈 점) · `info` 값만 있는 칩(점 없음).
   */
  type Tone = "ok" | "bad" | "warn" | "idle" | "off" | "info";

  let { tone, children, ...rest }: { tone: Tone; children: Snippet } & HTMLAttributes<HTMLSpanElement> = $props();
</script>

<span class="status-chip" {...rest}>
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
