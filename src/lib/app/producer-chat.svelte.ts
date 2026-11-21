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
 * 프로듀서 채팅의 지금 상태 — 세션 서버 프로듀서 레지스트리와 맞춘 사본(docs/log/2026-10-30-orchestration-structured-producer.md).
 * stdin 에 닿는 것은 사람이 보낸 글뿐이다 — 이 모듈은 글을 짓지 않고, 이어받기 문장은 입력 칸을 채우기만 한다([`fillProducer`]).
 * 사이드 채팅과 달리 서버 표에 없으면(`session-gone`) 스스로 열지 않는다 — 끝난 이유를 그리고, 사람이 다시 말할 때 연다.
 * 대기열 글은 서버 보기에 없다(보낸 창만 안다). 레지스트리 알림(`queue-changed` · `queue-failed`)은 `seq` 를 올리지 않는다.
 */

export interface ProducerTarget {
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string;
  studio: string;
  conv: string | null;
  /** 갈라 올 원본 대화 id — 이 채팅 자신의 대화(`conv`)가 서기 전에 열면 `fork{from}` 으로 연다 */
  forkFrom?: string | null;
  /** 이어받기는 fresh 대신 대상 앨범에 귀속만 세운다 */
  adoptRun?: string;
}

export interface ProducerLive {
  cli: SideChatCli;
  state: LiveState;
  epoch: number;
  seq: number;
  /** 아니면 사건을 모은다 */
  attached: boolean;
  sending: boolean;
  error: string | null;
  /** 풀 때 같은 값만 — 새 창의 구독을 풀지 않게 */
  subGen: number | null;
  life: ProducerLife | null;
  ended: string | null;
  /** 서버 표에 없다 — 끝난 이유 */
  gone: string | null;
  readOnly: boolean;
  queue: ProducerQueueView;
  album: ProducerAlbum | null;
  /** `clientId` → 이 창이 보낸 글 */
  texts: Record<string, string>;
  historyConv: string | null;
  denied: number;
  wakes: Record<string, WakeView>;
}

const EMPTY_QUEUE: ProducerQueueView = { items: [], held: false };

const lives = $state<Record<string, ProducerLive>>({});
const targets = new Map<string, ProducerTarget>();
const joining = new Map<string, Promise<void>>();
const buffers = new Map<string, ProducerEvent[]>();
let clientSeq = 0;
let reconnectWatch = false;
/** 이 모듈이 탭을 고치지 않게 바깥이 건다 */
let convHook: ((chat: string, conv: string) => void) | null = null;

export function producerLiveOf(chat: string): ProducerLive | null {
  return lives[chat] ?? null;
}

export function setProducerConvHook(f: ((chat: string, conv: string) => void) | null): void {
  convHook = f;
}

// ── 실패 문구 — 서버 오류 글은 영어뿐이라 이유 코드로 고른다 ──

export function reasonIs(e: unknown, code: string): boolean {
  return String(e instanceof Error ? e.message : e).includes(`[${code}]`);
}

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

// ── 붙기 · 다시 맞추기 ──

