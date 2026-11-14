<script lang="ts">
  /**
   * **연결 칩**(2026-11-13 — 사이드 채팅 입력 칸 안 위쪽 · 목업 D1) — 이 채팅이 MCP 로 읽는 타일을 첨부처럼 `🔗 이름 ×`(× = 끊기)로 보인다.
   * 연결이 없으면 칩도 없다(고르기는 `[+]` › 타일 연결). 닫힌 타일은 흐린 점선 · "· 닫힘", AI 가 못 읽으면 그림이 `ai-off` — 안내 한 줄
   * (`link-note`)은 부르는 쪽(독)이 칸 위에 그대로 세운다.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LinkChip } from "$lib/side-chat-link";

  let { chipLink, unlink, touch = false }: { chipLink: LinkChip; unlink: () => void; touch?: boolean } = $props();
</script>

{#if chipLink.kind === "linked"}
  <span
    class="link-chip"
    class:closed={chipLink.closed}
    class:off={chipLink.readable === false}
    class:touch
    title={t("app.chatDock.link.title")}
    data-chat-link-chip={chipLink.closed ? "closed" : "linked"}
  >
    <UiIcon name={chipLink.readable === false || chipLink.closed ? "ai-off" : "link"} size={13} />
    <span class="name"
      >{chipLink.closed ? t("app.chatDock.link.chipClosed", { name: chipLink.name }) : chipLink.name}</span
    >
    <button
      type="button"
      class="x"
      data-chat-link-unlink
      title={t("app.chatDock.link.unlink")}
      aria-label={t("app.chatDock.link.unlink")}
      onclick={unlink}><UiIcon name="close" size={12} /></button
    >
  </span>
{/if}

<style>
  /* 첨부처럼 — secondaryContainer 알약(고른 칩과 같은 역할 색) */
  .link-chip {
    min-width: 0;
    max-width: 100%;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    padding: 0 3px 0 9px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border: 1px solid transparent;
    border-radius: 999px;
  }

  .link-chip :global(svg) {
    flex: none;
  }

  /* 닫힌 타일 — 흐린 점선(판 없음) */
  .link-chip.closed {
    color: var(--fg-3);
    background: transparent;
    border: 1px dashed var(--line-strong);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .x {
    flex: none;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  /* 폰 — 칩을 조금 키우고 × 를 크게(누르는 자리) */
  .link-chip.touch {
    height: 32px;
    padding-right: 2px;
  }

  .link-chip.touch .x {
    width: 28px;
    height: 28px;
  }

  .x:hover {
    background: var(--control-ghost-hover);
  }

  .x:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
</style>
