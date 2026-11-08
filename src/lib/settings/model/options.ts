// 설정의 **값 범위** — 범위 상수·기본값·선택지 표(키 → 문구 키)·앱 색 토큰 표.
// 룬도 부수효과도 없다. 새 설정 항목은 여기서 시작한다 (docs/modules-frontend.md "어디를 고치나").
import type { Key } from "$lib/i18n/keys";
import type { FileView } from "$lib/session";
import type { StartScreenMode } from "$lib/project-start";
import type { AppTheme, AutomationPrefs } from "./schema";
import { DEFAULT_DOCK_LAYOUT, type DockLayout } from "$lib/dock";
import type { ExecSort } from "$lib/console/exec-rows";

/**
 * 옛 `[vault] auto_lock_minutes` 의 기본값 — **아무도 읽지 않는 값이지만 파일에 쓸지를
 * 정한다**. 이 값과 같으면 안 적는다(백엔드의 `skip_serializing_if` 와 같은 규칙).
 *
 * 볼트의 유휴 시계 자체는 2026-09-19 저녁에 사라졌다 — 잠그는 시점은 프라이버시 가림막
 * 하나다 (docs/log/2026-09-19-vault.md 의 "가림막과 함께 잠긴다").
 */
export const VAULT_AUTO_LOCK_DEFAULT = 30;

/** 글꼴 크기 허용 범위 — `settings.rs` 의 `MIN/MAX_FONT_SIZE` 와 같은 값이어야 한다 */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;

/** 트리거 개수 상한 — `settings.rs` 의 `MAX_TRIGGERS` 와 같은 값이어야 한다 */
export const MAX_TRIGGERS = 50;

/**
 * 자동 승인 상한의 기본값·범위 — **`settings.rs` 의 `AutomationPrefs` 와 같은 값이어야 한다**.
 *
 * 두 상한은 백엔드가 승인 진입에서 강제하는 하드 경계라, 프런트의 정규화·입력 clamp 는
 * 어디까지나 화면 편의다(진짜 방어선은 Rust). 그래도 같은 범위로 자르면 프런트가 보여 주는
 * 값과 백엔드가 강제하는 값이 어긋나지 않는다.
 */
export const AUTO_MAX_TARGETS_DEFAULT = 10;
export const AUTO_MAX_TARGETS_MIN = 1;
export const AUTO_MAX_TARGETS_MAX = 100;
export const AUTO_MAX_CONCURRENCY_DEFAULT = 4;
export const AUTO_MAX_CONCURRENCY_MIN = 1;
export const AUTO_MAX_CONCURRENCY_MAX = 16;

/** A4c 빈도 한도의 기본값·범위 — `settings.rs` 의 상수와 같아야 한다(20건 / 300초). */
export const AUTO_MAX_PER_WINDOW_DEFAULT = 20;
export const AUTO_MAX_PER_WINDOW_MIN = 1;
export const AUTO_MAX_PER_WINDOW_MAX = 1000;
export const AUTO_WINDOW_SECS_DEFAULT = 300;
export const AUTO_WINDOW_SECS_MIN = 1;
export const AUTO_WINDOW_SECS_MAX = 86400;

/**
 * 검토 대기 만료의 기본값·범위 — `settings.rs` 의 상수와 같아야 한다(30분 / 0..=1440).
 * **하한이 `0`** 인 것이 다른 상한들과 갈리는 점이다: 0 은 "너무 짧음" 이 아니라 **만료 없음**이다.
 */
export const APPROVAL_TTL_MINUTES_DEFAULT = 30;
export const APPROVAL_TTL_MINUTES_MIN = 0;
export const APPROVAL_TTL_MINUTES_MAX = 1440;

/**
 * 검토 요청 OS 알림의 기본값 — **켬**. `settings.rs` 의
 * `DEFAULT_NOTIFY_REVIEW_REQUESTS` 와 같아야 한다.
 */
export const NOTIFY_REVIEW_REQUESTS_DEFAULT = true;

/**
 * 실행 결과 OS 알림의 기본값 — **켬**. `settings.rs` 의 `DEFAULT_NOTIFY_OPERATION_RESULTS` 와
 * 같아야 한다.
 */
export const NOTIFY_OPERATION_RESULTS_DEFAULT = true;

/**
 * 감사 로그 보관 일수의 기본값·범위 — `settings.rs` 의 상수와 같아야 한다(90일 / 0..=3650).
 * **하한이 `0`**(지우지 않음)이다.
 */
export const AUDIT_RETENTION_DAYS_DEFAULT = 90;
export const AUDIT_RETENTION_DAYS_MIN = 0;
export const AUDIT_RETENTION_DAYS_MAX = 3650;

/**
 * 아무것도 안 켠 자동 승인 정책 (전부 끔·비움 + 상한 기본값) — 백엔드 `Default` 와 짝이다.
 * **예외 두 칸**: `notify_review_requests`·`notify_operation_results` 는 켜진 채로 시작한다(알리는 칸이다).
 */
