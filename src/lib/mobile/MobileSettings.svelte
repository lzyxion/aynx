<!--
  **폰 설정 화면**(원격 웹 R5 · 10-20) — 전체 화면 덮개. 들어오는 길은 셋: "새 탭에 열기" 시트의 [설정] · 고르기 화면 머리의 톱니 · 독 머리 줄의 톱니(`Dock` 의 `runTool` — 폰 배치일 때).
  줄은 높이 52px 이상 · 묶음마다 둥근 판 · 묶음 이름은 강조색.

  - **이 기기**(이 브라우저의 `localStorage` 에만 — 집 PC 의 `settings.toml` 에 쓰지 않는다 · `app/mobile`):
    터미널 글자 크기 [− n +](이 기기 터미널만 — 메인 PC 값과 같아지면 이 기기 값을 지운다) · 이 기기 크기로 맞추기(위 띠 `⤢` 와 같은
    값) · 입력 방식 [입력 칸 · 바로 입력](키 띠 맨 왼쪽 단추와 같은 값 — 기본 입력 칸 · `mobile/MobileKeys`) · 키 띠 ›(작은 하위 화면 —
    단추마다 켜고 끄기 · 위로 · 아래로 · 맨 왼쪽 입력 방식 단추는 고정이라 없다) · 테마 [시스템 · 밝게 · 어둡게](화면에만 — `mode.svelte.ts`).
  - **메인 PC**: 자동 승인 — `[automation]` 은 원격 창의 칸 단위 문(`remote/deny.rs` 의 `settings_home_only`)이 막는 집 PC 전용 칸이라
    스위치가 아니라 **읽기 전용 줄**(지금 상태 + "메인 PC 에서"). 알림 ›(전체 설정의 알림 칸).
  - **이 기기 관리**: 지금 잠그기(상태바 자물쇠와 같은 문 — 가림막 + 볼트 잠금) · 연결 끊기(상태바 원격 칩과 같은 `POST /remote/lock`
    — 이 원격 세션을 닫고 잠금 해제 쪽으로) · 이 기기 페어링 해제(원격 허용 `remote_device_revoke` — 이 기기의 id 는 관문의 부팅 표).
    끊기 · 해제는 앱 확인 상자(`askConfirm`)로 한 번 묻는다.
  - 꼬리: [전체 설정 열기 ›](설정 모달).
