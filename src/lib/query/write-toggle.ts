/**
 * - 읽기 전용 → 쓰기는 확인(`ask`)을 지나야 켠다. 쓰기 → 읽기 전용은 확인 없이 끈다 — 끄기는 늘 안전한 쪽이다(가드가 못 보는
 *   프로시저 안의 것까지 서버가 되감는다).
 * - 예외: 앱이 연 트랜잭션 작업이 열려 있으면 작업의 변경을 버리므로 한 번 묻는다(`askRollback`) — 서버(`table::set_write`)가 되돌린 뒤 끈다.
 * - 쓰기 상태는 저장하지 않는다 — 새 연결은 늘 읽기 전용, 재부착이면 서버가 준 `writable` 그대로. 화면의 진실은 언제나 서버의 답이다.
 */

export interface WritePill {
  writable: boolean;
  disabled: boolean;
}

export function writePill(o: { writable: boolean | null; running: boolean; switching: boolean }): WritePill {
  return {
    writable: o.writable === true,
    disabled: o.writable === null || o.running || o.switching,
  };
}

export async function toggleWrite(deps: {
  writable: boolean;
  ask: () => Promise<boolean>;
  set: (on: boolean) => Promise<{ writable: boolean }>;
  txOpen?: boolean;
  askRollback?: () => Promise<boolean>;
}): Promise<boolean | null> {
  if (deps.writable) {
    if (deps.txOpen && !(await (deps.askRollback ?? (async () => false))())) return null;
    return (await deps.set(false)).writable;
  }
  if (!(await deps.ask())) return null;
  return (await deps.set(true)).writable;
}
