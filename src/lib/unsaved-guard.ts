/**
 * **이 조작이 저장 안 한 글을 잃게 하는가** — 순수 판정 하나 (docs/log/2026-09-27-doc-edit.md "F2").
 *
 * 문서 편집기(`DocView` 의 편집 모드)가 들고 있는 저장 안 한 글은 **그 타일의 메모리 안에만** 있다
 * (레이아웃 파일에도 이관 짐에도 실리지 않는다 — 계약 §0). 그래서 타일이 **사라지거나 다른 웹뷰로
 * 옮겨지는** 모든 길이 이 판정을 지난다. 조작은 셋으로 접힌다:
 *
 * - `close` — 타일 닫기 · 탭 닫기 · 창 닫기. 사람이 고르게 **묻는다**(저장하고 닫기 · 버리고 닫기 · 취소).
 * - `move-window` — 새 창으로 분리 · 다른 창으로 이관. 새 창은 파일을 **다시 읽으므로**, 글을 짐에 싣지 않으면
 *   조용히 사라진다. 그래서 저장 안 한 타일마다 **초안을 실을 수 있는가**(`canCarry` — 편집기에서 글 · 커서 · 기록을
 *   떴는가, `doc-draft.ts`)를 묻는다: 모두 실을 수 있으면 `carry`(부르는 쪽이 그 초안을 짐에 싣는다), 하나라도 못 실으면
 *   **거절**한다("저장하거나 되돌린 뒤 옮기세요" — 드래그 한가운데서 대화를 띄울 자리가 없다). `canCarry` 를 주지 않으면
 *   예전처럼 거절이다.
 * - `replace` — 미리 보기 자리 갈아 끼우기(`planDocOpen` · `replaceTile`). 사람이 이 타일을 두고 한
 *   조작이 아니라 **다른 파일을 연** 것이라 묻지 않고 거절한다(부르는 쪽이 옆에 새로 세운다).
 *
 * 창 안의 이동(분할 · 탭 사이 · 탭 승격 · 병합)은 여기 오지 않는다 — 같은 웹뷰 안에서는 타일 id 가
 * 그대로라 편집기가 다시 마운트되지 않는다.
 */
export type UnsavedAction = "close" | "move-window" | "replace";

export type UnsavedVerdict =
  | { kind: "free" }
  | { kind: "ask"; paneIds: string[] }
  | { kind: "carry"; paneIds: string[] }
  | { kind: "refuse"; paneIds: string[] };

/**
 * `paneIds`(이 조작이 없애거나 옮기는 타일들) 중 저장 안 한 것이 있으면 그 조작의 답 — 없으면 `free`.
 * `canCarry` 는 `move-window` 에서만 읽는다(저장 안 한 타일마다 한 번 — 거절이면 못 실은 타일만 돌려준다).
 */
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

/** 확인 대화의 세 답 */
export type UnsavedChoice = "save" | "discard" | "cancel";

/**
 * 단추 셋 확인 상자(`app/confirm-dialog` 의 `askChoice` — 10-16 전에는 `plugin-dialog` 의 `message`)의 돌려준 값 → 답.
 *
 * 플랫폼마다 돌려주는 글자가 다르다 — 기본 이름(`Yes`/`No`/`Cancel`)일 때도, 단추에 적은 **라벨 그대로**일
 * 때도 있다(Windows 의 사용자 지정 단추). 둘 다 받는다. 모르는 값 · 창을 × 로 닫은 것은 **취소**다
 * (묻지 못한 채 닫는 쪽보다 아무 일도 안 하는 쪽이 낫다).
 */
export function choiceFromDialog(
  result: string | null | undefined,
  labels: { save: string; discard: string },
): UnsavedChoice {
  if (result === "Yes" || result === labels.save) return "save";
  if (result === "No" || result === labels.discard) return "discard";
  return "cancel";
}

/** 저장하고 닫기 — 타일마다의 저장 결과. **하나라도 실패하면 닫지 않는다.** */
export function closeAfterSave(results: readonly boolean[]): boolean {
  return results.every((ok) => ok);
}
