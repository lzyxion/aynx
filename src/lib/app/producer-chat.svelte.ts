import { listen } from "../ipc";
import { createProducerObservers } from "$lib/orchestration/producer-observers";
import {
  producerChannel,
  producerChatAttach,
  producerChatClose,
  producerChatDecide,
  producerChatInterrupt,
  producerChatOpen,
  producerChatQueueCancel,
  producerChatSend,
  producerChatSetEffort,
  producerChatSetModel,
  producerChatStatus,
  producerChatSubscribe,
  producerChatUnsubscribe,
  type ProducerAlbum,
  type ProducerEvent,
  type ProducerLife,
  type ProducerQueueView,
  type ProducerSnapshot,
  type WakeView,
} from "$lib/orchestration/producer-api";
import { seqStep, type SideChatCli, type SideChatSnapshot } from "$lib/side-chat-api";
import { addSent, clearEnded, emptyLive, foldLive, markSendFailed, seedLive, type LiveState } from "$lib/side-chat-live";
import { t } from "$lib/i18n/i18n.svelte.js";
import { WAKE_NOTE, goneReadOnly, producerOpenMode } from "$lib/orchestration/model/producer";

/**
 * **프로듀서 채팅의 지금 상태**(오케스트레이션 2단계 "구조화 프로듀서" 단계 3 — aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md
 * 4-2 · 5-2 · 7절) — 채팅마다 세션 서버 프로듀서 레지스트리(`server/producer`)와 맞춘 사본. 그림은 `orchestration/player/ProducerChat.svelte`.
 *
 * 사이드 채팅의 상태 모듈(`app/side-chat-live`)과 **같은 접기**(`$lib/side-chat-live` — 사건 → 지금 턴 꼬리)를 쓰되, 재접속 정책 · 입력 ·
 * 구독이 종류별로 달라 모듈은 따로 둔다(사이드 채팅 동작은 그대로 — 노트 5-2 의 "종류별 재접속 정책"):
 *
 * | 상황 | 사이드 채팅 | 프로듀서(여기) |
 * | --- | --- | --- |
 * | 구독 | 창마다 통로 하나(`side_chat_subscribe`) | **채팅마다** 통로 하나(`producer_chat_subscribe(chat, channel)` → `subGen`) — GUI 라우터가 그 `(창, subGen)` 에만 |
 * | 서버 표에 없음(`session-gone`) | 스스로 `open` | **열지 않는다** → `producer_chat_status` 의 끝난 이유를 그린다. 사람이 다시 말하면 그때 연다(대화 id 가 있으면 resume) |
 * | 세대 바뀜 | 다시 맞춰 재시도 | 다시 **구독**만 — 보내기는 `clientId` 로 서버가 중복을 거른다 |
 * | 보내기 | 턴 중엔 막음 | 늘 받는다 — 서버 전송기가 곧바로(`dispatching`) 또는 **대기열**(`queued{position}` · ≤3) |
 *
 * - 레지스트리 알림(`queue-changed` · `queue-failed`)은 `seq` 를 올리지 않는다 — 대기열 보기는 스냅숏에만 있어 그때 `attach` 로 다시 읽는다.
 * - 대기열 글은 서버 보기에 없다(보낸 창만 안다) — 이 창이 보낸 글을 `clientId` 로 쥐고(`texts`), 대기열에서 나간 글이 `userAccepted` 로
 *   받아지면 그 글을 꼬리에 세운다.
 * - **stdin 에 닿는 것은 사람이 보낸 글뿐**(이 모듈이 짓는 글 없음) — 이어받기 문장은 입력 칸을 **채우기만** 한다([`fillProducer`]).
 * - (단계 4) **앱이 깨움**: 서버가 깨움 턴의 `turnStarted` 뒤에 `woken{wake}` 를 낸다(코어 `seq` 밖) — 꼬리에 알림 항목(`notice{app-woken, wakeId}`)을
 *   세우고 재료(`wakes` — id · 낱말 · 수)를 쥔다. 다시 붙으면 스냅숏의 `wake` 로 다시 세우고, 그 턴이 기록에 들면(최신 쪽을 받으면) 꼬리의 표지를
 *   걷는다(기록이 같은 깨움을 알약으로 그린다 — 앨범의 `wakes` 기록과 맞을 때만).
 * 토큰은 없다(채팅 토큰은 서버 프로세스 환경 · 임시 파일에만). 저장하지 않는다(F5 = 다시 구독).
 */

