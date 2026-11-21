/**
 * 프롭으로 내려보내지 않는다 — 세션을 여는 코드는 `Terminal.svelte` 의 지역 상태에 묶여 있고, 명령하는 곳은 창 전역(`+page`)이다.
 * `$state` 가 아니다 — 렌더에 쓰이지 않고 호출만 된다.
 */

export type ConnectFn = () => void;

const connects = new Map<string, ConnectFn>();

/** 해제는 내가 넣은 그 함수일 때만 지운다 — 같은 id 로 새 인스턴스가 먼저 등록한 뒤 옛 정리가 늦게 돌아도 새 등록을 지우지 않게 */
export function registerConnect(paneId: string, fn: ConnectFn): () => void {
  connects.set(paneId, fn);
  return () => {
    if (connects.get(paneId) === fn) connects.delete(paneId);
  };
}

export function connectPane(paneId: string): void {
  connects.get(paneId)?.();
}

/**
 * 복원 안내 · 시작 시 자동 재접속은 붙기 시도가 확정된 뒤에 세야 한다 — 붙은 타일을 "재연결하세요" 로 세거나, 늦게 등록된 타일을
 * 자동 연결 계단에서 빠뜨리지 않게. 약속은 등록을 먼저 마친 뒤 풀린다(부르는 쪽의 순서).
 */
const settling = new Map<string, Promise<void>>();

export function registerSettling(paneId: string, done: Promise<unknown>): void {
  const p = done.then(
    () => {},
    () => {},
  );
  settling.set(paneId, p);
  void p.then(() => {
    if (settling.get(paneId) === p) settling.delete(paneId);
  });
}

/** 그 뒤에는 결과를 모른 채 센다 — 멈춘 물음 하나가 안내를 영영 막지 않게 */
export const SETTLE_LIMIT_MS = 10_000;

export async function whenSettled(paneIds: readonly string[], limitMs = SETTLE_LIMIT_MS): Promise<void> {
  const pending = paneIds.map((id) => settling.get(id)).filter((p): p is Promise<void> => !!p);
  if (pending.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((r) => {
      timer = setTimeout(r, limitMs);
    }),
  ]);
  clearTimeout(timer);
}

export function awaitsConnect(paneId: string): boolean {
  return connects.has(paneId);
}

/** 같은 프레임에 SSH 핸드셰이크 N 개를 시작하면 sshd `MaxStartups` 에 걸려 뒤쪽 몇 개가 거절당한다 — 계단식으로 연다 */
export const RECONNECT_STAGGER_MS = 120;

export function connectStaggered(paneIds: readonly string[]): number {
  paneIds.forEach((id, i) => {
    setTimeout(() => connectPane(id), i * RECONNECT_STAGGER_MS);
  });
  return paneIds.length;
}
