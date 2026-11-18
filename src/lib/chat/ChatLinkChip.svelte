<script lang="ts">
  /**
   * **연결 칩**(2026-11-13 — 사이드 채팅 입력 칸 안 위쪽 · 목업 D1) — 이 채팅이 MCP 로 읽는 타일 **하나**를 첨부처럼 `[그림] 이름 ×`(× = 그 타일만
   * 끊기)로 보인다. 부르는 쪽이 연결 순서대로 타일마다 하나씩 세운다(좁으면 줄바꿈 — `FlipComposer` 의 `.above`). 고르기는 `[+]` › 타일 연결.
   * 앞 그림은 `linkChipIcon` — 이 창에 있고 열려 있고 읽을 수 있으면 그 타일의 로고(`PaneIcon`), 닫혔거나 AI 가 못 읽으면 `ai-off`, 이 창에서
   * 찾지 못했으면 `link`. 닫힌 타일은 흐린 점선 · "· 닫힘" — 안내 줄(`link-note`)은 부르는 쪽(독)이 칸 위에 세운다.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { linkChipIcon, type LinkChip } from "$lib/side-chat-link";

  let { chip, unlink, touch = false }: { chip: LinkChip; unlink: () => void; touch?: boolean } = $props();

  const icon = $derived(linkChipIcon(chip));
</script>

<span
  class="link-chip"
  class:closed={chip.closed}
  class:off={chip.readable === false}
  class:touch
  title={t("app.chatDock.link.title")}
  data-chat-link-chip={chip.closed ? "closed" : "linked"}
>
  {#if icon === "pane" && chip.tile?.pane}
    <span class="logo"><PaneIcon pane={chip.tile.pane} size={13} /></span>
  {:else}
    <UiIcon name={icon === "ai-off" ? "ai-off" : "link"} size={13} />
  {/if}
  <span class="name">{chip.closed ? t("app.chatDock.link.chipClosed", { name: chip.name }) : chip.name}</span>
  <button
    type="button"
    class="x"
    data-chat-link-unlink
    title={t("app.chatDock.link.unlink")}
    aria-label={t("app.chatDock.link.unlink")}
    onclick={unlink}><UiIcon name="close" size={12} /></button
  >
</span>

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

  /* 타일 로고(원격 AI 타일은 로고 둘) — 줄지 않게 */
  .logo {
    flex: none;
    display: inline-flex;
    align-items: center;
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
