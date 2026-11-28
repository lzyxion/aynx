// 채팅 타일 화면의 순수 판정 — 모델 메뉴 줄 · 턴이 끝난 뒤 기록에 없는 부분 답 · 기록이 숨기는 `/` 명령 끼우기.

import type { TranscriptItem } from "$lib/context";
import type { LiveState } from "$lib/side-chat-live";
import { sentMatches } from "$lib/pane/ai-flip-keys";

/** 끊긴 턴에서 사람이 본 것 — 그 턴의 보낸 말(사람 글 없이 선 턴은 null)과 흘러나온 에이전트 글 */
export interface ChatTilePartial {
  userText: string | null;
  texts: string[];
  /** 턴이 끊겨 끝난 때(이 PC 시계) — 기록의 끊김 표식이 이 즈음에 적힌다 */
  at: number;
  /** 턴이 선 때 — 모르면(다시 붙은 뒤) null */
  start: number | null;
}

/** Claude `initialize` 의 `default` 는 맨 위 "CLI 기본"(빈 값) 줄과 같은 뜻 — 그 값을 고른 대화가 아니면 한 줄만 둔다 */
export function dropDefaultAlias(list: readonly string[], pick: string): string[] {
  return list.filter((m) => m !== "default" || pick === "default");
}

function sameText(a: string, b: string | null): boolean {
  return b !== null && a.trim() === b.trim();
}

/** 끊김 표식은 끊긴 그때 적힌다 — 표식과 끊긴 때의 차이가 이 안이어야 그 턴의 것이다 */
export const PARTIAL_SLACK_MS = 10_000;

/**
 * 끊긴 턴의 부분 답을 기록 쪽에 다시 끼운다 — Codex 롤아웃은 끊긴 턴의 흘러나온 글을 적지 않아, 걷기 뒤 "중단함" 만 남았다.
 * 부분 답 하나는 한 턴에만 — 끊긴 때(`at`)에 가장 가까운 끊김 표식 하나에 붙고, 그 표식의 턴이 보낸 말과 맞지 않으면 버린다(다른 턴에 붙이지 않는다).
 * 그 턴에 같은 글이 이미 있으면(Claude) 넣지 않는다. 받은 배열은 그대로 둔다.
 */
export function withPartials(items: readonly TranscriptItem[], partials: readonly ChatTilePartial[]): TranscriptItem[] {
  const out = items.slice();
  if (partials.length === 0) return out;
  const used = new Set<TranscriptItem>();
  for (const part of [...partials].sort((a, b) => a.at - b.at)) {
    let mark = -1;
    let best = Infinity;
    for (let i = 0; i < out.length; i++) {
      const it = out[i];
      if (it.role !== "interrupted" || it.at === null || used.has(it)) continue;
      if (part.start !== null && it.at < part.start - PARTIAL_SLACK_MS) continue;
      const d = Math.abs(it.at - part.at);
      if (d <= PARTIAL_SLACK_MS && d < best) {
        best = d;
        mark = i;
      }
    }
    if (mark < 0) continue;
    used.add(out[mark]);
    // 그 턴 = 앞 사람 말(또는 앞 끊김 표식) 다음부터 표식까지
    let b = mark - 1;
    while (b >= 0 && out[b].role !== "user" && out[b].role !== "interrupted") b--;
    if (part.userText !== null && (b < 0 || out[b].role !== "user" || !sentMatches(part.userText, out[b].text))) continue;
    const have = out
      .slice(b + 1, mark)
      .filter((x) => x.role === "assistant")
      .map((x) => x.text);
    const missing = part.texts.filter((t) => !have.some((h) => sameText(t, h)));
    if (missing.length === 0) continue;
    const at = out[mark].at;
    out.splice(mark, 0, ...missing.map((text): TranscriptItem => ({ role: "assistant", text, truncated: false, images: 0, tool: null, at })));
  }
  return out;
}

/** 사람이 보낸 `/` 명령의 턴 — 기록 읽기는 로컬 명령의 표식(사람 말 · 출력)을 숨긴다(대화 면과 같은 파서) */
export interface ChatTileLocal {
  userText: string;
  /** 그 턴에 흘러나온 글 — 기록에 있는 것(모델 답)은 끼울 때 뺀다 */
  texts: string[];
  /** 보낸 때(이 PC 시계) — 기록 항목의 `at` 과 같은 시계로 자리를 찾는다 */
  at: number;
}

/** 턴 끝 직전 상태에서 — 이 턴의 사람 말이 `/` 로 시작할 때만(도구가 낀 턴 · 글 없는 턴도) */
export function localCommandOf(s: LiveState, at: number): ChatTileLocal | null {
  let u = -1;
  for (let i = s.entries.length - 1; i >= 0; i--) {
    if (s.entries[i].kind === "user") {
      u = i;
      break;
    }
  }
  const user = u >= 0 ? s.entries[u] : null;
  if (!user || user.kind !== "user" || user.failed || user.n < s.endedAt || !user.text.trim().startsWith("/")) return null;
  const texts = s.entries.slice(u + 1).flatMap((e) => (e.kind === "text" && e.text.trim() !== "" ? [e.text] : []));
  return { userText: user.text, texts, at };
}

/** 기록의 사람 말 줄은 CLI 가 받은 뒤에 적힌다 — 보낸 때보다 조금 이른 시계 차이까지 같은 턴으로 본다 */
const LOCAL_SLACK_MS = 1_000;

