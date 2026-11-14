import { listen } from "../ipc";
import {
  onSideChatEvent,
  seqStep,
  sideChatAttach,
  sideChatClose,
  sideChatDecide,
  sideChatInterrupt,
  sideChatLink,
  sideChatList,
  sideChatOpen,
  sideChatSend,
  sideChatSetEffort,
  sideChatSetModel,
  type Decision,
  type SideChatCli,
  type SideChatEvent,
  type SideChatLinkView,
  type SideChatSnapshot,
} from "$lib/side-chat-api";
import {
  addSent,
  clearEnded,
  emptyLive,
  foldLive,
  markSendFailed,
  setSentLink,
  pendingPermissions,
  seedLive,
  type LiveState,
} from "$lib/side-chat-live";
import { hasReason, stripReason } from "$lib/error-reason";
import { isImageName } from "$lib/pane/composer-attachments";
import { sideChatOpenMode } from "$lib/side-chat";
import { sideChatResolvedBy, sideChatTurnNotifyKind } from "$lib/side-chat-notify";
import { notifySideChat } from "$lib/app/side-chat-notify";
import { sideChatBannerSignal } from "$lib/app/agent-banners.svelte.js";
import { noteSideChatConversation, setSideChatTile } from "$lib/app/side-chats.svelte.js";
import type { SideChatTileLink } from "$lib/side-chat-link";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **사이드 채팅의 지금 상태**(v2 4단계 — docs/log/2026-10-23-side-chat-v2-design.md 1 · 3절) — 채팅마다 세션 서버의 채팅 프로세스와
 * 맞춘 사본: 스냅숏 · 프로세스 세대(`epoch`) · 마지막으로 반영한 사건 번호(`seq`) · 지금 턴 꼬리(순수 접기 `$lib/side-chat-live`) ·
 * 기다리는 권한 · 보내는 중 · 오류 한 줄 · 안 본 답. 그림은 `ChatDock.svelte` · `SideChatFace.svelte`, 목록 · 저장은 `app/side-chats`.
 *
 * ## 순서(3단계가 정한 규칙)
 *
 * 1. **구독 먼저**(`onSideChatEvent` — 창마다 통로 하나 · 채팅 id 로 나눔) → 2. `sideChatAttach`(없으면 `[session-gone]` → `sideChatOpen` —
 *    기록된 대화 id 가 있으면 `resume`, 없으면 `fresh` · **띄우지 않는다**) → 3. 스냅숏의 `seq` 에서 시작 → 4. 사건마다 `seqStep`:
 *    `drop` 버림 · `apply` 접기 · `gap` = 다시 attach(사건 broadcast 는 빠질 수 있다). 스냅숏을 기다리는 동안 온 사건은 모았다가 뒤에 본다.
 * - 옛 세대(`[stale-chat]`) = 다시 attach 하고 한 번 더 · 서버 표에 없음(`[session-gone]` — 서버 재시작 · TTL) = 다시 open 하고 한 번 더.
 * - `epoch` 은 보내기 답 · 사건 봉투에서 받는다(다시 띄워도 `seq` 는 잇고 `epoch` 은 바뀐다). CLI 를 바꾸면 서버가 새 항목을 세워 `seq` 가
 *   0 부터 — 그 스냅숏으로 처음부터 다시 선다.
 * - 세션 서버가 다시 붙으면(`session-server-connected` — 서버 재시작) 붙어 있던 채팅을 모두 다시 맞춘다(서버 표가 비었으면 다시 open).
 *
 * ## 대화 id
 *
 * 턴이 한 번 선 대화만 이어 가기 대상이다(서버와 같은 규칙) — `turnStarted` 를 본 순간의 대화 id 를 `app/side-chats` 의 `links[cli]` 에
 * 적는다. 기록(`agent_conversation_transcript`)을 읽는 열쇠(`historyConv`)도 그 대화가 기록 파일에 있다고 볼 수 있을 때만 선다 —
 * 붙을 때 이미 알던 대화 · 턴이 돌고 있는 대화 · 턴이 끝난 대화(새 대화는 첫 턴이 끝날 때 — 아직 없는 파일을 읽어 오류를 띄우지 않게).
 * **갈라 온 채팅**(6단계 — `SideChatTarget.fork`)은 그 CLI 의 대화가 서기 전까지 `fork{from}` 으로 열고 원본의 기록을 보이며, 턴이 선 뒤에는
 * 자기 새 대화를 `resume{project}` 로 연다(`sideChatOpenMode` — 원본을 그냥 이어 가는 모양은 없다).
 *
 * ## 연결 칩(5단계)
 *
 * 채팅의 연결(MCP 로 읽을 타일 하나)은 저장(`chats.json` 의 `tile`)이 사람의 뜻이고 서버 표(`side_chat_link`)가 그것을 따른다 — 스냅숏의
 * `link` 가 저장과 다르면(서버 재시작 · TTL 로 잊음) 붙을 때 다시 건다(닫힌 타일이면 서버가 `[bad-link]` — 저장은 두고 칩이 "닫힘").
 * 사람이 칩으로 바꾸면 [`linkSideChat`]. 칩이 읽는 서버 쪽 사실은 `SideChatLive.link`.
 *
 * 창마다 하나의 사본이고 **주 창만** 쓴다(독이 주 창에만 있다 — 서버 명령도 주 창만 받는다). 저장하지 않는다(F5 = 다시 attach).
 */

