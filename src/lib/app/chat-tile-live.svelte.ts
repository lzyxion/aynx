import { isRemote, listen } from "$lib/ipc";
import { isHandoff } from "$lib/tear";
import {
  chatTileChannel,
  chatTileClose,
  chatTileCompact,
  chatTileDecide,
  chatTileGoal,
  chatTileInterrupt,
  chatTileMcpStatus,
  chatTileOpen,
  chatTileReview,
  chatTileRewind,
  chatTileSend,
  chatTileSetEffort,
  chatTileSetModel,
  chatTileSetPermMode,
  chatTileSetTier,
  chatTileSubscribe,
  chatTileUnsubscribe,
  type ChatTileCliMode,
  type ChatTileCommands,
  type ChatTileCompaction,
  type ChatTileContext,
  type ChatTileDecision,
  type ChatTileEvent,
  type ChatTileMcpStatus,
  type ChatTileMode,
  type ChatTileRewindCaps,
  type ChatTileSnapshot,
  type ChatTileTiers,
  type GoalAction,
  type ReviewTargetWire,
} from "$lib/chat-tile/chat-tile-api";
import { reviewTargetError, reviewWireOf } from "$lib/chat-tile/chat-tile-review";
import { claudeGoalSet, goalBudgetOk, goalObjectiveError, goalViewOf } from "$lib/chat-tile/chat-tile-goal";
import { mcpRowsInherit, mcpRowsOf, mcpStatusOf, type McpAsk } from "$lib/chat-tile/chat-tile-mcp";
import { permModeOk, planOf } from "$lib/chat-tile/chat-tile-mode";
import {
  rewindQuote,
  rewindScopes,
  scopeHasConversation,
  scopeHasFiles,
  type ChatTileRewindAsk,
  type ChatTileRewindEv,
  type ChatTileRewindTrace,
} from "$lib/chat-tile/chat-tile-rewind";
import { t } from "$lib/i18n/i18n.svelte.js";
import {
  seqStep,
  type GoalViewWire,
  type RewindScope,
  type SessionAllowView,
  type SideChatCli,
  type SideChatEv,
  type SideChatSnapshot,
  type TierView,
} from "$lib/side-chat-api";
import { addSent, clearEnded, compactNoticeDetail, emptyLive, foldLive, markSendFailed, pendingPermissions, seedLive, type LiveState } from "$lib/side-chat-live";
import { findPaneAnywhere, tabOfPane } from "$lib/app/tabs.svelte.js";
import type { ChatTileSpec } from "$lib/session";
import { newChatTileId, tierOffered, tierOptions, tiersOf, tierWordOk } from "$lib/chat-tile/spec";
import { noteChatTileConversation, unlinkAgentSession } from "$lib/app/agent-sessions.svelte.js";
import { setChatTileBusy } from "$lib/app/chat-tile-busy";
import { dropChatTileStatus, setChatTileActivity } from "$lib/app/chat-tile-status.svelte.js";
import { noteChatTileEvent } from "$lib/app/chat-tile-notify";
import { clearAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
import { dropAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { isImageName } from "$lib/pane/composer-attachments";
import { localCommandOf, type ChatTileLocal, type ChatTilePartial, type ChatTilePlanDone, type ChatTileSessionTrace } from "$lib/chat-tile/chat-tile-view";

/**
 * 채팅 모양 AI 타일의 지금 상태 — 세션 서버 채팅 타일 표와 맞춘 이 창의 사본(docs/log/2026-11-27-chat-tile-contract.md).
 * stdin 에 닿는 것은 사람이 보낸 글 · 사람의 결정 · 사람의 제어뿐이다 — 이 모듈은 글을 짓지 않는다.
 * 서버 표에 없으면(`session-gone`) 명세의 `conv`(없으면 타일 폴더)로 다시 세운다 — 띄우지는 않는다(첫 보내기가 띄운다).
 * 원격 창은 메인 PC 의 명세 · 연결 표를 고치지 않는다. 오류는 서버 글 그대로(`[이유] …`) 둔다 — 문구는 화면이 고른다.
 * 탭 점 · 배너는 이 창이 받은 사건으로만 짓는다(`app/chat-tile-notify`) — 스냅숏으로 다시 맞춘 지난 일은 알리지 않는다.
 * 되감기는 사람이 연 카드에서만 — 미리 보기(`can:true`) 뒤 같은 기준점 · 범위 · 세대일 때만 실행을 보내고, 실행은 다시 보내지 않는다.
 * 검토 · 목표 · MCP 읽기도 사람이 누른 단추에서만 한 번 — 목표를 스스로 다시 켜거나 검토 · 읽기를 되풀이하지 않는다.
 */

export type { ChatTileRewindAsk, ChatTileRewindTrace } from "$lib/chat-tile/chat-tile-rewind";

export interface ChatTileTarget {
  paneId: string;
  chat: string;
  cli: SideChatCli;
  model: string;
  effort: string;
  cwd: string;
  conv: string | null;
  /** 명세의 `permMode` — 서버 표에서 잊혔을 때 다시 세우며 싣는다 */
  permMode: string | null;
  /** 명세의 `tier`(Codex 속도 등급) — 다시 세우며 싣는다 */
  tier?: string | null;
}

/** 화면이 대화에 남긴 고정 안내 — 메모리뿐 */
export interface ChatTileGoalNote {
  key: string;
  at: number;
}

export interface ChatTileCompactTrace {
  key: string;
  at: number;
  /** 꼬리 알림 줄과 같은 꼴(`compactNoticeDetail`) */
  detail: string;
}

/** 이 창이 본 검토 끝 표지 — 꼬리 알림 줄과 같은 낱말(`reviewed` · `review-stopped`) */
export interface ChatTileReviewTrace {
  key: string;
  at: number;
  code: "reviewed" | "review-stopped";
  label: string;
}

export interface ChatTileLive {
  cli: SideChatCli;
  state: LiveState;
  epoch: number;
  seq: number;
  /** 아니면 사건을 모은다 */
  attached: boolean;
  sending: boolean;
  /** 서버 오류 글 그대로("[이유] …") */
  error: string | null;
  /** 서버 표에 없고 다시 세우지 못했다(open 실패) — 그 오류는 `error` 에 */
  gone: boolean;
  /** 풀 때 같은 값만 — 새 구독을 풀지 않게 */
  subGen: number | null;
  /** 기록을 읽을 대화 — `target.conv` ?? 턴이 끝난 뒤의 `conversationId` */
  historyConv: string | null;
  mcpServers: string[];
  /** 권한 요청의 도구 입력(`requestId` →) — 꼬리 항목(`LiveEntry`)에는 칸이 없다 */
  permInputs: Record<string, unknown>;
  /** 사람이 고른 모델(빈 값 = CLI 기본) — 칩 · 메뉴가 읽는다. CLI 가 알린 실효 이름(`state.model`)이 아니다(사이드 채팅 칩과 같다) */
  pick: string;
  /** 끊긴 턴에서 본 글 — 기록(Codex 롤아웃)에 없는 부분 답을 기록 쪽에 다시 끼운다(`chat-tile/chat-tile-view.ts`) */
  partials: ChatTilePartial[];
  /** 사람이 보낸 `/` 명령의 턴(Claude `/context` · `/goal` 등) — 기록 읽기가 숨기는 말 · 출력을 타일이 떠 있는 동안 기록 쪽에 다시 끼운다 */
  locals: ChatTileLocal[];
  /** 마지막으로 CLI 가 알린 모드 · 고를 수 있는 값 — 한 번도 안 띄웠으면 null */
  cliMode: ChatTileCliMode | null;
  /** 서버가 다시 띄울 때 쓸 값(사람이 고른 것) — null = 사용자 CLI 설정 */
  permMode: string | null;
  /** 권한 요청의 늘 허용 요약(`requestId` →) — `permInputs` 와 같은 꼴 · 꼬리 항목에는 칸이 없다 */
  permSessions: Record<string, SessionAllowView>;
  /** 모드를 보내는 중 — 칩을 흐리게 */
  modeBusy: boolean;
  /** 이 창에서 보낸 결정(`requestId` →) — 답이 닿으면 계획 · 늘 허용 흔적을 짓고 지운다 */
  decided: Record<string, { decision: ChatTileDecision; message: string | null }>;
  /** 답한 Claude 계획 — 꼬리를 걷은 뒤에도 사람이 본 글 · 결과를 기록 쪽에 얹는다(`withPlans`). 화면 상태에만 — 명세 · 로그에 싣지 않는다 */
  plans: ChatTilePlanDone[];
  /** 이 창에서 누른 [이 대화에서 늘 허용] — 기록에는 남지 않아 타일이 떠 있는 동안만 보인다 */
  traces: ChatTileSessionTrace[];
  /** `/` 메뉴 재료 — 서버가 알린 것 ?? 이 창이 같은 (cli, cwd) 에서 마지막으로 본 것(메모리뿐) ?? null */
  commands: ChatTileCommands | null;
  context: ChatTileContext | null;
  lastCompaction: ChatTileCompaction | null;
  /** 이 창이 본 압축 끝 줄 — 꼬리가 걷힌 뒤에도 타일이 떠 있는 동안 기록 쪽에 남긴다(메모리뿐 · 기록에서 짓지 않는다) */
  compactions: ChatTileCompactTrace[];
  /** 압축 op 를 보낸 뒤 턴이 설 때까지 — `chatTileWorking` 이 본다 */
  compactBusy: boolean;
  rewindCaps: ChatTileRewindCaps | null;
  /** 줄지 않는다 — 바뀌면 화면이 기록을 처음부터 다시 읽는다 */
  rewindGen: number;
  /** 이 창에서 연 되감기 카드 — 하나뿐. 다른 창의 미리 보기 사건으로는 열리지 않는다 */
  rewindAsk: ChatTileRewindAsk | null;
  /** 이 창이 본 되감기 흔적 — 메모리뿐(늘 허용 흔적과 같다) */
  rewinds: ChatTileRewindTrace[];
  /** 입력 칸이 비었을 때만 화면이 넣는다(보내지 않는다) — `gen` 이 바뀔 때 한 번 */
  composerFill: { text: string; gen: number } | null;
  /** CLI 가 실은 MCP 서버 — 허용 칸만(`chat-tile-mcp`) · 한 번도 알리지 않았으면 null */
  mcpStatus: ChatTileMcpStatus | null;
  /** 사람이 연 MCP 읽기의 진행 — null = 묻지 않음 */
  mcpAsk: McpAsk | null;
  /** 그 읽기의 서버 거절 글 그대로 — 풍선이 보인다 */
  mcpError: string | null;
  /** Codex 목표 — 없으면 null */
  goal: GoalViewWire | null;
  /** 목표 op 를 보내는 중 — 띠 단추를 흐리게 */
  goalBusy: boolean;
  /** Claude `/goal <조건>` 을 보낸 뒤 남긴 안내(`chatTileNoticeText("goal-claude")`) */
  goalNotes: ChatTileGoalNote[];
  /** 사람이 고른 Codex 속도 등급 — null = CLI 기본 */
  tier: string | null;
  tiers: ChatTileTiers | null;
  /** review op 를 보낸 뒤 턴이 설 때까지 — `chatTileWorking` 이 본다 */
  reviewBusy: boolean;
  /** 이 창이 본 검토 끝 표지 — 꼬리가 걷힌 뒤에도 타일이 떠 있는 동안 기록 쪽에 남긴다(압축 줄과 같다) */
  reviews: ChatTileReviewTrace[];
  /** CLI 가 마지막으로 알린 모델 — 사람이 고른 것이 없을 때 속도 등급 표의 열쇠(스냅숏 `cliModel` · 사건 `ready`) */
  cliModel: string | null;
}

const PARTIALS_MAX = 20;
const COMMANDS_CACHE_MAX = 16;
/** 턴이 서지 않아도(CLI 가 받지 않음) 바쁨을 푼다 */
const COMPACT_WAIT_MS = 10_000;
/** 되감기 op 가 받힌 뒤 사건을 기다리는 시간 — 서버의 응답 시한과 같다 */
const REWIND_WAIT_MS = 30_000;
/** 검토 op 뒤 턴이 서지 않아도 바쁨을 푼다 */
const REVIEW_WAIT_MS = 15_000;
/** Codex 의 MCP 목록은 몇 초 걸린다 — 넘으면 "오래 걸림" · 시한을 넘으면 멈춘다(다시 묻지 않는다) */
const MCP_SLOW_MS = 5_000;
const MCP_WAIT_MS = 15_000;

/** 첫 보내기 전의 새 타일도 메뉴를 채우게 — 메모리뿐 · 저장하지 않는다 */
const commandsCache = new Map<string, ChatTileCommands>();

function cacheKey(cli: SideChatCli, cwd: string): string {
  return `${cli}|${cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()}`;
}

function cachedCommands(cli: SideChatCli, cwd: string): ChatTileCommands | null {
  return commandsCache.get(cacheKey(cli, cwd)) ?? null;
}

function cacheCommands(cli: SideChatCli, cwd: string, c: ChatTileCommands): void {
  const k = cacheKey(cli, cwd);
  commandsCache.delete(k);
  commandsCache.set(k, c);
  while (commandsCache.size > COMMANDS_CACHE_MAX) commandsCache.delete(commandsCache.keys().next().value as string);
}

function commandsOf(v: { commands?: unknown; terminal?: unknown }): ChatTileCommands {
  const commands = Array.isArray(v.commands)
    ? v.commands.filter((c) => !!c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string")
    : [];
  const terminal = Array.isArray(v.terminal) ? v.terminal.filter((n): n is string => typeof n === "string") : [];
  return { commands: commands as ChatTileCommands["commands"], terminal };
}

/** 보낸 말이 받혔는데 턴이 아직 서지 않았다(CLI 를 띄우는 중 · 첫 사건 전) */
export function awaitingTurn(s: LiveState): boolean {
  if (s.status === "running") return false;
  let user = -1;
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const e = s.entries[i];
    if (e.kind === "user" && e.n >= s.endedAt) {
      if (!e.failed) user = i;
      break;
    }
  }
  if (user < 0) return false;
  return !s.entries.slice(user + 1).some((e) => e.kind === "outcome" || e.kind === "exited");
}

/** 보내기를 받은 순간부터 턴이 끝날 때까지 + 대기 카드 — 닫기 물음 · 입력 칸이 같은 값을 본다 */
export function chatTileWorking(l: ChatTileLive): boolean {
  return (
    l.sending ||
    l.state.status === "running" ||
    awaitingTurn(l.state) ||
    pendingPermissions(l.state).length > 0 ||
    l.compactBusy ||
    l.reviewBusy ||
    l.rewindAsk?.phase === "applying"
  );
}

/** 끝나기 전 상태에서 — 이 턴의 보낸 말(사람 글 없이 선 턴은 null)과 그 턴에 흘러나온 에이전트 글 */
function partialOf(s: LiveState, at: number, start: number | null): ChatTilePartial | null {
  let u = -1;
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const e = s.entries[i];
    if (e.kind === "user") {
      u = i;
      break;
    }
  }
  // 지난 턴의 말은 이 턴의 것이 아니다 — 다른 턴에 붙지 않게
  const user = u >= 0 && s.entries[u].n >= s.endedAt ? s.entries[u] : null;
  const texts = s.entries.flatMap((e) => (e.kind === "text" && e.n >= s.endedAt && e.text.trim() !== "" ? [e.text] : []));
  if (texts.length === 0) return null;
  return { userText: user && user.kind === "user" ? user.text : null, texts, at, start };
}

/** 이 턴의 보낸 말의 `clientId` — 없으면 null */
function turnClientId(s: LiveState): string | null {
  for (let i = s.entries.length - 1; i >= 0; i--) {
    const e = s.entries[i];
    if (e.kind === "user") return e.n >= s.endedAt ? e.clientId : null;
  }
  return null;
}

const lives = $state<Record<string, ChatTileLive>>({});
const targets = new Map<string, ChatTileTarget>();
const observers = new Map<string, number>();
const buffers = new Map<string, ChatTileEvent[]>();
/** 구독마다 새 자리 — 늦게 온 옛 Channel 사건 · 옛 구독 답을 거른다 */
const seats = new Map<string, symbol>();
/** 관찰마다 새 표 — 떠난 뒤 늦게 끝난 다시 세우기가 새 관찰에 섞이지 않게 */
const alive = new Map<string, symbol>();
const joining = new Map<string, Promise<void>>();
/** 붙는 도중에 빈틈 · 재연결을 들었다 — 끝나면 한 번 더 붙는다 */
const again = new Set<string>();
/** 닫은 뒤 늦게 끝난 open 이 서버 항목을 되살리지 않게 */
const closed = new Set<string>();
/** 압축마다 새 표 — 앞 압축의 늦은 풀기가 새 압축의 바쁨을 풀지 않게 */
const compactMarks = new Map<string, symbol>();
/** 되감기 요청마다 새 표 — 앞 요청의 늦은 답 · 시한이 새 카드를 건드리지 않게 */
const rewindMarks = new Map<string, symbol>();
const rewindTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** 받은 미리 보기의 세대 — 프로세스가 바뀌면 서버도 그 미리 보기를 버린다 */
const previewEpochs = new Map<string, number>();
/** `both` 실행에서 먼저 끝난 파일 쪽 답 */
const filesParts = new Map<string, ChatTileRewindEv>();
/** 검토 · MCP 읽기마다 새 표 — 앞 요청의 늦은 시한이 새 요청을 건드리지 않게 */
const reviewMarks = new Map<string, symbol>();
const mcpMarks = new Map<string, symbol>();
const mcpTimers = new Map<string, ReturnType<typeof setTimeout>[]>();
/** 보낸 때(`clientId` →) · 턴이 선 때(채팅 →) — 기록의 줄과 자리를 맞추는 이 PC 시계 */
const sentTimes = new Map<string, number>();
const turnStarts = new Map<string, number>();
const SENT_TIMES_MAX = 64;
let clientSeq = 0;
let rewindSeq = 0;
let reconnectWatch = false;

export function chatTileLiveOf(chat: string): ChatTileLive | null {
  return lives[chat] ?? null;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function reasonIs(e: unknown, code: string): boolean {
  return errText(e).includes(`[${code}]`);
}

// ── 붙기 · 다시 맞추기 ──

function remember(tg: ChatTileTarget): ChatTileTarget {
  const cur = targets.get(tg.chat);
  const next = { ...tg, conv: tg.conv ?? cur?.conv ?? null };
  targets.set(tg.chat, next);
  return next;
}

function openMode(tg: ChatTileTarget): ChatTileMode {
  return tg.conv ? { kind: "resume", conv: tg.conv } : { kind: "fresh", cwd: tg.cwd || null };
}

function asSeed(s: ChatTileSnapshot): SideChatSnapshot {
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
    cwd: s.cwd,
    mcpServers: s.mcpServers,
    liveTurn: s.liveTurn,
    pending: s.pending,
  };
}

function blank(tg: ChatTileTarget, prev: ChatTileLive | null): ChatTileLive {
  return {
    cli: tg.cli,
    state: prev?.state ?? { ...emptyLive("stopped", tg.model, tg.conv), effort: tg.effort || null },
    epoch: prev?.epoch ?? 0,
    seq: prev?.seq ?? 0,
    attached: false,
    sending: prev?.sending ?? false,
    error: null,
    gone: false,
    subGen: null,
    historyConv: prev?.historyConv ?? tg.conv,
    mcpServers: prev?.mcpServers ?? [],
    permInputs: prev?.permInputs ?? {},
    pick: prev?.pick ?? tg.model,
    partials: prev?.partials ?? [],
    locals: prev?.locals ?? [],
    cliMode: prev?.cliMode ?? null,
    permMode: prev ? prev.permMode : tg.permMode,
    permSessions: prev?.permSessions ?? {},
    modeBusy: prev?.modeBusy ?? false,
    decided: prev?.decided ?? {},
    plans: prev?.plans ?? [],
    traces: prev?.traces ?? [],
    commands: prev?.commands ?? cachedCommands(tg.cli, tg.cwd),
    context: prev?.context ?? null,
    lastCompaction: prev?.lastCompaction ?? null,
    compactions: prev?.compactions ?? [],
    compactBusy: prev?.compactBusy ?? false,
    rewindCaps: prev?.rewindCaps ?? null,
    rewindGen: prev?.rewindGen ?? 0,
    rewindAsk: prev?.rewindAsk ?? null,
    rewinds: prev?.rewinds ?? [],
    composerFill: prev?.composerFill ?? null,
    mcpStatus: prev?.mcpStatus ?? null,
    mcpAsk: prev?.mcpAsk ?? null,
    mcpError: prev?.mcpError ?? null,
    goal: prev?.goal ?? null,
    goalBusy: prev?.goalBusy ?? false,
    goalNotes: prev?.goalNotes ?? [],
    tier: prev ? prev.tier : tierWordOk(tg.tier) ? tg.tier : null,
    tiers: prev?.tiers ?? null,
    reviewBusy: prev?.reviewBusy ?? false,
    reviews: prev?.reviews ?? [],
    cliModel: prev?.cliModel ?? null,
  };
}

/** 꼬리에 남은 권한 항목의 것만 */
function keepInputs<T>(state: LiveState, inputs: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const e of state.entries) if (e.kind === "permission" && e.requestId in inputs) out[e.requestId] = inputs[e.requestId];
  return out;
}

