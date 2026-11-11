// **창을 넘는 저장 안 한 문서의 초안** — 보내는 쪽의 "초안 뜨기" 레지스트리와 받는 쪽의 "걸어 둔 초안" 표(메모리만).
//
// 모양 · 한도 · 정화는 순수 `doc-draft.ts`. 여기는 타일 id 로 쥐는 두 표뿐이다:
//
// - **뜨기**(보내는 쪽) — 편집 중인 `DocView` 가 등록한 함수를 이관 짐을 만드는 순간(`app/tear` 의 `startTear` · `startPaneTear` —
//   동기) 부른다. 터미널 직렬화(`tear.ts` 의 `registerSerialize`)와 같은 모양. 뜰 수 없으면(편집기 로딩 중 · 등록 없음 · 글이 상한을
//   넘음) `null` 이고 부르는 쪽은 예전처럼 창 넘기기를 거절한다. 돌려주는 `still` 은 "뜬 뒤 글이 그대로인가" — 원본을 내리기
//   직전에 다시 묻는다(넘어간 글보다 새 글이 원본에 있으면 원본을 내리지 않는다). `freeze` 는 받는 창이 짐을 꺼내는 동안 편집기를
//   잠시 읽기 전용으로.
// - **걸어 둔 초안**(받는 쪽) — `restoreTab` 이 새 타일 id 로 건다. 거는 순간 그 타일은 "저장 안 한 변경 있음"(`app/doc-dirty`)이다 —
//   문서 타일이 초안을 편집기에 들이기 전에 타일 · 창을 닫아도 닫기 가드가 묻게. 지우는 때는 셋뿐이다: 편집기가 그 글로 **실제로
//   섰을 때**(`DocView` — 지연 로딩이 실패하면 지우지 않는다) · 사람이 [초안 버리기] · 타일이 닫힐 때(`app/tabs` 의 닫기 몸통).
//
// 글을 로그 · 콘솔 · 영속 파일에 남기지 않는다. 의존은 `app/doc-dirty` 하나(잎에 가깝게 — 순환을 만들지 않게).

import type { DocDraft } from "$lib/doc-draft";
import { setDocDirty } from "$lib/app/doc-dirty.svelte.js";

/** 이관 짐을 만드는 순간 뜬 초안 하나 — 원본 쪽 확인 손잡이 둘이 딸린다 */
export interface DraftCapture {
  draft: DocDraft;
  /** 뜬 뒤로 원본의 글이 그대로인가(편집기가 바뀌었거나 닫혔으면 거짓) */
  still(): boolean;
  /** 원본 편집기를 잠시 읽기 전용으로(참) · 풀기(거짓) */
  freeze(on: boolean): void;
}

const capturers = new Map<string, () => DraftCapture | null>();

/** 초안 뜨기 함수를 등록한다 — 돌려준 함수로 푼다(내가 넣은 그 함수일 때만 지운다) */
export function registerDocDraft(paneId: string, fn: () => DraftCapture | null): () => void {
  capturers.set(paneId, fn);
  return () => {
    if (capturers.get(paneId) === fn) capturers.delete(paneId);
  };
}

/**
 * 그 타일의 초안을 지금 뜬다(**동기**). 편집기가 뜨지 못하면 그 타일에 걸어 둔(아직 들이지 않은) 초안을 그대로 돌려준다 —
 * 받은 초안을 편집기에 들이기 전에 다시 옮겨도 글이 따라간다. 둘 다 없으면 `null`.
 */
export function captureDocDraft(paneId: string): DraftCapture | null {
  let got: DraftCapture | null = null;
  try {
    got = capturers.get(paneId)?.() ?? null;
  } catch {
    got = null;
  }
  if (got) return got;
  const held = pending.get(paneId);
  if (!held) return null;
  return { draft: held, still: () => pending.get(paneId) === held, freeze: () => {} };
}

// ── 받는 쪽 — 걸어 둔 초안 ─────────────────────────────────────────────────────

/** 글은 평범한 표에(큰 문자열을 반응형 프록시로 감싸지 않는다), 바뀜은 세대 하나로 알린다 */
const pending = new Map<string, DocDraft>();
let gen = $state(0);

/** 초안을 건다 — 그 순간부터 그 타일은 "저장 안 한 변경 있음" */
export function holdDocDraft(paneId: string, draft: DocDraft): void {
  pending.set(paneId, draft);
  gen++;
  setDocDirty(paneId, true);
}

/** 걸어 둔 초안(반응형으로 읽힌다) — 없으면 `undefined` */
export function pendingDocDraft(paneId: string): DocDraft | undefined {
  void gen;
  return pending.get(paneId);
}

/** 걸어 둔 초안이 있는가(반응형으로 읽힌다) */
export function hasPendingDocDraft(paneId: string): boolean {
  void gen;
  return pending.has(paneId);
}

/**
 * 초안을 내린다 — 편집기가 그 글로 섰다 · 사람이 버렸다 · 타일이 닫혔다. `expect` 를 주면 **그 초안일 때만**
 * 지운다(그사이 같은 타일에 새 초안이 걸렸으면 건드리지 않는다). 저장 안 한 표시는 여기서 지우지 않는다 —
 * 편집기가 섰으면 편집기의 더러움이, 닫혔으면 닫는 자리가 정한다.
 */
export function dropDocDraft(paneId: string, expect?: DocDraft): void {
  const cur = pending.get(paneId);
  if (!cur || (expect !== undefined && cur !== expect)) return;
  pending.delete(paneId);
  gen++;
}
