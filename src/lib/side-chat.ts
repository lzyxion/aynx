// 사이드 채팅의 순수 층 — 저장 모양(`<데이터 루트>/sidechat/chats.json`) · 띄우는 모양 · 제목. 아무것도 부르지 않는다.

import { nextHistoryStreamId } from "$lib/session";
import type { SideChatCli, SideChatMode } from "$lib/side-chat-api";
import { parseTileLink, parseTileLinks, type SideChatTileLink } from "$lib/side-chat-link";

/** v1(PTY 세션) 사이드 채팅 타일의 스트림 머리 — 옛 판에서 올라온 사용자의 남은 세션을 첫 부팅이 한 번 닫는 데만 남는다. */
export const LEGACY_SIDE_CHAT_PREFIX = "sidechat-";

export interface SideChat {
  /** 그 채팅의 폴더 이름(`sidechat/<id>/`) · 세션 서버 채팅 표의 열쇠 */
  id: string;
  cli: string;
  /** 빈 값 = CLI 기본 */
  model: string;
  /** 빈 값 = CLI 기본(인자 · 칸을 싣지 않는다) */
  effort: string;
  /** 빈 값이면 첫 질문이 채운다 */
  title: string;
  createdAt: number;
  usedAt: number;
  /** v1 칸 — 그대로 적는다 */
  used: string[];
  /** CLI 별로 마지막에 안 대화 id — CLI 를 바꿔도 각자 자기 대화를 쥔다 */
  links: Record<string, string>;
  /** 서버가 잊었으면 독이 다시 건다. 옛 파일의 `tile`(하나)은 읽을 때 한 칸짜리 묶음으로 옮기고, 쓰기는 이 칸만 */
  tiles: SideChatTileLink[];
  /** 경로는 여기 없다 — 서버가 대화 색인에서 정한다 */
  forkedFrom: { agent: string; conv: string } | null;
  /** 이름표 — 보여 주기만 · 다시 보내지 않는다. 빈 값 = 채팅 자기 폴더 */
  cwd: string;
}

export interface SideChatPick {
  model: string;
  effort: string;
}

/** 옛 판(`{cli, model, effort}`)은 읽을 때 `byCli[cli]` 로 옮긴다 */
export interface SideChatLast {
  cli: string | null;
  byCli: Record<string, SideChatPick>;
}

export interface SideChatFile {
  current: string | null;
  last: SideChatLast;
  chats: SideChat[];
  /** v1 이 남긴 PTY 세션 스트림 — 부팅이 한 번 닫는다 */
  legacyStreams: string[];
}

const EMPTY: SideChatFile = { current: null, last: { cli: null, byCli: {} }, chats: [], legacyStreams: [] };

const CLI_RE = /^[a-z0-9-]{1,32}$/;

/** Rust `side_chat::id_ok` 와 같은 규칙 */
export function sideChatIdOk(id: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(id);
}

/** Rust `side_chat::event::model_ok` 와 같은 규칙 */
export function sideChatModelOk(model: string): boolean {
  return model.length <= 64 && /^[A-Za-z0-9._:[\]-]*$/.test(model);
}

/** Rust `side_chat::event::word_ok` 와 같은 규칙 */
export const sideChatEffortOk = sideChatModelOk;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sideChatConvOk(id: string): boolean {
  return UUID_RE.test(id);
}

/** 그 머리 · 모양이 아니면 닫지 않는다 */
export function legacySideChatStream(stream: unknown): stream is string {
  return typeof stream === "string" && stream.startsWith(LEGACY_SIDE_CHAT_PREFIX) && /^[A-Za-z0-9-]{1,128}$/.test(stream);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function parseChat(raw: unknown): SideChat | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!sideChatIdOk(id)) return null;
  const cli = str(o.cli, "claude");
  const model = str(o.model);
  const effort = str(o.effort);
  const links: Record<string, string> = {};
  if (o.links && typeof o.links === "object") {
    for (const [k, v] of Object.entries(o.links as Record<string, unknown>)) {
      if (typeof v === "string" && UUID_RE.test(v)) links[k] = v.toLowerCase();
    }
  }
  return {
    id,
    cli: CLI_RE.test(cli) ? cli : "claude",
    model: sideChatModelOk(model) ? model : "",
    effort: sideChatEffortOk(effort) ? effort : "",
    title: str(o.title).slice(0, 200),
    createdAt: num(o.createdAt),
    usedAt: num(o.usedAt),
    used: Array.isArray(o.used) ? o.used.filter((x): x is string => typeof x === "string") : [],
    links,
    tiles: Array.isArray(o.tiles) ? parseTileLinks(o.tiles) : parseOldTile(o.tile),
    forkedFrom: parseForkedFrom(o.forkedFrom),
    cwd: str(o.cwd).slice(0, 1024),
  };
}

