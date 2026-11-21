<script lang="ts">
  import { settings, setKeybinding, resetKeybinding } from "$lib/settings.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import {
    actionLabel,
    actionsByScope,
    comboFromEvent,
    conflictsWith,
    displayCombo,
    effectiveCombo,
    isOverridden,
    type ActionDef,
    type ActionScope,
  } from "$lib/keybindings";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { comboText } from "$lib/settings/combo";

  /**
   * 창 keydown 은 여기서 듣지 않는다 — 리스너를 둘로 나누면 "기록 중 Escape" 가 두 곳에 닿아 순서에 따라
   * 타일이 닫힌다. 리스너는 셸(`SettingsModal`)에 하나만 두고 셸이 [`captureIfRecording`] 을 먼저 묻는다.
   */

  const TERM_ACTIONS: ActionDef[] = actionsByScope("terminal");
  const GLOBAL_ACTIONS: ActionDef[] = actionsByScope("global");
  const FILE_ACTIONS: ActionDef[] = actionsByScope("files");
  const SCOPE_LABEL: Record<ActionScope, Key> = {
    terminal: "settings.keys.scope.terminal",
    global: "settings.keys.scope.global",
    files: "settings.keys.scope.files",
  };
  const KEY_GROUPS: { scope: ActionScope; actions: ActionDef[] }[] = [
    { scope: "terminal", actions: TERM_ACTIONS },
    { scope: "global", actions: GLOBAL_ACTIONS },
    { scope: "files", actions: FILE_ACTIONS },
  ];

  let recording = $state<string | null>(null);
  let justRecorded = $state<string | null>(null);

  /** 겹침은 알리기만 하고 막지 않는다 */
  const clashes = $derived.by(() => {
    const out: Record<string, string[]> = {};
    for (const { actions } of KEY_GROUPS) {
      for (const a of actions) {
        const others = conflictsWith(a.id, settings.keybindings);
        if (others.length > 0) out[a.id] = others;
      }
    }
    return out;
  });

  function comboLabel(id: string): string {
    return comboText(id, settings.keybindings);
  }

  /** 이름 규칙은 `actionLabel` 하나 — 팔레트 · 치트시트와 같은 문을 지나야 화면마다 이름이 갈리지 않는다 */
  function actionName(id: string): string {
    const label = actionLabel(id);
    return t(label.key, label.params);
  }

  function startRecording(id: string) {
    justRecorded = null;
    recording = recording === id ? null : id;
  }

  /** 맨 글자 하나로는 단축키를 만들지 않는다 — 셸 · 편집 입력과 부딪힌다 */
  function isBindableKey(ev: KeyboardEvent): boolean {
    if (ev.ctrlKey || ev.altKey || ev.shiftKey) return true;
    if (/^F\d{1,2}$/.test(ev.code)) return true;
    return (
      ev.code === "ArrowUp" ||
      ev.code === "ArrowDown" ||
      ev.code === "ArrowLeft" ||
      ev.code === "ArrowRight" ||
      ev.code === "Home" ||
      ev.code === "End" ||
      ev.code === "PageUp" ||
      ev.code === "PageDown" ||
      ev.code === "Insert" ||
      ev.code === "Delete"
    );
  }

  function captureRecording(ev: KeyboardEvent): void {
    const id = recording;
    if (!id) return;
    if (ev.code === "Escape") {
      recording = null;
      return;
    }
    if (!isBindableKey(ev)) return;
    const combo = comboFromEvent(ev);
    if (!combo) return;
    const def = [...TERM_ACTIONS, ...GLOBAL_ACTIONS, ...FILE_ACTIONS].find((a) => a.id === id);
    if (!def) {
      recording = null;
      return;
    }
    setKeybinding(id, combo, def.def);
    recording = null;
    justRecorded = id;
  }

  /** 셸의 창 keydown 이 가장 먼저 부른다 — `true` 면 셸은 거기서 멈춰 Escape 를 취소로 읽지 않는다 */
  export function captureIfRecording(ev: KeyboardEvent): boolean {
    if (recording === null) return false;
    ev.preventDefault();
    ev.stopPropagation();
    captureRecording(ev);
    return true;
  }

  function resetBinding(id: string) {
    if (justRecorded === id) justRecorded = null;
    resetKeybinding(id);
  }
