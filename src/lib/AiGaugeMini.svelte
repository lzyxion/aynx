<script lang="ts">
  /** 보기만 하는 AI 권한 게이지 — 뜻은 옆 글자(단계 이름)가 말한다 */
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

  /* 터미널 바탕에서도 빈 칸이 보이게 칩 글자색(`--c`)을 옅게 깐다 */
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
