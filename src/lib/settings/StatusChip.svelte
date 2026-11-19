<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";

  /**
   * 설정의 **상태 칩 한 벌**(2026-11-05 · 목업 V2Gc8whrqUWN76GmksHaZf A안) — 메신저 채널 · AI 에이전트 · 원격 접속 · 세션 서버.
   * **켜짐 · 실패 · 일부만(`ok` · `bad` · `warn`)은 면까지 그 색**이다(2026-11-19 — 전체 색 안): 면 = 그 색의 container(`--ok-soft` ·
   * `--err-soft` · `--warn-soft`), 점 = 그 색, 글자 = 그 container 의 짝 글자색(`--on-ok-soft` · `--m3-on-error-container` · `--on-warn-soft` —
   * 색 그대로의 글자는 12px 에서 대비가 4.5:1 에 못 미친다 · 작업안 상태 알약과 같은 짝). 나머지(`idle` · `off` · `info`)는 회색 면 그대로.
   * 범위 같은 분류 표시는 `.slist-pill`, 위험 경고는 `WarnChip` 이다.
   *
   * `ok` 켜짐 · `bad` 실패 · `warn` 일부만 · `idle` 있지만 쉬는 중(확인 중 포함) · `off` 없음(빈 점) · `info` 값만 있는 칩(점 없음).
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

  /* 면까지 색 — 켜짐 · 실패 · 일부만 */
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
