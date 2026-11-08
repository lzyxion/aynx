/**
 * **메뉴 통로** — `docs/conventions.md` 의 "메뉴를 닫는 코드는 값을 스냅샷한 뒤에 온다"
 * 규칙의 **유일한 구현체**.
 *
 * 팝오버·컨텍스트 메뉴에서 파생된 값(`$derived` · `{@const}`)은 메뉴가 닫히는 순간 사라진다.
 * 항목 핸들러가 닫기부터 부르고 그 아래에서 파생값을 읽으면 Svelte 가 그 값을 다시 계산하며
 * `null` 을 가리켜 `Cannot read properties of null` 로 조용히 죽는다 — 메뉴는 닫히므로
 * 화면에는 "눌리긴 눌렸는데 아무 일도 안 났다" 로만 보인다
 * (docs/log/2026-09-04-ctx-menu-entry-null.md · docs/log/2026-09-05-titlebar-cleanup.md).
 *
 * 규칙은 **순서 하나**다: 스냅샷 → 닫기 → 실행. 그것을 네 곳(`SftpBrowser` · `Sidebar` ·
 * `PaneHost` · `Tabs`)이 각자 세 줄로 베껴 적고 있었고, 항목이 늘 때마다 그 세 줄을 다시
 * 적는 자리가 곧 순서가 뒤집히는 자리였다. 여기 하나만 남긴다.
 *
 * ```ts
 * onclick={() => runOnMenu(() => menu?.entry, closeMenu, revealEntry)}
 * ```
 *
 * `target` 을 **값이 아니라 함수**로 받는 것이 요점이다: 값으로 받으면 호출부의 인자
 * 계산이 이미 파생값을 읽어 버려 통로가 있으나 마나가 된다. 함수로 받으면 스냅샷을 뜨는
 * 시점이 이 파일 안으로 들어온다.
 *
 * 돌려주는 것은 없다 — 비동기 핸들러도 `void` 로 삼킨다 (메뉴 항목은 결과를 기다리지 않는다).
 */
export function runOnMenu<T>(
  target: () => T | null | undefined,
  close: () => void,
  fn: (target: T) => void | Promise<void>,
): void {
  const snapshot = target(); // 1. 스냅샷
  close(); // 2. 닫기
  if (snapshot !== null && snapshot !== undefined) void fn(snapshot); // 3. 실행
}

/**
 * 대상이 없는 메뉴 항목 — **닫고 나서 실행**만 한다 (붙여넣기·새로고침처럼 "지금 폴더"
 * 를 대상으로 하는 것들).
 *
 * 이것도 통로여야 하는 이유는 같다: 상위가 모달을 여는 항목에서 백드롭이 남아 있으면 그
 * 클릭을 가로챈다 (`Sidebar.hostMenuAction` 주석). 순서가 한 자리에 있으면 잊을 수 없다.
 */
export function runAfterClose(close: () => void, fn: () => void | Promise<void>): void {
  close();
  void fn();
}