export function defaultAutomation(): AutomationPrefs {
  return {
    auto_approve: false,
    allow_patterns: [],
    bundles: [],
    bundle_off: {},
    max_targets: AUTO_MAX_TARGETS_DEFAULT,
    max_concurrency: AUTO_MAX_CONCURRENCY_DEFAULT,
    auto_max_per_window: AUTO_MAX_PER_WINDOW_DEFAULT,
    auto_window_secs: AUTO_WINDOW_SECS_DEFAULT,
    approval_ttl_minutes: APPROVAL_TTL_MINUTES_DEFAULT,
    notify_review_requests: NOTIFY_REVIEW_REQUESTS_DEFAULT,
    notify_operation_results: NOTIFY_OPERATION_RESULTS_DEFAULT,
    audit_retention_days: AUDIT_RETENTION_DAYS_DEFAULT,
    audit_output_excerpt: false,
    allow_pipes: false,
    allow: [],
  };
}

/**
 * 새 트리거의 기본 배경색 (설정 화면의 [추가] 가 이 값으로 시작한다).
 * 내장 WARN 트리거와 같은 값이다 (`settings.rs` 의 `default_triggers`) — 배경만 칠하는
 * 트리거는 45% 알파로 깔리므로 배너용 저채도 값으로는 화면에서 보이지 않는다.
 */
export const DEFAULT_TRIGGER_BG = "#6b4a17";

/**
 * 설정 화면 **[예시 추가]** 의 트리거 색 (`TRIGGER_EXAMPLES`).
 *
 * - 배경(`*Bg`)은 45% 알파로 깔린다 (`triggers.ts` 의 `BG_ALPHA`) — 그래서 내장 두 트리거와
 *   같은 진한 값을 쓴다. `errorBg` 는 내장 ERROR(`settings.rs` 의 `default_triggers`) 와 같다.
 * - 글자색(`*Fg`)은 불투명하게 다시 찍힌다 — 다크(`#12141a`)·흰 배경 **둘 다**에서 대비 3.8 이상인
 *   중간 밝기 값만 고른다 (원색 빨강·초록은 한쪽 테마에서 번지거나 묻힌다).
 */
export const EXAMPLE_TRIGGER_COLORS = {
  /** FATAL·PANIC 등 — ERROR 보다 한 단계 진한 빨강 */
  fatalBg: "#9b1b30",
  /** 내장 ERROR 와 같은 값 */
  errorBg: "#7a2637",
  /** 내장 WARN 과 같은 값 */
  warnBg: DEFAULT_TRIGGER_BG,
  failFg: "#d63c4e",
  passFg: "#1c9150",
  warnFg: "#a97b0c",
  /** 정보용 — 눈에 띄지 않게 가라앉은 청회색 */
  infoFg: "#5b88a5",
} as const;

/** 설정이 비었을 때 쓰는 터미널 글꼴 — `Terminal.svelte` 의 원래 하드코딩 값 */
export const DEFAULT_FONT_FAMILY = "'Cascadia Mono', 'D2Coding', Consolas, monospace";
export const DEFAULT_FONT_SIZE = 14;
/**
 * 투명도 슬라이더 기본값(%) — 앱 배경(월페이퍼 · 없으면 번짐)이 크롬 · 타일에 비치는 정도(낮을수록 많이).
 *
 * 10-22 에 뜻이 바뀌었다(창은 늘 불투명 — 바탕화면은 비치지 않는다). 60 은 글래스 판이 흐린 배경을
 * 비추면서도 터미널 위 글자 대비 4.5:1 을 넘는 자리다(theme.css `--glass-dense`). 예전 기본 100 은
 * 파일에 적히지 않았으므로 그 사용자도 이 값을 받는다.
 */
export const DEFAULT_OPACITY = 60;
/**
 * 슬라이더 하한(%). Windows Terminal 은 0 까지 허용하지만 0% 는 앱 크롬이 통째로 사라져
 * 사이드바·탭 글자만 앱 배경 위에 떠 보인다 — 되돌릴 UI 자체가 안 보이는 상태다.
 * 10% 면 아주 강한 투명감을 주면서도 패널의 윤곽과 글자 대비가 남는다.
 */
export const OPACITY_MIN = 10;
export const OPACITY_MAX = 100;

/**
 * **터미널 칸** 불투명도 기본값(%) — 100 = 불투명 = 지금까지와 완전히 같은 렌더 경로.
 *
 * 크롬 투명도([`DEFAULT_OPACITY`])와 **다른 값**이다. 하나로 묶지 않는 이유는 읽기 좋은
 * 조합이 대개 비대칭이기 때문이다: 크롬(사이드바·탭 바·타일 틈)은 많이 비쳐도 예쁘지만
 * 글자가 앉는 칸까지 같이 비치면 대비가 무너진다. 그래서 손잡이를 둘로 나눠 두고,
 * 설정 화면의 안내도 "터미널은 크롬보다 높게" 를 권한다.
 */
export const DEFAULT_TERM_OPACITY = 100;
/**
 * 터미널 불투명도 하한(%). 0 을 열지 않는 이유는 크롬 쪽과 같다 — 0% 는 글자만 허공에
 * 뜬 칸이 되어 되돌릴 UI 를 찾기 어렵다. 백엔드 `MIN_TERM_OPACITY` 와 같은 값이어야 한다.
 */
export const TERM_OPACITY_MIN = 10;
export const TERM_OPACITY_MAX = 100;

