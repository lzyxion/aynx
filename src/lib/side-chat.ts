// **사이드 채팅의 순수 층** (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md 구현 순서 2 · v2 4단계) — 저장 모양 · 띄우는 모양 · 제목.
// 채팅 목록 상태는 `app/side-chats.svelte.ts`, 프로세스 · 지금 턴은 `app/side-chat-live.svelte.ts`, 그림은 `ChatDock.svelte`.
// 이 파일은 아무것도 부르지 않는다(채팅 id 난수만 `session` 에서).

import { nextHistoryStreamId } from "$lib/session";
import type { SideChatCli, SideChatMode } from "$lib/side-chat-api";
import { parseTileLink, type SideChatTileLink } from "$lib/side-chat-link";

/**
 * **v1 사이드 채팅 타일의 스트림 머리**(PTY 세션 — v2 에서 걷었다). v2 첫 부팅이 저장의 `stream` 칸 · 떨어진 세션 목록에서 이 머리의
 * 세션을 한 번 닫는다(설계 6절 — [`legacySideChatStream`]). Rust 쪽 같은 머리 판정(`tile_env`)은 7단계에 걷었다 — 이 옮기기만 남는다(옛 판에서 올라온 사용자).
 */
export const LEGACY_SIDE_CHAT_PREFIX = "sidechat-";

/** 저장되는 채팅 하나 — `<데이터 루트>/sidechat/chats.json` 의 한 줄 */
export interface SideChat {
  /** 안정 id — 그 채팅의 폴더 이름(`sidechat/<id>/` · Rust `side_chat::id_ok`) · 세션 서버 채팅 표의 열쇠 */
  id: string;
  /** AI CLI id(`claude` · `codex`) */
  cli: string;
  /** 모델 — 빈 값 = CLI 기본 */
  model: string;
  /** 추론 강도 — 빈 값 = CLI 기본(인자 · 칸을 싣지 않는다) */
  effort: string;
  /** 보이는 이름 — 빈 값이면 첫 질문이 채운다(그 전엔 "새 채팅") */
  title: string;
  createdAt: number;
  /** 마지막으로 보낸 시각(목록 정렬 · 시각 표시) */
  usedAt: number;
  /** 이 채팅에서 대화를 시작한 CLI 들(v1 칸 — 그대로 적는다) */
  used: string[];
  /** CLI 별로 마지막에 안 대화 id — 있으면 그 대화를 이어 간다(`resume`). CLI 를 바꿔도 각자 자기 대화를 쥔다 */
  links: Record<string, string>;
  /** **연결 칩**(5단계) — 이 채팅이 MCP 로 읽을 타일(없으면 `null`). 다시 붙을 때(서버가 잊었으면) 독이 다시 건다 */
  tile: SideChatTileLink | null;
  /**
   * **갈라 온 원본**(6단계 "타일 대화 이어 가기") — 그 타일의 에이전트 · 대화 id(없으면 `null`). 그 CLI 로 열 때 첫 띄우기는 이 대화에서
   * 갈라 오고(`fork`), 턴이 선 뒤에는 `links[agent]` 의 새 대화를 그 폴더에서 잇는다(`resume{project}`). 경로는 여기 없다 — 서버가 색인에서 정한다
   */
  forkedFrom: { agent: string; conv: string } | null;
  /** CLI 가 도는 폴더의 **이름표**(서버 스냅숏의 `cwd` — 보여 주기만 · 다시 보내지 않는다). 빈 값 = 채팅 자기 폴더 */
  cwd: string;
}

/** CLI 하나의 마지막 모델 · 강도(빈 값 = CLI 기본) */
export interface SideChatPick {
  model: string;
  effort: string;
}

/**
 * **마지막 선택**(2026-11-01 — CLI 마다) — `cli` = 마지막에 쓴 CLI(새 채팅의 기본), `byCli` = CLI 마다 마지막에 고른 모델 · 강도.
 * Claude 에서 Codex 로 갔다 와도 Claude 의 모델 · 강도가 남는다. 옛 판(`{cli, model, effort}`)은 읽을 때 `byCli[cli]` 로 옮긴다
 */
export interface SideChatLast {
  cli: string | null;
  byCli: Record<string, SideChatPick>;
}

export interface SideChatFile {
  /** 지금 고른 채팅 */
  current: string | null;
  /** 새 채팅의 기본 — 마지막에 쓴 CLI · CLI 마다 모델 · 강도 */
  last: SideChatLast;
  chats: SideChat[];
  /** v1 이 남긴 PTY 세션 스트림(읽고 버린 `stream` 칸) — 부팅이 한 번 닫는다 */
  legacyStreams: string[];
}

const EMPTY: SideChatFile = { current: null, last: { cli: null, byCli: {} }, chats: [], legacyStreams: [] };

