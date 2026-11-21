/**
 * 타일 권한 카드의 창 상태(docs/log/2026-11-01-tile-permission-hook.md).
 *
 * - 사건은 Rust 가 그 세션을 보는 창의 Channel 에만 보낸다 — 전역 `listen` 으로는 오지 않는다.
 * - `seq` 가 없다 — 놓친 사건은 대화 면이 서거나 세션에 다시 붙을 때 스냅숏으로 메운다.
 * - 카드 본문은 화면 메모리에만 있다(저장 · 로그 없음).
 * - 면 규칙: 그 타일을 대화 면으로 보는 창이 없으면 서버는 카드 없이 TUI 가 묻게 한다 — 그래서 면을 서버에 알린다.
 */

import { Channel, invoke } from "$lib/ipc";
import {
  applyTilePermEvent,
  applyTilePermSnapshot,
  dropTilePermCard,
  parseTilePermBody,
  parseTilePermSnapshot,
  type QuestionSummaryLine,
  type TilePermCard,
  type TilePermDecision,
  type TilePermState,
  type TilePermTrace,
} from "$lib/tile-permission";
import type { PlanAnalysis } from "$lib/operations";

let state = $state<TilePermState>({});
const deciding = $state<Record<string, true>>({});
let traces = $state<Record<string, (TilePermTrace & { id: number })[]>>({});
let traceSeq = 0;
export const TRACE_MS = 6000;

let opened: Promise<void> | null = null;

// ── 답한 질문의 요약 ──
// 이 창이 보낸 답만 담는다(서버 사건에 답 글을 싣지 않는다) — 창의 sessionStorage 에만 두고 저장소 · 서버에는 없다.

export interface QuestionSummary {
  id: string;
  stream: string;
  conversation: string | null;
  at: number;
  lines: QuestionSummaryLine[];
}

const SUMMARY_KEY = "aynx:tile-question-summaries";
const SUMMARY_CAP = 40;

function loadSummaries(): QuestionSummary[] {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(SUMMARY_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v as QuestionSummary[]).filter((x) => x && typeof x.id === "string" && Array.isArray(x.lines)) : [];
  } catch {
    return [];
  }
}

let summaries = $state<QuestionSummary[]>(loadSummaries());

export function recordQuestionSummary(card: TilePermCard, lines: QuestionSummaryLine[]): void {
  if (lines.length === 0) return;
  const s: QuestionSummary = { id: card.requestId, stream: card.stream, conversation: card.conversation, at: Date.now(), lines };
  summaries = [...summaries.filter((x) => x.id !== s.id), s].slice(-SUMMARY_CAP);
  try {
    sessionStorage.setItem(SUMMARY_KEY, JSON.stringify(summaries));
  } catch {
    // 저장이 막힌 창 — 이 페이지 동안만
  }
}

export function questionSummariesOf(stream: string, conversation: string | null): readonly QuestionSummary[] {
  const c = conversation?.toLowerCase() ?? null;
  return summaries.filter((s) => s.stream === stream && (s.conversation?.toLowerCase() ?? null) === c);
}
let tuiAsks = $state<Record<string, boolean>>({});

function setTuiAsking(stream: string, asking: boolean): void {
  if ((tuiAsks[stream] ?? false) === asking) return;
  tuiAsks = { ...tuiAsks, [stream]: asking };
}

export function tileTuiAskingOf(stream: string | null): boolean {
  return stream !== null && tuiAsks[stream] === true;
}

export function reportTileFace(stream: string, convo: boolean): void {
  void invoke<void>("tile_permission_face", { stream, convo }).catch(() => {});
}

export function onTilePermissionBody(raw: unknown): void {
  const body = parseTilePermBody(raw);
  if (!body) return;
  if (body.ev.t === "tui") {
    setTuiAsking(body.stream, body.ev.asking);
    return;
  }
  const r = applyTilePermEvent(state, body);
  state = r.state;
  if (r.trace) pushTrace(r.trace);
}