/** 붙을 채팅 — 저장 모양에서 독이 짓는다 */
export interface SideChatTarget {
  id: string;
  cli: SideChatCli;
  model: string;
  /** 추론 강도 — 빈 값 = CLI 기본 */
  effort: string;
  /** 그 CLI 의 기록된 대화 id(`links[cli]`) */
  conversation: string | null;
  /** 갈라 올 원본 대화(6단계 — 그 CLI 가 원본의 에이전트일 때만 · `sideChatForkFrom`). 여는 모양은 `sideChatOpenMode` */
  fork: string | null;
  /** 연결된 타일의 스트림(`tile.stream` — 5단계) */
  link: string | null;
}

export interface SideChatLive {
  cli: SideChatCli;
  state: LiveState;
  epoch: number;
  seq: number;
  /** 스냅숏을 받았나(아니면 사건을 모은다) */
  attached: boolean;
  /** 보내기가 도는 중(첫 보내기 = 서버가 CLI 를 띄우고 준비를 기다린다) */
  sending: boolean;
  /** 마지막 실패 한 줄(사람 말) — 다음 성공이 걷는다 */
  error: string | null;
  /** 보이지 않는 동안 턴이 끝났다(목록 점 "새 답") */
  unseen: boolean;
  /** 기록을 읽는 대화 id(머리말 "대화 id") */
  historyConv: string | null;
  /** 서버가 아는 연결(스냅숏 · 연결 답 — 5단계) */
  link: SideChatLinkView | null;
}

const lives = $state<Record<string, SideChatLive>>({});
/** 지금 사람 눈에 보이는 채팅(독이 열려 있고 그 채팅을 보인다) */
let shown = $state<string | null>(null);
/**
 * 채팅 → 이 창이 사건으로 받은 **마지막 턴 끝**(`turnEnded` 의 세대 · 번호) — 다음 `turnStarted` 가 걷는다. 완료 확인 공유(`app/agent-seen`)의
 * 재료다: 사람이 본 창은 이 번호를 알리고, 받은 창은 제 것과 견줘 낡은 확인(그 뒤 다음 턴이 섰다)을 버린다. 스냅숏으로만 안 턴 끝은 없다
 * (그 창에는 그 턴의 배너도 없다).
 */
const turnEnds = $state<Record<string, { epoch: number; seq: number }>>({});

const targets = new Map<string, SideChatTarget>();
const subs = new Map<string, () => void>();
const joining = new Map<string, Promise<void>>();
/** 스냅숏을 기다리는 동안 온 사건 */
const buffers = new Map<string, SideChatEvent[]>();
const resyncing = new Set<string>();
let clientSeq = 0;
let reconnectWatch = false;

