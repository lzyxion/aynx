/**
 * **결과 차트의 규칙** — 쿼리 결과 하나를 선 · 막대 · 산점도로 그릴 때의 열 분류 · 기본 축 · 시리즈(2026-10-15). **순수 함수**
 * (그리기는 `ResultChart.svelte` 가 uPlot 으로).
 *
 * ## 열 분류 — 형 이름과 값 표본을 함께 본다
 *
 * 칸 값의 모양은 Rust `db::value::to_json` 하나다([`Cell`]). 차트에 걸리는 사정:
 *
 * - **숫자가 글자로 온다** — PG `numeric` · MySQL `decimal` 은 언제나 글자(정밀도를 지키려고), 정수는 ±2^53 밖이면 글자, 실수의
 *   NaN · 무한도 글자(`"NaN"` · `"Infinity"`). 그래서 숫자 열의 값은 글자도 숫자로 읽고, 못 읽는 것(NaN · 무한 포함)은 빈칸(gap)이다.
 *   2^53 밖 정수는 그릴 때 정밀도를 잃는다(그림이라 괜찮다 — 정확한 값은 표에 있다).
 * - **날짜도 글자로 온다** — PG `date`·`timestamp`·`timestamptz`(`2026-10-15 12:00:00.5+00` — 세션 시간대가 UTC 라 늘 `+00`) ·
 *   MySQL `date`·`datetime`·`timestamp`. ISO 꼴(`YYYY-MM-DD[ T]HH:MM[:SS[.frac]][Z|±HH[:MM]]`)만 읽는다 — `infinity` · ` BC` 는 빈칸.
 * - **SQLite 는 형 이름이 빈약하다** — 컬럼 `type` 은 첫 NULL 아닌 값의 저장 종류(`integer` · `real` · `text` · `blob`)이거나 빈 글자다.
 *   그래서 `text` 열이 전부 ISO 날짜면 시간 열로 본다(SQLite 는 날짜를 글자로 담는다). 형을 모르는 열은 값만으로 가른다.
 *
 * | 분류 | 무엇 |
 * | --- | --- |
 * | `numeric` | 정수 · 실수 · numeric/decimal · money · year · SQLite `integer`/`real` · 형을 모르는데 값이 전부 숫자(글자 숫자 포함) |
 * | `temporal` | date · timestamp(tz) · datetime · 글자 열인데 값이 전부 ISO 날짜 |
 * | `category` | 글자 · enum · uuid · inet · time · interval(라벨로만 쓴다) |
 * | `unusable` | **참/거짓**(축으로도 값으로도 뜻이 없다 — 0/1 로 그리려면 SQL 에서 `CASE`) · 바이트 · json · 배열 · 기하 · 값이 전부 NULL |
 *
 * 글자 열에 숫자만 들었어도(우편번호 · 코드) **범주로 둔다** — 형이 글자라고 말했으면 그 말을 믿는다(모르는 형일 때만 값으로 숫자 판정).
 *
 * ## 기본 축
 *
 * X = 첫 시간 열 → 없으면 첫 범주 열 → 없으면 첫 숫자 열(이때 Y 는 나머지 숫자 열) → 숫자 열이 하나뿐이면 **행 순서**([`ROW_AXIS`]).
 * Y = X 가 아닌 숫자 열, 앞에서 [`MAX_Y`]개. 종류 = X 가 시간 · 숫자면 선, 범주 · 행 순서면 막대. 산점도는 X 가 숫자 · 시간일 때만.
 *
 * ## 시리즈
 *
 * - 시간 · 숫자 X — X 오름차순으로 정렬(같은 X 는 행 순서대로). X 가 NULL · 못 읽음이면 그 행은 놓을 자리가 없어 뺀다(`dropped`).
 * - 범주 · 행 순서 X — **행 순서 그대로** 0..n-1 자리 + 라벨. 같은 라벨이 여러 번 나와도 **합치지 않는다** — 집계는 SQL 의 몫이다
 *   (`GROUP BY` 를 앱이 몰래 흉내 내면 합 · 평균 · 개수 중 무엇인지 화면이 말해야 한다).
 * - Y 의 NULL · 못 읽음 = `null`(선이 끊긴다).
 *
 * 그릴 수 없는 결과(행 0개 · 숫자 열 0개)는 [`chartBlocker`] 가 이유 키를 준다 → [차트] 비활성 + 말풍선.
 */
import { cellDisplay } from "./cells";
import type { Cell, DbColumn, DbQueryResult } from "./query-backend";