</script>

<p class="lead">
  {t("settings.keys.lead.p1")}<strong>{t("settings.keys.lead.term")}</strong>{t(
    "settings.keys.lead.p2",
  )}<code>ev.code</code>{t("settings.keys.lead.p3")}
</p>

{#each KEY_GROUPS as group (group.scope)}
  <h4 class="subhead key-group">{t(SCOPE_LABEL[group.scope])}</h4>
  <div class="slist key-rows">
    {#each group.actions as action (action.id)}
      {@const clash = clashes[action.id]}
      <div class="key-row" class:clash={!!clash}>
        <span class="name">{actionName(action.id)}</span>
        {#if clash}
          {@const clashText = t("settings.keys.conflict", { others: clash.map(actionName).join(", ") })}
          <span class="key-conflict" title={clashText} role={justRecorded === action.id ? "alert" : undefined} data-key-conflict={action.id}>
            <UiIcon name="warning" size={12} />{t("settings.keys.conflict.short")}<span class="sr-only">{clashText}</span>
          </span>
        {/if}
        <!-- 기록 중에만 `data-inline-edit` — 앱 전역 조합(`Ctrl+D` 등)이 비켜나야 그 조합도 기록된다 (docs/log/2026-09-03-hosts-toolbar-tile-focus.md) -->
        <button
          type="button"
          class="key-combo"
          class:recording={recording === action.id}
          data-inline-edit={recording === action.id ? "" : undefined}
          aria-label={t("settings.keys.combo.aria", {
            name: actionName(action.id),
            combo: recording === action.id ? t("settings.keys.recording") : comboLabel(action.id),
          })}
          onclick={() => startRecording(action.id)}
        >
          {#if recording === action.id}
            {t("settings.keys.press")}
          {:else}
            {@const bound = effectiveCombo(action.id, settings.keybindings)}
            {#if bound}<Keys combo={displayCombo(bound)} />{:else}<span class="unbound">{comboLabel(action.id)}</span>{/if}
          {/if}
        </button>
        <button
          type="button"
          class="btn btn-sm btn-ghost icon"
          disabled={!isOverridden(action.id, settings.keybindings)}
          title={t("settings.keys.reset.title", { name: actionName(action.id) })}
          aria-label={t("settings.keys.reset.aria", { name: actionName(action.id) })}
          onclick={() => resetBinding(action.id)}
        >
          <UiIcon name="reset" size={13} />
        </button>
      </div>
    {/each}
  </div>
{/each}

<style>
  .key-group:first-of-type {
    margin-top: 0;
  }

  /* 줄 하나가 누르는 단추가 아니라 `.slist-row` 는 쓰지 않고 높이 · 호버만 맞춘다 */
  .key-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    min-height: 48px;
    padding: 6px 12px 6px 16px;
  }

  .key-row:hover {
    background-image: linear-gradient(var(--slist-state), var(--slist-state));
  }

  .key-row .name {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: var(--fw-regular);
  }

  /* 칸 자신은 판 없이 선만 — 안의 `Keys` 칩과 겹쳐 보이지 않게 */
  .key-combo {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 88px;
    height: 28px;
    padding: 0 var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: none;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .key-combo:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .key-combo .unbound {
    color: var(--fg-3);
  }

  /* 기록 중은 주의 톤 — 강조색은 [저장] 의 몫이다 */
  .key-combo.recording {
    color: var(--warn);
    border-color: var(--warn);
    background: var(--warn-soft);
  }

  .key-combo:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .key-row.clash .key-combo {
    border-color: var(--warn);
  }

  .key-conflict {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 20px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--warn);
    background: var(--warn-soft);
    border-radius: 10px;
    white-space: nowrap;
    cursor: help;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
