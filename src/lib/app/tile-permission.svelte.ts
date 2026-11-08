/**
 * **타일 권한 카드의 창 상태**(2026-11-01 화면 단계 — docs/log/2026-11-01-tile-permission-hook.md 10절). 순수 접기는
 * `$lib/tile-permission`, 그림은 `pane/TilePermissionCard.svelte` · `pane/AiFlip.svelte`.
 *
 * - **통로는 창마다 하나**(`tile_permission_subscribe`) — 처음 [`watchTilePermissions`] 때 건다. 사건은 Rust 가 그 세션을 보는 창의
 *   Channel 에만 보낸다(전역 `listen` 으로는 오지 않는다). 페이지가 다시 뜨면(F5 · 크래시 재부착) 모듈이 새로 떠 새 통로로 갈음한다.
 * - **`seq` 가 없다** — 놓친 사건은 스냅숏으로 메운다: 대화 면이 서거나 그 타일이 세션에 다시 붙을 때(`sessionId` 가 바뀜) 그 스트림의
 *   `tile_permission_snapshot` 을 다시 받는다.
 * - 결정([`decideTilePermission`])은 처음 하나만 먹는다 — `applied:false`(다른 창이 먼저 답했다)도 조용히 카드를 걷는다.
 * - 흔적(자동 허용 · 터미널에서 답함)은 카드 없이 대화 면 아래 한 줄로 잠깐 뜬다([`tilePermTracesOf`]).
 * - 본문은 화면 메모리에만 있다(저장 · 로그 없음).
 * - **면 규칙**(2026-11-02 사용자 승인 — 대화 면에서는 카드로, 터미널 면에서는 TUI 로): 타일마다 이 창의 지금 면을 서버에 알린다
 *   ([`reportTileFace`] — op `tile_permission_face`). 서버는 그 타일을 대화 면으로 보는 창이 없으면 카드 없이 TUI 가 묻게 하고, 그 사실을
 *   사건 `tui` 로 알린다([`tileTuiAskingOf`] — 대화 면은 입력 칸 대신 "터미널에서 답하기").
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
/** 결정을 보내는 중인 카드 */
const deciding = $state<Record<string, true>>({});
/** 흔적 — 스트림마다(잠깐) */
let traces = $state<Record<string, (TilePermTrace & { id: number })[]>>({});
let traceSeq = 0;
/** 흔적이 떠 있는 시간 */
export const TRACE_MS = 6000;

let opened: Promise<void> | null = null;

// ── 답한 질문의 요약(2026-11-02 — 질문 카드에서 [답하기]가 먹으면 대화 면 그 자리에 "답을 보냈습니다" 덩이) ─────────────────────────────
// 담는 것은 이 창이 보낸 답(사람이 고르거나 친 글) 그대로와 시각 · 스트림 · CLI 대화 id 뿐. 창의 `sessionStorage` 에 둬 F5 · 크래시 재부착 뒤에도
// 남는다(창을 닫거나 앱을 다시 켜면 사라진다 — 저장소 · 서버에는 없다). 다른 창이 답한 것은 오지 않는다(서버 사건에 답 글을 싣지 않는다).