/**
 * 무입력 자동 잠금(분)의 범위 — **`settings.rs` 의 `MIN/MAX_IDLE_LOCK_MIN` 과 같은 값이어야
 * 한다**. `0` 은 이 범위 밖의 특수값("끄기")이라 여기 들지 않는다 — 정규화·설정 setter 가
 * `0` 을 "안 정함"(=끔)으로 접고, 켠 값만 이 범위(1분~4시간)로 자른다.
 */
export const IDLE_LOCK_MIN = 1;
export const IDLE_LOCK_MAX = 240;

/**
 * **긴 명령 완료 알림**의 기본 임계(초). `0` 은 끔이고, 그것은 이 기본값과 **다른 상태**다.
 *
 * 10초인 이유: 그보다 짧은 명령은 사람이 프롬프트 앞에서 기다리는 시간이라 알릴 것이 없다.
 * 10초를 넘기면 대개 다른 창으로 옮겨 가 있고, 바로 그때부터 알림이 뜻을 갖는다.
 */
export const DEFAULT_NOTIFY_AFTER_SECS = 10;
/**
 * 임계의 상한(초) = 하루. **`settings.rs` 의 `MAX_AFTER_SECS` 와 같은 값이어야 한다.**
 * 하한은 없다 — `0`(끔)이 유효한 값이고 그 위는 전부 유효한 초다.
 * 시간 표식의 임계([`DEFAULT_MARK_AFTER_SECS`])도 같은 상한을 쓴다.
 */
export const NOTIFY_AFTER_MAX_SECS = 86_400;

/**
 * **보고 있는 타일의 턴 알림** 기본 임계(초) — `[ai] notify_focused_after_secs`. `0` 은 끔.
 *
 * 60초인 이유: 그보다 짧은 턴은 사람이 화면 앞에서 지켜보는 시간이다. 1분을 넘기면 포커스를 둔 채
 * 자리를 비웠을 수 있고, 돌아왔을 때 배너가 "끝났다" 를 말해 준다. 상한은 [`NOTIFY_AFTER_MAX_SECS`].
 */
export const DEFAULT_NOTIFY_FOCUSED_AFTER_SECS = 60;

/**
 * **실행 시간 표식**의 기본 임계(초). `0` 은 끔이고, 그것은 이 기본값과 **다른 상태**다
 * ([`DEFAULT_NOTIFY_AFTER_SECS`] 와 같은 규칙).
 *
 * 3초인 이유: 1초로 뒀더니 `git status`·`npm run …` 같은 흔한 명령이 전부 걸려 화면
 * 오른쪽에 숫자가 줄줄이 섰다 — 그건 정보가 아니라 무늬다. 사람이 "오래 걸렸네" 라고
 * 느끼기 시작하는 자리가 몇 초 언저리라, 그보다 짧은 것은 적지 않는다.
 */
export const DEFAULT_MARK_AFTER_SECS = 3;

/**
 * **벨**(`\a`)이 왔을 때 무엇을 하는가 — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`CURSOR_STYLES` 와 같은 모양).
 * 키가 그대로 `[terminal] bell` 에 저장된다.
 *
 * - `visual` — 그 타일의 테두리가 강조색으로 **잠깐 번쩍**이고, 안 보는 탭이면 탭에 표식이
 *   남는다. **기본값.**
 * - `visual+sound` — 거기에 짧은 소리 하나(코드로 만든 WebAudio 블립 — 파일을 두지 않는다).
 * - `off` — 아무것도 하지 않는다.
 *
 * 소리를 기본으로 두지 않은 이유: 벨은 탭 완성 실패·`less` 의 끝처럼 **의도 없이** 자주
 * 울린다. 소리는 그때마다 방을 울리지만 테두리 번쩍임은 보고 있을 때만 읽힌다.
 */
export const BELL_MODES = {
  visual: "settings.option.bell.visual",
  "visual+sound": "settings.option.bell.visual+sound",
  off: "settings.option.bell.off",
} as const satisfies Record<string, Key>;

export type BellMode = keyof typeof BELL_MODES;

/** 안 정했을 때의 벨 — 화면만 (소리는 켜서 쓰는 것이다) */
export const DEFAULT_BELL: BellMode = "visual";

/**
 * 월페이퍼 배치 — 키 → **문구 키**(`t()` 가 렌더 때 푼다). `TAB_STYLES` 와 같은 모양의 select 목록이다.
 *
 * 값은 CSS `background-size`/`repeat`/`position` 조합으로 번역된다
 * (`wallpaperLayer` — 프런트 한 곳에서만 CSS 를 안다).
 */
export const WALLPAPER_FITS = {
  cover: "settings.option.wallpaper_fit.cover",
  contain: "settings.option.wallpaper_fit.contain",
  tile: "settings.option.wallpaper_fit.tile",
  center: "settings.option.wallpaper_fit.center",
} as const satisfies Record<string, Key>;

export type WallpaperFit = keyof typeof WALLPAPER_FITS;

/** 안 정했을 때의 배치 — 창을 꽉 채우는 쪽이 배경으로서 기대에 맞는다 */
export const DEFAULT_WALLPAPER_FIT: WallpaperFit = "cover";

