<script lang="ts">
  // 벨 글리프 — Material Symbols `notifications`.
  import type { HTMLAttributes } from "svelte/elements";

  let { size = 12, ...rest }: { size?: number } & Omit<HTMLAttributes<HTMLSpanElement>, "class"> = $props();
</script>

<span class="bell-glyph" style:--glyph={`${size}px`} {...rest}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M4 19v-2h2v-7q0-2.075 1.25-3.688T10.5 4.2v-.7q0-.625.438-1.062T12 2t1.063.438T13.5 3.5v.7q2 .5 3.25 2.113T18 10v7h2v2zm8 3q-.825 0-1.412-.587T10 20h4q0 .825-.587 1.413T12 22"
    />
  </svg>
</span>

<style>
  .bell-glyph {
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
  path {
    fill: var(--warn);
  }
</style>
