// 채팅 타일 Codex 검토 카드의 순수 층 — 대상 넷의 꼴 판정 · 카드 기본값. 값 import 없음.
// 판정은 서버 `review_target` 과 같은 경계다(서버가 한 번 더 본다). Aynx 는 git 을 부르지 않는다 — 브랜치 · 커밋이 있는지는 CLI 가 판정한다.

import type { Key } from "$lib/i18n/keys";
import type { ReviewTargetWire } from "./chat-tile-api";

export type ReviewKind = ReviewTargetWire["type"];

export const REVIEW_KINDS: readonly ReviewKind[] = Object.freeze(["uncommittedChanges", "baseBranch", "commit", "custom"] as const);

export interface ReviewDraft {
  kind: ReviewKind;
  branch: string;
  sha: string;
  instructions: string;
}

const BRANCH_MAX = 200;
const INSTRUCTIONS_MAX = 4 * 1024;
const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;
const SHA_RE = /^[0-9a-fA-F]{7,64}$/;

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** 서버 `char::is_control` 과 같은 범위 — 줄바꿈(`\n` · `\r`) 밖 제어 문자 */
export function hasControl(s: string): boolean {
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0a || c === 0x0d) continue;
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** 서버 판정과 같은 꼴 — 틀리면 문구 키 · 맞으면 null */
export function reviewTargetError(t: ReviewTargetWire): Key | null {
  switch (t.type) {
    case "uncommittedChanges":
      return null;
    case "baseBranch": {
      const b = t.branch;
      const ok = typeof b === "string" && utf8Bytes(b) <= BRANCH_MAX && BRANCH_RE.test(b) && !b.includes("..") && !b.startsWith("-");
      return ok ? null : "pane.chatTile.review.err.target";
    }
    case "commit":
      return typeof t.sha === "string" && SHA_RE.test(t.sha) ? null : "pane.chatTile.review.err.target";
    case "custom": {
      const s = t.instructions;
      const ok = typeof s === "string" && s.trim() !== "" && utf8Bytes(s) <= INSTRUCTIONS_MAX && !hasControl(s);
      return ok ? null : "pane.chatTile.review.err.target";
    }
    default:
      return "pane.chatTile.review.err.target";
  }
}

/** 카드 기본값 — `/review` 뒤 글이 있으면 "직접 지시" 를 골라 그 글로 채운다 · 없으면 커밋하지 않은 변경 */
export function reviewDraft(args: string): ReviewDraft {
  const instructions = args.trim();
  return { kind: instructions !== "" ? "custom" : "uncommittedChanges", branch: "main", sha: "", instructions };
}

/** 고른 종류의 칸만 싣는다(앞뒤 빈칸은 걷는다) */
export function reviewTargetOf(d: ReviewDraft): ReviewTargetWire {
  switch (d.kind) {
    case "baseBranch":
      return { type: "baseBranch", branch: d.branch.trim() };
    case "commit":
      return { type: "commit", sha: d.sha.trim() };
    case "custom":
      return { type: "custom", instructions: d.instructions.trim() };
    default:
      return { type: "uncommittedChanges" };
  }
}

/** 그 꼴의 칸만 다시 짓는다 — 다른 열쇠가 붙어 와도 싣지 않는다 */
export function reviewWireOf(t: ReviewTargetWire): ReviewTargetWire {
  switch (t.type) {
    case "baseBranch":
      return { type: "baseBranch", branch: t.branch };
    case "commit":
      return { type: "commit", sha: t.sha };
    case "custom":
      return { type: "custom", instructions: t.instructions };
    default:
      return { type: "uncommittedChanges" };
  }
}

/** 라디오 글 */
export function reviewKindKey(kind: ReviewKind): Key {
  switch (kind) {
    case "baseBranch":
      return "pane.chatTile.review.kind.baseBranch";
    case "commit":
      return "pane.chatTile.review.kind.commit";
    case "custom":
      return "pane.chatTile.review.kind.custom";
    default:
      return "pane.chatTile.review.kind.uncommittedChanges";
  }
}
