<script lang="ts">
  // ---------------------------------------------------------------------------
  // **실패 글리프** — Material Symbols `error`(오류색 판 · on-error `!`). 탭 줄의 명령 실패 · 실행 목록의 실패/시간 초과 ·
  // 감사 알약의 꺼짐/실패 · 세션 판 탭 지도의 실패가 같은 그림을 쓴다(docs/log/2026-11-03-tab-status-glyphs.md). 예전엔 6~8px
  // 네모(`--sig-fail-radius`)였다. `!` 가 읽히도록 10px 아래로 내리지 않는다.
  // ---------------------------------------------------------------------------
  import type { HTMLAttributes } from "svelte/elements";

  let { size = 12, ...rest }: { size?: number } & Omit<HTMLAttributes<HTMLSpanElement>, "class"> = $props();
</script>

<span class="err-glyph" style:--glyph={`${size}px`} {...rest}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10" class="plate" />
    <path d="M12 7v6" class="mark" />
    <circle cx="12" cy="16.6" r="1.4" class="mark-dot" />
  </svg>
</span>

<style>
  .err-glyph {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--glyph);
    height: var(--glyph);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .plate {
    fill: var(--err);
  }
  .mark {
    fill: none;
    stroke: var(--m3-on-error);
    stroke-width: 2.4;
    stroke-linecap: round;
  }
  .mark-dot {
    fill: var(--m3-on-error);
  }
</style>
