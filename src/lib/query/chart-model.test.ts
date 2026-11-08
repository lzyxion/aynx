import { describe, expect, it } from "vitest";
import {
  allowedKinds,
  barLayout,
  buildSeries,
  chartBlocker,
  classifyColumn,
  classifyColumns,
  defaultPick,
  formatNumber,
  formatTime,
  formatX,
  MAX_Y,
  normalizePick,
  parseNumber,
  parseTemporal,
  ROW_AXIS,
  xCandidates,
  yCandidates,
} from "./chart-model";
import type { Cell, DbColumn } from "./query-backend";

const col = (name: string, type: string): DbColumn => ({ name, type });
const res = (columns: DbColumn[], rows: Cell[][]) => ({ columns, rows });

describe("값 읽기", () => {
  it("숫자 — 수 · 글자 숫자(numeric · 큰 정수) · NaN/무한/글자/참거짓/바이트는 null", () => {
    expect(parseNumber(3)).toBe(3);
    expect(parseNumber("12.50")).toBe(12.5);
    expect(parseNumber("-1e3")).toBe(-1000);
    expect(parseNumber("9007199254740993")).toBe(9007199254740992);
    expect(parseNumber(" 7 ")).toBe(7);
    expect(parseNumber("NaN")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
    expect(parseNumber("12abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(true)).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber({ $bytes: 1, hex: "00" })).toBeNull();
  });

  it("시각 — ISO 꼴만, 시간대 없으면 글자 그대로 UTC, 있으면 UTC 로 옮김", () => {
    expect(parseTemporal("2026-10-15")).toBe(Date.UTC(2026, 9, 15) / 1000);
    expect(parseTemporal("2026-10-15 12:30:00")).toBe(Date.UTC(2026, 9, 15, 12, 30) / 1000);
    expect(parseTemporal("2026-10-15T12:30")).toBe(Date.UTC(2026, 9, 15, 12, 30) / 1000);
    expect(parseTemporal("2026-10-15 12:00:00.5+00")).toBe(Date.UTC(2026, 9, 15, 12) / 1000 + 0.5);
    expect(parseTemporal("2026-10-15 12:00:00+09:00")).toBe(Date.UTC(2026, 9, 15, 3) / 1000);
    expect(parseTemporal("2026-10-15T12:00:00Z")).toBe(Date.UTC(2026, 9, 15, 12) / 1000);
    expect(parseTemporal("0050-01-01")).toBe(new Date(0).setUTCFullYear(50, 0, 1) / 1000);
    expect(parseTemporal("2026-02-30")).toBeNull();
    expect(parseTemporal("infinity")).toBeNull();
    expect(parseTemporal("2026-10-15 BC")).toBeNull();
    expect(parseTemporal("10/15/2026")).toBeNull();
    expect(parseTemporal("12:30:00")).toBeNull();
    expect(parseTemporal(20261015)).toBeNull();
  });
});

describe("열 분류", () => {
  it("PG 형 이름", () => {
    const rows: Cell[][] = [[1, "3.50", "2026-10-15", "2026-10-15 01:00:00+00", "a", true, { $bytes: 1, hex: "00" }, "{1,2}", "{}"]];
    const cols = [
      col("id", "int4"),
      col("amt", "numeric"),
      col("d", "date"),
      col("ts", "timestamptz"),
      col("name", "text"),
      col("ok", "bool"),
      col("raw", "bytea"),
      col("arr", "int4[]"),
      col("j", "jsonb"),
    ];
    expect(classifyColumns(res(cols, rows))).toEqual([
      "numeric",
      "numeric",
      "temporal",
      "temporal",
      "category",
      "unusable",
      "unusable",
      "unusable",
      "unusable",
    ]);
  });

  it("MySQL 형 이름 — decimal 글자 · datetime 글자 · unsigned · 괄호 인자", () => {
    const rows: Cell[][] = [["10.00", "2026-10-15 12:00:00", 5, "x", 2026]];
    const cols = [col("p", "decimal(10,2)"), col("at", "datetime"), col("n", "int unsigned"), col("s", "varchar"), col("y", "year")];
    expect(classifyColumns(res(cols, rows))).toEqual(["numeric", "temporal", "numeric", "category", "numeric"]);
  });

  it("SQLite — 저장 종류 · text 의 날짜 · 빈 형은 값으로", () => {
    const rows: Cell[][] = [
      [1, 1.5, "2026-10-01", "a", "2026-10-01 10:00", 2],
      [2, 2.5, "2026-10-02", "b", null, "3"],
    ];
    const cols = [col("i", "integer"), col("r", "real"), col("d", "text"), col("t", "text"), col("u", ""), col("v", "")];
    expect(classifyColumns(res(cols, rows))).toEqual(["numeric", "numeric", "temporal", "category", "temporal", "numeric"]);
  });

  it("글자 형에 숫자만 들었어도 범주(우편번호) · 값이 전부 NULL 이면 쓸 수 없음 · 모르는 형의 참거짓은 쓸 수 없음", () => {
    expect(classifyColumn(col("zip", "varchar"), [["06236"], ["12345"]], 0)).toBe("category");
    expect(classifyColumn(col("n", "int4"), [[null], [null]], 0)).toBe("unusable");
    expect(classifyColumn(col("b", ""), [[true], [false]], 0)).toBe("unusable");
    expect(classifyColumn(col("m", ""), [[1], ["x"]], 0)).toBe("category");
    expect(classifyColumn(col("e", "enum"), [["a"]], 0)).toBe("category");
  });
});

describe("그릴 수 있나", () => {
  it("행 0개 · 열 0개 · 숫자 열 0개", () => {
    expect(chartBlocker(res([col("a", "int4")], []), ["numeric"])).toBe("noRows");
    expect(chartBlocker(res([], []), [])).toBe("noRows");
    expect(chartBlocker(res([col("a", "text")], [["x"]]), ["category"])).toBe("noNumeric");
    expect(chartBlocker(res([col("a", "int4")], [[1]]), ["numeric"])).toBeNull();
  });
});

describe("기본 축", () => {
  it("X = 첫 시간 열 · Y = 나머지 숫자 · 선", () => {
    expect(defaultPick(["category", "numeric", "temporal", "numeric"])).toEqual({ x: 2, ys: [1, 3], kind: "line" });
  });

  it("시간 열이 없으면 첫 범주 · 막대", () => {
    expect(defaultPick(["numeric", "category", "numeric", "unusable"])).toEqual({ x: 1, ys: [0, 2], kind: "bar" });
  });

  it("범주도 없으면 첫 숫자가 X · 나머지가 Y · 선", () => {
    expect(defaultPick(["numeric", "unusable", "numeric", "numeric"])).toEqual({ x: 0, ys: [2, 3], kind: "line" });
  });

  it("숫자 열 하나뿐이면 X = 행 순서 · 막대", () => {
    expect(defaultPick(["numeric", "unusable"])).toEqual({ x: ROW_AXIS, ys: [0], kind: "bar" });
  });

  it("Y 는 앞 8개까지", () => {
    const classes = ["temporal", ...Array<"numeric">(12).fill("numeric")] as const;
    const p = defaultPick([...classes]);
    expect(p.ys).toHaveLength(MAX_Y);
    expect(p.ys).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("후보 — X 는 쓸 수 있는 열 · Y 는 X 가 아닌 숫자 열", () => {
    const classes = ["numeric", "unusable", "category", "numeric"] as const;
    expect(xCandidates([...classes])).toEqual([0, 2, 3]);
    expect(yCandidates([...classes], 0)).toEqual([3]);
    expect(yCandidates([...classes], ROW_AXIS)).toEqual([0, 3]);
  });
});

describe("고르기 맞추기", () => {
  const classes = ["temporal", "numeric", "numeric", "category"] as const;

  it("X 가 Y 에 들면 Y 에서 뺀다 · 숫자 아닌 Y 는 걷는다 · 열 순서", () => {
    expect(normalizePick({ x: 1, ys: [3, 2, 1, 0], kind: "line" }, [...classes])).toEqual({ x: 1, ys: [2], kind: "line" });
  });

  it("범주 X 에 산점도면 그 X 의 기본(막대)으로", () => {
    expect(normalizePick({ x: 3, ys: [1], kind: "scatter" }, [...classes])).toEqual({ x: 3, ys: [1], kind: "bar" });
    expect(allowedKinds("category")).toEqual(["line", "bar"]);
    expect(allowedKinds("row")).toEqual(["line", "bar"]);
    expect(allowedKinds("temporal")).toContain("scatter");
  });

  it("쓸 수 없는 X 는 기본 X 로 · 빈 Y 는 그대로", () => {
    expect(normalizePick({ x: 9, ys: [], kind: "line" }, [...classes])).toEqual({ x: 0, ys: [], kind: "line" });
  });
});

describe("시리즈", () => {
  it("시간 X — 오름차순 정렬 · X 가 NULL/못 읽음이면 행을 뺀다 · Y 의 NULL/못 읽음은 gap", () => {
    const rows: Cell[][] = [
      ["2026-10-03", 3, "30"],
      [null, 9, 9],
      ["2026-10-01", 1, null],
      ["nope", 9, 9],
      ["2026-10-02", "NaN", 20],
    ];
    const s = buildSeries({ rows }, ["temporal", "numeric", "numeric"], { x: 0, ys: [1, 2], kind: "line" });
    expect(s.xKind).toBe("temporal");
    expect(s.xs).toEqual([1, 2, 3].map((d) => Date.UTC(2026, 9, d) / 1000));
    expect(s.ys).toEqual([
      [1, null, 3],
      [null, 20, 30],
    ]);
    expect(s.dropped).toBe(2);
    expect(s.labels).toBeNull();
  });

  it("같은 X 는 행 순서대로", () => {
    const rows: Cell[][] = [
      [2, 10],
      [1, 20],
      [2, 30],
    ];
    const s = buildSeries({ rows }, ["numeric", "numeric"], { x: 0, ys: [1], kind: "scatter" });
    expect(s.xs).toEqual([1, 2, 2]);
    expect(s.ys).toEqual([[20, 10, 30]]);
  });

  it("범주 X — 행 순서 그대로 · 같은 라벨도 합치지 않는다 · NULL 라벨은 NULL", () => {
    const rows: Cell[][] = [
      ["b", 2],
      ["a", 1],
      ["b", 5],
      [null, 7],
    ];
    const s = buildSeries({ rows }, ["category", "numeric"], { x: 0, ys: [1], kind: "bar" });
    expect(s.xs).toEqual([0, 1, 2, 3]);
    expect(s.labels).toEqual(["b", "a", "b", "NULL"]);
    expect(s.ys).toEqual([[2, 1, 5, 7]]);
    expect(s.dropped).toBe(0);
  });

  it("행 순서 X — 1..n", () => {
    const s = buildSeries({ rows: [[5], [6]] }, ["numeric"], { x: ROW_AXIS, ys: [0], kind: "bar" });
    expect(s.xKind).toBe("row");
    expect(s.xs).toEqual([1, 2]);
    expect(s.ys).toEqual([[5, 6]]);
  });
});

describe("막대 자리", () => {
  it("범주 — 칸 1 · 시리즈 둘이면 0.4 씩 나란히 · 범위 반 칸씩", () => {
    const b = barLayout([0, 1, 2], 2, "category");
    expect(b.colW).toBe(1);
    expect(b.width).toBeCloseTo(0.4);
    expect(b.offsets[0]).toBeCloseTo(-0.4);
    expect(b.offsets[1]).toBeCloseTo(0);
    expect(b.range).toEqual([-0.5, 2.5]);
  });

  it("가장 좁은 간격이 칸 · 같은 X 는 간격으로 치지 않는다 · 점 하나면 시간은 하루", () => {
    expect(barLayout([0, 10, 10, 15], 1, "numeric").colW).toBe(5);
    expect(barLayout([100], 1, "temporal").colW).toBe(86400);
    expect(barLayout([100], 1, "numeric").colW).toBe(1);
  });
});

describe("글자", () => {
  it("시각 — 자정은 날짜만 · 밀리초", () => {
    expect(formatTime(Date.UTC(2026, 9, 15) / 1000)).toBe("2026-10-15");
    expect(formatTime(Date.UTC(2026, 9, 15, 9, 5, 3) / 1000)).toBe("2026-10-15 09:05:03");
    expect(formatTime(Date.UTC(2026, 9, 15, 9, 5, 3, 250) / 1000)).toBe("2026-10-15 09:05:03.250");
  });

  it("숫자 · X", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(null)).toBe("—");
    expect(formatX({ xKind: "category", labels: ["a", "b"] }, 1)).toBe("b");
    expect(formatX({ xKind: "row", labels: null }, 3)).toBe("3");
  });
});