/**
 * 이미지 위 검정 덮개 기본값(%).
 *
 * 0 이 아닌 이유는 **가독성**이다. 이 앱의 흐린 글자(`--fg-muted`)와 경계선(`--border`)은
 * 어두운 바탕을 전제로 고른 색이라, 밝은 사진을 그대로 깔면 타일 사이 거터에 뜬 글자가
 * 곧바로 안 읽힌다. 40% 면 대부분의 사진에서 사진임을 알아볼 수 있으면서 글자가 산다.
 */
export const DEFAULT_WALLPAPER_DIM = 40;
export const WALLPAPER_DIM_MIN = 0;
/** `settings.rs` 의 `MAX_DIM` 과 같은 값이어야 한다 */
export const WALLPAPER_DIM_MAX = 100;

/** 블러 반경 px. `settings.rs` 의 `MAX_BLUR` 와 같은 값이어야 한다 */
export const WALLPAPER_BLUR_MIN = 0;
export const WALLPAPER_BLUR_MAX = 20;

/**
 * 탭 바 모양 — 키 → **문구 키**(`t()` 가 렌더 때 푼다). `TERM_PRESETS` 처럼 select 의 목록으로도 쓴다.
 * **표의 순서가 곧 select 의 순서이고, 기본값이 맨 위다** (아래 다른 디자인 표들도 같다 —
 * docs/log/2026-10-01-design-defaults.md).
 *
 * - `pill` — 둥근 알약. **기본값.**
 * - `flat` — 판 없이 활성 탭 아래에 강조색 밑줄(2026-10-24).
 *
 * 두 모양 모두 **순수 CSS** 로 그린다 — 글리프 폰트에 의존하지 않는다.
 *
 * `powerline`(채운 세그먼트 + 화살표)은 2026-10-01 에, 평행사변형 모양은 2026-10-24 에 뺐다. 그 값이
 * 남은 설정 파일·테마 프로필은 정규화(`known`)가 모르는 값으로 버려 기본(`pill`)으로 떨어진다 — 오류 없이
 * (docs/log/2026-10-01-design-defaults.md).
 */
export const TAB_STYLES = {
  pill: "settings.option.tab_style.pill",
  flat: "settings.option.tab_style.flat",
} as const satisfies Record<string, Key>;

export type TabStyle = keyof typeof TAB_STYLES;

/** 안 정했을 때의 탭 모양 — 알약이 기본이다 (2026-10-11 디자인 점검) */
export const DEFAULT_TAB_STYLE: TabStyle = "pill";

/**
 * **호스트 목록의 정렬** — 키 → **문구 키** (docs/log/2026-09-23-host-history.md).
 * 문구는 정렬 버튼의 말풍선이다("정렬: 이름순" — 지금 순서만 말한다).
 * 키는 `settings.toml` 의 `[hosts] sort` 에 저장되므로 **바꾸지 않는다**.
 */
export const HOST_SORTS = {
  name: "app.hosts.sort.name",
  recent: "app.hosts.sort.recent",
} as const satisfies Record<string, Key>;

export type HostSort = keyof typeof HOST_SORTS;

/** 안 정했을 때의 정렬 — 예전 그대로 이름(설정 파일 순서)이다 */
export const DEFAULT_HOST_SORT: HostSort = "name";

/**
 * **파일 타일의 보기** — 키 → **문구 키** (docs/log/2026-10-07-file-tile-dolphin.md).
 * 키는 `settings.toml` 의 `[files] default_view` 와 배치 파일의 `fileView` 에 저장되므로 **바꾸지 않는다**
 * (`session/spec.ts` 의 `FileView` 와 같은 세 글자). 옛 두 값(`tree`·`navigate`)은 읽을 때 `details` 로 옮긴다
 * (`normalize.ts` → `migrateFileView`).
 */
export const FILE_VIEWS = {
  icons: "settings.general.files_view.option.icons",
  compact: "settings.general.files_view.option.compact",
  details: "settings.general.files_view.option.details",
} as const satisfies Record<FileView, Key>;

/** 안 정했을 때의 보기 — 자세히다 (옛 기본 "트리" 를 흡수한 보기 — 2026-10-07) */
export const DEFAULT_FILE_VIEW: FileView = "details";

/**
 * **프로젝트 시작 화면을 언제 세우나** — 키 → **문구 키** (docs/log/2026-09-26-project-start-screen.md).
 * 키는 `settings.toml` 의 `[projects] start_screen` 에 저장되므로 **바꾸지 않는다**.
 *
 * - `auto` — 로컬 프로젝트·워크트리를 열 때 셸 대신 시작 화면(2026-09-27 부터는 지난 대화가 없는 폴더도 —
 *   docs/log/2026-09-27-folder-conversations.md). **기본값.**
 * - `off` — 늘 곧장 셸(또는 시작 명령)을 연다 — 이 기능 전과 같다.
 */
export const PROJECT_START_SCREENS = {
  auto: "settings.general.project_start.option.auto",
  off: "settings.general.project_start.option.off",
} as const satisfies Record<StartScreenMode, Key>;

/** 안 정했을 때 — 로컬 프로젝트·워크트리를 열면 선다 */
export const DEFAULT_PROJECT_START_SCREEN: StartScreenMode = "auto";

