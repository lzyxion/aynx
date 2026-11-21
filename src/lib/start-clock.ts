/** 시작 화면 시계 위젯의 규칙 — 순수 모듈(vitest 가 `environment: "node"` 라 테스트는 순수 층에만 닿는다). */

export interface ClockOptions {
  hour12: boolean;
  seconds: boolean;
  date: boolean;
  /** 큰 숫자의 글자 크기(px) — 박스는 이것으로 셈한다(`clockBoxSize`) · 크기 모서리는 이 값을 바꾼다 */
  size: number;
}

export const CLOCK_FONT_MIN = 24;
export const CLOCK_FONT_MAX = 160;
export const CLOCK_FONT_DEFAULT = 88;

export const DEFAULT_CLOCK_OPTIONS: Readonly<ClockOptions> = {
  hour12: false,
  seconds: false,
  date: true,
  size: CLOCK_FONT_DEFAULT,
};

export const clampClockFont = (px: number): number =>
  Math.max(CLOCK_FONT_MIN, Math.min(CLOCK_FONT_MAX, Math.round(px)));

export interface ClockFace {
  time: string;
  period: string | null;
  periodFirst: boolean;
  date: string;
}

/** 24시간은 `h23` — `hour12: false` 는 자정이 `24` 로 나오는 함정이 있다 */
export function clockFace(at: Date, locale: string, opts: Pick<ClockOptions, "hour12" | "seconds">): ClockFace {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: opts.hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    second: opts.seconds ? "2-digit" : undefined,
    hourCycle: opts.hour12 ? "h12" : "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const units = [part("hour"), part("minute")];
  if (opts.seconds) units.push(part("second"));
  const periodAt = parts.findIndex((p) => p.type === "dayPeriod");
  const hourAt = parts.findIndex((p) => p.type === "hour");
  const date = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(at);
  return {
    time: units.join(":"),
    period: opts.hour12 && periodAt >= 0 ? parts[periodAt].value : null,
    periodFirst: periodAt >= 0 && periodAt < hourAt,
    date,
  };
}

/** 경계를 조금 넘겨 깨운다 — 타이머가 경계 바로 앞에서 깨면 지난 분(초)을 다시 그린다 */
export const TICK_SLACK_MS = 15;

/** 매번 경계에서 다시 재므로 `setInterval` 처럼 밀리지 않는다 */
export function msUntilNextTick(nowMs: number, seconds: boolean): number {
  const unit = seconds ? 1000 : 60_000;
  const into = ((nowMs % unit) + unit) % unit;
  return unit - into + TICK_SLACK_MS;
}

/** 칸 하나만 깨졌으면 그 칸만 처음 값이다 — `date` 칸이 생기기 전의 저장값(칸 없음)은 날짜를 보인다 */
export function parseClockOptions(raw: string | null): ClockOptions {
  if (raw === null) return { ...DEFAULT_CLOCK_OPTIONS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_CLOCK_OPTIONS };
  }
  return normalizeClockOptions(data);
}

export function normalizeClockOptions(data: unknown): ClockOptions {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { ...DEFAULT_CLOCK_OPTIONS };
  const { hour12, seconds, date, size } = data as Record<string, unknown>;
  return {
    hour12: typeof hour12 === "boolean" ? hour12 : DEFAULT_CLOCK_OPTIONS.hour12,
    seconds: typeof seconds === "boolean" ? seconds : DEFAULT_CLOCK_OPTIONS.seconds,
    date: typeof date === "boolean" ? date : DEFAULT_CLOCK_OPTIONS.date,
    size: typeof size === "number" && Number.isFinite(size) ? clampClockFont(size) : DEFAULT_CLOCK_OPTIONS.size,
  };
}

export function serializeClockOptions(opts: ClockOptions): string {
  return JSON.stringify({ hour12: opts.hour12, seconds: opts.seconds, date: opts.date, size: opts.size });
}

// ── 박스 크기 ──
// 박스는 재지 않고 형식으로 셈한다 — 잰 폭은 날짜 길이마다 달라 배치가 날마다 흔들리고, 겹침 · 맞춤 셈이 그리기 전에 박스를 알아야 한다.

/** `ClockWidget.svelte` 의 CSS 와 같은 값이다(같이 바꾼다) */
export const CLOCK_PAD_X = 12;
export const CLOCK_PAD_Y = 8;
/** CSS 와 같은 값 */
export const CLOCK_PERIOD_EM = 0.32;
export const CLOCK_PERIOD_GAP_EM = 0.15;
/** 판의 눈금(`start-widgets.ts` 의 `GRID`)으로 올린다 */
const BOX_STEP = 8;

export const clockDateFont = (font: number): number => Math.max(11, Math.round(font * 0.2));
export const clockDateGap = (font: number): number => Math.max(4, Math.round(font * 0.06));
/** CSS 와 같은 값 */
export const CLOCK_DATE_LINE = 1.25;

function charEm(c: string): number {
  const code = c.codePointAt(0) ?? 0;
  if (c >= "0" && c <= "9") return 0.6;
  if (code >= 0x2e80) return 1; // 한글 · 한자 · 가나
  if (c === " ") return 0.28;
  if (c === ":" || c === "," || c === ".") return 0.3;
  if (c >= "A" && c <= "Z") return 0.72;
  if (c >= "a" && c <= "z") return 0.58;
  return 0.6;
}

const textEm = (text: string): number => [...text].reduce((a, c) => a + charEm(c), 0);

const dateEmCache = new Map<string, number>();

export function widestDateEm(locale: string): number {
  const hit = dateEmCache.get(locale);
  if (hit !== undefined) return hit;
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" });
  let best = 0;
  for (let m = 0; m < 12; m++) for (let d = 22; d <= 28; d++) best = Math.max(best, textEm(fmt.format(new Date(2026, m, d))));
  dateEmCache.set(locale, best);
  return best;
}

/** 시각 값이 아니라 형식으로 — 초마다 · 시마다 흔들리지 않게 */
export function clockTimeEm(locale: string, opts: Pick<ClockOptions, "hour12" | "seconds">): number {
  const units = opts.seconds ? 3 : 2;
  let em = units * 2 * charEm("0") + (units - 1) * charEm(":");
  if (opts.hour12) {
    const fmt = new Intl.DateTimeFormat(locale, { hour: "numeric", hourCycle: "h12" });
    const periods = [1, 13].map(
      (h) => fmt.formatToParts(new Date(2026, 0, 1, h)).find((p) => p.type === "dayPeriod")?.value ?? "",
    );
    em += Math.max(...periods.map(textEm)) * CLOCK_PERIOD_EM + CLOCK_PERIOD_GAP_EM;
  }
  return em;
}

const stepUp = (v: number): number => Math.ceil(v / BOX_STEP) * BOX_STEP;

/** 배치의 시계 `w` · `h` 는 늘 이 값이다 */
export function clockBoxSize(locale: string, opts: ClockOptions): { w: number; h: number } {
  const font = clampClockFont(opts.size);
  let w = clockTimeEm(locale, opts) * font;
  let h = font;
  if (opts.date) {
    const df = clockDateFont(font);
    w = Math.max(w, widestDateEm(locale) * df);
    h += clockDateGap(font) + df * CLOCK_DATE_LINE;
  }
  return { w: stepUp(w + 2 * CLOCK_PAD_X), h: stepUp(h + 2 * CLOCK_PAD_Y) };
}
