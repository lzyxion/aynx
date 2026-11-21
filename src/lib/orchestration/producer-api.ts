// Tauri `producer_chat_*` 의 얇은 손잡이와 모양. 프로세스 · stdin 은 세션 서버에 살고 여기에는 토큰이 없다(채팅 토큰은 프런트로 오지 않는다).
// 사건은 구독 통로로만 온다 — 방송하지 않는다(다른 창 · 원격으로 본문이 새지 않는다).

import { Channel, invoke } from "../ipc";
import type { PermissionEv, SideChatCli, SideChatEv, SideChatStatus } from "$lib/side-chat-api";
import type { RunAdoptable, RunState } from "./model/types";

export { PRODUCER_CHAT_PREFIX, newProducerChatId } from "./orch-tab";

/** 서버 `input::ClientState` */
export type QueueState = "queued" | "dispatching" | "sent" | "cancelled" | "failed";

/** 글은 없다(보낸 창이 쥔다) · `held` = 보류(✕ · 오류 · 프로세스 끝) */
export interface ProducerQueueView {
  items: { clientId: string; state: QueueState }[];
  held: boolean;
}

export type Adoptable = RunAdoptable;

/** 권위는 Run 파일 `producers` */
export interface ProducerAlbum {
  runId: string;
  state: RunState;
  adoptable: Adoptable;
}

/** `live` = 프로세스 없음 · 산 프로세스 · `exiting` = 끝을 알았다 · `ended` = 끝 사건까지 냈다 */
export type ProducerLife = "live" | "exiting" | "ended";

export interface ProducerSnapshot {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  repo: string;
  /** 0 = 아직 안 띄움 */
  epoch: number;
  seq: number;
  status: SideChatStatus;
  life: ProducerLife;
  /** `life: ended` 일 때 — `exited` · `crashed` · `ttl` · `album-ended` · `start-failed` … */
  ended: string | null;
  conversationId: string | null;
  /** 갈라 올 원본 대화(이 채팅 자신의 대화가 서기 전) */
  forkFrom: string | null;
  /** 귀속 앨범이 orphaned(서버 재시작) — 기록만 · 보내기 `[album-orphaned]` */
  readOnly: boolean;
  queue: ProducerQueueView;
  liveTurn: SideChatEv[];
  pending: PermissionEv[];
  album: ProducerAlbum | null;
  /** 지금 도는 깨움 턴 — 꼬리에 사람 말풍선이 없어 다시 붙을 때 화면이 이것으로 다시 세운다 */
  wake: WakeView | null;
}

/** 장부의 열거 낱말 · 그 앨범의 id 만 */
export interface WakeItemView {
  what: string;
  taskId: string | null;
  attemptId: string | null;
}

/** 문장은 싣지 않는다 — id · 낱말 · 수만 */
export interface WakeView {
  wakeId: string;
  runId: string;
  gen: number;
  fromSeq: number;
  toSeq: number;
  items: WakeItemView[];
  /** 문장에 싣지 못한 항목 수(`+N more`) */
  more: number;
  /** 보존 범위 밖 — 항목 없이 "처음부터 읽어라" */
  resync: boolean;
  /** 같은 범위의 재시도(무반응 뒤 한 번) */
  retry: boolean;
}

/** 레지스트리가 그 턴의 `turnStarted` 뒤에 낸다(코어 `seq` 를 올리지 않는다) */
export interface ProducerWokenEv {
  t: "woken";
  wake: WakeView;
}

/** 화면은 `session-gone` 에 스스로 열지 않고 이것을 묻는다 */
export type ProducerStatus =
  | { open: true; snapshot: ProducerSnapshot }
  | { open: false; gone: string; album: ProducerAlbum | null };

/** 레지스트리가 묶음 해제 뒤에 낸다 */
export interface ProducerExitedEv {
  t: "exited";
  code: number | null;
  reason: string;
  why?: string;
  restartable?: boolean;
}

export type ProducerEv = Exclude<SideChatEv, { t: "exited" }> | ProducerExitedEv | ProducerWokenEv;

