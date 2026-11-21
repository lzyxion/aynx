/**
 * 블록 버전 카운터 — 블록 이력(`block-history.ts`)은 비반응형이라, OSC 133 C/D 전이마다 이 값을 올려야
 * 세션 목록의 `$derived` 가 마지막 명령 · 종료 코드를 다시 읽는다.
 */
let blocksVersion = $state(0);

export function bumpBlocks(): void {
  blocksVersion++;
}

export function blocksVersionOf(): number {
  return blocksVersion;
}
