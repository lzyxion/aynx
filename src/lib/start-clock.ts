/**
 * **시작 화면 시계 위젯의 규칙** — 순수 모듈 (2026-11-03 · docs/log/2026-10-28-start-widgets.md 덧붙임).
 *
 * 디지털 시계 하나 — 큰 숫자 시:분(고르면 :초) + 그 아래 날짜 · 요일 한 줄(고르면 숨김). 여기 있는 것은 셈뿐이다 —
 *  · 보이는 글자 만들기([`clockFace`] — 12/24시간 · 초 · 앱 언어의 `Intl.DateTimeFormat`)
 *  · 다음에 다시 그릴 때까지의 시간([`msUntilNextTick`] — 분 · 초 경계에 맞춘다, 떠돌지 않게)
 *  · 고른 표시의 저장 글자 해석 · 검증([`parseClockOptions`])
 *  · **박스 크기**([`clockBoxSize`] — 2026-11-03: 박스가 글자를 꼭 감싼다. 박스를 정하고 글자를 맞추는 대신 **글자 크기**를
 *    정하고 박스를 셈한다 — 크기 모서리는 글자 크기를 바꾼다)
 * 반응형 상태와 localStorage 왕복은 `start-widgets.svelte.ts`, 그림 · 타이머는 `start/ClockWidget.svelte`.
 * 이 저장소의 vitest 는 `environment: "node"` 라 테스트가 닿는 자리는 순수 모듈뿐이다(`start-widgets.ts` 와 같은 나눔).
 */

/** 시계 위젯 우클릭 메뉴에서 고르는 표시 */
export interface ClockOptions {
  /** 12시간(오전 · 오후) — 아니면 24시간 */
  hour12: boolean;
  /** 초까지 보인다 */
  seconds: boolean;
  /** 숫자 아래 날짜 · 요일 한 줄 */
  date: boolean;
  /** 큰 숫자의 글자 크기(px) — 크기 모서리가 바꾼다. 박스는 이것으로 셈한다([`clockBoxSize`]) */
  size: number;
}

/** 큰 숫자 글자 크기의 범위 · 처음 값(px) */
export const CLOCK_FONT_MIN = 24;
export const CLOCK_FONT_MAX = 160;
export const CLOCK_FONT_DEFAULT = 88;

/** 처음 값 — 24시간 · 초 없음 · 날짜 보임 · 글자 88px */
export const DEFAULT_CLOCK_OPTIONS: Readonly<ClockOptions> = {
  hour12: false,
  seconds: false,
  date: true,
  size: CLOCK_FONT_DEFAULT,
};

export const clampClockFont = (px: number): number =>
  Math.max(CLOCK_FONT_MIN, Math.min(CLOCK_FONT_MAX, Math.round(px)));

/** 시계에 보이는 글자 */
export interface ClockFace {
  /** 큰 숫자 — `09:05` · `21:05:09` · `9:05`(12시간은 앞 0 없음) */
  time: string;
  /** 오전 · 오후(`AM` · `PM`) — 24시간이면 `null` */
  period: string | null;
  /** 오전 · 오후가 숫자 앞에 오는 언어인가(ko `오후 9:05` · en `9:05 PM`) */
  periodFirst: boolean;
  /** 날짜 · 요일 한 줄 — ko `11월 3일 화요일` · en `Tuesday, November 3` */
  date: string;
}

/**
 * 이 시각의 시계 글자 — `locale` 은 앱 언어(`ko` · `en`). 숫자는 시 · 분 · 초를 `:` 로 잇는다(언어마다 나눔표가 달라도
 * 큰 숫자 모양은 하나로). 24시간은 `h23`(자정이 `24` 로 나오는 `hour12: false` 의 함정을 피한다), 12시간은 `h12`.
 */
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

/**
 * 지금(`nowMs` — 에포크 ms)에서 다음 분(초를 보이면 다음 초) 경계까지 + [`TICK_SLACK_MS`]. 매번 경계에서 다시 재므로
 * `setInterval` 처럼 밀리지 않는다. 분 경계는 에포크 기준 60초 — 지역 시간대의 오프셋은 분 단위라 같은 경계다.
 */