/** CLI id 모양(저장 칸 · `byCli` 열쇠) */
const CLI_RE = /^[a-z0-9-]{1,32}$/;

/** 채팅 id 모양 — Rust `side_chat::id_ok` 와 같은 규칙(영숫자 · `-` · 1..=64) */
export function sideChatIdOk(id: string): boolean {
  return /^[A-Za-z0-9-]{1,64}$/.test(id);
}

/** 모델 값 모양 — Rust `side_chat::event::model_ok`(빈 값 = CLI 기본 · 영숫자 `. _ : [ ] -` · 64자) */
export function sideChatModelOk(model: string): boolean {
  return model.length <= 64 && /^[A-Za-z0-9._:[\]-]*$/.test(model);
}

/** 강도 값 모양 — 모델과 같은 낱말 규칙(Rust `side_chat::event::word_ok` · 빈 값 = CLI 기본) */
export const sideChatEffortOk = sideChatModelOk;

/** UUID 모양(대화 id) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sideChatConvOk(id: string): boolean {
  return UUID_RE.test(id);
}

/** v1 의 스트림 칸이 그 머리 · 모양인가 — 아니면 닫지 않는다 */
export function legacySideChatStream(stream: unknown): stream is string {
  return typeof stream === "string" && stream.startsWith(LEGACY_SIDE_CHAT_PREFIX) && /^[A-Za-z0-9-]{1,128}$/.test(stream);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 채팅 하나 — 모양이 틀린 칸은 버리고, id 가 틀리면 줄째 버린다 */
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
    tile: parseTileLink(o.tile),
    forkedFrom: parseForkedFrom(o.forkedFrom),
    cwd: str(o.cwd).slice(0, 1024),
  };
}

/** 저장의 `forkedFrom` — 아는 CLI · UUID 대화 id 만(틀리면 갈라 오기 없음) */
function parseForkedFrom(raw: unknown): SideChat["forkedFrom"] {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const agent = str(o.agent);
  const conv = str(o.conv);
  return sideChatCliOk(agent) && UUID_RE.test(conv) ? { agent, conv: conv.toLowerCase() } : null;
}

/** 저장 파일 → 모양. 없거나 깨졌으면 빈 목록(이 파일이 깨져도 독은 빈 채로 선다). v1 의 `stream` 칸은 `legacyStreams` 로만 남는다 */
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

/** 모델 · 강도 한 쌍 — 모양이 틀린 칸은 빈 값(CLI 기본) */
function parsePick(raw: unknown): SideChatPick {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const model = str(o.model);
  const effort = str(o.effort);
  return { model: sideChatModelOk(model) ? model : "", effort: sideChatEffortOk(effort) ? effort : "" };
}

/**
 * 저장의 `last` — 새 판(v3 `{cli, byCli}`)이면 CLI 마다, 옛 판(v2 `{cli, model, effort}`)이면 그 한 쌍을 `byCli[cli]` 로 옮긴다.
 * 열쇠 · 값 모양이 틀린 것은 버린다. 둘 다 있으면 `byCli` 가 이긴다
 */
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

/** 그 CLI 의 마지막 모델 · 강도(모르면 빈 값 = CLI 기본) — 새 채팅 · CLI 바꾸기의 기본. **순수** */
export function sideChatPickFor(last: SideChatLast, cli: string | null | undefined): SideChatPick {
  const p = cli ? last.byCli[cli] : undefined;
  if (!p) return { model: "", effort: "" };
  return { model: sideChatModelOk(p.model) ? p.model : "", effort: sideChatEffortOk(p.effort) ? p.effort : "" };
}

/** 그 CLI 로 모델 · 강도를 썼다 — 마지막 CLI 를 그것으로, 그 CLI 의 한 쌍만 바꾼 새 값(다른 CLI 의 기억은 그대로). **순수** */
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

/** `last` 의 깊은 사본 */
export function cloneSideChatLast(last: SideChatLast): SideChatLast {
  const byCli: Record<string, SideChatPick> = {};
  for (const [k, v] of Object.entries(last.byCli)) byCli[k] = { ...v };
  return { cli: last.cli, byCli };
}

/**
 * 채팅이 CLI 를 바꿀 때의 모델 · 강도 — 같은 CLI 면 받은 모델 · 지금 강도 그대로. 다른 CLI 면 모델은 받은 것(값이 있으면 — 사람이 같은
 * 동작에서 고른 것) 아니면 그 CLI 의 기억, 강도는 그 CLI 의 기억(낱말이 CLI 마다 다르다). **순수**
 */
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

