<script lang="ts">
  /** CLI 자신의 권한 모드 칩 — 글자는 CLI 가 알린 모드다. 칩 밖 모드(사용자 설정)는 표지로만 보이고 메뉴에서 다시 고를 수 없다. */
  import UiIcon from "$lib/UiIcon.svelte";
  import { cliModeWord, type ChatModeView } from "$lib/chat-tile/chat-tile-mode";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    view,
    open,
    busy,
    touch = false,
    ontoggle,
  }: { view: ChatModeView; open: boolean; busy: boolean; touch?: boolean; ontoggle: (el: HTMLElement) => void } = $props();

  const word = $derived(view.current === null ? t("pane.chatTile.mode.unknown") : cliModeWord(view.current));
  const label = $derived(view.foreign ? t("pane.chatTile.mode.foreign", { mode: word }) : word);
  const title = $derived(
    view.current === null
      ? t("pane.chatTile.mode.unknownTip")
      : view.foreign
        ? t("pane.chatTile.mode.foreignNote")
        : t("pane.chatTile.mode.title", { mode: word }),
  );
  // 묻는 쪽(Manual · Read only)은 중성 면, 덜 묻는 쪽은 강조 면
  const accent = $derived(view.current !== null && !view.foreign && view.current !== "default" && view.current !== "readOnly");
  const icon = $derived(
    view.foreign
      ? "warning"
      : view.current === "plan"
        ? "list-checks"
        : view.current === "acceptEdits"
          ? "edit"
          : view.current === "auto"
            ? "zap"
            : "shield-check",
  );
</script>

<button
  type="button"
  class="cm"
  class:accent
  class:foreign={view.foreign}
  class:on={open}
  class:touch
  data-chat-tile-mode-chip={view.current ?? "unknown"}
  data-foreign={view.foreign}
  aria-haspopup="menu"
  aria-expanded={open}
  aria-label={`${t("pane.chatTile.mode.menu")} — ${label}`}
  {title}
  disabled={busy}
  onclick={(ev) => ontoggle(ev.currentTarget)}
>
  <UiIcon name={icon} size={13} />
  <span class="cm-word">{label}</span>
</button>

<style>
  /* 사이드 채팅 `ChatPermChip` 과 같은 판 — 좁으면 글자만 줄임표 */
  .cm {
    position: relative;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 180px;
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

  .cm :global(svg) {
    flex: none;
  }

  .cm-word {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cm:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--control-tile-bg-hover);
  }

  .cm.accent {
    color: var(--on-accent);
    background: var(--accent);
  }

  .cm.accent:hover:not(:disabled) {
    color: var(--on-accent);
    background: var(--accent-hover, var(--accent));
  }

  .cm.foreign {
    color: var(--fg-1);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 70%, transparent);
  }

  .cm.foreign :global(svg) {
    color: var(--warn);
  }

  .cm:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .cm:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .cm.on:not(.foreign) {
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  .cm.touch::after {
    content: "";
    position: absolute;
    inset: -10px -3px;
  }
</style>
