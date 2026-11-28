// Tauri `chat_tile_*`(Rust `server/chat_tile_proxy.rs`)의 얇은 손잡이와 모양. 프로세스 · stdin 은 세션 서버에 살고 여기에는 토큰이 없다.
// 사건은 그 창이 건 구독 통로로만 온다 — 방송하지 않는다. 창 라벨은 Rust 가 웹뷰에서 채운다(여기서 싣지 않는다).

import { Channel, invoke } from "../ipc";
import {
  EV_TAGS,
  type GoalViewWire,
  type McpRowView,
  type PermissionEv,
  type RewindScope,
  type SideChatCli,
  type SideChatEv,
  type SideChatStatus,
  type SlashCommandView,
  type TierView,
} from "$lib/side-chat-api";

/** 서버 `ID_PREFIX` 와 같은 값 */
export const CHAT_TILE_PREFIX = "ct-";

/** 그 뒤 사건은 `seq` 다음부터 */
export interface ChatTileSnapshot {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  cwd: string;
  /** 0 = 아직 안 띄움 */
  epoch: number;
  seq: number;
  status: SideChatStatus;
  conversationId: string | null;
  mcpServers: string[];
  liveTurn: SideChatEv[];
  pending: PermissionEv[];
  /** 서버가 다시 띄울 때 쓸 값(사람이 고른 것) — 옛 서버는 칸이 없다 */
  permMode?: string | null;
  /** 아직 한 번도 안 띄웠으면 `null` */
  cliMode?: ChatTileCliMode | null;
  /** 셋 다 한 번도 알리지 않았으면 `null` · 옛 서버는 칸이 없다 */
  commands?: ChatTileCommands | null;
  context?: ChatTileContext | null;
  lastCompaction?: ChatTileCompaction | null;
  /** 한 번도 알리지 않았으면 `null` · 옛 서버는 칸이 없다 */
  rewind?: ChatTileRewindCaps | null;
  /** 대화 되감기가 끝날 때마다 +1 — 바뀌면 기록을 처음부터 다시 읽는다 */
  rewindGen?: number;
  /** 한 번도 알리지 않았으면 `null` · 옛 서버는 칸이 없다 */
  mcpStatus?: ChatTileMcpStatus | null;
  goal?: GoalViewWire | null;
  /** 사람이 고른 Codex 속도 등급(없으면 `null` = CLI 기본) */
  tier?: string | null;
  tiers?: ChatTileTiers | null;
  /** CLI 가 마지막으로 알린 모델 — 사람이 고른 것이 없을 때 속도 등급 표의 열쇠 · 옛 서버는 칸이 없다 */
  cliModel?: string | null;
}

/** `stale` = CLI 를 다시 띄운 뒤 아직 알리지 않았다 */
export interface ChatTileMcpStatus {
  servers: McpRowView[];
  source: string;
  stale: boolean;
}

export interface ChatTileTiers {
  byModel: Record<string, TierView[]>;
  thread: string | null;
}

/** 서버 `ReviewTarget` 과 같은 넷 — 판정은 서버가 한 번 더 한다 */
export type ReviewTargetWire =
  | { type: "uncommittedChanges" }
  | { type: "baseBranch"; branch: string }
  | { type: "commit"; sha: string }
  | { type: "custom"; instructions: string };

export type GoalAction = "set" | "pause" | "resume" | "clear";

/** 이 프로세스가 채팅 모양에서 되감을 수 있는 범위 */
export interface ChatTileRewindCaps {
  files: boolean;
  conversation: boolean;
}

/** `/` 메뉴 재료 — 이름 · 설명뿐(스킬 경로는 서버 어댑터에만) */
export interface ChatTileCommands {
  commands: SlashCommandView[];
  terminal: string[];
}

export interface ChatTileContext {
  used: number;
  window: number | null;
  source: string;
}

export interface ChatTileCompaction {
  trigger: string | null;
  preTokens: number | null;
  postTokens: number | null;
}

/** 마지막으로 CLI 가 알린 권한 모드 · 칩이 고를 수 있는 값 */
export interface ChatTileCliMode {
  mode: string;
  choices: string[];
}