export function msUntilNextTick(nowMs: number, seconds: boolean): number {
  const unit = seconds ? 1000 : 60_000;
  const into = ((nowMs % unit) + unit) % unit;
  return unit - into + TICK_SLACK_MS;
}

/**
 * localStorage 의 글자 → 고른 표시. 저장된 적 없음 · 깨진 글자 · 모르는 모양은 **처음 값**으로 조용히 물러서고, 칸 하나만
 * 깨졌으면 그 칸만 처음 값이다(다른 칸의 선택은 살린다). `date` 칸이 생기기 전의 저장값(칸 없음)은 날짜를 보인다(처음 값).
 */
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

/** 이미 JSON 을 푼 값 → 고른 표시(규칙은 [`parseClockOptions`] 와 같다 — 모양 프로필의 시작 화면 칸도 이 길) */
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

// ---------------------------------------------------------------------------
// 박스 크기 — 글자를 꼭 감싼다
//
// 박스는 **재지 않고 셈한다** — 화면에서 잰 폭은 시각 값(오늘의 날짜 길이 등)마다 달라 배치가 날마다 흔들리고, 그리기 전에는
// 알 수 없다(겹침 · 정리 · 맞춤 셈이 박스를 먼저 알아야 한다). 그래서 **형식**만 보고 정한다: 숫자는 자리 수(12시간도 두 자리로
// 어림 — 가장 넓은 꼴) · 오전/오후는 그 언어의 두 글자 중 넓은 쪽 · 날짜는 그 언어로 한 해의 날짜를 훑은 가장 넓은 줄. 글자 폭은
// 어림(앱 글꼴 Pretendard 기준으로 조금 넉넉히)이라 실제 글자는 박스 안 가운데에 선다 — 박스보다 조금 작을 수 있다.
// ---------------------------------------------------------------------------

/** 박스 안 여백(px) — 좌우 · 위아래. `ClockWidget.svelte` 의 CSS 와 같은 값이다(같이 바꾼다) */
export const CLOCK_PAD_X = 12;
export const CLOCK_PAD_Y = 8;
/** 오전/오후의 글자 크기(숫자 대비)와 숫자와의 틈(em) — CSS 와 같은 값 */
export const CLOCK_PERIOD_EM = 0.32;
export const CLOCK_PERIOD_GAP_EM = 0.15;
/** 박스 변은 판의 눈금(8px — `start-widgets.ts` 의 `GRID`)으로 올린다 — 끌어 놓기 · 맞춤이 눈금 단위로 움직이므로 */
const BOX_STEP = 8;

/** 날짜 줄의 글자 크기(px) — 숫자의 1/5, 11px 아래로는 안 내려간다 */
export const clockDateFont = (font: number): number => Math.max(11, Math.round(font * 0.2));
/** 숫자 줄과 날짜 줄 사이(px) */
export const clockDateGap = (font: number): number => Math.max(4, Math.round(font * 0.06));
/** 날짜 줄의 줄높이(배수) — CSS 와 같은 값 */
export const CLOCK_DATE_LINE = 1.25;

/** 글자 하나의 폭 어림(em) — 숫자는 tabular 폭 */
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

/** 이 언어의 날짜 줄 가운데 가장 넓은 것의 폭(em) — 한 해의 달마다 이레(두 자리 날)를 훑는다. 언어마다 한 번 */
export function widestDateEm(locale: string): number {
  const hit = dateEmCache.get(locale);
  if (hit !== undefined) return hit;
  const fmt = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" });
  let best = 0;
  for (let m = 0; m < 12; m++) for (let d = 22; d <= 28; d++) best = Math.max(best, textEm(fmt.format(new Date(2026, m, d))));
  dateEmCache.set(locale, best);
  return best;
}

/** 이 형식의 숫자 줄 폭(em) — 시각 값이 아니라 형식으로(초마다 · 시마다 흔들리지 않게) */
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

/**
 * **시계의 박스** — 글자 크기 `opts.size` 의 숫자 줄(+ 날짜 줄)을 꼭 감싸는 크기(눈금으로 올림). 배치의 시계 `w` · `h` 는 늘
 * 이 값이다(`StartPage` 가 표시 · 언어가 바뀌면 다시 맞춘다).
 */
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
