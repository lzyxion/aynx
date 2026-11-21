// 사이드 채팅의 프런트 얼굴 — 세션 서버 채팅 op 를 부르는 Tauri 명령(`server/side_chat_proxy.rs`)의 감싸개 · 사건 꼴(Rust `side_chat/event.rs` 의 거울) · 사건 통로.
//
// - 사람 창(메인 PC 주 창 · 원격 웹 창)만 부를 수 있다 — 창 이름은 Rust 가 채운다(여기서 싣지 않는다). 보조 · 떼어 낸 창은 `[main-window-only]`.
// - 사건은 전역 이벤트가 아니다: 그 채팅을 보는 창이 건 `Channel` 에만 간다(본문이 다른 창 · 원격의 `listen` 에 닿지 않게) — `listen` 으로는 못 받는다.
// - 사건은 빠질 수 있다(서버 broadcast `Lagged`) — `seqStep` 이 `gap` 이면 `sideChatAttach` 로 다시 받는다.

import { Channel, invoke } from "./ipc";
import type { TranscriptLink } from "$lib/context";

export type SideChatCli = "claude" | "codex";
/** `mcpTool` = 외부 MCP 서버의 도구 */
export type PermKind = "tool" | "command" | "fileChange" | "mcpTool";
export type Decision = "allow" | "deny";
/** `auto` · `remembered` = 사람이 그 채팅에 정한 모드(Auto) · 허용 목록으로 서버가 대신 허용했다 */
export type ResolvedBy = "human" | "cli" | "closed" | "auto" | "remembered";
/** Rust `side_chat::perm` 과 같은 값 */
export type PermMode = "manual" | "auto";
export type Outcome = "ok" | "interrupted" | "error";
export type ExitReason = "closed" | "protocol" | "start-timeout" | "exit" | "crash";
export type SideChatStatus = "stopped" | "starting" | "ready" | "running";

/** Rust `Ev` — 꼬리표 `t` · camelCase */
export type SideChatEv =
  | {
      t: "ready";
      cli: SideChatCli;
      version: string | null;
      model: string | null;
      models: string[];
      /** 열쇠 `""` = 지금 뜬 CLI 기본 모델 · 빈 목록 = 강도 없음 · 열쇠 없음 = 모름 */
      efforts: Record<string, string[]>;
      conversationId: string | null;
    }
  | { t: "turnStarted"; turn: string | null }
  /** `text` · `files` = 사람이 보낸 본문(연결 머리글 없이) · 그림 파일 이름 — 서버가 그 글을 모르면 칸이 없다 */
  | { t: "userAccepted"; clientId: string | null; text?: string; files?: string[] }
  | { t: "textDelta"; item: string | null; text: string }
  | { t: "text"; item: string | null; text: string }
  | { t: "toolStarted"; item: string; name: string; summary: string; input?: unknown }
  | { t: "toolOutput"; item: string; text: string }
  | { t: "toolFinished"; item: string; ok: boolean; output: string | null }
  | { t: "permission"; requestId: string; kind: PermKind; title: string; detail: string; toolName: string }
  | { t: "permissionResolved"; requestId: string; decision: Decision | null; by: ResolvedBy }
  /** 서버가 카드 없이 대신 허용한 요청 — 곧이어 `permissionResolved` */
  | { t: "permissionAuto"; requestId: string; kind: PermKind; title: string; toolName: string; by: ResolvedBy }
  /** `allow` = 종류 열쇠(`outsideRead` · `fileChange` · `command` · `mcp:<서버>`) */
  | { t: "permPolicy"; mode: PermMode; allow: string[] }
  | { t: "turnEnded"; turn: string | null; outcome: Outcome; message: string | null }
  | { t: "modelChanged"; model: string }
  /** `null` = CLI 기본 */
  | { t: "effortChanged"; effort: string | null }
  /** 화면 문구는 낱말로 고른다 — 새 낱말이 올 수 있다 */
  | { t: "notice"; code: string; detail: string | null }
  | { t: "mcpServers"; names: string[] }
  | { t: "exited"; code: number | null; reason: ExitReason };

export type PermissionEv = Extract<SideChatEv, { t: "permission" }>;

export interface SideChatEvent {
  windows: string[];
  chat: string;
  epoch: number;
  seq: number;
  ev: SideChatEv;
}

