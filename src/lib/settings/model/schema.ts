// 설정의 **모양** — Rust `settings.rs` 와 1:1 인 인터페이스들(`AppSettings` 와 각 테이블).
// 값·기본값·목록은 `options.ts`, 정규화는 `normalize.ts` (docs/modules-frontend.md).
import type { DynamicMode } from "$lib/dynamic-color";
import type { MessengerPrefsRaw } from "$lib/messenger-notify";
import type { Trigger } from "$lib/triggers";

/** Rust `AppTheme` 와 1:1 (snake_case 유지) */
export interface AppTheme {
  accent?: string | null;
  bg?: string | null;
  bg_panel?: string | null;
  /**
   * 색 테마 버튼과 월페이퍼 추출([`dynamic`])이 채우는 칸이다.
   * 손으로 `settings.toml` 을 고쳐 넣는 것은 되고, 규칙은 위 셋과 같다
   * (CSS 색 문자열 그대로, 빈 값 = 안 정함 = `theme.css` 기본값).
   */
  fg?: string | null;
  border?: string | null;
  err?: string | null;
  ok?: string | null;
  warn?: string | null;
  /**
   * 월페이퍼가 앱 색에 **얼마나** 들어오는가 — `off` · `subtle` · `full`
   * (docs/log/2026-09-04-dynamic-color.md · docs/log/2026-09-25-wallpaper-tint.md).
   * `null`/`undefined` = 안 정함 = 월페이퍼가 있으면 `subtle`, 없으면 `off`
   * ([`resolveDynamicMode`]). 옛 파일의 `dynamic = true` 는 `full` 로 읽힌다.
   *
   * `full` 은 **표시**다 — 값은 이미 여덟 칸과 `[terminal.dynamic]` 에 들어 있어서
   * 이 값이 없어도 화면은 똑같이 칠해진다. 켜져 있는 동안 달라지는 것은 두 가지다:
   * 월페이퍼를 바꾸면 자동으로 다시 뽑고, 배경을 지우면 색도 같이 걷힌다.
   * 색 테마 버튼이나 터미널 프리셋을 고르면 `off` 로 내려간다.
   *
   * `subtle` 은 파일에 **색을 남기지 않는다** — 사진의 소스색은 이번 실행에서만 들고
   * ([`adoptWallpaperTint`]) 칠하는 것은 [`applySettings`] 가 그때그때 한다.
   */
  dynamic?: DynamicMode | null;
  /**
   * 앱 크롬 · 타일 면의 **불투명도 %**(10~100) — 앱 배경(월페이퍼 · 없으면 번짐)이 그만큼 비친다
   * (창 밖은 비치지 않는다 — 10-22). `null`/`undefined` = 기본 [`DEFAULT_OPACITY`].
   * 프런트가 `--chrome-pct` 로 합성한다 — 글래스 판 진하기(`--glass-dense`)도 이 값을 탄다 (터미널 칸은 영향 없음).
   */
  opacity?: number | null;
  /**
   * **시작 시 SSH 자동 재접속** (docs/log/2026-09-03-workspace-restore.md).
   * `null`/`undefined` = 안 정함 = **끔**(false).
   *
   * 배치 복원으로 되살아난 SSH 타일은 기본적으로 "복원됨 — 연결되지 않음" 상태로 뜬다
   * (한 순간에 여러 서버로 핸드셰이크가 몰리는 위험 · 요청하지 않은 접속). 이 값을 켜면
   * 시작 직후 `reconnect-all` 과 같은 **계단식**(120ms 간격) 재연결이 자동으로 한 번 돈다.
   *
   * 앱 크롬 설정은 아니지만 `app` 테이블에 둔다 — "앱을 켤 때의 동작" 이라 터미널
   * 프리셋(`terminal`)보다 여기가 맞고, 백엔드 계약도 `app.auto_reconnect` 하나로 끝난다.
   */
  auto_reconnect?: boolean | null;
  /**
   * **창을 모두 닫으면 트레이에 남는가** (③-4 — 세션 서버 이후의 GUI 수명). `null`/`undefined` = 안 정함 = **켬**.
   *
   * 켜면 마지막 창(주 창 X)을 닫아도 GUI 가 트레이에 남는다 — 작업안 결과 OS 알림·메신저가 계속 돈다. 끄면 그 자리에서
   * GUI 가 끝난다. 어느 쪽이든 세션은 세션 서버에 산다. 트레이가 없는 환경이면 Rust 가 끄기 동작으로 떨어진다
   * (`tray_status`). 파일에는 **끌 때만** 적는다(auto_reconnect 의 반대 — 기본이 켬이라서).
   */
  tray_on_close?: boolean | null;
  /**
   * **옛 키** — 로컬 타일 머리줄의 자원 칩 켬끔(2026-10-17). 2026-10-18 부터 칩 켬끔은 [`header_chips_hidden`] 하나가 쥔다 —
   * 정규화가 `false` 를 거기의 `"resource"` 로 옮기고 이 칸은 비운다(그래서 다음 저장부터 파일에서 사라진다).
   */
  resource_chip?: boolean | null;
  /**
   * **타일 머리줄 칩의 순서**(2026-10-18 — `$lib/header-chips` 의 id). `null`/`undefined` = 기본 순서. 정규화가 모르는 id ·
   * 중복을 버리고 빠진 칩을 기본 자리 근처에 끼워 **모든 칩이 한 번씩 든** 배열로 만든다 — 기본과 같으면 비운다(파일에 안 적힘).
   * 옛 id `ai_read`(로컬 "AI 읽기" 칩)는 10-23 에 `ai` 로 합쳤다 — 이 칸과 [`header_chips_hidden`] 을 함께 보고 옮긴다(`migrateLegacyChips`).
   */
  header_chip_order?: string[] | null;
  /**
   * **끈 머리줄 칩**(2026-10-18) — 켠 것이 아니라 끈 것을 적는다: 새 칩이 생기면 저절로 켬이다. 비었으면 파일에 안 적힌다(= 전부 켬).
   */
  header_chips_hidden?: string[] | null;
  /**
   * **상태바의 자원 고리**(이 PC 전체 CPU · 메모리 — `StatusBar.svelte`). `null`/`undefined` = 안 정함 = **켬**. 끄면 고리가 서지 않고
   * 상태바 몫의 표본 당김도 멈춘다(타일 자원 칩 · 자원 화면은 그대로). 파일에는 **끌 때만** 적는다(`tray_on_close` 와 같은 규칙).
   */
  resource_rings?: boolean | null;
  /**
   * **상태바의 사용량 고리**(AI CLI 사용 한도 — `StatusBar.svelte` 의 `usageRings`). `null`/`undefined` = 안 정함 = **켬**.
   * 끄면 고리만 서지 않는다(사용량 화면 · 대시보드는 그대로). 파일에는 **끌 때만** 적는다(`resource_rings` 와 같은 규칙).
   */
  usage_rings?: boolean | null;
  /**
   * **제목줄의 창 단추**(최소화 · 최대화 · 닫기 — `chrome/WindowTitlebar`, 2026-10-28). `null`/`undefined` = 안 정함 = **끔** —
   * 닫기는 독의 [끝내기…] 모달(`dialogs/QuitDialog`)이, 최대화는 탭 뒤 빈 곳 더블클릭이, 최소화는 OS 단축키가 맡는다.
   * 파일에는 **켤 때만** 적는다.
   */
  window_controls?: boolean | null;
  /**
   * **새 타일이 어디로 들어가는가** (docs/log/2026-09-04-spiral-tiling.md).
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_TILING`]**(`spiral`).
   *
   * - `spiral` — 가장 최근에 놓인 칸을 시계 방향으로 계속 쪼갠다 (dwindle).
   * - `focus` — 지금 포커스된 타일의 **긴 변**을 쪼갠다 (2026-09-04 이전의 규칙).
   *
   * 색 토큰이 아니라 [`auto_reconnect`] 와 같은 **동작 플래그**라 `[app]` 에 산다. 모르는
   * 값은 정규화가 버린다 = 기본값 추종 (`theme`·`tab_style` 과 같은 규칙).
   */
  tiling?: string | null;
  /**
   * **앱 모드** — 다크 / 라이트 (docs/log/2026-09-04-light-theme.md).
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_APP_MODE`]**(`dark`).
   *
   * 위 색 토큰들과 **층이 다르다**: 이 값이 어느 팔레트(`theme.css` 의 `[data-theme]` 블록)를
   * 통째로 쓸지 정하고, 색 토큰은 그 위에 얹는 오버라이드다. AYNX 테마 버튼으로
   * 색 여덟 칸을 걷어도 이 칸은 남는다 ([`setAppColorTheme`]).
   *
   * 값을 실제로 화면에 거는 곳은 `mode.svelte.ts` 하나뿐이다 — 이 모듈은 다른 `[app]` 키와
   * 똑같이 정규화·저장·비교만 한다 (모르는 값은 버린다 = 기본값 추종).
   */
  mode?: string | null;
  /**
   * **화면 언어** — `ko` · `en` (docs/log/2026-09-17-i18n.md).
   * `null`/`undefined` = 안 정함 = **OS 를 따른다** (`navigator.language`).
   *
   * [`mode`] 와 같은 층의 값이다 — 색이 아니라 "앱이 어떻게 보이는가" 이고, 값을 실제로
   * 화면에 거는 곳은 [`applyStoredLanguage`] 하나뿐이다. 모르는 값은 정규화가 버린다
   * (= 안 정함 = OS 추종).
   */
  language?: string | null;
  /**
   * **타일 헤더를 언제 다는가** (docs/log/2026-09-05-tile-header.md).
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_TILE_HEADER`]**(`always`).
   *
   * - `always` — 타일이 하나뿐이어도 헤더가 붙는다 (이름·📂·✦·⤢·× 가 늘 보인다).
   * - `multi` — 타일이 2개 이상인 탭에만 (2026-09-05 이전의 동작).
   * - `never` — 어디에도 안 붙는다. 헤더의 조작은 전부 단축키로만 한다.
   *
   * 색 토큰이 아니라 [`tiling`] 과 같은 **동작 플래그**라 `[app]` 에 산다. 모르는 값은
   * 정규화가 버린다 = 기본값 추종 (`tab_style`·`mode` 와 같은 규칙).
   */
  tile_header?: string | null;
  /**
   * **상태바를 어느 가장자리에 두는가** — `left`(기본) · `top` · `bottom` · `right`.
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_STATUS_BAR`]**(`left`).
   *
   * 색 토큰이 아니라 [`tile_header`] 와 같은 **동작 플래그**라 `[app]` 에 산다 — 상태바는
   * 앱 크롬의 일부이고 `[terminal]` 프리셋과 층이 다르다. 모르는 값은 정규화가 버린다 =
   * 기본값 추종 (`tab_style`·`tile_header` 과 같은 규칙).
   */
  status_bar?: string | null;
  /**
   * **상태바 모양** — `flat`(기본, 평면 띠) · `panel`(타일처럼 떠 있는 둥근 패널).
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_STATUS_BAR_STYLE`]**(`flat`).
   *
   * [`status_bar`](자리)와 짝인 **동작 플래그**라 같은 `[app]` 에 산다. 모르는 값은 정규화가
   * 버린다 = 기본값 추종 (`status_bar`·`tile_header` 과 같은 규칙).
   */
  status_bar_style?: string | null;
  /**
   * **앱 크롬 재질** — `glass`(기본, 반투명 판 + 앱 안 흐림) · `flat`(불투명 평면 — 2026-10-11 이전 모습).
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_MATERIAL`]**(`glass`).
   *
   * 색(위 여덟 칸·`dynamic`·`mode`)과 **독립된 축**이다 — 판의 물빛은 `theme.css` 가 그 토큰에서
   * 파생하므로 색 테마·월페이퍼 추출이 그대로 얹힌다. `<html data-material>` 하나로 내려간다
   * (`mode.svelte.ts`). 모르는 값은 정규화가 버린다 = 기본값 추종 (`status_bar_style` 과 같은 규칙).
   */
  material?: string | null;
  /**
   * **앱 아이콘(창·작업 표시줄)** — `gpt`(기본, 빌드 아이콘과 같은 그림) · `claude` · `gemini` · `grok` · 사용자 아이콘
   * `user-<12hex>`(docs/log/2026-10-04-app-icon-switch.md · docs/log/2026-10-22-custom-app-icon.md).
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_APP_ICON`]**.
   *
   * 창에 거는 것은 Rust(`app_icon.rs` — setup·새 창·`set_app_icon`)다. exe·설치 관리자 아이콘은
   * 바뀌지 않는다. 모르는 값은 정규화가 버린다 = 기본값 추종.
   */
  app_icon?: string | null;
  /**
   * **무입력 자동 잠금까지의 분(分)** — 이 시간 동안 사용자 입력이 하나도 없으면
   * 프라이버시 가림막(`Veil`)을 자동으로 연다. `null`/`undefined` 또는 `0` = **끔**.
   *
   * 색 토큰이 아니라 [`auto_reconnect`] 와 같은 **동작 플래그**라 `[app]` 에 산다 — 가림막은
   * 앱 크롬의 일부다. 읽는 곳은 idle 감시 모듈(`app/idle-lock.svelte.ts`) 하나뿐이다.
   * 정규화·백엔드 sanitize 가 `0` 은 "안 정함"으로 접고, 켠 값은 `1..=240` 분으로 자른다.
   */
  idle_lock_min?: number | null;
  /**
   * **UI 크기 %** — 앱 크롬 전체의 배율 (docs/log/2026-09-25-ui-scale-font.md).
   * `null`/`undefined` = 안 정함 = 100 %. 정규화가 후보(`UI_SCALES`) 중 하나로 붙인다.
   *
   * 거는 곳은 [`applySettings`] 하나(웹뷰 확대)이고, 터미널 글자는 [`SettingsStore.termFontSize`]
   * 가 배율만큼 되돌려 사용자가 정한 크기 그대로 보이게 한다.
   */
  ui_scale?: number | null;
  /**
   * **앱 글꼴** — CSS `font-family` 문자열 그대로 (`--font-ui` 에 들어간다).
   * `null`/`undefined` = 안 정함 = `theme.css` 의 기본 스택.
   */
  ui_font_family?: string | null;
}