/** 붙을 채팅 — 프로듀서 잎의 주소(`PaneSpec.producer`)에서 짓는다 */
export interface ProducerTarget {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string;
  studio: string;
  /** 턴이 선 대화 id(서버 표를 잃었을 때 resume) */
  conv: string | null;
  /**
   * (단계 5) 갈라 올 원본 대화 id([오케스트레이션으로 이어 가기] — 같은 CLI). 이 채팅 자신의 대화(`conv`)가 서기 전에 열면 `fork{from}` 으로 연다 ·
   * 그동안 기록은 원본 대화를 보인다. 없으면 `null`(옛 호출부는 칸을 비워도 된다).
   */
  forkFrom?: string | null;
  /** 이어받기는 fresh 대신 대상 앨범에 귀속만 세운다. */
  adoptRun?: string;
}

export interface ProducerLive {
  cli: SideChatCli;
  state: LiveState;
  epoch: number;
  seq: number;
  /** 스냅숏을 받았나(아니면 사건을 모은다) */
  attached: boolean;
  /** 보내기 · 열기가 도는 중(첫 보내기 = 서버가 CLI 를 띄우고 준비를 기다린다) */
  sending: boolean;
  /** 마지막 실패 한 줄 — 다음 성공이 걷는다 */
  error: string | null;
  /** 이 창의 구독 세대(풀 때 같은 값만) */
  subGen: number | null;
  life: ProducerLife | null;
  /** 끝난 이유(스냅숏 `ended` · 끝 사건 `why`) */
  ended: string | null;
  /** 서버 표에 없다 — 끝난 이유(`closed` · `ttl` · `album-ended` · `server-restarted` …) */
  gone: string | null;
  readOnly: boolean;
  queue: ProducerQueueView;
  album: ProducerAlbum | null;
  /** 이 창이 보낸 글(`clientId` → 글) — 대기열 줄 · 받아진 글 */
  texts: Record<string, string>;
  /** 기록을 읽는 대화 id */
  historyConv: string | null;
  /** 정책 거절 알림 수(`denied-by-policy` — 머리 아래 한 줄) */
  denied: number;
  /** 앱이 깨움 — wakeId → 재료(꼬리의 표지가 읽는다) */
  wakes: Record<string, WakeView>;
}

const EMPTY_QUEUE: ProducerQueueView = { items: [], held: false };

const lives = $state<Record<string, ProducerLive>>({});
const targets = new Map<string, ProducerTarget>();
const joining = new Map<string, Promise<void>>();
const buffers = new Map<string, ProducerEvent[]>();
let clientSeq = 0;
let reconnectWatch = false;
/** 턴이 선 대화 id 를 잎의 주소에 적는 손(`app/orchestration` 이 건다 — 이 모듈이 탭을 고치지 않게) */
let convHook: ((chat: string, conv: string) => void) | null = null;

/** 그 채팅의 지금 상태 — 반응형(아직 안 붙었으면 `null`) */
export function producerLiveOf(chat: string): ProducerLive | null {
  return lives[chat] ?? null;
}

/** 대화 id 를 잎에 적는 손을 건다 */
export function setProducerConvHook(f: ((chat: string, conv: string) => void) | null): void {
  convHook = f;
}

// ---------------------------------------------------------------------------
// 실패 문구 — 서버 오류 글은 영어뿐이라 이유 코드로 고른다
// ---------------------------------------------------------------------------