function parseOldTile(raw: unknown): SideChatTileLink[] {
  const link = parseTileLink(raw);
  return link ? [link] : [];
}

function parseForkedFrom(raw: unknown): SideChat["forkedFrom"] {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const agent = str(o.agent);
  const conv = str(o.conv);
  return sideChatCliOk(agent) && UUID_RE.test(conv) ? { agent, conv: conv.toLowerCase() } : null;
}

/** 깨졌으면 빈 목록 — 이 파일이 깨져도 독은 빈 채로 선다. v1 의 `stream` 칸은 `legacyStreams` 로만 남는다 */
export function parseSideChats(raw: string | null | undefined): SideChatFile {
  const empty = (): SideChatFile => ({ ...EMPTY, chats: [], legacyStreams: [] });
  if (!raw) return empty();
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return empty();
  }
  if (!v || typeof v !== "object") return empty();
  const o = v as Record<string, unknown>;
  const seen = new Set<string>();
  const chats: SideChat[] = [];
  const legacyStreams: string[] = [];
  for (const c of Array.isArray(o.chats) ? o.chats : []) {
    const chat = parseChat(c);
    if (chat && !seen.has(chat.id)) {
      seen.add(chat.id);
      chats.push(chat);
    }
    const stream = c && typeof c === "object" ? (c as Record<string, unknown>).stream : undefined;
    if (legacySideChatStream(stream) && !legacyStreams.includes(stream)) legacyStreams.push(stream);
  }
  const current = str(o.current);
  return {
    current: chats.some((c) => c.id === current) ? current : (chats[0]?.id ?? null),
    last: parseLast(o.last),
    chats,
    legacyStreams,
  };
}

function parsePick(raw: unknown): SideChatPick {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const model = str(o.model);
  const effort = str(o.effort);
  return { model: sideChatModelOk(model) ? model : "", effort: sideChatEffortOk(effort) ? effort : "" };
}

/** 새 판(v3 `{cli, byCli}`)과 옛 판(v2 `{cli, model, effort}`)을 함께 받는다 — 둘 다 있으면 `byCli` 가 이긴다 */
function parseLast(raw: unknown): SideChatLast {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const cli = typeof o.cli === "string" && CLI_RE.test(o.cli) ? o.cli : null;
  const byCli: Record<string, SideChatPick> = {};
  if (cli && ("model" in o || "effort" in o)) {
    const old = parsePick(o);
    if (old.model !== "" || old.effort !== "") byCli[cli] = old;
  }
  if (o.byCli && typeof o.byCli === "object" && !Array.isArray(o.byCli)) {
    for (const [k, v] of Object.entries(o.byCli as Record<string, unknown>)) {
      if (CLI_RE.test(k)) byCli[k] = parsePick(v);
    }
  }
  return { cli, byCli };
}

export function sideChatPickFor(last: SideChatLast, cli: string | null | undefined): SideChatPick {
  const p = cli ? last.byCli[cli] : undefined;
  if (!p) return { model: "", effort: "" };
  return { model: sideChatModelOk(p.model) ? p.model : "", effort: sideChatEffortOk(p.effort) ? p.effort : "" };
}

export function rememberSideChatPick(last: SideChatLast, cli: string, model: string, effort: string): SideChatLast {
  if (!CLI_RE.test(cli)) return last;
  return {
    cli,
    byCli: {
      ...last.byCli,
      [cli]: { model: sideChatModelOk(model) ? model : "", effort: sideChatEffortOk(effort) ? effort : "" },
    },
  };
}