/** Rust `TermPrefs` 와 1:1 (snake_case 유지) */
export interface TermPrefs {
  theme?: string | null;
  font_family?: string | null;
  font_size?: number | null;
  /**
   * **커서 모양** (`block`·`underline`·`bar`). `null`/`undefined` = 안 정함 = **`block`**.
   * xterm `cursorStyle` 에 그대로 들어간다. 백엔드는 목록을 모른다 — 모르는 값이면 프런트가
   * 기본(`block`)으로 떨어진다 (`tab_style` 과 같은 분담).
   */
  cursor_style?: string | null;
  /** WebGL 가속. `null`/`undefined` = 안 정함 = **켬** */
  webgl?: boolean | null;
  /**
   * 탭 바 모양 (`pill`·`flat`). `null`/`undefined` = 안 정함 = **`pill`**.
   * 백엔드는 목록을 모른다 — 모르는 키면 프런트가 기본값(`pill`)으로 떨어진다
   * (`theme` 프리셋 키와 같은 분담). 뺀 옛 모양 키도 그렇게 떨어진다.
   */
  tab_style?: string | null;
  /**
   * 글꼴 합자(ligature). `null`/`undefined` = 안 정함 = **끔**(false).
   * 켜면 `Terminal.svelte` 가 합자 애드온을 붙이고 합자 지원 글꼴로 폴백한다.
   */
  ligatures?: boolean | null;
  /**
   * 터미널에서 **우클릭이 무엇을 하는가** (`menu`·`paste`). `null`/`undefined` = 안 정함 =
   * **`menu`**. 백엔드는 목록을 모른다 — 모르는 값이면 프런트가 기본으로 떨어진다
   * (`tab_style` 과 같은 분담).
   */
  right_click?: string | null;
  /**
   * 여러 줄 붙여넣기 전에 확인을 묻는가. `null`/`undefined` = 안 정함 = **켬**.
   * 기본이 켬이므로 `webgl` 과 같은 규칙으로 **끌 때만** 파일에 `false` 가 적힌다.
   */
  confirm_multiline_paste?: boolean | null;
  /**
   * **원격이 보낸 OSC 52 를 이 PC 의 클립보드에 쓰는가.**
   * `null`/`undefined` = 안 정함 = **켬**. 기본이 켬이라 `webgl` 과 같은 규칙으로 **끌 때만**
   * 파일에 `false` 가 적힌다.
   *
   * **읽기 요청(`OSC 52 ; c ; ?`)은 이 값과 무관하게 언제나 거부한다** — 켜고 끄는 것은
   * 쓰기 한 방향뿐이다 (docs/log/2026-09-23-osc52-osc8.md).
   *
   * 셸 통합과 **무관하다** — 핸들러는 tmux 간이 모드를 포함한 모든 타일에 걸린다.
   */
  osc52_clipboard?: boolean | null;
  /**
   * **타일 안 프로그램이 보낸 알림(OSC 9 · OSC 777 `notify`)을 띄우는가.**
   * `null`/`undefined` = 안 정함 = **켬**. 기본이 켬이라 **끌 때만** 파일에 `false` 가 적힌다.
   *
   * 꺼도 알아본 시퀀스는 삼킨다. 제목 위조 방지·속도 제한은 이 값과 무관한 불변이다
   * (docs/log/2026-09-26-osc-notify-inline-images.md). 셸 통합과 **무관하다**.
   */
  osc_notify?: boolean | null;
  /**
   * **sixel · iTerm2 인라인 이미지를 그리는가.** `null`/`undefined` = 안 정함 = **켬**.
   * 기본이 켬이라 **끌 때만** 파일에 `false` 가 적힌다. 열린 타일에도 바로 적용된다.
   */
  inline_images?: boolean | null;
  /**
   * **프롬프트에 치는 동안 맞는 스니펫을 커서 옆에 띄우는가.**
   * `null`/`undefined` = 안 정함 = **켬**. 기본이 켬이라 `webgl` 과 같은 규칙으로 **끌 때만**
   * 파일에 `false` 가 적힌다.
   *
   * 셸 통합(OSC 133)이 있는 타일에만 뜻이 있다 — 사람이 친 글자가 어디서 시작하는지를 아는
   * 길이 `B` 마커뿐이다 (docs/log/2026-09-16-snippets.md 의 "입력 중 제안").
   */
  inline_snippets?: boolean | null;
  /**
   * **로컬 셸에 통합 훅을 심는가.** `null`/`undefined` = 안 정함 = **켬**.
   *
   * 이 값을 읽는 쪽은 프런트가 아니라 **백엔드**다 (`crate::pty::spawn_shell` 이 셸을
   * 띄우기 직전에 파일에서 직접 읽는다) — 여기 있는 이유는 설정 화면의 토글 하나뿐이다.
   * 끄면 PowerShell·Git Bash·WSL 이 훅 없이 뜬다(= `cmd` 처럼). 원격의 호스트별
   * `shell_integration` 은 이 값과 무관하다.
   */
  local_shell_integration?: boolean | null;
  /**
   * **긴 명령이 끝나면 알린다** — 이 초 이상 걸린 명령이 대상이다.
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_NOTIFY_AFTER_SECS`]**(10초). `0` = **끔**.
   *
   * 다른 숫자 값과 달리 **`0` 이 "안 정함"이 아니다** (`idle_lock_min` 과 정반대다 — 저쪽은
   * 기본이 끔이라 0 과 안 정함이 같은 뜻이지만 여기는 기본이 켬이다). 그래서 정규화도
   * `0` 을 살려 두고, 저장도 `0` 을 파일에 적는다.
   *
   * 셸 통합(OSC 133)이 있는 타일에만 뜻이 있다 — 명령의 시작·끝을 아는 길이 그것뿐이다.
   */
  notify_after_secs?: number | null;
  /**
   * **이 초 이상 걸린 명령에만** 실행 시간을 블록 오른쪽 끝에 적는다.
   * `null`/`undefined` = 안 정함 = **[`DEFAULT_MARK_AFTER_SECS`]**(3초). `0` = **끔**.
   *
   * `notify_after_secs` 와 **정확히 같은 배관**이다 (기본이 켬이라 `0` 이 "안 정함" 과 다른
   * 상태이고, 그래서 정규화도 저장도 `0` 을 살려 둔다). 성패는 색이 말하므로 이 값이 정하는
   * 것은 "얼마나 오래 걸린 것부터 숫자를 적나" 하나뿐이다 — 종료 코드 숫자는 실패의 붉은 띠
   * 말풍선 안에 있다 (`finish-notify.ts`).
   */
  mark_after_secs?: number | null;
  /**
   * **벨**(`\a`)이 왔을 때 (`visual`·`visual+sound`·`off`). `null`/`undefined` = 안 정함 =
   * **`visual`**. 백엔드는 목록을 모른다 — 모르는 값이면 프런트가 기본으로 떨어진다
   * (`right_click` 과 같은 분담).
   */
  bell?: string | null;
  /**
   * **터미널 칸**의 불투명도 %(10~100). `null`/`undefined` = 안 정함 = **100**(불투명).
   *
   * `app.opacity` 와 다른 값이다 — 저쪽은 창 크롬(사이드바·탭 바·타일 사이 틈), 이쪽은
   * 글자가 앉는 칸 자체다. 100 일 때는 xterm 의 렌더 경로가 예전과 **완전히 같아야** 하므로
   * (`allowTransparency` 도 끈 채로 둔다) 기본값은 파일에도 안 적고 CSS 도 건드리지 않는다.
   */
  opacity?: number | null;
  /**
   * 월페이퍼에서 만든 터미널 팔레트 (`theme === "dynamic"` 일 때 쓰인다).
   * `settings.toml` 의 `[terminal.dynamic]` 테이블과 1:1 — xterm `ITheme` 필드 이름 21칸 +
   * 색이 아닌 [`BEFORE_KEY`] 한 칸(동적을 켜기 직전의 프리셋).
   *
   * 파일에 적어 두는 이유는 **첫 프레임**이다 — 안 적으면 앱을 켤 때마다 배경 이미지를
   * 디코딩해 다시 뽑아야 하고, 그동안 터미널이 기본 팔레트로 한 번 칠해졌다가 바뀐다.
   */
  dynamic?: Record<string, string> | null;
}