/**
 * **AI 아이콘 모양** — 키 → 문구 키. 키가 그대로 `[ai] icon_style` 에 저장된다(docs/log/2026-10-31-avatars.md). 전역 한 칸이고
 * 탭 · 타일 머리줄 · 독/런처 · 채팅 독 · 앱 안 알림 · AI 로딩 덮개가 모두 따른다(`$lib/avatars.svelte` 의 `aiAvatarSrc` · `AiGlyph`).
 *
 * - `logo` — 그 CLI 의 브랜드 로고. **기본값**.
 * - `avatar` — CLI 마다 고른 아바타(`[ai] avatar_claude` · `avatar_codex` — 기본 [`DEFAULT_AI_AVATARS`]).
 *
 * 옛 칸 `[ai] loading_art`(10-24 로딩 덮개 그림 — `logo` | `character`)는 정규화가 `character` → `avatar` 로 옮긴다(Rust 도 같은 이사).
 */
export const AI_ICON_STYLES = {
  logo: "settings.theme.avatar.style.option.logo",
  avatar: "settings.theme.avatar.style.option.avatar",
} as const satisfies Record<string, Key>;

export type AiIconStyle = keyof typeof AI_ICON_STYLES;

/** 안 정했을 때의 AI 아이콘 모양 — **브랜드 로고** */
export const DEFAULT_AI_ICON_STYLE: AiIconStyle = "logo";

/**
 * AI CLI 별 **기본 아바타** — 매핑을 안 정했거나 고른 그림이 지워졌을 때. 키는 로고 이름(`aiIconName`)과 같은 CLI 낱말, 값은 앱 아이콘
 * id(내장 키 — 10-24 로딩 덮개의 `character` 와 같은 짝: claude → claude, codex → gpt).
 */
export const DEFAULT_AI_AVATARS = { claude: "claude", codex: "gpt" } as const;

/**
 * **터미널 우클릭이 무엇을 하는가** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`TAB_STYLES` 와 같은 모양의 select).
 * 키가 그대로 `[terminal] right_click` 에 저장된다
 * (docs/log/2026-09-05-terminal-context-menu.md).
 *
 * - `menu` — 우클릭이 컨텍스트 메뉴를 연다. **기본값.** `Shift+우클릭` 은 즉시 붙여넣기.
 * - `paste` — 드래그 선택이 끝나면 그 텍스트가 곧바로 클립보드로 가고, 우클릭은
 *   **언제나 붙여넣기**다 (선택이 남아 있어도 복사가 아니라 붙여넣기). `Shift+우클릭` 이 메뉴.
 *
 * 두 벌 다 같은 붙여넣기 통로를 쓴다 — 여러 줄이면 [`confirmMultilinePaste`] 가 한 번 묻는다.
 */
export const RIGHT_CLICK_MODES = {
  menu: "settings.option.right_click.menu",
  paste: "settings.option.right_click.paste",
} as const satisfies Record<string, Key>;

export type RightClickMode = keyof typeof RIGHT_CLICK_MODES;

/**
 * 안 정했을 때의 우클릭 — **메뉴**다. 이 앱의 다른 화면(탭·타일 헤더·파일 목록)이 전부
 * 우클릭에 메뉴를 내므로, 터미널만 다르게 굴면 그 규칙을 매번 예외로 기억해야 한다.
 */
export const DEFAULT_RIGHT_CLICK: RightClickMode = "menu";

/**
 * **터미널 커서 모양** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`TAB_STYLES` 와 같은 모양의 select). 키가
 * 그대로 `[terminal] cursor_style` 에 저장되고 xterm `cursorStyle` 로 내려간다.
 *
 * - `block` — 칸을 꽉 채우는 블럭. **기본값.**
 * - `underline` — 글자 아래 밑줄.
 * - `bar` — 글자 앞 세로선(I-beam).
 */
export const CURSOR_STYLES = {
  block: "settings.option.cursor_style.block",
  underline: "settings.option.cursor_style.underline",
  bar: "settings.option.cursor_style.bar",
} as const satisfies Record<string, Key>;

export type CursorStyle = keyof typeof CURSOR_STYLES;

/** 안 정했을 때의 커서 모양 — **블럭**(지금까지 하드코딩이던 값 그대로다). */
export const DEFAULT_CURSOR_STYLE: CursorStyle = "block";

/**
 * **타일 배치 방식** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`TAB_STYLES` 와 같은 모양의 select 목록).
 *
 * - `spiral` — 가장 최근에 놓인 칸을 시계 방향으로 계속 쪼갠다 (`spiralInsert`). **기본값.**
 * - `focus` — 지금 포커스된 타일의 긴 변을 쪼갠다 (`autoSplitDir` — 2026-09-04 이전의 규칙).
 *
 * 방향을 **사람이 이미 고른** 길에는 어느 쪽도 끼어들지 않는다 — 툴바의 ◫/⬓ 버튼, 드롭
 * 4분면, 그룹 전체 열기(균형 격자), 시작 타일 교체 (docs/log/2026-09-04-spiral-tiling.md).
 */
export const TILING_MODES = {
  spiral: "settings.option.tiling.spiral",
  focus: "settings.option.tiling.focus",
} as const satisfies Record<string, Key>;

export type TilingMode = keyof typeof TILING_MODES;

