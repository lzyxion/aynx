<script lang="ts">
  /**
   * **AI 권한 미니 게이지**(2026-10-23) — 보기만 하는 작은 꼴. 고르개(`AiGauge.svelte`)와 같은 규칙(`ai-gauge.ts`): 칸 넷이 지금 자리까지
   * 차고, 찬 칸은 지금 단계의 색(`--ai-c` — 이 상자가 `data-ai-tone` 을 단다).
   *
   * - `bars` — 세로 막대 넷(5×10). 타일 머리줄의 AI 권한 칩 · 설정 › 보안 표의 단계 칩. 닫혀 있어도 단계가 보인다.
   * - `track` — '끔' 고리 + 가로 칸 넷. 모두 승인 확인 상자 머리의 미리 보기.
   *
   * 뜻은 옆 글자(단계 이름)가 말한다 — 그림 자체는 `aria-hidden`.
   */
  import { GAUGE_SEGMENTS, gaugeTone, segmentFilled, segmentShape } from "$lib/ai-gauge";

  let { at, shape = "bars" }: { at: number; shape?: "bars" | "track" } = $props();

  const segs = Array.from({ length: GAUGE_SEGMENTS }, (_, i) => i + 1);
</script>

<span class="mini {shape}" data-ai-tone={gaugeTone(at)} aria-hidden="true">
  {#if shape === "track"}<span class="ring" class:on={at === 0}></span>{/if}
  {#each segs as seg (seg)}
    <span class="seg" class:filled={segmentFilled(seg, at)} data-shape={segmentShape(seg)}></span>
  {/each}
</span>

<style>
  .mini {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 2px;
  }

  .bars .seg {
    display: block;
    width: 4px;
    height: 10px;
    border-radius: 2px;
    background: var(--ai-track);
  }

  /* 터미널 머리줄(터미널 바탕)에서도 빈 칸이 보이게 — 칩 글자색(`--c`)을 옅게 깐다 */
  :global(.hchip) .bars .seg {
    background: color-mix(in srgb, var(--c, var(--fg)) 28%, transparent);
  }

  .bars .seg.filled,
  :global(.hchip) .bars .seg.filled {
    background: var(--ai-c);
  }

  .track {
    gap: 4px;
    width: 100%;
  }

  .track .ring {
    flex: none;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    margin-right: var(--space-2);
    border-radius: 999px;
    border: 2px solid var(--ai-ring);
  }

  .track .ring.on {
    border-color: var(--ai-lv0);
  }

  .track .seg {
    flex: 1;
    height: 8px;
    border-radius: 3px;
    background: var(--ai-track);
  }

  .track .seg[data-shape="start"] {
    border-radius: 999px 3px 3px 999px;
  }

  .track .seg[data-shape="end"] {
    border-radius: 3px 999px 999px 3px;
  }

  .track .seg.filled {
    background: var(--ai-c);
  }
</style>