/** Rust `ShellPrefs` 와 1:1 */
export interface ShellPrefs {
  /**
   * `new-shell` 단축키와 `>_` 메뉴의 맨 윗줄이 여는 **기본 셸**의 [`ShellInfo.id`]
   * (`"pwsh"`·`"cmd"`·`"wsl:<distro>"`…). **언제나 구체적인 셸 하나**를 가리킨다 —
   * "시스템 기본" 이라는 값은 2026-09-16 에 없앴다.
   *
   * `null`/`undefined` = **아직 아무것도 고르지 않았다** (새로 깐 기기). 그때는 OS 초기값이
   * 쓰인다 (Rust `pty::os_default_shell_id` → `list_shells` 의 `default_id`, 합치는 규칙은
   * `session.ts` 의 `effectiveDefaultShellId`). **그 폴백이 파일을 고쳐 쓰지는 않는다** —
   * 값은 사용자가 설정 화면에서 고를 때만 생긴다.
   *
   * **모르는 id 를 버리지 않는다** — 다른 문자열 설정(`theme`·`tab_style`)과 다른 점이다.
   * 저 둘의 후보는 앱에 박혀 있어 모르는 값 = 오타이지만, 셸 목록은 **기기 상태**라
   * 오늘 없는 id 가 내일 돌아온다 (WSL 배포판을 지웠다 다시 깔면). 그래서 값은 그대로 두고
   * 설정 화면이 "이 PC 에 없어 …를 씁니다" 로 알리기만 하며, 여는 쪽이 그때그때 목록과
   * 맞춰 본다.
   */
  default?: string | null;
}

