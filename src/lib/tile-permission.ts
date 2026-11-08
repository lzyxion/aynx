/**
 * **타일 권한 카드의 순수 층**(2026-11-01 화면 단계 — docs/log/2026-11-01-tile-permission-hook.md 8절 와이어 · 10절 화면).
 *
 * 로컬 AI 타일의 CLI(Claude Code · Codex TUI)가 권한을 물으면 그 프로세스에만 건 훅이 세션 서버에 카드를 세운다. 이 파일은
 * - 와이어의 꼴(카드 · 사건 · 스냅숏 — Rust `tile_permission.rs` 의 `card_of` · `gone` 의 거울),
 * - 사건 · 스냅숏 → 스트림별 카드 목록 상태(`seq` 가 없다 — F5 · 재부착 때 스냅숏으로 다시 그린다),
 * - 카드 → 도구별 본문 모델(명령 · diff · 글 · URL · 검색어 · 경로 · MCP),
 * - Edit 의 `old_string`/`new_string` 줄 diff · apply_patch 원문의 줄 갈래
 * 를 쥔다. DOM · 룬 · 사전이 없다(시험 대상 — tile-permission.test.ts). 상태는 `app/tile-permission.svelte.ts`, 그림은
 * `pane/TilePermissionCard.svelte`.
 */

import { approvalRisk, verdictOf, type Verdict } from "$lib/review-card";
import type { Operation, PlanAnalysis } from "$lib/operations";

export type TilePermCli = "claude" | "codex";
export type TilePermKind = "command" | "edit" | "write" | "notebook" | "fetch" | "search" | "read" | "patch" | "mcp" | "question" | "other";
export type TilePermDecision = "allow" | "deny" | "allowSession" | "release" | "answer";
export type TilePermGoneReason =
  | "allowed"
  | "allowed-session"
  | "denied"
  | "released"
  | "answered"
  | "terminal"
  | "hook-gone"
  | "timeout"
  | "no-viewer"
  | "session-ended";

/** 카드 한 장(Rust `card_of`). `input` 은 도구 입력 본문(잘렸을 수 있다 — `truncated`) */
export interface TilePermCard {
  requestId: string;
  stream: string;
  sessionEpoch: number;
  cli: TilePermCli;
  tool: string;
  kind: TilePermKind;
  toolUseId: string | null;
  conversation: string | null;
  input: unknown;
  truncated: boolean;
  suggestions: unknown[];
  mcpServer: { name?: string; source?: string } | null;
  cwd: string | null;
  permissionMode: string | null;
  canAllowSession: boolean;
  createdAt: number;
  deadlineAt: number;
  auto: boolean;
}

export type TilePermEv =
  | { t: "request"; card: TilePermCard }
  | { t: "gone"; requestId: string; reason: TilePermGoneReason }
  | { t: "auto"; card: TilePermCard }
  /** 그 타일의 TUI 가 묻는 중인가(면 규칙 2026-11-02 — 카드 없이 물러났거나 카드가 풀렸다) */
  | { t: "tui"; asking: boolean };

/** Channel 몸 — `windows` 는 그 순간 그 세션을 보는 창들 */
export interface TilePermBody {
  windows: string[];
  stream: string;
  sessionEpoch: number;
  ev: TilePermEv;
}

export interface TilePermSnapshot {
  sessionEpoch: number | null;
  cards: TilePermCard[];
  /** 그 타일의 TUI 가 묻는 중인가(판 24 · 옛 서버는 없음 = 거짓) */
  tuiAsking?: boolean;
}

/** 스트림마다 선 카드들(오래된 것부터) */
export type TilePermState = Readonly<Record<string, { epoch: number; cards: readonly TilePermCard[] }>>;

/** 사건이 남기는 흔적 — 대화 면 아래 잠깐 뜨는 한 줄(카드 없음) */
export type TilePermTrace = { kind: "auto" | "terminal"; stream: string; card: TilePermCard };

