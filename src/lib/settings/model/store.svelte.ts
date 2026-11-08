// 설정 **전역 상태**(`settings` · `settingsNav`)와 화면 적용(`applySettings`)·읽기/저장·창 사이 알림.
// 모듈 수준의 바뀌는 상태(은은하게 소스색 · 확대 계수 · 창 라벨)는 **이 파일에만** 산다.
import { invoke, emit } from "../../ipc";
import { syncGateTheme } from "$lib/gate-theme";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { FileView } from "$lib/session";
import { migrateFileView } from "$lib/session/spec";
import type { StartScreenMode } from "$lib/project-start";
import type { DockLayout } from "$lib/dock";
import type { ExecSort } from "$lib/console/exec-rows";
import { resolveMessengerRules } from "$lib/messenger-notify";
import { DEFAULT_UI_SCALE, compensatedFontSize, noteAppliedZoom, zoomFactor } from "$lib/ui-scale";
import {
  DEFAULT_TERM_PRESET,
  termThemeOf,
  withScrollbarSlider,
  withTransparentCanvas,
  type FixedDynamicTerms,
  type UserTermLookup,
  type UserTermTheme,
} from "$lib/theme";
import { compileTriggers } from "$lib/triggers";
import { normalizeChipHidden, normalizeChipOrder, type HeaderChipId } from "$lib/header-chips";
import {
  DERIVED_TOKENS,
  M3_TOKENS,
  TINT_OWNER,
  TINT_TOKENS,
  derivedChromeTokens,
  dynamicTermTheme,
  resolveDynamicMode,
  subtleTint,
  type DynamicMode,
  type TintToken,
} from "$lib/dynamic-color";
import type { ITheme } from "@xterm/xterm";
import type { AppSettings, AutomationPrefs } from "./schema";
import {
  APP_TOKENS,
  DEFAULT_BELL,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FILE_VIEW,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_HOST_SORT,
  DEFAULT_EXEC_SORT,
  DEFAULT_MARK_AFTER_SECS,
  DEFAULT_NOTIFY_AFTER_SECS,
  DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
  DEFAULT_OPACITY,
  DEFAULT_PROJECT_START_SCREEN,
  DEFAULT_AI_ICON_STYLE,
  DEFAULT_AI_AVATARS,
  DEFAULT_DOCK_LAYOUT,
  DEFAULT_RIGHT_CLICK,
  DEFAULT_STATUS_BAR,
  DEFAULT_STATUS_BAR_STYLE,
  DEFAULT_MATERIAL,
  DEFAULT_APP_ICON,
  DEFAULT_TAB_STYLE,
  DEFAULT_TERM_OPACITY,
  DEFAULT_TILE_HEADER,
  DEFAULT_TILING,
  DEFAULT_WALLPAPER_DIM,
  DEFAULT_WALLPAPER_FIT,
  LIGATURE_FONT_FAMILY,
  WALLPAPER_BLUR_MIN,
  type AiIconStyle,
  type BellMode,
  type CursorStyle,
  type HostSort,
  type RightClickMode,
  type StatusBarPosition,
  type StatusBarStyle,
  type Material,
  type TabStyle,
  type TileHeaderMode,
  type TilingMode,
  type WallpaperFit,
} from "./options";
import { cloneSettings, emptySettings, normalizeSettings, sameSettings } from "./normalize";
import { sendSnapshot } from "./payload";
import { APP_TOKEN_KEYS, describeError } from "./internal";
import { rememberSplashColors, rememberSplashIcon } from "$lib/splash-memo";
import { appM3Tokens, cachedFixedDynamicTerms, upgradeLegacyAppColors } from "$lib/app-color-themes";

// ---------------------------------------------------------------------------
// **이 기기 보기 층**(원격 폰 — 10-20). 원격 웹의 폰 설정 화면이 고른 "이 기기" 값(터미널 글자 크기 · 밝기)을 `settings.current` 를
// **건드리지 않고** 화면에만 얹는다 — 원격 창의 저장(`save_settings`)이 그 값을 집 PC 의 `settings.toml` 에 싣지 않게. 거는 쪽은
// `app/mobile`(글자 크기)과 `mode.svelte.ts`(밝기를 바꾼 사본 — 크롬 여덟 칸 · 터미널 프리셋 짝)뿐이고, 집 PC 창 · 넓은 원격 창에서는
// 늘 `null` 이라 아무것도 바뀌지 않는다.
// ---------------------------------------------------------------------------

/** 이 기기의 터미널 글자 크기(`null` = 설정 그대로) */
let deviceFontSize = $state<number | null>(null);
/** 이 기기 밝기로 바꾼 설정 사본 — 색 토큰 · 터미널 팔레트만 이것을 본다(`null` = `settings.current`) */
let deviceView = $state<AppSettings | null>(null);

/** 이 기기의 터미널 글자 크기를 건다(`null` 이면 걷는다) */
export function setDeviceFontSize(px: number | null): void {
  if (deviceFontSize !== px) deviceFontSize = px;
}

/** 이 기기 밝기의 설정 사본을 건다(`null` 이면 걷는다) — 다시 칠하는 것은 부르는 쪽(`applySettings`) */
export function setDeviceView(view: AppSettings | null): void {
  deviceView = view;
}

/** 색을 칠할 때 읽는 설정 — 이 기기 사본이 있으면 그것 */
function colorSource(): AppSettings {
  return deviceView ?? settings.current;
}

/**
 * 전역 설정 상태.
 *
 * `current` 는 **화면에 지금 적용 중인** 값이라 미리보기 중에도 계속 바뀐다.
 * `saved` 는 마지막으로 파일에 들어간 값이고, 설정 화면의 [취소] 는 `current` 를 여기로 되돌린다.
 */
class SettingsStore {
  current = $state<AppSettings>(emptySettings());
  saved = $state<AppSettings>(emptySettings());