function asSeed(s: ProducerSnapshot): SideChatSnapshot {
  return {
    links: [],
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

function withWakeNote(state: LiveState, wakeId: string): LiveState {
  if (state.entries.some((e) => e.kind === "notice" && e.code === WAKE_NOTE && e.detail === wakeId)) return state;
  return { ...state, entries: [{ n: state.next, kind: "notice", code: WAKE_NOTE, detail: wakeId }, ...state.entries], next: state.next + 1 };
}

/** 기록이 같은 깨움을 알약으로 그리므로 기록이 받은 턴의 표지는 걷는다 — 두 벌이 되지 않게 */
function dropRecordedWakes(state: LiveState): LiveState {
  const keep = state.entries.filter((e) => !(e.kind === "notice" && e.code === WAKE_NOTE && e.n < state.endedAt));
  return keep.length === state.entries.length ? state : { ...state, entries: keep };
}

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

/** 열지 않는다 */
async function markGone(chat: string): Promise<void> {
  const tg = targets.get(chat);
  if (!tg) return;
  let gone = "server-restarted";
  let album: ProducerAlbum | null = null;
  try {
    const s = await producerChatStatus(chat);
    if (s.open) {
      await subscribe(chat);
      return;
    }
    gone = s.gone;
    album = s.album;
  } catch {
    /* 서버 없음 — 재시작으로 본다 */
  }
  const prev = lives[chat] ?? null;
  // 서버 `open` 과 같은 판정 — 되찾을 수 없는 orphaned 앨범이면 "말하면 다시 띄웁니다" 를 보이지 않는다
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

export function joinProducer(tg: ProducerTarget): Promise<void> {
  targets.set(tg.chat, tg);
  // 재연결 듣기는 먼저 건다 — 보내기가 이미 붙여 둔 채팅은 아래에서 돌아가므로, 뒤에 두면 세션 서버 재시작을 못 듣는다
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

const REGISTRY_NOTICES: ReadonlySet<string> = new Set(["queue-changed", "queue-failed"]);

function apply(chat: string, e: ProducerEvent): void {
  const l = lives[chat];
  if (!l) return;
  const ev = e.ev;
  if (ev.t === "woken") {
    // 코어 `seq` 밖이다
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

function watchReconnect(): void {
  if (reconnectWatch || typeof window === "undefined") return;
  reconnectWatch = true;
  void listen("session-server-connected", () => {
    for (const chat of Object.keys(lives)) void resync(chat);
  }).catch(() => {});
}

// ── 조작 ──

/** 서버 표에 연다 — CLI 를 띄우지는 않는다 */
async function openAndSubscribe(tg: ProducerTarget): Promise<void> {
  const snap = await producerChatOpen({
    chat: tg.chat,
    cli: tg.cli,
    model: tg.model,
    effort: tg.effort || null,
    mode: producerOpenMode(tg),
  });
  adopt(tg.chat, snap, null);
  await subscribe(tg.chat);
}

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

/** 전송은 하지 않는다 — 앨범 시작 op 가 이미 보냈다 */
export function rememberAlbumFirst(tg: ProducerTarget, clientId: string, text: string, sent: boolean): void {
  targets.set(tg.chat, tg);
  const live = lives[tg.chat] ??= blank(tg, null);
  if (!sent) return;
  live.texts = { ...live.texts, [clientId]: text };
  if (!live.state.entries.some((e) => e.kind === "user" && e.clientId === clientId)) live.state = addSent(live.state, text, clientId);
}

function likelyDispatch(l: ProducerLive | null): boolean {
  if (!l) return true;
  return l.state.status !== "running" && l.queue.items.length === 0 && !l.sending;
}

/** 사람이 보낸 글 — 참이면 칸을 비운다(실패는 오류 줄 · 말풍선에 남는다) */
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
          // 대기열 줄이 그린다 — 받아지면 `userAccepted` 에서 다시 선다
          after.state = { ...after.state, entries: after.state.entries.filter((x) => !(x.kind === "user" && x.clientId === clientId)) };
          void refreshQueue(tg.chat);
        }
      }
    } catch (e) {
      const after = lives[tg.chat];
      if (after && reasonIs(e, "album-orphaned")) {
        // 오류 줄을 겹쳐 세우지 않는다 — 기록만 띠가 이유를 말한다
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

/** `deliverQueued: false` = 대기열 보류 */
export async function interruptProducer(chat: string, deliverQueued: boolean): Promise<void> {
  try {
    await producerChatInterrupt(chat, deliverQueued);
    void refreshQueue(chat);
  } catch (e) {
    const l = lives[chat];
    if (l) l.error = producerErrorText(e);
  }
}

export async function cancelQueued(chat: string, clientId: string): Promise<void> {
  try {
    await producerChatQueueCancel(chat, clientId);
  } catch (e) {
    const l = lives[chat];
    if (l) l.error = producerErrorText(e);
  }
  void refreshQueue(chat);
}

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

/** 기록의 최신 쪽을 받았을 때 */
export function clearEndedProducer(chat: string): void {
  const l = lives[chat];
  if (l) l.state = dropRecordedWakes(clearEnded(l.state));
}

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

/** 사람이 [프로듀서 끝내기]를 확인했을 때만 — 실패는 던져 확인 화면이 보여 준다 */
export async function closeProducerLive(chat: string): Promise<void> {
  await producerChatClose(chat);
  await markGone(chat);
}

/** 같은 창에서 같은 앨범을 여러 잎으로 보아도 마지막 표시만 구독을 푼다 */
export const observeProducer = createProducerObservers<ProducerTarget>((target) => { void joinProducer(target); }, leaveProducer);

/** 이 창의 구독만 푼다 — 채팅은 산다(옮겨 간 창이 다시 구독한다) */
export function leaveProducer(chat: string): void {
  subscriptionSeats.delete(chat);
  const l = lives[chat];
  targets.delete(chat);
  buffers.delete(chat);
  joining.delete(chat);
  delete lives[chat];
  if (l?.subGen != null) void producerChatUnsubscribe(chat, l.subGen).catch(() => false);
}

/** 입력 칸 채우기 — 보내지 않는다 */
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
