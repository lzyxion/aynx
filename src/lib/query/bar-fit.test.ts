import { describe, expect, it } from "vitest";
import { chipText, dropOrder, fitRunLine, runLineWidth, textPx, txLive, type ChipParts, type RunLineFit, type RunLineIn } from "./bar-fit";

const MODE = { long: ["자동", "수동 커밋"] as [string, string], short: ["자동", "수동"] as [string, string] };
const MODE_EN = { long: ["Auto", "Manual commit"] as [string, string], short: ["Auto", "Manual"] as [string, string] };
const TX = (working: boolean) => ({ begin: "시작", commit: "커밋", rollback: "되돌리기", working });
const CHIP: ChipParts = { name: "트랜잭션", stmts: "3문장", time: "00:42", warn: false };
const WARN: ChipParts = { name: "트랜잭션", stmts: "3문장", time: "00:59 뒤 되돌림", warn: true };

function line(over: Partial<RunLineIn> = {}): RunLineIn {
  return {
    width: 2000,
    pill: "쓰기 켬",
    mode: MODE,
    tx: TX(false),
    chip: null,
    extend: null,
    ask: true,
    elapsed: null,
    script: "스크립트 실행",
    run: "실행",
    ...over,
  };
}

const ALL: RunLineFit = { pillLabel: true, modeLong: true, idleTx: true, txLabels: true, scriptLabel: true, chipName: true, chipStmts: true, chipTime: true };
const shown = (f: RunLineFit) => Object.values(f).filter(Boolean).length;

describe("textPx — 글자 폭 어림", () => {
  it("한글 11 · 빈칸 3 · 나머지 6.5", () => {
    expect(textPx("실행")).toBe(22);
    expect(textPx("a b")).toBe(16);
  });
});

describe("dropOrder — 빼는 순서", () => {
  it("작업 없음 · 작업 중 · 경고", () => {
    expect(dropOrder(null)).toEqual(["modeLong", "idleTx", "pillLabel", "txLabels", "scriptLabel"]);
    expect(dropOrder(CHIP)[0]).toBe("chipTime");
    expect(dropOrder(CHIP).at(-1)).toBe("chipStmts");
    expect(dropOrder(WARN).at(-1)).toBe("chipTime");
  });
});

describe("chipText — 상태 글자", () => {
  it("평소: 트랜잭션 · N문장 · 경과", () => {
    expect(chipText(CHIP, ALL)).toBe("트랜잭션 · 3문장 · 00:42");
    expect(chipText(CHIP, { chipName: false, chipStmts: true, chipTime: false })).toBe("3문장");
  });
  it("경고: 남은 시간이 앞(목업 Warn)", () => {
    expect(chipText(WARN, { chipName: false, chipStmts: true, chipTime: true })).toBe("00:59 뒤 되돌림 · 3문장");
    expect(chipText(WARN, { chipName: false, chipStmts: false, chipTime: false })).toBe("");
  });
});

describe("txLive — 지금 누를 수 있는 작업 단추", () => {
  it("작업 없음 = 시작 · 작업 중 = 커밋 · 되돌리기", () => {
    expect(txLive(false, "begin")).toBe(true);
    expect(txLive(false, "commit")).toBe(false);
    expect(txLive(true, "begin")).toBe(false);
    expect(txLive(true, "rollback")).toBe(true);
  });
});