/** 그 채팅의 지금 상태 — 반응형(아직 안 붙었으면 `null`) */
export function sideChatLiveOf(id: string): SideChatLive | null {
  return lives[id] ?? null;
}

/** 목록 · 머리줄의 점 — 권한 대기 > 답하는 중 > 새 답 */
export function sideChatDot(id: string): "permission" | "running" | "finished" | null {
  const l = lives[id];
  if (!l) return null;
  if (pendingPermissions(l.state).length > 0) return "permission";
  if (l.state.status === "running" || l.sending) return "running";
  return l.unseen ? "finished" : null;
}

/**
 * 지금 사람 눈에 보이는 채팅(채팅 독의 채팅 갈래 · 폰 덮개 — 없으면 `null`) — 반응형. 알릴지의 판정(`chatShown`)과 같은 사실이고,
 * 배너(`AgentNotifyBanners`)가 창이 앞일 때 이것으로 "그 채팅을 봤다" 를 푼다.
 */
export function shownSideChat(): string | null {
  return shown;
}

/** 독이 알린다 — 지금 보이는 채팅(없으면 `null`) */
export function setShownSideChat(id: string | null): void {
  shown = id;
  if (id && lives[id]?.unseen) lives[id].unseen = false;
}

/** 그 채팅의 마지막 턴 끝(세대 · 번호 — 다음 턴이 섰으면 `null`) — 반응형. [`turnEnds`] */
export function sideChatTurnEnd(id: string): { epoch: number; seq: number } | null {
  return turnEnds[id] ?? null;
}

/** 턴 끝이 있는 채팅들(채팅 → 세대 · 번호) — 반응형. 완료 확인 공유가 턴 끝을 안 순간을 적는 데 쓴다 */
export function sideChatTurnEnds(): Readonly<Record<string, { epoch: number; seq: number }>> {
  return turnEnds;
}

/** 다른 창에서 사람이 그 턴 끝을 봤다(`app/agent-seen`) — 목록 점 "새 답" 을 거둔다 */
export function seenSideChatElsewhere(id: string): void {
  if (lives[id]?.unseen) lives[id].unseen = false;
}

// ---------------------------------------------------------------------------
// 실패 문구 — 서버 오류 글은 영어뿐이라 이유 코드로 고른다
// ---------------------------------------------------------------------------

/** 실패 → 사람 말 한 줄 */
export function sideChatErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (hasReason(msg, "start-timeout")) return t("app.chatDock.err.startTimeout");
  if (hasReason(msg, "exited")) return t("app.chatDock.err.exited");
  if (hasReason(msg, "main-window-only")) return t("app.chatDock.err.mainOnly");
  if (hasReason(msg, "session-gone")) return t("app.chatDock.err.gone");
  if (hasReason(msg, "bad-effort")) return t("app.chatDock.err.badEffort");
  if (hasReason(msg, "bad-link")) return t("app.chatDock.err.badLink");
  if (hasReason(msg, "conversation-not-found")) return t("app.chatDock.err.forkNotFound");
  if (hasReason(msg, "conversation-folder-missing")) return t("app.chatDock.err.forkFolder");
  if (hasReason(msg, "cli-not-found")) return t("app.chatDock.err.cliNotFound");
  // 첨부(서버 판정 — `server::side_chat` 의 `images_in` · `files_in`)
  if (hasReason(msg, "too-many-attachments") || hasReason(msg, "too-many-images")) return t("app.chatDock.err.tooMany");
  if (hasReason(msg, "file-too-big") || hasReason(msg, "image-too-big")) return t("app.chatDock.err.tooBig");
  const attachFails = ["file-outside", "file-missing", "file-not-file", "file-dest", "file-copy", "image-outside", "image-missing", "image-not-file", "image-type"] as const;
  if (attachFails.some((r) => hasReason(msg, r))) {
    return t("app.chatDock.err.attachment");
  }
  return stripReason(msg);
}

// ---------------------------------------------------------------------------
// 붙기 · 다시 맞추기
// ---------------------------------------------------------------------------