/** 요약 하나 */
export interface QuestionSummary {
  id: string;
  stream: string;
  /** CLI 대화 id(카드의 `conversation`) — 대화 면이 지금 대화의 것만 그린다 */
  conversation: string | null;
  /** 보낸 시각(ms) — 대화 기록 사이 그 자리에 놓는 열쇠 */
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

/** 질문 카드의 답이 먹었다 — 요약을 남긴다(창 메모리 + 이 창의 sessionStorage) */
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

/** 그 타일 · 그 대화의 요약들(오래된 것부터) — 반응형. 대화 id 를 모르면 그 스트림의 대화 id 없는 것만 */
export function questionSummariesOf(stream: string, conversation: string | null): readonly QuestionSummary[] {
  const c = conversation?.toLowerCase() ?? null;
  return summaries.filter((s) => s.stream === stream && (s.conversation?.toLowerCase() ?? null) === c);
}
/** 스트림 → 그 타일의 TUI 가 묻는 중인가(면 규칙) */
let tuiAsks = $state<Record<string, boolean>>({});

function setTuiAsking(stream: string, asking: boolean): void {
  if ((tuiAsks[stream] ?? false) === asking) return;
  tuiAsks = { ...tuiAsks, [stream]: asking };
}

/** 그 타일의 TUI 가 묻는 중인가 — 반응형 */
export function tileTuiAskingOf(stream: string | null): boolean {
  return stream !== null && tuiAsks[stream] === true;
}

/**
 * **이 창이 그 타일을 지금 대화 면으로 보는가**를 서버에 알린다(면 규칙 — 서버가 카드를 세울지 TUI 로 넘길지 판정한다). 실패(옛 서버 ·
 * 하네스 스텁 없음)는 조용히 — 그 서버는 예전처럼 카드를 세운다.
 */
export function reportTileFace(stream: string, convo: boolean): void {
  void invoke<void>("tile_permission_face", { stream, convo }).catch(() => {});
}

/** 통로로 온 몸 하나 — 시험 · 하네스가 부를 수도 있다 */
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

/** 스냅숏을 받는 중인 스트림(같은 것을 겹쳐 묻지 않는다) */
const pulling = new Set<string>();

/**
 * 이 스트림의 카드를 본다 — 통로를 걸고(처음 한 번) 스냅숏으로 다시 그린다. 대화 면이 서거나 세션에 다시 붙을 때 부른다.
 * 실패(옛 서버 `[server-outdated]` · 브라우저 하네스의 스텁 없음)는 조용히 — 카드가 없으면 예전처럼 "터미널에서 답하기" 다.
 */
export async function watchTilePermissions(stream: string): Promise<void> {
  if (pulling.has(stream)) return;
  pulling.add(stream);
  try {
    await ensureChannel();
    const snap = parseTilePermSnapshot(await invoke<unknown>("tile_permission_snapshot", { stream }));
    state = applyTilePermSnapshot(state, stream, snap);
    setTuiAsking(stream, snap.tuiAsking === true);
  } catch {
    // 조용히
  } finally {
    pulling.delete(stream);
  }
}

/** 그 스트림의 선 카드들(오래된 것부터) — 반응형 */
export function tilePermCardsOf(stream: string | null): readonly TilePermCard[] {
  return stream === null ? [] : (state[stream]?.cards ?? []);
}

/** 그 스트림의 흔적들 — 반응형 */
export function tilePermTracesOf(stream: string | null): readonly (TilePermTrace & { id: number })[] {
  return stream === null ? [] : (traces[stream] ?? []);
}

export function isDecidingTilePerm(requestId: string): boolean {
  return deciding[requestId] === true;
}

export type DecideResult = "applied" | "late" | "not-viewing" | { error: string };

/**
 * 사람의 결정 — 먹었든(`applied`) 다른 창이 먼저 답했든(`late`) 카드를 걷는다(`gone` 도 곧 온다). `not-viewing`(이 창이 그 세션을 보지
 * 않는다) · 그 밖의 오류는 카드를 남기고 부른 쪽이 알린다.
 */
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
      // 질문 카드의 답(`decision: "answer"`) — 사람이 카드에서 고르거나 친 글만(2026-11-02 · 그 밖 결정에는 싣지 않는다)
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

// ── 명령 카드의 앱 분석(작업안 승인 카드와 같은 Rust `operations::analysis`) ─────────────────────

const analyses = $state<Record<string, PlanAnalysis | null>>({});
const analyzing = new Set<string>();

/** 그 카드 명령의 앱 분석 — 아직이면 `undefined`(받으러 간다) · 못 받았으면 `null`(띠 없음) */
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

// ── Codex 첫 실행 신뢰 안내(한 번 닫으면 다시 안 뜸 — 이 기기의 화면 편의라 localStorage) ─────────────

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