/** 아직 답하지 않은 권한 항목의 것만 — 답한 카드에 셋째 단추가 남지 않게 */
function keepSessions(state: LiveState, sessions: Record<string, SessionAllowView>): Record<string, SessionAllowView> {
  const out: Record<string, SessionAllowView> = {};
  for (const e of state.entries) {
    if (e.kind === "permission" && e.resolved === null && e.requestId in sessions) out[e.requestId] = sessions[e.requestId];
  }
  return out;
}

/** 메인 PC 창만 명세를 새 객체로 — 칩 밖 값(bypass 등)은 명세에 굳히지 않는다 */
function writePermMode(chat: string, permMode: string | null): void {
  const tg = targets.get(chat);
  if (!tg) return;
  const value = permMode !== null && permModeOk(tg.cli, permMode) ? permMode : null;
  if (tg.permMode !== value) targets.set(chat, { ...tg, permMode: value });
  if (isRemote) return;
  const pane = findPaneAnywhere(tg.paneId);
  if (pane?.kind !== "chat" || !pane.chat || (pane.chat.permMode ?? null) === value) return;
  const next = { ...pane.chat };
  if (value === null) delete next.permMode;
  else next.permMode = value;
  pane.chat = next;
}

function markBusy(chat: string): void {
  const tg = targets.get(chat);
  if (!tg) return;
  const l = lives[chat];
  setChatTileBusy(tg.paneId, !!l && chatTileWorking(l));
  if (l) setChatTileActivity(tg.paneId, tg.cli, { status: l.state.status, sending: l.sending, pending: pendingPermissions(l.state).length });
}