export type ColClass = "numeric" | "temporal" | "category" | "unusable";
export type ChartKind = "line" | "bar" | "scatter";
/** X 축의 실제 갈래 — 행 순서는 열이 아니다 */
export type XKind = "temporal" | "numeric" | "category" | "row";

/** X = 행 순서(열 번호 자리에 넣는 값) */
export const ROW_AXIS = -1;
/** Y 시리즈 상한 — 색 줄 수와 같다(그 이상은 읽히지 않는다) */
export const MAX_Y = 8;
/** 값 표본 — 앞에서 NULL 아닌 칸 이만큼만 본다(행 1만이어도 분류는 즉시) */
const SAMPLE = 500;

export interface ChartPick {
  /** X 열 번호 · [`ROW_AXIS`] */
  x: number;
  /** Y 열 번호들(숫자 열만 — 열 순서) */
  ys: number[];
  kind: ChartKind;
}

// ── 형 이름 ────────────────────────────────────────────────────────────────

const NUMERIC_TYPES = new Set([
  "int", "int2", "int4", "int8", "smallint", "integer", "bigint", "tinyint", "mediumint", "serial", "bigserial", "smallserial",
  "float", "float4", "float8", "real", "double", "double precision", "numeric", "decimal", "number", "money", "year", "oid",
]);
const TEMPORAL_TYPES = new Set([
  "date", "timestamp", "timestamptz", "datetime", "timestamp with time zone", "timestamp without time zone",
]);
/** 글자 형 — 값이 전부 ISO 날짜면 시간 열(SQLite `text` 의 날짜), 아니면 범주 */
const TEXT_TYPES = new Set([
  "text", "varchar", "char", "bpchar", "name", "citext", "character", "character varying", "string", "clob",
]);
/** 라벨로만 쓰는 형 */
const CATEGORY_TYPES = new Set(["enum", "set", "uuid", "inet", "cidr", "macaddr", "macaddr8", "time", "timetz", "interval"]);
const UNUSABLE_TYPES = new Set([
  "bool", "boolean", "bytea", "blob", "binary", "varbinary", "bit", "varbit", "json", "jsonb", "jsonpath", "xml",
  "geometry", "vector", "point", "tsvector", "tsquery", "null",
]);

/** 형 이름 → 비교용(소문자 · 괄호 인자 · `unsigned` 떼기) */
function normType(t: string): string {
  return t
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(unsigned|signed|zerofill)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 값 읽기 ────────────────────────────────────────────────────────────────

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** 칸 → 숫자(글자 숫자 포함). NULL · 참거짓 · 바이트 · NaN · 무한 · 못 읽음은 `null` */
export function parseNumber(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c === "string") {
    const s = c.trim();
    if (!NUM_RE.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2}(?::?\d{2})?)?)?$/;

/**
 * 칸 → 시각(UTC 기준 **초** — uPlot 의 시간 축 단위). ISO 꼴 글자만. 시간대가 없으면 **그 글자 그대로를 UTC 로** 읽는다 — 차트도 UTC 로
 * 그리므로 화면의 글자가 표의 글자와 같다(벽시계 그대로). 시간대가 있으면 UTC 로 옮긴다.
 */
export function parseTemporal(c: Cell): number | null {
  if (typeof c !== "string") return null;
  const m = ISO_RE.exec(c.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", tz] = m;
  const month = Number(mo) - 1;
  const day = Number(d);
  const dt = new Date(0);
  // `Date.UTC` 는 0~99 년을 1900 년대로 옮긴다 — 년은 따로 넣는다
  dt.setUTCFullYear(Number(y), month, day);
  dt.setUTCHours(Number(h), Number(mi), Number(s), 0);
  if (dt.getUTCMonth() !== month || dt.getUTCDate() !== day || Number(h) > 23 || Number(mi) > 59 || Number(s) > 60) return null;
  let sec = dt.getTime() / 1000 + (frac ? Number(`0.${frac}`) : 0);
  if (tz && tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(/:/g, "");
    const off = Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4) || "0") * 60 + Number(digits.slice(4, 6) || "0");
    sec -= sign * off;
  }
  return sec;
}

// ── 열 분류 ────────────────────────────────────────────────────────────────

function samples(rows: readonly Cell[][], i: number): Cell[] {
  const out: Cell[] = [];
  for (const r of rows) {
    const v = r[i] ?? null;
    if (v === null) continue;
    out.push(v);
    if (out.length >= SAMPLE) break;
  }
  return out;
}

/** 형을 모를 때 — 값만으로 */
function byValues(vals: readonly Cell[]): ColClass {
  if (vals.length === 0) return "unusable";
  if (vals.every((v) => typeof v === "boolean" || typeof v === "object")) return "unusable";
  if (vals.every((v) => parseNumber(v) !== null)) return "numeric";
  if (vals.every((v) => parseTemporal(v) !== null)) return "temporal";
  return "category";
}

