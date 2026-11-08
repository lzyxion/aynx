<script lang="ts">
  // ---------------------------------------------------------------------------
  // **입력 칸 아래 CLI · 모델 칩과 추론 강도 칩**(+ [직접 입력…] 모델 이름 칸) — `ChatDock.svelte` 에서 뗀 표시 조각(`c` = 그 대화 면의 채팅).
  // 메뉴(`ToolbarMenu`) · 고르기(`runOnMenu` — 스냅샷 → 닫기 → 실행) · 바꾸기와 **바꾸기 확인**(답하는 중이면 한 번 묻기 — 그때의 채팅이 대상)은
  // 부모 독이 쥔다. 이 조각은 칩을 그리고 누름을 부모 함수에 넘길 뿐이다. [직접 입력…] 칸의 열림(`customFor`) · 글(`customText`)만 `bind:`.
  // ---------------------------------------------------------------------------
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { SideChat } from "$lib/side-chat";

  let {
    c,
    customFor = $bindable(),
    customText = $bindable(),
    customOk,
    chipOpen,
    effortOpen,
    effortShown,
    untested,
    onCustomKey,
    toggleChip,
    chipTitle,
    cliName,
    modelLabel,
    effortLabel,
    toggleEffort,
    logo,
  }: {
    c: SideChat;
    customFor: string | null;
    customText: string;
    customOk: boolean;
    chipOpen: boolean;
    effortOpen: boolean;
    effortShown: boolean;
    /** 확인하지 않은 CLI 버전(있으면 칩에 경고 그림) */
    untested: string | null;
    onCustomKey: (ev: KeyboardEvent, chat: SideChat) => void;
    toggleChip: (ev: MouseEvent, chat: SideChat) => void;
    chipTitle: (chat: SideChat) => string;
    cliName: (id: string) => string;
    modelLabel: (model: string) => string;
    effortLabel: (effort: string) => string;
    toggleEffort: (ev: MouseEvent) => void;
    logo: Snippet<[string, number]>;
  } = $props();
</script>

{#if customFor === c.id}
  <!-- svelte-ignore a11y_autofocus -->
  <input
    class="chip chip-input"
    data-chat-chip-custom
    aria-label={t("app.chatDock.chip.custom.aria")}
    aria-invalid={!customOk}
    title={customOk ? t("app.chatDock.chip.custom.aria") : t("app.chatDock.chip.custom.bad")}
    placeholder={t("app.chatDock.cliDefault")}
    spellcheck="false"
    autocomplete="off"
    bind:value={customText}
    autofocus
    onkeydown={(ev) => onCustomKey(ev, c)}
    onblur={() => (customFor = null)}
  />
{:else}
  <button
    type="button"
    class="chip"
    data-chat-chip
    aria-haspopup="menu"
    aria-expanded={chipOpen}
    title={chipTitle(c)}
    onclick={(ev) => toggleChip(ev, c)}
  >
    {@render logo(c.cli, 14)}
    <span class="chip-text">{cliName(c.cli)} · {modelLabel(c.model)}</span>
    {#if untested}<UiIcon name="warning" size={12} />{/if}
    <UiIcon name="chevron-up" size={12} />
  </button>
{/if}
{#if effortShown}
  <button
    type="button"
    class="chip"
    data-chat-effort-chip
    aria-haspopup="menu"
    aria-expanded={effortOpen}
    title={t("app.chatDock.effort.title")}
    onclick={toggleEffort}
  >
    <span class="chip-text">{t("app.chatDock.effort.chip", { e: effortLabel(c.effort) })}</span>
    <UiIcon name="chevron-up" size={12} />
  </button>
{/if}

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

  /* [직접 입력…] 의 모델 이름 칸 — 칩과 같은 알약 자리 */
  .chip-input {
    width: 180px;
    color: var(--fg-1);
    cursor: text;
    outline: none;
  }

  .chip-input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .chip-input[aria-invalid="true"] {
    border-color: var(--err);
  }
</style>
