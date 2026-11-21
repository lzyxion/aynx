<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { PERM_AUTO_ICON, PERM_MANUAL_ICON, PERM_MODE_WORD, permChipTitle } from "$lib/chat/perm-mode";
  import type { SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { ctl, touch = false }: { ctl: SideChatControls; touch?: boolean } = $props();

  const mode = $derived(ctl.permMode);
  const title = $derived(permChipTitle(mode, ctl.permAllow.length, t));
</script>

{#if ctl.chat}
  <button
    type="button"
    class="pm"
    class:auto={mode === "auto"}
    class:on={ctl.permOpen}
    class:touch
    data-chat-perm-chip={mode}
    aria-haspopup="menu"
    aria-expanded={ctl.permOpen}
    aria-label={title}
    {title}
    onclick={(ev) => ctl.togglePerm(ev.currentTarget)}
  >
    <UiIcon name={mode === "auto" ? PERM_AUTO_ICON : PERM_MANUAL_ICON} size={13} />
    <span class="pm-word">{PERM_MODE_WORD[mode]}</span>
  </button>
{/if}

<style>
  /* 줄지 않는다(`flex: none`) — 좁으면 옆 모델 키워드의 이름이 먼저 준다 */
  .pm {
    position: relative;
    flex: none;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 9px 0 7px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .pm:hover {
    color: var(--fg-1);
    background: var(--control-tile-bg-hover);
  }

  .pm.auto {
    color: var(--on-accent);
    background: var(--accent);
  }

  .pm.auto:hover {
    background: var(--accent-hover, var(--accent));
  }

  .pm:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .pm.on {
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .pm.touch::after {
    content: "";
    position: absolute;
    inset: -10px -3px;
  }
</style>
