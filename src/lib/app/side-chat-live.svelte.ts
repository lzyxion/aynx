import { listen } from "../ipc";
import {
  onSideChatEvent,
  seqStep,
  sideChatAttach,
  sideChatClose,
  sideChatDecide,
  sideChatForgetAllow,
  sideChatInterrupt,
  sideChatLink,
  sideChatList,
  sideChatOpen,
  sideChatSend,
  sideChatSetEffort,
  sideChatSetModel,
  sideChatSetPermMode,
  type Decision,
  type PermMode,
  type SideChatPermView,
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
import { noteSideChatConversation, setSideChatTiles, sideChats } from "$lib/app/side-chats.svelte.js";
import { pushKnownLinks, sameLinkStreams, withTileLink, withoutTileLink, type SideChatTileLink } from "$lib/side-chat-link";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 사이드 채팅의 지금 상태 — 채팅마다 세션 서버의 채팅 프로세스와 맞춘 사본(저장하지 않는다 · F5 = 다시 attach). 주 창만 쓴다.
 * - 구독을 먼저 걸고 attach 한다 — 거꾸로면 사이 사건을 잃는다. 스냅숏을 기다리는 동안 온 사건은 모았다가 뒤에 본다.
 * - 사건 broadcast 는 빠질 수 있다 — `seq` 빈틈이면 다시 attach 한다.
 * - CLI 를 바꾸면 서버가 새 항목을 세워 `seq` 가 0 부터다 — 옛 사본을 잇지 않는다.
 */

export interface SideChatTarget {
  id: string;
  cli: SideChatCli;
  model: string;
  /** 빈 값 = CLI 기본 */
  effort: string;
  conversation: string | null;
  /** 갈라 올 원본 대화 — 그 CLI 의 대화가 서기 전까지만 `fork{from}` 으로 연다(`sideChatOpenMode`) */
  fork: string | null;
  /** 연결 순서대로 */
  links: string[];
}

export interface SideChatLive {
  cli: SideChatCli;
  state: LiveState;
  epoch: number;
  seq: number;
  /** 거짓이면 사건을 모은다 */
  attached: boolean;
  sending: boolean;
  error: string | null;
  unseen: boolean;
  /** 기록 파일이 있다고 볼 수 있을 때만 선다 — 새 대화는 첫 턴이 끝날 때(아직 없는 파일을 읽어 오류를 띄우지 않게) */
  historyConv: string | null;
  /** 서버가 모르는 타일은 "닫힘" 보기로 채운다 */
  links: SideChatLinkView[];
}

const lives = $state<Record<string, SideChatLive>>({});
let shown = $state<string | null>(null);
/**
 * 완료 확인 공유(`app/agent-seen`)의 재료 — 사건으로 받은 턴 끝만 적는다(스냅숏으로만 안 턴 끝은 그 창에 배너도 없다). 다음 `turnStarted` 가 걷는다.
 */
const turnEnds = $state<Record<string, { epoch: number; seq: number }>>({});

const targets = new Map<string, SideChatTarget>();
const subs = new Map<string, () => void>();
const joining = new Map<string, Promise<void>>();
const buffers = new Map<string, SideChatEvent[]>();
const resyncing = new Set<string>();
let clientSeq = 0;
let reconnectWatch = false;

export function sideChatLiveOf(id: string): SideChatLive | null {
  return lives[id] ?? null;
}

export function sideChatDot(id: string): "permission" | "running" | "finished" | null {
  const l = lives[id];
  if (!l) return null;
  if (pendingPermissions(l.state).length > 0) return "permission";
  if (l.state.status === "running" || l.sending) return "running";
  return l.unseen ? "finished" : null;
}

export function shownSideChat(): string | null {
  return shown;
}

export function setShownSideChat(id: string | null): void {
  shown = id;
  if (id && lives[id]?.unseen) lives[id].unseen = false;
}

export function sideChatTurnEnd(id: string): { epoch: number; seq: number } | null {
  return turnEnds[id] ?? null;
}

export function sideChatTurnEnds(): Readonly<Record<string, { epoch: number; seq: number }>> {
  return turnEnds;
}

export function seenSideChatElsewhere(id: string): void {
  if (lives[id]?.unseen) lives[id].unseen = false;
}

// ── 실패 문구 ──

/** 서버 오류 글은 영어뿐이라 이유 코드로 고른다 */
export function sideChatErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (hasReason(msg, "start-timeout")) return t("app.chatDock.err.startTimeout");
  if (hasReason(msg, "exited")) return t("app.chatDock.err.exited");
  if (hasReason(msg, "main-window-only")) return t("app.chatDock.err.mainOnly");
  if (hasReason(msg, "session-gone")) return t("app.chatDock.err.gone");
  if (hasReason(msg, "bad-effort")) return t("app.chatDock.err.badEffort");
  if (hasReason(msg, "bad-link")) return t("app.chatDock.err.badLink");
  if (hasReason(msg, "too-many-links")) return t("app.chatDock.err.tooManyLinks");
  if (hasReason(msg, "conversation-not-found")) return t("app.chatDock.err.forkNotFound");
  if (hasReason(msg, "conversation-folder-missing")) return t("app.chatDock.err.forkFolder");
  if (hasReason(msg, "cli-not-found")) return t("app.chatDock.err.cliNotFound");
  if (hasReason(msg, "server-outdated")) return stripReason(msg);
  // 이유 코드는 `server::side_chat` 의 `images_in` · `files_in` 과 맞춘다
  if (hasReason(msg, "too-many-attachments") || hasReason(msg, "too-many-images")) return t("app.chatDock.err.tooMany");
  if (hasReason(msg, "file-too-big") || hasReason(msg, "image-too-big")) return t("app.chatDock.err.tooBig");
  const attachFails = ["file-outside", "file-missing", "file-not-file", "file-dest", "file-copy", "image-outside", "image-missing", "image-not-file", "image-type"] as const;
  if (attachFails.some((r) => hasReason(msg, r))) {
    return t("app.chatDock.err.attachment");
  }
  return stripReason(msg);
}

