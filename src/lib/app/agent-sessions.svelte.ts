import { homeDir } from "@tauri-apps/api/path";
import { isRemote } from "$lib/ipc";
import { agentConversationLaunched, agentConversationLinks, agentSessionDelete, agentSessionLaunchSpec, agentSessionRename, agentSessionsList } from "$lib/context";
import {
  buildScopes,
  conversationLinkKey,
  conversationPaletteEntries,
  deleteBlock,
  flatConversations,
  forkCountOf,
  linkSurvivesCliStart,
  localProjects,
  openElsewhere,
  otherWindowStream,
  renameBlock,
  parseConversationLinks,
  registeredCwds,
  resumedConversationOf,
  scopeLabelOf,
  switchesConversation,
  type AgentConversation,
  type AgentLink,
  type ConversationLinkRow,
  type ConversationList,
  type ConversationPaletteEntry,
} from "$lib/agent-sessions";
import { projects } from "$lib/app/project-list.svelte.js";
import { loadWorktrees, worktreesOf } from "$lib/app/worktrees.svelte.js";
import {
  activeTabId,
  focusTile,
  openInNewTab,
  openPaneBeside,
  openPaneInTab,
  replaceTile,
  tabOfPane,
  findPaneAnywhere,
  currentWorkspaceTabs,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";
import { showNotice } from "$lib/app/notice";
import { toast } from "$lib/toast.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";
import { loadUsage, loadUsageSummary, scheduleLimitsRefresh, usageSummary } from "$lib/app/agent-usage.svelte.js";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { aiDisplayName } from "$lib/pane-icons";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { settings } from "$lib/settings.svelte.js";
import { conversationTarget, shouldShowStartScreen, type ConversationTarget } from "$lib/project-start";
import { listPanes, newAiPane, newProjectStartPane, type PaneSpec } from "$lib/session";
import { noteFolderOpened } from "$lib/app/recent-worktrees.svelte.js";
import { focusAuxStream } from "$lib/app/workspace-status.svelte.js";
import { sideChatConvMarkOf } from "$lib/app/side-chats.svelte.js";

/**
 * **지난 대화의 저장소** — 목록 한 벌(Rust `agent_sessions_list` 의 답)과 **타일 ↔ 대화 연결**
 * (docs/log/2026-09-26-agent-sessions.md). 접는 규칙은 순수 층 `$lib/agent-sessions`, 그림은
 * 팔레트의 `대화` 범위 · 프로젝트 시작 화면 · 이 폴더의 지난 대화 · 기록 보기 시트(대시보드의 "지난 대화"
 * 덩어리는 2026-09-28 에 뺐다 · docs/log/2026-09-28-dashboard-session-cards.md).
 *
 * ## 읽는 때
 *
 * 앱이 뜰 때 읽지 않는다 — 그 목록을 그리는 자리가 **보일 때**(시작 화면 · 사용량 화면의 출처 칩),
 * 팔레트에서 대화를 처음 찾을 때([`ensureConversations`]), 에이전트 턴이 끝났을 때(`stop` 신호 — 2초 모아서, 한 번이라도
 * 읽은 뒤에만). Rust 가 파일 도장(mtime·크기)으로 캐시하므로 다시 읽기는 바뀐 파일만 읽는다.
 *
 * ## 타일 ↔ 대화 (Claude · Codex)
 *
 * 훅 신호 4판이 `start`·`stop` 에, 10판이 `session`(Claude `SessionStart` — 시작 · `/resume` · `/clear` · compact)에 대화 id 를
 * 싣는다(`agent-signal` 의 `session`). 타일마다 마지막 id 를 이 표에 쥔다 — 목록 줄의 "열림" · "같은 대화를 두 번 열지 않는다" ·
 * AI 타일의 대화 면(`pane/AiFlip`)이 이것을 읽는다. 에이전트는 타일의
 * 신원(`agentKindOf`)이 정한다. Codex 는 `--no-daemon` 으로 돌 때만 훅이 제 타일의 환경을 받는다
 * (docs/log/2026-09-26-codex-hooks.md "다시 켬"). 이 창의 타일만 안다(저장소가 창마다 하나다 — 에이전트 신호와
 * 같은 규칙).
 *
 * **연결의 수명 = 그 타일의 셸 세션**(docs/log/2026-09-26-agent-sessions.md "연결의 수명 = 세션"). 세션 서버(③) 뒤로는 F5 ·
 * 앱 재시작이 세션을 죽이지 않고 다시 붙는다 — 그래서 연결의 **사본을 타일 명세에 적어 둔다**(`PaneSpec.agentLink` — 저장 ·
 * 이관 · 복원에 실린다, 2026-10-17). 터미널이 마운트되며 표로 다시 심고([`seedAgentLink`]), 산 세션에 다시 붙으면 그대로,
 * **새 세션이 서면** 버린다([`agentSessionRestarted`] — 새 셸은 새 대화다). 그 새 셸에서 autorun 이 **재개 명령**이면 그 대화가
 * 다시 열리므로 autorun 을 쓰는 순간 다시 적는다([`linkResumedAutorun`]). 같은 셸에서 **새 CLI 가 뜨면**(OSC 133 `C` — 재생 아님)
 * 재개로 띄운 것이 아닌 연결을 버리고([`agentCliStarted`]), 대화 면 입력 칸이 Codex 의 `/new` · `/resume` 류를 보내도 버린다
 * ([`agentPromptSent`]) — Codex 는 첫 질문 전에 대화 신호가 없다(2026-10-20). 창 이관은 연결도 **이관 짐에 실려** 건너간다
 * ([`agentLinkOf`] → `$lib/tear` → [`adoptAgentLink`]).
 *
 * ## 다른 창 · 막 닫은 타일 — 세션 서버 장부 (docs/log/2026-10-24-convo-rename.md "열림 판정 — 세션 서버 장부")
 *
 * 위 표는 이 창의 것이라 다른 Aynx 창(보조 창 · 원격 웹)의 타일을 모르고, 타일을 닫으면 연결이 사라져 그 대화가 2분 동안 "밖에서 열림" 으로
 * 보였다. 세션 서버가 대화 ↔ 스트림 장부(쥔 스트림 · 놓인 시각 — 서버 op `agent_conversation_links`)를 쥔다 — 목록을 읽을 때 함께 한 번
 * 읽고([`loadConversationLinks`]), 연결이 바뀔 만한 사건(이 창의 연결이 서고 · 사라짐 · 다른 창 스트림의 대화 신호 · `session-end` —
 * [`noteConversationSignal`])에 잠시 모아 다시 읽는다(폴링 없음). **이 창의 타일은 이 창의 표가**, 다른 창의 스트림은 장부가 "열림" 을 정하고,
 * "밖에서 열림" 은 어디에도 연결되지 않았고 놓인 뒤에 쓰였을 때만이다(순수 층 `openElsewhere` — Rust 의 같은 규칙이 이름 바꾸기 · 지우기를 막는다).
 * 장부를 못 읽으면(옛 서버) 예전 규칙 그대로다.
 *
 * **띄우며 적은 연결은 서버에도 곧바로**([`announceLaunch`] — 서버 op `agent_conversation_launched`): Codex 는 첫 질문 전에 대화 신호가
 * 없는데 `codex resume` 은 뜨자마자 기록에 한 줄을 덧붙인다 — 신호만 기다리던 장부는 그 타일을 몰라, 질문 없이 닫으면 놓인 기록도 없이
 * 방금 쓰인 파일만 남아 2분 동안 "밖에서 열림" 이었다(2026-10-24). 재개 autorun 을 쓰기 **전에** 알리고(그 명령의 `C` 가 뒤따른다 —
 * 서버는 그 첫 `C` 에 지우지 않는다). 포크는 할 일이 없다 — `codex fork` 도 뜨자마자 새 기록을 만들지만 턴이 돌기 전(`turn_context`
 * 없음)이라 목록에 오르지 않고, 첫 턴의 `start` 신호가 그 id 를 잇는다(Claude 포크는 `SessionStart`).
 */

let list = $state<ConversationList | null>(null);
let loading = $state(false);
let failed = $state<string | null>(null);
/** 이 PC 의 집 폴더 — "기타" 폴더 줄을 `~` 로 줄인다. 못 읽으면 `null`(줄이지 않는다) */
let home = $state<string | null>(null);
let homeAsked = false;
/** 늦게 온 옛 답이 새 목록을 덮지 않게 */
let seq = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** `stop` 뒤 다시 읽기까지 모으는 시간 */
const REFRESH_DEBOUNCE_MS = 2000;

/** 세션 서버의 대화 ↔ 스트림 장부(열쇠 `agent:id`) — 못 읽었으면 `null`(예전 규칙) */
let convoLinks = $state.raw<Map<string, ConversationLinkRow> | null>(null);
let linksSeq = 0;
let linksTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * 연결이 바뀔 만한 사건 뒤 장부를 다시 읽기까지 모으는 시간 — 타일 닫기는 창의 연결이 먼저 지고 서버의 토큰 회수(= 놓기)가 그 뒤라,
 * 그 사이를 넘기고(그동안 그 줄은 "열림" 으로 남을 뿐 "밖에서 열림" 이 되지 않는다) 한 번에 모은다.
 */
const LINKS_DEBOUNCE_MS = 800;

/**
 * 타일 id → 그 타일의 대화. `pending` 은 **우리가 재개로 연 타일**에 미리 적어 둔 것 — 그 타일의 첫
 * 세션 시작([`agentSessionRestarted`])이 지우지 않고 확정한다(그 뒤의 재시작은 지운다). `launch` 는 **띄우며 적은 것**(재개로 연 타일 ·
 * 재개 autorun) — 그 CLI 를 띄우는 셸 명령(OSC 133 `C`)이 지우지 않는다([`agentCliStarted`] · 순수 층 `linkSurvivesCliStart`). 그 CLI 의
 * 훅 신호가 오면 내려간다(그 뒤의 새 명령은 새 CLI 다).
 */
const links = $state<Record<string, { agent: string; id: string; pending: boolean; launch: boolean }>>({});

/** 지금 목록(아직 안 읽었으면 `null`) — 반응형 */
export function conversationList(): ConversationList | null {
  return list;
}

/** 읽는 중인가 — 반응형 */
export function conversationsLoading(): boolean {
  return loading;
}

/** 마지막 읽기가 실패했으면 그 문구 — 반응형 */
export function conversationsError(): string | null {
  return failed;
}

/** 집 폴더(모르면 `null`) — 반응형 */
export function conversationHome(): string | null {
  return home;
}

/** 워크트리 목록이 준비된 것만 — 순수 층의 입력 모양 */
export function readyWorktrees(projectId: string) {
  const w = worktreesOf(projectId);
  return w?.state === "ok" ? w.list : null;
}

/**
 * 목록을 (다시) 읽는다 — 로컬 프로젝트의 워크트리를 아직 안 읽었으면 먼저 읽고, 그 경로들을 넘긴다.
 * 이미 목록이 있으면 새 답이 올 때까지 그대로 둔다(다시 읽을 때마다 비었다 차는 깜박임이 없게).
 */
export async function loadConversations(): Promise<void> {
  const mine = ++seq;
  loading = true;
  try {
    if (!homeAsked) {
      homeAsked = true;
      home = await homeDir().catch(() => null);
    }
    // 장부는 목록과 나란히 — 작은 답이라 목록을 막지 않는다
    void loadConversationLinks();
    const locals = localProjects(projects());
    await Promise.all(locals.filter((p) => worktreesOf(p.id) === undefined).map((p) => loadWorktrees(p)));
    const r = await agentSessionsList(registeredCwds(projects(), readyWorktrees));
    if (mine === seq) {
      list = r;
      failed = null;
      // 토큰은 목록 **뒤에** 따로 — 첫 읽기는 파일 전체라 목록을 막지 않는다(docs/log/2026-09-26-agent-usage.md)
      void loadUsage();
    }
  } catch (e) {
    if (mine === seq) failed = stripReason(String(e));
  } finally {
    if (mine === seq) loading = false;
  }
}

/** 세션 서버의 대화 ↔ 스트림 장부를 (다시) 읽는다 — 실패(옛 서버 · 서버에 닿지 못함)면 `null` = 예전 규칙 */
export async function loadConversationLinks(): Promise<void> {
  const mine = ++linksSeq;
  try {
    const v = await agentConversationLinks();
    if (mine === linksSeq) convoLinks = parseConversationLinks(v);
  } catch {
    if (mine === linksSeq) convoLinks = null;
  }
}

/** 장부를 잠시 모아 다시 읽는다 — 목록을 한 번이라도 읽은 뒤에만(그리는 자리가 없으면 할 일도 없다) */
function scheduleLinksRefresh(): void {
  if (list === null) return;
  if (linksTimer !== null) clearTimeout(linksTimer);
  linksTimer = setTimeout(() => {
    linksTimer = null;
    void loadConversationLinks();
  }, LINKS_DEBOUNCE_MS);
}

/**
 * 어느 창의 스트림이든 `agent-signal` 하나가 왔다(`app/agent-status` 의 듣기가 부른다) — 장부가 바뀌었을 사건이면 다시 읽는다:
 * `session-end`(CLI 가 대화를 놓았다) · 대화 id 를 실었는데 장부가 그 스트림을 그 대화에 아직 묶지 않았다(새로 쥐었다 · `/clear` · `/resume`).
 * 다른 창의 타일 닫기는 신호가 없어 다음 목록 읽기에 드러난다.
 */
export function noteConversationSignal(payload: { event?: unknown; stream?: unknown; session?: unknown; cli?: unknown }): void {
  if (list === null || typeof payload.stream !== "string") return;
  if (payload.event === "session-end") {
    scheduleLinksRefresh();
    return;
  }
  if (typeof payload.session !== "string" || payload.session === "" || typeof payload.cli !== "string") return;
  const row = convoLinks?.get(conversationLinkKey(payload.cli, payload.session));
  if (!row || !row.streams.includes(payload.stream)) scheduleLinksRefresh();
}

/**
 * 팔레트가 열릴 때 — 읽는 중이 아니면 (다시) 읽는다. 처음에는 목록을 채우고, 그 뒤로는 "밖에서 열림"
 * ([`openElsewhere`] — 파일 mtime 기준)이 낡지 않게 한다(실기 ②: aynx 밖에서 도는 대화를 팔레트가 곧장 재개할 뻔했다).
 * 다시 읽기는 Rust 캐시가 답해 싸다(바뀐 파일만 읽는다).
 */
export function ensureConversations(): void {
  if (!loading) void loadConversations();
}

/**
 * 대화의 이름을 바꾼다(로컬만 — 그 CLI 의 기록에 적는다 · docs/log/2026-10-24-convo-rename.md) — 성공하면 목록을 다시 읽어 새 이름이
 * 보인 뒤에 돌아온다. 실패는 이유 코드를 뗀 Rust 문구로 던진다(부르는 쪽이 그 자리에 보인다).
 */
export async function renameConversation(s: AgentConversation, name: string): Promise<void> {
  try {
    await agentSessionRename(s.agent, s.id, name);
  } catch (e) {
    throw new Error(stripReason(String(e)));
  }
  await loadConversations();
}

/** 지우는 중인 대화(`agent:id`) — 그 줄은 흐리고 다시 누를 수 없다(줄의 자리는 그대로 — 목록을 다시 읽어 빠질 때까지) */
let deleting = $state.raw<ReadonlySet<string>>(new Set());

const convKey = (s: Pick<AgentConversation, "agent" | "id">) => `${s.agent}:${s.id.toLowerCase()}`;

/** 이 대화를 지우는 중인가 — 반응형 */
export function conversationDeleting(s: Pick<AgentConversation, "agent" | "id">): boolean {
  return deleting.has(convKey(s));
}

/** 목록이 아는, 이 대화에서 갈라 나간 대화의 수([`forkCountOf`]) — 반응형 */
export function conversationForkCount(s: Pick<AgentConversation, "agent" | "id">): number {
  return forkCountOf(flatConversations(list), s);
}

/**
 * 삭제를 흐리는 까닭(툴팁 문구 — 없으면 `null`) — 두 화면(상태줄 지난 대화 · 프로젝트 시작 화면)이 같은 판정([`deleteBlock`])을 쓴다.
 * 지우는 중이면 그것이 먼저다. 반응형.
 */
export function deleteBlockedReason(
  s: Pick<AgentConversation, "agent" | "id">,
  where: { open: boolean; elsewhere: boolean },
): string | null {
  if (conversationDeleting(s)) return t("board.convo.delete.deleting");
  const forks = conversationForkCount(s);
  const sideChat = sideChatConvMarkOf(s.agent, s.id) !== null;
  switch (deleteBlock({ ...where, sideChat, forks })) {
    case "open":
      return t(linkedTile(s.agent, s.id) ? "board.convo.delete.blocked.open" : "board.convo.delete.blocked.openOther");
    case "side-chat":
      return t("board.convo.delete.blocked.sideChat");
    case "elsewhere":
      return t("board.convo.delete.blocked.elsewhere");
    case "forks":
      return t("board.convo.delete.blocked.forks", { n: forks });
    default:
      return null;
  }
}

/**
 * 이름 바꾸기를 흐리는 까닭(툴팁 문구 — 없으면 `null`) — 두 화면이 같은 판정([`renameBlock`])을 쓴다. 원격 대화는 항목이 없다(부르는 쪽이
 * 넘기지 않는다). 반응형.
 */
export function renameBlockedReason(
  s: Pick<AgentConversation, "agent" | "id">,
  where: { open: boolean; elsewhere: boolean },
): string | null {
  switch (renameBlock({ remote: false, ...where })) {
    case "open":
      return t(linkedTile(s.agent, s.id) ? "board.convo.rename.blocked.open" : "board.convo.rename.blocked.openOther");
    case "elsewhere":
      return t("board.convo.rename.blocked.elsewhere");
    default:
      return null;
  }
}

/**
 * 대화를 **영구히** 지운다(로컬만 — 그 CLI 의 기록에서 · docs/log/2026-10-24-convo-rename.md "지우기"). 앱 확인 상자(위험 · 첫 포커스
 * [취소])에 제목과 "되돌릴 수 없다" 를 싣고, 확인하면 Rust 가 지운 뒤 목록(과 그 뒤의 사용량)을 다시 읽는다 — 줄은 다시 읽기가 끝날 때까지
 * 제자리에서 흐리다(칸이 뛰지 않게). 지워지면 성공 토스트 한 줄(제목), 실패는 이유 코드를 뗀 Rust 문구로 알린다.
 */
export async function deleteConversation(s: AgentConversation): Promise<void> {
  const key = convKey(s);
  if (deleting.has(key)) return;
  const agent = aiDisplayName(s.agent) ?? s.agent;
  let go = false;
  try {
    go = await askConfirm(t("board.convo.delete.confirm", { title: s.title, agent }), {
      title: t("board.convo.delete.title"),
      kind: "warning",
      okLabel: t("board.convo.delete.ok"),
      danger: true,
    });
  } catch {
    return; // 상자를 띄우지 못하면 지우지 않는다
  }
  if (!go) return;
  deleting = new Set([...deleting, key]);
  try {
    await agentSessionDelete(s.agent, s.id);
    toast.success(t("board.convo.delete.done", { title: s.title }));
    await loadConversations();
    // 대시보드 사용량 칸이 이미 읽혔으면 그것도 — 지운 대화의 몫이 빠진다
    if (usageSummary() !== null) void loadUsageSummary();
  } catch (e) {
    showNotice(t("board.convo.delete.failed", { e: stripReason(String(e)) }));
  } finally {
    const next = new Set(deleting);
    next.delete(key);
    deleting = next;
  }
}

/**
 * **사이드 채팅의 대화를 함께 지운다** — 채팅 독의 채팅 지우기(`ChatDock` — 프로세스를 닫은 **뒤**)가 그 채팅이 쥔 대화들(`links`)을 그 CLI
 * 의 기록에서 영구히 지운다. 확인 상자는 부르는 쪽이 이미 띄웠다. 목록에 없는 대화(이미 지워짐 · 첫 턴 전)는 건너뛴다. 갈라 나간 대화가 있으면
 * 지우지 않고 throw(지난 대화 줄과 같은 규칙). 막 닫힌 CLI 가 아직 파일을 쥐었거나 서버 장부에 놓임이 아직 안 적혔으면 Rust 가 거절하므로
 * 잠깐 뒤에 다시 해 본다(서버는 프로세스가 끝날 때 놓인 시각을 적는다 — `agent_state::note_released`). 실패하면 throw — 채팅은 부르는 쪽이 남긴다.
 */
export async function deleteSideChatConversations(convs: readonly { agent: string; id: string }[]): Promise<void> {
  if (convs.length === 0) return;
  await loadConversations();
  const rows = flatConversations(list);
  try {
    for (const c of convs) {
      const row = rows.find((r) => r.agent === c.agent && r.id.toLowerCase() === c.id.toLowerCase());
      if (!row) continue;
      const forks = conversationForkCount(row);
      if (forks > 0) throw new Error(t("board.convo.delete.blocked.forks", { n: forks }));
      const key = convKey(row);
      deleting = new Set([...deleting, key]);
      try {
        let err: unknown = null;
        for (const wait of [0, 1500, 4000]) {
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          try {
            await agentSessionDelete(row.agent, row.id);
            err = null;
            break;
          } catch (e) {
            err = e;
          }
        }
        if (err !== null) throw err;
      } finally {
        const next = new Set(deleting);
        next.delete(key);
        deleting = next;
      }
    }
  } finally {
    await loadConversations();
    if (usageSummary() !== null) void loadUsageSummary();
  }
}

/** 에이전트 턴이 끝났다(`stop`) — 한 번이라도 읽었으면 잠시 모아 다시 읽는다 */
export function scheduleConversationRefresh(): void {
  // 한도 % 는 목록과 무관하게 — 상태바 경고가 낡지 않게(싸다)
  scheduleLimitsRefresh();
  if (list === null) return;
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadConversations();
  }, REFRESH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// 타일 ↔ 대화
// ---------------------------------------------------------------------------

/**
 * 연결을 타일 명세에도 적는다(`PaneSpec.agentLink` — 저장 · F5 · 재시작 · 이관을 건너 남는 사본). `null` 이면 지운다. 같은 값이면
 * 쓰지 않는다(배치 저장이 헛돌지 않게). 그 타일이 이 창에 없으면(닫혔다 · 떠났다) 아무것도 하지 않는다.
 */
function persistLink(paneId: string, l: AgentLink | null): void {
  const p = findPaneAnywhere(paneId);
  if (!p || (p.kind !== "local" && p.kind !== "ssh")) return;
  if (l === null) {
    if (p.agentLink) delete p.agentLink;
    return;
  }
  if (p.agentLink && p.agentLink.agent === l.agent && p.agentLink.id === l.id) return;
  p.agentLink = { agent: l.agent, id: l.id };
}

function setLink(paneId: string, agent: string, id: string, pending: boolean, launch = false): void {
  const l = { agent, id: id.toLowerCase(), pending, launch };
  links[paneId] = l;
  persistLink(paneId, l);
  scheduleLinksRefresh();
}

function dropLink(paneId: string): void {
  // 원격 창(폰)에서는 연결의 주인이 집 PC 거울이다([`mirrorAgentLink`]) — 제 셸 사건(새 CLI 의 `C` · 셸 복귀 · 새 세션)으로 지우지 않는다.
  // 거울에는 "재개로 띄운 것" 표시가 없어, 폰에서 재개한 Codex 타일의 재개 명령 `C` 가 막 받은 연결을 지웠다(10-26). 집 PC 가 지우면
  // 거울이 따라 지운다.
  if (isRemote) return;
  const had = paneId in links;
  delete links[paneId];
  persistLink(paneId, null);
  if (had) scheduleLinksRefresh(); // 타일 닫기 · CLI 끝 — 서버 장부가 놓인 시각을 적었을 것이다
}

/**
 * 타일 명세에 남은 연결 사본을 표로 다시 심는다 — 그 타일의 터미널이 마운트될 때(`Terminal`) 세션을 열기 **전에**. 산 세션에
 * 다시 붙으면(F5 · 재시작 · 이관) 그대로 쓰이고, 새 세션이 서면 [`agentSessionRestarted`] 가 버린다. 표에 이미 있으면(이관 짐의
 * [`adoptAgentLink`]) 손대지 않는다.
 */
export function seedAgentLink(pane: PaneSpec): void {
  if (pane.id in links || !pane.agentLink) return;
  links[pane.id] = { agent: pane.agentLink.agent, id: pane.agentLink.id.toLowerCase(), pending: false, launch: false };
}

/**
 * 원격 창 — 집 PC 거울이 실어 온 그 타일의 연결로 맞춘다(`app/mirror` 의 스냅숏 반영 · 10-26). 연결의 주인은 신호를 놓치지 않는 집 PC 다:
 * 원격 창은 떼어 둔 동안(R5 — 백그라운드 · 숨은 타일) 신호를 놓치고, Codex 는 첫 질문 전에 신호가 없어 붙은 직후 대화 면이 비었다.
 * 거울에 없으면 지운다(집 PC 가 CLI 끝 · 새 CLI 로 버렸다). 명세 사본은 거울이 이미 실었으니 쓰지 않는다.
 */
export function mirrorAgentLink(paneId: string, link: AgentLink | undefined): void {
  const cur = links[paneId];
  if (!link || typeof link.agent !== "string" || typeof link.id !== "string" || link.id === "") {
    if (cur) delete links[paneId];
    return;
  }
  const id = link.id.toLowerCase();
  if (cur && cur.agent === link.agent && cur.id === id) return;
  links[paneId] = { agent: link.agent, id, pending: false, launch: false };
}

/** 훅 신호가 대화 id 를 실어 왔다(`start` · `stop` · 10판 `session` — SessionStart) — `app/agent-status` 의 `agentSignal` 이 부른다 */
export function linkAgentSession(paneId: string, agent: string, id: string): void {
  const cur = links[paneId];
  if (cur && !cur.pending && !cur.launch && cur.agent === agent && cur.id === id.toLowerCase()) return;
  setLink(paneId, agent, id, false);
}

/**
 * 그 AI 타일에서 셸이 **새 명령을 시작했다**(OSC 133 `C` — 링 재생은 부르지 않는다 · `app/agent-status` 의 `agentCommandStarted`) —
 * 새 CLI 의 대화는 앞의 대화가 아니므로 옛 연결을 버린다. 띄우며 적은 연결(재개)은 그 명령이 바로 그 재개라 남긴다(순수 층
 * [`linkSurvivesCliStart`] — Codex 는 첫 질문 전에 대화 신호가 없어 대화 면이 앞의 대화를 그렸다, 2026-10-20).
 */
export function agentCliStarted(paneId: string): void {
  if (!linkSurvivesCliStart(links[paneId])) dropLink(paneId);
}

/**
 * 대화 면의 입력 칸이 그 타일에 글을 보냈다(`pane/AiFlip` 의 보내기) — 대화를 바꾸는 Codex 명령(`/new` · `/resume` …)이면 옛 연결을
 * 버린다(순수 층 [`switchesConversation`]). 새 대화는 첫 질문의 `start` 신호가 다시 잇는다. 버렸으면 참.
 */
export function agentPromptSent(paneId: string, text: string): boolean {
  const l = links[paneId];
  if (!l || !switchesConversation(l.agent, text)) return false;
  dropLink(paneId);
  return true;
}

/** 그 타일의 새 세션이 섰다 — 우리가 재개로 연 타일의 첫 세션이면 확정, 아니면 옛 연결을 버린다 */
export function agentSessionRestarted(paneId: string): void {
  const l = links[paneId];
  if (!l) return;
  if (l.pending) l.pending = false;
  else dropLink(paneId);
}

/** 에이전트가 끝났거나(프롬프트 복귀) 타일이 사라졌다 */
export function unlinkAgentSession(paneId: string): void {
  dropLink(paneId);
}

/** 그 타일의 연결(없으면 `null`) — 창 이관 짐이 싣는다(`app/tear` 의 `startTear`) */
export function agentLinkOf(paneId: string): AgentLink | null {
  const l = links[paneId];
  return l ? { agent: l.agent, id: l.id } : null;
}

/**
 * 창 이관으로 넘어온 타일의 연결을 심는다 — 받는 창이 **타일이 마운트되기 전에** 부른다(`$lib/tear` 의
 * `restoreTab`). 이관 타일은 새 세션을 열지 않고 산 세션에 다시 붙으므로(`resumeSession` — 세션 시작 신호가
 * 없다) 확정된 연결로 적는다. 산 세션이 없는 짐에는 오지 않는다(`restoreTab` 이 거른다).
 */
export function adoptAgentLink(paneId: string, link: AgentLink): void {
  setLink(paneId, link.agent, link.id, false);
}

/**
 * 이 타일의 **첫 세션**에 autorun 을 쓰는 순간(`Terminal` 의 첫 열기) — 그 명령이 대화 재개(Claude · Codex)면 그 대화를
 * 이 타일에 잇는다([`resumedConversationOf`]). 재개로 막 연 타일(`openConversation` 이 미리 적었다)도, 페이지가
 * 다시 뜨거나 앱을 다시 켜 **복원된** 재개 타일도 같은 길이다 — 복원된 타일은 autorun 을 다시 돌려 같은 대화를
 * 다시 열기 때문이다. 재연결·재시작한 세션은 autorun 을 다시 돌리지 않으므로 여기 오지 않는다.
 */
export function linkResumedAutorun(paneId: string, autorun: string | null | undefined): Promise<void> {
  const r = resumedConversationOf(autorun);
  if (!r) return Promise.resolve();
  setLink(paneId, r.agent, r.id, false, true);
  return announceLaunch(paneId, r.agent, r.id);
}

/**
 * 세션 서버 장부에 **띄우며 적은 연결**을 알린다(모듈 머리말) — 그 타일의 스트림(`historyStreamId ?? id` = `AYNX_STREAM`). 실패(옛 서버 ·
 * 산 신호 토큰 없음)는 삼킨다 — 그 타일은 예전 규칙. 늘 이루어지는 약속(던지지 않는다).
 */
function announceLaunch(paneId: string, agent: string, id: string): Promise<void> {
  const p = findPaneAnywhere(paneId);
  if (!p) return Promise.resolve();
  return agentConversationLaunched(p.historyStreamId ?? p.id, agent, id).then(
    () => {},
    () => {},
  );
}

/**
 * 재개로 **막 연** 타일에 그 대화를 미리 적는다 — 첫 훅 신호 전에도 "열림" 이 서고 두 번 열리지 않는다. 그 타일의 첫 세션
 * 시작이 확정한다([`agentSessionRestarted`]). 원격 재개(`app/remote-conversations`)가 쓴다 — 로컬은 [`openConversation`] 안에서 같은 일을 한다.
 */
export function linkOpenedConversation(paneId: string, agent: string, id: string): void {
  setLink(paneId, agent, id, true, true);
}

/** 그 타일의 대화 id(모르면 `null`) — 반응형 */
export function agentSessionOf(paneId: string): string | null {
  return links[paneId]?.id ?? null;
}

/** 그 대화가 **이 창의 어느 타일**에 열려 있나 — 반응형 */
export function linkedTile(agent: string, id: string): { tabId: string; paneId: string } | null {
  const want = id.toLowerCase();
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      const l = links[pane.id];
      if (l && l.agent === agent && l.id === want) return { tabId: tab.id, paneId: pane.id };
    }
  }
  return null;
}

