// **프로듀서 채팅 명령**(오케스트레이션 2단계 "구조화 프로듀서" 단계 3 — aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md
// 4절 · 5절 · 7절) — Tauri `producer_chat_*`(GUI Rust `server/producer_proxy.rs` → 세션 서버 `server/producer`)의 얇은 손잡이와 모양.
//
// - 프로세스 · stdin · 어댑터는 세션 서버에 산다. 여기는 이름 · 모양뿐이고 **토큰은 없다**(채팅 토큰은 프런트로 오지 않는다).
// - **사건은 구독 통로로만** 온다 — `producer_chat_subscribe(chat, channel)` 이 이 창의 `Channel` 하나를 그 채팅에 걸고(`subGen` 을 받는다)
//   GUI 라우터가 사건 몸의 `subs` 에 든 `(window, subGen)` 의 통로에만 보낸다(방송 없음 — 다른 창 · 원격으로 본문이 새지 않는다).
// - 사건 · 스냅숏의 몸은 사이드 채팅과 같은 `Ev`(`$lib/side-chat-api` — 접기는 `$lib/side-chat-live` 를 같이 쓴다) + 레지스트리 칸(대기열 ·
//   수명 · 귀속 앨범) · 끝 사건의 `why` · `restartable`.
// 상태는 `app/producer-chat.svelte.ts`, 그림은 `orchestration/player/ProducerChat.svelte`.

import { Channel, invoke } from "../ipc";
import type { PermissionEv, SideChatCli, SideChatEv, SideChatStatus } from "$lib/side-chat-api";
import type { RunAdoptable, RunState } from "./model/types";

export { PRODUCER_CHAT_PREFIX, newProducerChatId } from "./orch-tab";

/** 대기열 항목의 서버 상태(`input::ClientState`) */
export type QueueState = "queued" | "dispatching" | "sent" | "cancelled" | "failed";

/** 스냅숏의 대기열(`queue_view`) — 글은 없다(보낸 창이 쥔다) · `held` = 보류(✕ · 오류 · 프로세스 끝) */
export interface ProducerQueueView {
  items: { clientId: string; state: QueueState }[];
  held: boolean;
}

/** 이어받기 판정(서버 `adopt_verdict` — 라이브러리 · 채팅 UI 가 같은 판정을 읽는다 · 노트 2-4) */
export type Adoptable = RunAdoptable;

/** 그 채팅의 귀속 앨범(오케스트레이션 장부 — 권위는 Run 파일 `producers`) */
export interface ProducerAlbum {
  runId: string;
  state: RunState;
  adoptable: Adoptable;
}

/** 프로세스 수명(`live` = 프로세스 없음 · 산 프로세스 · `exiting` = 끝을 알았다 · `ended` = 끝 사건까지 냈다) */
export type ProducerLife = "live" | "exiting" | "ended";

/** `producer_chat_open` · `_attach` · `_subscribe` 의 스냅숏 */
export interface ProducerSnapshot {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string | null;
  /** 스튜디오(서버가 맡기기에서 다시 읽은 경로) */
  repo: string;
  /** 프로세스 세대(0 = 아직 안 띄움) */
  epoch: number;
  seq: number;
  status: SideChatStatus;
  life: ProducerLife;
  /** 끝난 이유(`exited` · `crashed` · `ttl` · `album-ended` · `start-failed` …) — `life: ended` 일 때 */
  ended: string | null;
  conversationId: string | null;
  /** (단계 5) 갈라 올 원본 대화(이 채팅 자신의 대화가 서기 전) */
  forkFrom: string | null;
  /** 귀속 앨범이 orphaned(서버 재시작) — 기록만 · 보내기 `[album-orphaned]` */
  readOnly: boolean;
  queue: ProducerQueueView;
  liveTurn: SideChatEv[];
  pending: PermissionEv[];
  album: ProducerAlbum | null;
  /** (단계 4) 지금 도는 깨움 턴의 표지(F5 · 다시 붙기 — 꼬리에 사람 말풍선이 없어 화면이 다시 세운다) */
  wake: WakeView | null;
}

/** 앱이 깨움 항목 하나 — 장부의 열거 낱말 · 그 앨범의 id 만(서버 `WakeNote::view`) */
export interface WakeItemView {
  what: string;
  taskId: string | null;
  attemptId: string | null;
}

/** 앱이 깨움 하나(서버 `orchestration::wake` — 문장은 싣지 않는다 · id · 낱말 · 수만) */
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
  /** 같은 범위의 재시도(무반응 뒤 한 번) — 화면 알약이 "다시 알림" 표지를 단다 */
  retry: boolean;
}

/** (단계 4) 깨움 턴이 섰다 — 레지스트리가 그 턴의 `turnStarted` **뒤에** 낸다(코어 `seq` 를 올리지 않는다) */
export interface ProducerWokenEv {
  t: "woken";
  wake: WakeView;
}

/** `producer_chat_status` — 열려 있으면 스냅숏, 아니면 끝난 이유와 귀속 앨범(화면은 `session-gone` 에 스스로 열지 않고 이것을 묻는다) */
export type ProducerStatus =
  | { open: true; snapshot: ProducerSnapshot }
  | { open: false; gone: string; album: ProducerAlbum | null };

