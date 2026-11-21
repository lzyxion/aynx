/**
 * 메뉴 통로 — `docs/conventions.md` 의 "메뉴를 닫는 코드는 값을 스냅샷한 뒤에 온다" 규칙의 유일한 구현이다.
 * 순서는 스냅샷 → 닫기 → 실행 — 닫고 나서 파생값(`$derived` · `{@const}`)을 읽으면 `null` 로 조용히 죽고 화면엔 흔적이 없다.
 * `target` 은 값이 아니라 함수로 받는다 — 값으로 받으면 호출부의 인자 계산이 이미 파생값을 읽어 통로가 소용없다.
 */
export function runOnMenu<T>(
  target: () => T | null | undefined,
  close: () => void,
  fn: (target: T) => void | Promise<void>,
): void {
  const snapshot = target();
  close();
  if (snapshot !== null && snapshot !== undefined) void fn(snapshot);
}

/** 대상 없는 항목도 닫고 나서 실행한다 — 모달을 여는 항목에서 백드롭이 남으면 그 클릭을 가로챈다 */
export function runAfterClose(close: () => void, fn: () => void | Promise<void>): void {
  close();
  void fn();
}