const KINDS: readonly TilePermKind[] = ["command", "edit", "write", "notebook", "fetch", "search", "read", "patch", "mcp", "question", "other"];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 와이어의 카드 하나를 믿을 만한 꼴로 — 칸이 틀리면 `null`(그리지 않는다) */
export function parseTilePermCard(v: unknown): TilePermCard | null {
  if (!isObj(v)) return null;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : null);
  const n = (k: string) => (typeof v[k] === "number" && Number.isFinite(v[k]) ? (v[k] as number) : null);
  const requestId = s("requestId");
  const stream = s("stream");
  const tool = s("tool");
  const epoch = n("sessionEpoch");
  const cli = s("cli");
  if (!requestId || !stream || !tool || epoch === null || (cli !== "claude" && cli !== "codex")) return null;
  const kind = (KINDS as readonly string[]).includes(s("kind") ?? "") ? (s("kind") as TilePermKind) : "other";
  return {
    requestId,
    stream,
    sessionEpoch: epoch,
    cli,
    tool,
    kind,
    toolUseId: s("toolUseId"),
    conversation: s("conversation"),
    input: v.input ?? null,
    truncated: v.truncated === true,
    suggestions: Array.isArray(v.suggestions) ? v.suggestions : [],
    mcpServer: isObj(v.mcpServer) ? (v.mcpServer as TilePermCard["mcpServer"]) : null,
    cwd: s("cwd"),
    permissionMode: s("permissionMode"),
    canAllowSession: v.canAllowSession === true,
    createdAt: n("createdAt") ?? 0,
    deadlineAt: n("deadlineAt") ?? 0,
    auto: v.auto === true,
  };
}

/** Channel 몸 → 꼴. 모르는 사건이면 `null` */
export function parseTilePermBody(raw: unknown): TilePermBody | null {
  if (!isObj(raw) || typeof raw.stream !== "string" || typeof raw.sessionEpoch !== "number" || !isObj(raw.ev)) return null;
  const windows = Array.isArray(raw.windows) ? raw.windows.filter((w): w is string => typeof w === "string") : [];
  const ev = raw.ev;
  let parsed: TilePermEv | null = null;
  if (ev.t === "request" || ev.t === "auto") {
    const card = parseTilePermCard(ev.card);
    if (card) parsed = { t: ev.t, card };
  } else if (ev.t === "tui" && typeof ev.asking === "boolean") {
    parsed = { t: "tui", asking: ev.asking };
  } else if (ev.t === "gone" && typeof ev.requestId === "string" && typeof ev.reason === "string") {
    parsed = { t: "gone", requestId: ev.requestId, reason: ev.reason as TilePermGoneReason };
  }
  return parsed ? { windows, stream: raw.stream, sessionEpoch: raw.sessionEpoch, ev: parsed } : null;
}

/**
 * 사건 하나 → 새 상태 + 흔적. `request` = 그 스트림에 카드를 세운다(새 회차면 옛 회차 카드는 버린다 · 같은 id 면 갈음) ·
 * `gone` = 치운다(`terminal` 이면 "터미널에서 답함" 흔적) · `auto` = 카드 없이 흔적만.
 */
export function applyTilePermEvent(state: TilePermState, body: TilePermBody): { state: TilePermState; trace: TilePermTrace | null } {
  const { stream, ev } = body;
  const cur = state[stream];
  if (ev.t === "tui") return { state, trace: null }; // 카드 상태와 따로(부르는 쪽이 적는다)
  if (ev.t === "auto") return { state, trace: { kind: "auto", stream, card: ev.card } };
  if (ev.t === "request") {
    const card = ev.card;
    if (cur && card.sessionEpoch < cur.epoch) return { state, trace: null };
    const keep = cur && cur.epoch === card.sessionEpoch ? cur.cards.filter((c) => c.requestId !== card.requestId) : [];
    return { state: { ...state, [stream]: { epoch: card.sessionEpoch, cards: [...keep, card] } }, trace: null };
  }
  if (!cur) return { state, trace: null };
  const gone = cur.cards.find((c) => c.requestId === ev.requestId) ?? null;
  if (!gone) return { state, trace: null };
  const cards = cur.cards.filter((c) => c.requestId !== ev.requestId);
  const next = { ...state, [stream]: { epoch: cur.epoch, cards } };
  return { state: next, trace: ev.reason === "terminal" ? { kind: "terminal", stream, card: gone } : null };
}