// ── 붙기 · 다시 맞추기 ──

/** 서버 표에 없거나 다른 CLI 로 서 있으면 지금 뜻으로 연다(띄우지 않는다) */
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

function adopt(id: string, cli: SideChatCli, snap: SideChatSnapshot, prev: SideChatLive | null): void {
  const same = prev !== null && prev.cli === cli;
  const state = seedLive(snap, same ? prev.state : null);
  const conv = snap.conversationId;
  // 갈라 온 채팅은 첫 턴 전까지 원본 대화의 기록을 보인다
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
    historyConv:
      (same ? prev.historyConv : null) ??
      known ??
      (snap.status === "running" || (same && state.ended > prev.state.ended) ? conv : null),
    links: snap.links ?? [],
  };
  // 저장된 연결이 사람의 뜻이고 서버 표가 따른다 — 서버가 재시작 · TTL 로 잊었으면 다시 건다
  const want = targets.get(id)?.links ?? [];
  if (!sameLinkStreams(want.map((stream) => ({ stream })), snap.links ?? [])) void pushLinks(id);
  if (snap.status === "running" && conv) noteConversation(id, cli, conv);
  const buf = buffers.get(id) ?? [];
  buffers.delete(id);
  for (const e of buf) apply(id, e);
}

export function joinSideChat(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  // 다시 맞추는 중(그동안 `attached` 가 거짓)이면 그쪽이 붙인다 — 여기서 새로 세우면 그 사이 보낸 내 말이 지워진다
  if (lives[tg.id]?.attached || resyncing.has(tg.id)) return Promise.resolve();
  const running = joining.get(tg.id);
  if (running) return running;
  watchReconnect();
  const p = (async () => {
    try {
      buffers.set(tg.id, buffers.get(tg.id) ?? []);
      if (!subs.has(tg.id)) subs.set(tg.id, await onSideChatEvent(tg.id, (e) => onEvent(tg.id, e)));
      const snap = await snapshotOf(tg);
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
        links: prev?.links ?? [],
      };
    } finally {
      joining.delete(tg.id);
    }
  })();
  joining.set(tg.id, p);
  return p;
}

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