describe("fitRunLine — 접기", () => {
  it("넓으면 다 · 폭을 모르면 다", () => {
    expect(fitRunLine(line())).toEqual(ALL);
    expect(fitRunLine(line({ width: 0 }))).toEqual(ALL);
  });

  it("좁아질수록 순서대로 빠진다(작업 없음)", () => {
    const full = runLineWidth(line(), ALL);
    expect(fitRunLine(line({ width: full + 8 }))).toEqual(ALL);
    const f1 = fitRunLine(line({ width: full + 7 }));
    expect(f1.modeLong).toBe(false);
    expect(f1.idleTx).toBe(true);
    expect(fitRunLine(line({ width: 100 }))).toMatchObject({ pillLabel: false, modeLong: false, idleTx: false, txLabels: false, scriptLabel: false });
  });

  it("목업 Narrow(440px 타일 · 수동 · 작업 중) — 자물쇠 · 자동/수동 · 커밋 · 되돌리기 그림 · 문장 수 · 스크립트 그림 · [실행] 글자", () => {
    const b = line({ width: 418, tx: TX(true), chip: { ...CHIP, stmts: "1문장" } });
    const f = fitRunLine(b);
    expect(f).toMatchObject({ pillLabel: false, modeLong: false, idleTx: false, chipName: false, chipTime: false, txLabels: false, scriptLabel: false });
    expect(f.chipStmts).toBe(true);
    expect(runLineWidth(b, f)).toBeLessThanOrEqual(418);
  });

  it("경고 땐 남은 시간이 가장 늦게 빠진다", () => {
    const f = fitRunLine(line({ width: 520, tx: TX(true), chip: WARN, extend: "연장" }));
    expect(f.chipName).toBe(false);
    expect(f.chipTime).toBe(true);
  });

  it("[실행] 글자는 빠지지 않는다", () => {
    const f = fitRunLine(line({ width: 10, tx: TX(true), chip: CHIP }));
    expect(Object.values(f).every((v) => v === false)).toBe(true);
    expect(runLineWidth(line({ tx: TX(true), chip: CHIP }), f)).toBeGreaterThan(textPx("실행"));
  });

  it("쓰기 모드가 아니면(커밋 방식 · 작업 단추 없음) 알약 · 실행 · 스크립트만 — 알약 글자가 먼저 빠진다", () => {
    const b = line({ pill: "읽기 전용", mode: null, tx: null });
    expect(runLineWidth(b, ALL)).toBeLessThan(runLineWidth(line(), ALL));
    expect(fitRunLine({ ...b, width: 400 })).toEqual(ALL);
    expect(fitRunLine({ ...b, width: 260 })).toMatchObject({ pillLabel: false, scriptLabel: true });
  });

  it("알약 글자가 빠지면 자물쇠 그림 폭만 남는다", () => {
    const b = line({ pill: "읽기 전용", mode: null, tx: null });
    expect(runLineWidth(b, ALL) - runLineWidth(b, { ...ALL, pillLabel: false })).toBe(4 + textPx("읽기 전용"));
  });

  it("좁으면 못 누르는 작업 단추를 숨긴다", () => {
    const b = line({ tx: TX(false) });
    expect(runLineWidth(b, { ...ALL, modeLong: false, idleTx: false })).toBeLessThan(runLineWidth(b, { ...ALL, modeLong: false }));
  });

  it("어느 폭(320~1400px · 한/영 · 경고 · 작업 없음)에서도 다 빼고 남는 최소 폭보다 넓으면 넘지 않는다", () => {
    const cases: RunLineIn[] = [
      line(),
      line({ tx: TX(true), chip: CHIP }),
      line({ tx: TX(true), chip: WARN, extend: "연장" }),
      line({ mode: MODE_EN, tx: { begin: "Begin", commit: "Commit", rollback: "Roll back", working: true }, chip: { ...CHIP, name: "Transaction", stmts: "3 stmts" }, script: "Run script", run: "Run" }),
      line({ elapsed: "12.3s", run: "취소" }),
      line({ pill: "읽기 전용", mode: null, tx: null }),
      line({ pill: "Read-only", mode: null, tx: null, script: "Run script", run: "Run" }),
    ];
    for (const c of cases) {
      const floor = runLineWidth(c, { pillLabel: false, modeLong: false, idleTx: false, txLabels: false, scriptLabel: false, chipName: false, chipStmts: false, chipTime: false });
      for (let w = 320; w <= 1400; w += 7) {
        const b = { ...c, width: w };
        const f = fitRunLine(b);
        if (w >= floor + 8) expect(runLineWidth(b, f)).toBeLessThanOrEqual(w);
      }
    }
  });

  it("폭이 늘면 보이는 것이 줄지 않는다(접힘이 떨지 않는다)", () => {
    for (const c of [line(), line({ tx: TX(true), chip: CHIP }), line({ tx: TX(true), chip: WARN, extend: "연장" })]) {
      let prev = -1;
      for (let w = 200; w <= 1200; w += 5) {
        const n = shown(fitRunLine({ ...c, width: w }));
        expect(n).toBeGreaterThanOrEqual(prev);
        prev = n;
      }
    }
  });
});
