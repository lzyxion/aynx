import { describe, expect, it } from "vitest";
import { opStateKind, sortExecs, targetKind } from "./exec-rows";

describe("opStateKind — 작업안 집계 상태 알약", () => {
  it("실행 중은 run(primaryContainer) — 더 이상 성공과 같은 초록이 아니다", () => {
    expect(opStateKind("running")).toBe("run");
    expect(opStateKind("succeeded")).toBe("ok");
  });

  it("일부 성공 · 실패 · 취소 · 승인됨", () => {
    expect(opStateKind("partial")).toBe("warn");
    expect(opStateKind("failed")).toBe("err");
    expect(opStateKind("cancelled")).toBe("cancelled");
    expect(opStateKind("approved")).toBe("neutral");
  });

  it("실행 목록에 오지 않는 상태는 중성", () => {
    for (const s of ["draft", "awaitingApproval", "rejected", "expired"] as const) expect(opStateKind(s)).toBe("neutral");
  });
});

describe("targetKind — 대상별 알약", () => {
  it("상태 일곱을 빠짐없이 가른다", () => {
    expect(targetKind("pending")).toBe("neutral");
    expect(targetKind("running")).toBe("run");
    expect(targetKind("succeeded")).toBe("ok");
    expect(targetKind("failed")).toBe("err");
    expect(targetKind("timedOut")).toBe("err");
    expect(targetKind("cancelled")).toBe("cancelled");
    expect(targetKind("unknown")).toBe("unknown");
  });
});

describe("sortExecs — 실행 목록 순서", () => {
  type Row = { id: string; at: number | null; active: boolean };
  const rows: Row[] = [
    { id: "done-old", at: 100, active: false },
    { id: "ext-a", at: null, active: false },
    { id: "run-new", at: 500, active: true },
    { id: "done-new", at: 300, active: false },
    { id: "run-old", at: 200, active: true },
    { id: "ext-b", at: null, active: false },
    { id: "run-ext", at: null, active: true },
  ];
  const ids = (sort: "newest" | "oldest") =>
    sortExecs(
      rows,
      sort,
      (r) => r.at,
      (r) => r.active,
    ).map((r) => r.id);

  it("최근 먼저 — 도는 · 승인된 실행이 늘 위, 시각 모르는 줄은 제 묶음 끝에 들어온 차례로", () => {
    expect(ids("newest")).toEqual(["run-new", "run-old", "run-ext", "done-new", "done-old", "ext-a", "ext-b"]);
  });

  it("오래된 먼저 — 도는 실행은 여전히 위(그 안도 오래된 먼저)", () => {
    expect(ids("oldest")).toEqual(["run-old", "run-new", "run-ext", "done-old", "done-new", "ext-a", "ext-b"]);
  });

  it("같은 시각은 들어온 차례 그대로(안정), 입력 배열은 건드리지 않는다", () => {
    const same: Row[] = [
      { id: "a", at: 1, active: false },
      { id: "b", at: 1, active: false },
    ];
    expect(sortExecs(same, "newest", (r) => r.at, (r) => r.active).map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0].id).toBe("done-old");
  });
});
