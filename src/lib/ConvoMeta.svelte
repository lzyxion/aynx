<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ConvoMetaChip } from "$lib/convo-meta";

  /**
   * **지난 대화 줄의 아래 줄** — 브랜치 · 모델 · 사용량을 `·` 로 가른 글자로(`convo-meta.ts` 가 순서를 정한다 — 배경 칩은
   * 10-16 사용자가 되돌림). 상태 칩(열린 타일 · 폴더 없음 · 밖에서 열림)은 부르는 쪽이 `children` 으로 끝에 붙인다 —
   * 그 모양은 각 화면의 것이다. 넘치면 글자 끝이 잘린다(줄 높이는 그대로).
   */
  let { chips, children }: { chips: readonly ConvoMetaChip[]; children?: Snippet } = $props();
</script>

<span class="cmeta">
  <span class="mtext"
    >{#each chips as c, j (c.kind)}{#if j > 0}<span class="dotsep">·</span>{/if}<span
        class:mono={c.kind === "model"}
        data-meta={c.kind}>{c.text}</span
      >{/each}</span
  >{@render children?.()}
</span>

<style>
  .cmeta {
    display: flex;
    align-items: center;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .mtext {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dotsep {
    margin: 0 var(--space-1);
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
