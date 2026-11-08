// **사이드 채팅 v2 의 프런트 얼굴**(3단계 — docs/log/2026-10-23-side-chat-v2-design.md 3절) — 세션 서버의 채팅 프로세스 op 를 부르는
// 같은 이름 Tauri 명령(`src-tauri/src/server/side_chat_proxy.rs`)의 타입 붙은 감싸개 · 사건 꼴(`Ev` — Rust `side_chat/event.rs` 의 거울) ·
// 사건 통로 하나. 화면(`ChatDock`)은 4단계에서 이것을 쓴다.
//
// - **사람 창**(집 PC 주 창 · 원격 웹 창 — 2026-11-01)만 부를 수 있다 — 창 이름은 Rust 가 부른 웹뷰에서 채운다(여기서 싣지 않는다).
//   보조 · 떼어 낸 창은 `[main-window-only]`. 원격 관문(`remote/deny.rs`)은 사이드 채팅 명령을 모두 허용한다.
// - 사건은 전역 이벤트가 아니다: Rust 가 몸의 `windows`(그 채팅을 보는 창들) 가운데 이 창이 건 **`Channel` 에만** 보낸다(본문이 다른 창 · 원격의 `listen` 에
//   닿지 않게). 그래서 `listen("side-chat-event")` 로는 받을 수 없고 [`onSideChatEvent`] 를 쓴다 — 창마다 통로 하나를 걸고 채팅 id 로 나눠 준다.
// - 사건은 빠질 수 있다(서버 broadcast `Lagged`) → 채팅마다 `seq` 가 1씩 는다. [`seqStep`] 이 `gap` 이면 [`sideChatAttach`] 로 다시 받는다.
// - 실패는 `[이유] 문구` — `stale-chat`(옛 프로세스 세대 → 다시 attach) · `session-gone`(서버 표에 없음 → 다시 open) 등은 `error-reason.ts`.

import { Channel, invoke } from "./ipc";
import type { TranscriptLink } from "$lib/context";

export type SideChatCli = "claude" | "codex";
/** `mcpTool` = 외부 MCP 서버의 도구(묻지 않기를 끈 서버 — 2026-10-25) */
export type PermKind = "tool" | "command" | "fileChange" | "mcpTool";
export type Decision = "allow" | "deny";
export type ResolvedBy = "human" | "cli" | "closed";
export type Outcome = "ok" | "interrupted" | "error";
/** 서버가 낸 프로세스 끝의 까닭(`server::side_chat` `kill` · 어댑터의 악수 실패 = `protocol`). */
export type ExitReason = "closed" | "protocol" | "start-timeout" | "exit" | "crash";
export type SideChatStatus = "stopped" | "starting" | "ready" | "running";

/** CLI 무관 사건(Rust `Ev` — 꼬리표 `t` · camelCase). */
export type SideChatEv =
  | {
      t: "ready";
      cli: SideChatCli;
      version: string | null;
      model: string | null;
      models: string[];
      /** 모델 → 받는 추론 강도(악수가 알린 것). 열쇠 `""` = 지금 뜬 CLI 기본 모델 · 빈 목록 = 강도 없음 · 열쇠 없음 = 모름 */
      efforts: Record<string, string[]>;
      conversationId: string | null;
    }
  | { t: "turnStarted"; turn: string | null }
  /**
   * 보낸 글이 CLI 에 들어갔다. `text` · `files` = 사람이 보낸 본문(연결 머리글 없이)과 붙인 그림의 파일 이름 — 서버가 얹는다(다른 창이 보낸
   * 글을 곧바로 그리게 · 2026-11-01). 서버가 그 글을 모르면 칸이 없다.
   */
  | { t: "userAccepted"; clientId: string | null; text?: string; files?: string[] }
  | { t: "textDelta"; item: string | null; text: string }
  | { t: "text"; item: string | null; text: string }
  | { t: "toolStarted"; item: string; name: string; summary: string; input?: unknown }
  | { t: "toolOutput"; item: string; text: string }
  | { t: "toolFinished"; item: string; ok: boolean; output: string | null }
  | { t: "permission"; requestId: string; kind: PermKind; title: string; detail: string; toolName: string }
  | { t: "permissionResolved"; requestId: string; decision: Decision | null; by: ResolvedBy }
  | { t: "turnEnded"; turn: string | null; outcome: Outcome; message: string | null }
  | { t: "modelChanged"; model: string }
  /** 추론 강도가 바뀌었다(`null` = CLI 기본) */
  | { t: "effortChanged"; effort: string | null }
  /** 낱말 하나 + 짧은 상세 — 화면 문구는 낱말로 고른다(`untested-version` · `handshake-failed` · `stderr` …). 새 낱말이 올 수 있다. */
  | { t: "notice"; code: string; detail: string | null }
  /** 이 프로세스에 실린 외부 MCP 서버 이름(띄울 때 — 머리줄 "MCP N" 칩 · 2026-10-25) */
  | { t: "mcpServers"; names: string[] }
  | { t: "exited"; code: number | null; reason: ExitReason };