/** 이 스트림이 이 창의 타일 것인가(`AYNX_STREAM` = `historyStreamId ?? id`) */
function isThisWindowStream(stream: string): boolean {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) if ((pane.historyStreamId ?? pane.id) === stream) return true;
  }
  return false;
}

/**
 * 그 대화를 **다른 Aynx 창**(보조 창 · 원격 웹)의 타일이 쥐었나 — 세션 서버 장부가 아는 그 스트림(없으면 `null`). 이 창의 타일에 열려
 * 있으면 `null`(그쪽은 [`linkedTile`]). 반응형.
 */
export function conversationOpenOtherWindow(s: Pick<AgentConversation, "agent" | "id">): string | null {
  if (linkedTile(s.agent, s.id)) return null;
  return otherWindowStream(convoLinks?.get(conversationLinkKey(s.agent, s.id)), isThisWindowStream);
}

/** 그 대화가 **Aynx 의 어느 타일**(이 창 · 다른 창)에 열려 있나 — 화면의 "열림". 반응형 */
export function conversationOpen(s: Pick<AgentConversation, "agent" | "id">): boolean {
  return linkedTile(s.agent, s.id) !== null || conversationOpenOtherWindow(s) !== null;
}

/**
 * 열린 대화의 타일로 간다 — 이 창이면 그 타일로, 다른 창이면 주 창은 보조 창의 보고로 그 창 · 타일로(`focusAuxStream`), 그 밖(보조 창 ·
 * 원격 웹에서 본 다른 창)은 알림 한 줄. 열려 있지 않으면 거짓(부르는 쪽이 재개한다).
 */