/** `[낱말]` 표식이 있나(프로듀서 낱말은 공용 표 밖이라 여기서 본다) */
export function reasonIs(e: unknown, code: string): boolean {
  return String(e instanceof Error ? e.message : e).includes(`[${code}]`);
}

/** 실패 → 사람 말 한 줄 */
export function producerErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const known: [string, Parameters<typeof t>[0]][] = [
    ["queue-full", "orch.producer.err.queueFull"],
    ["album-orphaned", "orch.producer.err.orphaned"],
    ["exiting", "orch.producer.err.exiting"],
    ["start-timeout", "orch.producer.err.startTimeout"],
    ["exited", "orch.producer.err.exited"],
    ["already-sent", "orch.producer.err.alreadySent"],
    ["producer-mcp-unavailable", "orch.producer.err.noMcp"],
    ["server-outdated", "orch.producer.err.outdated"],
  ];
  for (const [code, key] of known) if (msg.includes(`[${code}]`)) return t(key);
  return msg.replace(/\[[a-z0-9-]+\]\s*/g, "");
}

// ---------------------------------------------------------------------------
// 붙기 · 다시 맞추기
// ---------------------------------------------------------------------------

/** 스냅숏 → 접기의 씨앗 모양(사이드 채팅 스냅숏과 같은 칸만 읽는다) */
function asSeed(s: ProducerSnapshot): SideChatSnapshot {
  return {
    link: null,
    chat: s.chat,
    cli: s.cli,
    model: s.model,
    effort: s.effort,
    epoch: s.epoch,
    leaseEpoch: 0,
    seq: s.seq,
    status: s.status,
    conversationId: s.conversationId,
    liveTurn: s.liveTurn,
    pending: s.pending,
  };
}

function blank(tg: ProducerTarget, prev: ProducerLive | null): ProducerLive {
  return {
    cli: tg.cli,
    state: prev?.state ?? emptyLive("stopped", tg.model, tg.conv),
    epoch: prev?.epoch ?? 0,
    seq: prev?.seq ?? 0,
    attached: false,
    sending: prev?.sending ?? false,
    error: null,
    subGen: null,
    life: null,
    ended: null,
    gone: null,
    readOnly: false,
    queue: EMPTY_QUEUE,
    album: null,
    texts: prev?.texts ?? {},
    // 갈라 온 채팅은 자기 대화가 서기 전까지 원본 대화의 기록을 보인다(턴이 끝나면 자기 대화로 — `apply`)
    historyConv: prev?.historyConv ?? tg.conv ?? tg.forkFrom ?? null,
    denied: prev?.denied ?? 0,
    wakes: prev?.wakes ?? {},
  };
}

/** 꼬리에 깨움 표지가 없으면 맨 앞에 세운다(다시 붙기 — 지금 도는 깨움 턴) */
function withWakeNote(state: LiveState, wakeId: string): LiveState {
  if (state.entries.some((e) => e.kind === "notice" && e.code === WAKE_NOTE && e.detail === wakeId)) return state;
  return { ...state, entries: [{ n: state.next, kind: "notice", code: WAKE_NOTE, detail: wakeId }, ...state.entries], next: state.next + 1 };
}

/** 기록이 받은 턴의 깨움 표지는 걷는다(기록이 알약으로 그린다) — 지금 턴의 것은 둔다 */
function dropRecordedWakes(state: LiveState): LiveState {
  const keep = state.entries.filter((e) => !(e.kind === "notice" && e.code === WAKE_NOTE && e.n < state.endedAt));
  return keep.length === state.entries.length ? state : { ...state, entries: keep };
}