/** 턴이 한 번 선 대화만 이어 가기 대상이다(서버와 같은 규칙) */
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
  // 알림보다 먼저 — 턴 끝의 새 알림이 곧바로 풀리지 않게
  sideChatBannerSignal(id, sideChatResolvedBy({ turnStarted: e.ev.t === "turnStarted", permissionsCleared: pending > 0 && nowPending === 0 }));
  if (nowPending > pending) notifySideChat(id, "permission", shown === id);
  if (e.ev.t === "turnStarted") delete turnEnds[id];
  if (e.ev.t === "turnEnded") {
    // 알림보다 먼저 — 알림과 같은 순간에 완료 확인의 재료가 선다(`app/agent-seen`)
    turnEnds[id] = { epoch: e.epoch, seq: e.seq };
    const kind = sideChatTurnNotifyKind(e.ev.outcome);
    if (kind) notifySideChat(id, kind, shown === id);
  }
  const conv = l.state.conversationId;
  const changed = e.ev.t === "notice" && e.ev.code === "conversation-changed" && l.state.status === "running";
  if ((e.ev.t === "turnStarted" || changed) && conv) {
    // 기록 열쇠는 아직 세우지 않는다 — 새 대화의 기록 파일은 첫 턴 중에 막 생긴다
    noteConversation(id, l.cli, conv);
  }
  if (l.state.ended !== ended) {
    if (conv) l.historyConv = conv;
    if (shown !== id) l.unseen = true;
  }
}

function watchReconnect(): void {
  if (reconnectWatch || typeof window === "undefined") return;
  reconnectWatch = true;
  void listen("session-server-connected", () => {
    for (const id of Object.keys(lives)) void resync(id);
  }).catch(() => {});
}

// ── 조작 ──

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