export function goToOpenConversation(s: Pick<AgentConversation, "agent" | "id">): boolean {
  const at = linkedTile(s.agent, s.id);
  if (at) {
    focusTile(at.tabId, at.paneId);
    return true;
  }
  const stream = conversationOpenOtherWindow(s);
  if (stream === null) return false;
  if (!focusAuxStream(stream)) showNotice(t("board.convo.openOther.notice"));
  return true;
}

/** 그 대화가 마지막으로 놓인 시각(세션 서버 장부 — 모르면 `null`) */
function releasedAtOf(agent: string, id: string): number | null {
  return convoLinks?.get(conversationLinkKey(agent, id))?.releasedAt ?? null;
}

/** 대화를 여는 자리 — 그 타일 자리 · 그 타일 옆 분할 · 새 탭(폰) */
export type ConversationPlace = "replace" | "beside" | "tab";

/**
 * 대화를 연다 — `resume`(같은 대화 잇기) · `fork`(새 대화로 계속). 재개할 대화가 이미 이 창의 타일에
 * 열려 있으면 **그 타일로 간다**(두 번 열지 않는다). 아니면 Rust 가 지은 명령 한 줄로 AI 타일 하나를 그
 * 대화의 폴더에서 연다 그리고 그 타일로 가며 대시보드를 걷는다.
 *
 * **여는 자리**(docs/log/2026-09-26-project-start-screen.md "재개가 갈 자리"): `at` 이 있으면 그 타일
 * 자리(프로젝트 시작 화면이 자기 자리를 넘긴다 — `how = "replace"`) 또는 그 타일 **옆에 분할로**(이 폴더의 지난 대화가
 * 부른 타일을 넘긴다 — `how = "beside"`, 새 타일이 한 번 빛난다). 없으면 순수 층의 [`conversationTarget`] 이 고른다 — 같은
 * 폴더의 시작 화면 → 그 워크트리의 탭(타일 하나 더) → 지금 탭이 빈 launcher 면 그 자리 → 새 탭. 1단계는 늘
 * 새 탭이었다(사용자 결정 2026-09-26 — 지금 탭에 자동 분할로 끼우면 타일이 많은 탭에서 너무 작아진다). 그
 * 까닭은 그대로 살아 있다: 남의 탭에는 끼우지 않고, 끼우는 탭은 **그 워크트리의 탭**뿐이다.
 *
 * 탭 제목은 새 탭 · launcher 자리일 때만 정한다 — **범위 이름**(`<프로젝트> · <워크트리>` · 프로젝트 · 줄인
 * 폴더 — 워크트리 탭과 같은 관례). 대화 제목을 쓰지 않는 이유: 탭 제목은 `workspaces.json` 에 저장되고 첫
 * 프롬프트일 수 있는 제목은 화면에만 둔다는 규칙이 있다. 실패(폴더 없음 · 대화를 못 찾음)는 알림 한 줄.
 */