/** 스냅숏 → 그 스트림을 통째로 다시 그린다(보는 창이 아니면 `sessionEpoch: null` — 비운다) */
export function applyTilePermSnapshot(state: TilePermState, stream: string, snap: TilePermSnapshot): TilePermState {
  if (snap.sessionEpoch === null) {
    if (!(stream in state)) return state;
    const { [stream]: _drop, ...rest } = state;
    return rest;
  }
  const cards = snap.cards.filter((c) => c.stream === stream && c.sessionEpoch === snap.sessionEpoch && !c.auto);
  return { ...state, [stream]: { epoch: snap.sessionEpoch, cards } };
}

/** 카드 한 장을 치운다(내 결정이 먹었거나 다른 창이 먼저 답했다 — `gone` 이 곧 오지만 기다리지 않는다) */
export function dropTilePermCard(state: TilePermState, stream: string, requestId: string): TilePermState {
  const cur = state[stream];
  if (!cur || !cur.cards.some((c) => c.requestId === requestId)) return state;
  return { ...state, [stream]: { epoch: cur.epoch, cards: cur.cards.filter((c) => c.requestId !== requestId) } };
}

/** 스냅숏 몸 → 꼴 */
export function parseTilePermSnapshot(raw: unknown): TilePermSnapshot {
  if (!isObj(raw)) return { sessionEpoch: null, cards: [], tuiAsking: false };
  const epoch = typeof raw.sessionEpoch === "number" ? raw.sessionEpoch : null;
  const cards = Array.isArray(raw.cards) ? raw.cards.map(parseTilePermCard).filter((c): c is TilePermCard => c !== null) : [];
  return { sessionEpoch: epoch, cards, tuiAsking: raw.tuiAsking === true };
}

// ── 도구별 본문 ───────────────────────────────────────────────────────────────

/** diff 한 줄 — `hunk` 는 apply_patch 의 머리(`*** Update File:` · `@@`) · `gap` 은 MultiEdit 조각 사이 */
export interface DiffRow {
  op: " " | "-" | "+" | "hunk" | "gap";
  text: string;
}

export type CardBody =
  | { kind: "command"; description: string | null; command: string }
  | { kind: "diff"; path: string | null; rows: DiffRow[]; files: string[] }
  | { kind: "text"; path: string | null; text: string; lines: number; meta: string | null }
  | { kind: "fetch"; url: string; prompt: string | null }
  | { kind: "search"; query: string }
  | { kind: "read"; path: string }
  | { kind: "mcp"; server: string; tool: string; args: string }
  | { kind: "question"; questions: CardQuestion[]; answerable: boolean }
  | { kind: "other"; tool: string; args: string };

// ── 질문 카드(2026-11-02 — Claude `AskUserQuestion` · 실측 7절) ─────────────────────────────────────

/** 질문 하나 — `options` 의 이름이 곧 답 글자 */
export interface CardQuestion {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: { label: string; description: string | null }[];
}

/** 질문 하나에 사람이 고른 것 — 선택지 이름들 · 직접 쓴 글(`other` — 비면 없음) */
export interface QuestionPick {
  labels: readonly string[];
  other: string;
}

/** 입력 → 질문들(모양이 틀린 질문은 버린다) */
export function cardQuestions(input: unknown): CardQuestion[] {
  if (!isObj(input) || !Array.isArray(input.questions)) return [];
  const out: CardQuestion[] = [];
  for (const q of input.questions) {
    const question = str(q, "question");
    if (!question) continue;
    const opts = isObj(q) && Array.isArray(q.options) ? q.options : [];
    out.push({
      question,
      header: str(q, "header"),
      multiSelect: isObj(q) && q.multiSelect === true,
      options: opts
        .map((o) => ({ label: str(o, "label") ?? "", description: str(o, "description") }))
        .filter((o) => o.label !== ""),
    });
  }
  return out;
}