function adopt(chat: string, snap: ChatTileSnapshot, subGen: number | null): void {
  const prev = lives[chat] ?? null;
  const same = prev !== null && prev.cli === snap.cli;
  const state = seedLive(asSeed(snap), same ? prev.state : null);
  const tg = targets.get(chat) ?? {
    paneId: "",
    chat,
    cli: snap.cli,
    model: snap.model,
    effort: snap.effort ?? "",
    cwd: snap.cwd,
    conv: null,
    permMode: null,
    tier: null,
  };
  const base = blank(tg, same ? prev : null);
  const conv = snap.conversationId;
  const inputs: Record<string, unknown> = { ...base.permInputs };
  const sessions: Record<string, SessionAllowView> = { ...base.permSessions };
  for (const ev of [...snap.liveTurn, ...snap.pending]) {
    if (ev.t !== "permission") continue;
    if (ev.input !== undefined) inputs[ev.requestId] = ev.input;
    if (ev.sessionAllow) sessions[ev.requestId] = ev.sessionAllow;
  }
  // 옛 서버(칸 없음)는 모드를 모른다 — 명세를 지우지 않는다
  const knowsMode = snap.permMode !== undefined;
  lives[chat] = {
    ...base,
    cli: snap.cli,
    state,
    epoch: snap.epoch,
    seq: snap.seq,
    attached: true,
    gone: false,
    subGen,
    // 턴이 서기 전의 대화 id 는 CLI 기록에 아직 없다
    historyConv: base.historyConv ?? (snap.status === "running" || (same && state.ended > prev.state.ended) ? conv : null),
    mcpServers: snap.mcpServers ?? base.mcpServers,
    permInputs: keepInputs(state, inputs),
    permSessions: keepSessions(state, sessions),
    pick: snap.model,
    cliMode: snap.cliMode ?? null,
    permMode: knowsMode ? (snap.permMode ?? null) : base.permMode,
    commands: snap.commands ? commandsOf(snap.commands) : cachedCommands(snap.cli, tg.cwd),
    context: snap.context ?? null,
    lastCompaction: snap.lastCompaction ?? null,
    compactBusy: base.compactBusy && snap.status !== "running",
    rewindCaps: snap.rewind === undefined ? base.rewindCaps : snap.rewind,
    rewindGen: Math.max(base.rewindGen, snap.rewindGen ?? 0),
    mcpStatus: mcpStatusOf(snap.mcpStatus ?? null),
    goal: goalViewOf(snap.goal ?? null),
    tiers: tiersOf(snap.tiers ?? null),
    // 옛 서버(칸 없음)는 등급을 모른다 — 명세의 값을 둔다
    tier: snap.tier === undefined ? base.tier : tierWordOk(snap.tier) ? snap.tier : null,
    reviewBusy: base.reviewBusy && snap.status !== "running",
    // 옛 서버(칸 없음)는 모른다 — 이 창이 본 값을 둔다
    cliModel: typeof snap.cliModel === "string" && snap.cliModel !== "" ? snap.cliModel : base.cliModel,
  };
  checkPreviewEpoch(chat);
  if (snap.status === "running") holdRewind(chat, "[turn-running]");
  if (snap.commands) cacheCommands(snap.cli, tg.cwd, commandsOf(snap.commands));
  if (knowsMode) writePermMode(chat, snap.permMode ?? null);
  if (snap.status === "running" && conv) noteConversation(chat, conv);
  const buf = buffers.get(chat) ?? [];
  buffers.delete(chat);
  for (const e of buf) apply(chat, e);
  markBusy(chat);
}