export async function openConversation(
  s: AgentConversation,
  mode: "resume" | "fork",
  at?: { tabId: string; paneId: string },
  how: ConversationPlace = "replace",
  into?: string,
): Promise<void> {
  // 이미 열려 있으면(이 창 · 다른 창) 그 타일로 — 두 번 열지 않는다
  if (mode === "resume" && goToOpenConversation(s)) return;
  let spec;
  try {
    spec = await agentSessionLaunchSpec(s.agent, s.id, mode, into);
  } catch (e) {
    showNotice(stripReason(String(e)));
    return;
  }
  const pane = newAiPane(spec.command, spec.cwd);
  // 재개면 id 를 이미 안다 — 첫 훅 신호(첫 프롬프트) 전에도 "열림" 이 서고 두 번 열리지 않는다.
  // 그 안에서 대화가 바뀌면(`/clear` · `/new`) Claude 는 `session` 신호가, Codex 는 다음 `start` 신호가 고쳐 적는다(`--no-daemon`).
  if (mode === "resume") links[pane.id] = { agent: s.agent, id: s.id.toLowerCase(), pending: true, launch: true };
  // 탭 제목은 **새 타일이 서는 폴더**의 범위 이름 — 가져와 계속이면 원래 폴더가 아니라 가져온 곳
  const label = scopeLabelOf({ ...s, cwd: spec.cwd }, buildScopes(projects(), readyWorktrees, list, home).rows);
  // **새 탭에**(폰 — 원격 웹 R5 · 10-20): 폰은 타일 하나만 그려서 옆에 끼우면 새 타일이 보이지 않는다 — 그 타일 하나뿐인 새 탭
  if (how === "tab") {
    openInNewTab(pane, label);
    noteFolderOpened(null, spec.cwd);
    const tab = tabOfPane(pane.id);
    if (tab) focusTile(tab.id, pane.id);
    return;
  }
  // **옆에 분할로**(이 폴더의 지난 대화 — docs/log/2026-09-27-folder-conversations.md): 부른 타일 옆에 새 타일 규칙
  // 방향(긴 변)으로 선다. 그 타일이 그 사이 사라졌으면 아래의 보통 자리로 물러선다.
  if (at && how === "beside" && openPaneBeside(at.tabId, at.paneId, pane)) {
    noteFolderOpened(null, spec.cwd);
    const tab = tabOfPane(pane.id);
    if (tab) focusTile(tab.id, pane.id);
    glowTile(pane.id, "ok");
    return;
  }
  // 자리는 명세를 받은 **뒤에** 고른다 — 그 사이 탭이 닫히거나 바뀌었을 수 있다.
  const target: ConversationTarget = at && how === "replace"
    ? { kind: "replace", reason: "startScreen", tabId: at.tabId, paneId: at.paneId }
    : conversationTarget(currentWorkspaceTabs(), activeTabId(), spec.cwd);
  placeConversationPane(pane, target, label);
  noteFolderOpened(null, spec.cwd);
  const tab = tabOfPane(pane.id);
  if (tab) focusTile(tab.id, pane.id); // 대시보드를 걷고 키보드를 그 타일에
}

