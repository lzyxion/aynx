// 저장 안 한 문서 타일의 표 — 글 자체는 여기 없다(레이아웃 파일에 적지 않는다).
// 쓰기는 반응형 값을 읽지 않는다 — `$effect` 안에서 `setDocDirty` 를 불러도 제가 쓴 값을 구독해 `effect_update_depth_exceeded` 가 나지 않게.

import { DirtyTable, SaverTable } from "$lib/doc-dirty-table";

const table = new DirtyTable();
const savers = new SaverTable();
let snapshot = $state<string[]>([]);

export function setDocDirty(paneId: string, value: boolean): void {
  if (table.set(paneId, value)) snapshot = table.list();
}

/** 반응형이 아니다(한 번짜리 물음용) — 그리는 쪽은 [`dirtyDocPanes`] */
export function isDocDirty(paneId: string): boolean {
  return table.has(paneId);
}

export function dirtyDocPanes(): string[] {
  return snapshot;
}

export function requestDocSave(paneId: string): Promise<boolean> {
  return savers.request(paneId);
}

export function registerDocSaver(paneId: string, fn: () => Promise<boolean>): () => void {
  return savers.register(paneId, fn);
}
