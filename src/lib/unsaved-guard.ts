/**
 * 저장 안 한 문서 글은 그 타일의 메모리에만 있다 — 타일이 사라지거나 다른 웹뷰로 옮겨지는 모든 길이 이 판정을 지난다.
 * `move-window` 는 초안을 짐에 싣지 못하면 거절한다 — 새 창은 파일을 다시 읽어 글이 조용히 사라지고, 드래그 중엔 물을 자리가 없다.
 */
export type UnsavedAction = "close" | "move-window" | "replace";

export type UnsavedVerdict =
  | { kind: "free" }
  | { kind: "ask"; paneIds: string[] }
  | { kind: "carry"; paneIds: string[] }
  | { kind: "refuse"; paneIds: string[] };

export function unsavedVerdict(
  action: UnsavedAction,
  paneIds: readonly string[],
  isDirty: (paneId: string) => boolean,
  canCarry?: (paneId: string) => boolean,
): UnsavedVerdict {
  const dirty = [...new Set(paneIds)].filter(isDirty);
  if (dirty.length === 0) return { kind: "free" };
  if (action === "close") return { kind: "ask", paneIds: dirty };
  if (action === "move-window" && canCarry) {
    const stuck = dirty.filter((id) => !canCarry(id));
    return stuck.length === 0 ? { kind: "carry", paneIds: dirty } : { kind: "refuse", paneIds: stuck };
  }
  return { kind: "refuse", paneIds: dirty };
}

export type UnsavedChoice = "save" | "discard" | "cancel";

/** 기본 이름(`Yes`/`No`)도 라벨 그대로도 받는다 — 모르는 값 · × 로 닫은 것은 취소다 */
export function choiceFromDialog(
  result: string | null | undefined,
  labels: { save: string; discard: string },
): UnsavedChoice {
  if (result === "Yes" || result === labels.save) return "save";
  if (result === "No" || result === labels.discard) return "discard";
  return "cancel";
}

/** 하나라도 저장에 실패하면 닫지 않는다 */
export function closeAfterSave(results: readonly boolean[]): boolean {
  return results.every((ok) => ok);
}
