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
   * **단축키** 섹션 ($lib/keybindings, docs/log/2026-09-02-keybindings.md).
   *
   * 두 층(터미널/전역)의 액션을 모두 나열하고, 각 행에서 조합을 **기록(record)** 하거나
   * 기본값으로 되돌린다. 기록은 `ev.code` 로만 조합을 만들므로([`comboFromEvent`]) 한국어
   * IME 가 켜져 있어도 물리 키가 그대로 잡힌다. 다른 설정과 달리 **바로 적용된다** (오버라이드
   * 맵을 매 keydown 마다 읽는 배선이라 저장을 기다릴 것이 없다 — 파일에 남기는 것만 [저장]).
   *
   * ## 창 keydown 은 여기서 듣지 않는다
   *
   * 기록 중에는 눌린 키를 **통째로 삼켜야** 한다 (그래야 `Ctrl+D` 같은 앱 전역 조합도 그대로
   * 기록된다). 그런데 같은 창 keydown 을 `SettingsModal` 이 Escape(=취소)로도 듣는다. 창
   * 리스너를 둘로 나누면 "기록 중 Escape" 가 두 곳에 도착해 순서에 따라 타일이 닫힌다 —
   * 그래서 리스너는 **셸에 하나만** 두고, 여기서는 [`captureIfRecording`] 을 내주어 셸이 먼저
   * 물어보게 한다. 삼켰으면 `true` 를 돌려주고, 셸은 거기서 멈춘다.
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

  /** 지금 기록 중인 액션 id (없으면 `null`) — 다음 keydown 이 이 액션의 새 조합이 된다 */
  let recording = $state<string | null>(null);
  /** 방금 기록한 액션 id — 그 줄의 겹침 안내만 `role="alert"` 로 읽힌다(나머지 줄은 조용히 보이기만) */
  let justRecorded = $state<string | null>(null);

  /**
   * **겹침 표** — 액션 id → 같은 이름공간에서 같은 조합을 쓰는 다른 액션 id 들 (2026-10-28).
   * 예전에는 방금 기록한 한 건만 목록 맨 아래에 떴다 — 긴 목록 밑이라 보이지 않았고, 파일에서 온 겹침은 아예 안 떴다.
   * 이제 겹친 **모든 줄**이 제 자리에서 늘 알린다(막지는 않는다 — `conflictsWith`).
   */
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

  /** 이 액션에 지금 걸린 조합의 라벨 (오버라이드 우선, 없으면 기본값 · 안 걸렸으면 "(없음)") */
  function comboLabel(id: string): string {
    return comboText(id, settings.keybindings);
  }

  /**
   * 액션의 **화면 이름** — 규칙은 `keybindings.ts` 의 [`actionLabel`] 하나뿐이고 여기서는
   * 그것이 준 문구 키를 사전에 통과시킬 뿐이다. 팔레트·치트시트도 같은 문을 지나므로 한
   * 액션이 화면마다 다른 이름으로 불리는 일이 없다 (docs/log/2026-09-17-i18n.md).
   */
  function actionName(id: string): string {
    const label = actionLabel(id);
    return t(label.key, label.params);
  }

  function startRecording(id: string) {
    justRecorded = null;
    recording = recording === id ? null : id; // 같은 버튼을 다시 누르면 취소
  }

  /**
   * 기록할 만한 키인가. **최소 하나의 수식 키**가 있거나, 함수/내비게이션 키여야 한다 —
   * 맨 글자 하나("a")로는 단축키를 만들지 않아 셸/편집 입력과 부딪히지 않게 한다.
   */
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

  /** 기록 중 눌린 키를 새 오버라이드로 확정한다 (Escape 취소·수식 홀로 누름은 무시) */
  function captureRecording(ev: KeyboardEvent): void {
    const id = recording;
    if (!id) return;
    // Escape 는 기록만 취소한다 — 모달을 닫지 않는다.
    if (ev.code === "Escape") {
      recording = null;
      return;
    }
    if (!isBindableKey(ev)) return; // 수식 홀로 누름·맨 글자 — 계속 기다린다
    const combo = comboFromEvent(ev);
    if (!combo) return; // 수식 키 자체(comboFromEvent 가 null)
    const def = [...TERM_ACTIONS, ...GLOBAL_ACTIONS, ...FILE_ACTIONS].find((a) => a.id === id);
    if (!def) {
      recording = null;
      return;
    }
    setKeybinding(id, combo, def.def);
    recording = null;
    // 겹치면 그 줄의 안내(`clashes`)가 곧바로 선다 — 이 줄 것만 소리 내어 읽힌다 (막지는 않는다).
    justRecorded = id;
  }

  /**
   * 셸의 창 keydown 이 **가장 먼저** 부른다 — 기록 중이면 이 keydown 을 통째로 삼키고
   * `true` 를 돌려준다 (셸은 거기서 멈춰 Escape 를 취소로 읽지 않는다).
   */
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

