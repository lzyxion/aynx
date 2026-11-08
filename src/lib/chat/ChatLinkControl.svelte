<script lang="ts">
  // ---------------------------------------------------------------------------
  // **연결 칩**(5단계 — `연결: <타일> ×`(× = 끊기) · `연결 없음 +`) — `ChatDock.svelte` 에서 뗀 표시 조각. 칩 상태(`chipLink` — 순수
  // `linkChipState`) · 메뉴 열림 · 연결 바꾸기(메뉴 줄은 부모의 `ToolbarMenu` + `runOnMenu`)와 끊기는 부모 독이 쥔다.
  // ---------------------------------------------------------------------------
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LinkChip } from "$lib/side-chat-link";

  let {
    chipLink,
    linkOpen,
    toggleLink,
    unlink,
  }: {
    chipLink: LinkChip;
    linkOpen: boolean;
    toggleLink: (ev: MouseEvent) => void;
    unlink: () => void;
  } = $props();
</script>

<span class="link-chip" class:linked={chipLink.kind === "linked"} class:closed={chipLink.kind === "linked" && chipLink.closed}>
  <button
    type="button"
    class="chip"
    data-chat-link-chip={chipLink.kind}
    aria-haspopup="menu"
    aria-expanded={linkOpen}
    title={t("app.chatDock.link.title")}
    onclick={toggleLink}
  >
    {#if chipLink.kind === "linked"}
      <UiIcon name={chipLink.readable === false || chipLink.closed ? "ai-off" : "link"} size={12} />
      <span class="chip-text"
        >{chipLink.closed
          ? t("app.chatDock.link.chipClosed", { name: chipLink.name })
          : t("app.chatDock.link.chip", { name: chipLink.name })}</span
      >
    {:else}
      <span class="chip-text">{t("app.chatDock.link.none")}</span>
      <UiIcon name="plus" size={12} />
    {/if}
  </button>
  {#if chipLink.kind === "linked"}
    <button
      type="button"
      class="chip-x"
      data-chat-link-unlink
      title={t("app.chatDock.link.unlink")}
      aria-label={t("app.chatDock.link.unlink")}
      onclick={() => unlink()}><UiIcon name="close" size={11} /></button
    >
  {/if}
</span>

<style>
  /* 입력 칸 아래 왼쪽 칩 — CLI 로고 + 이름 · 모델, 위로 여는 메뉴 */
  .chip {
    min-width: 0;
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    cursor: pointer;
  }

  .chip:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .chip-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 연결 칩(5단계) — 칩 + 안쪽 × (끊기). 닫힌 타일은 흐린 점선 */
  .link-chip {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    position: relative;
  }

  .link-chip.linked .chip {
    padding-right: 26px;
    color: var(--fg-1);
  }

  .link-chip.closed .chip {
    color: var(--fg-3);
    border-style: dashed;
  }

  .chip-x {
    position: absolute;
    right: 4px;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .chip-x:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }
</style>