async function subscribe(chat: string): Promise<void> {
  const owner = Symbol();
  seats.set(chat, owner);
  buffers.set(chat, buffers.get(chat) ?? []);
  const r = await chatTileSubscribe(
    chat,
    chatTileChannel(chat, (e) => {
      if (seats.get(chat) === owner) onEvent(chat, e);
    }),
  );
  if (seats.get(chat) !== owner) {
    void chatTileUnsubscribe(chat, r.subGen).catch(() => false);
    return;
  }
  const old = lives[chat]?.subGen ?? null;
  adopt(chat, r.snapshot, r.subGen);
  if (old !== null && old !== r.subGen) void chatTileUnsubscribe(chat, old).catch(() => false);
}

/** 서버 표에 세우고 구독한다 — CLI 는 띄우지 않는다 */
async function openAndSubscribe(chat: string, token: symbol | undefined): Promise<void> {
  const tg = targets.get(chat);
  if (!tg) return;
  const snap = await chatTileOpen({
    chat,
    cli: tg.cli,
    model: tg.model,
    effort: tg.effort || null,
    mode: openMode(tg),
    permMode: tg.permMode,
    tier: tg.cli === "codex" && tierWordOk(tg.tier) ? tg.tier : null,
  });
  if (alive.get(chat) !== token) {
    if (closed.has(chat)) void chatTileClose(chat).catch(() => false);
    return;
  }
  adopt(chat, snap, null);
  await subscribe(chat);
}

function markGone(chat: string, e: unknown): void {
  const tg = targets.get(chat);
  if (!tg) return;
  const prev = lives[chat] ?? null;
  const base = blank(tg, prev);
  lives[chat] = { ...base, attached: true, gone: true, error: errText(e), state: { ...base.state, status: "stopped" } };
  markBusy(chat);
}

async function attach(chat: string): Promise<void> {
  const token = alive.get(chat);
  try {
    await subscribe(chat);
    return;
  } catch (e) {
    if (!reasonIs(e, "session-gone")) throw e;
  }
  if (alive.get(chat) !== token) return;
  try {
    await openAndSubscribe(chat, token);
  } catch (e) {
    if (alive.get(chat) === token) markGone(chat, e);
  }
}

function runJoin(chat: string): Promise<void> {
  const running = joining.get(chat);
  if (running) return running;
  let p!: Promise<void>;
  p = (async () => {
    try {
      await attach(chat);
    } catch (e) {
      const tg = targets.get(chat);
      const l = lives[chat];
      if (l) {
        // 사건은 다시 받는다 — 다음 빈틈 · 보내기가 또 맞춘다
        l.attached = true;
        l.error = errText(e);
      } else if (tg) lives[chat] = { ...blank(tg, null), attached: true, error: errText(e) };
    } finally {
      if (joining.get(chat) === p) {
        joining.delete(chat);
        if (again.delete(chat)) void resync(chat);
      }
    }
  })();
  joining.set(chat, p);
  return p;
}

function join(tg: ChatTileTarget): Promise<void> {
  remember(tg);
  closed.delete(tg.chat);
  if (!alive.has(tg.chat)) alive.set(tg.chat, Symbol());
  watchReconnect();
  const l = lives[tg.chat];
  if (l?.attached && !l.gone && l.subGen !== null) return Promise.resolve();
  return runJoin(tg.chat);
}

/** `after` = 지금 붙는 중이면 그것이 끝난 뒤 한 번 더(빈틈 · 재연결 — 그 사이 놓친 사건이 있다) */
function resync(chat: string, after = false): Promise<void> {
  if (!targets.has(chat)) return Promise.resolve();
  const running = joining.get(chat);
  if (running) {
    if (after) again.add(chat);
    return running;
  }
  const l = lives[chat];
  if (l) l.attached = false;
  return runJoin(chat);
}

function noteConversation(chat: string, conv: string): void {
  const tg = targets.get(chat);
  if (!tg) return;
  if (tg.conv !== conv) targets.set(chat, { ...tg, conv });
  if (!isRemote) noteChatTileConversation(tg.paneId, tg.cli, conv);
}

function onEvent(chat: string, e: ChatTileEvent): void {
  const l = lives[chat];
  if (!l || !l.attached) {
    buffers.get(chat)?.push(e);
    return;
  }
  apply(chat, e);
}

function apply(chat: string, e: ChatTileEvent): void {
  const l = lives[chat];
  if (!l) return;
  const step = seqStep(l.seq, e.seq);
  if (step === "drop") return;
  if (step === "gap") {
    void resync(chat, true);
    return;
  }
  l.seq = e.seq;
  l.epoch = e.epoch;
  checkPreviewEpoch(chat);
  const ev: SideChatEv = e.ev;
  const ended = l.state.ended;
  const pendingBefore = pendingPermissions(l.state).length;
  if (ev.t === "turnEnded") {
    const now = Date.now();
    const start = turnStarts.get(chat) ?? null;
    turnStarts.delete(chat);
    const cid = turnClientId(l.state);
    const sent = cid !== null ? (sentTimes.get(cid) ?? null) : null;
    if (cid !== null) sentTimes.delete(cid);
    if (ev.outcome === "interrupted") {
      const p = partialOf(l.state, now, sent ?? start);
      if (p) l.partials = [...l.partials, p].slice(-PARTIALS_MAX);
    }
    const c = localCommandOf(l.state, sent ?? start ?? now);
    if (c) l.locals = [...l.locals, c].slice(-PARTIALS_MAX);
  }
  l.state = foldLive(l.state, ev);
  const tg = targets.get(chat);
  if (tg) noteChatTileEvent(tg.paneId, tg.cli, ev, { pendingBefore, pendingAfter: pendingPermissions(l.state).length });
  if (ev.t === "permission" && ev.input !== undefined) l.permInputs = { ...l.permInputs, [ev.requestId]: ev.input };
  if (ev.t === "permission" && ev.sessionAllow) l.permSessions = { ...l.permSessions, [ev.requestId]: ev.sessionAllow };
  if (ev.t === "permissionResolved") noteDecision(l, ev);
  if (ev.t === "permissionResolved" && ev.requestId in l.permSessions) {
    const rest = { ...l.permSessions };
    delete rest[ev.requestId];
    l.permSessions = rest;
  }
  if (ev.t === "turnStarted") {
    turnStarts.set(chat, Date.now());
    l.permInputs = keepInputs(l.state, l.permInputs);
    l.permSessions = keepSessions(l.state, l.permSessions);
    l.compactBusy = false;
    l.reviewBusy = false;
    reviewMarks.delete(chat);
  }
  if (ev.t === "mcpStatus") {
    // 사건에는 허용 칸 밖이 없어야 한다 — 와도 여기서 버린다
    const source = ev.source === "init" || ev.source === "startup" ? ev.source : "list";
    l.mcpStatus = { servers: mcpRowsInherit(mcpRowsOf(ev.servers), l.mcpStatus?.servers ?? null), source, stale: false };
    if (ev.source === "list") {
      endMcpWait(chat);
      l.mcpAsk = null;
      l.mcpError = null;
    }
  }
  if (ev.t === "notice" && ev.code === "mcp-status-failed" && (l.mcpAsk === "asking" || l.mcpAsk === "slow")) {
    endMcpWait(chat);
    l.mcpAsk = "failed";
  }
  // 검토 턴이 서지 않았다 — 기다림을 곧바로 푼다
  if (ev.t === "notice" && ev.code === "review-failed" && l.reviewBusy) {
    reviewMarks.delete(chat);
    l.reviewBusy = false;
  }
  if (ev.t === "review" && ev.phase !== "started") {
    const code: ChatTileReviewTrace["code"] = ev.phase === "stopped" ? "review-stopped" : "reviewed";
    l.reviews = [...l.reviews, { key: `rv${++rewindSeq}`, at: Date.now(), code, label: ev.label }].slice(-PARTIALS_MAX);
  }
  if (ev.t === "ready" && typeof ev.model === "string" && ev.model !== "") l.cliModel = ev.model;
  if (ev.t === "goal") l.goal = goalViewOf(ev.goal);
  if (ev.t === "serviceTiers") l.tiers = tiersOf({ byModel: ev.byModel, thread: ev.thread });
  if (ev.t === "commands") {
    l.commands = commandsOf(ev);
    if (tg) cacheCommands(tg.cli, tg.cwd, l.commands);
  }
  if (ev.t === "contextUsage") l.context = { used: ev.used, window: ev.window ?? null, source: ev.source };
  if (ev.t === "compaction" && ev.phase === "done") {
    l.lastCompaction = { trigger: ev.trigger ?? null, preTokens: ev.preTokens ?? null, postTokens: ev.postTokens ?? null };
    const at = Date.now();
    l.compactions = [...l.compactions, { key: `cp${++rewindSeq}`, at, detail: compactNoticeDetail(ev.preTokens ?? null, ev.postTokens ?? null) }].slice(-PARTIALS_MAX);
  }
  if (ev.t === "rewindCaps") l.rewindCaps = { files: ev.files, conversation: ev.conversation };
  if (ev.t === "rewind") noteRewind(chat, ev);
  if (ev.t === "turnStarted") holdRewind(chat, "[turn-running]");
  if (ev.t === "exited") holdRewind(chat, "[exited]");
  if (ev.t === "mcpServers") l.mcpServers = ev.names;
  if (ev.t === "cliMode") {
    l.cliMode = { mode: ev.mode, choices: Array.isArray(ev.choices) ? ev.choices.filter((c) => typeof c === "string") : [] };
    // 칸이 없으면 서버가 쥔 값이 바뀌지 않았다(사람이 고른 적 없음)
    if ("chosen" in ev) {
      l.permMode = ev.chosen ?? null;
      writePermMode(chat, l.permMode);
    }
  }
  const conv = l.state.conversationId;
  const changed = ev.t === "notice" && ev.code === "conversation-changed" && l.state.status === "running";
  // 턴이 선 대화만 — 그 전의 id(Claude fresh 의 `ready`)는 CLI 기록에 아직 없다
  if ((ev.t === "turnStarted" || changed) && conv) noteConversation(chat, conv);
  if (l.state.ended !== ended && conv) l.historyConv = conv;
  markBusy(chat);
}