/** 열 하나의 분류 — 형 이름이 먼저, 모르는 형 · 글자 형은 값 표본으로(머리 주석의 표) */
export function classifyColumn(col: DbColumn, rows: readonly Cell[][], index: number): ColClass {
  const t = normType(col.type);
  if (t.endsWith("[]")) return "unusable";
  if (UNUSABLE_TYPES.has(t)) return "unusable";
  const vals = samples(rows, index);
  if (vals.length === 0) return "unusable";
  if (NUMERIC_TYPES.has(t)) return "numeric";
  if (TEMPORAL_TYPES.has(t)) return "temporal";
  if (CATEGORY_TYPES.has(t)) return "category";
  if (TEXT_TYPES.has(t)) return vals.every((v) => parseTemporal(v) !== null) ? "temporal" : "category";
  return byValues(vals);
}

export function classifyColumns(r: Pick<DbQueryResult, "columns" | "rows">): ColClass[] {
  return r.columns.map((c, i) => classifyColumn(c, r.rows, i));
}

// ── 그릴 수 있나 · 기본 축 ───────────────────────────────────────────────────

/** 그릴 수 없는 이유(i18n 키 꼬리) — `null` = 그릴 수 있다 */
export type ChartBlocker = "noRows" | "noNumeric";

export function chartBlocker(r: Pick<DbQueryResult, "columns" | "rows">, classes: readonly ColClass[]): ChartBlocker | null {
  if (r.columns.length === 0 || r.rows.length === 0) return "noRows";
  if (!classes.includes("numeric")) return "noNumeric";
  return null;
}

export function xKindOf(x: number, classes: readonly ColClass[]): XKind {
  if (x === ROW_AXIS) return "row";
  const c = classes[x];
  return c === "temporal" || c === "numeric" ? c : "category";
}

/** 그 X 에 고를 수 있는 종류 — 산점도는 숫자 · 시간 X 만(범주 · 행 순서의 점은 막대보다 읽기 어렵다) */
export function allowedKinds(xk: XKind): ChartKind[] {
  return xk === "temporal" || xk === "numeric" ? ["line", "bar", "scatter"] : ["line", "bar"];
}

export function defaultKind(xk: XKind): ChartKind {
  return xk === "temporal" || xk === "numeric" ? "line" : "bar";
}

/** X 로 고를 수 있는 열 — 숫자 · 시간 · 범주(쓸 수 없는 열은 빠진다) */
export function xCandidates(classes: readonly ColClass[]): number[] {
  const out: number[] = [];
  classes.forEach((c, i) => c !== "unusable" && out.push(i));
  return out;
}

/** Y 로 고를 수 있는 열 — 숫자 열 중 X 가 아닌 것 */
export function yCandidates(classes: readonly ColClass[], x: number): number[] {
  const out: number[] = [];
  classes.forEach((c, i) => c === "numeric" && i !== x && out.push(i));
  return out;
}

export function defaultPick(classes: readonly ColClass[]): ChartPick {
  const nums = classes.flatMap((c, i) => (c === "numeric" ? [i] : []));
  let x = classes.indexOf("temporal");
  if (x < 0) x = classes.indexOf("category");
  if (x < 0) x = nums.length >= 2 ? nums[0] : ROW_AXIS;
  const ys = yCandidates(classes, x).slice(0, MAX_Y);
  return { x, ys, kind: defaultKind(xKindOf(x, classes)) };
}

/**
 * 사람이 바꾼 고르기를 맞춘다 — X 가 Y 에 들었으면 Y 에서 빼고, 숫자 아닌 Y · 상한 넘는 Y 를 걷고(열 순서로), 그 X 에 없는 종류면
 * 그 X 의 기본 종류로. Y 가 비는 것은 그대로 둔다(그리는 쪽이 "Y 를 고르세요").
 */
export function normalizePick(p: ChartPick, classes: readonly ColClass[]): ChartPick {
  const x = p.x === ROW_AXIS || (classes[p.x] !== undefined && classes[p.x] !== "unusable") ? p.x : defaultPick(classes).x;
  const allowed = new Set(yCandidates(classes, x));
  const ys = [...new Set(p.ys)].filter((i) => allowed.has(i)).sort((a, b) => a - b).slice(0, MAX_Y);
  const xk = xKindOf(x, classes);
  const kind = allowedKinds(xk).includes(p.kind) ? p.kind : defaultKind(xk);
  return { x, ys, kind };
}

// ── 시리즈 ─────────────────────────────────────────────────────────────────