/** 비밀값 없는 외부 MCP 서버 — 켠 항목은 aynx 이 띄우는 로컬 에이전트에만 실린다. */
export interface AiMcpServer {
  name: string;
  enabled: boolean;
  /** 없으면 Claude·Codex 모두(1차 호환), 빈 배열이면 주입하지 않는다. */
  agents?: string[];
  /** 생략하면 앱 전체, 값이 있으면 해당 프로젝트와 워크트리에만 적용. */
  project_id?: string;
  /** 값은 볼트에만 저장하고 이 목록에는 이름과 참조만 둔다. */
  env?: { name: string; secret_ref: string }[];
  /** HTTP 헤더 값도 같은 볼트 종류를 쓰고 설정에는 참조만 둔다. */
  headers?: { name: string; secret_ref: string }[];
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  /** 사이드 채팅에도 싣는다(생략 = 끔 · 2026-10-25). 범위 · `enabled` 는 AI 타일과 같은 판정이고 대상 칩(`agents`)과는 따로다. */
  side_chat?: boolean;
  /** 사이드 채팅에서 이 서버의 도구를 묻지 않고 부른다(생략 = 끔 = 부를 때마다 승인 카드). `side_chat` 이 켜졌을 때만 뜻이 있다. */
  side_chat_no_ask?: boolean;
}

