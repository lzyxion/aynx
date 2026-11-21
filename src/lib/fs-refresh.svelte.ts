/**
 * "저 백엔드의 목록이 낡았다" 는 신호 — 다른 곳 사이의 이동은 출발지(다른 타일)에서도 파일을 지운다.
 * 프롭이 아니라 모듈 상태다(타일 → 형제 타일). 창은 넘지 않는다 — ⟳ 한 번이면 되는 일이라 창 사이 통로를 파지 않는다.
 */

const store = $state<{ tick: number; key: string }>({ tick: 0, key: "" });

/** 새 `tick` 을 돌려준다 — 보낸 타일이 그 값을 소비 표시로 적어 두면 자기 신호에 한 번 더 읽지 않는다 */
export function notifyFsRefresh(key: string): number {
  store.tick += 1;
  store.key = key;
  return store.tick;
}

/** 룬 객체 그 자신이라 가지고 있지 말고 그 자리(`$effect` 안)에서 읽어야 한다 */
export function fsRefreshSignal(): { readonly tick: number; readonly key: string } {
  return store;
}