/** 답 글자 하나 — 하나 고르기 = 그 이름(직접 쓴 글이 있으면 그 글) · 여러 개 = 이름들 + 직접 쓴 글을 `, ` 로(Claude TUI 와 같은 꼴 · 실측) */
export function answerText(q: Pick<CardQuestion, "multiSelect">, pick: QuestionPick | undefined): string {
  if (!pick) return "";
  const other = pick.other.trim();
  if (!q.multiSelect) return other !== "" ? other : (pick.labels[0] ?? "");
  return [...pick.labels, ...(other !== "" ? [other] : [])].join(", ");
}

/**
 * 고른 것 → 서버로 보낼 `answers`(질문 글 → 답) — 모든 질문에 답이 있어야 한다(아니면 `null` — [답하기]를 막는다). 선택지 이름은 그 질문의
 * 선택지에 있는 것만 싣는다(사람이 고른 것뿐).
 */
export function cardAnswers(questions: readonly CardQuestion[], picks: Readonly<Record<string, QuestionPick>>): Record<string, string> | null {
  if (questions.length === 0) return null;
  const out: Record<string, string> = {};
  for (const q of questions) {
    const p = picks[q.question];
    const known = p ? p.labels.filter((l) => q.options.some((o) => o.label === l)) : [];
    const text = answerText(q, p ? { labels: known, other: p.other } : undefined);
    if (text.trim() === "") return null;
    out[q.question] = text;
  }
  return out;
}

/** 그 질문에 답이 있는가 — 그 질문의 선택지에 있는 이름 또는 직접 쓴 글(한 장씩 넘기는 카드의 [다음] · 단계 막대) */
export function questionAnswered(q: CardQuestion, pick: QuestionPick | undefined): boolean {
  if (!pick) return false;
  const known = pick.labels.filter((l) => q.options.some((o) => o.label === l));
  return answerText(q, { labels: known, other: pick.other }).trim() !== "";
}

/** 아직 답하지 않은 질문의 번호(1부터) — [답하기] 옆 안내 */
export function missingQuestions(questions: readonly CardQuestion[], picks: Readonly<Record<string, QuestionPick>>): number[] {
  return questions.flatMap((q, i) => (questionAnswered(q, picks[q.question]) ? [] : [i + 1]));
}

/** 답한 뒤 남기는 요약 한 줄 — 머리(없으면 `Q<n>` — 질문이 하나면 빈 글)와 보낸 답 그대로 */
export interface QuestionSummaryLine {
  header: string;
  answer: string;
}

/** 보낸 `answers`(질문 글 → 답) → 요약 줄들 — 질문 순서대로. 사람이 고르거나 친 답만(보낸 것 그대로) */
export function questionSummary(questions: readonly CardQuestion[], answers: Readonly<Record<string, string>>): QuestionSummaryLine[] {
  return questions
    .filter((q) => typeof answers[q.question] === "string")
    .map((q, i) => ({ header: q.header?.trim() || (questions.length > 1 ? `Q${i + 1}` : ""), answer: answers[q.question] }));
}

/** 하나 고르기 질문의 선택지를 눌렀다 · 여러 개면 켜고 끈다 — 다음 고른 것(순수) */
export function togglePick(q: Pick<CardQuestion, "multiSelect" | "options">, pick: QuestionPick | undefined, label: string): QuestionPick {
  const cur = pick ?? { labels: [], other: "" };
  if (!q.multiSelect) return { labels: [label], other: "" };
  const on = cur.labels.includes(label);
  // 여러 개 고르기는 선택지 순서를 지킨다(답 글자의 순서)
  const labels = q.options.map((o) => o.label).filter((l) => (l === label ? !on : cur.labels.includes(l)));
  return { labels, other: cur.other };
}

function str(o: unknown, k: string): string | null {
  return isObj(o) && typeof o[k] === "string" ? (o[k] as string) : null;
}