export function cloneSideChatLast(last: SideChatLast): SideChatLast {
  const byCli: Record<string, SideChatPick> = {};
  for (const [k, v] of Object.entries(last.byCli)) byCli[k] = { ...v };
  return { cli: last.cli, byCli };
}

/** 다른 CLI 로 바꾸면 강도는 그 CLI 의 기억이다 — 강도 낱말이 CLI 마다 다르다. */
export function sideChatSwitchPick(
  chat: Pick<SideChat, "cli" | "effort">,
  last: SideChatLast,
  cli: string,
  model: string,
): SideChatPick {
  const okModel = sideChatModelOk(model) ? model : "";
  if (chat.cli === cli) return { model: okModel, effort: chat.effort };
  const mem = sideChatPickFor(last, cli);
  return { model: okModel || mem.model, effort: mem.effort };
}

/** v3 판은 `stream` 칸을 쓰지 않는다. 읽기는 v2 판도 받는다 */
export function serializeSideChats(f: Pick<SideChatFile, "current" | "last" | "chats">): string {
  return JSON.stringify({ v: 3, current: f.current, last: f.last, chats: f.chats }, null, 2);
}

export function newSideChatId(): string {
  return nextHistoryStreamId().slice(0, 16);
}

export function sideChatCliOk(cli: string): cli is SideChatCli {
  return cli === "claude" || cli === "codex";
}

export function sideChatConversation(chat: Pick<SideChat, "links">, cli: string): string | null {
  const id = chat.links[cli];
  return id && UUID_RE.test(id) ? id : null;
}

export function sideChatForkFrom(chat: Pick<SideChat, "forkedFrom">, cli: string): string | null {
  const f = chat.forkedFrom;
  return f && f.agent === cli && UUID_RE.test(f.conv) ? f.conv : null;
}

/** 갈라 온 채팅의 이어 가기는 `project` — 서버가 그 대화의 기록된 폴더를 다시 찾는다. */
export function sideChatOpenMode(conversation: string | null, fork: string | null): SideChatMode {
  if (conversation) return fork ? { kind: "resume", conv: conversation, project: true } : { kind: "resume", conv: conversation };
  return fork ? { kind: "fork", from: fork } : { kind: "fresh" };
}

/** 원격 타일은 안 된다 — 그 대화가 원격 기계에 있어 이 PC 의 CLI 가 갈라 올 수 없다. */
export function sideChatForkSource(
  kind: string,
  mainWindow: boolean,
  link: { agent: string; id: string } | null | undefined,
): { agent: SideChatCli; conv: string } | null {
  if (!mainWindow || kind !== "local" || !link) return null;
  return sideChatCliOk(link.agent) && UUID_RE.test(link.id) ? { agent: link.agent, conv: link.id.toLowerCase() } : null;
}

export function sideChatForkTitle(name: string): string {
  const base = sideChatTitleFrom(name);
  return base ? `↪ ${base}` : "↪";
}

/**
 * 판정은 우리 저장(`chats.json`) 하나다 — 기록 파일의 표지(Claude `entrypoint:"sdk-cli"` · Codex `source`/`originator`)는
 * 오케스트레이션 헤드리스 턴 · 다른 SDK 도구와 겹쳐 사이드 채팅만 가려내지 못한다. 원본 대화(`forkedFrom.conv`)는 표지하지 않는다.
 */
export function sideChatConvMark(
  chats: readonly Pick<SideChat, "links" | "forkedFrom">[],
  agent: string,
  id: string,
): { forked: boolean } | null {
  const conv = id.toLowerCase();
  if (!UUID_RE.test(conv)) return null;
  for (const c of chats) {
    if (c.links[agent] !== conv) continue;
    const from = c.forkedFrom;
    if (from && from.conv === conv) continue;
    return { forked: !!from && from.agent === agent };
  }
  return null;
}

export function sideChatConvBadge(mark: { forked: boolean } | null) {
  if (!mark) return null;
  return mark.forked
    ? ({ label: "app.chatDock.convBadge.fork", title: "app.chatDock.convBadge.fork.title" } as const)
    : ({ label: "app.chatDock.convBadge", title: "app.chatDock.convBadge.title" } as const);
}