/** 안 정했을 때의 타일 배치 — 나선이 기본이다 */
export const DEFAULT_TILING: TilingMode = "spiral";

/**
 * **타일 헤더를 언제 다는가** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`TILING_MODES` 와 같은 모양의 select).
 * 키가 그대로 `[app] tile_header` 에 저장된다 (docs/log/2026-09-05-tile-header.md).
 *
 * - `always` — 타일 하나짜리 탭에도 붙는다. **기본값.**
 * - `multi` — 2개 이상일 때만 (2026-09-05 이전의 동작).
 * - `never` — 헤더 없음. 이름표도 ×도 없고 조작은 전부 단축키다.
 *
 * **시작 타일에는 어느 값이든 붙지 않는다** — 그 화면은 로고와 바로가기가 가운데 서 있는
 * 그림이라 위에 띠가 붙으면 그 자리에서만 어긋나 보이고, 옮기고 닫을 정체성도 없다
 * (`PaneHost` 의 `headed` 참고).
 */
export const TILE_HEADER_MODES = {
  always: "settings.option.tile_header.always",
  multi: "settings.option.tile_header.multi",
  never: "settings.option.tile_header.never",
} as const satisfies Record<string, Key>;

export type TileHeaderMode = keyof typeof TILE_HEADER_MODES;

/**
 * 안 정했을 때의 타일 헤더 — **항상**이다.
 *
 * 예전 기본(`multi`)에서는 타일이 하나뿐인 탭에서 헤더에만 있는 조작
 * (SFTP 📂 · 원격 편집 ✎ · AI 공유 ✦ · 출력 복사 ⧉ · 최대화 ⤢ · 닫기 ×)이 통째로
 * 사라졌다 — 단축키를 아는 사람만 쓸 수 있는 기능이 되어 있었다.
 */
export const DEFAULT_TILE_HEADER: TileHeaderMode = "always";

/**
 * **상태바를 어느 가장자리에 두는가** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`TILE_HEADER_MODES` 와 같은
 * 모양의 select). 키가 그대로 `[app] status_bar` 에 저장된다.
 *
 * - `left` — 왼쪽 세로 기둥. **기본값** (2026-10-01 사용자 결정 — docs/log/2026-10-01-design-defaults.md).
 * - `top` — 탭 바 **아래**, 본문 **위** 가로 띠 (탭 바가 이미 창 제어를 쥐고 있어 그 위가 아니다).
 * - `bottom` — 본문 아래 가로 띠 (tmux 상태줄·i3bar 의 관례 자리).
 * - `right` — 오른쪽 세로 기둥. 세로 둘은 30px 폭이라 세션 이름은 접히고 아이콘만 선다.
 *
 * 색 토큰이 아니라 [`tile_header`] 와 같은 **동작 플래그**라 `[app]` 에 산다. 모르는 값은
 * 정규화가 버린다 = 기본값 추종 (`tab_style`·`tile_header` 과 같은 규칙).
 */
export const STATUS_BAR_POSITIONS = {
  left: "settings.option.status_bar.left",
  top: "settings.option.status_bar.top",
  bottom: "settings.option.status_bar.bottom",
  right: "settings.option.status_bar.right",
} as const satisfies Record<string, Key>;

export type StatusBarPosition = keyof typeof STATUS_BAR_POSITIONS;

/**
 * 안 정했을 때의 상태바 자리 — **왼쪽**이다 (2026-10-01 사용자 결정). 그 전에는 위(`top`)였다 —
 * 값을 안 정한 사람의 화면은 이 변경으로 왼쪽 기둥으로 옮겨 간다(의도한 변경,
 * docs/log/2026-10-01-design-defaults.md).
 */
export const DEFAULT_STATUS_BAR: StatusBarPosition = "left";

/**
 * **상태바 모양** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`STATUS_BAR_POSITIONS` 와 같은 모양의 select).
 * 키가 그대로 `[app] status_bar_style` 에 저장되고, `StatusBar.svelte` 의 `data-style` 로 내려간다.
 *
 * - `flat` — 지금까지의 평면 띠. **기본값** (본문과 맞닿은 변에 `--border` 한 줄만).
 * - `panel` — 타일처럼 사방 여백 + 전 모서리를 둥글려 떠 있는 패널로 만든다.
 * - `hug` — 평면 그대로에 타일 캔버스의 **상태줄 쪽 두 모서리만** 둥글게 파서, 상태줄 면이 타일 무리를 감싸 안는다
 *   (2026-10-16 사용자 결정 — 목업의 "상태줄 쪽 감싸기"). 타일 크기 · 자리 · 틈은 평면과 같다(`+page.svelte` 의 `.pane`
 *   모서리 조각 — 곡선은 타일 모서리와 같은 중심 · 직선은 곡선 끝부터 캔버스가 긋는다).
 *
 * 자리(`STATUS_BAR_POSITIONS`)와 짝이라 같은 규칙으로 산다 — 모르는 값은 정규화가 버린다
 * = 기본값(`flat`) 추종.
 */
export const STATUS_BAR_STYLES = {
  flat: "settings.option.status_bar_style.flat",
  panel: "settings.option.status_bar_style.panel",
  hug: "settings.option.status_bar_style.hug",
} as const satisfies Record<string, Key>;

