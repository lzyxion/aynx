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
  import { invoke } from "../ipc";
  import { onMount } from "svelte";

  /**
   * **일반** 섹션 — 앱 **전체**에 걸치는 값. 소제목 넷(2026-11-12 — 사용자 결정): **화면**(언어 · UI 크기 · 앱 글꼴) ·
   * **시작과 접속**(SSH 자동 재접속 · 접속 이력 · 프로젝트 시작 화면 · 트레이) · **파일 타일**(기본 보기 · 자동 새로고침) ·
   * **세션 서버**(상태 · [다시 시작] · [모든 세션 종료]).
   *
   * **UI 크기·앱 글꼴이 여기 있는 이유** (docs/log/2026-09-25-ui-scale-font.md): 둘 다 어느
   * 한 화면이 아니라 앱의 **모든 글자**에 먹고, 언어와 같은 "앱을 어떻게 읽는가" 층이다.
   * 앱 테마 섹션은 색·배경·크롬 모양(탭·상태바·타일)의 자리이고 이미 가장 길다 — "글자가
   * 작다" 를 고치러 온 사람이 월페이퍼·색 선택기 사이를 뒤질 일이 아니다. 터미널 글꼴과
   * 나란히 두지 않은 이유도 같다: 그쪽은 터미널 안만, 이쪽은 터미널 밖만 바꾼다.
   *
   * 목록의 **첫 칸**인 것이 요점이다: 여기 있는 값은 어느 한 화면(테마·터미널)의 것이
   * 아니라 앱 전부에 먹는다. 언어는 특히 그렇다 — 아래 섹션들의 이름부터 이 값으로 그려지므로
   * 다른 손잡이보다 먼저 서야 한다 (예전에는 앱 테마 안, 모드 바로 위였다 —
   * docs/log/2026-09-17-i18n.md 의 "자리").
   *
   * **탭(workspace)·잠금(lock) 섹션이 여기로 접혔다** (docs/log/2026-09-17-settings-general.md).
   * 둘 다 손잡이가 하나뿐이라 사이드 내비 한 칸씩을 쓰면서 정작 화면은 거의 비어 있었다.
   * 둘의 공통점이 "어느 한 화면이 아니라 앱이 켜지고 자리를 비우는 동안의 동작" 이라 일반이
   * 제자리였다. 잠금 쪽(무입력 자동 잠금)은 2026-11-12 에 **보안** 섹션으로 옮겼다 — 아래 볼트 절.
   *
   * **볼트 묶음은 반대로 여기서 나갔다** (2026-09-19 밤) — 보안 섹션
   * (`CredentialsSection`)을 받았다. 그때 **무입력 자동 잠금은 남았지만**(화면 가림막의 시점이라), 가림막이 곧 볼트
   * 잠금이고 걷는 것이 곧 볼트를 여는 것이라(docs/invariants.md 2절) 2026-11-12 에 그 칸도 보안 섹션 끝으로 따라갔다.
   * 줄 id(`lock-idle`)는 그대로다.
   *
   * 값은 `settings.svelte.ts` 의 모듈 상태에 있고 여기서는 setter 만 부른다 (`SettingsModal`
   * 의 미리보기 계약: 고르는 즉시 화면에 걸리고, 파일에는 [저장]이 쓴다).
   */


  // ---------------------------------------------------------------------------
  // 트레이 (③-4) — 이 환경에 트레이가 있는가는 Rust 가 안다(`tray_status` — 프런트는 OS 를 모른다). 없으면 토글을
  // 흐리고 한 줄 밝힌다(창을 닫으면 GUI 가 끝나고 세션은 서버에 남는다).
  // ---------------------------------------------------------------------------
  let traySupported = $state(true);
  onMount(() => {
    invoke<{ supported: boolean }>("tray_status")
      .then((s) => (traySupported = s?.supported !== false))
      .catch(() => (traySupported = false));
  });

  // ---------------------------------------------------------------------------
  // 접속 이력 지우기 (docs/log/2026-09-23-host-history.md)
  //
  // 설정값이 아니라 **파일 하나를 즉시 비우는 동작**이라
  // [저장]·[취소] 바깥이다. 확인은 대화상자가 아니라 **한 번 더 누르기**다(볼트의 "모두
  // 삭제"·위임 표의 [제거]와 같은 문법 — 버튼 글자가 그 자리에서 "정말 지우기" 로 바뀐다).
  // ---------------------------------------------------------------------------

  /** 한 번 눌러 확인을 기다리는 중인가 */
  let historyArmed = $state(false);
  /** 지웠는가 (버튼 글자로 확인을 준다) */
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

  /** UI 크기 슬라이더의 글자 (`110%`) */
  function uiScaleLabel(pct: number): string {
    return t("settings.general.ui_scale.option", { pct });
  }

  const FILE_VIEW_ENTRIES = optionEntries(FILE_VIEWS);
  const PROJECT_START_ENTRIES = optionEntries(PROJECT_START_SCREENS);

  /** 고르는 칩의 앞 아이콘 — 값 키 → `UiIcon` 이름 (`ChoiceChips` 의 `icons`) */
  const FILE_VIEW_ICONS: ChoiceIcons = { icons: "grid", compact: "view-compact", details: "list" };
  const PROJECT_START_ICONS: ChoiceIcons = { auto: "conversations", off: "terminal" };