  /**
   * 월페이퍼에서 뽑은 터미널 팔레트 (아직 뽑은 적이 없으면 `undefined`).
   * 설정 화면이 "동적" 프리셋 항목을 보여줄지 판단하는 데도 쓴다.
   */
  dynamicTerm = $derived<ITheme | undefined>(dynamicTermTheme(this.current.terminal.dynamic));
  /**
   * 같은 색 테마의 **고정 밝기** 두 벌(가상 키 `dynamic-dark` · `dynamic-light`) — 저장하지 않고 앱 색 테마 · 사용자 색 ·
   * 월페이퍼 원천에서 다시 낸다([`cachedFixedDynamicTerms`]). 못 푼 쪽은 `undefined` — 설정 화면은 그 항목을 보이지 않는다.
   */
  dynamicFixedTerms = $derived<FixedDynamicTerms>(cachedFixedDynamicTerms(this.current));
  /**
   * **전체** 모드인가 — 월페이퍼에서 MD3 한 벌을 뽑아 쓰는 중. 자동 재추출·색 걷기·자동 끔이
   * 전부 이 값만 본다 (은은하게는 저장된 팔레트가 없어 그 규칙들이 필요 없다).
   */
  dynamicTheme = $derived(this.current.app.dynamic === "full");
  /** 화면이 쓰는 세 단계 값 — 안 정했으면 월페이퍼 유무로 정한다 ([`resolveDynamicMode`]) */
  dynamicMode = $derived<DynamicMode>(
    resolveDynamicMode(this.current.app.dynamic, !!this.current.wallpaper.file),
  );
  /**
   * **사용자 터미널 테마** 목록(`<설정 루트>/terminal-themes/` — 가져온 색 구성). 설정 파일 밖이라 `current`/`saved` 에
   * 들지 않고, 창마다 `app/term-themes.svelte.ts` 가 읽어 [`setUserTermThemes`] 로 건다. 프리셋 키 `user:<id>` 를 푸는 것은
   * `termThemeOf` 하나이고 그 인자가 아래 [`userTermLookup`] 이다.
   */
  userTermThemes = $state<UserTermTheme[]>([]);
  /**
   * `termThemeOf` 의 셋째 인자 — id → 테마와 **없을 때 떨어질 모드**(지운 테마 · 아직 못 읽은 목록 → 같은 모드의 AYNX).
   * 모드는 `<html data-theme>` 이 진실이라([`isLightNow`]) `[app] mode` 를 함께 읽어 모드가 바뀔 때 다시 계산되게 한다.
   */
  userTermLookup = $derived.by((): UserTermLookup => {
    void this.current.app.mode;
    return { themes: Object.fromEntries(this.userTermThemes.map((u) => [u.id, u])), light: isLightNow() };
  });
  /** 지금 써야 할 xterm 팔레트 (모르는 키·빈 값이면 기본 프리셋) */
  termTheme = $derived<ITheme>(
    deviceView
      ? termThemeOf(
          deviceView.terminal.theme,
          dynamicTermTheme(deviceView.terminal.dynamic),
          this.userTermLookup,
          cachedFixedDynamicTerms(deviceView),
        )
      : termThemeOf(this.current.terminal.theme, this.dynamicTerm, this.userTermLookup, this.dynamicFixedTerms),
  );
  /** 지금 써야 할 프리셋 키 — select 의 값으로도 쓴다 */
  presetKey = $derived(this.current.terminal.theme ?? DEFAULT_TERM_PRESET);
  fontFamily = $derived(this.current.terminal.font_family ?? DEFAULT_FONT_FAMILY);
  /** 합자를 켤 것인가 (안 정했으면 끔) — fontFamilyEffective 가 이 값을 읽으므로 위에 둔다 */
  ligatures = $derived(this.current.terminal.ligatures ?? false);
  /**
   * 터미널에 실제로 걸 글꼴. 합자를 켰고 **사용자가 글꼴을 안 정했으면** 합자 지원
   * 스택(Cascadia Code…)으로 폴백한다. 사용자가 글꼴을 직접 정했으면 그 값을 존중한다
   * (합자를 지원하는 글꼴을 스스로 골랐을 수 있다).
   */
  fontFamilyEffective = $derived(
    this.ligatures && this.current.terminal.font_family == null
      ? LIGATURE_FONT_FAMILY
      : this.fontFamily,
  );
  fontSize = $derived(this.current.terminal.font_size ?? DEFAULT_FONT_SIZE);
  /** UI 크기 % (안 정했으면 100) — 설정 select 의 값으로도 쓴다 */
  uiScale = $derived(this.current.app.ui_scale ?? DEFAULT_UI_SCALE);
  /**
   * xterm 에 **실제로 넘길** 글꼴 크기 — [`fontSize`] 를 UI 배율로 나눈 값
   * (docs/log/2026-09-25-ui-scale-font.md). 웹뷰 확대가 CSS px 를 키우므로 그대로 넘기면
   * 125% 에서 14px 터미널이 17.5px 로 보인다. 터미널·미리보기는 이 값을 쓰고, 설정 칸의
   * 숫자는 여전히 [`fontSize`](사용자가 정한 값)다.
   */
  termFontSize = $derived(compensatedFontSize(deviceFontSize ?? this.fontSize, zoomFactor(this.uiScale)));
  /** WebGL 가속을 쓸 것인가 (안 정했으면 켬) */
  webgl = $derived(this.current.terminal.webgl ?? true);
  /**
   * 지금 써야 할 커서 모양 (모르는 키·빈 값이면 기본 `block`) — xterm `cursorStyle` 로 그대로
   * 내려가고 select 의 값으로도 쓴다. 유니온이 xterm 의 `'block'|'underline'|'bar'` 와 같다.
   */
  cursorStyle = $derived<CursorStyle>(
    (this.current.terminal.cursor_style ?? DEFAULT_CURSOR_STYLE) as CursorStyle,
  );
  /** 투명도 % — 앱 배경이 크롬 · 타일에 비치는 정도 (안 정했으면 [`DEFAULT_OPACITY`]) */
  opacity = $derived(this.current.app.opacity ?? DEFAULT_OPACITY);
  /**
   * **터미널 칸** 불투명도 % (안 정했으면 100 = 불투명). 크롬 쪽과 별개의 손잡이다.
   *
   * 100 인지 아닌지가 렌더 경로를 가른다: 100 이면 `allowTransparency` 를 켜지 않고
   * `theme.background` 도 예전 그대로의 hex 라, 이 기능을 안 쓰는 사람에게는 아무것도
   * 바뀌지 않는다 (Terminal.svelte 참고).
   */
  termOpacity = $derived(this.current.terminal.opacity ?? DEFAULT_TERM_OPACITY);
  /**
   * xterm 에 **실제로 걸 팔레트** — 위 [`termTheme`] 에서 캔버스 배경만 투명도에 맞춰 손본 것.
   *
   * 100%(기본)면 배경은 프리셋 원본 **그대로**다 (`withTransparentCanvas` 가 손대지 않는다) —
   * 투명도를 안 쓰는 사람에게 렌더 경로가 달라지지 않는다. 100 미만이면 캔버스 배경을
   * **완전 투명**으로 비운다: 칠하는 층은 타일 배경판(`--term-bg-fill`) 하나뿐이어야 알파가
   * 두 번 곱해지지 않는다 (그 근거는 theme.ts 의 doc-comment). `withScrollbarSlider` 는 팔레트에
   * 없던 스크롤바 손잡이 색 세 칸만 글자색에서 파생해 채운다 (앱 크롬의 스크롤바 규칙이
   * 터미널에는 닿지 않기 때문 — theme.ts 참고).
   */
  termThemeEffective = $derived<ITheme>(
    withScrollbarSlider(withTransparentCanvas(this.termTheme, this.termOpacity)),
  );
  /**
   * 시작 시 복원된 SSH 타일을 자동으로 재접속할 것인가 (안 정했으면 **끔**).
   * `+page` 의 부팅이 이 값을 읽으므로 **`loadSettings` 가 끝난 뒤에** 복원을 판단한다.
   */
  autoReconnect = $derived(this.current.app.auto_reconnect ?? false);
  /** 창을 모두 닫으면 트레이에 남는가 (안 정했으면 **켬** — ③-4) */
  trayOnClose = $derived(this.current.app.tray_on_close ?? true);
  /** 타일 머리줄 칩의 순서 — 모든 칩이 한 번씩 든다(안 정했으면 기본 순서 — `$lib/header-chips`) */
  headerChipOrder = $derived<readonly HeaderChipId[]>(normalizeChipOrder(this.current.app.header_chip_order));
  /** 끈 머리줄 칩 (안 정했으면 없음 = 전부 켬) */
  headerChipsHidden = $derived<readonly HeaderChipId[]>(normalizeChipHidden(this.current.app.header_chips_hidden));
  /** 머리줄에 실제로 늘어놓을 칩 — 저장 순서대로, 끈 것은 뺀다(`pane/HeaderChips` 가 이 순서로 그린다) */
  headerChipsShown = $derived<readonly HeaderChipId[]>(
    this.headerChipOrder.filter((id) => !this.headerChipsHidden.includes(id)),
  );
  /** 로컬 타일 머리줄의 자원 칩(CPU · 메모리)을 보이는가 — 끄면 표본도 당기지 않는다 */
  resourceChip = $derived(!this.headerChipsHidden.includes("resource"));
  /** 상태바의 자원 고리(이 PC 전체 CPU · 메모리)를 세우는가 (안 정했으면 **켬**) */
  resourceRings = $derived(this.current.app.resource_rings ?? true);
  /** 상태바의 사용량 고리(AI CLI 사용 한도)를 세우는가 (안 정했으면 **켬**) */
  usageRings = $derived(this.current.app.usage_rings ?? true);
  /** 제목줄에 창 단추(최소화 · 최대화 · 닫기)를 그리는가 (안 정했으면 **끔**) */
  windowControls = $derived(this.current.app.window_controls === true);
  /** 지금 써야 할 탭 바 모양 (모르는 키·빈 값이면 기본 `pill`) — select 의 값으로도 쓴다 */
  tabStyle = $derived<TabStyle>((this.current.terminal.tab_style ?? DEFAULT_TAB_STYLE) as TabStyle);
  /**
   * 터미널 우클릭이 무엇을 하는가 (안 정했으면 **메뉴**) — select 의 값으로도 쓴다.
   * 읽는 곳은 `Terminal.svelte` 의 `contextmenu`·선택 변경 두 자리다.
   */
  rightClick = $derived<RightClickMode>(
    (this.current.terminal.right_click ?? DEFAULT_RIGHT_CLICK) as RightClickMode,
  );
  /**
   * 여러 줄 붙여넣기 전에 한 번 묻는가 (안 정했으면 **켬**).
   * 붙여넣기 통로가 하나뿐이라(`Terminal.svelte` 의 `requestPaste`) 읽는 곳도 한 곳이다.
   */
  confirmMultilinePaste = $derived(this.current.terminal.confirm_multiline_paste ?? true);
  /**
   * 프롬프트에 치는 동안 스니펫을 제안하는가 (안 정했으면 **켬**).
   *
   * 읽는 곳은 `Terminal.svelte` 의 제안 계산 하나뿐이고, **그 자리에서 바로 듣는다** —
   * 목록을 다시 셀 때마다 이 값을 보므로 끄면 떠 있던 상자가 다음 키에 사라진다.
   */
  inlineSnippets = $derived(this.current.terminal.inline_snippets ?? true);
  /**
   * 원격이 보낸 OSC 52 를 이 PC 의 클립보드에 쓰는가 (안 정했으면 **켬**).
   *
   * 읽는 곳은 `term/osc-handlers.ts` 의 OSC 52 핸들러 하나이고, **그 자리에서 바로 듣는다** —
   * 시퀀스가 올 때마다 이 값을 보므로 끄면 다음 복사부터 아무것도 안 들어온다.
   * 끈 상태여도 시퀀스는 **삼킨다**(화면에 이스케이프 조각이 새지 않게).
   */
  osc52Clipboard = $derived(this.current.terminal.osc52_clipboard ?? true);
  /**
   * 타일 안 프로그램이 보낸 알림(OSC 9 · 777)을 띄우는가 (안 정했으면 **켬**).
   *
   * 읽는 곳은 `term/osc-handlers.ts` 의 OSC 9·777 핸들러이고 시퀀스마다 이 값을 본다 — 끄면 다음
   * 알림부터 뜨지 않는다. 끈 상태여도 알아본 시퀀스는 **삼킨다**.
   */
  oscNotify = $derived(this.current.terminal.osc_notify ?? true);
  /**
   * sixel · iTerm2 인라인 이미지를 그리는가 (안 정했으면 **켬**). `Terminal.svelte` 의 효과가
   * 이 값을 듣고 이미지 애드온을 붙이거나 뗀다 — 합자처럼 열린 타일에도 바로 적용된다.
   */
  inlineImages = $derived(this.current.terminal.inline_images ?? true);
  /**
   * 로컬 셸에 통합 훅을 심는가 (안 정했으면 **켬**). **읽는 쪽은 설정 화면의 토글뿐**이다 —
   * 실제로 이 값을 보고 argv 를 정하는 것은 백엔드다 (`crate::pty::spawn_shell`).
   */
  localShellIntegration = $derived(this.current.terminal.local_shell_integration ?? true);
  /**
   * 긴 명령이 끝나면 알릴 **임계(초)** — 안 정했으면 10, `0` 이면 끔.
   * 읽는 곳은 `app/finish-notify.ts` 하나이고, **다음 명령부터** 곧바로 듣는다.
   */
  notifyAfterSecs = $derived(
    this.current.terminal.notify_after_secs ?? DEFAULT_NOTIFY_AFTER_SECS,
  );
  /**
   * 실행 시간 표식을 **몇 초부터** 다나 — 안 정했으면 3, `0` 이면 끔.
   * 읽는 곳은 `Terminal.svelte` 가 셸 통합에 넘기는 게이트 하나다 — **이미 그려진 표식은
   * 그대로 남고**, 값이 바뀌면 그 뒤에 끝나는 블록부터 달라진다.
   */
  markAfterSecs = $derived(this.current.terminal.mark_after_secs ?? DEFAULT_MARK_AFTER_SECS);
  /**
   * 벨이 왔을 때 무엇을 하는가 (모르는 키·빈 값이면 기본 `visual`) — select 의 값으로도 쓴다.
   * 읽는 곳은 `app/bell.svelte.ts` 하나이고, 벨이 울리는 그 순간에 본다(즉시 적용).
   */
  bell = $derived<BellMode>((this.current.terminal.bell ?? DEFAULT_BELL) as BellMode);
  /**
   * 새 타일을 어디에 놓을 것인가 (안 정했으면 **나선**) — select 의 값으로도 쓴다.
   * 읽는 곳은 `+page` 의 자동 배치 출구 하나뿐이다 (`placeAuto`·`splitActive`).
   */
  tiling = $derived<TilingMode>((this.current.app.tiling ?? DEFAULT_TILING) as TilingMode);
  /**
   * 타일에 헤더를 언제 다는가 (안 정했으면 **항상**) — select 의 값으로도 쓴다.
   * 읽는 곳은 `PaneHost` 의 `headed` 하나뿐이고, 값이 바뀌면 그 자리에서 헤더가 들고 난다.
   */
  tileHeader = $derived<TileHeaderMode>(
    (this.current.app.tile_header ?? DEFAULT_TILE_HEADER) as TileHeaderMode,
  );
  /**
   * 상태바를 어느 가장자리에 둘 것인가 (안 정했으면 **왼쪽**) — select 의 값으로도 쓴다.
   * 읽는 곳은 `+page` 의 상태바 배치 하나뿐이고, 값이 바뀌면 그 자리에서 띠가 옮겨 선다.
   */
  statusBar = $derived<StatusBarPosition>(
    (this.current.app.status_bar ?? DEFAULT_STATUS_BAR) as StatusBarPosition,
  );
  /**
   * 상태바를 어떤 모양으로 그릴 것인가 (안 정했으면 **평면**) — `StatusBar` 의 `barStyle`
   * prop 으로 내려가고, 값이 바뀌면 그 자리에서 띠의 모서리·여백이 다시 선다.
   */
  statusBarStyle = $derived<StatusBarStyle>(
    (this.current.app.status_bar_style ?? DEFAULT_STATUS_BAR_STYLE) as StatusBarStyle,
  );
  /**
   * 앱 크롬 재질 (안 정했으면 **글래스**) — `mode.svelte.ts` 가 `<html data-material>` 로 적는다.
   */
  material = $derived<Material>((this.current.app.material ?? DEFAULT_MATERIAL) as Material);
  /**
   * 창·작업 표시줄 아이콘 (안 정했으면 **gpt** = 빌드 아이콘) — 설정 화면의 썸네일 선택. 내장 캐릭터 키(`AppIcon`)이거나
   * 사용자 아이콘 id(`user-<12hex>` — `isUserAppIconId`)다.
   */
  appIcon = $derived<string>(this.current.app.app_icon ?? DEFAULT_APP_ICON);
  /**
   * 무입력 몇 분 뒤에 자동 잠금할 것인가 (안 정했으면 **0 = 끔**) — 설정 select 의 값으로도,
   * idle 감시(`app/idle-lock.svelte.ts`)의 매 틱 판정으로도 쓴다. `0` 이면 자동 잠금 안 함.
   */
  idleLockMin = $derived(this.current.app.idle_lock_min ?? 0);
  /**
   * 지금 터미널에 걸어야 할 트리거 목록.
   *
   * 얕은 복사본을 돌려주는 것이 중요하다 — 구독하는 `$effect` 가 이 배열의 **원소 안쪽**
   * (`pattern`·색)까지 의존성으로 잡아, 설정 화면에서 한 글자만 고쳐도 다시 걸린다.
   */
  triggers = $derived(this.current.triggers.map((t) => ({ ...t })));
  /**
   * 지금 걸린 단축키 오버라이드 (얕은 복사본). 배선(Terminal·+page)이 매 keydown 마다
   * `settings.current.keybindings` 를 직접 읽으므로 이 파생값 없이도 즉시 반영되지만,
   * 설정 화면이 `resolveBindings`/`conflicts` 에 넘길 때 이 안정적 복사본을 쓴다.
   */
  keybindings = $derived({ ...this.current.keybindings });
  /**
   * `new-shell` 단축키·`>_` 메뉴가 여는 **기본 셸의 id** (아직 안 골랐으면 `undefined` —
   * 그때는 OS 초기값이 쓰인다). 이 값이 지금 기기에 실제로 있는 셸인지는 **여는 쪽이**
   * 판단한다 (`session.ts` 의 `effectiveDefaultShellId` 하나 — `app/panes` 의
   * `openDefaultShell` · `>_` 메뉴 · 설정 화면이 전부 그것을 부른다).
   */
  defaultShell = $derived(this.current.shell.default ?? undefined);
  /**
   * AI 타일의 **시작 폴더 폴백** (안 정했으면 `undefined` = 홈).
   *
   * 앞 순위는 포커스된 로컬 터미널의 지금 폴더와 프로젝트 탭의 폴더라(`start-dir.ts` 의 `startDirFor`) 그쪽이 그것을
   * 먼저 묻는다 — 여기는 그게 없을 때의 자리다. 폴더가 지금 있는지도 **여는 쪽이**
   * 판단하지 않는다: 그 판정은 백엔드(`spawn_cwd`)에 하나뿐이고, 없으면 홈으로 떨어진다
   * (`defaultShell` 이 없는 셸을 살려 두는 것과 같은 규칙).
   */
  aiStartDir = $derived(this.current.ai.start_dir ?? undefined);
  /**
   * Claude Code 턴이 끝나면 알리는가 (안 정했으면 **켬**). 읽는 곳은 `app/agent-notify.ts` 와
   * 설정 화면의 토글 — **다음 턴부터** 곧바로 듣는다.
   */
  notifyTurnEnd = $derived(this.current.ai.notify_turn_end ?? true);
  /** Claude Code 가 권한을 물으면 알리는가 (안 정했으면 **켬**) — `app/agent-notify.ts` 가 읽는다 */
  notifyPermission = $derived(this.current.ai.notify_permission ?? true);
  /** 사이드 채팅의 끝남 · 권한 물음을 알리는가 (안 정했으면 **켬**) — `app/side-chat-notify.ts` 가 읽는다 */
  notifySideChat = $derived(this.current.ai.notify_side_chat ?? true);
  /**
   * 보고 있는 타일도 알릴 턴 길이(초) — 안 정했으면 60, `0` 이면 끔. `app/agent-notify.ts` 가 알리는 순간에
   * 읽는다(다음 턴부터 곧바로 듣는다).
   */
  notifyFocusedAfterSecs = $derived(
    this.current.ai.notify_focused_after_secs ?? DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
  );
  /** codex 를 `--no-daemon` 으로 띄우는가 (안 정했으면 **켬**) — 설정 화면의 토글만 읽는다(적용은 Rust, 다음 타일부터) */
  codexNoDaemon = $derived(this.current.ai.codex_no_daemon ?? true);
  /** claude 에 상태줄 도우미를 끼우는가 (안 정했으면 **켬**) — 설정 화면의 토글만 읽는다(적용은 Rust) */
  claudeStatusline = $derived(this.current.ai.claude_statusline ?? true);
  /**
   * **AI 아이콘 모양**(안 정했으면 **브랜드 로고**) — 탭 · 머리줄 · 독/런처 · 채팅 독 · 앱 안 알림 · 로딩 덮개가 `$lib/avatars.svelte` 의
   * `aiAvatarSrc` 로 읽는다. 미리보기 계약이라 [저장] 전에도 곧바로 듣는다.
   */
  aiIconStyle = $derived<AiIconStyle>((this.current.ai.icon_style ?? DEFAULT_AI_ICON_STYLE) as AiIconStyle);
  /** claude 의 아바타 id(안 정했으면 `claude`) — 지운 그림인지는 `avatars.svelte` 의 `cliAvatarId` 가 본다 */
  aiAvatarClaude = $derived<string>(this.current.ai.avatar_claude ?? DEFAULT_AI_AVATARS.claude);
  /** codex 의 아바타 id(안 정했으면 `gpt`) */
  aiAvatarCodex = $derived<string>(this.current.ai.avatar_codex ?? DEFAULT_AI_AVATARS.codex);
  /**
   * **끈 에이전트** id 목록(안 정했으면 빈 목록 = 모두 사용). 새로 띄우거나 고르는 자리가 읽는다(`$lib/agent-enabled`) —
   * 미리보기 계약이라 [저장] 전에도 곧바로 듣는다.
   */
  disabledAgents = $derived<readonly string[]>(this.current.ai.disabled_agents ?? []);
  /**
   * 메신저(Discord) 알림 규칙 — 기본값이 채워진 모양. `app/messenger.ts` 가 보내는 순간에 읽고 설정 화면이
   * 그린다(저장 전에도 곧바로 듣는다 — 다른 알림 칸과 같다).
   */
  messenger = $derived(resolveMessengerRules(this.current.messenger));
  /**
   * 지금 걸린 월페이퍼 사본의 **파일 이름** (없으면 `undefined` = 배경 없음).
   * 화면에 그릴 URL 은 이 이름이 아니라 `$lib/wallpaper.svelte.js` 의 `wallpaper.src` 다
   * (절대 경로 → `convertFileSrc`). 이 값은 "배경이 걸려 있는가" 의 판정에 쓴다.
   */
  wallpaperFile = $derived(this.current.wallpaper.file ?? undefined);
  /** 이미지 위 검정 덮개 % (안 정했으면 [`DEFAULT_WALLPAPER_DIM`]) */
  wallpaperDim = $derived(this.current.wallpaper.dim ?? DEFAULT_WALLPAPER_DIM);
  /** 배경 블러 px (안 정했으면 0 = 선명) */
  wallpaperBlur = $derived(this.current.wallpaper.blur ?? WALLPAPER_BLUR_MIN);
  /** 배치 (모르는 키·빈 값이면 기본 `cover`) — select 의 값으로도 쓴다 */
  wallpaperFit = $derived<WallpaperFit>(
    (this.current.wallpaper.fit ?? DEFAULT_WALLPAPER_FIT) as WallpaperFit,
  );
  /** 문법이 잘못된 정규식들 (설정 화면이 그 행에 빨간 한 줄로 보여준다) */
  triggerErrors = $derived(compileTriggers(this.current.triggers).errors);
  /**
   * 자동 승인 정책 (단계 10b) — 관제판의 자동 승인 훅(`Console.svelte`)이 `policy.ts` 에
   * 넘길 반응형 스냅샷이다. `current.automation` 을 그대로 노출한다(언제나 채워진 객체).
   */
  automationPrefs = $derived<AutomationPrefs>(this.current.automation);
  /**
   * 호스트 목록의 정렬 (모르는 키·빈 값이면 기본 `name`). 읽는 곳은 호스트 독(`Sidebar`)의
   * 줄 계산 하나이고, 값이 바뀌면 그 자리에서 순서가 바뀐다.
   */
  hostSort = $derived<HostSort>((this.current.hosts.sort ?? DEFAULT_HOST_SORT) as HostSort);
  /** 작업안 실행 목록의 정렬 (모르는 키·빈 값이면 기본 `newest`). 읽는 곳은 `ops-controller` 의 `execList` 하나 */
  execSort = $derived<ExecSort>((this.current.plans.exec_sort ?? DEFAULT_EXEC_SORT) as ExecSort);
  /**
   * 파일 타일의 기본 보기 (모르는 키·빈 값이면 자세히, 옛 `tree`·`navigate` 도 자세히). 읽는 곳은 `PaneHost` 하나 —
   * 타일이 자기 보기(`PaneSpec.fileView`)를 들고 있지 않을 때만 이 값을 쓴다.
   */
  fileDefaultView = $derived<FileView>(migrateFileView(this.current.files.default_view) ?? DEFAULT_FILE_VIEW);
  /**
   * 로컬 파일 타일의 자동 새로고침(기본 켬 — docs/log/2026-10-21-file-tile-auto-refresh.md). 읽는 곳은 `SftpBrowser` 의
   * 감시 수명 하나(원격 타일은 감시가 없다 — ⟳).
   */
  fileAutoRefresh = $derived(this.current.files.auto_refresh ?? true);
  /**
   * 프로젝트 시작 화면을 언제 세우나 (모르는 키·빈 값이면 `auto`). 읽는 곳은 프로젝트를 여는 길
   * (`app/agent-sessions` 의 `projectStartPaneFor`) 하나다.
   */
  projectStartScreen = $derived<StartScreenMode>(
    (this.current.projects.start_screen ?? DEFAULT_PROJECT_START_SCREEN) as StartScreenMode,
  );
  /**
   * 독 배치 (모르는 키·빈 값이면 `launcher-left`) — 런처 독(`Dock.svelte`)과 채팅 독(`ChatDock.svelte`)이 이것으로 제 쪽을 정한다
   * (`$lib/dock` 의 `dockSides`). 고르는 즉시 두 독이 옮겨 간다.
   */
  dockLayout = $derived<DockLayout>((this.current.dock.layout ?? DEFAULT_DOCK_LAYOUT) as DockLayout);
  /** 저장하지 않은 변경이 있는가 */
  dirty = $derived(!sameSettings(this.current, this.saved));
}

