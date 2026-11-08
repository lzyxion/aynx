/**
 * **블록 버전 카운터** — 세션 목록을 그리는 화면들이 마지막 명령·종료 코드를 같은 프레임에 다시 읽게 하는 칸 하나.
 *
 * 파일 이름의 `console` 은 관리뷰 → 대시보드 시절의 이름이다. 그 화면(캔버스를 덮던 전체 화면 대시보드)은
 * 2026-10-07 에 **세션 목록 판**(캔버스 위쪽에서 내려옴 · `app/session-sheet.svelte.ts`)와 **작업안 타일**
 * (`kind:"plans"` · `app/plans.svelte.ts`)로 나뉘어 없어졌고, 여닫기 상태 · 칸 · 딥링크도 함께 걷혔다. 남은 것은
 * 아래 카운터뿐이다 — 부르는 쪽(`tabs.svelte.ts` · `console/window-rows.ts` · `app/history.svelte.ts`)이 여럿이라
 * 자리를 옮기지 않았다.
 *
 * **이 모듈은 아무것도 import 하지 않는다**(잎) — `tabs.svelte.ts` 가 [`bumpBlocks`] 를 값으로 불러도 순환이
 * 생기지 않는다 (`npm run check:cycles`).
 */

/**
 * **블록 버전 카운터** — OSC 133 status 전이(C/D)마다 한 칸 오른다
 * (`tabs.svelte.ts` 의 `noteStatus` 가 [`bumpBlocks`] 로 한 줄 올린다).
 *
 * status·연결은 이미 반응형(`paneStatus`·`paneSessions` `$state`)이라 세션 목록의 `$derived` 가
 * 저절로 따라간다. 그런데 **마지막 명령·종료 코드**는 블록 이력(`block-history.ts`)에 있고
 * 그 모듈은 순수(비반응형)라, 값이 바뀌어도 derived 가 다시 읽을 계기가 없다. 다행히 블록은
 * status 가 바뀌는 **바로 그 시점**(C·D)에 바뀌므로, 그 전이에 이 카운터를 함께 올리고
 * derived 가 이 값을 읽으면 블록도 같은 프레임에 따라 갱신된다.
 */
let blocksVersion = $state(0);

/** status 전이 때 한 줄 — 블록 재조회를 세션 목록 derived 에 알린다 */
export function bumpBlocks(): void {
  blocksVersion++;
}

/** 세션 목록 derived 가 읽는 블록 버전 (읽는 것만으로 의존성이 걸린다) */
export function blocksVersionOf(): number {
  return blocksVersion;
}
