<script lang="ts" module>
  export interface KeywordView {
    cli: string;
    /** 모르면 `null`(로고만) */
    label: string | null;
    efforts: readonly string[];
    effort: string;
    title: string;
    open: boolean;
    locked: boolean;
    onopen: (el: HTMLElement) => void;
  }
</script>

<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { aiIconName } from "$lib/pane-icons";
  import { effortName, keywordModelLabel, type SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ctl,
    view,
    cliName = "",
    touch = false,
  }: { ctl?: SideChatControls; view?: KeywordView; cliName?: string; touch?: boolean } = $props();

  const k = $derived.by((): (KeywordView & { untested: string | null }) | null => {
    if (view) return { ...view, untested: null };
    const chat = ctl?.chat;
    if (!ctl || !chat) return null;
    const c = ctl;
    const effortText = t("app.chatDock.effort.chip", { e: effortName(chat.effort) });
    const head = `${cliName} · ${keywordModelLabel(chat.model)}${c.effortShown ? ` · ${effortText}` : ""}`;
    return {
      cli: chat.cli,
      label: keywordModelLabel(chat.model),
      efforts: c.effortShown ? c.efforts : [],
      effort: chat.effort,
      title: c.untested ? `${head}\n${t("app.chatDock.chip.untested", { v: c.untested })}` : head,
      open: c.modelOpen,
      locked: false,
      onopen: (el) => c.toggleModel(el),
      untested: c.untested,
    };
  });
  const logo = $derived(k ? aiIconName(k.cli) : null);
  const filled = $derived(k ? k.efforts.indexOf(k.effort) + 1 : 0);
</script>

{#if k}
  <button
    type="button"
    class="kw"
    class:on={k.open}
    class:locked={k.locked}
    class:touch
    data-chat-model-chip
    data-locked={k.locked ? "" : undefined}
    aria-haspopup="dialog"
    aria-expanded={k.open}
    aria-disabled={k.locked ? "true" : undefined}
    tabindex={k.locked ? -1 : undefined}
    aria-label={k.title}
    title={k.title}
    onclick={(ev) => {
      if (!k.locked) k.onopen(ev.currentTarget);
    }}
  >
    <span class="kw-logo" aria-hidden="true">{#if logo}<AiGlyph name={logo} size={14} mono />{:else}<UiIcon name="ai" size={14} />{/if}</span>
    {#if k.label !== null}<span class="kw-name" data-chat-model-name>{k.label}</span>{/if}
    {#if k.efforts.length > 0}
      <span class="kw-gauge" style:--kw-n={k.efforts.length} data-chat-effort-bars={filled} aria-hidden="true">
        {#each k.efforts as e, i (e)}<span class="kw-bar" class:filled={i < filled} style:--kw-i={i}></span>{/each}
      </span>
    {/if}
    {#if k.untested}<span class="kw-warn" aria-hidden="true"><UiIcon name="warning" size={12} /></span>{/if}
    {#if !k.locked}<span class="kw-chev" aria-hidden="true"><UiIcon name="chevron-down" size={14} /></span>{/if}
  </button>
{/if}

<style>
  .kw {
    position: relative;
    height: 30px;
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 4px 0 8px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    white-space: nowrap;
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .kw:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .kw.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  /* 잠긴 동안은 Tab 에서도 빠진다 — 메뉴를 닫으며 돌려받은 포커스가 남아 포커스 고리가 테두리처럼 보였다 */
  .kw.locked {
    padding-right: 8px;
    opacity: 0.5;
    cursor: default;
  }

  .kw.locked:hover {
    color: var(--fg-2);
    background: transparent;
  }

  .kw.locked:focus-visible {
    outline: none;
  }

  .kw:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .kw.touch::after {
    content: "";
    position: absolute;
    inset: -7px -2px;
  }

  .kw-logo,
  .kw-chev,
  .kw-warn {
    flex: none;
    display: inline-flex;
  }

  .kw-warn {
    color: var(--warn);
  }

  .kw-name {
    min-width: 0;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kw-gauge {
    flex: none;
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 12px;
  }

  .kw-bar {
    flex: none;
    width: 2.5px;
    height: calc(4px + (8px * (var(--kw-i) + 1) / var(--kw-n)));
    border-radius: 1px;
    background: var(--control-track);
  }

  .kw-bar.filled {
    background: var(--control-on-bg);
  }
</style>