export const settings = new SettingsStore();

/**
 * **설정 화면을 열면서 곧바로 펴 줄 섹션** 한 칸
 * (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
 *
 * 지금 이 자리를 쓰는 것은 치트시트의 "설정에서 바꾸기" 하나다: `want = "keys"` 를 적고
 * 설정 모달을 열면, `SettingsModal` 이 그 값을 **한 번 읽고 비운다**(소비). 한 번 쓰고
 * 버려지는 신호라 값이 남아 있으면 다음에 설정을 열 때 엉뚱한 섹션이 펴진다.
 *
 * 프롭이 아니라 모듈 상태인 이유: 설정 화면은 탭 안의 **평범한 타일**이라
 * 부르는 쪽(`+page`)에 그 컴포넌트로 가는 통로가 없다. 이미 떠 있을 수도, 방금 생길 수도
 * 있고, 둘 다 `PaneHost` 를 한 겹 지나야 한다 — 신호 한 칸을 위해 통로를 파는 것보다
 * 게시판이 가볍다. 값은 섹션 id (`TABS` 의 것) 이고 모르는 id 면 조용히 무시된다.
 *
 * `anchor` 는 그 섹션 안 **줄 하나**의 DOM id 다 — 팔레트의 설정 색인이 적는다
 * (`settings-index.ts` · docs/log/2026-09-25-palette.md). `want` 와 함께만 뜻이 있고, 함께
 * 소비된다. 먼저 적고 나서 `want` 를 적는다(읽는 쪽은 `want` 를 보고 깨어난다).
 */
