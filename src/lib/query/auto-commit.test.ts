import { describe, expect, it } from "vitest";
import { autoCommitOff, autoCommitToggle, runRoute } from "./auto-commit";
import { txButtons, type TxSeen } from "./tx-work";

const base = { writable: true, txOpen: false, running: false, busy: false, connected: true };

describe("자동 커밋 토글(10-14)", () => {
  it("판 13 서버 · 쓰기 모드에서만 보인다 — 기본 켬", () => {
    expect(autoCommitToggle({ ...base, autoCommit: true })).toEqual({ shown: true, on: true, disabled: false, lockedByWork: false });
    expect(autoCommitToggle({ ...base, autoCommit: false }).on).toBe(false);
    // 판 12 서버(칸 없음) — 숨김(보내면 서버가 버려 끈 줄 알고 친 문장이 커밋된다).
    expect(autoCommitToggle({ ...base, autoCommit: undefined }).shown).toBe(false);
    // 쓰기를 끄면 토글도 사라진다.
    expect(autoCommitToggle({ ...base, writable: false, autoCommit: true }).shown).toBe(false);
  });

  it("작업이 열려 있으면 바꿀 수 없다 · 도는 중 · 끊김도 막는다", () => {
    const t = autoCommitToggle({ ...base, txOpen: true, autoCommit: false });
    expect([t.shown, t.disabled, t.lockedByWork]).toEqual([true, true, true]);
    expect(autoCommitToggle({ ...base, running: true, autoCommit: true }).disabled).toBe(true);
    expect(autoCommitToggle({ ...base, busy: true, autoCommit: true }).disabled).toBe(true);
    expect(autoCommitToggle({ ...base, connected: false, autoCommit: true }).disabled).toBe(true);
    expect(autoCommitToggle({ ...base, running: true, autoCommit: true }).lockedByWork).toBe(false);
  });

  it("끔 = 쓰기 모드 + 서버가 끔이라고 말할 때만", () => {
    expect(autoCommitOff({ writable: true, autoCommit: false })).toBe(true);
    expect(autoCommitOff({ writable: true, autoCommit: true })).toBe(false);
    expect(autoCommitOff({ writable: true, autoCommit: undefined })).toBe(false);
    expect(autoCommitOff({ writable: false, autoCommit: false })).toBe(false);
  });

  it("[트랜잭션 작업 시작] 은 수동 커밋에서도 남는다 — 조회부터 묶기 · SELECT … FOR UPDATE 로 시작(Codex 검토 반영 2)", () => {
    const o = { writable: true, tx: null as TxSeen | null, now: 0, running: false, busy: false, connected: true };
    // 단추는 자동 커밋 값을 보지 않는다 — 쓰기 모드 · 작업 없음이면 늘 선다.
    expect(txButtons(o).begin).toEqual({ shown: true, disabled: false });
    expect(autoCommitToggle({ autoCommit: false, writable: true, txOpen: false, running: false, busy: false, connected: true }).shown).toBe(true);
    expect(txButtons({ ...o, writable: false }).begin.shown).toBe(false);
  });
});

describe("Ctrl+Enter 의 갈래 — 여러 문장", () => {
  const multi = "INSERT INTO t VALUES (1); UPDATE t SET a = 2";
  const r = (text: string, inWork: boolean, off: boolean, scriptSupported = true) =>
    runRoute({ text, dialect: "postgres", inWork, autoCommitOff: off, scriptSupported });

  it("자동 커밋 끔 · 작업 중이면 여러 문장은 스크립트 실행기로", () => {
    expect(r(multi, false, true)).toBe("script");
    expect(r(multi, true, false)).toBe("script");
    expect(r(multi, true, true)).toBe("script");
  });

  it("문장 하나 · 자동 커밋 켬(작업 없음) · 판 9 서버는 지금처럼 단문(서버가 여러 문장을 'Alt+X 로' 거절)", () => {
    expect(r("SELECT 1;", true, true)).toBe("query");
    expect(r("SELECT 'a;b'", false, true)).toBe("query");
    expect(r(multi, false, false)).toBe("query");
    expect(r(multi, true, true, false)).toBe("query");
  });

  it("방언의 렉서로 센다 — 문자열 · 주석 안의 세미콜론은 가르지 않는다", () => {
    expect(r("SELECT 1 -- ; x\n", false, true)).toBe("query");
    expect(runRoute({ text: "SELECT `a;b` FROM t; SELECT 2", dialect: "mysql", inWork: true, autoCommitOff: false, scriptSupported: true })).toBe("script");
  });
});