export interface ProducerEvent {
  chat: string;
  epoch: number;
  seq: number;
  ev: ProducerEv;
}

export type ProducerMode = { kind: "resume"; conv: string } | { kind: "adopt"; run: string };

export interface ProducerOpenArgs {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort?: string | null;
  mode: ProducerMode;
}

/** 띄우지 않는다 — 첫 보내기가 띄운다 */
export function producerChatOpen(a: ProducerOpenArgs): Promise<ProducerSnapshot> {
  return invoke("producer_chat_open", {
    chat: a.chat,
    cli: a.cli,
    model: a.model,
    effort: a.effort ?? null,
    mode: a.mode,
  });
}

/** 사람이 보낸 글만 — `clientId` = 중복 제거 열쇠 */
export function producerChatSend(
  chat: string,
  clientId: string,
  text: string,
): Promise<{ state: QueueState; position?: number; epoch: number }> {
  return invoke("producer_chat_send", { chat, clientId, text });
}

/** ✕ = `deliverQueued: false`(대기열 보류) · [끊고 전달] = true. 쉬는 중이면 false(그때 true 면 보류된 대기열을 곧바로 보낸다) */
export function producerChatInterrupt(chat: string, deliverQueued: boolean): Promise<boolean> {
  return invoke("producer_chat_interrupt", { chat, deliverQueued });
}

export function producerChatSetModel(chat: string, model: string): Promise<boolean> {
  return invoke("producer_chat_set_model", { chat, model });
}

export function producerChatSetEffort(chat: string, effort: string | null): Promise<boolean> {
  return invoke("producer_chat_set_effort", { chat, effort });
}

/** 카드로 선 요청만(스튜디오 밖 Read · Aynx DB 읽기) — 그 밖은 서버가 카드 없이 거절한다 */
export function producerChatDecide(chat: string, epoch: number, requestId: string, decision: "allow" | "deny"): Promise<boolean> {
  return invoke("producer_chat_decide", { chat, epoch, requestId, decision, message: null });
}

/** 이미 보냈으면 `[already-sent]` */
export function producerChatQueueCancel(chat: string, clientId: string): Promise<boolean> {
  return invoke("producer_chat_queue_cancel", { chat, clientId });
}

/** 레지스트리에서 지움 · 대기열 버림 · 재시작 없음 */
export function producerChatClose(chat: string): Promise<boolean> {
  return invoke("producer_chat_close", { chat });
}

export function producerChatAttach(chat: string): Promise<ProducerSnapshot> {
  return invoke("producer_chat_attach", { chat });
}

export function producerChatStatus(chat: string): Promise<ProducerStatus> {
  return invoke("producer_chat_status", { chat });
}

/** 이 창의 통로 하나 — 다시 부르면 서버 · GUI 모두 갈음 */
export function producerChatSubscribe(chat: string, channel: Channel<unknown>): Promise<{ subGen: number; snapshot: ProducerSnapshot }> {
  return invoke("producer_chat_subscribe", { chat, channel });
}

/** 같은 `subGen` 만 — 늦은 정리가 새 구독을 지우지 않는다 */
export function producerChatUnsubscribe(chat: string, subGen: number): Promise<boolean> {
  return invoke("producer_chat_unsubscribe", { chat, subGen });
}

const EV_TAGS: ReadonlySet<string> = new Set([
  "ready", "turnStarted", "userAccepted", "textDelta", "text", "toolStarted", "toolOutput", "toolFinished",
  "permission", "permissionResolved", "turnEnded", "modelChanged", "effortChanged", "notice", "mcpServers", "exited", "woken",
]);

export function isProducerEvent(x: unknown, chat: string): x is ProducerEvent {
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

export function producerChannel(chat: string, handler: (e: ProducerEvent) => void): Channel<unknown> {
  const ch = new Channel<unknown>();
  ch.onmessage = (msg) => {
    if (isProducerEvent(msg, chat)) handler(msg);
  };
  return ch;
}