export const settingsNav = $state<{ want: string | null; anchor: string | null }>({
  want: null,
  anchor: null,
});

/**
 * 지금 라이트 모드인가 — `mode.svelte.ts` 가 `<html data-theme>` 에 적어 둔 값을 읽는다.
 *
 * 저 모듈을 import 하지 않는 이유는 **순환**이다: 저쪽이 이 모듈의 setter 를 부르므로
 * 의존은 한 방향(mode → settings)이어야 한다. 속성은 모드의 유일한 진실이고 그것을 쓰는
 * 곳도 하나뿐이라, 읽어 오는 값이 스토어와 어긋날 수 없다.
 */
function isLightNow(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light";
}

/**
 * `settings.current` 를 화면에 반영한다. 앱 토큰만 여기서 처리한다 (터미널은 구독으로 간다).
 *
 * 미리보기·저장·취소가 전부 같은 함수를 지나므로 "미리보기와 실제 적용이 다르다" 는 부류의
 * 버그가 생길 자리가 없다.
 */
export function applySettings() {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  // 색은 이 기기 사본이 있으면 그것(원격 폰의 밝기 — 위 "이 기기 보기 층"), 없으면 지금 설정
  const color = colorSource();
  for (const key of APP_TOKEN_KEYS) {
    const value = color.app[key];
    if (value) root.style.setProperty(APP_TOKENS[key], value);
    else root.style.removeProperty(APP_TOKENS[key]);
  }

  // 파생 토큰 — `theme.css` 에는 색 토큰이 여덟 개보다 많다(흐린 글자·마우스 오버 배경·저채도
  // 배너…). 그 나머지를 여덟 칸에서 HCT 로 다시 만들어 얹는다
  // (docs/log/2026-09-04-dynamic-color.md).
  //
  // **동적 테마 플래그가 아니라 "그 칸이 정해졌는가" 를 본다.** 강조색만 손으로 고른 사람도
  // 선택된 행 배경(`--accent-soft`)이 같이 따라와야 화면이 한 벌로 보인다 — 지금까지는 저
  // 값이 기본 팔레트의 남색으로 남아, 주황 강조색을 고르면 선택 행만 파랗게 뜨는 상태였다.
  // 정해지지 않은 칸은 아무것도 만들지 않으므로 `theme.css` 기본값이 그대로 이긴다.
  //
  // 지울 때는 **만들어진 것만이 아니라 목록 전부**를 훑는다 — 이번에 만들지 못한 칸이
  // 인라인에 남아 지난 팔레트의 색으로 계속 걸리는 것을 막는다.
  //
  // **모드에 따라 톤이 갈린다** — 라이트에서는 흐린 글자가 더 어두워지고 마우스 오버
  // 배경이 바탕보다 **내려간다** (docs/log/2026-09-04-light-theme.md). 그래서 지금
  // 밝기를 함께 넘긴다.
  //
  // 2026-10-18 부터 흐린 글자 · 호버 · 칩 · 선택 줄 · 보조/제3색 · 폴더 · 오류 판은 MD3 역할(`--m3-*`)의 별칭이다
  // (theme.css). 역할은 크롬이 만들어진 같은 원천에서 MCU 가 낸다(`appM3Tokens` — 내장 테마 · 사용자 색 · 월페이퍼 full ·
  // 그 밖은 강조색). `null` 이면 기본이라 인라인을 걷어 theme.css 값이 이긴다.
  const derived = derivedChromeTokens(color.app, !isLightNow());
  for (const name of DERIVED_TOKENS) {
    const value = derived[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  const m3 = appM3Tokens(color, !isLightNow());
  for (const name of M3_TOKENS) {
    const value = m3?.[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  // 은은하게가 칠하는 자리 중 저장 칸이 아닌 넷(호버 · 칩 · 흐린 글자)은 별칭이라 위 루프가 걷지 않는다 — 지난 틴트가
  // 인라인에 남아 다음 틴트의 기준이 되거나(겹쳐 칠함) 은은하게를 끈 뒤에도 남지 않게 먼저 걷는다
  for (const name of TINT_TOKENS) {
    if (!(Object.values(APP_TOKENS) as string[]).includes(name)) root.style.removeProperty(name);
  }

  applyWallpaperTint(root);

  // 터미널 칸의 **배경판 색**. xterm 캔버스 바깥(안쪽 여백)까지 덮어야 하므로 CSS 토큰으로도
  // 들고 있어야 하고, 터미널 투명도를 켜면 아예 이 토큰 하나만 색을 칠한다
  // (`--term-bg-fill` — theme.css). 프리셋 배경을 그대로 옮겨 적으므로 캔버스와 색이 갈리지 않는다.
  const termBg = settings.termTheme.background;
  if (termBg) root.style.setProperty("--term-bg", termBg);
  else root.style.removeProperty("--term-bg");
  // 터미널 글자색 — 터미널 · AI 타일의 머리줄이 바탕(위 판)과 같은 쪽의 글자를 쓴다(2026-10-20 타일 제목줄 개편 — `PaneHeader` 의 `.term`)
  const termFg = settings.termTheme.foreground;
  if (termFg) root.style.setProperty("--term-fg", termFg);
  else root.style.removeProperty("--term-fg");

  // 앱 글꼴 — `--font-ui` 를 인라인으로 덮는다. 비우면 걷어 `theme.css` 의 기본 스택이 이긴다
  // (색 토큰과 같은 규칙이다 — theme.css 는 건드리지 않는다).
  const uiFont = settings.current.app.ui_font_family;
  if (uiFont) root.style.setProperty("--font-ui", uiFont);
  else root.style.removeProperty("--font-ui");

  applyUiZoom(zoomFactor(settings.current.app.ui_scale));

  syncAppIcon();
  // 다음 시작의 스플래시가 이 색으로 뜬다 — 토큰을 다 얹은 **뒤**라야 계산값이 맞다 (`splash-memo.ts`)
  rememberSplashColors(root);
  // 원격 관문 쪽 색도 같은 계산값으로 — 집 PC 주 창만 · 짧게 모아 바뀌었을 때만(`gate-theme.ts`)
  syncGateTheme(root);
}

/**
 * 이 창이 마지막으로 Rust 에 넘긴 앱 아이콘 id — `applySettings` 는 슬라이더를 끌 때도 불리므로
 * 값이 바뀐 때만 넘긴다. `null` = 아직 안 넘김(부팅 첫 적용은 늘 넘기고, Rust 가 같은 값이면 버린다).
 */
let appliedAppIcon: string | null = null;

/**
 * 앱 아이콘(창·작업 표시줄)을 Rust 에 맞춘다 — Rust 가 **열린 모든 창**에 건다(`app_icon.rs`).
 * 고르기·[취소]·다른 창의 저장이 모두 `applySettings` 를 지나므로 이 한 자리로 덮인다.
 * 새 창은 Rust 가 스스로 건다(`on_page_load`) — 여기는 바뀐 값을 알리는 쪽이다.
 */
function syncAppIcon(): void {
  const id = settings.current.app.app_icon ?? DEFAULT_APP_ICON;
  if (id === appliedAppIcon) return;
  appliedAppIcon = id;
  rememberSplashIcon(id);
  void invoke("set_app_icon", { id }).catch((e) => {
    console.warn("[aynx] 앱 아이콘을 바꾸지 못했습니다 (무시):", describeError(e));
  });
}

/**
 * **은은하게**의 소스색 (ARGB) — 이번 실행에서만 든다. `null` = 없음(아직 못 뽑았거나,
 * 흑백 사진이거나, 은은하게가 아니다).
 *
 * 파일에 적지 않는 이유: 칠해지는 값이 **지금 모드의 `theme.css` 기본값**에서 그때그때
 * 나오므로(모드를 바꾸면 기준색이 바뀐다) 결과를 적어 두면 곧 낡는다. 소스색 하나만 적을
 * 수도 있지만, 그러면 월페이퍼가 바뀔 때마다 파일이 조용히 다시 써진다 — 128px 디코딩
 * 한 번(수십 ms)을 아끼자고 사용자가 누르지 않은 저장을 만들 이유가 없다. 부팅 때 첫
 * 프레임이 틴트 없이 한 번 칠해지지만, 틴트가 chroma 몇 단위라 그 차이는 눈에 걸리지 않는다.
 *
 * `$state` 가 아닌 평범한 `let` 이다 — 읽는 곳이 `applySettings` 하나이고, 그 함수는
 * 명령형으로 불린다 (값이 바뀌면 [`adoptWallpaperTint`] 가 직접 부른다).
 */
let wallpaperTintSource: number | null = null;

/**
 * 은은하게의 소스색을 들인다 (`dynamic-theme.svelte.ts` 가 사진을 읽고 부른다).
 * 같은 값이면 아무 일도 없다 — 창 사이 전파·배경 새로 고침마다 다시 칠할 이유가 없다.
 */
export function adoptWallpaperTint(argb: number | null): void {
  if (wallpaperTintSource === argb) return;
  wallpaperTintSource = argb;
  applySettings();
}

/**
 * **은은하게** — 중성 크롬에 사진의 기운을 얹는다 (docs/log/2026-09-25-wallpaper-tint.md).
 *
 * `applySettings` 의 색 두 단계(`APP_TOKENS` · 파생 토큰)가 끝난 **바로 뒤**에 돈다. 그 둘이
 * 정하지 않은 칸은 방금 인라인에서 지워졌으므로, 이 시점에 `getComputedStyle` 로 읽는 값이
 * 곧 **지금 모드의 `theme.css` 기본값**이다 — 캐시가 필요 없고 모드 전환에도 저절로 맞는다.
 *
 * **사용자가 정한 칸은 칠하지 않는다** ([`TINT_OWNER`]). 바탕을 손으로 고른 사람의 바탕은
 * 고른 그 색 그대로여야 한다 — 색 선택기가 보여 주는 값과 화면이 한 글자라도 다르면 안
 * 되고, 은은하게는 "아무도 안 칠한 회색" 에만 기운을 얹는 층이다. 그래서 전체 모드에서
 * 넘어온 한 벌(여덟 칸이 다 정해져 있다)이나 프로필의 색 위에서는 저절로 아무것도 안 한다.
 *
 * 칠하는 곳은 `--bg-base`·`--bg-panel-base` 같은 **기저색**이라 투명도 슬라이더(`--chrome-pct`)
 * 합성이 그대로 이어진다 (`APP_TOKENS` 와 같은 규칙).
 */
function applyWallpaperTint(root: HTMLElement): void {
  if (wallpaperTintSource === null || settings.dynamicMode !== "subtle") return;
  const computed = getComputedStyle(root);
  const base: Partial<Record<TintToken, string>> = {};
  for (const name of TINT_TOKENS) {
    if (colorSource().app[TINT_OWNER[name]]) continue;
    base[name] = computed.getPropertyValue(name).trim();
  }
  const tint = subtleTint(base, wallpaperTintSource, !isLightNow());
  for (const name of TINT_TOKENS) {
    const value = tint[name];
    if (value) root.style.setProperty(name, value);
  }
}

/**
 * 이 창에 **마지막으로 요청한** 웹뷰 확대 계수 (`null` = 이 페이지에서 아직 한 번도 안 걸었다).
 *
 * `applySettings` 는 색 슬라이더를 끌 때마다 불리므로 같은 값이면 IPC 를 건너뛴다. 처음이
 * `null` 인 이유: 웹뷰 확대는 **페이지 새로고침을 넘어 남는다** — 미저장 125% 를 걸어 둔 채
 * 새로고침하면 설정은 100 인데 웹뷰는 1.25 다. 첫 호출은 언제나 보내야 그 틈이 닫힌다.
 */
let requestedZoom: number | null = null;

/**
 * 웹뷰 확대를 건다 (docs/log/2026-09-25-ui-scale-font.md). **실패를 삼킨다** — 권한이 빠진
 * 옛 빌드나 Tauri 가 없는 자리(테스트·헤드리스)에서 배율 하나 때문에 설정 적용 전체가
 * 멈추면 안 된다. 성공한 계수만 `ui-scale.ts` 에 적어 화면 좌표 변환(`screenToLogical`)이 쓴다.
 */
function applyUiZoom(factor: number): void {
  if (requestedZoom === factor) return;
  requestedZoom = factor;
  let webview;
  try {
    webview = getCurrentWebview();
  } catch {
    return;
  }
  void webview
    .setZoom(factor)
    .then(() => noteAppliedZoom(factor))
    .catch((e: unknown) => {
      console.warn("[aynx] UI 크기를 걸지 못했습니다:", describeError(e));
      // 다음 applySettings 에서 다시 시도하게 둔다.
      if (requestedZoom === factor) requestedZoom = null;
    });
}


// ---------------------------------------------------------------------------
// 창 사이 전파 — **보내는 쪽** (docs/log/2026-09-05-settings-sync.md)
//
// 설정 파일은 앱에 하나뿐인데 창은 여럿이다. 어느 창에서 [저장]을 눌렀든 나머지 창도
// 그 자리에서 따라와야 한다 — 예전에는 창마다 부팅 때 `loadSettings` 를 한 번 하고 끝이라
// 다른 창은 앱을 다시 켜야 새 값을 보았다.
//
// **받는 쪽은 여기 없다.** 다시 읽고 다시 입히는 몸통은 `settings-sync.svelte.ts` 에 있다:
// 그 일에는 `mode`·`wallpaper` 가 필요한데 저 둘은 이미 이 모듈을 부르고 있어, 여기에 두면
// 순환이 된다 (그 모듈 머리말).
// ---------------------------------------------------------------------------

/** 창 사이로 "설정 파일이 방금 바뀌었다" 를 알리는 이벤트 이름 */
export const SETTINGS_SAVED_EVENT = "settings-saved";

/**
 * [`SETTINGS_SAVED_EVENT`] 의 짐 — **창 라벨 한 칸뿐**이다.
 *
 * 설정 값을 싣지 않는 이유는 **진실이 하나여야** 하기 때문이다. 파일이 유일한 진실이고,
 * 받는 창이 자기가 다시 읽으면(`load_settings` → `normalizeSettings`) 정규화가 창마다
 * 한 벌씩 제대로 돌아 값이 갈릴 자리가 없다. 값을 실어 보내면 보낸 창의 `current`(=편집
 * 중인 상태일 수도 있는 값)를 직렬화해 넘기게 되고, 그것이 파일에 실제로 들어간 값과
 * 같다는 보장은 어디에도 없다 — 저장이 반쯤 실패했거나 백엔드가 sanitize 로 깎았을 수 있다.
 *
 * 라벨을 싣는 이유는 Tauri v2 의 `Event<T>` 에 **보낸 창을 알 방법이 없기** 때문이다
 * (`{event,id,payload}` 뿐이다 — v1 의 `windowLabel` 은 사라졌다). 방송은 자기 자신에게도
 * 도착하므로, 자기가 보낸 것을 걸러 내려면 라벨을 짐에 직접 실어야 한다.
 */
export interface SettingsSavedPayload {
  /** 보낸 창의 라벨 */
  from: string;
}

/** 이 창의 라벨 — 처음 물어볼 때 한 번 읽어 캐시한다 (아직 안 읽었으면 `null`) */
let windowLabel: string | null = null;

/**
 * 이 창의 라벨 (`"main"`·`"tear-3"`…). 읽지 못하면 빈 문자열.
 *
 * **모듈 최상단에서 바로 읽지 않는다** — 이 모듈은 테스트·SSR 처럼 Tauri 가 없는 자리에서도
 * 로드될 수 있고, 그때 `getCurrentWindow()` 가 던지면 설정 모듈 전체가 못 뜬다. 게으르게
 * 한 번만 읽으면 그런 환경에서는 아무도 안 부르므로 아무 일도 일어나지 않는다.
 *
 * 실패해도 빈 문자열을 **캐시한다**: 한 번 실패한 환경이 다음 호출에 성공할 리 없고,
 * 빈 라벨끼리는 서로 같으므로 최악의 경우에도 "자기 것으로 보고 무시" 쪽으로 안전하게
 * 떨어진다 (남의 저장을 못 받는 것이 남의 저장으로 내 편집을 날리는 것보다 낫다).
 */
export function thisWindowLabel(): string {
  if (windowLabel !== null) return windowLabel;
  try {
    windowLabel = getCurrentWindow().label;
  } catch {
    windowLabel = "";
  }
  return windowLabel;
}

/**
 * 다른 창들에게 "설정 파일이 방금 바뀌었다" 고 알린다 — **fire-and-forget**.
 *
 * **실패를 삼킨다.** 알림 하나를 못 보냈다고 저장이 실패한 것은 아니다 — 파일은 이미
 * 쓰였고, 못 받은 창은 다음 실행에서 어차피 새 값으로 뜬다. 여기서 던지면 [저장] 버튼이
 * 성공한 저장을 실패로 보여 준다.
 *
 * 부르는 곳은 둘이다: [`saveSettings`] 의 성공 뒤(설정 화면 [저장]·모드 즉시 저장·동적 색
 * 재추출이 전부 여기를 지난다)와, `settings.toml` 을 **백엔드가 직접 쓰는** 월페이퍼
 * 경로(`$lib/wallpaper.svelte.js`) 둘.
 */
export function emitSettingsSaved(): void {
  const payload: SettingsSavedPayload = { from: thisWindowLabel() };
  void emit(SETTINGS_SAVED_EVENT, payload).catch(() => {});
}

/**
 * 앱 시작 시 한 번 부른다 (코디네이터가 `+page.svelte` 에서 배선).
 *
 * **실패를 삼킨다** — 설정 파일이 없거나 명령이 아직 등록되지 않았다고 해서 앱이 못 뜨면 안 된다.
 * 그런 경우 기본값으로 조용히 시작하고 콘솔에만 한 줄 남긴다.
 */
export async function loadSettings(): Promise<void> {
  try {
    const raw = await invoke<AppSettings>("load_settings");
    settings.current = normalizeSettings(raw);
    // 2026-10-18 전 크롬(옛 면 계단)을 같은 테마의 MD3 크롬으로 — 파일은 다음 저장 때 바뀐다
    upgradeLegacyAppColors(settings.current);
    settings.saved = cloneSettings(settings.current);
  } catch (e) {
    console.warn("[aynx] 설정을 읽지 못했습니다 — 기본값으로 시작합니다:", describeError(e));
  }
  applySettings();
}

/**
 * 지금 값을 파일에 쓴다. `loadSettings` 와 달리 **실패를 삼키지 않는다** —
 * 설정 화면 안에 그대로 보여줘야 한다.
 *
 * 성공한 뒤에는 다른 창에 한 줄 알린다 ([`emitSettingsSaved`]). 이 자리 하나로 저장하는
 * 길 셋이 전부 덮인다 — 설정 화면의 [저장], 모드 전환의 즉시 저장(`mode.svelte.ts` 의
 * `persist`), 모드에 맞춰 다시 뽑은 색의 저장(`dynamic-theme.svelte.ts` 의 `modeChanged`).
 * **실패 경로에서는 부르지 않는다**: 파일이 안 바뀌었는데 알리면 다른 창이 옛 값을 다시
 * 읽어 편집을 날린다.
 */
export async function saveSettings(): Promise<void> {
  try {
    settings.saved = await sendSnapshot(settings.current, (payload) => invoke("save_settings", { settings: payload }));
  } catch (e) {
    throw new Error(describeError(e));
  }
  emitSettingsSaved();
}

/** 사용자 터미널 테마 목록을 건다 — 읽기 · 넣기 · 이름 바꾸기 · 지우기 뒤에 `app/term-themes.svelte.ts` 가 부른다 */
export function setUserTermThemes(list: UserTermTheme[]): void {
  settings.userTermThemes = list;
}

/**
 * 지운 사용자 테마를 가리키던 프리셋 칸을 `next` 로 돌리고 **그 한 칸만** 저장한다.
 *
 * 설정 화면에 다른 미저장 편집이 있어도 그것까지 파일에 싣지 않게 `saved` 사본을 고쳐 보낸다 — `current` 도 같은 키였으면
 * 같이 돌려 화면이 곧바로 따라가고 미저장 표시가 생기지 않는다. 둘 다 그 키가 아니면 아무것도 하지 않는다.
 */
export async function replaceTermPresetAndSave(gone: string, next: string | undefined): Promise<void> {
  const value = next === DEFAULT_TERM_PRESET ? undefined : next;
  if (settings.current.terminal.theme === gone) {
    settings.current.terminal.theme = value;
    applySettings();
  }
  if (settings.saved.terminal.theme !== gone) return;
  const snapshot = cloneSettings(settings.saved);
  snapshot.terminal.theme = value;
  try {
    settings.saved = await sendSnapshot(snapshot, (payload) => invoke("save_settings", { settings: payload }));
  } catch (e) {
    throw new Error(describeError(e));
  }
  emitSettingsSaved();
}

/** 마지막으로 저장된 값으로 되돌린다 (설정 화면의 [취소]) */
export function revertSettings() {
  settings.current = cloneSettings(settings.saved);
  applySettings();
}