/** 스냅숏을 들인다 — 같은 CLI 의 다시 맞추기면 알던 꼬리를 잇는다 */
function adopt(chat: string, snap: ProducerSnapshot, subGen: number | null): void {
  const prev = lives[chat] ?? null;
  const same = prev !== null && prev.cli === snap.cli;
  let state = seedLive(asSeed(snap), same ? prev.state : null);
  if (snap.wake && snap.status === "running") state = withWakeNote(state, snap.wake.wakeId);
  const tg = targets.get(chat);
  const base = blank(tg ?? { chat, cli: snap.cli, model: snap.model, effort: snap.effort ?? "", studio: snap.repo, conv: null }, same ? prev : null);
  lives[chat] = {
    ...base,
    cli: snap.cli,
    state,
    epoch: snap.epoch,
    seq: snap.seq,
    attached: true,
    subGen: subGen ?? prev?.subGen ?? null,
    life: snap.life,
    ended: snap.ended,
    gone: null,
    readOnly: snap.readOnly,
    queue: snap.queue ?? EMPTY_QUEUE,
    album: snap.album,
    historyConv: base.historyConv ?? tg?.conv ?? (snap.status === "running" ? null : snap.conversationId),
    wakes: snap.wake ? { ...base.wakes, [snap.wake.wakeId]: snap.wake } : base.wakes,
  };
  const buf = buffers.get(chat) ?? [];
  buffers.delete(chat);
  for (const e of buf) apply(chat, e);
}

/** 서버 표에 없다 — 끝난 이유와 귀속 앨범을 그린다(열지 않는다) */
async function markGone(chat: string): Promise<void> {
  const tg = targets.get(chat);
  if (!tg) return;
  let gone = "server-restarted";
  let album: ProducerAlbum | null = null;
  try {
    const s = await producerChatStatus(chat);
    if (s.open) {
      // 그 사이 열렸다(다른 창) — 구독으로 다시 붙는다
      await subscribe(chat);
      return;
    }
    gone = s.gone;
    album = s.album;
  } catch {
    /* 서버 없음 — 재시작으로 본다 */
  }
  const prev = lives[chat] ?? null;
  // 귀속 앨범이 orphaned 이고 되찾을 수 없으면 처음부터 기록만(실기 a FAIL 2 — "말하면 다시 띄웁니다" 를 보이지 않는다 · 서버 `open` 과 같은 판정)
  const readOnly = goneReadOnly(album);
  lives[chat] = {
    ...blank(tg, prev),
    gone,
    album,
    readOnly,
    attached: true,
    state: { ...(prev?.state ?? emptyLive()), status: "stopped" },
  };
}

const subscriptionSeats = new Map<string, symbol>();
/** 구독을 건다(다시 걸면 갈음) — 스냅숏을 들인다. 서버 표에 없으면 [`markGone`] */
async function subscribe(chat: string): Promise<void> {
  const owner = Symbol();
  subscriptionSeats.set(chat, owner);
  buffers.set(chat, buffers.get(chat) ?? []);
  try {
    const r = await producerChatSubscribe(
      chat,
      producerChannel(chat, (e) => {
        // 늦게 온 옛 Channel 사건은 같은 chat의 새 사본에 섞지 않는다.
        if (subscriptionSeats.get(chat) === owner) onEvent(chat, e);
      }),
    );
    if (subscriptionSeats.get(chat) !== owner) {
      void producerChatUnsubscribe(chat, r.subGen).catch(() => false);
      return;
    }
    adopt(chat, r.snapshot, r.subGen);
  } catch (e) {
    if (subscriptionSeats.get(chat) !== owner) return;
    if (reasonIs(e, "session-gone")) {
      await markGone(chat);
      return;
    }
    throw e;
  }
}

/**
 * **붙는다**(잎 마운트 — 연 채팅만) — 이 페이지에서 한 번. 서버 표에 없으면 끝난 이유를 그린다(스스로 열지 않는다 — 다음 보내기가 연다).
 */