/** 저장 글 — v3 판(`v: 3` — `last.byCli`)은 `stream` 칸을 쓰지 않는다. 읽기는 v2 판도 받는다 */
export function serializeSideChats(f: Pick<SideChatFile, "current" | "last" | "chats">): string {
  return JSON.stringify({ v: 3, current: f.current, last: f.last, chats: f.chats }, null, 2);
}

/** 16자 hex — 채팅 id(폴더 이름) */
export function newSideChatId(): string {
  return nextHistoryStreamId().slice(0, 16);
}

/** 세션 서버가 아는 CLI 인가(`side_chat_open` 의 `cli`) */
export function sideChatCliOk(cli: string): cli is SideChatCli {
  return cli === "claude" || cli === "codex";
}

/** 이 채팅에서 그 CLI 가 이어 갈 대화 id — 알면 그 id(열기의 `resume`), 모르면 `null`(새 대화 — 첫 보내기 때 뜬다) */
export function sideChatConversation(chat: Pick<SideChat, "links">, cli: string): string | null {
  const id = chat.links[cli];
  return id && UUID_RE.test(id) ? id : null;
}

/** 이 채팅에서 그 CLI 로 열 때 **갈라 올 원본 대화**(6단계) — 그 CLI 가 원본의 에이전트일 때만, 아니면 `null` */
export function sideChatForkFrom(chat: Pick<SideChat, "forkedFrom">, cli: string): string | null {
  const f = chat.forkedFrom;
  return f && f.agent === cli && UUID_RE.test(f.conv) ? f.conv : null;
}

/**
 * **여는 모양**(`side_chat_open` 의 `mode`) — 기록된 대화가 있으면 이어 가기(갈라 온 채팅이면 `project` — 서버가 그 대화의 기록된 폴더를
 * 다시 찾는다), 없고 갈라 올 원본이 있으면 갈라 오기, 둘 다 없으면 새 대화. **순수**
 */
export function sideChatOpenMode(conversation: string | null, fork: string | null): SideChatMode {
  if (conversation) return fork ? { kind: "resume", conv: conversation, project: true } : { kind: "resume", conv: conversation };
  return fork ? { kind: "fork", from: fork } : { kind: "fresh" };
}

/**
 * **"사이드 채팅에서 이어 가기" 를 세울 수 있나**(6단계 — 타일 ⋯ · 우클릭 메뉴) — 주 창의 **로컬** 타일이고 그 타일의 대화 연결
 * (`agentLink` — 훅 신호가 실어 온 `{agent, id}`)을 알며 그 에이전트가 사이드 채팅 CLI(`claude` · `codex`)일 때 그 원본, 아니면 `null`.
 * 원격 타일은 그 대화가 원격 기계에 있어 이 PC 의 CLI 가 갈라 올 수 없다. **순수**
 */
export function sideChatForkSource(
  kind: string,
  mainWindow: boolean,
  link: { agent: string; id: string } | null | undefined,
): { agent: SideChatCli; conv: string } | null {
  if (!mainWindow || kind !== "local" || !link) return null;
  return sideChatCliOk(link.agent) && UUID_RE.test(link.id) ? { agent: link.agent, conv: link.id.toLowerCase() } : null;
}

/** 갈라 온 채팅의 제목 — `↪ <타일 이름>`(이름이 비면 `↪` 만 — 첫 질문이 채우지 않는다) · 40자에서 자른다 */
export function sideChatForkTitle(name: string): string {
  const base = sideChatTitleFrom(name);
  return base ? `↪ ${base}` : "↪";
}

/**
 * **지난 대화 목록의 "사이드 채팅" 표지**(10-24 실기 3차 — 갈라 온 대화가 원본과 같은 제목으로 나란히 섰다) — 그 대화(`agent` · `id`)가 어느
 * 사이드 채팅이 쥔 대화(`links[agent]`)면 `{forked}`(그 채팅이 그 CLI 로 타일 대화에서 갈라 왔으면 참 — 화면은 `↪` 를 붙인다), 아니면 `null`.
 * 판정은 **우리 저장(`chats.json`)** 하나다 — 기록 파일의 표지(Claude `entrypoint:"sdk-cli"` · Codex `source`/`originator`)는 오케스트레이션
 * 헤드리스 턴 · 다른 SDK 도구와 겹쳐 사이드 채팅만 가려내지 못한다. 원본 대화(`forkedFrom.conv`)는 표지하지 않는다. **순수**
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

/** 표지의 글자 열쇠 — 모든 사이드 채팅 대화는 "사이드 채팅", 갈라 온 것만 `↪` 를 붙인다(`null` = 표지 없음). **순수** */
export function sideChatConvBadge(mark: { forked: boolean } | null) {
  if (!mark) return null;
  return mark.forked
    ? ({ label: "app.chatDock.convBadge.fork", title: "app.chatDock.convBadge.fork.title" } as const)
    : ({ label: "app.chatDock.convBadge", title: "app.chatDock.convBadge.title" } as const);
}