/** 보냈으면 그 말의 `clientId`, 못 보냈으면 `null` */
export function sendSideChat(
  id: string,
  text: string,
  linkNames: Readonly<Record<string, string>> | null = null,
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
      // 그림 / 파일 판정(`isImageName`)은 서버와 같은 표다
      const pics = images.filter((im) => isImageName(im.path)).map((im) => im.path);
      const files = images.filter((im) => !isImageName(im.path)).map((im) => im.path);
      const r = await withEpoch(id, (epoch) => sideChatSend(id, epoch, text, clientId, linkNames, pics, files));
      const now = lives[id];
      if (now && r.epoch > now.epoch) now.epoch = r.epoch;
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

export async function interruptSideChat(id: string): Promise<void> {
  try {
    await withEpoch(id, (epoch) => sideChatInterrupt(id, epoch));
  } catch (e) {
    const l = lives[id];
    if (l) l.error = sideChatErrorText(e);
  }
}

/** 사람의 그 자리 권한 결정 — `remember` 의 종류는 서버가 기다리는 요청에서 읽는다 */
export async function decideSideChat(id: string, requestId: string, decision: Decision, remember = false): Promise<void> {
  try {
    await withEpoch(id, (epoch) => sideChatDecide(id, epoch, requestId, decision, null, remember && decision === "allow"));
  } catch (e) {
    if (hasReason(String(e), "unknown-request")) {
      void resync(id);
      return;
    }
    const l = lives[id];
    if (l) l.error = sideChatErrorText(e);
  }
}

function adoptPerm(id: string, v: SideChatPermView): void {
  const l = lives[id];
  if (l) l.state = { ...l.state, perm: { mode: v.mode === "auto" ? "auto" : "manual", allow: Array.isArray(v.allow) ? v.allow : [] } };
}

/** Auto 로 바꾸면 서버가 기다리는 카드도 허용으로 답한다 */
export async function setSideChatPermMode(id: string, mode: PermMode): Promise<void> {
  try {
    adoptPerm(id, await sideChatSetPermMode(id, mode));
  } catch (e) {
    const l = lives[id];
    if (l) l.error = sideChatErrorText(e);
  }
}

export async function forgetSideChatAllow(id: string, kind: string): Promise<void> {
  try {
    adoptPerm(id, await sideChatForgetAllow(id, kind));
  } catch (e) {
    const l = lives[id];
    if (l) l.error = sideChatErrorText(e);
  }
}

/** 빈 값(CLI 기본)은 대화 중 바꿀 수 없어 프로세스를 닫고 같은 대화로 다시 연다 */
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

/** 띄우지 않는다 — 다른 CLI 면 서버가 옛 프로세스를 닫고 새 항목을 세운다 */
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

export async function switchSideChatCli(tg: SideChatTarget): Promise<void> {
  targets.set(tg.id, tg);
  try {
    await reopen(tg);
  } catch (e) {
    const l = lives[tg.id];
    if (l) l.error = sideChatErrorText(e);
  }
}

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

// ── 연결 칩 ──

/** 채팅마다 차례로 건다 — 빨리 여러 번 고쳐도 서버가 마지막 뜻으로 끝나게 */
const linkPushes = new Map<string, Promise<void>>();

function pushLinks(id: string): Promise<void> {
  const p = (linkPushes.get(id) ?? Promise.resolve()).then(() => sendLinks(id));
  linkPushes.set(id, p);
  void p.finally(() => {
    if (linkPushes.get(id) === p) linkPushes.delete(id);
  });
  return p;
}

function closedView(stream: string): SideChatLinkView {
  return { stream, code: null, label: null, kind: null, readable: false, closed: true };
}

/** 서버 표에 없음은 조용히 — 다시 붙을 때 건다 */
function linkFailed(id: string, e: unknown): void {
  const l = lives[id];
  const msg = String(e);
  if (!l || hasReason(msg, "session-gone")) return;
  l.error = hasReason(msg, "server-outdated") ? t("app.chatDock.err.linksOutdated") : sideChatErrorText(e);
}

/** 모르는 타일(`[bad-link]`)은 저장에 둔 채 보기만 "닫힘" — 사람이 × 로 뺀다 */
async function sendLinks(id: string): Promise<void> {
  if (!lives[id]?.attached) return;
  const want = [...(targets.get(id)?.links ?? [])];
  let views: SideChatLinkView[];
  try {
    views = await pushKnownLinks(
      want,
      async (streams) => (await sideChatLink(id, streams)).links,
      (e) => hasReason(String(e), "bad-link"),
    );
  } catch (e) {
    linkFailed(id, e);
    return;
  }
  const l = lives[id];
  if (!l) return;
  const known = new Map(views.map((v) => [v.stream, v]));
  l.links = want.map((s) => known.get(s) ?? closedView(s));
}

/** 서버 표에 아직 없으면(붙기 전) 붙을 때 [`adopt`] 가 건다 */
export async function setSideChatLinks(id: string, tiles: readonly SideChatTileLink[]): Promise<void> {
  setSideChatTiles(id, tiles);
  const tg = targets.get(id);
  if (tg) targets.set(id, { ...tg, links: tiles.map((x) => x.stream) });
  if (!lives[id]?.attached) return;
  await pushLinks(id);
}

function storedLinks(id: string): SideChatTileLink[] {
  return sideChats().find((c) => c.id === id)?.tiles ?? [];
}

/** 찼으면 더하지 않고 `false` — 부르는 쪽이 안내한다 */
export async function addSideChatLink(id: string, tile: SideChatTileLink): Promise<boolean> {
  const next = withTileLink(storedLinks(id), tile);
  if (next.full) return false;
  await setSideChatLinks(id, next.links);
  return true;
}

export async function removeSideChatLink(id: string, stream: string): Promise<void> {
  await setSideChatLinks(id, withoutTileLink(storedLinks(id), stream));
}

/** 번호가 있어 같은 글을 두 번 채워도 다시 선다 */
const fills = $state<Record<string, { text: string; n: number }>>({});
let fillSeq = 0;

export function fillSideChatComposer(id: string, text: string): void {
  fills[id] = { text, n: ++fillSeq };
}

export function sideChatFillOf(id: string): { text: string; n: number } | null {
  return fills[id] ?? null;
}

/** 그 번호일 때만 걷는다 — 그 사이 새로 온 것은 둔다 */
export function takeSideChatFill(id: string, n: number): void {
  if (fills[id]?.n === n) delete fills[id];
}

export function clearEndedSideChat(id: string): void {
  const l = lives[id];
  if (l) l.state = clearEnded(l.state);
}

export function dismissSideChatError(id: string): void {
  const l = lives[id];
  if (l) l.error = null;
}

/** 폴더 지우기는 부르는 쪽(`app/side-chats` 의 `deleteSideChat`) */
export async function closeSideChatLive(id: string): Promise<void> {
  subs.get(id)?.();
  subs.delete(id);
  targets.delete(id);
  buffers.delete(id);
  delete lives[id];
  await sideChatClose(id).catch(() => false);
}
