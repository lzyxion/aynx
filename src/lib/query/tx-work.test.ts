import { describe, expect, it } from "vitest";
import type { DbTxView } from "./query-backend";
import {
  formatClock,
  freshEnded,
  runBlocked,
  txAfterDisconnect,
  txButtons,
  txChip,
  txEndLost,
  txEndNote,
  txIdOf,
  txOpen,
  txSending,
  type TxSeen,
} from "./tx-work";

const LIMIT = 600_000;
const WARN = 60_000;

function view(over: Partial<DbTxView> = {}): DbTxView {
  return { id: 0, state: "none", statements: 0, idleLimitMs: LIMIT, warnMs: WARN, warn: false, ...over };
}

function open(over: Partial<DbTxView> = {}, at = 1_000): TxSeen {
  return { view: view({ id: 7, state: "open", statements: 3, startedAgoMs: 42_000, idleLeftMs: 300_000, ...over }), at };
}

describe("formatClock", () => {
  it("분:초 · 시간이 넘으면 시:분:초", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(42_900)).toBe("00:42");
    expect(formatClock(12 * 60_000 + 5_000)).toBe("12:05");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("txChip — 머리줄 칩", () => {
  it("작업이 없으면 칩이 없다 · 끝난 상태도 칩이 아니다", () => {
    expect(txChip(null, 0)).toBeNull();
    expect(txChip({ view: view(), at: 0 }, 0)).toBeNull();
    expect(txChip({ view: view({ state: "errorRolledBack" }), at: 0 }, 0)).toBeNull();
  });
  it("문장 수 · 흐른 시간(받은 뒤 흐른 만큼 더한다) · 남은 시간", () => {
    const c = txChip(open(), 1_000 + 3_000)!;
    expect(c.statements).toBe(3);
    expect(c.elapsed).toBe("00:45");
    expect(c.idleLeftMs).toBe(297_000);
    expect(c.warn).toBe(false);
    expect(c.ending).toBe(false);
  });
  it("남은 시간이 1분 안이면 경고 — 서버가 경고를 말해도 경고", () => {
    expect(txChip(open({ idleLeftMs: 61_000 }), 1_000 + 2_000)!.warn).toBe(true);
    expect(txChip(open({ idleLeftMs: 500_000, warn: true }), 1_000)!.warn).toBe(true);
    expect(txChip(open({ idleLeftMs: 10_000 }), 1_000 + 60_000)!.idleLeftMs).toBe(0);
  });
  it("끝내는 중이면 표시", () => {
    expect(txChip(open({ state: "ending" }), 1_000)!.ending).toBe(true);
  });
});

describe("txIdOf · txOpen — 문장 · 끝내기에 싣는 작업 id", () => {
  it("열린(끝내는 중 포함) 작업만 id, 아니면 0", () => {
    expect(txIdOf(null)).toBe(0);
    expect(txIdOf(open())).toBe(7);
    expect(txIdOf(open({ state: "ending" }))).toBe(7);
    expect(txIdOf({ view: view({ state: "unknown" }), at: 0 })).toBe(0);
    expect(txOpen({ view: view({ state: "disconnected" }), at: 0 })).toBe(false);
  });
});

describe("txButtons — 단추의 모양", () => {
  const base = { writable: true, tx: null as TxSeen | null, now: 1_000, running: false, busy: false, connected: true };
  it("쓰기 모드 · 작업 없음 → [트랜잭션 작업 시작]만", () => {
    const b = txButtons(base);
    expect(b.begin).toEqual({ shown: true, disabled: false });
    expect(b.end.shown).toBe(false);
    expect(b.extend.shown).toBe(false);
  });
  it("읽기 전용이면 시작 단추가 없다", () => {
    expect(txButtons({ ...base, writable: false }).begin.shown).toBe(false);
  });
  it("작업 중 → [커밋] · [되돌리기] · 시작 단추 숨김 · 경고 때만 [연장]", () => {
    const b = txButtons({ ...base, tx: open() });
    expect(b.begin.shown).toBe(false);
    expect(b.end).toEqual({ shown: true, disabled: false });
    expect(b.extend.shown).toBe(false);
    expect(txButtons({ ...base, tx: open({ idleLeftMs: 30_000 }) }).extend).toEqual({ shown: true, disabled: false });
  });
  it("도는 문장 · 보내는 중 · 끝내는 중 · 끊김에는 막힌다(연장은 도는 문장과 무관)", () => {
    expect(txButtons({ ...base, tx: open(), running: true }).end.disabled).toBe(true);
    expect(txButtons({ ...base, tx: open(), busy: true }).end.disabled).toBe(true);
    expect(txButtons({ ...base, tx: open({ state: "ending" }) }).end.disabled).toBe(true);
    expect(txButtons({ ...base, running: true }).begin.disabled).toBe(true);
    expect(txButtons({ ...base, connected: false }).begin.disabled).toBe(true);
    expect(txButtons({ ...base, tx: open({ idleLeftMs: 1 }), running: true }).extend.disabled).toBe(false);
  });
});

describe("끝난 작업의 알림", () => {
  it("커밋 · 되돌림은 한 줄 알림, 오류로 되돌려짐 · 결과 불명 · 끊김 · 방치 되돌림은 남는 띠", () => {
    const n = (outcome: Parameters<typeof txEndNote>[0]["outcome"]) => txEndNote({ id: 1, outcome, statements: 2 });
    expect(n("committed")).toMatchObject({ level: "notice", key: "pane.query.tx.ended.committed", statements: 2 });
    expect(n("rolledBack").level).toBe("notice");
    expect(n("errorRolledBack").level).toBe("alert");
    expect(n("unknown")).toMatchObject({ level: "alert", key: "pane.query.tx.ended.unknown" });
    expect(n("disconnected").level).toBe("alert");
    expect(n("idleRolledBack").level).toBe("alert");
    expect(txEndNote({ id: 1, outcome: "unknown", statements: 0, message: "사연" }).message).toBe("사연");
  });
  it("같은 끝난 작업은 한 번만 알린다", () => {
    const v = view({ ended: { id: 9, outcome: "committed", statements: 1 } });
    expect(freshEnded(v, null)?.id).toBe(9);
    expect(freshEnded(v, 9)).toBeNull();
    expect(freshEnded(view(), null)).toBeNull();
  });
  it("연결이 끊기면 열린 작업은 '연결 끊김' 으로 끝난다 — 끝내는 중이면 그 답을 기다린다", () => {
    const t = txAfterDisconnect(open(), 5_000)!;
    expect(t.view.state).toBe("disconnected");
    expect(t.view.ended).toEqual({ id: 7, outcome: "disconnected", statements: 3 });
    expect(txOpen(t)).toBe(false);
    const ending = open({ state: "ending" });
    expect(txAfterDisconnect(ending, 5_000)).toBe(ending);
    expect(txAfterDisconnect(null, 0)).toBeNull();
  });
});

describe("커밋 중 끊김(Codex 검토 반영 2) — 끊김 이벤트가 커밋 답보다 먼저 와도 결과 불명을 가리지 않는다", () => {
  /** 화면의 상태 기계를 흉내 낸다 — QueryView 의 txCall · 끊김 이벤트 · seeTx 와 같은 순서로 순수 함수를 부른다 */
  function machine(start: TxSeen) {
    let tx: TxSeen | null = start;
    let announced: number | null = null;
    const notes: string[] = [];
    const see = (v: DbTxView) => {
      tx = { view: v, at: 0 };
      const e = freshEnded(v, announced);
      if (e) {
        announced = e.id;
        notes.push(txEndNote(e).key);
      }
    };
    return {
      send: () => (tx = txSending(tx, 0)),
      disconnectEvent: () => {
        const next = txAfterDisconnect(tx, 0);
        if (next && next !== tx) see(next.view);
      },
      answer: (v: DbTxView) => see(v),
      lostWithoutAnswer: (commit: boolean) => {
        const next = txEndLost(tx, commit, 0);
        if (next && next !== tx) see(next.view);
      },
      get tx() {
        return tx;
      },
      notes,
    };
  }

  it("보내면 화면도 '끝내는 중' — 단추는 막히고 끊김 이벤트는 앞질러 적지 않는다", () => {
    const m = machine(open());
    m.send();
    expect(m.tx!.view.state).toBe("ending");
    expect(txIdOf(m.tx)).toBe(7);
    expect(txButtons({ writable: true, tx: m.tx, now: 0, running: false, busy: false, connected: true }).end.disabled).toBe(true);
    m.disconnectEvent();
    expect(m.tx!.view.state).toBe("ending");
    expect(m.notes).toEqual([]);
  });

  it("끊김 이벤트 → 서버의 '결과 불명' 답 — 결과 불명을 보인다(끊김 = 되돌림이 아니다)", () => {
    const m = machine(open());
    m.send();
    m.disconnectEvent();
    m.answer(view({ state: "unknown", ended: { id: 7, outcome: "unknown", statements: 3, message: "커밋을 보낸 뒤 끊김" } }));
    expect(m.tx!.view.state).toBe("unknown");
    expect(m.notes).toEqual(["pane.query.tx.ended.unknown"]);
    expect(txEndNote(m.tx!.view.ended!).level).toBe("alert");
  });

  it("끊김 이벤트 → 서버의 '커밋됨' 답 — 커밋됨을 보인다", () => {
    const m = machine(open());
    m.send();
    m.disconnectEvent();
    m.answer(view({ ended: { id: 7, outcome: "committed", statements: 3 } }));
    expect(m.notes).toEqual(["pane.query.tx.ended.committed"]);
  });

  it("답 없이 연결을 잃었다 — 커밋은 결과 불명 · 되돌리기는 끊김(서버가 되돌린다)", () => {
    const c = machine(open());
    c.send();
    c.disconnectEvent();
    c.lostWithoutAnswer(true);
    expect(c.tx!.view.state).toBe("unknown");
    expect(c.notes).toEqual(["pane.query.tx.ended.unknown"]);
    const r = machine(open());
    r.send();
    r.lostWithoutAnswer(false);
    expect(r.tx!.view.ended).toEqual({ id: 7, outcome: "disconnected", statements: 3 });
    // 끝내는 중이 아니면 손대지 않는다
    const idle = open();
    expect(txEndLost(idle, true, 0)).toBe(idle);
    expect(txSending(null, 0)).toBeNull();
  });
});

describe("실행 막기 · 작업 밖 결과 불명(Codex 검토 반영 2)", () => {
  const base = { connected: true, running: false, txBusy: false, switching: false, tx: null as TxSeen | null };
  it("작업 op 를 보낸 중 · 모드 바꾸는 중 · 끝내는 중 · 도는 중 · 끊김이면 [실행] 을 막는다", () => {
    expect(runBlocked(base)).toBe(false);
    expect(runBlocked({ ...base, tx: open() })).toBe(false);
    expect(runBlocked({ ...base, txBusy: true })).toBe(true);
    expect(runBlocked({ ...base, switching: true })).toBe(true);
    expect(runBlocked({ ...base, running: true })).toBe(true);
    expect(runBlocked({ ...base, connected: false })).toBe(true);
    expect(runBlocked({ ...base, tx: open({ state: "ending" }) })).toBe(true);
  });
  it("[트랜잭션 작업 시작] 은 쓰기 모드 · 작업 없음이면 늘(수동 커밋에서도) — 끝내는 중 · 작업 중엔 숨김", () => {
    const o = { writable: true, tx: null as TxSeen | null, now: 0, running: false, busy: false, connected: true };
    expect(txButtons(o).begin.shown).toBe(true);
    expect(txButtons({ ...o, tx: open({ state: "ending" }) }).begin.shown).toBe(false);
  });
});