-->
<script lang="ts">
  import { pushOut } from "$lib/mobile/motion";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { remoteDeviceId, remoteDeviceName } from "$lib/ipc";
  import { settings } from "$lib/settings.svelte.js";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import { raiseVeil } from "$lib/app/veil.svelte.js";
  import { lockThisRemote, revokeRemoteDevice } from "$lib/app/remote-access.svelte.js";
  import { openDock } from "$lib/app/dock.svelte.js";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { showNotice } from "$lib/app/notice";
  import {
    aiFacePref,
    fitThisDevice,
    inputMode,
    keyStrip,
    setAiFacePref,
    setFitThisDevice,
    setInputMode,
    setKeyStrip,
    setThemeChoice,
    stepTerminalFont,
    terminalFontSize,
    themeChoice,
  } from "$lib/app/mobile.svelte.js";
  import { closeMobileOverlay } from "$lib/app/mobile-sheets.svelte.js";
  import {
    AI_FACES,
    FONT_MAX,
    FONT_MIN,
    INPUT_MODES,
    moveStrip,
    THEME_PREFS,
    toggleStrip,
    visibleStrip,
    type AiFace,
    type InputMode,
    type StripId,
    type ThemePref,
  } from "$lib/mobile/prefs";
  import { STRIP_KEYS } from "$lib/mobile/strip-keys";

  /** 하위 화면 — 키 띠 고르기 */
  let view = $state<"main" | "keys">("main");

  const font = $derived(terminalFontSize());
  const strip = $derived(keyStrip());
  const shown = $derived(visibleStrip(strip));
  const autoApprove = $derived(settings.automationPrefs.auto_approve === true);
  const deviceId = remoteDeviceId();

  const THEME_LABEL: Record<ThemePref, Key> = {
    main: "app.mobile.settings.theme.main",
    system: "app.mobile.settings.theme.system",
    light: "app.mobile.settings.theme.light",
    dark: "app.mobile.settings.theme.dark",
  };

  const INPUT_LABEL: Record<InputMode, Key> = {
    field: "app.mobile.settings.inputMode.field",
    direct: "app.mobile.settings.inputMode.direct",
  };

  const AI_FACE_LABEL: Record<AiFace, Key> = {
    convo: "app.mobile.settings.aiFace.convo",
    term: "app.mobile.settings.aiFace.term",
  };

  function lockNow() {
    closeMobileOverlay();
    raiseVeil();
  }

  async function disconnect() {
    const ok = await askConfirm(t("app.mobile.settings.disconnect.body"), {
      title: t("app.mobile.settings.disconnect"),
      okLabel: t("app.mobile.settings.disconnect.ok"),
      kind: "warning",
    }).catch(() => false);
    if (ok) await lockThisRemote();
  }

  async function unpair() {
    if (!deviceId) return;
    const ok = await askConfirm(t("app.mobile.settings.unpair.body", { name: remoteDeviceName() || "?" }), {
      title: t("app.mobile.settings.unpair"),
      okLabel: t("app.mobile.settings.unpair.ok"),
      kind: "warning",
      danger: true,
    }).catch(() => false);
    if (!ok) return;
    try {
      await revokeRemoteDevice(deviceId);
    } catch (e) {
      showNotice(String(e));
    }
  }

  function fullSettings() {
    closeMobileOverlay();
    openDock("settings");
  }

  function notifySettings() {
    closeMobileOverlay();
    openSettingsAt("notifications");
  }

  function move(id: StripId, by: -1 | 1) {
    setKeyStrip(moveStrip(strip, id, by));
  }

  let closeBtn = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    closeBtn?.focus({ preventScroll: true });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    if (view !== "main") view = "main";
    else closeMobileOverlay();
  }
</script>