/** 제안 · 규칙 · 목적지 · 모드는 싣지 않는다 — 무엇을 실을지는 서버 어댑터가 제 대기 장부에서 고른다 */
export type ChatTileDecision = "allow" | "deny" | "allowSession" | "answer";

/** 창 라벨은 오지 않는다 */
export interface ChatTileRow {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  epoch: number;
  status: SideChatStatus;
  conversationId: string | null;
  subs: number;
  detached: boolean;
}

export interface ChatTileEvent {
  chat: string;
  epoch: number;
  seq: number;
  ev: SideChatEv;
}

/** `fresh.cwd: null` = 사용자 홈 · fork 는 없다 */
export type ChatTileMode = { kind: "fresh"; cwd: string | null } | { kind: "resume"; conv: string };

/** 서버 표에 세우기만 한다 — 첫 보내기가 띄운다 */
export function chatTileOpen(a: {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort?: string | null;
  mode: ChatTileMode;
  /** 서버가 받을 수 없는 값은 조용히 버린다(복원을 막지 않는다) */
  permMode?: string | null;
  /** Codex 속도 등급 — 옛 서버는 칸을 버린다 */
  tier?: string | null;
}): Promise<ChatTileSnapshot> {
  return invoke("chat_tile_open", {
    chat: a.chat,
    cli: a.cli,
    model: a.model,
    effort: a.effort ?? null,
    mode: a.mode,
    permMode: a.permMode ?? null,
    tier: a.tier ?? null,
  });
}

/** 사람이 보낸 글 · 사람이 붙인 앱 첨부 자리의 경로만 — `clientId` = 중복 제거 열쇠 · `skills` = 사람이 고른 Codex 스킬 이름(경로는 싣지 않는다) */
export function chatTileSend(
  chat: string,
  epoch: number,
  text: string,
  clientId: string,
  images: readonly string[] = [],
  files: readonly string[] = [],
  skills: readonly string[] = [],
): Promise<{ epoch: number }> {
  return invoke("chat_tile_send", { chat, epoch, text, clientId, images, files, skills: [...skills] });
}

/** 사람이 부른 맥락 압축 — 띄우지 않는다(프로세스 없으면 `[not-started]`) · Codex 는 지침을 받지 않는다 */
export function chatTileCompact(chat: string, epoch: number, instructions?: string | null): Promise<boolean> {
  return invoke("chat_tile_compact", { chat, epoch, instructions: instructions ?? null });
}

/**
 * 사람이 부른 되감기 — `dryRun` 이면 미리 보기(프로세스가 없으면 그 대화를 resume 으로 띄울 수 있다) · 아니면 실행(띄우지 않는다).
 * 실행은 같은 세대 · 기준점 · 범위의 `can:true` 미리 보기 뒤에만 받힌다(`[preview-first]`). 답은 사건 `rewind` 로 온다.
 */
export function chatTileRewind(chat: string, epoch: number, anchor: string, scope: RewindScope, dryRun: boolean): Promise<{ epoch: number }> {
  return invoke("chat_tile_rewind", { chat, epoch, anchor, scope, dryRun });
}

/** 사람이 고른 검토(Codex · 같은 대화 안) — 프로세스가 없으면 그 대화로 띄운다 · 결과는 사건으로 온다 */
export function chatTileReview(chat: string, epoch: number, target: ReviewTargetWire): Promise<{ epoch: number }> {
  return invoke("chat_tile_review", { chat, epoch, target });
}

/**
 * 사람이 정한 목표(Codex). 일을 시작하는 `set` · `resume` 과 멈추는 `pause` · `clear` 는 명령이 다르다 —
 * 원격 창 관문이 앞의 둘만 마스터 암호로 다시 확인한다(`remote/deny.rs`).
 */
export function chatTileGoal(chat: string, epoch: number, action: GoalAction, objective?: string | null, tokenBudget?: number | null): Promise<{ epoch: number }> {
  if (action === "set" || action === "resume") {
    return invoke("chat_tile_goal_start", { chat, epoch, action, objective: objective ?? null, tokenBudget: tokenBudget ?? null });
  }
  return invoke("chat_tile_goal_stop", { chat, epoch, action });
}