/** 답이 닿은 결정의 흔적 — 계획은 누가 답했든(본 글 · 결과), 늘 허용은 이 창에서 누른 것만(무엇을 허용했는지 안다) */
function noteDecision(l: ChatTileLive, ev: Extract<SideChatEv, { t: "permissionResolved" }>): void {
  const id = ev.requestId;
  const mine = l.decided[id] ?? null;
  if (mine) {
    const rest = { ...l.decided };
    delete rest[id];
    l.decided = rest;
  }
  const e = l.state.entries.find((x) => x.kind === "permission" && x.requestId === id);
  if (!e || e.kind !== "permission") return;
  const at = Date.now();
  const human = ev.by === "human";
  if (e.toolName === "ExitPlanMode") {
    const p = planOf(l.permInputs[id], e.detail);
    const outcome: ChatTilePlanDone["outcome"] = !human ? "cancelled" : ev.decision === "allow" ? "approved" : "kept";
    const feedback = outcome === "kept" && mine?.decision === "deny" ? mine.message : null;
    l.plans = [...l.plans, { at, plan: p.plan, file: p.path, outcome, feedback }].slice(-PARTIALS_MAX);
    return;
  }
  const allow = l.permSessions[id];
  if (human && ev.decision === "allow" && mine?.decision === "allowSession" && allow) {
    l.traces = [...l.traces, { requestId: id, at, allow: { kind: allow.kind, detail: allow.detail } }].slice(-PARTIALS_MAX);
  }
}

function watchReconnect(): void {
  if (reconnectWatch || typeof window === "undefined") return;
  reconnectWatch = true;
  void listen("session-server-connected", () => {
    for (const chat of Object.keys(lives)) void resync(chat, true);
  }).catch(() => {});
}

/** 마운트된 동안 건다(숨은 탭도 구독을 쥐어 TTL 이 돌지 않게). 같은 chat 의 마지막 관찰자만 떠난다 */
export function observeChatTile(tg: ChatTileTarget): () => void {
  observers.set(tg.chat, (observers.get(tg.chat) ?? 0) + 1);
  void join(tg);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (observers.get(tg.chat) ?? 1) - 1;
    if (n > 0) observers.set(tg.chat, n);
    else {
      observers.delete(tg.chat);
      leave(tg.chat);
    }
  };
}

/** 이 창의 사본만 걷는다 — 서버 항목은 산다(옮겨 간 창 · 리로드가 다시 구독한다) */
function leave(chat: string, unsubscribe = true): void {
  const l = lives[chat];
  const tg = targets.get(chat);
  seats.delete(chat);
  alive.delete(chat);
  targets.delete(chat);
  buffers.delete(chat);
  joining.delete(chat);
  again.delete(chat);
  endRewindWait(chat);
  previewEpochs.delete(chat);
  filesParts.delete(chat);
  reviewMarks.delete(chat);
  turnStarts.delete(chat);
  endMcpWait(chat);
  delete lives[chat];
  if (tg) {
    setChatTileBusy(tg.paneId, false);
    // 이관으로 떠나는 잎도 이 길 — 이 창의 표시만 지운다
    dropChatTileStatus(tg.paneId);
    clearAgentUnseen([tg.paneId]);
    dropAgentBanner(tg.paneId);
  }
  if (unsubscribe && l?.subGen != null) void chatTileUnsubscribe(chat, l.subGen).catch(() => false);
}

// ── 조작 ──

/** `stale-chat` · `session-gone` 이면 다시 붙은 뒤 한 번 더 — 서버는 그 둘을 글을 쓰기 전에 거절한다 */
async function withEpoch<T>(chat: string, run: (epoch: number) => Promise<T>): Promise<T> {
  try {
    return await run(lives[chat]?.epoch ?? 0);
  } catch (e) {
    if (!reasonIs(e, "stale-chat") && !reasonIs(e, "session-gone")) throw e;
    await resync(chat);
    const l = lives[chat];
    if (!l || l.gone) throw e;
    return await run(l.epoch);
  }
}

async function ready(chat: string): Promise<boolean> {
  const l = lives[chat];
  if (l?.attached && !l.gone && l.subGen !== null) return true;
  await runJoin(chat);
  const after = lives[chat];
  return !!after && !after.gone && after.subGen !== null;
}

/**
 * 사람 글 · 사람이 붙인 첨부(앱 첨부 자리의 사본 경로)만 · 낙관 표시 후 서버 — 실패면 말풍선에 실패 표시 · `error`. 참이면 입력 칸을 비운다.
 * 그림 / 파일 판정(`isImageName`)은 서버 · 사이드 채팅과 같은 표다.
 */
export function sendChatTile(
  tg: ChatTileTarget,
  text: string,
  attachments: readonly { path: string; name: string }[] = [],
  skills: readonly string[] = [],
): boolean {
  const chat = tg.chat;
  // Claude 스킬은 슬래시 글이다 — 실으면 서버가 `[unsupported]` 로 거절한다
  const picked = tg.cli === "codex" ? [...skills] : [];
  const cur = lives[chat] ?? null;
  if ((text.trim() === "" && attachments.length === 0) || (cur && chatTileWorking(cur))) return false;
  const images = attachments.filter((a) => isImageName(a.path)).map((a) => a.path);
  const files = attachments.filter((a) => !isImageName(a.path)).map((a) => a.path);
  const target = remember(tg);
  const clientId = `c${Date.now().toString(36)}${(++clientSeq).toString(36)}`;
  if (!lives[chat]) lives[chat] = { ...blank(target, null), attached: true };
  const now = lives[chat];
  now.state = addSent(now.state, text, clientId, attachments.map((a) => a.name));
  sentTimes.set(clientId, Date.now());
  while (sentTimes.size > SENT_TIMES_MAX) sentTimes.delete(sentTimes.keys().next().value as string);
  now.sending = true;
  now.error = null;
  markBusy(chat);
  void (async () => {
    try {
      if (!(await ready(chat))) throw new Error(lives[chat]?.error ?? "[session-gone] chat tile is not attached");
      const r = await withEpoch(chat, (epoch) => chatTileSend(chat, epoch, text, clientId, images, files, picked));
      const after = lives[chat];
      if (after && r.epoch > after.epoch) after.epoch = r.epoch;
      if (after && target.cli === "claude" && claudeGoalSet(text)) {
        after.goalNotes = [...after.goalNotes, { key: `gn${++rewindSeq}`, at: Date.now() }].slice(-PARTIALS_MAX);
      }
    } catch (e) {
      const after = lives[chat];
      if (after) {
        after.state = markSendFailed(after.state, clientId);
        after.error = errText(e);
      }
    } finally {
      const after = lives[chat];
      if (after) after.sending = false;
      markBusy(chat);
    }
  })();
  return true;
}

/**
 * 사람이 부른 맥락 압축 — 띄우지 않는다. 바쁨은 턴이 서면(`turnStarted`) 풀고, 오지 않으면 잠시 뒤 푼다. 일하는 중이면 보내지 않고 거짓.
 * 빈 지침은 없음으로 보낸다.
 */
export async function compactChatTile(tg: ChatTileTarget, instructions?: string | null): Promise<boolean> {
  const chat = tg.chat;
  remember(tg);
  const l = lives[chat];
  if (!l || chatTileWorking(l)) return false;
  const instr = instructions && instructions.trim() !== "" ? instructions : null;
  const mark = Symbol();
  compactMarks.set(chat, mark);
  l.compactBusy = true;
  l.error = null;
  markBusy(chat);
  const release = () => {
    if (compactMarks.get(chat) !== mark) return;
    compactMarks.delete(chat);
    const after = lives[chat];
    if (after?.compactBusy) {
      after.compactBusy = false;
      markBusy(chat);
    }
  };
  const timer = setTimeout(release, COMPACT_WAIT_MS);
  try {
    await withEpoch(chat, (epoch) => chatTileCompact(chat, epoch, instr));
    return true;
  } catch (e) {
    clearTimeout(timer);
    const after = lives[chat];
    if (after) after.error = errText(e);
    release();
    return false;
  }
}

// ── 되감기 ──