</script>

<!--
  **이 섹션의 줄에는 늘 보이는 설명 줄도 ⓘ 도 없다** — 설명(요약 + 자세히)은 **이름에 얹는
  툴팁**(`SettingRow` 의 `tip` → `TipName.svelte`, 앱 테마·터미널 섹션과 공용)이다. 코드 조각으로
  쪼개 그리던 설명은 평문으로 잇는다. 선택지가 둘셋인 칸은 **칩 줄**(`ChoiceChips.svelte`, `id` 는
  묶음 — 설정 색인 anchor), 선택지가 많은 언어는 드롭다운, 수치 구간인 UI 크기·자동 잠금은
  **후보 슬라이더**(`ValueSlider.svelte` 의 `steps`)다. 옛 섹션 머리말(lead)은 섹션 일반 설명이라 걷었다.
  **지금의 상태**(접속 이력 지우기 실패)는 도움말이 아니라서 줄 밑에 그대로 보인다.
-->

<!--
  **소제목 넷**(2026-11-12 — 사용자 결정): 화면 · 시작과 접속 · 파일 타일 · 세션 서버. 줄 id(=설정 색인 anchor)는 옮기기 전
  그대로다 — 바뀐 것은 자리뿐이다. 옛 "프라이버시" 소제목의 무입력 자동 잠금은 **보안** 섹션으로 갔다(가림막이 곧 볼트 잠금 —
  docs/invariants.md 2절).
-->
<h4 class="subhead first">{t("settings.general.display.heading")}</h4>

<!--
  언어 (docs/log/2026-09-17-i18n.md).

  첫 항목(자동)만 번역되고 언어 이름은 언제나 제 글자로 적는다 (`LANGUAGE_NAMES`) —
  어느 언어로 보든 자기 이름은 자기 글자여야 고를 수 있다.
-->
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

<!--
  UI 크기 — 웹뷰 확대 배율 (docs/log/2026-09-25-ui-scale-font.md). 고르는 즉시 이 창에 걸리고,
  [저장] 하면 다른 창도 settings-saved 로 따라온다. 터미널 글자는 배율만큼 되돌려 제 크기를 지킨다.

  후보(`UI_SCALES`)는 간격이 고르지 않아 슬라이더가 인덱스를 움직인다. **놓을 때만 건다**
  (`commit="change"`): 끄는 동안 매 칸 웹뷰 배율이 바뀌면 슬라이더 자신이 포인터 밑에서 커졌다
  작아져 손잡이가 흔들린다 — 끄는 동안은 말풍선만 따라간다. 키보드는 칸마다 바로 걸린다.
-->
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

<!--
  앱 글꼴 — 터미널 글꼴 칸과 같은 모양(자리표시자 = 기본 스택, 비우면 기본). 치는 동안 바로 걸린다.