/** 스냅숏을 받는다 — 서버 표에 없거나(`session-gone`) 다른 CLI 로 서 있으면 지금 뜻으로 연다(띄우지 않는다) */
async function snapshotOf(tg: SideChatTarget): Promise<SideChatSnapshot> {
  try {
    const snap = await sideChatAttach(tg.id);
    if (snap.cli === tg.cli) return snap;
  } catch (e) {
    if (!hasReason(String(e), "session-gone")) throw e;
  }
  return await sideChatOpen({
    chat: tg.id,
    cli: tg.cli,
    model: tg.model,
    effort: tg.effort || null,
    mode: sideChatOpenMode(tg.conversation, tg.fork),
  });
}

/** 스냅숏을 들인다 — `prev` 가 있으면 같은 CLI 의 다시 맞추기(알던 것을 잇는다), 없으면 처음부터 */
function adopt(id: string, cli: SideChatCli, snap: SideChatSnapshot, prev: SideChatLive | null): void {
  const same = prev !== null && prev.cli === cli;
  const state = seedLive(snap, same ? prev.state : null);
  const conv = snap.conversationId;
  // 갈라 온 채팅은 첫 턴 전까지 원본 대화의 기록을 보인다(읽기만 — 첫 턴이 끝나면 새 대화의 기록이 대신한다 · 갈라 온 대화는 원본을 품는다)
  const known = targets.get(id)?.conversation ?? targets.get(id)?.fork ?? null;
  lives[id] = {
    cli,
    state,
    epoch: snap.epoch,
    seq: snap.seq,
    attached: true,
    sending: same ? prev.sending : false,
    error: null,
    unseen: same ? prev.unseen : false,
    // 기록이 있다고 볼 대화: 알던 것 · 턴이 도는 것 · 빈틈 사이 턴이 끝난 것
    historyConv:
      (same ? prev.historyConv : null) ??
      known ??
      (snap.status === "running" || (same && state.ended > prev.state.ended) ? conv : null),
    link: snap.link ?? null,
  };
  // 저장된 연결(사람의 뜻)과 서버 표가 다르면 다시 건다 — 서버 재시작 · TTL 로 잊었다
  const want = targets.get(id)?.link ?? null;
  if (want !== (snap.link?.stream ?? null)) void pushLink(id, want);
  if (snap.status === "running" && conv) noteConversation(id, cli, conv);
  // 기다리는 동안 온 사건 — `seq` 로 겹친 것을 버리고 나머지를 차례로
  const buf = buffers.get(id) ?? [];
  buffers.delete(id);
  for (const e of buf) apply(id, e);
}

/**
 * **붙는다**(독 마운트 · 채팅 고르기 · 서버에 살아 있는 채팅) — 이 페이지에서 한 번. 구독을 먼저 걸고 스냅숏을 받는다. 실패는 그 채팅의
 * 오류 한 줄로 남긴다(다음 고르기 · 보내기가 다시 해 본다).
 */
export function joinSideChat(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  // 다시 맞추는 중(`resync` — 그동안 `attached` 가 거짓이다)이면 그쪽이 붙인다. 여기서 새로 세우면 그 사이 보낸 내 말이 지워졌다
  // (2026-10-27 — 꺼진 채팅의 첫 보내기: 세대가 바뀌어 resync 가 도는데 보내기가 채팅 표를 고쳐 독의 붙기 효과가 다시 돌았다)
  if (lives[tg.id]?.attached || resyncing.has(tg.id)) return Promise.resolve();
  const running = joining.get(tg.id);
  if (running) return running;
  watchReconnect();
  const p = (async () => {
    try {
      buffers.set(tg.id, buffers.get(tg.id) ?? []);
      if (!subs.has(tg.id)) subs.set(tg.id, await onSideChatEvent(tg.id, (e) => onEvent(tg.id, e)));
      const snap = await snapshotOf(tg);
      // 이 페이지가 이미 쥔 꼬리(앞선 붙기가 실패했거나 보낸 뒤 다시 붙는다)가 있으면 잇는다 — 처음이면 없다
      adopt(tg.id, tg.cli, snap, lives[tg.id] ?? null);
    } catch (e) {
      const prev = lives[tg.id];
      lives[tg.id] = {
        cli: tg.cli,
        state: prev?.state ?? emptyLive("stopped", tg.model, tg.conversation),
        epoch: prev?.epoch ?? 0,
        seq: prev?.seq ?? 0,
        attached: false,
        sending: false,
        error: sideChatErrorText(e),
        unseen: false,
        historyConv: tg.conversation ?? tg.fork,
        link: prev?.link ?? null,
      };
    } finally {
      joining.delete(tg.id);
    }
  })();
  joining.set(tg.id, p);
  return p;
}

