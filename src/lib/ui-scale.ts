/**
 * UI 크기·앱 글꼴의 순수 규칙 (docs/log/2026-09-25-ui-scale-font.md).
 * 배율은 웹뷰 확대(`Webview::setZoom`)로 건다 — CSS `zoom` 은 좌표계를 그대로 둬 `left: ${clientX}px` 로 세우는 메뉴가 배율만큼 어긋난다.
 */

/** 80 아래는 크롬 글자가 10px 밑으로 내려가 읽히지 않는다 */
export const UI_SCALES = [80, 90, 100, 110, 125, 150] as const;

/** 파일에는 적히지 않는다 */
export const DEFAULT_UI_SCALE = 100;
/** Rust `MIN_UI_SCALE` 과 같은 값이어야 한다 */
export const UI_SCALE_MIN = 80;
/** Rust `MAX_UI_SCALE` 과 같은 값이어야 한다 */
export const UI_SCALE_MAX = 150;

/** `theme.css` 의 `--font-ui` 와 같은 글자다 — 설정 칸의 자리표시자로만 쓴다 */
export const DEFAULT_UI_FONT_FAMILY = '"Pretendard Variable", "Segoe UI", "Malgun Gothic", system-ui, sans-serif';

/** 범위 밖은 백엔드 sanitize 와 같게 자르고, 사이 값은 가장 가까운 후보로 붙인다(같으면 작은 쪽) */
export function normalizeUiScale(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const clamped = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
  let best: number = UI_SCALES[0];
  for (const s of UI_SCALES) {
    if (Math.abs(s - clamped) < Math.abs(best - clamped)) best = s;
  }
  return best === DEFAULT_UI_SCALE ? undefined : best;
}

export function zoomFactor(pct: number | null | undefined): number {
  return (pct ?? DEFAULT_UI_SCALE) / 100;
}

/** 확대 아래에서도 터미널 글자가 정한 크기로 보이게 계수로 나눈다 — 부동소수 찌꺼기가 옵션 비교를 흔들지 않게 1/100 에서 자른다 */
export function compensatedFontSize(size: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return size;
  return Math.round((size / factor) * 100) / 100;
}

/** Chromium 은 화면 좌표(`screenX`)도 페이지 확대로 나눠 준다 — Rust 로 넘기는 OS 논리 좌표는 계수를 다시 곱한다 */
export function screenToLogical(v: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return v;
  return Math.round(v * factor);
}

/** 웹뷰에 실제로 걸린 확대 계수 — 거는 데 성공한 뒤에만 적는다 */
let appliedZoom = 1;

export function currentZoom(): number {
  return appliedZoom;
}

export function noteAppliedZoom(factor: number): void {
  appliedZoom = factor;
}