export type PermissionEv = Extract<SideChatEv, { t: "permission" }>;

/** 사건 하나의 봉투(서버 이벤트 `side-chat-event`). */
export interface SideChatEvent {
  /** 지금 그 채팅을 보는 창 라벨들(주 창 · 원격 창 — 2026-11-01). Rust 가 이 창들의 통로로만 보낸다 */
  windows: string[];
  chat: string;
  epoch: number;
  seq: number;
  ev: SideChatEv;
}

/**
 * 그 채팅의 **연결**(5단계 — 연결 칩) — 서버가 아는 것: 스트림 · 거울의 타일 코드 · 이름 · 종류 · 지금 AI 가 읽을 수 있나 · 거울에 없음(닫힘).
 * 토큰 · 값은 없다(채팅 MCP 토큰은 프런트로 오지 않는다).
 */
export interface SideChatLinkView {
  stream: string;
  code: string | null;
  label: string | null;
  kind: string | null;
  readable: boolean;
  closed: boolean;
}

/** `side_chat_open` · `side_chat_attach` 의 답 — 그 뒤 사건은 `seq` 다음부터. */
export interface SideChatSnapshot {
  /** 연결(없으면 `null`) — 서버가 재시작 · TTL 로 잊었으면 독이 저장된 연결을 다시 건다 */
  link: SideChatLinkView | null;
  chat: string;
  cli: SideChatCli;
  model: string;
  /** 추론 강도(`null` = CLI 기본) */
  effort: string | null;
  /** 프로세스 세대(0 = 아직 안 띄움) — 보내기 · 끊기 · 결정에 싣는다(옛 것이면 `[stale-chat]`). */
  epoch: number;
  leaseEpoch: number;
  seq: number;
  status: SideChatStatus;
  conversationId: string | null;
  /** CLI 가 도는 폴더(`null` = 채팅 자기 폴더 · 갈라 온 채팅은 그 대화의 기록된 폴더 — 이름표로만 쓴다) · 옛 서버는 칸 없음 */
  cwd?: string | null;
  /** 갈라 올 원본 대화(첫 턴 전까지) */
  forkFrom?: string | null;
  /** 지금(마지막) 프로세스에 실린 외부 MCP 서버 이름 · 옛 서버는 칸 없음 */
  mcpServers?: string[];
  /** 지금 턴의 사건(지난 턴은 기록 파일 — `agent_conversation_transcript`). */
  liveTurn: SideChatEv[];
  /** 기다리는 권한 요청. */
  pending: PermissionEv[];
}

/** `side_chat_list` 의 한 줄. */
export interface SideChatRow {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  epoch: number;
  status: SideChatStatus;
  conversationId: string | null;
  /** 지금 보는 창 수(남의 창 라벨은 오지 않는다 · 2026-11-01) */
  viewers: number;
  detached: boolean;
}

/**
 * 띄우는 모양 — `fork` = 타일 대화 이어 가기(6단계 — 원본 대화 id 만 · 폴더는 서버가 대화 색인에서 정한다). `resume` 의 `project` = 갈라 온
 * 채팅 자신의 대화(서버가 그 대화의 기록된 폴더를 다시 찾는다 — 없으면 채팅 자기 폴더).
 */
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

/** 연다 — **띄우지 않는다**(첫 보내기 때 서버가 띄운다). 같은 채팅 · 같은 CLI 면 다시 붙는다. */
export function sideChatOpen(a: SideChatOpenArgs): Promise<SideChatSnapshot> {
  return invoke("side_chat_open", { chat: a.chat, cli: a.cli, model: a.model, effort: a.effort ?? null, mode: a.mode });
}

/**
 * 사람이 보낸 글 — 프로세스가 없으면 서버가 띄우고 준비를 기다린다(길 수 있다). 답의 `epoch` 가 이제 쓸 세대다. `link` = 서버가 이 글 앞에
 * 붙인 연결 머리글(붙이지 않았으면 `null` · 옛 서버는 칸 없음 — 세션 id 는 없다). `linkName` = 입력 칸 연결 칩의 지금 이름(머리글을 붙일
 * 때만 서버가 그 이름으로 짓는다 — 기록 칩 = 입력 칸 칩 · 없으면 거울 이름). `images` = 붙인 그림의 경로(2026-10-24 — 앱 첨부 자리의
 * 사본만 · 서버가 다시 본다: 8장 · 10 MB · png/jpeg/gif/webp — 밖이면 `[image-*]` · `[too-many-images]`). 그림만이면 글이 빌 수 있다.
 */
