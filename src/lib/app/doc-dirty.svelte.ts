// 저장 안 한 문서(편집 모드의 DocView)의 표 — F1(DocView)이 채우고, 닫기 가드·머리줄 ● 가 읽는다.
//
// 글 자체는 여기 없다(메모리의 편집기 상태 안에만 있다 — 계약 §0: 레이아웃 파일에 적지 않는다).
// 여기 있는 것은 "이 타일이 저장 안 한 변경을 들고 있다" 는 사실과, 그 타일의 저장 함수뿐이다.
//
// **쓰기는 반응형 값을 읽지 않는다.** 소속 판정은 평범한 표(`DirtyTable`)가 하고, `$state` 사본(`snapshot`)은
// 값이 실제로 바뀐 때만 새로 쓴다 — 그래서 `$effect` 안에서 `setDocDirty` 를 불러도 효과가 제가 쓴 값을 구독해
// 스스로를 다시 돌리지 않는다(첫 타자에 `effect_update_depth_exceeded` 가 났던 자리 — doc-dirty-table.ts 머리말).

import { DirtyTable, SaverTable } from "$lib/doc-dirty-table";

const table = new DirtyTable();
const savers = new SaverTable();
/** 반응형 사본 — 머리줄 ● · 탭 ● 가 읽는다. 표가 바뀐 때만 새 배열 */
let snapshot = $state<string[]>([]);

/** 그 타일의 저장 안 한 변경 여부를 적는다(같은 값이면 아무 일 없음 — 반응형 값을 읽지도 쓰지도 않는다). */
export function setDocDirty(paneId: string, value: boolean): void {
  if (table.set(paneId, value)) snapshot = table.list();
}

/** 지금 저장 안 한 변경이 있는가 — **반응형이 아니다**(닫기 가드 같은 한 번짜리 물음용). 그리는 쪽은 [`dirtyDocPanes`] */
export function isDocDirty(paneId: string): boolean {
  return table.has(paneId);
}

/** 저장 안 한 문서 타일 id 들 — `$state` 라 반응형으로 읽힌다. */
export function dirtyDocPanes(): string[] {
  return snapshot;
}

/** 그 타일의 DocView 가 등록한 저장 함수를 부른다. 등록이 없으면 false. */
export function requestDocSave(paneId: string): Promise<boolean> {
  return savers.request(paneId);
}

/** 저장 함수를 등록한다. 돌려준 함수로 푼다(같은 함수가 아직 등록돼 있을 때만 지운다). */
export function registerDocSaver(paneId: string, fn: () => Promise<boolean>): () => void {
  return savers.register(paneId, fn);
}