function endRewindWait(chat: string): void {
  const timer = rewindTimers.get(chat);
  if (timer !== undefined) clearTimeout(timer);
  rewindTimers.delete(chat);
  rewindMarks.delete(chat);
}

function setAsk(chat: string, patch: Partial<ChatTileRewindAsk> | null): void {
  const l = lives[chat];
  if (!l) return;
  if (patch === null) {
    endRewindWait(chat);
    filesParts.delete(chat);
    l.rewindAsk = null;
  } else if (l.rewindAsk) l.rewindAsk = { ...l.rewindAsk, ...patch };
  markBusy(chat);
}

function pushRewindTrace(l: ChatTileLive, t: Omit<ChatTileRewindTrace, "key" | "at">): void {
  l.rewinds = [...l.rewinds, { ...t, key: `rw${++rewindSeq}`, at: Date.now() }].slice(-PARTIALS_MAX);
}

/** 미리 보기가 실은 파일 수 — 모르면 null */
function previewFiles(ask: ChatTileRewindAsk | null): number | null {
  const p = ask?.preview;
  return p ? p.files.length + p.moreFiles : null;
}

/** 카드를 열어 둔 채 실행을 막는다 — 미리 보기는 버린다(사람이 다시 확인한다) */
function holdRewind(chat: string, reason: string): void {
  const ask = lives[chat]?.rewindAsk;
  if (!ask) return;
  endRewindWait(chat);
  setAsk(chat, { phase: "ready", preview: null, error: reason });
}

/** 다른 세대의 미리 보기로는 실행하지 않는다 — 서버도 그것을 버린다 */
function checkPreviewEpoch(chat: string): void {
  const l = lives[chat];
  const at = previewEpochs.get(chat);
  if (!l || at === undefined || l.epoch === at) return;
  previewEpochs.delete(chat);
  const ask = l.rewindAsk;
  if (ask?.phase === "ready" && ask.preview) setAsk(chat, { preview: null, error: "[preview-first]" });
}

function armRewindWait(chat: string, mark: symbol, phase: "loading" | "applying"): void {
  const prev = rewindTimers.get(chat);
  if (prev !== undefined) clearTimeout(prev);
  rewindTimers.set(
    chat,
    setTimeout(() => {
      const l = lives[chat];
      const ask = l?.rewindAsk;
      if (!l || !ask || rewindMarks.get(chat) !== mark || ask.phase !== phase) return;
      rewindTimers.delete(chat);
      rewindMarks.delete(chat);
      if (ask.filesDone) pushRewindTrace(l, { scope: "files", quote: ask.quote, files: previewFiles(ask), turns: null, skippedLinks: filesParts.get(chat)?.skippedLinks ?? null });
      filesParts.delete(chat);
      // 실행이 어디까지 됐는지 모른다 — 같은 미리 보기로 다시 보내지 않게 버린다
      setAsk(chat, { phase: "ready", error: "[rewind-timeout]", ...(phase === "applying" ? { preview: null } : {}) });
    }, REWIND_WAIT_MS),
  );
}

/** 사건 `rewind` — 미리 보기는 물은 창의 카드만 · 끝은 모든 창에 흔적 · 대화가 바뀌었으면 기록을 다시 읽게 */
function noteRewind(chat: string, ev: ChatTileRewindEv): void {
  const l = lives[chat];
  if (!l) return;
  const ask = l.rewindAsk;
  const mine = ask !== null && ask.anchor === ev.anchor && (ask.scope === ev.scope || ask.scope === "both");
  if (ev.phase === "preview") {
    if (!ask || ask.phase !== "loading" || ask.anchor !== ev.anchor || ask.scope !== ev.scope) return;
    endRewindWait(chat);
    previewEpochs.set(chat, l.epoch);
    // `can:false` 의 CLI 글은 카드 본문(`rewindCardLines`)이 말한다
    setAsk(chat, { phase: "ready", preview: ev, error: null });
    return;
  }
  if (ev.phase === "failed") {
    if (!mine || !ask) return;
    if (ask.filesDone) {
      pushRewindTrace(l, { scope: "files", quote: ask.quote, files: previewFiles(ask), turns: null, skippedLinks: filesParts.get(chat)?.skippedLinks ?? null });
    }
    endRewindWait(chat);
    filesParts.delete(chat);
    setAsk(chat, { phase: "ready", preview: null, error: ev.error ?? "[rewind-failed]" });
    return;
  }
  // `both` 는 파일이 먼저 — 대화 쪽 답을 더 기다린다
  if (mine && ask && ask.scope === "both" && ev.scope === "files" && !ask.filesDone) {
    filesParts.set(chat, ev);
    setAsk(chat, { filesDone: true });
    const mark = rewindMarks.get(chat);
    if (mark) armRewindWait(chat, mark, "applying");
    return;
  }
  const scope: RewindScope = mine && ask?.scope === "both" && ev.scope === "conversation" && ask.filesDone ? "both" : ev.scope;
  pushRewindTrace(l, {
    scope,
    quote: mine && ask ? ask.quote : "",
    files: mine && scopeHasFiles(scope) ? previewFiles(ask) : null,
    turns: ev.turns ?? (mine ? (ask?.preview?.turns ?? null) : null),
    skippedLinks: ev.skippedLinks ?? (mine ? (filesParts.get(chat)?.skippedLinks ?? null) : null),
  });
  if (scopeHasConversation(ev.scope)) {
    l.rewindGen += 1;
    l.context = null;
    l.lastCompaction = null;
    if (mine && ask && ask.text.trim() !== "") l.composerFill = { text: ask.text, gen: l.rewindGen };
  }
  if (mine) setAsk(chat, null);
}

/** 보낸 op 가 받히면 사건을 기다린다 — 실행은 세대가 바뀌어도 다시 보내지 않는다(서버가 `[preview-first]` 로 막는다) */
function requestRewind(chat: string, dryRun: boolean): void {
  const ask = lives[chat]?.rewindAsk;
  if (!ask) return;
  const { anchor, scope } = ask;
  const phase = dryRun ? "loading" : "applying";
  endRewindWait(chat);
  const mark = Symbol();
  rewindMarks.set(chat, mark);
  if (dryRun) previewEpochs.delete(chat);
  const still = () => rewindMarks.get(chat) === mark && lives[chat]?.rewindAsk?.phase === phase;
  void (async () => {
    try {
      let r: { epoch: number };
      if (dryRun) {
        if (!(await ready(chat))) throw new Error(lives[chat]?.error ?? "[session-gone] chat tile is not attached");
        r = await withEpoch(chat, (epoch) => chatTileRewind(chat, epoch, anchor, scope, true));
      } else {
        r = await chatTileRewind(chat, lives[chat]?.epoch ?? 0, anchor, scope, false);
      }
      const after = lives[chat];
      if (after && typeof r?.epoch === "number" && r.epoch > after.epoch) after.epoch = r.epoch;
      if (still()) armRewindWait(chat, mark, phase);
    } catch (e) {
      if (!still()) return;
      const cur = lives[chat]?.rewindAsk ?? null;
      const stale = reasonIs(e, "stale-chat") || reasonIs(e, "session-gone");
      endRewindWait(chat);
      setAsk(chat, { phase: "ready", error: errText(e), ...(dryRun || stale || reasonIs(e, "preview-first") ? { preview: null } : { preview: cur?.preview ?? null }) });
      if (!dryRun && stale) void resync(chat);
    }
  })();
}

/**
 * 사람이 누른 되감기 — 카드를 열고 미리 보기를 묻는다. 일하는 중 · 카드가 이미 있음 · 범위 없음이면 거짓.
 * `scope` 를 주지 않으면 그 CLI 의 기본(Claude `both` · 파일 캡이 없으면 `conversation` · Codex `conversation`).
 */
export function askRewind(
  tg: ChatTileTarget,
  req: { anchor: string; text: string | null; localTurns: number | null; localFiles: string[] | null; scope?: RewindScope },
): boolean {
  const chat = tg.chat;
  remember(tg);
  const l = lives[chat];
  if (!l || l.rewindAsk || chatTileWorking(l) || req.anchor === "") return false;
  const scopes = rewindScopes(l.cli, l.rewindCaps);
  const scope = req.scope !== undefined && scopes.includes(req.scope) ? req.scope : scopes[0];
  if (scope === undefined) return false;
  l.rewindAsk = {
    anchor: req.anchor,
    scope,
    // 그림만 보낸 메시지 — 빈 인용은 흔적이 "다른 창" 으로 읽는다
    quote: rewindQuote(req.text) || t("pane.chatTile.rewind.imageOnly"),
    text: req.text ?? "",
    localTurns: req.localTurns,
    localFiles: req.localFiles,
    phase: "loading",
    preview: null,
    error: null,
    filesDone: false,
    compacted: l.lastCompaction !== null,
  };
  filesParts.delete(chat);
  requestRewind(chat, true);
  markBusy(chat);
  return true;
}