-->
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

<!--
  시작 시 SSH 자동 재접속 (옛 **탭** 섹션 — docs/log/2026-09-03-workspace-restore.md).

  열어 둔 탭의 배치는 자동 저장·복원이라 설정이 없다. 정할 것은 "복원된 SSH 타일을
  시작하자마자 붙일 것인가" 하나뿐이라, 그 한 줄만 여기로 옮겼다.
-->
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

<!-- 접속 이력 — 호스트별 마지막 접속·실패 시각 (docs/log/2026-09-23-host-history.md) -->
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

<!--
  프로젝트 시작 화면 (docs/log/2026-09-26-project-start-screen.md) — 자동(기본: 그 폴더에 지난 대화가 있으면
  셸 대신 시작 화면) · 끔(늘 곧장 셸). 프로젝트 독·launcher·팔레트의 "열기" 전부에 걸리는 값이라 "일반" 이
  제자리다. 고르는 즉시 걸리고(다음에 여는 것부터) [저장] 이 쓴다. 칩 이름은 짧게, 뜻은 툴팁에.
-->
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

<!-- 창을 모두 닫으면 트레이에 남기(③-4) — GUI 의 수명 한 칸. 세션은 어느 쪽이든 세션 서버에 산다 -->
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

<!--
  파일 타일의 기본 보기 (docs/log/2026-10-07-file-tile-dolphin.md) — 아이콘 · 간단히 · 자세히(기본). 로컬과 원격 파일
  타일이 함께 쓰는 값이라 어느 한 섹션(터미널)이 아니라 앱 전체의 "일반" 이 제자리다. 타일 툴바에서
  따로 고른 타일(`PaneSpec.fileView`)은 이 값을 따르지 않는다. 고르는 즉시 걸리고 [저장] 이 쓴다. 이름은 소제목("파일 타일")
  아래라 짧다(`기본 보기`).
-->
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

<!--
  로컬 파일 타일 자동 새로고침 (docs/log/2026-10-21-file-tile-auto-refresh.md) — 기본 켬. 기본 보기 옆이 제자리다(파일 타일의
  값). 끄면 곧바로 로컬 감시 구독이 걷힌다 — ⟳ 는 그대로. 원격 파일 타일은 이 값과 상관없이 늘 ⟳ 로만 읽는다.
-->
<SettingRow
  id="files-auto-refresh"
  label={t("settings.general.files_refresh.label")}
  tip={tipOf(t("settings.general.files_refresh.summary"), t("settings.general.files_refresh.note"))}
>
  {#snippet control()}
    <Toggle id="files-auto-refresh" checked={settings.fileAutoRefresh} onchange={setFileAutoRefresh} />
  {/snippet}
</SettingRow>

<!--
  세션 서버 (③-1 — src-tauri/src/server.rs) — 설정값이 아닌 **지금의 상태**·[모든 세션 종료]·[다시 시작]. 정보·디버그 화면이
  따로 없어 앱 전체의 "일반" 끝에 둔다. (트레이 칸은 "시작과 접속" 으로 갔다 — 창을 닫을 때 앱이 어떻게 남는가의 일이다.)
-->
<h4 class="subhead">{t("settings.general.server.heading")}</h4>
<SessionServerRow />

<!-- 앱 업데이트(2026-11-12) — 일반의 끝 소제목(새 섹션 없음): 자동 확인 · 판 · 건너뛴 판 · 출처 각주. 몸은 `UpdatesRows` -->
<UpdatesRows />

<style>
  /* 앱 글꼴 칸 — 줄의 오른쪽 손잡이라 `settings.css` 의 `.value`(width:100%)를 그대로 두면 라벨과
     폭을 다툰다. 드롭다운 상한(14em)보다 조금 넓게 못 박는다 — 기본 스택이 자리표시자로 다 보인다.
     (옛 `max-width: 55%` 는 격자 칸이 내용 폭이라 순환 계산이 되어 걷었다) */
  .value.ui-font {
    width: 16em;
    max-width: 100%;
  }
</style>