function pushTrace(trace: TilePermTrace): void {
  const id = ++traceSeq;
  const list = traces[trace.stream] ?? [];
  traces = { ...traces, [trace.stream]: [...list.slice(-2), { ...trace, id }] };
  setTimeout(() => {
    const cur = traces[trace.stream];
    if (!cur) return;
    const rest = cur.filter((x) => x.id !== id);
    if (rest.length > 0) traces = { ...traces, [trace.stream]: rest };
    else {
      const { [trace.stream]: _drop, ...others } = traces;
      traces = others;
    }
  }, TRACE_MS);
}

function ensureChannel(): Promise<void> {
  if (!opened) {
    const channel = new Channel<unknown>();
    channel.onmessage = onTilePermissionBody;
    opened = invoke<void>("tile_permission_subscribe", { channel }).catch((e: unknown) => {
      opened = null;
      throw e;
    });
  }
  return opened;
}

const pulling = new Set<string>();

export async function watchTilePermissions(stream: string): Promise<void> {
  if (pulling.has(stream)) return;
  pulling.add(stream);
  try {
    await ensureChannel();
    const snap = parseTilePermSnapshot(await invoke<unknown>("tile_permission_snapshot", { stream }));
    state = applyTilePermSnapshot(state, stream, snap);
    setTuiAsking(stream, snap.tuiAsking === true);
  } catch {
    // 옛 서버 · 하네스 스텁 없음 — 카드 없이 "터미널에서 답하기" 로 남는다
  } finally {
    pulling.delete(stream);
  }
}

export function tilePermCardsOf(stream: string | null): readonly TilePermCard[] {
  return stream === null ? [] : (state[stream]?.cards ?? []);
}

export function tilePermTracesOf(stream: string | null): readonly (TilePermTrace & { id: number })[] {
  return stream === null ? [] : (traces[stream] ?? []);
}

export function isDecidingTilePerm(requestId: string): boolean {
  return deciding[requestId] === true;
}

export type DecideResult = "applied" | "late" | "not-viewing" | { error: string };

export async function decideTilePermission(
  card: TilePermCard,
  decision: TilePermDecision,
  message?: string | null,
  answers?: Readonly<Record<string, string>> | null,
): Promise<DecideResult> {
  if (deciding[card.requestId]) return "late";
  deciding[card.requestId] = true;
  try {
    const msg = message?.trim() ? message.trim() : null;
    const r = await invoke<{ applied?: boolean }>("tile_permission_decide", {
      stream: card.stream,
      sessionEpoch: card.sessionEpoch,
      requestId: card.requestId,
      decision,
      message: msg,
      ...(decision === "answer" ? { answers: answers ?? null } : {}),
    });
    state = dropTilePermCard(state, card.stream, card.requestId);
    return r?.applied === true ? "applied" : "late";
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    // 서버 이유 코드 `[tile-permission]` 의 ASCII 갈래(언어를 타지 않는다)
    if (/\bnot-viewing\b/.test(text)) return "not-viewing";
    return { error: text };
  } finally {
    delete deciding[card.requestId];
  }
}

// ── 명령 카드의 앱 분석 ──

const analyses = $state<Record<string, PlanAnalysis | null>>({});
const analyzing = new Set<string>();

/** 아직이면 `undefined`(받으러 간다) · 못 받았으면 `null` */
export function commandAnalysisOf(requestId: string, command: string): PlanAnalysis | null | undefined {
  if (requestId in analyses) return analyses[requestId];
  if (!analyzing.has(requestId)) {
    analyzing.add(requestId);
    void invoke<PlanAnalysis>("tile_permission_analyze", { command })
      .then((a) => (analyses[requestId] = a ?? null))
      .catch(() => (analyses[requestId] = null))
      .finally(() => analyzing.delete(requestId));
  }
  return undefined;
}

// ── Codex 첫 실행 신뢰 안내 ──

const TRUST_HINT_KEY = "aynx:codex-hook-trust-hint";
let trustHintClosed = $state(readTrustHint());

function readTrustHint(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(TRUST_HINT_KEY) === "closed";
  } catch {
    return false;
  }
}

export function codexTrustHintShown(): boolean {
  return !trustHintClosed;
}

export function closeCodexTrustHint(): void {
  trustHintClosed = true;
  try {
    localStorage.setItem(TRUST_HINT_KEY, "closed");
  } catch {
    // 저장이 막힌 창 — 이 페이지 동안만 닫힌다
  }
}
