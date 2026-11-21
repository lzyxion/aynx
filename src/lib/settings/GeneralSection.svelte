<script lang="ts">
  import Dropdown from "$lib/Dropdown.svelte";
  import {
    settings,
    LANGUAGES,
    LANGUAGE_AUTO,
    LANGUAGE_NAMES,
    setLanguage,
    setAutoReconnect,
    setTrayOnClose,
    setUiScale,
    setUiFontFamily,
    setFileDefaultView,
    setFileAutoRefresh,
    FILE_VIEWS,
    setProjectStartScreen,
    PROJECT_START_SCREENS,
  } from "$lib/settings.svelte.js";
  import { DEFAULT_UI_FONT_FAMILY, UI_SCALES } from "$lib/ui-scale";
  import { optionEntries, t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import { tipOf } from "$lib/settings/TipName.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";
  import ValueSlider from "$lib/settings/ValueSlider.svelte";
  import { clearHostHistory } from "$lib/app/host-history.svelte.js";
  import SessionServerRow from "$lib/settings/SessionServerRow.svelte";
  import UpdatesRows from "$lib/settings/UpdatesRows.svelte";
  import { openSettingsExport, openSettingsImport } from "$lib/app/settings-transfer.svelte.js";
  import { invoke, isRemote } from "../ipc";
  import { onMount } from "svelte";

  /** 일반 섹션 — 앱 전체에 걸치는 값. 값은 미리보기 계약이다(고르는 즉시 걸리고 파일에는 [저장]이 쓴다) */

  // ── 트레이 — 이 환경에 트레이가 있는가는 Rust 가 안다(`tray_status` — 프런트는 OS 를 모른다) ──
  let traySupported = $state(true);
  onMount(() => {
    invoke<{ supported: boolean }>("tray_status")
      .then((s) => (traySupported = s?.supported !== false))
      .catch(() => (traySupported = false));
  });

  // ── 접속 이력 지우기 — 파일 하나를 즉시 비우는 동작이라 [저장]·[취소] 바깥이다 ──

  let historyArmed = $state(false);
  let historyCleared = $state(false);
  let historyError = $state<string | null>(null);

  async function onClearHistory() {
    if (!historyArmed) {
      historyArmed = true;
      historyCleared = false;
      return;
    }
    historyArmed = false;
    historyError = null;
    try {
      await clearHostHistory();
      historyCleared = true;
    } catch (e) {
      historyError = t("settings.general.history.clear.failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function uiScaleLabel(pct: number): string {
    return t("settings.general.ui_scale.option", { pct });
  }

  const FILE_VIEW_ENTRIES = optionEntries(FILE_VIEWS);
  const PROJECT_START_ENTRIES = optionEntries(PROJECT_START_SCREENS);

  const FILE_VIEW_ICONS: ChoiceIcons = { icons: "grid", compact: "view-compact", details: "list" };
  const PROJECT_START_ICONS: ChoiceIcons = { auto: "conversations", off: "terminal" };
</script>

<h4 class="subhead first">{t("settings.general.display.heading")}</h4>

<!-- 언어 이름은 언제나 제 글자로 적는다(`LANGUAGE_NAMES`) — 어느 언어로 보든 자기 이름은 자기 글자여야 고를 수 있다 -->
<SettingRow
  id="app-language"
  label={t("settings.general.language.label")}
  tip={tipOf(t("settings.general.language.summary"), t("settings.general.language.note"))}
>
  {#snippet control()}
    <Dropdown
      id="app-language"
      value={settings.current.app.language ?? LANGUAGE_AUTO}
      options={[
        { value: LANGUAGE_AUTO, label: t("settings.general.language.option.auto") },
        ...Object.keys(LANGUAGES).map((key) => ({ value: key, label: LANGUAGE_NAMES[key as keyof typeof LANGUAGES] })),
      ]}
      onchange={(v) => setLanguage(v)}
    />
  {/snippet}
</SettingRow>

<!-- UI 크기는 놓을 때만 건다(`commit="change"`) — 끄는 동안 웹뷰 배율이 바뀌면 슬라이더가 포인터 밑에서 커졌다 작아져 흔들린다 -->
<SettingRow
  id="app-ui-scale"
  label={t("settings.general.ui_scale.label")}
  tip={tipOf(t("settings.general.ui_scale.summary"), t("settings.general.ui_scale.note"))}
>
  {#snippet control()}
    <ValueSlider
      id="app-ui-scale"
      steps={UI_SCALES}
      value={settings.uiScale}
      format={uiScaleLabel}
      commit="change"
      onchange={setUiScale}
    />
  {/snippet}
</SettingRow>

<SettingRow
  id="app-ui-font"
  label={t("settings.general.ui_font.label")}
  tip={tipOf(t("settings.general.ui_font.summary"), t("settings.general.ui_font.note") + "'Pretendard', sans-serif")}
>
  {#snippet control()}
    <input
      id="app-ui-font"
      class="value ui-font"
      value={settings.current.app.ui_font_family ?? ""}
      placeholder={DEFAULT_UI_FONT_FAMILY}
      autocomplete="off"
      spellcheck="false"
      oninput={(e) => setUiFontFamily(e.currentTarget.value)}
    />
  {/snippet}
</SettingRow>

<h4 class="subhead">{t("settings.general.startup.heading")}</h4>

<SettingRow
  id="app-auto-reconnect"
  label={t("settings.general.reconnect.label")}
  tip={tipOf(
    t("settings.general.reconnect.summary") + t("settings.general.reconnect.summary.term"),
    t("settings.general.reconnect.note"),
  )}
>
  {#snippet control()}
    <Toggle id="app-auto-reconnect" checked={settings.autoReconnect} onchange={setAutoReconnect} />
  {/snippet}
</SettingRow>

<SettingRow
  id="app-host-history"
  label={t("settings.general.history.label")}
  tip={tipOf(t("settings.general.history.summary"), t("settings.general.history.note"))}
>
  {#snippet control()}
    <button
      type="button"
      id="app-host-history"
      class="btn btn-sm btn-secondary danger"
      onclick={() => void onClearHistory()}
      onblur={() => (historyArmed = false)}
    >
      {historyArmed
        ? t("settings.general.history.clear.confirm")
        : historyCleared
          ? t("settings.general.history.clear.done")
          : t("settings.general.history.clear")}
    </button>
  {/snippet}
</SettingRow>
{#if historyError}
  <p class="lead" role="alert">{historyError}</p>
{/if}

<SettingRow
  id="project-start-screen"
  label={t("settings.general.project_start.label")}
  tip={tipOf(t("settings.general.project_start.summary"), t("settings.general.project_start.note"))}
>
  {#snippet control()}
    <ChoiceChips
      id="project-start-screen"
      label={t("settings.general.project_start.label")}
      entries={PROJECT_START_ENTRIES}
      icons={PROJECT_START_ICONS}
      value={settings.projectStartScreen}
      onpick={setProjectStartScreen}
    />
  {/snippet}
</SettingRow>

<SettingRow
  id="app-tray-on-close"
  label={t("settings.general.tray.label")}
  tip={tipOf(t("settings.general.tray.summary"), t("settings.general.tray.note"))}
>
  {#snippet control()}
    <Toggle
      id="app-tray-on-close"
      checked={traySupported && settings.trayOnClose}
      disabled={!traySupported}
      onchange={setTrayOnClose}
    />
  {/snippet}
</SettingRow>
{#if !traySupported}
  <p class="lead" role="note" data-tray-unsupported>{t("settings.general.tray.unsupported")}</p>
{/if}

<h4 class="subhead">{t("settings.general.files.heading")}</h4>

<SettingRow
  id="files-default-view"
  label={t("settings.general.files_view.label")}
  tip={tipOf(t("settings.general.files_view.summary"), t("settings.general.files_view.note"))}
>
  {#snippet control()}
    <ChoiceChips
      id="files-default-view"
      label={t("settings.general.files_view.label")}
      entries={FILE_VIEW_ENTRIES}
      icons={FILE_VIEW_ICONS}
      value={settings.fileDefaultView}
      onpick={setFileDefaultView}
    />
  {/snippet}
</SettingRow>

<!-- 원격 파일 타일은 이 값과 상관없이 늘 ⟳ 로만 읽는다 -->
<SettingRow
  id="files-auto-refresh"
  label={t("settings.general.files_refresh.label")}
  tip={tipOf(t("settings.general.files_refresh.summary"), t("settings.general.files_refresh.note"))}
>
  {#snippet control()}
    <Toggle id="files-auto-refresh" checked={settings.fileAutoRefresh} onchange={setFileAutoRefresh} />
  {/snippet}
</SettingRow>

<h4 class="subhead">{t("settings.general.server.heading")}</h4>
<SessionServerRow />

<!-- 원격 창에서는 그리지 않는다 — 업데이트는 메인 PC 의 앱을 바꾸는 일이다 -->
{#if !isRemote}
  <UpdatesRows />
{/if}

<!-- 설정 옮기기 — [저장] · [취소] 바깥의 동작. 원격 창에서는 그리지 않는다 — 메인 PC 전용 명령이다(`remote/deny.rs` HOME_ONLY) -->
{#if !isRemote}
  <h4 class="subhead">{t("settings.general.transfer.heading")}</h4>
  <SettingRow
    id="settings-export"
    label={t("settings.general.transfer.export.label")}
    tip={tipOf(t("settings.general.transfer.export.tip"))}
  >
    {#snippet control()}
      <button type="button" id="settings-export" class="btn btn-sm btn-secondary" onclick={() => void openSettingsExport()}>
        {t("settings.general.transfer.export.button")}
      </button>
    {/snippet}
  </SettingRow>
  <SettingRow
    id="settings-import"
    label={t("settings.general.transfer.import.label")}
    tip={tipOf(t("settings.general.transfer.import.tip"))}
  >
    {#snippet control()}
      <button type="button" id="settings-import" class="btn btn-sm btn-secondary" onclick={() => void openSettingsImport()}>
        {t("settings.general.transfer.import.button")}
      </button>
    {/snippet}
  </SettingRow>
{/if}

<style>
  /* `.value`(width:100%)를 그대로 두면 라벨과 폭을 다툰다 · `max-width: 55%` 는 격자 칸이 내용 폭이라 순환 계산이 된다 */
  .value.ui-font {
    width: 16em;
    max-width: 100%;
  }
</style>