/** [`conversationTarget`] 의 답대로 놓는다 — 갈아 끼울 타일이 그 사이 사라졌으면 새 탭 */
function placeConversationPane(pane: PaneSpec, target: ConversationTarget, label: string): void {
  if (target.kind === "tab") openPaneInTab(target.tabId, pane);
  else if (target.kind === "replace") {
    if (!replaceTile(target.tabId, target.paneId, pane, target.reason === "launcher" ? label : undefined)) {
      openInNewTab(pane, label);
    }
  } else openInNewTab(pane, label);
}

// ---------------------------------------------------------------------------
// 프로젝트 시작 화면 (docs/log/2026-09-26-project-start-screen.md)
// ---------------------------------------------------------------------------

/**
 * 로컬 프로젝트·워크트리를 열 때 **셸 대신 세울 시작 화면** — 설정 `[projects] start_screen` 이 `auto` 이면 늘,
 * `off` 면 `null`(여는 쪽이 지금까지처럼 셸·시작 명령을 곧장 연다). 2026-09-27 부터 그 폴더에 지난 대화가 없어도
 * 선다(docs/log/2026-09-27-folder-conversations.md) — 그래서 여기서 목록을 기다리지 않는다. 화면이 뜨는 순간
 * 스스로 읽는다(`ProjectStart` 의 마운트).
 */
