// 창을 넘는 저장 안 한 문서의 초안(메모리만) — 글을 로그 · 콘솔 · 영속 파일에 남기지 않는다.

import type { DocDraft } from "$lib/doc-draft";
import { setDocDirty } from "$lib/app/doc-dirty.svelte.js";

export interface DraftCapture {
  draft: DocDraft;
  /** 원본을 내리기 직전에 다시 묻는다 — 넘어간 글보다 새 글이 원본에 있으면 원본을 내리지 않는다 */
  still(): boolean;
  /** 받는 창이 짐을 꺼내는 동안 원본 편집기를 읽기 전용으로 */
  freeze(on: boolean): void;
}

const capturers = new Map<string, () => DraftCapture | null>();

export function registerDocDraft(paneId: string, fn: () => DraftCapture | null): () => void {
  capturers.set(paneId, fn);
  return () => {
    if (capturers.get(paneId) === fn) capturers.delete(paneId);
  };
}

/** 동기여야 한다(이관 짐을 만드는 순간 부른다) — 편집기가 뜨지 못하면 아직 들이지 않은 걸어 둔 초안을 돌려준다 */
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

/** 큰 문자열을 반응형 프록시로 감싸지 않는다 — 바뀜은 세대 하나로 알린다 */
const pending = new Map<string, DocDraft>();
let gen = $state(0);

/** 거는 순간 "저장 안 한 변경 있음" — 편집기에 들이기 전에 닫아도 닫기 가드가 묻게 */
export function holdDocDraft(paneId: string, draft: DocDraft): void {
  pending.set(paneId, draft);
  gen++;
  setDocDirty(paneId, true);
}

export function pendingDocDraft(paneId: string): DocDraft | undefined {
  void gen;
  return pending.get(paneId);
}

export function hasPendingDocDraft(paneId: string): boolean {
  void gen;
  return pending.has(paneId);
}

/** 저장 안 한 표시는 여기서 지우지 않는다 — 편집기가 섰으면 편집기가, 닫혔으면 닫는 자리가 정한다 */
export function dropDocDraft(paneId: string, expect?: DocDraft): void {
  const cur = pending.get(paneId);
  if (!cur || (expect !== undefined && cur !== expect)) return;
  pending.delete(paneId);
  gen++;
}