export function sideChatCwdLabel(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

export function sideChatTitleFrom(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim().replace(/\s+/g, " ") ?? "";
  const chars = [...line];
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : line;
}

export function pickSideChatCli<T extends { id: string }>(offered: readonly T[], wanted: string | null | undefined): T | null {
  return offered.find((c) => c.id === wanted) ?? offered[0] ?? null;
}

export function sideChatNewDefault<T extends { id: string }>(
  offered: readonly T[],
  last: SideChatLast,
): { cli: T; model: string; effort: string } | null {
  const cli = pickSideChatCli(offered, last.cli);
  return cli ? { cli, ...sideChatPickFor(last, cli.id) } : null;
}

/** 지어낸 이름 없음 — 지금 값(목록 밖이어도 보이게) · 설정 파일 기본 모델 · 제안 목록 순. "CLI 기본" 줄은 부르는 쪽이 맨 앞에 세운다. */
export function sideChatModelChoices(
  current: string,
  configured: string | null | undefined,
  suggestions: readonly string[],
): string[] {
  const out: string[] = [];
  for (const m of [current, configured ?? "", ...suggestions]) {
    if (m && sideChatModelOk(m) && !out.includes(m)) out.push(m);
  }
  return out;
}

/** 지어낸 값 없음 — 악수가 그 모델을 모르면 `fallback`. 빈 목록 = 그 모델은 강도를 받지 않는다 → 칩을 숨긴다. */
export function sideChatEffortChoices(
  efforts: Readonly<Record<string, readonly string[]>> | null | undefined,
  model: string,
  fallback: readonly string[],
): string[] {
  const known = efforts && Object.prototype.hasOwnProperty.call(efforts, model) ? efforts[model] : null;
  const out: string[] = [];
  for (const e of known ?? fallback) {
    if (e && sideChatEffortOk(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

export function sortSideChats<T extends Pick<SideChat, "usedAt" | "createdAt">>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => Math.max(b.usedAt, b.createdAt) - Math.max(a.usedAt, a.createdAt));
}

export type SideChatList = Pick<SideChatFile, "current" | "last" | "chats">;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 세 갈래 합치기 — 주 창 · 원격 창이 같은 `chats.json` 을 함께 고친다. 이 창이 `base` 에서 바꾼 것만 `theirs` 위에 다시 얹는다.
 * 파일에서 지워진 채팅은 이 창이 고치지 않았을 때만 뺀다(고쳤으면 살린다).
 */
export function mergeSideChats(base: SideChatList, mine: SideChatList, theirs: SideChatList): SideChatList {
  const byId = (l: SideChatList) => new Map(l.chats.map((c) => [c.id, c] as const));
  const b = byId(base);
  const m = byId(mine);
  const chats: SideChat[] = [];
  for (const t of theirs.chats) {
    const was = b.get(t.id);
    const now = m.get(t.id);
    if (was && !now) continue; // 이 창이 지웠다
    if (now && (!was || !same(now, was))) chats.push(now); // 이 창이 고쳤다(또는 같은 id 를 새로 만들었다)
    else chats.push(t);
  }
  const listed = new Set(chats.map((c) => c.id));
  for (const c of mine.chats) {
    if (listed.has(c.id)) continue;
    const was = b.get(c.id);
    // 이 창이 새로 만든 것 · 파일에서 지워졌지만 이 창이 고친 것
    if (!was || !same(c, was)) {
      chats.push(c);
      listed.add(c.id);
    }
  }
  const byCli: Record<string, SideChatPick> = {};
  for (const k of new Set([...Object.keys(theirs.last.byCli), ...Object.keys(mine.last.byCli)])) {
    const mineChanged = !same(mine.last.byCli[k], base.last.byCli[k]);
    const pick = mineChanged ? (mine.last.byCli[k] ?? theirs.last.byCli[k]) : theirs.last.byCli[k];
    if (pick) byCli[k] = { ...pick };
  }
  const cli = mine.last.cli !== base.last.cli ? mine.last.cli : theirs.last.cli;
  const wanted = mine.current !== base.current ? mine.current : theirs.current;
  const current = wanted !== null && listed.has(wanted) ? wanted : (chats[0]?.id ?? null);
  return { current, last: { cli, byCli }, chats };
}