export function joinProducer(tg: ProducerTarget): Promise<void> {
  targets.set(tg.chat, tg);
  // 재연결 듣기는 먼저 건다 — 홈 칸에서 막 연 채팅은 보내기가 이미 붙여 둬(attached) 아래에서 돌아가므로, 여기서 빠지면 세션 서버 재시작을
  // 못 듣는다(하네스 ⑪ 서버 재시작 흉내에서 드러남 — 10-30)
  watchReconnect();
  if (lives[tg.chat]?.attached) return Promise.resolve();
  const running = joining.get(tg.chat);
  if (running) return running;
  let p!: Promise<void>;
  p = (async () => {
    try {
      await subscribe(tg.chat);
    } catch (e) {
      lives[tg.chat] = { ...blank(tg, lives[tg.chat] ?? null), error: producerErrorText(e) };
    } finally {
      if (joining.get(tg.chat) === p) joining.delete(tg.chat);
    }
  })();
  joining.set(tg.chat, p);
  return p;
}

/** 다시 맞춘다(빈틈 · 세대 · 서버 재연결) — 구독을 다시 건다 */
async function resync(chat: string): Promise<void> {
  if (!targets.has(chat) || joining.has(chat)) return;
  const l = lives[chat];
  if (l) l.attached = false;
  let p!: Promise<void>;
  p = (async () => {
    try {
      await subscribe(chat);
    } catch (e) {
      const now = lives[chat];
      if (now) {
        now.attached = true;
        now.error = producerErrorText(e);
      }
    } finally {
      if (joining.get(chat) === p) joining.delete(chat);
    }
  })();
  joining.set(chat, p);
  await p;
}

/** 대기열 · 수명 칸만 다시 읽는다(레지스트리 알림 — `seq` 가 오르지 않는다) */
async function refreshQueue(chat: string): Promise<void> {
  try {
    const s = await producerChatAttach(chat);
    const l = lives[chat];
    if (!l) return;
    l.queue = s.queue ?? EMPTY_QUEUE;
    l.life = s.life;
    l.ended = s.ended;
    l.readOnly = s.readOnly;
    l.album = s.album;
  } catch {
    /* 다음 사건 · 보내기가 다시 맞춘다 */
  }
}

function onEvent(chat: string, e: ProducerEvent): void {
  const l = lives[chat];
  if (!l || !l.attached) {
    buffers.get(chat)?.push(e);
    return;
  }
  apply(chat, e);
}

/** 레지스트리 알림 낱말(코어 `seq` 를 올리지 않는다) */
const REGISTRY_NOTICES: ReadonlySet<string> = new Set(["queue-changed", "queue-failed"]);

function apply(chat: string, e: ProducerEvent): void {
  const l = lives[chat];
  if (!l) return;
  const ev = e.ev;
  if (ev.t === "woken") {
    // 깨움 턴이 섰다 — 코어 `seq` 밖(턴 시작 뒤에 온다): 재료를 쥐고 꼬리에 표지
    l.wakes = { ...l.wakes, [ev.wake.wakeId]: ev.wake };
    l.state = foldLive(l.state, { t: "notice", code: WAKE_NOTE, detail: ev.wake.wakeId });
    return;
  }
  if (ev.t === "notice" && REGISTRY_NOTICES.has(ev.code)) {
    if (ev.code === "queue-failed") l.error = t("orch.producer.err.queueFailed");
    void refreshQueue(chat);
    return;
  }
  const step = seqStep(l.seq, e.seq);
  if (step === "drop") return;
  if (step === "gap") {
    void resync(chat);
    return;
  }
  l.seq = e.seq;
  l.epoch = e.epoch;
  // 대기열에서 나간 이 창의 글 — 받아지면 꼬리에 세운다(보낼 때는 대기열 줄에만 있었다)
  if (ev.t === "userAccepted" && ev.clientId && l.texts[ev.clientId] !== undefined) {
    const has = l.state.entries.some((x) => x.kind === "user" && x.clientId === ev.clientId);
    if (!has) l.state = addSent(l.state, l.texts[ev.clientId], ev.clientId);
  }
  if (ev.t === "notice" && ev.code === "denied-by-policy") l.denied += 1;
  const ended = l.state.ended;
  l.state = foldLive(l.state, ev as Parameters<typeof foldLive>[1]);
  if (ev.t === "exited") {
    l.life = "ended";
    l.ended = ev.why ?? null;
  }
  if (ev.t === "ready") {
    l.life = "live";
    l.ended = null;
  }
  const conv = l.state.conversationId;
  if (ev.t === "turnStarted" && conv) {
    const tg = targets.get(chat);
    if (tg) targets.set(chat, { ...tg, conv });
    convHook?.(chat, conv);
  }
  if (l.state.ended !== ended && conv) l.historyConv = conv;
  if (ev.t === "turnEnded" || ev.t === "exited") void refreshQueue(chat);
}