/**
 * 기록이 숨긴 `/` 명령의 사람 말 · 출력을 보낸 때(`at`) 자리에 끼운다 — 걷기 뒤에도 사라지지 않게. 기록에서 짓지 않는다(타일이 떠 있는 동안만).
 * 조각마다 따진다: 보낸 뒤 첫 사람 말 줄이 같은 말이면(기록이 돌려준 사람 말) 말은 넣지 않고 그 줄 뒤에 기록에 없는 출력만 끼운다.
 * 그 턴의 기록에 이미 있는 글(모델 답)은 넣지 않고 본 순서대로 사이에 끼운다.
 * 쪽 경계에 걸리면: 뒤가 없으면 최신 쪽(`latest`) 끝에만, 앞이 없으면 가장 옛 쪽(`oldest`) 머리에만.
 */
export function withLocals(
  items: readonly TranscriptItem[],
  locals: readonly ChatTileLocal[],
  page: { latest: boolean; oldest: boolean },
): TranscriptItem[] {
  const out = items.slice();
  for (const l of locals) {
    const row = (role: "user" | "assistant", text: string): TranscriptItem => ({ role, text, truncated: false, images: 0, tool: null, at: l.at });
    // 받은 기록만 본다 — 앞서 끼운 로컬 명령(같은 `/context` 두 번)과 맞대지 않게
    const u = items.findIndex((x) => x.role === "user" && x.at !== null && x.at >= l.at - LOCAL_SLACK_MS);
    if (u >= 0 && sentMatches(l.userText, items[u].text)) {
      // 같은 글은 한 번만 — 기록이 돌려준 말 뒤에 이 턴의 출력만
      const once = l.texts.filter((t, i) => l.texts.findIndex((x) => sameText(x, t)) === i);
      mergeTurn(out, out.indexOf(items[u]), once, (t) => ({ ...row("assistant", t), at: items[u].at }));
      continue;
    }
    let k = out.findIndex((x) => x.at !== null && x.at > l.at);
    if (k < 0) {
      if (!page.latest) continue;
      k = out.length;
    } else if (k === 0 && !page.oldest) continue;
    out.splice(k, 0, row("user", l.userText));
    mergeTurn(out, k, l.texts, (t) => row("assistant", t));
  }
  return out;
}

/** `k` 의 사람 말 턴(다음 사람 말 전까지)과 본 순서대로 맞춰 — 기록에 있는 글은 건너뛰고 없는 글만 그 자리에 */
function mergeTurn(out: TranscriptItem[], k: number, texts: readonly string[], make: (t: string) => TranscriptItem): void {
  let end = out.findIndex((x, i) => i > k && x.role === "user");
  if (end < 0) end = out.length;
  let pos = k + 1;
  for (const t of texts) {
    let j = -1;
    for (let i = pos; i < end; i++) {
      if (out[i].role === "assistant" && sameText(t, out[i].text)) {
        j = i;
        break;
      }
    }
    if (j >= 0) pos = j + 1;
    else {
      out.splice(pos, 0, make(t));
      pos += 1;
      end += 1;
    }
  }
}

// ── 계획 · 늘 허용 흔적 — 타일이 떠 있는 동안 ──

/** 사람이 답한 Claude 계획 — 그때 카드에 보인 글 · 결과(이 창에서 친 고칠 점) */
export interface ChatTilePlanDone {
  /** 답이 닿은 때(이 PC 시계) */
  at: number;
  plan: string;
  file: string | null;
  outcome: "approved" | "kept" | "cancelled";
  feedback: string | null;
}

/** 요청 하나보다 넓게 바뀐 결정(이 대화에서 늘 허용)의 흔적 — 기록에는 남지 않는다 */
export interface ChatTileSessionTrace {
  requestId: string;
  at: number;
  allow: { kind: string; detail: string };
}

/** 기록 쪽에서 계획 덩어리로 그릴 줄 */
export function isPlanRow(it: TranscriptItem): boolean {
  if (!it.plan) return false;
  return it.role === "assistant" ? (it.text ?? "").trim() !== "" : it.role === "tool" && it.tool?.name === "ExitPlanMode";
}

/**
 * 기록의 Claude 계획 줄에 사람이 실제로 본 글 · 결과를 얹는다 — 기록은 본문을 모를 수 있다(본문 없음 = 경로 · 결과만).
 * 답한 때보다 늦지 않은 마지막 계획 줄 가운데 그 사이 사람 말이 없는 것만 맞춘다. 받은 배열은 그대로 둔다.
 */
export function withPlans(items: readonly TranscriptItem[], done: readonly ChatTilePlanDone[]): TranscriptItem[] {
  const out = items.slice();
  if (done.length === 0) return out;
  const used = new Set<number>();
  for (const p of [...done].sort((a, b) => a.at - b.at)) {
    let hit = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      const it = out[i];
      if (it.at !== null && it.at > p.at) continue;
      if (it.role === "user") break;
      if (it.role === "tool" && it.tool?.name === "ExitPlanMode" && it.plan && !used.has(i)) {
        hit = i;
        break;
      }
    }
    if (hit < 0) continue;
    used.add(hit);
    const old = out[hit].plan ?? {};
    out[hit] = {
      ...out[hit],
      plan: {
        ...old,
        body: p.plan,
        bodyTruncated: false,
        file: p.file ?? old.file,
        outcome: p.outcome === "cancelled" ? old.outcome : p.outcome,
        feedback: p.feedback ?? old.feedback,
      },
    };
  }
  return out;
}
