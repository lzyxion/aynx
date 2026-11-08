<!--
  **모바일 키 띠 · 입력 칸**(원격 웹 R5 — 원격 창 · 폭 < 720px). 화면 아래에 선다.

  - **입력 방식**(10-20 — `app/mobile` 의 `inputMode`, 이 브라우저에만 · 폰 설정 › 이 기기의 "입력 방식" 과 같은 값): 띠의 **맨 왼쪽** 고정
    단추(입력 칸 = '가' · 바로 입력 = 키보드 아이콘)가 둘을 오간다. 안드로이드 키보드(추천 낱말 줄)로 xterm 에 바로 치면 불안정해서
    **입력 칸이 기본**이다.
    - 입력 칸(`field`): 칸 줄이 늘 띠 위에 선다. 터미널을 누르면 xterm 대신 이 칸에 포커스가 간다(`Terminal` 의 focusin → `focusLineField`).
      [넣기] = 글만(Enter 없이 — Tab 완성 · vim 명령 앞) · [보내기](키보드의 Enter · 폼 제출) = 글 + Enter. 둘 다 붙여넣기와 같은 길
      (`sendText` — 괄호 붙여넣기 모드면 감싼다). 보낸 뒤 칸을 비우고 포커스를 칸에 둔다(키보드가 내려가지 않게). 칸이 빈 채
      Backspace = 셸에 DEL(이미 보낸 글자 지우기) · 빈 칸의 Enter = Enter 하나. 끈적 Ctrl 이 걸린 채 빈 칸에 글자 하나를 쓰면 곧장
      Ctrl+글자로 보내고 칸을 비운다(판정은 순수 `mobile/line-field` · 조합 중(`isComposing`)의 키 · 글은 손대지 않는다).
    - 바로 입력(`direct`): 칸 줄이 없다 — 터미널을 눌러 화면 키보드로 xterm 에 바로 친다(`term/handheld-input`).
  - 키 띠: (입력 방식) · Ctrl(끈적 — 한 번 누르면 다음 키 하나에 붙는다 · 다시 누르면 푼다) · Esc · Tab · 화살표 · Ctrl+C · Enter. 보내는 곳은
    지금 보이는 타일(활성 탭의 포커스 타일)의 터미널 — 사람 키 입력과 같은 문(`term-actions` 의 `bandKey` · `sendKeys` · 출처 `keyboard`).
    입력 방식 단추 뒤의 순서 · 숨김은 폰 설정의 키 띠(`app/mobile` 의 `keyStrip`)가 정한다. 넘치면 띠가 가로로 밀린다.
  - 단추는 누를 때 포커스를 가져가지 않는다(`pointerdown` 기본 동작 막기) — 칸 · 터미널을 치던 화면 키보드가 내려가지 않게.
  - **지금 타일이 AI 타일의 대화 면이면 띠 전체가 숨는다**(2026-11-04 사용자 결정 — 목업 YLJE1mCKsE1NJXQzMiDM5c B안): 칸 · 키가 보이지 않는 CLI 로 곧장 들어가고 입력 칸도 둘이 된다.
    언마운트하지 않고 숨긴다(치던 글 · `registerLineField` 가 그대로 — 터미널로 돌아오면 그 자리). 숨을 때 걸린 끈적 Ctrl 은 푼다 — 안 그러면 대화 입력 칸의 글이 Ctrl 로 나간다.
    그 사이 터미널은 상자 크기를 따라가지 않는다(`Terminal` 의 `refit` — 넘길 때마다 PTY 크기가 흔들리지 않게).
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

  /** 지금 보이는 터미널 타일 — 없으면(파일 · 문서 타일 등) 키 띠가 흐리다 */
  const target = $derived.by(() => {
    const tab = currentWorkspaceTabs().find((x) => x.id === activeTabId());
    if (!tab) return null;
    const id = paneOf(tab);
    const pane = listPanes(tab.root).find((p) => p.id === id);
    return pane && hasSession(pane.kind) ? pane.id : null;
  });

  /** 지금 타일이 대화 면이다 — 띠를 숨긴다(칸 · 키가 보이지 않는 CLI 로 새지 않게) */
  const hidden = $derived(target !== null && flipViewOf(target) === "convo");
  $effect(() => {
    if (hidden && stickyCtrl()) setStickyCtrl(false);
  });

  const fieldMode = $derived(inputMode() === "field");
  let text = $state("");
  /** 바로 앞 input 사건 때의 글(끈적 Ctrl 판정 — 빈 칸에서 글자 하나가 막 생겼나) */
  let prevText = "";
  let field = $state<HTMLInputElement | null>(null);

  // 터미널이 포커스를 넘길 칸(`app/mobile` 의 `focusLineField`)
  $effect(() => {
    if (field) return registerLineField(field);
  });

  /** 띠에 서는 단추(순서대로 · 숨긴 것 뺌) */
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

  /** [보내기] · 키보드 Enter(폼 제출) — 글 + Enter. 빈 칸이면 Enter 하나 */
  function send() {
    if (!target) return;
    termActionsOf(target)?.sendText(text, true);
    clearField();
  }

  /** [넣기] — 글만(Enter 없이) */
  function insert() {
    if (!target || text === "") return;
    termActionsOf(target)?.sendText(text, false);
    clearField();
  }

  /** 이 키(keydown → keyup 사이)로 이미 DEL 을 보냈다 — 같은 지우기의 beforeinput · input 이 한 번 더 보내지 않게 */
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

  /** 키보드가 Backspace 키 없이 지우기 입력만 낼 때(빈 칸 — 브라우저는 바꿀 것이 없다) — 셸의 한 글자를 지운다 */
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
    // beforeinput 없이 온 빈 칸의 뒤로 지우기(값이 그대로 빈 채) — 위와 같은 대신
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
  /* 입력 방식 — 맨 왼쪽 고정 · 다른 키보다 조금 넓게 */
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