/**
 * Rust `AiPrefs` 와 1:1 — AI 타일(Claude Code · Codex)의 취향 (`settings.toml` 의 `[ai]`).
 *
 * [`ShellPrefs`] 와 나란한 층이다(둘 다 **어떤 프로세스를 어디서 띄우는가**). 대상만 다르다 —
 * 저기는 사람이 여는 셸, 여기는 AI CLI 타일이다.
 */
export interface AiPrefs {
  /**
   * AI 타일을 열 때 쓸 **시작 폴더**의 절대 경로. `null`/`undefined` = 안 정함 = 홈.
   *
   * **1순위가 아니다** — 포커스된 로컬 터미널의 지금 폴더, 그다음 프로젝트 탭의 폴더가 먼저고
   * (`start-dir.ts` 의 `startDirFor`), 이 값은 둘 다 없을 때(평범한 탭의 시작 화면·SSH
   * 타일에서 열 때) 쓰인다. 홈에서 뜬 Claude Code 는 폴더 안전 확인만 반복하고 프로젝트
   * 맥락이 없다 — 그것이 이 값이 생긴 이유다.
   *
   * **모양을 검사하지 않는다** (`shell.default` 와 같은 "보관만" 분담). 지금 없는 폴더도
   * 지우지 않는다: 잠깐 안 붙은 외장·네트워크 드라이브가 다시 붙으면 그대로 돌아온다.
   * 실제 판정(있으면 그 폴더, 없으면 홈)은 세션을 세우는 자리에 하나뿐이다
   * (`src-tauri/src/pty.rs` 의 `spawn_cwd`).
   */
  start_dir?: string | null;
  /**
   * Claude Code **턴이 끝나면 알릴 것인가** — 안 정했으면 **켬**, 끈 사람의 파일에만 `false`
   * (`local_shell_integration` 과 같은 배관). 판정은 `$lib/agent-notify`, 발사는
   * `app/agent-notify.ts` (docs/log/2026-09-25-agent-stop-notify.md). 신호는 Claude Code 훅의
   * `Stop` 이라 훅이 없으면 켜 둬도 조용하다.
   */
  notify_turn_end?: boolean | null;
  /**
   * Claude Code 가 **권한을 물으면 알릴 것인가** — 안 정했으면 **켬**, 끈 사람의 파일에만 `false`
   * (`notify_turn_end` 와 같은 배관). 신호는 `Notification` 훅의 `waiting` + 범주 `permission`
   * (docs/log/2026-09-25-shell-claude-signals.md).
   */
  notify_permission?: boolean | null;
  /** 사이드 채팅의 끝남 · 권한 물음을 알리는가 — `null`/`undefined` = 안 정함 = **켬**(`notify_turn_end` 와 같은 배관) */
  notify_side_chat?: boolean | null;
  /**
   * **보고 있는 타일도** 알릴 턴 길이(초) — `null`/`undefined` = 안 정함 = **[`DEFAULT_NOTIFY_FOCUSED_AFTER_SECS`]**(60초),
   * `0` = **끔**(보고 있는 타일은 알리지 않는다). `notify_after_secs` 와 **정확히 같은 배관**이다(기본이 켬이라
   * `0` 을 살려 둔다). 포커스를 둔 채 자리를 비운 사람을 위한 칸(docs/log/2026-09-27-agent-banners.md "보고 있는 타일도").
   */
  notify_focused_after_secs?: number | null;
  /**
   * aynx 이 띄우는 codex 와 로컬 타일에서 친 `codex` 에 `--no-daemon` 을 붙이는가 — 안 정했으면 **켬**, 끈 사람의
   * 파일에만 `false`. 붙이는 것은 Rust(`codex_launch.rs` · 셸 통합의 감싸개)이고 프런트는 보관만 한다
   * (docs/log/2026-09-26-codex-hooks.md "다시 켬 — --no-daemon").
   */
  codex_no_daemon?: boolean | null;
  /**
   * 로컬 타일의 claude 에 요금제 한도 mod 를 싣는가(이름은 옛 상태줄 방식의 것 — 2026-10-10 mod 로 바뀜) — 안 정했으면
   * **켬**, 끈 사람의 파일에만 `false`. 싣는 것은 Rust(`claude_usage.rs` — 타일 환경 `CLAUDE_CODE_PLUGIN_DIRS`)이고
   * 프런트는 보관만 한다.
   */
  claude_statusline?: boolean | null;
  /**
   * **AI 아이콘 모양** — `logo`(기본, 브랜드 로고) · `avatar`(CLI 별 아바타). `null`/`undefined` = 안 정함 = **[`DEFAULT_AI_ICON_STYLE`]**.
   * 모르는 값은 정규화가 버린다(= 기본 추종). 전역 한 칸 — 그리는 쪽은 `$lib/avatars.svelte` · `AiGlyph` 이고 Rust 는 보관만 한다
   * (docs/log/2026-10-31-avatars.md).
   */
  icon_style?: string | null;
  /** claude 의 아바타 — 앱 아이콘 id(내장 키 · `user-<12hex>`). 안 정함 = 기본 `claude`(`DEFAULT_AI_AVATARS`). 모양이 틀리면 정규화가 버린다 */
  avatar_claude?: string | null;
  /** codex 의 아바타 — 같은 규칙, 기본 `gpt` */
  avatar_codex?: string | null;
  /**
   * **옛 칸** — 10-24 의 AI 로딩 덮개 그림(`logo` | `character`). 읽을 때만 본다: 정규화가 `character` 를 `icon_style = "avatar"` 로
   * 옮기고(새 칸이 비었을 때만) 이 칸은 버린다 — 파일에 다시 쓰지 않는다(Rust 도 같은 이사).
   */
  loading_art?: string | null;
  /**
   * aynx 이 **띄우는** 에이전트(AI 타일 · 셸 메뉴 · 프로젝트 시작 화면 · 재개 · 새 대화로 계속)에 붙일 추가 인자 —
   * 에이전트 id(Rust `agent_args::TARGETS`) → 사용자가 적은 한 줄(`[ai.args]` 표). 셸에 손으로 친 명령에는 붙지 않는다.
   * 나누기 · 검사 · 셸에 맞춘 인용 · 자리는 전부 Rust(`agent_args.rs`)이고 프런트는 보관만 한다 — 설정 화면은
   * Rust 미리보기가 통과시킨 값만 적는다(docs/log/2026-09-27-agent-extra-args.md).
   */
  args?: Record<string, string> | null;
  /** `[[ai.mcp_servers]]` — 이름·값의 실행 검증은 Rust(`agent_mcp.rs`) 한 곳이다. */
  mcp_servers?: AiMcpServer[] | null;
  /** 세션 서버: 생략은 켬·Claude/Codex 둘 다. 다음 로컬 AI 타일 실행부터 적용한다. */
  mcp_sessions_enabled?: boolean | null;
  mcp_sessions_agents?: string[] | null;
  /**
   * **끈 에이전트** id 목록(`[ai] disabled_agents`) — 비었으면 파일에 안 적힌다(= 모두 사용). 끈 에이전트는 새로 띄우거나
   * 고르는 자리에서만 빠진다(`$lib/agent-enabled`). 훅 · 추가 인자 · 대화 기록 · 외부 MCP · 열린 타일은 그대로다.
   * 모르는 id 도 버리지 않는다(`automation.bundles` 와 같은 보존 규칙).
   */
  disabled_agents?: string[] | null;
}