<div class="msettings" out:pushOut|global role="dialog" aria-modal="true" aria-labelledby="mobile-settings-title" tabindex="-1" {onkeydown}>
  <header class="head">
    {#if view !== "main"}
      <button type="button" class="round" title={t("app.mobile.back")} aria-label={t("app.mobile.back")} onclick={() => (view = "main")}
        ><UiIcon name="chevron-left" size={20} /></button
      >
      <h2 id="mobile-settings-title" class="title">{t("app.mobile.settings.keys")}</h2>
    {:else}
      <h2 id="mobile-settings-title" class="title">{t("app.mobile.settings.title")}</h2>
    {/if}
    <span class="spacer"></span>
    <button
      type="button"
      class="round"
      bind:this={closeBtn}
      title={t("app.mobile.picker.close")}
      aria-label={t("app.mobile.picker.close")}
      onclick={closeMobileOverlay}><UiIcon name="close" size={18} /></button
    >
  </header>

  <div class="body">
    {#if view === "keys"}
      <p class="hint">{t("app.mobile.settings.keys.hint")}</p>
      <ul class="panel keys">
        {#each strip.order as id, i (id)}
          {@const k = STRIP_KEYS[id]}
          {@const on = !strip.hidden.includes(id)}
          <li class="row">
            <span class="chip" class:off={!on}>{k.label}</span>
            <span class="row-name">{t(k.name)}</span>
            <button
              type="button"
              class="mini"
              disabled={i === 0}
              aria-label={t("app.mobile.settings.keys.up", { name: t(k.name) })}
              onclick={() => move(id, -1)}><UiIcon name="chevron-up" size={18} /></button
            >
            <button
              type="button"
              class="mini"
              disabled={i === strip.order.length - 1}
              aria-label={t("app.mobile.settings.keys.down", { name: t(k.name) })}
              onclick={() => move(id, 1)}><UiIcon name="chevron-down" size={18} /></button
            >
            <Toggle checked={on} label={t("app.mobile.settings.keys.show", { name: t(k.name) })} onchange={() => setKeyStrip(toggleStrip(strip, id))} />
          </li>
        {/each}
      </ul>
    {:else}
      <h3 class="label">{t("app.mobile.settings.device")}</h3>
      <div class="panel">
        <div class="row">
          <span class="row-name">{t("app.mobile.settings.font")}</span>
          <div class="stepper" role="group" aria-label={t("app.mobile.settings.font")}>
            <button type="button" class="mini" disabled={font <= FONT_MIN} aria-label={t("app.mobile.settings.font.down")} onclick={() => stepTerminalFont(-1)}
              >−</button
            >
            <span class="value" aria-live="polite">{font}</span>
            <button type="button" class="mini" disabled={font >= FONT_MAX} aria-label={t("app.mobile.settings.font.up")} onclick={() => stepTerminalFont(1)}
              >+</button
            >
          </div>
        </div>
        <div class="row">
          <span class="row-text">
            <span class="row-name">{t("app.mobile.fit")}</span>
          </span>
          <Toggle checked={fitThisDevice()} label={t("app.mobile.fit")} onchange={(on) => setFitThisDevice(on)} />
        </div>
        <div class="row">
          <span class="row-name">{t("app.mobile.settings.inputMode")}</span>
          <div class="seg" role="radiogroup" aria-label={t("app.mobile.settings.inputMode")}>
            {#each INPUT_MODES as mode (mode)}
              <button
                type="button"
                role="radio"
                class:selected={inputMode() === mode}
                aria-checked={inputMode() === mode}
                onclick={() => setInputMode(mode)}>{t(INPUT_LABEL[mode])}</button
              >
            {/each}
          </div>
        </div>
        <div class="row">
          <span class="row-name">{t("app.mobile.settings.aiFace")}</span>
          <div class="seg" role="radiogroup" aria-label={t("app.mobile.settings.aiFace")} data-mobile-ai-face>
            {#each AI_FACES as face (face)}
              <button
                type="button"
                role="radio"
                class:selected={aiFacePref() === face}
                aria-checked={aiFacePref() === face}
                onclick={() => setAiFacePref(face)}>{t(AI_FACE_LABEL[face])}</button
              >
            {/each}
          </div>
        </div>
        <button type="button" class="row link" onclick={() => (view = "keys")}>
          <span class="row-text">
            <span class="row-name">{t("app.mobile.settings.keys")}</span>
            <span class="chips" aria-hidden="true">
              {#each shown as id (id)}<span class="chip small">{STRIP_KEYS[id].label}</span>{/each}
            </span>
          </span>
          <UiIcon name="chevron" size={16} />
        </button>
        <div class="row">
          <span class="row-name">{t("app.mobile.settings.theme")}</span>
          <div class="seg" role="radiogroup" aria-label={t("app.mobile.settings.theme")}>
            {#each THEME_PREFS as pref (pref)}
              <button
                type="button"
                role="radio"
                class:selected={themeChoice() === pref}
                aria-checked={themeChoice() === pref}
                onclick={() => setThemeChoice(pref)}>{t(THEME_LABEL[pref])}</button
              >
            {/each}
          </div>
        </div>
      </div>

      <h3 class="label">{t("app.mobile.settings.home")}</h3>
      <div class="panel">
        <!-- 자동 승인 — 집 PC 전용 칸(`[automation]`) · 원격에서는 보기만 -->
        <div class="row">
          <span class="row-text">
            <span class="row-name">{t("app.mobile.settings.autoApprove")}</span>
            <span class="row-sub">{autoApprove ? t("app.mobile.settings.on") : t("app.mobile.settings.off")}</span>
          </span>
          <span class="muted">{t("app.mobile.settings.homeOnly")}</span>
        </div>
        <button type="button" class="row link" onclick={notifySettings}>
          <span class="row-name">{t("app.mobile.settings.notify")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
      </div>

      <h3 class="label">{t("app.mobile.settings.manage")}</h3>
      <div class="panel">
        <button type="button" class="row link" onclick={lockNow}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="lock" size={18} /></span>
          <span class="row-name">{t("app.mobile.settings.lock")}</span>
        </button>
        <button type="button" class="row link" onclick={() => void disconnect()}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="power" size={18} /></span>
          <span class="row-name">{t("app.mobile.settings.disconnect")}</span>
        </button>
        {#if deviceId}
          <button type="button" class="row link danger" onclick={() => void unpair()}>
            <span class="row-ico" aria-hidden="true"><UiIcon name="remote" size={18} /></span>
            <span class="row-name">{t("app.mobile.settings.unpair")}</span>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if view === "main"}
    <footer class="foot">
      <button type="button" class="pill" onclick={fullSettings}>
        {t("app.mobile.settings.full")}
        <UiIcon name="chevron" size={16} />
      </button>
    </footer>
  {/if}
</div>

<style>
  .msettings {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--app-h, 100dvh);
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--m3-surface);
    color: var(--fg-1);
    outline: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .msettings {
      animation: msettings-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes msettings-in {
    from {
      /* 화면 폭 전체가 오른쪽에서 밀려 들어온다(밀어 넣는 화면) — 아래에서 올라오는 것은 새 탭 시트뿐 */
      transform: translateX(100%);
    }
  }
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2) var(--space-4);
  }
  .title {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--fw-semibold);
  }
  .spacer {
    flex: 1 1 auto;
  }
  .round {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 var(--space-3) var(--space-3);
  }
  .label {
    margin: var(--space-3) 0 var(--space-2) var(--space-2);
    color: var(--accent);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
  }
  .hint {
    margin: var(--space-2) var(--space-2) var(--space-3);
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .panel {
    margin: 0;
    padding: 4px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container-low);
  }
  .row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 6px var(--space-3);
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: transparent;
    color: var(--fg-1);
    font: inherit;
    text-align: left;
  }
  .row.link {
    cursor: pointer;
  }
  .row.danger {
    color: var(--danger, var(--err, #e5534b));
  }
  .row.danger .row-ico {
    color: inherit;
  }
  .row-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row-name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }
  .row-sub {
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  .row-ico {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-2);
  }
  .muted {
    flex: 0 0 auto;
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  .stepper {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
  }
  .value {
    min-width: 28px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: var(--fw-semibold);
  }
  .mini {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-1);
    font: inherit;
    font-size: 20px;
    cursor: pointer;
  }
  .mini:disabled {
    opacity: 0.35;
  }
  /* 이어 붙은 묶음(2026-10-28 — 설정 칩과 같은 규칙 · 목업 6eWvPcEZZeQ7sgGckwkBed): 2px 틈, 바깥 끝 = 반원 · 맞닿는 쪽 = 6px, 고른 칸만 알약 */
  .seg {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
  }
  .seg button {
    min-width: 0;
    height: 38px;
    padding: 0 12px;
    border: 0;
    background: var(--m3-surface-container-high);
    color: var(--fg-2);
    font: inherit;
    font-size: var(--t-xs);
    cursor: pointer;
  }
  .seg > button {
    border-radius: 6px;
    transition: border-radius 200ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 120ms ease;
  }
  .seg > button:first-child {
    border-top-left-radius: 19px;
    border-bottom-left-radius: 19px;
  }
  .seg > button:last-child {
    border-top-right-radius: 19px;
    border-bottom-right-radius: 19px;
  }
  .seg > button.selected {
    border-radius: 19px;
  }
  .seg button.selected {
    background: var(--control-sel-bg);
    color: var(--control-sel-fg);
    font-weight: var(--fw-semibold);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 30px;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-1);
    font-size: 13px;
  }
  .chip.small {
    min-width: 0;
    height: 22px;
    padding: 0 6px;
    font-size: 11px;
    color: var(--fg-2);
  }
  .chip.off {
    opacity: 0.4;
  }
  .keys .row {
    gap: var(--space-2);
  }
  .foot {
    flex: 0 0 auto;
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .pill {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 48px;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    font-size: var(--t-md);
    cursor: pointer;
  }
  .round:focus-visible,
  .row:focus-visible,
  .mini:focus-visible,
  .seg button:focus-visible,
  .pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