<!-- 녹화 안내는 늘 보인다 — 바꾸는 법 · 즉시 적용 · 물리 키(ev.code) 기준이라 한글 입력·자판 배치에 안전 -->
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
          <!-- 겹침 표시 — 조합 칸 왼쪽의 작은 주의 칩. 누구와 겹치는지는 툴팁 · 읽기 이름(방금 기록한 줄만 alert) -->
          {@const clashText = t("settings.keys.conflict", { others: clash.map(actionName).join(", ") })}
          <span class="key-conflict" title={clashText} role={justRecorded === action.id ? "alert" : undefined} data-key-conflict={action.id}>
            <UiIcon name="warning" size={12} />{t("settings.keys.conflict.short")}<span class="sr-only">{clashText}</span>
          </span>
        {/if}
        <!--
          기록 중에만 `data-inline-edit` 을 단다 — 그동안 이 버튼은 **아무 조합이나
          받아 적는 칸**이라, 앱 전역의 `Ctrl+D`(타일 닫기)·`Alt+화살표`(타일 이동)가
          여기서 비켜나야 그 조합도 그대로 기록된다
          (docs/log/2026-09-03-hosts-toolbar-tile-focus.md).
        -->
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
  /* 층 제목 (터미널 / 전역) — 공용 `.subhead`(15px) 그대로. 머리말 바로 밑의 첫 층만 위 여백을 줄인다 */
  .key-group:first-of-type {
    margin-top: 0;
  }

  /* 이름 | 조합 | ↺ — 면 · 2px 틈 · 모서리는 공용 목록(`.slist`, 트리거 · 스니펫 · MCP 와 한 벌). 줄 하나가 누르는 단추가 아니라 `.slist-row` 는 쓰지 않고 높이 · 호버만 맞춘다 */
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

  /* 조합 — 누르면 기록 모드가 되는 **칸**. 안의 키는 앱 공용 칩(`Keys` — 전역 `.keycap`)이라 칸 자신은 판 없이
     머리카락 선만 두른다(칩 안에 칩이 겹쳐 보이지 않게) */
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

  /* 안 걸린 조합의 "(없음)" — 칩이 아니라 흐린 글자 */
  .key-combo .unbound {
    color: var(--fg-3);
  }

  /* 기록 중 — "지금 누르세요" 는 주의 톤(앰버)이다. 강조색이 아니다: 강조색은 [저장] 의 몫이고,
     기록은 고른 것도 주 동작도 아닌 **잠깐의 상태**다 */
  .key-combo.recording {
    color: var(--warn);
    border-color: var(--warn);
    background: var(--warn-soft);
  }

  .key-combo:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 겹친 줄 — 조합 칸 테두리를 주의 톤으로, 그 왼쪽에 [⚠ 겹침] 작은 칩(누구와 겹치는지는 툴팁). 막지 않고 알리기만 한다 */
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
