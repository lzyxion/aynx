<script lang="ts">
  import type { DropZone } from "$lib/layout";

  let {
    preview,
    /** `preview: "zone"` 일 때만 읽힌다 */
    zone = "right",
    label = null,
  }: {
    preview: "zone" | "all";
    zone?: DropZone;
    label?: string | null;
  } = $props();
</script>

<div class="drop {preview === 'all' ? 'all' : zone}" aria-hidden="true">
  {#if label}<span class="drop-label">{label}</span>{/if}
</div>

<style>
  /* `pointer-events: none` 이 필수다 — 커서를 먹으면 자기 위에서 dragover 가 끊겨 하이라이트가 깜빡인다 */
  .drop {
    position: absolute;
    z-index: 4;
    box-sizing: border-box;
    pointer-events: none;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    opacity: 0.75;
  }

  .drop.left {
    top: 0;
    left: 0;
    width: 50%;
    height: 100%;
  }

  .drop.right {
    top: 0;
    right: 0;
    width: 50%;
    height: 100%;
  }

  .drop.top {
    top: 0;
    left: 0;
    width: 100%;
    height: 50%;
  }

  .drop.bottom {
    bottom: 0;
    left: 0;
    width: 100%;
    height: 50%;
  }

  .drop.all {
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .drop-label {
    padding: 4px 10px;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg);
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    border-radius: var(--radius);
  }
</style>