/** 카드의 범위 고르기 — 미리 보기를 다시 묻는다(실행은 미리 본 범위에만 된다). 같은 범위면 미리 보기가 없을 때만 다시 묻는다 */
export function changeRewindScope(tg: ChatTileTarget, scope: RewindScope): boolean {
  const chat = tg.chat;
  const l = lives[chat];
  const ask = l?.rewindAsk;
  if (!l || !ask || ask.phase !== "ready" || chatTileWorking(l)) return false;
  if (!rewindScopes(l.cli, l.rewindCaps).includes(scope)) return false;
  if (scope === ask.scope && ask.preview) return false;
  filesParts.delete(chat);
  setAsk(chat, { scope, phase: "loading", preview: null, error: null, filesDone: false });
  requestRewind(chat, true);
  return true;
}

/** 카드의 [실행] — 같은 기준점 · 범위 · 세대의 `can:true` 미리 보기가 있을 때만 */
export function confirmRewind(tg: ChatTileTarget): boolean {
  const chat = tg.chat;
  const l = lives[chat];
  const ask = l?.rewindAsk;
  const p = ask?.preview;
  if (!l || !ask || ask.phase !== "ready" || !p || p.phase !== "preview" || !p.can) return false;
  if (p.anchor !== ask.anchor || p.scope !== ask.scope || previewEpochs.get(chat) !== l.epoch || chatTileWorking(l)) return false;
  filesParts.delete(chat);
  setAsk(chat, { phase: "applying", error: null, filesDone: false });
  requestRewind(chat, false);
  return true;
}

/** 서버에 보내지 않는다 — 미리 보기는 아무것도 바꾸지 않았다. 실행 중에는 닫지 않는다(결과를 카드가 받는다) */
export function cancelRewind(chat: string): void {
  const ask = lives[chat]?.rewindAsk;
  if (!ask || ask.phase === "applying") return;
  setAsk(chat, null);
}

/**
 * 이 자리에 새 채팅 — 같은 cli · model · effort · tier · cwd 의 새 대화로 바꾼다(권한 모드 · 대화는 물려주지 않는다).
 * 원격 창 · 일하는 중이면 거짓.
 */
export function newChatInPlace(tg: ChatTileTarget): boolean {
  const cur = targets.get(tg.chat) ?? tg;
  const tier = cur.cli === "codex" && tierWordOk(cur.tier) ? { tier: cur.tier } : {};
  return replaceInPlace(tg, newChatTileId(), { cli: cur.cli, model: cur.model, effort: cur.effort, ...tier }, "");
}

/**
 * 다른 CLI 의 새 대화로 바꾼다 — 대화 기록은 CLI 마다 따로라 이어받지 않는다(하던 대화는 지난 대화 목록에 남는다).
 * 폴더만 물려준다 — 모델 · 강도 · 권한 모드 · 속도 등급은 CLI 마다 뜻이 다르다. `draft` 는 새 몸의 입력 칸이 한 번 받는다(`takeChatTileDraft`).
 */
export function switchChatTileCli(tg: ChatTileTarget, cli: SideChatCli, draft = ""): boolean {
  if (cli === (targets.get(tg.chat) ?? tg).cli) return false;
  return replaceInPlace(tg, newChatTileId(), { cli, model: "", effort: "" }, draft);
}

/** 바꾼 뒤 새 몸이 마운트하며 한 번 받는다 — null 이면 바꾼 자리가 아니다(포커스를 가져가지 않는다) */
export function takeChatTileDraft(chat: string): string | null {
  const d = drafts.get(chat);
  if (d === undefined) return null;
  drafts.delete(chat);
  return d;
}

const drafts = new Map<string, string>();

/**
 * 잎(pane id)은 그대로 두고 명세의 `chat` 만 새 채팅으로 바꾼다 — 타일 틀 · 머리줄은 다시 서지 않아 등장 애니메이션이 돌지 않는다.
 * 옛 항목 닫기 · 새 항목 붙기는 잎이 `chatId` 를 따라 한다(`ChatTileLeaf`).
 */
function replaceInPlace(
  tg: ChatTileTarget,
  chatId: string,
  spec: Pick<ChatTileSpec, "cli" | "model" | "effort" | "tier">,
  draft: string,
): boolean {
  // 원격 창은 명세를 쓰지 않는다 — 메인 PC 창에서만
  if (isRemote) return false;
  const l = lives[tg.chat];
  if (l && chatTileWorking(l)) return false;
  const pane = tabOfPane(tg.paneId) ? findPaneAnywhere(tg.paneId) : null;
  if (pane?.kind !== "chat" || pane.chat?.chatId !== tg.chat) return false;
  const cwd = (targets.get(tg.chat) ?? tg).cwd;
  drafts.set(chatId, draft);
  pane.chat = { chatId, ...spec, cwd };
  return true;
}

export async function interruptChatTile(chat: string): Promise<void> {
  try {
    await withEpoch(chat, (epoch) => chatTileInterrupt(chat, epoch));
  } catch (e) {
    const l = lives[chat];
    if (l) l.error = errText(e);
  }
}

/**
 * 사람의 그 자리 결정 — 다른 창이 먼저 답했거나 세대가 바뀌었으면 다시 맞추기만 한다(다시 보내지 않는다).
 * 늘 허용은 결정 낱말만 보낸다 — 무엇을 실을지는 서버 어댑터가 고른다. `answers` 는 사람이 고르거나 친 답만.
 */
export async function decideChatTile(
  chat: string,
  requestId: string,
  decision: ChatTileDecision,
  extra?: { message?: string | null; answers?: Readonly<Record<string, string>> },
): Promise<void> {
  const l0 = lives[chat];
  // 답 글(질문 답)은 담지 않는다 — 고칠 점 · 결정 낱말만
  if (l0) l0.decided = { ...l0.decided, [requestId]: { decision, message: extra?.message ?? null } };
  try {
    await chatTileDecide(chat, lives[chat]?.epoch ?? 0, requestId, decision, extra?.message ?? null, extra?.answers ?? null);
  } catch (e) {
    const l = lives[chat];
    if (l && requestId in l.decided) {
      const rest = { ...l.decided };
      delete rest[requestId];
      l.decided = rest;
    }
    if (reasonIs(e, "unknown-request") || reasonIs(e, "stale-chat") || reasonIs(e, "session-gone")) {
      void resync(chat);
      return;
    }
    if (l) l.error = errText(e);
  }
}

/** 지금 모델 — 사람이 고른 것 · 없으면 CLI 가 알린 실효 이름(속도 등급 표의 열쇠 — 어댑터의 판정과 같은 순서) */
export function chatTileModelNow(l: ChatTileLive): string {
  return l.pick || l.cliModel || l.state.model || "";
}

/** 지금 모델이 알린 속도 등급 — 메뉴의 속도 줄 재료 */
export function chatTileTierOptions(l: ChatTileLive): TierView[] {
  return l.cli === "codex" ? tierOptions(l.tiers, chatTileModelNow(l)) : [];
}

/**
 * 칩 표 · 속도 줄이 보일 지금 등급 — 고른 등급은 그 목록을 몰라도 숨기지 않는다(이름은 다른 모델이 알린 것 · 없으면 id).
 * 숨기면 칩도 끌 길도 없이 등급이 산다.
 */
export function chatTileTierNow(l: ChatTileLive): TierView | null {
  if (l.cli !== "codex" || !l.tier) return null;
  const id = l.tier;
  const own = chatTileTierOptions(l).find((o) => o.id === id);
  if (own) return own;
  const any = Object.values(l.tiers?.byModel ?? {})
    .flat()
    .find((o) => o.id === id);
  return { id, name: any?.name ?? id, description: "" };
}

/** 명세의 `tier` 를 새 객체로 — 빈 값은 칸째 뺀다 */
function withTier<T extends { tier?: string }>(spec: T, tier: string | null): T {
  const next = { ...spec };
  if (tier) next.tier = tier;
  else delete next.tier;
  return next;
}

/**
 * 성공하면 메인 PC 창의 명세를 새 객체로 갈음한다(원격 창은 사본만). `tier: ""` = CLI 기본.
 * 등급은 지금 모델의 목록에 있는 id 만 보낸다 · 모델을 바꿔 그 모델에 없는 등급이면 CLI 기본으로 되돌린다.
 */