/** 폴더 이름표 — 경로의 마지막 조각(구분자 `/` · `\`) */
export function sideChatCwdLabel(cwd: string): string {
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

/** 첫 질문에서 저절로 짓는 제목 — 첫 줄 · 공백 접기 · 40자에서 자른다 */
export function sideChatTitleFrom(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim().replace(/\s+/g, " ") ?? "";
  const chars = [...line];
  return chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : line;
}

/** 고를 CLI — 바라는 것이 켜져 있으면 그것, 아니면 켠 목록의 첫 항목(없으면 `null`) */
export function pickSideChatCli<T extends { id: string }>(offered: readonly T[], wanted: string | null | undefined): T | null {
  return offered.find((c) => c.id === wanted) ?? offered[0] ?? null;
}

/**
 * **새 채팅의 기본**(2026-11-01) — CLI 는 마지막에 쓴 것(꺼졌으면 켠 목록의 첫 항목), 모델 · 강도는 **고른 그 CLI 의** 기억
 * (`last.byCli` — 모양이 틀리면 빈 값). 켠 CLI 가 없으면 `null`. **순수**
 */
export function sideChatNewDefault<T extends { id: string }>(
  offered: readonly T[],
  last: SideChatLast,
): { cli: T; model: string; effort: string } | null {
  const cli = pickSideChatCli(offered, last.cli);
  return cli ? { cli, ...sideChatPickFor(last, cli.id) } : null;
}

/**
 * 칩 메뉴의 모델 줄(빈 값 = "CLI 기본" 줄은 부르는 쪽이 맨 앞에 따로 세운다) — **지어낸 이름 없음**, 출처를 이 순서로 합친다:
 * 1. 지금 채팅의 값(직접 입력한 것이 목록 밖이어도 보이게) 2. 그 CLI 의 설정 파일 기본 모델(Codex `config.toml` 의 `model`)
 * 3. 제안 목록(악수가 알린 `ready.models` 가 있으면 그것 · 없으면 Claude 별칭 · Codex 자신의 모델 캐시). 중복 · 모양이 틀린 값은 걷는다.
 */
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

/**
 * 칩 메뉴의 강도 줄("CLI 기본" 줄은 부르는 쪽이 맨 앞에) — **지어낸 값 없음**. 지금 프로세스의 악수가 그 모델의 목록을 알렸으면 그것
 * (`efforts[model]` — 빈 모델 = 열쇠 `""` = 지금 뜬 CLI 기본 모델), 악수 전이거나 그 모델을 모르면 `fallback`(앱이 이미 쓰는 CLI 별
 * 목록 — `orchestration/delegation` 의 `EFFORTS`). **빈 목록 = 그 모델은 강도를 받지 않는다 → 칩을 숨긴다.** 모양이 틀린 값 · 중복은 걷는다.
 */
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

/** 목록 순서 — 최근에 쓴 것이 위(쓴 적 없으면 만든 시각) */
export function sortSideChats<T extends Pick<SideChat, "usedAt" | "createdAt">>(chats: readonly T[]): T[] {
  return [...chats].sort((a, b) => Math.max(b.usedAt, b.createdAt) - Math.max(a.usedAt, a.createdAt));
}

/** 저장되는 세 칸(파일 하나의 모양 — `legacyStreams` 없음) */
export type SideChatList = Pick<SideChatFile, "current" | "last" | "chats">;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * **목록 세 갈래 합치기**(2026-11-01 — 주 창 · 원격 창이 같은 `chats.json` 을 함께 고친다) — **순수**. `base` = 이 창이 마지막으로 읽은(또는 쓴)
 * 파일, `mine` = 이 창의 지금 목록, `theirs` = 방금 다시 읽은 파일. 이 창이 `base` 에서 바꾼 것만 `theirs` 위에 다시 얹는다:
 * - 채팅 하나(id 열쇠): 이 창이 고쳤으면(`mine` ≠ `base`) 이 창 것, 아니면 파일 것. 이 창이 새로 만든 것은 더하고, 이 창이 지운 것은 뺀다.
 *   파일에서 지워진 것은 이 창이 고치지 않았을 때만 뺀다(고쳤으면 살린다). 순서는 파일 순서 + 이 창이 새로 만든 것.
 * - `last.cli` · `current`: 이 창이 바꿨으면 이 창 것, 아니면 파일 것(`current` 가 목록에 없으면 첫 채팅).
 * - `last.byCli`: CLI 하나씩 — 이 창이 그 CLI 의 한 쌍을 바꿨으면 이 창 것, 아니면 파일 것.
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