export type StatusBarStyle = keyof typeof STATUS_BAR_STYLES;

/** 안 정했을 때의 상태바 모양 — **평면**(지금까지의 얇은 띠 그대로다). */
export const DEFAULT_STATUS_BAR_STYLE: StatusBarStyle = "flat";

/**
 * **독 배치** — 키 → **문구 키** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md). 키가 그대로 `[dock] layout` 에
 * 저장되므로 **바꾸지 않는다**. 런처 독이 선 쪽을 고르고 채팅 독은 늘 반대쪽이다(`$lib/dock` 의 `dockSides`).
 * 기본은 `launcher-left` — 상태바 자리와는 무관하다(예전에는 상태바가 오른쪽이면 런처가 오른쪽이었다 · 이전 없음).
 */
export const DOCK_LAYOUTS = {
  "launcher-left": "settings.option.dock_layout.launcher_left",
  "launcher-right": "settings.option.dock_layout.launcher_right",
} as const satisfies Record<DockLayout, Key>;

export { DEFAULT_DOCK_LAYOUT };

/**
 * **작업안 실행 목록의 정렬** — 키 → **문구 키**(2026-11-01). 키가 그대로 `[plans] exec_sort` 에 저장되므로 **바꾸지 않는다**.
 * 문구는 정렬 단추의 말풍선이다(지금 순서만 말한다 — `HOST_SORTS` 와 같은 규칙). 도는 · 승인된 실행은 정렬과 상관없이 늘 위다.
 */
export const EXEC_SORTS = {
  newest: "board.exec.sort.newest",
  oldest: "board.exec.sort.oldest",
} as const satisfies Record<ExecSort, Key>;

/** 안 정했을 때의 정렬 — 최근 먼저 */
export const DEFAULT_EXEC_SORT: ExecSort = "newest";

/**
 * **앱 크롬 재질** — 키 → **문구 키**(`t()` 가 렌더 때 푼다) (`STATUS_BAR_STYLES` 와 같은 모양의 select).
 * 키가 그대로 `[app] material` 에 저장되고, `<html data-material>` 로 내려간다(`mode.svelte.ts`).
 *
 * - `glass` — 반투명 판 + 앱 안 흐림(`backdrop-filter`). **기본값** (2026-10-11 사용자 결정).
 * - `flat` — 불투명 평면. 2026-10-11 이전의 모습 그대로다.
 *
 * 색과 독립된 축이다 — 유리의 물빛은 `theme.css` 가 크롬 토큰에서 파생한다. 모르는 값은 정규화가
 * 버린다 = 기본값(`glass`) 추종.
 */
export const MATERIALS = {
  flat: "settings.option.material.flat",
  glass: "settings.option.material.glass",
} as const satisfies Record<string, Key>;

export type Material = keyof typeof MATERIALS;

/** 안 정했을 때의 재질 — **글래스** (2026-10-11 사용자 결정). */
export const DEFAULT_MATERIAL: Material = "glass";

/**
 * **앱 아이콘(창·작업 표시줄)** — 키 → **문구 키** (docs/log/2026-10-04-app-icon-switch.md).
 * 키가 그대로 `[app] app_icon` 에 저장되고, Rust `app_icon.rs` 의 표와 **같은 글자**다(바꾸지 않는다).
 * 넷 다 미리 만든 캐릭터 아이콘이고, 기본 `gpt` 는 빌드에 박힌 아이콘과 같은 그림이다(2026-10-22 내장 넷을 통째로
 * 바꿨다 — docs/log/2026-10-22-custom-app-icon.md). 모르는 값(옛 `luna` · `aoi` · `hikari` · `sumire` 포함)은
 * 정규화가 버린다 = 기본값(`gpt`) 추종. 썸네일은 `src/lib/assets/app-icons/<키>.png`. 순서 = 고르기 칩 순서(기본이 앞).
 */
export const APP_ICONS = {
  gpt: "settings.option.app_icon.gpt",
  claude: "settings.option.app_icon.claude",
  gemini: "settings.option.app_icon.gemini",
  grok: "settings.option.app_icon.grok",
} as const satisfies Record<string, Key>;

export type AppIcon = keyof typeof APP_ICONS;

/** 안 정했을 때의 앱 아이콘 — 빌드 아이콘과 같은 그림인 GPT. */
export const DEFAULT_APP_ICON: AppIcon = "gpt";

/**
 * **사용자 앱 아이콘 id** — `user-<16진수 소문자 12자>` (docs/log/2026-10-22-custom-app-icon.md). Rust `app_icon/user.rs` 의
 * `is_user_id` 와 같은 모양이고, 그 파일(`<설정 루트>/app-icons/<id>.png`)은 Rust 가 만들고 지운다. 설정에는 이 글자 하나만 적힌다 —
 * 모양만 보고 남기고(파일이 없으면 Rust 가 기본 그림을 건다) 모양이 틀리면 버린다.
 */
const USER_APP_ICON_RE = /^user-[0-9a-f]{12}$/;

/** 이 값이 사용자 앱 아이콘 id 모양인가 */
export function isUserAppIconId(v: unknown): v is string {
  return typeof v === "string" && USER_APP_ICON_RE.test(v);
}