/** 독 마운트 — 서버 표에 살아 있는 채팅(뒤에서 도는 턴 · 권한 대기)도 붙어 점을 세운다. 지금 목록에 있는 것만 */
export async function joinLiveSideChats(known: (id: string) => SideChatTarget | null): Promise<void> {
  let rows: Awaited<ReturnType<typeof sideChatList>> = [];
  try {
    rows = await sideChatList();
  } catch {
    return;
  }
  for (const r of rows) {
    const tg = known(r.chat);
    if (tg) void joinSideChat(tg);
  }
}

/** 다시 맞춘다(빈틈 · 옛 세대 · 서버 재시작) — 그동안 온 사건은 모았다가 스냅숏 뒤에 본다 */
async function resync(id: string): Promise<void> {
  const tg = targets.get(id);
  const cur = lives[id];
  if (!tg || resyncing.has(id)) return;
  resyncing.add(id);
  if (cur) cur.attached = false;
  buffers.set(id, buffers.get(id) ?? []);
  try {
    const snap = await snapshotOf(tg);
    adopt(id, tg.cli, snap, lives[id] ?? null);
  } catch (e) {
    const l = lives[id];
    if (l) {
      l.attached = true; // 사건은 다시 받는다 — 다음 빈틈 · 보내기가 또 맞춘다
      l.error = sideChatErrorText(e);
    }
  } finally {
    resyncing.delete(id);
  }
}

/** 턴이 선 대화 id — 저장(`links[cli]`)과 다시 열 뜻(`targets` — 서버 표를 잃으면 이것으로 이어 간다)에 적는다 */
function noteConversation(id: string, cli: SideChatCli, conv: string): void {
  noteSideChatConversation(id, cli, conv);
  const tg = targets.get(id);
  if (tg && tg.cli === cli) targets.set(id, { ...tg, conversation: conv });
}

function onEvent(id: string, e: SideChatEvent): void {
  const l = lives[id];
  if (!l || !l.attached) {
    buffers.get(id)?.push(e);
    return;
  }
  apply(id, e);
}

function apply(id: string, e: SideChatEvent): void {
  const l = lives[id];
  if (!l) return;
  const step = seqStep(l.seq, e.seq);
  if (step === "drop") return;
  if (step === "gap") {
    void resync(id);
    return;
  }
  l.seq = e.seq;
  l.epoch = e.epoch;
  const ended = l.state.ended;
  const pending = pendingPermissions(l.state).length;
  l.state = foldLive(l.state, e.ev);
  const nowPending = pendingPermissions(l.state).length;
  // 다른 창에서 답했다 · 새 턴이 섰다 — 이 창의 배너는 저절로 풀린다(알림보다 먼저 — 턴 끝의 새 알림이 곧바로 풀리지 않게)
  sideChatBannerSignal(id, sideChatResolvedBy({ turnStarted: e.ev.t === "turnStarted", permissionsCleared: pending > 0 && nowPending === 0 }));
  if (nowPending > pending) notifySideChat(id, "permission", shown === id);
  if (e.ev.t === "turnStarted") delete turnEnds[id];
  if (e.ev.t === "turnEnded") {
    // 배너보다 먼저 — 알림과 같은 순간에 완료 확인의 재료가 선다(`app/agent-seen`)
    turnEnds[id] = { epoch: e.epoch, seq: e.seq };
    const kind = sideChatTurnNotifyKind(e.ev.outcome);
    if (kind) notifySideChat(id, kind, shown === id);
  }
  const conv = l.state.conversationId;
  const changed = e.ev.t === "notice" && e.ev.code === "conversation-changed" && l.state.status === "running";
  if ((e.ev.t === "turnStarted" || changed) && conv) {
    // 기록 열쇠는 아직 세우지 않는다 — 새 대화의 기록 파일은 첫 턴 중에 막 생긴다(턴 끝에 선다 — 아래)
    noteConversation(id, l.cli, conv);
  }
  if (l.state.ended !== ended) {
    if (conv) l.historyConv = conv;
    if (shown !== id) l.unseen = true;
  }
}

