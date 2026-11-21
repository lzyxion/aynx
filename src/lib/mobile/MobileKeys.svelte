<!--
  모바일 키 띠 · 입력 칸. 입력 칸이 기본이다 — 안드로이드 키보드(추천 낱말 줄)로 xterm 에 바로 치면 불안정하다.
  보내는 곳은 사람 키 입력과 같은 문(`term-actions` · 출처 `keyboard`) 하나다. 지금 타일이 AI 대화 면 · 오케스트레이션 탭이면 띠를 숨긴다 —
  언마운트하지 않는다(치던 글이 남는다). 숨을 때 끈적 Ctrl 을 푼다 — 안 그러면 대화 입력 칸의 글이 Ctrl 로 나간다.
-->
<script lang="ts">
  import { activeTabId, currentWorkspaceTabs, paneOf } from "$lib/app/tabs.svelte.js";
  import { inputMode, keyStrip, registerLineField, setInputMode, setStickyCtrl, stickyCtrl } from "$lib/app/mobile.svelte.js";
  import { visibleStrip } from "$lib/mobile/prefs";
  import { STRIP_KEYS } from "$lib/mobile/strip-keys";
  import { armedFieldChar, DEL, emptyFieldDelete, emptyFieldKey } from "$lib/mobile/line-field";
  import { termActionsOf } from "$lib/term-actions";
  import { flipViewOf } from "$lib/pane/flip-view.svelte.js";
  import { hasSession, listPanes } from "$lib/session";
  import type { BandKey } from "$lib/mobile/keys";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { tick } from "svelte";

  const target = $derived.by(() => {
    const tab = currentWorkspaceTabs().find((x) => x.id === activeTabId());
    if (!tab) return null;
    const id = paneOf(tab);
    const pane = listPanes(tab.root).find((p) => p.id === id);
    return pane && hasSession(pane.kind) ? pane.id : null;
  });

  const orchTab = $derived(!!currentWorkspaceTabs().find((x) => x.id === activeTabId())?.orch);
  /** 칸 · 키가 보이지 않는 CLI 로 새지 않게 */
  const hidden = $derived(orchTab || (target !== null && flipViewOf(target) === "convo"));
  $effect(() => {
    if (hidden && stickyCtrl()) setStickyCtrl(false);
  });

  const fieldMode = $derived(inputMode() === "field");
  let text = $state("");
  let prevText = "";
  let field = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (field) return registerLineField(field);
  });

  const strip = $derived(visibleStrip(keyStrip()));

  /** 단추가 포커스를 훔치지 않게 — 화면 키보드가 내려가지 않는다 */
  function keep(ev: PointerEvent) {
    ev.preventDefault();
  }

  function press(key: BandKey) {
    if (target) termActionsOf(target)?.bandKey(key);
  }

  function clearField() {
    text = "";
    prevText = "";
    field?.focus();
  }

  function send() {
    if (!target) return;
    termActionsOf(target)?.sendText(text, true);
    clearField();
  }

  function insert() {
    if (!target || text === "") return;
    termActionsOf(target)?.sendText(text, false);
    clearField();
  }

  /** 같은 지우기의 beforeinput · input 이 DEL 을 한 번 더 보내지 않게 */
  let keySent = false;

  function onFieldKey(ev: KeyboardEvent) {
    keySent = false;
    if (!target) return;
    const bytes = emptyFieldKey(ev.key, text, ev.isComposing);
    if (bytes === null) return;
    ev.preventDefault();
    keySent = true;
    termActionsOf(target)?.sendKeys(bytes);
  }

  /** 키보드가 Backspace 키 없이 지우기 입력만 낼 때 */
  function onFieldBeforeInput(ev: InputEvent) {
    if (!target || keySent || !emptyFieldDelete(ev.inputType, text, ev.isComposing)) return;
    ev.preventDefault();
    keySent = true;
    termActionsOf(target)?.sendKeys(DEL);
  }

  function onFieldInput(ev: Event) {
    const ie = ev as InputEvent;
    const prev = prevText;
    prevText = text;
    if (!target || ie.isComposing) return;
    if (prev === "" && !keySent && emptyFieldDelete(ie.inputType, text, false)) {
      termActionsOf(target)?.sendKeys(DEL);
      return;
    }
    const ch = armedFieldChar(prev, text, stickyCtrl());
    if (ch === null) return;
    termActionsOf(target)?.sendKeys(ch); // 끈적 Ctrl 은 터미널의 사람 키 문이 붙이고 푼다
    clearField();
  }

  function toggleMode() {
    const next = fieldMode ? "direct" : "field";
    setInputMode(next);
    if (next === "field") void tick().then(() => field?.focus());
    else if (target) termActionsOf(target)?.focus();
  }