/** 세션 서버가 (다시) 붙었다 — 붙어 있던 채팅을 다시 구독한다(서버 재시작이면 표가 비어 끝난 이유를 그린다) */
function watchReconnect(): void {
  if (reconnectWatch || typeof window === "undefined") return;
  reconnectWatch = true;
  void listen("session-server-connected", () => {
    for (const chat of Object.keys(lives)) void resync(chat);
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// 조작 — 프로듀서 잎이 부른다
// ---------------------------------------------------------------------------

/** 서버 표에 연다(띄우지 않는다) — 대화 id 가 있으면 resume · 그다음 구독 */
async function openAndSubscribe(tg: ProducerTarget): Promise<void> {
  const snap = await producerChatOpen({
    chat: tg.chat,
    cli: tg.cli,
    model: tg.model,
    effort: tg.effort || null,
    mode: producerOpenMode(tg),
  });
  // 연 답을 먼저 들이고(사건이 오기 전) 구독이 갈음한다
  adopt(tg.chat, snap, null);
  await subscribe(tg.chat);
}

/**
 * **서버에 연다**(띄우지 않는다 — [새 프로듀서로 이어받기] · [다시 붙이기]: 칸에 문장을 채우기 전에 채팅을 세워 둔다). 실패는 그 채팅의 오류 한 줄.
 */
export async function openProducer(tg: ProducerTarget): Promise<boolean> {
  targets.set(tg.chat, tg);
  if (!lives[tg.chat]) lives[tg.chat] = { ...blank(tg, null), attached: true };
  try {
    await openAndSubscribe(tg);
    return true;
  } catch (e) {
    const l = lives[tg.chat];
    if (l) l.error = producerErrorText(e);
    return false;
  }
}

/** 앨범 시작 op가 이미 보낸 첫 말을 이 창의 꼬리에 등록한다. 전송은 하지 않는다. */
export function rememberAlbumFirst(tg: ProducerTarget, clientId: string, text: string, sent: boolean): void {
  targets.set(tg.chat, tg);
  const live = lives[tg.chat] ??= blank(tg, null);
  if (!sent) return;
  live.texts = { ...live.texts, [clientId]: text };
  if (!live.state.entries.some((e) => e.kind === "user" && e.clientId === clientId)) live.state = addSent(live.state, text, clientId);
}

/** 보내기를 지금 곧바로 전송할 것으로 보나(쉬고 · 대기열이 비었다 — 꼬리에 흐린 말풍선을 미리 세운다) */
function likelyDispatch(l: ProducerLive | null): boolean {
  if (!l) return true;
  return l.state.status !== "running" && l.queue.items.length === 0 && !l.sending;
}

/**
 * **사람이 보낸 글** — 서버 전송기로(쉬면 곧바로 · 아니면 대기열). 서버 표에 없으면(처음 · TTL · 서버 재시작) 먼저 연다(대화 id 가 있으면
 * resume). 기록만(`readOnly`)이면 거절. 받았으면 참(칸을 비운다 — 실패는 오류 줄 · 말풍선에 남는다).
 */
export function sendProducer(tg: ProducerTarget, text: string): boolean {
  targets.set(tg.chat, { ...(targets.get(tg.chat) ?? {}), ...tg, conv: targets.get(tg.chat)?.conv ?? tg.conv });
  const l = lives[tg.chat] ?? null;
  if (text.trim() === "" || l?.readOnly) return false;
  const clientId = `c${Date.now().toString(36)}${(++clientSeq).toString(36)}`;
  const optimistic = likelyDispatch(l);
  if (!lives[tg.chat]) lives[tg.chat] = { ...blank(tg, null), attached: true };
  const now = lives[tg.chat];
  now.texts = { ...now.texts, [clientId]: text };
  if (optimistic) now.state = addSent(now.state, text, clientId);
  now.sending = true;
  now.error = null;
  void (async () => {
    try {
      const cur = lives[tg.chat];
      if (!cur || cur.gone !== null || cur.subGen === null) await openAndSubscribe(targets.get(tg.chat) ?? tg);
      const r = await producerChatSend(tg.chat, clientId, text);
      const after = lives[tg.chat];
      if (after) {
        if (r.epoch > after.epoch) after.epoch = r.epoch;
        if (r.state === "queued") {
          // 꼬리의 말풍선은 걷는다 — 대기열 줄이 그린다(받아지면 다시 선다)
          after.state = { ...after.state, entries: after.state.entries.filter((x) => !(x.kind === "user" && x.clientId === clientId)) };
          void refreshQueue(tg.chat);
        }
      }
    } catch (e) {
      const after = lives[tg.chat];
      if (after && reasonIs(e, "album-orphaned")) {
        // 그 사이 앨범이 orphaned(서버 재시작) — 오류 줄을 겹쳐 세우지 않고 기록만 띠 하나로(입력 칸은 사라진다). 보낸 글은 "보내지 못했습니다"
        // 말풍선으로 남겨 무엇이 안 갔는지 보이게 한다
        after.state = markSendFailed(after.state, clientId);
        after.readOnly = true;
        after.error = null;
      } else if (after) {
        after.state = markSendFailed(after.state, clientId);
        after.error = producerErrorText(e);
        if (reasonIs(e, "session-gone")) void markGone(tg.chat);
      }
    } finally {
      const after = lives[tg.chat];
      if (after) after.sending = false;
    }
  })();
  return true;
}

/** ✕(`deliverQueued: false` — 대기열 보류) · [끊고 전달](true) · 보류된 대기열 [보내기](쉬는 중의 true) */
export async function interruptProducer(chat: string, deliverQueued: boolean): Promise<void> {
  try {
    await producerChatInterrupt(chat, deliverQueued);
    void refreshQueue(chat);
  } catch (e) {
    const l = lives[chat];
    if (l) l.error = producerErrorText(e);
  }
}

/** 대기열 항목 [취소] — 이미 보냈으면 한 줄 */
export async function cancelQueued(chat: string, clientId: string): Promise<void> {
  try {
    await producerChatQueueCancel(chat, clientId);
  } catch (e) {
    const l = lives[chat];
    if (l) l.error = producerErrorText(e);
  }
  void refreshQueue(chat);
}

/** 사람의 권한 결정 — 이미 끝난 요청이면 다시 맞춘다 */
export async function decideProducer(chat: string, requestId: string, decision: "allow" | "deny"): Promise<void> {
  const l = lives[chat];
  try {
    await producerChatDecide(chat, l?.epoch ?? 0, requestId, decision);
  } catch (e) {
    if (reasonIs(e, "unknown-request") || reasonIs(e, "stale-chat")) {
      void resync(chat);
      return;
    }
    if (l) l.error = producerErrorText(e);
  }
}

/** [다시 띄우기] — 끝난 채팅을 지금 뜻으로 다시 연다(띄우지는 않는다 — 다음 보내기가 띄운다 · 대화 id 가 있으면 resume) */
export async function restartProducer(tg: ProducerTarget): Promise<void> {
  targets.set(tg.chat, { ...tg, conv: targets.get(tg.chat)?.conv ?? tg.conv });
  try {
    await openAndSubscribe(targets.get(tg.chat) ?? tg);
    const l = lives[tg.chat];
    if (l) l.state = { ...l.state, entries: l.state.entries.filter((e) => e.kind !== "exited") };
  } catch (e) {
    const l = lives[tg.chat];
    if (l) l.error = producerErrorText(e);
  }
}

/** 기록의 최신 쪽을 받았다 — 끝난 턴의 꼬리를 걷는다 */
export function clearEndedProducer(chat: string): void {
  const l = lives[chat];
  if (l) l.state = dropRecordedWakes(clearEnded(l.state));
}

/**
 * **대화 중 모델 · 강도 바꾸기**(사람 칩 — 제어 프레임 op `producer_chat_set_model` · `_set_effort`). 띄운 프로세스면 그 CLI 에 곧바로(다음 턴부터),
 * 아직이면 서버 칸만 바꾼다(다음 띄우기가 쓴다). 실패는 오류 한 줄.
 */
export async function retuneProducer(chat: string, p: { model?: string; effort?: string }): Promise<boolean> {
  const l = lives[chat];
  try {
    if (p.model !== undefined) {
      await producerChatSetModel(chat, p.model);
      if (l) l.state = { ...l.state, model: p.model };
    }
    if (p.effort !== undefined) {
      await producerChatSetEffort(chat, p.effort || null);
      if (l) l.state = { ...l.state, effort: p.effort || null };
    }
    const tg = targets.get(chat);
    if (tg) targets.set(chat, { ...tg, ...(p.model !== undefined ? { model: p.model } : {}), ...(p.effort !== undefined ? { effort: p.effort } : {}) });
    return true;
  } catch (e) {
    if (l) l.error = producerErrorText(e);
    return false;
  }
}

export function dismissProducerError(chat: string): void {
  const l = lives[chat];
  if (l) l.error = null;
}

export function dismissProducerDenied(chat: string): void {
  const l = lives[chat];
  if (l) l.denied = 0;
}

/**
 * **사람이 [프로듀서 끝내기]를 확인했다** — 서버 레지스트리에서 지운다(대기열 버림 · 재시작 없음). 귀속 앨범이 있으면
 * 서버가 끝 순서대로 묶음을 푼다(조율 멈춤 — 라이브러리 [새 프로듀서로 이어받기]).
 */
export async function closeProducerLive(chat: string): Promise<void> {
  // 사람이 명시적으로 끝낸다. 실패는 호출한 확인 화면에 보여 준다.
  await producerChatClose(chat);
  await markGone(chat);
}

/** 같은 창에서 같은 앨범을 여러 잎으로 보아도 마지막 표시만 구독을 푼다. */
export const observeProducer = createProducerObservers<ProducerTarget>((target) => { void joinProducer(target); }, leaveProducer);

/**
 * **떠난다**(단계 5 — 잎이 이 창을 떠났지만 채팅은 산다: 탭 이관 · 뜯기로 다른 창에 갔다 · 원격 창의 거울에서 빠졌다) — 이 창의 구독만 풀고(같은
 * `subGen` 만 — 새 창의 구독은 그대로) 이 페이지의 사본을 잊는다. 서버 레지스트리 · 프로세스는 그대로(옮겨 간 창이 다시 구독한다).
 */
export function leaveProducer(chat: string): void {
  subscriptionSeats.delete(chat);
  const l = lives[chat];
  targets.delete(chat);
  buffers.delete(chat);
  joining.delete(chat);
  delete lives[chat];
  if (l?.subGen != null) void producerChatUnsubscribe(chat, l.subGen).catch(() => false);
}

/** 입력 칸 채우기(보내지 않는다 — 이어받기 문장) — 채팅 id → 글 · 번호 */
const fills = $state<Record<string, { text: string; n: number }>>({});
let fillSeq = 0;

export function fillProducer(chat: string, text: string): void {
  fills[chat] = { text, n: ++fillSeq };
}

export function producerFillOf(chat: string): { text: string; n: number } | null {
  return fills[chat] ?? null;
}

export function takeProducerFill(chat: string, n: number): void {
  if (fills[chat]?.n === n) delete fills[chat];
}