/** 입력 JSON 보기 — 2칸 들여쓰기(빈 객체면 빈 글) */
export function prettyJson(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (isObj(v) && Object.keys(v).length === 0) return "";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** `mcp__<서버>__<도구>` → 서버 · 도구(서버 이름은 Claude 의 `mcpServer.name` 이 있으면 그것) */
export function mcpNames(tool: string, server: TilePermCard["mcpServer"]): { server: string; tool: string } {
  const rest = tool.startsWith("mcp__") ? tool.slice(5) : tool;
  const i = rest.indexOf("__");
  const fromName = i >= 0 ? rest.slice(0, i) : rest;
  const name = i >= 0 ? rest.slice(i + 2) : "";
  return { server: server?.name?.trim() || fromName, tool: name || rest };
}

/** 줄 diff 의 상한 — 넘으면 앞뒤를 통째로 지우기 · 넣기로(훅 본문은 이미 2 K 글자로 잘려 온다) */
const DIFF_MAX_LINES = 400;

function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * **두 글의 줄 diff**(Edit 의 `old_string` → `new_string`) — 최장 공통 부분열. 파일의 앞뒤 줄(문맥)은 훅에 없어 그리지 않는다 —
 * 조각만의 diff 다. 순수.
 */
export function lineDiff(before: string, after: string): DiffRow[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return [...a.map((text) => ({ op: "-" as const, text })), ...b.map((text) => ({ op: "+" as const, text }))];
  }
  // 앞뒤 같은 줄은 표 없이 걷는다
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const n = am.length;
  const m = bm.length;
  // lcs[i][j] = am[i..] · bm[j..] 의 공통 길이
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = am[i] === bm[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const mid: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (am[i] === bm[j]) {
      mid.push({ op: " ", text: am[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      mid.push({ op: "-", text: am[i++] });
    } else {
      mid.push({ op: "+", text: bm[j++] });
    }
  }
  while (i < n) mid.push({ op: "-", text: am[i++] });
  while (j < m) mid.push({ op: "+", text: bm[j++] });
  return [
    ...a.slice(0, head).map((text) => ({ op: " " as const, text })),
    ...mid,
    ...a.slice(a.length - tail).map((text) => ({ op: " " as const, text })),
  ];
}

const PATCH_FILE = ["*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:"];

/** apply_patch 원문의 파일 경로들(Rust `patch_files` 와 같은 규칙 — 정렬 · 중복 없음) */
export function patchFiles(patch: string): string[] {
  const out = new Set<string>();
  for (const l of patch.replace(/\r\n/g, "\n").split("\n")) {
    const p = PATCH_FILE.find((x) => l.startsWith(x));
    const f = p ? l.slice(p.length).trim() : "";
    if (f) out.add(f);
  }
  return [...out].sort();
}

/** apply_patch 원문 → 줄 갈래(`*** Begin/End Patch` 는 걷는다) */
export function patchRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const l of splitLines(patch)) {
    if (l === "*** Begin Patch" || l === "*** End Patch" || l === "*** End of File") continue;
    if (l.startsWith("*** ") || l.startsWith("@@")) rows.push({ op: "hunk", text: l });
    else if (l.startsWith("+")) rows.push({ op: "+", text: l.slice(1) });
    else if (l.startsWith("-")) rows.push({ op: "-", text: l.slice(1) });
    else rows.push({ op: " ", text: l.startsWith(" ") ? l.slice(1) : l });
  }
  return rows;
}

/** 카드 → 도구별 본문 모델 */
export function cardBody(card: TilePermCard): CardBody {
  const input = card.input;
  switch (card.kind) {
    case "command":
      return { kind: "command", description: str(input, "description")?.trim() || null, command: str(input, "command") ?? prettyJson(input) };
    case "edit": {
      const path = str(input, "file_path");
      const edits = isObj(input) && Array.isArray(input.edits) ? input.edits : [input];
      const rows: DiffRow[] = [];
      edits.forEach((e, k) => {
        if (k > 0) rows.push({ op: "gap", text: "" });
        rows.push(...lineDiff(str(e, "old_string") ?? "", str(e, "new_string") ?? ""));
      });
      return { kind: "diff", path, rows, files: path ? [path] : [] };
    }
    case "patch": {
      const raw = str(input, "command") ?? str(input, "patch") ?? "";
      const files = patchFiles(raw);
      return { kind: "diff", path: files.length === 1 ? files[0] : null, rows: patchRows(raw), files };
    }
    case "write": {
      const text = str(input, "content") ?? "";
      return { kind: "text", path: str(input, "file_path"), text, lines: splitLines(text).length, meta: null };
    }
    case "notebook": {
      const text = str(input, "new_source") ?? "";
      const cell = str(input, "cell_id");
      const mode = str(input, "edit_mode");
      const meta = [cell ? `cell ${cell}` : null, mode].filter(Boolean).join(" · ") || null;
      return { kind: "text", path: str(input, "notebook_path"), text, lines: splitLines(text).length, meta };
    }
    case "fetch":
      return { kind: "fetch", url: str(input, "url") ?? "", prompt: str(input, "prompt")?.trim() || null };
    case "search": {
      const q = str(input, "query") ?? (isObj(input) && Array.isArray(input.search_query) ? str(input.search_query[0], "q") : null);
      return { kind: "search", query: q ?? prettyJson(input) };
    }
    case "read":
      return { kind: "read", path: str(input, "file_path") ?? str(input, "path") ?? str(input, "pattern") ?? prettyJson(input) };
    case "mcp": {
      const n = mcpNames(card.tool, card.mcpServer);
      return { kind: "mcp", server: n.server, tool: n.tool, args: prettyJson(input) };
    }
    case "question": {
      // Codex `request_user_input` 은 하나 고르기만(여러 개 없음 · "None of the above" 는 직접 입력 칸 — 2026-11-02 A안)
      const codex = card.cli === "codex";
      const questions = cardQuestions(input).map((q) => (codex ? { ...q, multiSelect: false } : q));
      // 답 길(서버 `answer_output` 과 같은 조건) — Claude `AskUserQuestion` · Codex `request_user_input` 의 잘리지 않은 입력. 아니면 질문만 보이고 [터미널에서 답하기]
      const pair = (card.cli === "claude" && card.tool === "AskUserQuestion") || (codex && card.tool === "request_user_input");
      return { kind: "question", questions, answerable: pair && !card.truncated && questions.length > 0 };
    }
    default:
      return { kind: "other", tool: card.tool, args: prettyJson(input) };
  }
}

/** 한 줄 요약 — 자동 허용 · 터미널에서 답함 흔적에 붙는 대상(80자) */
export function cardTarget(card: TilePermCard): string {
  const b = cardBody(card);
  let s: string;
  switch (b.kind) {
    case "command":
      s = b.command.split(/\r?\n/)[0] ?? "";
      break;
    case "diff":
      s = b.path ?? b.files.join(", ");
      break;
    case "text":
      s = b.path ?? "";
      break;
    case "fetch":
      s = b.url;
      break;
    case "search":
      s = b.query;
      break;
    case "read":
      s = b.path;
      break;
    case "mcp":
      s = `${b.server} · ${b.tool}`;
      break;
    case "question":
      s = b.questions[0]?.question ?? "";
      break;
    default:
      s = "";
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

/**
 * **명령 카드의 판결 띠** — 작업안 승인 카드와 같은 판정(`verdictOf` · `approvalRisk` — Rust 분석 그대로 · 새 판정 없음). AI 의 효과
 * 선언이 없는 자리라 "· AI 설명과 일치" 는 붙지 않는다.
 */
export function commandVerdict(command: string, analysis: PlanAnalysis): Verdict {
  const op = { command, analysis, effect: null, mismatch: false, db: null } as unknown as Operation;
  return verdictOf(op, approvalRisk(op));
}

/** 남은 초(0 이하면 0) — 1분 안쪽에서만 화면에 보인다 */
export function secondsLeft(card: Pick<TilePermCard, "deadlineAt">, now: number): number {
  return Math.max(0, Math.ceil((card.deadlineAt - now) / 1000));
}

/** 남은 시간을 보일까 — 1분 안쪽만(군더더기 없이) */
export const SHOW_LEFT_UNDER_S = 60;
