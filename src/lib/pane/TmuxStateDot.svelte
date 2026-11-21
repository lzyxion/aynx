<script lang="ts">
  /** tmux 세션의 붙음 상태 점 — 글자 설명은 `title` 로만 둔다(상태는 글자 대신 점) */
  let { attached, title = undefined }: { attached: number; title?: string } = $props();
</script>

<span class="tdot-wrap" {title}>
  <span class="tdot" class:on={attached > 0}></span>
  {#if attached > 1}<span class="tdot-n">{attached}</span>{/if}
</span>

<style>
  .tdot-wrap {
    display: inline-flex;
    align-items: flex-start;
    flex: none;
    min-width: 7px;
  }

  .tdot {
    width: 7px;
    height: 7px;
    margin-top: 1px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1.5px solid var(--fg-3);
  }

  .tdot.on {
    background: var(--ok);
    border-color: var(--ok);
  }

  .tdot-n {
    margin: -4px 0 0 1px;
    font-size: 9px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--ok);
  }
</style>