/**
 * Rust `WallpaperPrefs` 와 1:1 — 창 **전체**의 배경 이미지
 * (docs/log/2026-09-04-wallpaper.md).
 *
 * 앱 테마(`AppTheme`)와 층이 다르다: 저기는 크롬을 **무슨 색으로 칠할지**를 정하고,
 * 여기는 그 크롬 **뒤에 무엇이 깔리는지**를 정한다. 그래서 `settings.toml` 에서도
 * 자기 테이블(`[wallpaper]`)을 갖는다.
 *
 * **2단계(월페이퍼에서 MD3 색 추출)의 입력이 이 테이블이다.** 그때 뽑아낸 색은
 * `[app]` 의 색 토큰 쪽으로 흘러 들어가고, 여기는 언제나 **원본**으로 남는다 —
 * 즉 이 구조를 나중에 바꿀 필요가 없다.
 */
export interface WallpaperPrefs {
  /**
   * `<config_dir>/aynx/` 안의 **파일 이름 한 조각**(`"wallpaper.jpg"`). `null`/`undefined` =
   * 배경 없음.
   *
   * 경로가 아니다 — 고른 이미지는 백엔드가 앱 폴더로 **복사**해 소유하므로(원본을 옮겨도
   * 안 깨진다) 여기 남는 것은 그 사본의 이름뿐이다. 값을 정하는 것도 프런트가 아니라
   * `wallpaper_set`/`wallpaper_clear` 명령이다 (`$lib/wallpaper.svelte.js`).
   */
  file?: string | null;
  /** 이미지 위 검정 덮개 %(0~100). `null`/`undefined` = [`DEFAULT_WALLPAPER_DIM`] */
  dim?: number | null;
  /** 배경 블러 px(0~20). `null`/`undefined` = 0 (선명) */
  blur?: number | null;
  /** 배치 (`cover`·`contain`·`tile`·`center`). `null`/`undefined` = `cover` */
  fit?: string | null;
}

/**
 * Rust `AutomationPrefs` 와 1:1 (snake_case 유지) — 자동 승인 정책(`[automation]`, 단계 10b).
 *
 * **기본은 전부 끔·비움**이다. `auto_approve` 가 false 면 아무것도 자동 승인되지 않는다
 * (단계 9 수동 동작 그대로). 자동 승인 여부의 판단은 순수 평가기 `$lib/policy` 가 하고,
 * 두 상한(`max_targets`·`max_concurrency`)은 **백엔드가 승인 진입에서 무조건 강제**한다
 * (수동·자동 공통 하드 경계) — 프런트는 그 값을 편집만 한다.
 */