export async function retuneChatTile(tg: ChatTileTarget, p: { model?: string; effort?: string; tier?: string }): Promise<boolean> {
  const chat = tg.chat;
  remember(tg);
  const l0 = lives[chat];
  let tier: string | null | undefined = p.tier === undefined ? undefined : p.tier === "" ? null : p.tier;
  if (tier !== undefined && tg.cli !== "codex") {
    // Claude 는 속도 등급이 없다 — 값은 거절 · CLI 기본은 보낼 것이 없다
    if (tier !== null) return false;
    tier = undefined;
  }
  if (tier !== undefined) {
    const model = p.model !== undefined ? p.model : l0 ? chatTileModelNow(l0) : "";
    if (tier !== null && !tierOffered(l0?.tiers ?? null, model, tier)) return false;
  } else if (p.model !== undefined && p.model !== "" && l0?.tier && l0.tiers && !tierOffered(l0.tiers, p.model, l0.tier)) {
    tier = null;
  }
  try {
    if (p.model !== undefined) {
      const model = p.model;
      await withEpoch(chat, (epoch) => chatTileSetModel(chat, epoch, model));
      const l = lives[chat];
      if (l) {
        l.state = { ...l.state, model };
        l.pick = model;
      }
    }
    if (p.effort !== undefined) {
      const effort = p.effort;
      await withEpoch(chat, (epoch) => chatTileSetEffort(chat, epoch, effort || null));
      const l = lives[chat];
      if (l) l.state = { ...l.state, effort: effort || null };
    }
    if (tier !== undefined) {
      const value = tier;
      await withEpoch(chat, (epoch) => chatTileSetTier(chat, epoch, value));
      const l = lives[chat];
      if (l) l.tier = value;
    }
    const patch = { ...(p.model !== undefined ? { model: p.model } : {}), ...(p.effort !== undefined ? { effort: p.effort } : {}) };
    const now = targets.get(chat);
    if (now) targets.set(chat, { ...now, ...patch, ...(tier !== undefined ? { tier } : {}) });
    // 원격 창은 명세를 쓰지 않는다 — 등급도 산 값만 바꾼다
    if (!isRemote) {
      const pane = findPaneAnywhere(tg.paneId);
      if (pane?.kind === "chat" && pane.chat) {
        const next = { ...pane.chat, ...patch };
        pane.chat = tier !== undefined ? withTier(next, tier) : next;
      }
    }
    return true;
  } catch (e) {
    const l = lives[chat];
    if (l) l.error = errText(e);
    return false;
  }
}

// ── 검토 · 목표 · MCP 상태 ──

/**
 * 사람이 고른 검토(Codex) — 일하는 중이거나 대상이 틀리면 보내지 않고 거짓. 바쁨은 턴이 서면 풀고, 오지 않으면 잠시 뒤 푼다.
 * 프로세스가 없으면 서버가 그 대화로 띄운다(사람이 일을 시작하는 op). 실패해도 다시 보내지 않는다.
 */
export async function reviewChatTile(tg: ChatTileTarget, target: ReviewTargetWire): Promise<boolean> {
  const chat = tg.chat;
  remember(tg);
  const l = lives[chat];
  if (tg.cli !== "codex" || !l || chatTileWorking(l) || reviewTargetError(target) !== null) return false;
  const wire = reviewWireOf(target);
  const mark = Symbol();
  reviewMarks.set(chat, mark);
  l.reviewBusy = true;
  l.error = null;
  markBusy(chat);
  const release = () => {
    if (reviewMarks.get(chat) !== mark) return;
    reviewMarks.delete(chat);
    const after = lives[chat];
    if (after?.reviewBusy) {
      after.reviewBusy = false;
      markBusy(chat);
    }
  };
  const timer = setTimeout(release, REVIEW_WAIT_MS);
  try {
    if (!(await ready(chat))) throw new Error(lives[chat]?.error ?? "[session-gone] chat tile is not attached");
    const r = await withEpoch(chat, (epoch) => chatTileReview(chat, epoch, wire));
    const after = lives[chat];
    if (after && typeof r?.epoch === "number" && r.epoch > after.epoch) after.epoch = r.epoch;
    return true;
  } catch (e) {
    clearTimeout(timer);
    const after = lives[chat];
    if (after) after.error = errText(e);
    release();
    return false;
  }
}

/**
 * 사람이 누른 목표 단추(Codex). `set` 은 목표 글(4000자 안) · 한도(`GOAL_BUDGETS` 다섯 값 중 하나)가 맞을 때만 ·
 * `set` · `resume` 은 일하는 중이면 보내지 않는다(일을 시작한다). `pause` · `clear` 는 턴 중에도 보낸다.
 * 원격 창에서 `set` · `resume` 은 관문이 마스터 암호를 다시 묻는다 — 거절 글은 `error` 로 두고 다시 보내지 않는다.
 */
export async function goalChatTile(tg: ChatTileTarget, action: GoalAction, objective?: string, tokenBudget?: number): Promise<boolean> {
  const chat = tg.chat;
  remember(tg);
  const l = lives[chat];
  if (tg.cli !== "codex" || !l || l.goalBusy) return false;
  let text: string | null = null;
  let budget: number | null = null;
  if (action === "set") {
    if (objective === undefined || goalObjectiveError(objective) !== null || !goalBudgetOk(tokenBudget)) return false;
    text = objective.trim();
    budget = tokenBudget;
  } else if (action !== "pause" && action !== "resume" && action !== "clear") return false;
  if ((action === "set" || action === "resume") && chatTileWorking(l)) return false;
  l.goalBusy = true;
  l.error = null;
  try {
    if (!(await ready(chat))) throw new Error(lives[chat]?.error ?? "[session-gone] chat tile is not attached");
    const r = await withEpoch(chat, (epoch) => chatTileGoal(chat, epoch, action, text, budget));
    const after = lives[chat];
    if (after && typeof r?.epoch === "number" && r.epoch > after.epoch) after.epoch = r.epoch;
    return true;
  } catch (e) {
    const after = lives[chat];
    if (after) after.error = errText(e);
    return false;
  } finally {
    const after = lives[chat];
    if (after) after.goalBusy = false;
    markBusy(chat);
  }
}

function endMcpWait(chat: string): void {
  for (const t of mcpTimers.get(chat) ?? []) clearTimeout(t);
  mcpTimers.delete(chat);
  mcpMarks.delete(chat);
}

/**
 * 사람이 연 MCP 상태 보기의 읽기 한 번 — 묻는 중이면 거짓(겹쳐 묻지 않는다). 답은 사건 `mcpStatus{list}` 로 온다.
 * 거짓 답(물을 길 없음 · 프로세스 없음)은 받은 것만 보인다(`lastTurn`). 시한을 넘으면 멈출 뿐 다시 묻지 않는다.
 */
export async function askMcpStatus(tg: ChatTileTarget): Promise<boolean> {
  const chat = tg.chat;
  remember(tg);
  const l = lives[chat];
  if (!l || l.mcpAsk === "asking" || l.mcpAsk === "slow") return false;
  endMcpWait(chat);
  const mark = Symbol();
  mcpMarks.set(chat, mark);
  l.mcpAsk = "asking";
  l.mcpError = null;
  const still = () => mcpMarks.get(chat) === mark;
  const phase = (to: McpAsk, done: boolean) => () => {
    const after = lives[chat];
    if (!still() || !after) return;
    if (done) endMcpWait(chat);
    after.mcpAsk = to;
  };
  mcpTimers.set(chat, [setTimeout(phase("slow", false), MCP_SLOW_MS), setTimeout(phase("timeout", true), MCP_WAIT_MS)]);
  try {
    const asked = await withEpoch(chat, (epoch) => chatTileMcpStatus(chat, epoch));
    if (!asked) phase("lastTurn", true)();
    return asked;
  } catch (e) {
    const after = lives[chat];
    if (still() && after) {
      endMcpWait(chat);
      after.mcpAsk = null;
      after.mcpError = errText(e);
    }
    return false;
  }
}

/**
 * CLI 자신의 권한 모드 — 성공(산 CLI 에 보냄 · 표에만 적음 둘 다)이면 참. 칩 밖 값은 보내지 않는다.
 * 칩 글자는 CLI 가 알린 `cliMode` 가 맞춘다 — 여기서는 다시 띄울 때의 값(`permMode`)만 고친다.
 */
export async function setChatTilePermMode(tg: ChatTileTarget, mode: string): Promise<boolean> {
  const chat = tg.chat;
  if (!permModeOk(tg.cli, mode)) return false;
  remember(tg);
  const l = lives[chat];
  if (l) l.modeBusy = true;
  try {
    await withEpoch(chat, (epoch) => chatTileSetPermMode(chat, epoch, mode));
    const after = lives[chat];
    if (after) after.permMode = mode;
    writePermMode(chat, mode);
    return true;
  } catch (e) {
    const after = lives[chat];
    if (after) after.error = errText(e);
    return false;
  } finally {
    const after = lives[chat];
    if (after) after.modeBusy = false;
  }
}

/** 사람이 타일을 닫았다 — 서버 close + 연결 표 풀기 + 사본 지우기. 원격 창 · 이관 중이면 구독만 푼다(관찰자가 남았으면 그대로) */
export function releaseChatTile(tg: ChatTileTarget, closing: boolean): void {
  const chat = tg.chat;
  if (!closing || isRemote || isHandoff(tg.paneId)) {
    if (!observers.has(chat)) leave(chat);
    return;
  }
  closed.add(chat);
  leave(chat, false);
  setChatTileBusy(tg.paneId, false);
  void chatTileClose(chat).catch(() => false);
  unlinkAgentSession(tg.paneId);
}

/** 기록의 최신 쪽을 받았을 때 */
export function clearEndedChatTile(chat: string): void {
  const l = lives[chat];
  if (l) l.state = clearEnded(l.state);
}

export function dismissChatTileError(chat: string): void {
  const l = lives[chat];
  if (l) l.error = null;
}