/** 프로듀서의 끝 사건 — 레지스트리가 묶음 해제 뒤에 낸다(`why` · 다음 보내기가 다시 띄우나) */
export interface ProducerExitedEv {
  t: "exited";
  code: number | null;
  reason: string;
  why?: string;
  restartable?: boolean;
}

export type ProducerEv = Exclude<SideChatEv, { t: "exited" }> | ProducerExitedEv | ProducerWokenEv;

/** 사건 봉투(서버 이벤트 `producer-chat-event` — 라우터가 구독 통로로) */
export interface ProducerEvent {
  chat: string;
  epoch: number;
  seq: number;
  ev: ProducerEv;
}

/** 사람이 연 앨범의 대화를 다시 붙이거나 이어받는다. */
export type ProducerMode = { kind: "resume"; conv: string } | { kind: "adopt"; run: string };

export interface ProducerOpenArgs {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort?: string | null;
  mode: ProducerMode;
}

/** 연다 — **띄우지 않는다**(첫 보내기가 띄운다) */
export function producerChatOpen(a: ProducerOpenArgs): Promise<ProducerSnapshot> {
  return invoke("producer_chat_open", {
    chat: a.chat,
    cli: a.cli,
    model: a.model,
    effort: a.effort ?? null,
    mode: a.mode,
  });
}

/** **사람이 보낸 글** — 서버 전송기가 곧바로(`dispatching` — 프로세스가 없으면 띄운다) 또는 대기열(`queued{position}`)로. `clientId` = 중복 제거 열쇠 */
export function producerChatSend(
  chat: string,
  clientId: string,
  text: string,
): Promise<{ state: QueueState; position?: number; epoch: number }> {
  return invoke("producer_chat_send", { chat, clientId, text });
}

/** 끊기 — ✕ = `deliverQueued: false`(대기열 보류) · [끊고 전달] = true. 쉬는 중이면 false(그때 true 면 보류된 대기열을 곧바로 보낸다) */
export function producerChatInterrupt(chat: string, deliverQueued: boolean): Promise<boolean> {
  return invoke("producer_chat_interrupt", { chat, deliverQueued });
}

export function producerChatSetModel(chat: string, model: string): Promise<boolean> {
  return invoke("producer_chat_set_model", { chat, model });
}

export function producerChatSetEffort(chat: string, effort: string | null): Promise<boolean> {
  return invoke("producer_chat_set_effort", { chat, effort });
}

/** 사람의 권한 결정 — 카드로 선 요청만(스튜디오 밖 Read · AYNX DB 읽기 — 그 밖은 서버가 카드 없이 거절해 표에 없다) */
export function producerChatDecide(chat: string, epoch: number, requestId: string, decision: "allow" | "deny"): Promise<boolean> {
  return invoke("producer_chat_decide", { chat, epoch, requestId, decision, message: null });
}

/** 대기열 항목 취소 — 이미 보냈으면 `[already-sent]` */
export function producerChatQueueCancel(chat: string, clientId: string): Promise<boolean> {
  return invoke("producer_chat_queue_cancel", { chat, clientId });
}

/** 닫는다(레지스트리에서 지움 · 대기열 버림 · 재시작 없음) — 탭 · 잎이 사라질 때 */
export function producerChatClose(chat: string): Promise<boolean> {
  return invoke("producer_chat_close", { chat });
}

export function producerChatAttach(chat: string): Promise<ProducerSnapshot> {
  return invoke("producer_chat_attach", { chat });
}

export function producerChatStatus(chat: string): Promise<ProducerStatus> {
  return invoke("producer_chat_status", { chat });
}

/** 구독을 건다 — 이 창의 통로 하나(다시 부르면 서버 · GUI 모두 갈음) · 답 = `{subGen, snapshot}` */
export function producerChatSubscribe(chat: string, channel: Channel<unknown>): Promise<{ subGen: number; snapshot: ProducerSnapshot }> {
  return invoke("producer_chat_subscribe", { chat, channel });
}

/** 구독을 푼다 — 같은 `subGen` 만(늦은 정리가 새 구독을 지우지 않는다) */
export function producerChatUnsubscribe(chat: string, subGen: number): Promise<boolean> {
  return invoke("producer_chat_unsubscribe", { chat, subGen });
}

const EV_TAGS: ReadonlySet<string> = new Set([
  "ready", "turnStarted", "userAccepted", "textDelta", "text", "toolStarted", "toolOutput", "toolFinished",
  "permission", "permissionResolved", "turnEnded", "modelChanged", "effortChanged", "notice", "mcpServers", "exited", "woken",
]);

/** 봉투 모양인가 — 통로로 온 값을 믿기 전에 본다(모르는 꼬리표는 버린다) */
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

/** 구독 통로 하나를 짓는다(채팅마다) — 받은 값은 모양을 본 뒤 손에 */
export function producerChannel(chat: string, handler: (e: ProducerEvent) => void): Channel<unknown> {
  const ch = new Channel<unknown>();
  ch.onmessage = (msg) => {
    if (isProducerEvent(msg, chat)) handler(msg);
  };
  return ch;
}