/** 토큰 · 값은 없다 — 채팅 MCP 토큰은 프런트로 오지 않는다 */
export interface SideChatLinkView {
  stream: string;
  code: string | null;
  label: string | null;
  kind: string | null;
  readable: boolean;
  closed: boolean;
}

/** 그 뒤 사건은 `seq` 다음부터 */
export interface SideChatSnapshot {
  /** 서버가 재시작 · TTL 로 잊었으면 독이 저장된 묶음을 다시 건다 */
  links: SideChatLinkView[];
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  /** 프로세스 세대(0 = 아직 안 띄움) — 보내기 · 끊기 · 결정에 싣는다(옛 것이면 `[stale-chat]`) */
  epoch: number;
  leaseEpoch: number;
  seq: number;
  status: SideChatStatus;
  conversationId: string | null;
  /** 이름표로만 쓴다 · 옛 서버는 칸 없음 */
  cwd?: string | null;
  forkFrom?: string | null;
  mcpServers?: string[];
  /** 옛 서버는 칸 없음 = Manual · 빈 목록 */
  permMode?: PermMode;
  permAllow?: string[];
  /** 지금 턴의 사건(지난 턴은 기록 파일) */
  liveTurn: SideChatEv[];
  pending: PermissionEv[];
}

export interface SideChatRow {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  epoch: number;
  status: SideChatStatus;
  conversationId: string | null;
  /** 남의 창 라벨은 오지 않는다 */
  viewers: number;
  detached: boolean;
}

/** `fork` 의 폴더는 서버가 대화 색인에서 정한다. `resume` 의 `project` = 갈라 온 채팅 자신의 대화 */
export type SideChatMode =
  | { kind: "fresh" }
  | { kind: "resume"; conv: string; project?: boolean }
  | { kind: "fork"; from: string };

export interface SideChatOpenArgs {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort?: string | null;
  mode: SideChatMode;
}

/** 띄우지 않는다(첫 보내기 때 서버가 띄운다). */
export function sideChatOpen(a: SideChatOpenArgs): Promise<SideChatSnapshot> {
  return invoke("side_chat_open", { chat: a.chat, cli: a.cli, model: a.model, effort: a.effort ?? null, mode: a.mode });
}

/**
 * 사람이 보낸 글. `images` · `files` 는 앱 첨부 자리의 사본만 — 서버가 다시 보고 한도 밖이면 `[image-*]` · `[file-*]` · `[too-many-*]`.
 * `link` = 서버가 붙인 연결 머리글(세션 id 는 없다) · `linkNames` 는 머리글을 붙일 때만 그 이름으로 짓는다.
 */
export function sideChatSend(
  chat: string,
  epoch: number,
  text: string,
  clientId?: string | null,
  linkNames?: Readonly<Record<string, string>> | null,
  images: readonly string[] = [],
  files: readonly string[] = [],
): Promise<{ epoch: number; link?: TranscriptLink | null }> {
  return invoke("side_chat_send", { chat, epoch, text, clientId: clientId ?? null, linkNames: linkNames ?? null, images, files });
}

/** 완료 확인 공유 — 판 31 미만 서버면 보내지 않고 `{sent: false}` */
export function sideChatSeen(chat: string, epoch: number, seq: number): Promise<{ sent: boolean }> {
  return invoke("side_chat_seen", { chat, epoch, seq });
}

export function sideChatInterrupt(chat: string, epoch: number): Promise<boolean> {
  return invoke("side_chat_interrupt", { chat, epoch });
}

/** 산 프로세스에 보냈나(없으면 다음 띄우기에 쓴다) */
export function sideChatSetModel(chat: string, epoch: number, model: string): Promise<boolean> {
  return invoke("side_chat_set_model", { chat, epoch, model });
}

/** 다시 띄우지 않는다 */
export function sideChatSetEffort(chat: string, epoch: number, effort: string | null): Promise<boolean> {
  return invoke("side_chat_set_effort", { chat, epoch, effort });
}

/**
 * 사람의 권한 결정. `remember` 의 종류는 서버가 기다리는 요청에서 읽는다 — 여기서 보내지 않는다.
 * 기다리는 요청이 아니면 `[unknown-request]` · 판 36 이하 서버에 `remember` 면 `[server-outdated]`.
 */
export function sideChatDecide(
  chat: string,
  epoch: number,
  requestId: string,
  decision: Decision,
  message?: string | null,
  remember = false,
): Promise<boolean> {
  return invoke("side_chat_decide", { chat, epoch, requestId, decision, message: message ?? null, remember });
}