/** 세션 서버가 (다시) 붙었다 — 붙어 있던 채팅을 모두 다시 맞춘다 */
function watchReconnect(): void {
  if (reconnectWatch || typeof window === "undefined") return;
  reconnectWatch = true;
  void listen("session-server-connected", () => {
    for (const id of Object.keys(lives)) void resync(id);
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// 조작 — 독 · 대화 면이 부른다
// ---------------------------------------------------------------------------

/** 옛 세대 · 서버 표에 없음이면 다시 맞추고 한 번 더 */
async function withEpoch<T>(id: string, run: (epoch: number) => Promise<T>): Promise<T> {
  const l = lives[id];
  try {
    return await run(l?.epoch ?? 0);
  } catch (e) {
    const s = String(e);
    if (!hasReason(s, "stale-chat") && !hasReason(s, "session-gone")) throw e;
    await resync(id);
    return await run(lives[id]?.epoch ?? 0);
  }
}

/**
 * **보낸다** — 꼬리에 흐린 내 말을 먼저 세우고 `side_chat_send`(프로세스가 없으면 서버가 띄우고 준비를 기다린다 — 그동안 "… 시작 중").
 * 한 번에 하나 · 턴이 도는 동안은 부르지 않는다(입력 칸이 [중단] 을 보인다). 보냈으면 그 말의 `clientId`(칸을 비운다 · 막 보낸 그림을 그
 * 말풍선에 잇는 열쇠 — 실패는 말풍선에 남는다), 못 보냈으면 `null`.
 */
export function sendSideChat(
  id: string,
  text: string,
  linkName: string | null = null,
  images: readonly { path: string; name: string }[] = [],
): string | null {
  const l = lives[id];
  if (!l || l.sending || l.state.status === "running" || (text.trim() === "" && images.length === 0)) return null;
  const clientId = `c${Date.now().toString(36)}${(++clientSeq).toString(36)}`;
  l.state = addSent(l.state, text, clientId, images.map((im) => im.name));
  l.sending = true;
  l.error = null;
  void (async () => {
    try {
      // 그림은 `images`(Claude 바이트 · Codex 경로), 그 밖은 `files`(서버가 채팅 자기 폴더로 옮겨 적는다) — 판정 표는 서버와 같다(`isImageName`)
      const pics = images.filter((im) => isImageName(im.path)).map((im) => im.path);
      const files = images.filter((im) => !isImageName(im.path)).map((im) => im.path);
      const r = await withEpoch(id, (epoch) => sideChatSend(id, epoch, text, clientId, linkName, pics, files));
      const now = lives[id];
      if (now && r.epoch > now.epoch) now.epoch = r.epoch;
      // 서버가 붙인 연결 머리글 — 말풍선 위 칩(F5 뒤 기록 쪽과 같은 그림)
      if (now && r.link) now.state = setSentLink(now.state, clientId, r.link);
    } catch (e) {
      const now = lives[id];
      if (now) {
        now.state = markSendFailed(now.state, clientId);
        now.error = sideChatErrorText(e);
      }
    } finally {
      const now = lives[id];
      if (now) now.sending = false;
    }
  })();
  return clientId;
}

/** [중단] — 도는 턴을 끊는다(끊긴 턴은 "중단함" 으로 남는다) */
export async function interruptSideChat(id: string): Promise<void> {
  try {
    await withEpoch(id, (epoch) => sideChatInterrupt(id, epoch));
  } catch (e) {
    const l = lives[id];
    if (l) l.error = sideChatErrorText(e);
  }
}

/** 사람의 권한 결정([허용 한 번] · [거절]) — 이미 끝난 요청(`unknown-request`)이면 다시 맞춘다 */
export async function decideSideChat(id: string, requestId: string, decision: Decision): Promise<void> {
  try {
    await withEpoch(id, (epoch) => sideChatDecide(id, epoch, requestId, decision));
  } catch (e) {
    if (hasReason(String(e), "unknown-request")) {
      void resync(id);
      return;
    }
    const l = lives[id];
    if (l) l.error = sideChatErrorText(e);
  }
}

/**
 * **모델 바꾸기** — 산 프로세스면 곧바로(다시 띄우지 않는다 · 턴 중이면 다음 턴부터), 없으면 다음 띄우기에 쓴다(서버가 적는다).
 * 빈 값(CLI 기본)은 대화 중 바꿀 수 없어 프로세스를 닫고 같은 대화로 다시 연다(다음 보내기가 기본 모델로 띄운다).
 */
export async function setSideChatModel(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  const l = lives[tg.id];
  try {
    if (tg.model === "") {
      if (l && l.state.status !== "stopped") await sideChatClose(tg.id);
      await reopen(tg);
      return;
    }
    await withEpoch(tg.id, (epoch) => sideChatSetModel(tg.id, epoch, tg.model));
    const now = lives[tg.id];
    if (now) now.state = { ...now.state, model: tg.model };
  } catch (e) {
    const now = lives[tg.id];
    if (now) now.error = sideChatErrorText(e);
  }
}

/**
 * **추론 강도 바꾸기** — 두 CLI 모두 다시 띄우지 않는다(Claude 는 제어 요청 `apply_flag_settings` 로 곧바로 · Codex 는 다음 `turn/start`
 * 부터 · 턴 중이면 둘 다 다음 턴부터라 묻지 않는다). 빈 값 = CLI 기본(`null`). 산 프로세스가 없으면 서버가 다음 띄우기에 쓴다.
 */
export async function setSideChatEffort(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  try {
    await withEpoch(tg.id, (epoch) => sideChatSetEffort(tg.id, epoch, tg.effort || null));
    const now = lives[tg.id];
    if (now) now.state = { ...now.state, effort: tg.effort || null };
  } catch (e) {
    const now = lives[tg.id];
    if (now) now.error = sideChatErrorText(e);
  }
}

/** 지금 뜻으로 다시 연다(띄우지 않는다) — 같은 CLI 면 다시 붙기, 다른 CLI 면 서버가 옛 프로세스를 닫고 새 항목을 세운다 */
async function reopen(tg: SideChatTarget): Promise<void> {
  const prev = lives[tg.id] ?? null;
  if (prev) prev.attached = false;
  buffers.set(tg.id, buffers.get(tg.id) ?? []);
  const snap = await sideChatOpen({
    chat: tg.id,
    cli: tg.cli,
    model: tg.model,
    effort: tg.effort || null,
    mode: sideChatOpenMode(tg.conversation, tg.fork),
  });
  // CLI 가 바뀌면 서버 항목이 새것이라 `seq` 가 0 부터다 — 옛 사본을 잇지 않는다
  const fresh = !prev || prev.cli !== tg.cli || snap.seq < prev.seq;
  if (fresh && prev) {
    delete lives[tg.id];
    delete turnEnds[tg.id];
    adopt(tg.id, tg.cli, snap, null);
    const now = lives[tg.id];
    if (now) now.historyConv = tg.conversation ?? tg.fork;
    return;
  }
  adopt(tg.id, tg.cli, snap, prev);
}

/**
 * **CLI 바꾸기** — 지금 프로세스를 닫고(서버가 `open` 에서 다른 CLI 를 보면 옛 것을 닫는다) 그 CLI 의 대화(기록된 것이 있으면 이어 가기)로
 * 다시 연다. 각 CLI 는 이 채팅에서 제 대화 id 를 따로 쥔다(`links`).
 */
export async function switchSideChatCli(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  try {
    await reopen(tg);
  } catch (e) {
    const l = lives[tg.id];
    if (l) l.error = sideChatErrorText(e);
  }
}

/** [다시 시작] — CLI 가 끝난 채팅을 지금 뜻으로 다시 연다(띄우지는 않는다 — 다음 보내기가 띄운다). 종료 알림은 걷힌다 */
export async function restartSideChat(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  try {
    await reopen(tg);
    const l = lives[tg.id];
    if (l) l.state = { ...l.state, entries: l.state.entries.filter((e) => e.kind !== "exited") };
  } catch (e) {
    const l = lives[tg.id];
    if (l) l.error = sideChatErrorText(e);
  }
}

// ---------------------------------------------------------------------------
// 연결 칩(5단계)
// ---------------------------------------------------------------------------

/** 서버 표에 연결을 건다(다시 걸기 · 사람의 고르기 공용) — 답의 연결 보기를 들인다. 닫힌 타일(`[bad-link]`)이면 서버 쪽 보기를 "닫힘" 으로 */
async function pushLink(id: string, stream: string | null): Promise<void> {
  try {
    const r = await sideChatLink(id, stream);
    const l = lives[id];
    if (l) l.link = r.link;
  } catch (e) {
    const l = lives[id];
    if (!l) return;
    if (hasReason(String(e), "bad-link") && stream) {
      l.link = { stream, code: null, label: null, kind: null, readable: false, closed: true };
      return;
    }
    if (!hasReason(String(e), "session-gone")) l.error = sideChatErrorText(e);
  }
}

/**
 * **연결을 바꾼다**(사람이 칩에서 · [AI에게 묻기] → 사이드 채팅) — 저장(`tile`)과 다시 붙을 뜻에 적고 서버 표에 건다(`side_chat_link` —
 * 서버가 거울의 창 타일인지 다시 본다). `null` = 끊기. 서버 표에 아직 없으면(붙기 전) 붙을 때 [`adopt`] 가 건다.
 */
export async function linkSideChat(id: string, tile: SideChatTileLink | null): Promise<void> {
  setSideChatTile(id, tile);
  const tg = targets.get(id);
  if (tg) targets.set(id, { ...tg, link: tile?.stream ?? null });
  if (!lives[id]?.attached) return;
  await pushLink(id, tile?.stream ?? null);
}

/** 입력 칸 채우기(보내지 않는다 — [AI에게 묻기] → 사이드 채팅) — 채팅 id → 글 · 번호(같은 글을 두 번 채워도 다시 선다) */
const fills = $state<Record<string, { text: string; n: number }>>({});
let fillSeq = 0;

/** 그 채팅의 입력 칸에 글을 채운다 — 대화 면(`SideChatFace`)이 받아 칸에 넣고 [`takeSideChatFill`] 로 걷는다 */
export function fillSideChatComposer(id: string, text: string): void {
  fills[id] = { text, n: ++fillSeq };
}

/** 기다리는 채우기 — 반응형 */
export function sideChatFillOf(id: string): { text: string; n: number } | null {
  return fills[id] ?? null;
}

/** 채웠다 — 걷는다(그 번호일 때만 — 그 사이 새로 온 것은 둔다) */
export function takeSideChatFill(id: string, n: number): void {
  if (fills[id]?.n === n) delete fills[id];
}

/** 기록의 최신 쪽을 받았다 — 끝난 턴의 꼬리를 걷는다 */
export function clearEndedSideChat(id: string): void {
  const l = lives[id];
  if (l) l.state = clearEnded(l.state);
}

/** 오류 한 줄을 걷는다 */
export function dismissSideChatError(id: string): void {
  const l = lives[id];
  if (l) l.error = null;
}

/** **지운다** — 서버의 프로세스를 닫고(잡째) 구독을 걷는다. 폴더 지우기는 부르는 쪽(`app/side-chats` 의 `deleteSideChat`) */
export async function closeSideChatLive(id: string): Promise<void> {
  subs.get(id)?.();
  subs.delete(id);
  targets.delete(id);
  buffers.delete(id);
  delete lives[id];
  await sideChatClose(id).catch(() => false);
}