/** `null` = CLI 기본 · 참 = 산 프로세스에 닿음 · 거짓 = 다음 띄우기가 쓴다 */
export function chatTileSetTier(chat: string, epoch: number, tier: string | null): Promise<boolean> {
  return invoke("chat_tile_set_tier", { chat, epoch, tier });
}

/** 사람이 연 MCP 상태 보기의 읽기 한 번 — 참 = CLI 에 물었다(답은 사건) · 거짓 = 물을 길이 없다(받은 것만) */
export function chatTileMcpStatus(chat: string, epoch: number): Promise<boolean> {
  return invoke("chat_tile_mcp_status", { chat, epoch });
}

export function chatTileInterrupt(chat: string, epoch: number): Promise<boolean> {
  return invoke("chat_tile_interrupt", { chat, epoch });
}

/** 산 프로세스에 보냈나(없으면 다음 띄우기에 쓴다) */
export function chatTileSetModel(chat: string, epoch: number, model: string): Promise<boolean> {
  return invoke("chat_tile_set_model", { chat, epoch, model });
}

/** `null` = CLI 기본 */
export function chatTileSetEffort(chat: string, epoch: number, effort: string | null): Promise<boolean> {
  return invoke("chat_tile_set_effort", { chat, epoch, effort });
}

/** 사람의 그 자리 결정 — 기다리는 요청이 아니면 `[unknown-request]` · `answers` = 질문 글 → 사람이 고르거나 친 답 */
export function chatTileDecide(
  chat: string,
  epoch: number,
  requestId: string,
  decision: ChatTileDecision,
  message?: string | null,
  answers?: Readonly<Record<string, string>> | null,
): Promise<boolean> {
  return invoke("chat_tile_decide", { chat, epoch, requestId, decision, message: message ?? null, answers: answers ?? null });
}

/** CLI 자신의 권한 모드 — 참 = 산 CLI 에 보냈다 · 거짓 = 표에만 적었다(다음 띄우기가 쓴다) */
export function chatTileSetPermMode(chat: string, epoch: number, mode: string): Promise<boolean> {
  return invoke("chat_tile_set_perm_mode", { chat, epoch, mode });
}

export function chatTileClose(chat: string): Promise<boolean> {
  return invoke("chat_tile_close", { chat });
}

/** 서버 표에 없으면 `[session-gone]` */
export function chatTileAttach(chat: string): Promise<ChatTileSnapshot> {
  return invoke("chat_tile_attach", { chat });
}

export function chatTileList(): Promise<ChatTileRow[]> {
  return invoke("chat_tile_list");
}

/** 이 창의 통로 하나 — 다시 부르면 서버 · GUI 모두 갈음 */
export function chatTileSubscribe(chat: string, channel: Channel<unknown>): Promise<{ subGen: number; snapshot: ChatTileSnapshot }> {
  return invoke("chat_tile_subscribe", { chat, channel });
}

/** 같은 `subGen` 만 — 늦은 정리가 새 구독을 지우지 않는다 */
export function chatTileUnsubscribe(chat: string, subGen: number): Promise<boolean> {
  return invoke("chat_tile_unsubscribe", { chat, subGen });
}

/** 꼬리표는 `side-chat-api` 의 `EV_TAGS` 그대로 — 셋째 목록을 두지 않는다 */
export function isChatTileEvent(x: unknown, chat: string): x is ChatTileEvent {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  const ev = o.ev as Record<string, unknown> | null | undefined;
  return (
    o.chat === chat &&
    typeof o.epoch === "number" &&
    typeof o.seq === "number" &&
    typeof ev === "object" &&
    ev !== null &&
    typeof ev.t === "string" &&
    EV_TAGS.has(ev.t)
  );
}

export function chatTileChannel(chat: string, handler: (e: ChatTileEvent) => void): Channel<unknown> {
  const ch = new Channel<unknown>();
  ch.onmessage = (msg) => {
    if (isChatTileEvent(msg, chat)) handler(msg);
  };
  return ch;
}