export interface AutomationPrefs {
  /** 자동 승인을 켤 것인가 — **기본 끔**. */
  auto_approve: boolean;
  /** 자동 승인 후보 **명령 패턴**들(단어 경계 prefix 매칭 — `policy.ts`). 빈 목록 = 매칭 없음. */
  allow_patterns: string[];
  /**
   * 켜 둔 **묶음 프리셋** id 들 (`[automation] bundles`, `$lib/automation-presets`).
   *
   * 묶음은 이름으로 말하는 위임 범위다 — 켜면 그 규칙이 [`allow`](AutomationPrefs#allow) 위에
   * **얹힌다**(대체하지 않는다). **모르는 id 는 지우지 않고 그대로 두되 무시한다**(새 버전의
   * 묶음을 켜 둔 파일을 잃지 않게). 판정의 권위는 백엔드라, Rust 도 디스크의 이 값을 읽어
   * 스스로 펼친다.
   */
  bundles: string[];
  /**
   * 켜 둔 묶음 안에서 **끈 명령** — 묶음 id → 명령 키 목록(`[automation.bundle_off]`, `commandKey`).
   * **좁히기만 한다**(무엇을 적든 묶음보다 넓어지지 않는다). 모르는 묶음·키도 보존하고, 비면 파일에 안
   * 적힌다. 옛 묶음 id 는 Rust 가 읽을 때 옮기며 옛 묶음에 없던 명령을 여기 넣는다.
   */
  bundle_off: Record<string, string[]>;
  /** 자동 승인이 허용하는 대상 수 상한(백엔드가 강제하는 하드 경계). */
  max_targets: number;
  /** 동시 실행 수 상한(같은 하드 경계). */
  max_concurrency: number;
  /**
   * **자동 승인 폭주 방지**(슬라이스 A4c) — 슬라이딩 창(`auto_window_secs`) 안에서 자동 승인이
   * 허용되는 최대 건수. 진짜 방어선은 Rust(`approve_operation` 의 마지막 문)이고 프런트는 값만
   * 편집한다. `auto_approve` 가 꺼져 있으면 이 한도는 아무 일도 하지 않는다.
   */
  auto_max_per_window: number;
  /** 위 빈도 한도의 슬라이딩 창 길이(초). */
  auto_window_secs: number;
  /**
   * **검토 대기 만료**(분) — AI 가 올린 작업안을 이 시간 안에 승인하지 않으면 만료된다.
   * `0` 은 **"만료 없음"** 이라는 답이라 그대로 산다(하한으로 접지 않는다 —
   * `vault.auto_lock_minutes` 와 같은 규칙). 판정은 Rust(`operations::expire_stale`)가 읽기·
   * 전이 경로에서 그 자리에서 한다 — 앱에 시계는 없다
   * (docs/log/2026-09-21-approval-ttl.md). `auto_approve` 와 무관하게 돈다.
   */
  approval_ttl_minutes: number;
  /**
   * **검토 요청 OS 알림**을 켤 것인가 — 이 칸만 **기본 켬**이다.
   *
   * 나머지 `automation` 칸은 "실행을 허락하는" 칸이라 기본 거부가 맞지만, 이것은 **사람에게
   * 알리기만** 하는 칸이라 기본 침묵이 곧 놓침이다. 창이 앞에 없을 때 승인 대기 작업안이
   * 새로 들어오면 OS 알림 한 줄이 나간다 (`$lib/review-notify` 가 판정하고
   * `app/pending-plans.svelte.ts` 가 쏜다 — docs/log/2026-09-22-review-notify.md).
   * `auto_approve` 와 무관하게 먹는다.
   */
  notify_review_requests: boolean;
  /**
   * **실행 결과 OS 알림**을 켤 것인가 — 위 칸의 짝, **기본 켬**.
   *
   * 창이 앞에 없을 때 작업안 실행이 끝나면(성공·일부 실패·실패·취소) OS 알림 한 줄이 나간다
   * (`$lib/operation-notify` 가 문구를 만들고 `app/operation-notify.svelte.ts` 가 쏜다 —
   * docs/log/2026-09-28-run-result-notify.md). 이 칸이 끄는 것은 **OS 알림뿐**이다 — 토스트와
   * 알림 센터 기록에는 끄는 칸이 없다(실행 결과를 조용히 삼키는 길을 만들지 않는다).
   */
  notify_operation_results: boolean;
  /**
   * **감사 로그 보관 일수** — 기본 90, `0` = 지우지 않음(하한으로 접지 않는다 — TTL 과 같은 규칙).
   * 감사 로그를 끄는 칸이 아니라 오래된 **날짜 파일**을 치우는 칸이다 — 정리는 Rust 쓰기 스레드가
   * 앱 시작과 날짜가 바뀐 첫 쓰기에서 한다(docs/log/2026-09-28-run-history.md).
   */
  audit_retention_days: number;
  /**
   * **실행 출력 발췌를 감사 로그에 남길 것인가** — **기본 끔**. 원격 출력에는 비밀이 섞일 수 있고
   * 감사 파일은 볼트 밖이라 옵트인이다. 켜도 AI 읽기 공유가 꺼진 대상의 출력은 적지 않는다(Rust 가 가른다).
   */
  audit_output_excerpt: boolean;
  /**
   * **파이프(`|`) 허용**(10-22 옵트인 · 기본 끔) — 켜면 맨 `|` 로 이은 명령을 단계마다 본다(단계마다 위험 아님 + 허용 목록 ·
   * 다른 명령을 실행하는 단계는 늘 거절 — `policy.ts` `pipeStageRefused`). 리다이렉트 · 치환 · 서브셸 · `;` · `||` 섞임은 여전히
   * 사람 승인. Rust `AutomationPrefs::allow_pipes` 와 1:1.
   */
  allow_pipes: boolean;
  /**
   * **구조적 allowlist**(슬라이스 A4b) — `[[automation.allow]]` 로 실행 파일+서브커맨드 단위 위임.
   * 평탄한 `allow_patterns` 와 **OR** 로 합쳐진다(하위 호환). 매칭은 `policy.ts` 의
   * `matchesStructuredAllow`. 편집 UI 는 설정 › 자동 승인 › 허용 패턴 [편집 ›](`AutomationAllow.svelte`, 2026-10-05).
   */
  allow: AllowRule[];
}

/**
 * 구조적 allowlist 규칙 하나 — Rust `AllowRule` 와 1:1 (snake/lower 그대로).
 *
 * `exec` = 실행 파일 이름(명령 첫 토큰의 basename 과 비교). `subcommands` 가 비면 서브커맨드
 * 개념이 없다는 뜻(플래그만 붙는 `df -h` 류는 통과), 아니면 첫 비플래그 토큰이 목록에 있어야 한다.
 *
 * 나머지 다섯 칸은 **인자 제약**(2026-10-05, docs/log/2026-10-05-auto-approve-args.md) — 전부
 * 선택이고, 없거나 비면 제약이 없다(옛 모양 규칙은 예전 의미 그대로). 의미는 Rust `AllowRule`
 * 문서의 "인자 제약" 절, 판정은 `policy.ts argConstraintsHold`.
 */
export interface AllowRule {
  exec: string;
  subcommands: string[];
  /** 명령 어디에든 있으면 불허하는 플래그들(`-f` 는 `-fn` 도, `--follow` 는 `--fol` 도, 끝 `*` 는 접두). */
  deny_flags?: string[];
  /** 비어 있지 않으면 모든 플래그가 여기 있어야 한다. */
  allow_flags?: string[];
  /** 반드시 정확히 있어야 하는 플래그들. */
  require_flags?: string[];
  /** 서브커맨드(없으면 exec) 뒤 첫 비플래그 인자는 없거나 이 중 하나(끝 `*` 는 접두). */
  first_arg?: string[];
  /** 서브커맨드(없으면 exec) 뒤 비플래그 인자 수 상한 — `0` = 인자 없이. */
  max_args?: number;
  /** 서브커맨드가 exec 바로 다음 낱말이어야 한다(앞 플래그의 값이 서브커맨드로 위장하지 못하게). 묶음 규칙은 늘 켠다. */
  sub_first?: boolean;
}

/**
 * Rust `VaultPrefs` 와 1:1 (`[vault]`) — 자격증명 금고의 **정책 한 칸**
 * (docs/log/2026-09-19-vault.md).
 *
 * 여기 오지 않는 것을 먼저 적는다: **비밀도, "금고가 있는가" 도 `settings.toml` 에 적히지
 * 않는다.** 그건 `vault.bin` 의 존재가 말하고, 값은 Rust 밖으로 나오지 않는다. 이 파일이
 * 아는 것은 옛 판의 자동 잠금 분(分) 한 칸뿐이고, **그것조차 이제 아무도 읽지 않는다**
 * (2026-09-19 저녁 — 잠그는 시점은 프라이버시 가림막 하나다).
 *
 * 그런데도 거울을 들고 있는 이유가 바로 그 하나다: 저장은 전체 재작성이라(`toPayload`),
 * 이 칸을 싣지 않으면 손으로(또는 옛 앱이) 적어 둔 `[vault]` 가 설정 화면의 [저장] 한 번에
 * 사라진다(트리거 목록·`[[automation.allow]]` 와 같은 이유).
 */
