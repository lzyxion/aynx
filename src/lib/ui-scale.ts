/**
 * **UI 크기·앱 글꼴** 의 순수 규칙 (docs/log/2026-09-25-ui-scale-font.md).
 *
 * 배율은 **웹뷰 확대**(`Webview::setZoom`)로 건다 — CSS `zoom` 이 아니다. 확대는 브라우저의
 * Ctrl+휠과 같은 것이라 CSS px 좌표계 **하나가 통째로** 커진다: `clientX`·
 * `getBoundingClientRect`·`innerWidth` 가 계속 같은 단위라 메뉴·드래그·독 폭 계산이 전부
 * 그대로 맞고, `devicePixelRatio` 가 배율만큼 올라가 xterm 캔버스도 새 밀도로 선명하게 다시
 * 그린다. CSS `zoom` 은 루트만 키우고 좌표계는 그대로 둬 `left: ${clientX}px` 로 세우는
 * 모든 메뉴가 배율만큼 어긋난다.
 *
 * 이 파일에는 룬도 Tauri 도 없다 — 값을 고르고 자르는 규칙과, 그 배율에서 터미널 글자를
 * 되돌려 맞추는 산수뿐이다. 실제로 거는 곳은 `settings.svelte.ts` 의 `applySettings` 하나다.
 */

/** 설정 화면의 후보(%) — 80 아래는 크롬 글자가 10px 밑으로 내려가 읽히지 않는다 */
export const UI_SCALES = [80, 90, 100, 110, 125, 150] as const;

/** 안 정했을 때의 배율(%) — 파일에는 적히지 않는다 */
export const DEFAULT_UI_SCALE = 100;
/** 허용 하한(%) — Rust `MIN_UI_SCALE` 과 같은 값이어야 한다 */
export const UI_SCALE_MIN = 80;
/** 허용 상한(%) — Rust `MAX_UI_SCALE` 과 같은 값이어야 한다 */
export const UI_SCALE_MAX = 150;

/**
 * 앱 글꼴을 안 정했을 때 **화면에 걸리는** 스택 — `theme.css` 의 `--font-ui` 와 같은 글자다.
 * 여기서는 설정 칸의 자리표시자로만 쓴다(값을 비우면 인라인 속성을 지워 `theme.css` 가 이긴다).
 */
export const DEFAULT_UI_FONT_FAMILY = '"Pretendard Variable", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';

/**
 * 파일·손편집에서 온 배율을 **믿을 수 있는 후보 하나**로 만든다. 안 정함·기본(100)은
 * `undefined` 다 (파일에 적지 않는다).
 *
 * 범위 밖은 **자르고**(백엔드 sanitize 와 같다), 그 사이의 값(손으로 적은 115)은 가장 가까운
 * 후보로 붙인다 — select 가 빈 칸으로 뜨는 상태를 상태값으로 들고 있지 않게 하려는 것이다.
 * 거리가 같으면 작은 쪽이다(배율을 몰래 키우지 않는다).
 */
export function normalizeUiScale(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
  let best: number = UI_SCALES[0];
  for (const s of UI_SCALES) {
    if (Math.abs(s - clamped) < Math.abs(best - clamped)) best = s;
  }
  return best === DEFAULT_UI_SCALE ? undefined : best;
}

/** 배율(%) → 웹뷰 확대 계수 (안 정함 = 1) */
export function zoomFactor(pct: number | null | undefined): number {
  return (pct ?? DEFAULT_UI_SCALE) / 100;
}

/**
 * 확대 계수 아래에서 **사용자가 정한 터미널 글자 크기가 그대로 보이도록** xterm 에 넘길 값.
 *
 * 웹뷰 확대는 CSS px 하나를 계수만큼 키우므로, 14px 터미널을 125% 에서 그대로 두면 17.5px
 * 로 보인다. 계수로 나눠 넘기면 화면의 물리 크기가 100% 때와 같다(14 / 1.25 = 11.2 CSS px
 * × 1.25 = 14). xterm 은 소수 글꼴 크기를 받는다 — 셀 크기는 `devicePixelRatio`(= 계수가
 * 곱해진 값)로 물리 픽셀에서 재므로 흐려지지 않는다. 부동소수 찌꺼기(11.200000000000001)가
 * 옵션 비교를 흔들지 않게 1/100 에서 자른다.
 */
export function compensatedFontSize(size: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return size;
  return Math.round((size / factor) * 100) / 100;
}

/**
 * 페이지가 보는 **화면 좌표**(`MouseEvent.screenX`·`window.screenX`)를 OS 논리 좌표로.
 *
 * Chromium 은 화면 좌표도 페이지 확대로 나눠 준다(CSS px 단위다). 창을 그 자리에 세우는
 * Rust(`open_tear_window` 의 `position`)는 OS 논리 좌표를 받으므로 계수를 다시 곱한다.
 * 같은 페이지 안의 비교(`outsideWindow` — `screenX` 와 `window.screenX` 는 같은 단위)는
 * 이 변환이 필요 없다.
 */
export function screenToLogical(v: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  return Math.round(v * factor);
}

/** 지금 이 창의 웹뷰에 **실제로 걸린** 확대 계수 — `applySettings` 가 성공한 뒤 적는다 */
let appliedZoom = 1;

export function currentZoom(): number {
  return appliedZoom;
}

export function noteAppliedZoom(factor: number): void {
  appliedZoom = factor;
}