export async function projectStartPaneFor(projectId: string, folder: string, host?: string | null): Promise<PaneSpec | null> {
  return shouldShowStartScreen(settings.projectStartScreen) ? newProjectStartPane(projectId, folder, host) : null;
}

// ---------------------------------------------------------------------------
// 팔레트 (`대화 `)
// ---------------------------------------------------------------------------

/** 팔레트에 내려 줄 줄들 — 최신순 · 범위 이름 · 열림/경로 없음/밖에서 열림. 반응형(시각은 읽는 순간의 것) */
export function paletteConversations(): ConversationPaletteEntry[] {
  const rows = buildScopes(projects(), readyWorktrees, list, home).rows;
  return conversationPaletteEntries(list, rows, (agent, id) => conversationOpen({ agent, id }), Date.now(), releasedAtOf);
}

/**
 * 팔레트에서 고른 대화 — `fork` 면 새 대화로 계속, 아니면 재개(열려 있으면 그 타일로). **aynx 밖에서
 * 열려 있는** 대화의 재개는 곧장 띄우지 않고 `elsewhere` 로 넘긴다 — 부르는 쪽(`+page`)이 대화 기록 시트를
 * 펼치고, 시트의 [재개]가 확인을 한 번 묻는다(앞선 판은 대시보드 "지난 대화" 의 그 줄로 데려갔다 — 그 덩어리는
 * 2026-09-28 에 뺐다 · docs/log/2026-09-28-dashboard-session-cards.md). 포크는 원본을 건드리지 않아 그대로 연다.
 *
 * 시트를 여기서 직접 부르지 않는 이유: `conversation-viewer` 가 이 모듈을 읽으므로 거꾸로 부르면 순환이 된다.
 */
export function openConversationById(
  agent: string,
  id: string,
  fork: boolean,
  elsewhere: (agent: string, id: string) => void,
): void {
  const s = flatConversations(list).find((c) => c.agent === agent && c.id === id);
  if (!s) return;
  if (!fork && conversationOpenElsewhere(s, Date.now())) {
    elsewhere(s.agent, s.id);
    return;
  }
  void openConversation(s, fork ? "fork" : "resume");
}

/**
 * 이 대화가 밖에서 열려 있나 — Aynx 의 어느 타일에도 연결되지 않았고 파일이 방금(마지막으로 놓인 뒤) 고쳐졌다(순수 층 [`openElsewhere`]).
 * 반응형.
 */
export function conversationOpenElsewhere(s: AgentConversation, now: number): boolean {
  return openElsewhere(s, now, conversationOpen(s), releasedAtOf(s.agent, s.id));
}