export function sideChatSend(
  chat: string,
  epoch: number,
  text: string,
  clientId?: string | null,
  linkName?: string | null,
  images: readonly string[] = [],
): Promise<{ epoch: number; link?: TranscriptLink | null }> {
  return invoke("side_chat_send", { chat, epoch, text, clientId: clientId ?? null, linkName: linkName ?? null, images });
}

/** 도는 턴을 끊는다 — 보냈나(도는 턴이 없으면 false). */
export function sideChatInterrupt(chat: string, epoch: number): Promise<boolean> {
  return invoke("side_chat_interrupt", { chat, epoch });
}

/** 모델 바꾸기 — 산 프로세스에 보냈나(없으면 다음 띄우기에 쓴다). */
export function sideChatSetModel(chat: string, epoch: number, model: string): Promise<boolean> {
  return invoke("side_chat_set_model", { chat, epoch, model });
}

/** 추론 강도 바꾸기(`null` = CLI 기본) — 산 프로세스에 보냈나(없으면 다음 띄우기에 쓴다). 다시 띄우지 않는다 */
export function sideChatSetEffort(chat: string, epoch: number, effort: string | null): Promise<boolean> {
  return invoke("side_chat_set_effort", { chat, epoch, effort });
}

/** 사람의 권한 결정([허용 한 번] · [거절]). 기다리는 요청이 아니면 `[unknown-request]`. */
export function sideChatDecide(
  chat: string,
  epoch: number,
  requestId: string,
  decision: Decision,
  message?: string | null,
): Promise<boolean> {
  return invoke("side_chat_decide", { chat, epoch, requestId, decision, message: message ?? null });
}

/** 닫는다(프로세스를 잡째 끝낸다) — 서버 표에 있었나. */
export function sideChatClose(chat: string): Promise<boolean> {
  return invoke("side_chat_close", { chat });
}

/** 스냅숏 + 임대를 이 창으로(F5 · 크래시 뒤 · `seq` 빈틈). 서버 표에 없으면 `[session-gone]`. */
export function sideChatAttach(chat: string): Promise<SideChatSnapshot> {
  return invoke("side_chat_attach", { chat });
}

/**
 * **연결 칩**(5단계) — 그 채팅이 MCP 로 읽을 타일(`stream` = 타일의 `historyStreamId` · `null` = 끊기). 서버는 거울에 있는 창 타일만 받는다
 * (`[bad-link]`). 바뀌었으면 다음 보내기에 앱 고정 연결 머리글이 붙는다. 읽기 판정은 MCP 호출마다 서버가 한다.
 */
export function sideChatLink(chat: string, stream: string | null): Promise<{ link: SideChatLinkView | null; changed: boolean }> {
  return invoke("side_chat_link", { chat, epoch: null, stream });
}

/** 서버 표의 채팅들. */
export function sideChatList(): Promise<SideChatRow[]> {
  return invoke("side_chat_list");
}

// ---------------------------------------------------------------------------
// 사건 통로
// ---------------------------------------------------------------------------

const EV_TAGS: ReadonlySet<string> = new Set([
  "ready", "turnStarted", "userAccepted", "textDelta", "text", "toolStarted", "toolOutput", "toolFinished",
  "permission", "permissionResolved", "turnEnded", "modelChanged", "effortChanged", "notice", "exited",
]);

/** 봉투 모양인가 — 통로로 온 값을 믿기 전에 본다(모르는 꼬리표는 버린다 — 새 사건은 Rust 와 함께 이 표에 넣는다). */
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

/**
 * 받은 사건을 어떻게 할까 — **순수**. `last` = 그 채팅에서 마지막으로 반영한 `seq`(스냅숏의 `seq` 에서 시작).
 * - `apply` — 바로 다음 것.
 * - `drop` — 이미 반영했다(스냅숏에 들어 있던 것 · 겹쳐 온 것).
 * - `gap` — 빠진 것이 있다 → 다시 attach(사건 broadcast 는 빠질 수 있다).
 */
export function seqStep(last: number, seq: number): "apply" | "drop" | "gap" {
  if (seq <= last) return "drop";
  return seq === last + 1 ? "apply" : "gap";
}

type Handler = (e: SideChatEvent) => void;

/** 채팅 id → 받는 손들. 통로는 창(페이지)마다 하나 — 첫 구독이 건다. */
const handlers = new Map<string, Set<Handler>>();
let opened: Promise<void> | null = null;

/** 통로로 온 값 하나를 그 채팅의 손들에 — 시험이 부른다. */
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

/**
 * 채팅 하나의 사건을 받는다 — 통로가 서면 풀린다(사람 창이 아니면 `[main-window-only]` 로 실패). 돌려준 함수로 그만 받는다.
 * 순서: 구독을 먼저 걸고 그다음 `sideChatOpen` · `sideChatAttach` 로 스냅숏을 받은 뒤 [`seqStep`] 으로 겹친 것을 버린다.
 */
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
