<script lang="ts">
  // `!` 가 읽히도록 10px 아래로 내리지 않는다 (docs/log/2026-11-03-tab-status-glyphs.md)
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