export interface ChartSeries {
  xKind: XKind;
  /** X 자리 — 시간은 UTC 초 · 범주는 0..n-1 · 행 순서는 1..n */
  xs: number[];
  /** Y 열마다 한 줄(`pick.ys` 순서) — NULL · 못 읽음은 `null` */
  ys: (number | null)[][];
  /** 범주 X 의 라벨(자리 = 번호) — 그 밖은 `null` */
  labels: string[] | null;
  /** X 가 NULL · 못 읽음이라 뺀 행 수(시간 · 숫자 X 만) */
  dropped: number;
}

export function buildSeries(r: Pick<DbQueryResult, "rows">, classes: readonly ColClass[], p: ChartPick): ChartSeries {
  const xKind = xKindOf(p.x, classes);
  const rows = r.rows;
  const yOf = (row: Cell[]) => p.ys.map((i) => parseNumber(row[i] ?? null));

  if (xKind === "row" || xKind === "category") {
    const xs = rows.map((_, i) => (xKind === "row" ? i + 1 : i));
    const labels = xKind === "category" ? rows.map((row) => cellDisplay(row[p.x] ?? null)) : null;
    const ys = p.ys.map(() => [] as (number | null)[]);
    for (const row of rows) yOf(row).forEach((v, k) => ys[k].push(v));
    return { xKind, xs, ys, labels, dropped: 0 };
  }

  const read = xKind === "temporal" ? parseTemporal : parseNumber;
  const pts: { x: number; at: number }[] = [];
  rows.forEach((row, at) => {
    const x = read(row[p.x] ?? null);
    if (x !== null) pts.push({ x, at });
  });
  // 같은 X 는 행 순서대로(안정 정렬 — Array.sort 는 안정이지만 뜻을 적어 둔다)
  pts.sort((a, b) => a.x - b.x || a.at - b.at);
  const ys = p.ys.map(() => [] as (number | null)[]);
  for (const { at } of pts) yOf(rows[at]).forEach((v, k) => ys[k].push(v));
  return { xKind, xs: pts.map((q) => q.x), ys, labels: null, dropped: rows.length - pts.length };
}

// ── 막대 자리 ──────────────────────────────────────────────────────────────

export interface BarLayout {
  /** 이웃 X 사이의 가장 좁은 간격(X 단위) — 막대 한 묶음의 칸 */
  colW: number;
  /** 막대 하나의 폭(X 단위) */
  width: number;
  /** 시리즈마다 막대 왼쪽 끝의 자리 — X 에서 뺀 값(묶음이 X 를 가운데로 선다) */
  offsets: number[];
  /** X 축 범위 — 끝 막대가 잘리지 않게 반 칸씩 넓힌다 */
  range: [number, number];
}

/** 묶음 막대의 자리 — 시리즈 n 개를 한 칸의 80% 안에 나란히. X 가 하나뿐이면 칸 = 1(시간이면 하루) */
export function barLayout(xs: readonly number[], n: number, xk: XKind): BarLayout {
  let colW = Infinity;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    if (d > 0 && d < colW) colW = d;
  }
  if (!Number.isFinite(colW)) colW = xk === "temporal" ? 86400 : 1;
  const group = colW * 0.8;
  const count = Math.max(1, n);
  const width = group / count;
  const offsets = Array.from({ length: count }, (_, j) => -group / 2 + j * width);
  const lo = xs.length ? xs[0] : 0;
  const hi = xs.length ? xs[xs.length - 1] : 0;
  return { colW, width, offsets, range: [lo - colW / 2, hi + colW / 2] };
}

// ── 글자 ───────────────────────────────────────────────────────────────────

/** 시각(UTC 초) → 글자. 자정이면 날짜만, 초 아래가 있으면 밀리초까지 */
export function formatTime(sec: number): string {
  const d = new Date(Math.round(sec * 1000));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const date = `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds(), ms = d.getUTCMilliseconds();
  if (h === 0 && mi === 0 && s === 0 && ms === 0) return date;
  return `${date} ${p(h)}:${p(mi)}:${p(s)}${ms ? `.${p(ms, 3)}` : ""}`;
}

/** 숫자 → 말풍선 글자(유효 숫자 12자리 — 부동소수 꼬리 `0.30000000000000004` 를 걷는다) */
export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return String(Number(v.toPrecision(12)));
}

/** X 자리 → 말풍선 글자 */
export function formatX(s: Pick<ChartSeries, "xKind" | "labels">, v: number): string {
  if (s.xKind === "temporal") return formatTime(v);
  if (s.xKind === "category") return s.labels?.[Math.round(v)] ?? "";
  return formatNumber(v);
}
