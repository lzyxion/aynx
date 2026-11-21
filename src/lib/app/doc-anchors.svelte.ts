/**
 * 문서 타일에 한 번 쓰고 버리는 "이 제목으로 · 이 줄로 · 편집으로" — `PaneSpec` 에 적지 않는다(명세는 배치 파일 · 창 이관에 실린다).
 * 문서 타일이 다 쓰면(또는 못 찾으면) `clear*` 로 지운다.
 */

const anchors = $state<Record<string, string>>({});
/** 1 기준 */
const lines = $state<Record<string, number>>({});
const edits = $state<Record<string, true>>({});

export function docAnchorOf(paneId: string): string | undefined {
  return anchors[paneId];
}

export function setDocAnchor(paneId: string, anchor: string): void {
  anchors[paneId] = anchor;
}

export function clearDocAnchor(paneId: string): void {
  if (paneId in anchors) delete anchors[paneId];
}

export function docLineOf(paneId: string): number | undefined {
  return lines[paneId];
}

export function setDocLine(paneId: string, line: number): void {
  lines[paneId] = line;
}

export function clearDocLine(paneId: string): void {
  if (paneId in lines) delete lines[paneId];
}

export function docEditOf(paneId: string): boolean {
  return edits[paneId] === true;
}

export function setDocEdit(paneId: string): void {
  edits[paneId] = true;
}

export function clearDocEdit(paneId: string): void {
  if (paneId in edits) delete edits[paneId];
}
