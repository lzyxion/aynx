/**
 * **쿼리 타일의 쓰기 토글** — 위 띠 알약 하나의 규칙(쿼리 타일 10단계, docs/log/2026-10-12-query-tile.md). 순수(묻는 창 ·
 * 서버 호출은 주입).
 *
 * - 읽기 전용 → 쓰기: **확인 대화**(`ask`)를 지나야 켠다. 취소면 아무것도 보내지 않는다.
 * - 쓰기 → 읽기 전용: 확인 없이 끈다(안전한 쪽 — 쓰기 모드는 세 엔진 모두 사람의 트랜잭션 문장을 받지 않아(서버 `guard`
 *   머리말 2) 대개 열린 것이 없고, 가드가 못 보는 프로시저 안의 것까지 서버가 되감는다: SQLite 는 다시 열기 · MySQL 은 `ROLLBACK`).
 *   **예외 — 앱이 연 트랜잭션 작업이 열려 있으면**(1단계 — `query/tx-work`) "되돌리고 읽기 전용으로" 확인(`askRollback`)을 받는다.
 *   끄기는 늘 안전한 쪽이지만 작업의 변경을 버리므로 한 번 묻는다 — 서버(`table::set_write`)가 되돌린 뒤 끈다.
 * - 쓰기 상태는 **저장하지 않는다**(타일 명세에 없다) — 새 연결은 늘 읽기 전용이고, 재부착(`reattached`)이면 서버가 준
 *   `writable` 그대로다. 그래서 화면의 진실은 언제나 서버의 답(`set` 이 돌려준 `writable`)이다.
 * - 도는 쿼리가 있거나 · 연결이 없거나 · 전환 중이면 누를 수 없다(서버도 연결당 하나라 `Busy` 로 거절하지만 화면에서 먼저 막는다).
 */

export interface WritePill {
  writable: boolean;
  disabled: boolean;
}

/** 알약의 모양 — 연결이 없으면 읽기 전용으로 보인다(새 연결의 기본값) */
export function writePill(o: { writable: boolean | null; running: boolean; switching: boolean }): WritePill {
  return {
    writable: o.writable === true,
    disabled: o.writable === null || o.running || o.switching,
  };
}

/**
 * 한 번 누름 — 돌려주는 것은 서버가 말한 새 `writable`, 사람이 확인에서 물러섰으면 `null`. `set` 의 실패는 그대로 던진다
 * (부르는 쪽이 오류 칸 · 끊김 띠로 가른다).
 */
export async function toggleWrite(deps: {
  writable: boolean;
  ask: () => Promise<boolean>;
  set: (on: boolean) => Promise<{ writable: boolean }>;
  /** 앱이 연 트랜잭션 작업이 열려 있다(끄면 서버가 되돌린다) */
  txOpen?: boolean;
  /** "열린 트랜잭션을 되돌리고 읽기 전용으로" 확인 — `txOpen` 일 때만 묻는다 */
  askRollback?: () => Promise<boolean>;
}): Promise<boolean | null> {
  if (deps.writable) {
    if (deps.txOpen && !(await (deps.askRollback ?? (async () => false))())) return null;
    return (await deps.set(false)).writable;
  }
  if (!(await deps.ask())) return null;
  return (await deps.set(true)).writable;
}