export interface SideChatPermView {
  mode: PermMode;
  allow: string[];
}

/** Auto 면 서버가 기다리는 카드도 허용으로 답한다. 옛 서버면 `[server-outdated]` */
export function sideChatSetPermMode(chat: string, mode: PermMode): Promise<SideChatPermView> {
  return invoke("side_chat_set_perm_mode", { chat, mode });
}

export function sideChatForgetAllow(chat: string, kind: string): Promise<SideChatPermView> {
  return invoke("side_chat_forget_allow", { chat, kind });
}

export function sideChatClose(chat: string): Promise<boolean> {
  return invoke("side_chat_close", { chat });
}

/** 서버 표에 없으면 `[session-gone]`. */
export function sideChatAttach(chat: string): Promise<SideChatSnapshot> {
  return invoke("side_chat_attach", { chat });
}

/**
 * 묶음을 통째로 놓는다(최대 8 — 넘으면 `[too-many-links]`). 모르는 스트림이 하나라도 섞이면 `[bad-link]` 이고 아무것도 안 바뀐다.
 * 옛 서버에 둘 이상을 걸면 `[server-outdated]`. 읽기 판정은 MCP 호출 · 타일마다 서버가 한다.
 */
export function sideChatLink(chat: string, streams: readonly string[]): Promise<{ links: SideChatLinkView[]; changed: boolean }> {
  return invoke("side_chat_link", { chat, epoch: null, streams: [...streams] });
}

export function sideChatList(): Promise<SideChatRow[]> {
  return invoke("side_chat_list");
}

// ── 사건 통로 ──

/** Rust `side_chat/event.rs` 의 `Ev` 갈래와 같은 목록(`side-chat-api.test.ts` 가 대조한다). */
export const EV_TAGS: ReadonlySet<string> = new Set([
  "ready", "turnStarted", "userAccepted", "textDelta", "text", "toolStarted", "toolOutput", "toolFinished",
  "permission", "permissionResolved", "turnEnded", "modelChanged", "effortChanged", "notice", "mcpServers", "exited",
  "permissionAuto", "permPolicy",
]);

/** 모르는 꼬리표는 버린다 — 새 사건은 Rust 와 함께 이 표에 넣는다. */
export function isSideChatEvent(x: unknown): x is SideChatEvent {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  const ev = o.ev as Record<string, unknown> | null | undefined;
  return (
    typeof o.chat === "string" &&
    typeof o.epoch === "number" &&
    typeof o.seq === "number" &&
    typeof ev === "object" &&
    ev !== null &&
    typeof ev.t === "string" &&
    EV_TAGS.has(ev.t)
  );
}

/** `last` = 그 채팅에서 마지막으로 반영한 `seq`(스냅숏의 `seq` 에서 시작). */
export function seqStep(last: number, seq: number): "apply" | "drop" | "gap" {
  if (seq <= last) return "drop";
  return seq === last + 1 ? "apply" : "gap";
}

type Handler = (e: SideChatEvent) => void;

/** 통로는 창(페이지)마다 하나 — 첫 구독이 건다. */
const handlers = new Map<string, Set<Handler>>();
let opened: Promise<void> | null = null;

export function dispatchSideChatEvent(msg: unknown): void {
  if (!isSideChatEvent(msg)) return;
  const set = handlers.get(msg.chat);
  if (!set) return;
  for (const h of [...set]) h(msg);
}

function ensureChannel(): Promise<void> {
  if (!opened) {
    const channel = new Channel<unknown>();
    channel.onmessage = dispatchSideChatEvent;
    opened = invoke<void>("side_chat_subscribe", { channel }).catch((e: unknown) => {
      opened = null; // 다음 구독이 다시 건다.
      throw e;
    });
  }
  return opened;
}

/** 순서: 구독을 먼저 걸고 그다음 스냅숏을 받은 뒤 `seqStep` 으로 겹친 것을 버린다. */
export async function onSideChatEvent(chat: string, handler: Handler): Promise<() => void> {
  let set = handlers.get(chat);
  if (!set) handlers.set(chat, (set = new Set()));
  set.add(handler);
  const off = () => {
    const s = handlers.get(chat);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) handlers.delete(chat);
  };
  try {
    await ensureChannel();
  } catch (e) {
    off();
    throw e;
  }
  return off;
}