export interface VaultPrefs {
  /**
   * 옛 판의 유휴 자동 잠금(분). **아무도 읽지 않는다** — 왕복 보존용이다
   * (`settings.rs` 의 `VaultPrefs` 와 같은 판단).
   */
  auto_lock_minutes?: number | null;
}

/**
 * Rust `HostsPrefs` 와 1:1 (`[hosts]`) — 호스트 목록의 **정렬 한 칸**
 * (docs/log/2026-09-23-host-history.md). 안 정했으면 이름순이다.
 */
export interface HostsPrefs {
  /** [`HOST_SORTS`] 의 키 (`name` · `recent`) */
  sort?: string;
}

/**
 * Rust `FilesPrefs` 와 1:1 (`[files]`) — 파일 타일의 **기본 보기 한 칸**
 * (docs/log/2026-09-25-file-tree-view.md). 안 정했으면 트리다.
 */
export interface FilesPrefs {
  /** [`FILE_VIEWS`] 의 키 (`tree` · `navigate`) */
  default_view?: string;
  /**
   * 로컬 파일 타일의 자동 새로고침 — 보이는 폴더의 OS 변경 알림(원격은 늘 ⟳ — docs/log/2026-10-21-file-tile-auto-refresh.md). 파일에는 **끌 때만** 적는다(`tray_on_close` 와 같은 규칙 — 기본 켬).
   */
  auto_refresh?: boolean | null;
}

/**
 * Rust `ProjectsPrefs` 와 1:1 (`[projects]`) — **프로젝트 시작 화면 한 칸**
 * (docs/log/2026-09-26-project-start-screen.md). 안 정했으면 `auto`(지난 대화가 있으면 선다)다.
 */
export interface ProjectsPrefs {
  /** [`PROJECT_START_SCREENS`] 의 키 (`auto` · `off`) */
  start_screen?: string;
}

/**
 * Rust `DockPrefs` 와 1:1 (`[dock]`) — **독 배치 한 칸** (docs/log/2026-10-23-side-chat-dock.md). 안 정했으면 `launcher-left` 다.
 */
export interface DockPrefs {
  /** [`DOCK_LAYOUTS`] 의 키 (`launcher-left` · `launcher-right`) */
  layout?: string;
}

/**
 * Rust `PlansPrefs` 와 1:1 (`[plans]`) — 작업안의 **실행 목록 정렬 한 칸**(2026-11-01). 안 정했으면 `newest`(최근 먼저)다.
 */
export interface PlansPrefs {
  /** [`EXEC_SORTS`] 의 키 (`newest` · `oldest`) */
  exec_sort?: string;
}

/**
 * Rust `MessengerPrefs` 와 1:1 (`[messenger]`) — **메신저 알림의 취향만**
 * (docs/log/2026-09-27-discord-notify.md · docs/log/2026-09-28-messenger-channels.md). 사건 규칙은 채널이 함께
 * 쓰고 채널마다 보내기 칸(`discord` · `slack`)이 있다. 웹훅 URL 은 여기 없다 — 비밀이라 백엔드의 채널별 자기 파일에 살고
 * 프런트는 `messenger_status(channel)` 의 "등록됐는가" 만 본다. 기본값이 채워진 모양은 `settings.messenger`.
 */
export type MessengerPrefs = MessengerPrefsRaw;

/**
 * Rust `RemotePrefs` 와 1:1 (`[remote]`) — **원격 웹 클라이언트 관문**(Rust `remote.rs`). 비밀은 없다.
 * 화면은 설정 › 원격 접속(`RemoteSection` · 손잡이 `actions-remote.ts`). 기본 포트는 Rust 가 정한다(릴리스 47821 · 개발 47822).
 */
export interface RemotePrefs {
  /** 관문을 여는가 (안 정하면 끔) */
  enabled?: boolean;
  /** 127.0.0.1 포트 (안 정하면 인스턴스 기본) */
  port?: number;
  /** 받을 `*.ts.net` 이름 (비면 미설정) */
  host?: string;
}

/** Rust `AppSettings` 와 1:1 */
export interface AppSettings {
  app: AppTheme;
  terminal: TermPrefs;
  /** 기본 셸 (`settings.toml` 의 `[shell]`) */
  shell: ShellPrefs;
  /** AI 타일 취향 — 지금은 시작 폴더 하나 (`settings.toml` 의 `[ai]`) */
  ai: AiPrefs;
  /** 창 전체 배경 이미지 (`settings.toml` 의 `[wallpaper]`) */
  wallpaper: WallpaperPrefs;
  /**
   * 표시 트리거 (`$lib/triggers`). 백엔드는 파일에 키가 없을 때 내장 두 개를 채워 주므로
   * 여기 빈 배열이 오는 것은 "사용자가 다 지웠다" 는 뜻이지 "아직 안 정했다" 가 아니다.
   */
  triggers: Trigger[];
  /**
   * 단축키 **오버라이드**만 담는다 (`$lib/keybindings`). `action-id → 조합 문자열`.
   * 키가 없는 액션은 레지스트리 기본값을 쓴다 — 즉 빈 객체는 "전부 기본값" 이라는 뜻이다.
   * `settings.toml` 의 `[keybindings]` 테이블과 1:1.
   */
  keybindings: Record<string, string>;
  /** 자동 승인 정책 (`settings.toml` 의 `[automation]`, 단계 10b) — 언제나 채워진 객체다 */
  automation: AutomationPrefs;
  /** 자격증명 금고의 정책 한 칸 (`settings.toml` 의 `[vault]`) — 비밀은 여기 없다 */
  vault: VaultPrefs;
  /** 호스트 목록의 정렬 (`settings.toml` 의 `[hosts]`) */
  hosts: HostsPrefs;
  /** 파일 타일의 기본 보기 (`settings.toml` 의 `[files]`) */
  files: FilesPrefs;
  /** 프로젝트 시작 화면 (`settings.toml` 의 `[projects]`) */
  projects: ProjectsPrefs;
  /** 독 배치 (`settings.toml` 의 `[dock]`) */
  dock: DockPrefs;
  /** 작업안 실행 목록 정렬 (`settings.toml` 의 `[plans]`) */
  plans: PlansPrefs;
  /** 메신저(Discord) 알림 (`settings.toml` 의 `[messenger]`) — URL 은 없다 */
  messenger: MessengerPrefs;
  /** 원격 웹 클라이언트 관문 (`settings.toml` 의 `[remote]`) */
  remote: RemotePrefs;
}