</script>

<div class="mobile-keys glass-band" class:idle={!target} class:hidden>
  {#if fieldMode}
    <form
      class="line"
      onsubmit={(ev) => {
        ev.preventDefault();
        send();
      }}
    >
      <input
        bind:this={field}
        bind:value={text}
        class="field"
        type="text"
        enterkeyhint="send"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label={t("app.mobile.input")}
        placeholder={target ? t("app.mobile.input.placeholder") : t("app.mobile.input.none")}
        disabled={!target}
        onkeydown={onFieldKey}
        onkeyup={() => (keySent = false)}
        onbeforeinput={onFieldBeforeInput}
        oninput={onFieldInput}
      />
      <button
        type="button"
        class="insert"
        title={t("app.mobile.input.insert.hint")}
        disabled={!target || text === ""}
        onpointerdown={keep}
        onclick={insert}>{t("app.mobile.input.insert")}</button
      >
      <button type="submit" class="send" title={t("app.mobile.input.send.hint")} disabled={!target} onpointerdown={keep}
        >{t("app.mobile.input.send")}</button
      >
    </form>
  {/if}
  <div class="keys" role="toolbar" aria-label={t("app.mobile.keys")}>
    <button
      type="button"
      class="key mode"
      class:armed={fieldMode}
      aria-pressed={fieldMode}
      aria-label={t("app.mobile.inputMode.toggle")}
      title={t(fieldMode ? "app.mobile.inputMode.field.hint" : "app.mobile.inputMode.direct.hint")}
      onpointerdown={keep}
      onclick={toggleMode}
      >{#if fieldMode}가{:else}<UiIcon name="keyboard" size={18} />{/if}</button
    >
    {#each strip as id (id)}
      {@const k = STRIP_KEYS[id]}
      {#if id === "ctrl"}
        <button
          type="button"
          class="key"
          class:armed={stickyCtrl()}
          aria-pressed={stickyCtrl()}
          title={stickyCtrl() ? t("app.mobile.key.ctrl.armed") : t("app.mobile.key.ctrl")}
          disabled={!target}
          onpointerdown={keep}
          onclick={() => setStickyCtrl(!stickyCtrl())}>{k.label}</button
        >
      {:else if k.band}
        {@const band = k.band}
        <button
          type="button"
          class="key"
          title={t(k.name)}
          aria-label={t(k.name)}
          disabled={!target}
          onpointerdown={keep}
          onclick={() => press(band)}>{k.label}</button
        >
      {/if}
    {/each}
  </div>
</div>

<style>
  .mobile-keys {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px));
    background: var(--glass-band, var(--bg-panel));
    border-top: 1px solid var(--border);
  }
  .mobile-keys.hidden {
    display: none;
  }
  .keys {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .key {
    flex: 1 1 0; /* 390px 폭에 다 들어가게 — 넘치면(더 좁으면) 띠가 가로로 밀린다 */
    min-width: 32px;
    height: 40px;
    padding: 0 2px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-raised-solid);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    touch-action: manipulation;
  }
  .key.armed {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-raised-solid));
  }
  .key.mode {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    font-size: 15px;
    font-weight: 600;
  }
  .key:disabled,
  .insert:disabled,
  .send:disabled {
    opacity: 0.45;
  }
  .line {
    display: flex;
    gap: 6px;
  }
  .field {
    flex: 1 1 0;
    min-width: 0;
    height: 40px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-field, var(--bg));
    color: var(--fg);
    font: inherit;
    font-size: 16px; /* 16px 미만이면 iOS 가 칸을 누를 때 화면을 확대한다 */
  }
  .insert {
    flex: 0 0 auto;
    height: 40px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--surface-raised-solid);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
    touch-action: manipulation;
  }
  .send {
    flex: 0 0 auto;
    height: 40px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--on-accent, #fff);
    font: inherit;
    font-size: 14px;
    touch-action: manipulation;
  }
</style>