/** `[app] app_icon` 으로 받을 수 있는 값인가 — 내장 캐릭터 키이거나 사용자 아이콘 id */
export function isAppIconId(v: unknown): v is string {
  return (typeof v === "string" && Object.hasOwn(APP_ICONS, v)) || isUserAppIconId(v);
}

/**
 * **앱 모드** — 키 → **문구 키**(`t()` 가 렌더 때 푼다). 밝기는 직접 고른다.
 * 키가 그대로 `[app] mode` 에 저장된다.
 *
 * 이 목록이 `mode.svelte.ts` 가 아니라 여기 사는 이유는 **의존 방향**이다. 정규화
 * ([`normalizeSettings`])가 모르는 값을 걸러야 하므로 이 모듈이 후보를 알아야 하는데,
 * 저쪽은 이미 이 모듈을 부르고 있다 (모드 전환이 프리셋 교체·토큰 갱신을 일으킨다).
 * 목록을 저쪽에 두면 두 모듈이 서로를 부르게 되므로, `TAB_STYLES`·`TILING_MODES` 처럼
 * **설정 스키마가 아는 목록**에 나란히 세우고 저쪽은 그것을 다시 내보내기만 한다.
 */
export const APP_MODES = {
  dark: "settings.option.mode.dark",
  light: "settings.option.mode.light",
} as const satisfies Record<string, Key>;

export type AppMode = keyof typeof APP_MODES;

/** 앱 기본 밝기는 Dark다. */
export const DEFAULT_APP_MODE: AppMode = "dark";

/**
 * **화면 언어** — `[app] language` 에 그대로 저장되는 후보 둘
 * (docs/log/2026-09-17-i18n.md).
 *
 * `APP_MODES` 와 다른 점이 하나 있다: **"안 정함" 이 진짜 선택지다.** 값이 없으면 OS 를
 * 따라가므로(`resolveLocale`), select 의 첫 항목([`LANGUAGE_AUTO`])은 이 표에 없다 —
 * 표는 "파일에 적힐 수 있는 값" 의 목록이고, 정규화(`known`)가 그 밖의 값을 버린다.
 *
 * 값이 문구 키가 **아닌** 것도 그래서다: 언어 이름은 어느 언어로 보든 제 글자로 적어야
 * 하므로 사전에 두지 않고 [`LANGUAGE_NAMES`] 에 상수로 둔다 (자동만 번역한다).
 */
export const LANGUAGES = {
  ko: "ko",
  en: "en",
} as const;

export type Language = keyof typeof LANGUAGES;

/**
 * 언어 select 의 **첫 항목** — "안 정함"(= OS 를 따른다)을 고르는 값이다.
 *
 * 저장 값이 `undefined` 라 `<option value>` 로 쓸 글자가 필요해서 둔다. 이 문자열은
 * `LANGUAGES` 에 없으므로 [`setLanguage`] 가 그대로 "안 정함" 으로 읽는다.
 */
export const LANGUAGE_AUTO = "auto";

/**
 * 언어 **이름**은 언제나 그 언어의 글자로 적는다 (`한국어` · `English`).
 *
 * 사전(`i18n/ko|en/settings.ts`)에 두지 않는 이유가 여기 있다 — 사전에 두면 영어 사전에
 * `한국어` 를 적어야 하고, 그것은 "영어 사전에 한글이 없다" 는 테스트와 정면으로 부딪친다.
 * 번역되는 것은 첫 항목("자동 (시스템)")뿐이다.
 */
export const LANGUAGE_NAMES: Record<Language, string> = {
  ko: "한국어",
  en: "English",
};

/** 합자를 켰을 때 사용자가 글꼴을 안 정했으면 이 합자 지원 스택으로 폴백한다 (Cascadia Code) */
export const LIGATURE_FONT_FAMILY =
  "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace";

/** `--accent` 처럼 앱이 관리하는 CSS 토큰 이름. 키는 `AppTheme` 의 필드명과 짝을 이룬다 */
// `opacity` 는 색 토큰이 아니라 숫자 설정이라 여기 없다 — 그래서 `Partial` 로
// AppTheme 의 **일부** 키만 토큰에 대응시킨다 (색 3개만 CSS 변수로 나간다).
// `bg`/`bg_panel` 은 `--bg`/`--bg-panel` 이 아니라 **기저색 토큰**(`-base`)에 쓴다 —
// 실제 `--bg` 는 theme.css 가 기저색 × `--chrome-pct` 로 합성하므로, 사용자가 고른 커스텀
// 색에도 투명도 슬라이더가 그대로 먹는다 (인라인 `--bg` 로 덮으면 합성이 끊겨 불투명해진다).
export const APP_TOKENS = {
  accent: "--accent",
  bg: "--bg-base",
  bg_panel: "--bg-panel-base",
  // 테마 버튼과 월페이퍼 추출이 함께 채운다
  // (`AppTheme` 주석). 배관은 위 셋과 완전히 같아서, 손으로 파일에 적으면 그대로 걸린다.
  fg: "--fg",
  border: "--border",
  err: "--err",
  ok: "--ok",
  warn: "--warn",
} as const satisfies Partial<Record<keyof AppTheme, string>>;

export type AppTokenKey = keyof typeof APP_TOKENS;
