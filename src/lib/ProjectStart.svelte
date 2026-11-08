<script lang="ts">
  import { tick, untrack } from "svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import Keys from "$lib/Keys.svelte";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import ScopeChips from "$lib/ScopeChips.svelte";
  import ConvoRowActions from "$lib/ConvoRowActions.svelte";
  import ConvoMeta from "$lib/ConvoMeta.svelte";
  import ConvoTitleEdit from "$lib/ConvoTitleEdit.svelte";
  import { convoMetaChips, type ConvoMetaChip } from "$lib/convo-meta";
  import { folderNameOf } from "$lib/pane-chips";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { iconRef } from "$lib/host-icons";
  import { aiDisplayName, aiIconName, shellIconName } from "$lib/pane-icons";
  import { withoutDisabled } from "$lib/agent-enabled";
  import { relativeTime } from "$lib/history-search";
  import { settings } from "$lib/settings.svelte.js";
  import { projectById, projects } from "$lib/app/project-list.svelte.js";
  import { worktreesOf } from "$lib/app/worktrees.svelte.js";
  import { knownAiClis, knownShellList } from "$lib/app/panes.svelte.js";
  import { focusTile, replaceTile, tabOfPane } from "$lib/app/tabs.svelte.js";
  import {
    conversationHome,
    conversationList,
    conversationOpenElsewhere,
    conversationsError,
    conversationDeleting,
    deleteBlockedReason,
    deleteConversation,
    conversationOpen,
    conversationOpenOtherWindow,
    goToOpenConversation,
    renameBlockedReason,
    loadConversations,
    openConversation,
    readyWorktrees,
    renameConversation,
  } from "$lib/app/agent-sessions.svelte.js";
  import { conversationUsage } from "$lib/app/agent-usage.svelte.js";
  import { viewConversation } from "$lib/app/conversation-viewer.svelte.js";
  import {
    ensureRemoteConversations,
    openRemoteConversation,
    remoteConversations,
  } from "$lib/app/remote-conversations.svelte.js";
  import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
  import { lookupHost } from "$lib/app/hosts.svelte.js";
  import { rememberTarget } from "$lib/app/prompts.svelte.js";
  import { isRemoteConversation, remoteHere, remoteScopeChips } from "$lib/remote-conversations";
  import { isViewKey } from "$lib/transcript";
  import { sideChatConvBadge } from "$lib/side-chat";
  import { sideChatConvMarkOf } from "$lib/app/side-chats.svelte.js";
  import { formatTokens, usageKey } from "$lib/agent-usage";
  import { pathKey, shortenHome, type AgentConversation } from "$lib/agent-sessions";
  import { isRemote, paneForWorktree, projectTail, type Project } from "$lib/projects";
  import {
    effectiveDefaultShellId,
    offeredAiClis,
    shellInfoLabel,
    type AiCli,
    type PaneSpec,
    type ShellList,
  } from "$lib/session";
  import {
    canForkHere,
    effectiveScope,
    folderLists,
    listForScope,
    nextScope,
    resolveFolderContext,
    scopeChips,
    type FolderScope,
  } from "$lib/folder-conversations";
  import {
    defaultStartIndex,
    keyLetter,
    moveStartSelection,
    START_ROWS_INITIAL,
    startActionForKey,
    startKeyOf,
    defaultStartAction,
    type StartAction,
  } from "$lib/project-start";

  /**
   * **프로젝트 시작 화면** — 로컬 프로젝트·워크트리를 열 때 셸 대신 서는 타일 (docs/log/2026-09-26-project-start-screen.md
   * — 2026-09-27 부터는 지난 대화가 없는 폴더에서도 선다: docs/log/2026-09-27-folder-conversations.md). 종류는 시작 타일(`kind:"start"`)이고
   * `PaneSpec.startProject` 가 주소다 — launcher 와 같은 한때의 자리라 헤더가 없고, 탭에 혼자면 무엇을 열든
   * 그 자리를 대신한다.
   *
   * 위에서 아래로(가운데 한 기둥 · 폭 720 — launcher 와 같은 말씨):
   *
   *  · **머리** — 프로젝트 이름 · 폴더(`~` 줄임, 고정폭) · 오른쪽에 브랜치.
   *  · **새로 시작** — 기본 셸 [S] · AI CLI(상태바 `>_` 메뉴와 같은 줄 — Claude Code [C] · Codex [X]). **프로젝트의
   *    에이전트**가 기본 단추다(없으면 셸 — 2026-09-28, 옛 "시작 명령" [R] 단추의 자리 · docs/log/2026-09-28-project-agent-setup-script.md):
   *    지난 대화 줄을 고르지 않았으면 포커스가 거기 서서 Enter 한 번이면 뜬다. 타일은 프로젝트를 여는 길과 **같은 명세**
   *    (`paneForWorktree`)로 짓는다.
   *  · **지난 대화 · 이 워크트리** — 기록된 시작 폴더가 이 폴더인 대화, 최신순 다섯 줄 + "N개 더 보기"(그 자리에서
   *    펼친다). 프로젝트의 폴더가 둘 이상이면 범위 칩 "이 워크트리 · N" / "이 프로젝트 전체 · M"(`Tab`)이 서고, 이 폴더에
   *    대화가 없으면 "이 워크트리에서 나눈 대화가 아직 없습니다" + (다른 워크트리에 있으면) "이 프로젝트 전체 보기 · M". 줄 모양은 대시보드의 지난 대화와 같다. **사용 중이 아닌** 가장 최근 줄이 골라진 채로 선다.
   *  · **밖에서 열림**(실기 ② — 짝은 "열림") — aynx 타일에 연결되지 않았는데 파일이 2분 안에 고쳐진 대화(`OPEN_ELSEWHERE_WINDOW_MS`)는
   *    경고색 알약을 달고, 처음 고르는 줄이 되지 않고, 재개는 그 줄에서 한 번 묻는다(그래도 재개 / 취소 · Enter 한 번 더 /
   *    Escape). 새 대화로 계속은 원본을 건드리지 않아 묻지 않는다.
   *  · **바닥 줄** — 키 안내.
   *
   * **무엇을 고르든 이 타일 자리에서 바뀐다**(`replaceTile` — 같은 탭 · 같은 칸). 재개 · 새 대화로 계속도 대시보드와
   * 같은 `openConversation` 을 지나되 자리를 이 타일로 넘긴다. "열림" 줄은 그 타일로 간다(이 화면은 남는다).
   *
   * **키**(이 타일이 포커스를 가졌을 때만 — 뿌리에서 듣는다): ↑↓ 고르기 · Enter 재개 · Shift+Enter 새 대화로
   * 계속 · V 기록 보기(읽기 전용 시트 — docs/log/2026-09-27-conversation-viewer.md) · 글자 S C X 새로 시작(수식
   * 없이 · `ev.code` 라 한글 자판에서도 같다 — `project-start.ts`). V 는 새로 시작의 글자와 겹치지 않는다.
   *
   * **목록**: 뜰 때마다 다시 읽는다(Rust 캐시라 싸다). 에이전트 턴이 끝나면(`stop`) 저장소가 알아서 다시 읽는다
   * (한 번이라도 읽은 뒤의 규칙 — 이 화면이 뜬 순간 읽었으니 늘 해당한다). 읽는 동안은 조용한 한 줄, 실패하면
   * 새로 시작만 남긴다(소음 없음). 다 읽었는데 0 이어도 화면은 그대로다 — 이미 보고 있는 화면을 셸로 바꾸지 않는다.
   *
   * **원격 프로젝트**(2026-09-27 — docs/log/2026-09-27-remote-conversations.md): 머리에 호스트 칩, "새로 시작 — <호스트>에서"(단추는
   * 그 호스트의 SSH 타일), 목록은 그 서버의 것(`app/remote-conversations` — 붙은 타일 세션이 있을 때만 읽는다 · 칩 "이 폴더 / <호스트>
   * 전체"), 재개는 그 자리에 SSH 타일. 기록 보기(`V`)는 원격 줄에 아직 없다.
   */
  let {
    paneId,
    start,
  }: {
    /** 이 타일의 id — 갈아 끼울 자리 */
    paneId: string;
    /** 프로젝트 id · 워크트리 폴더 · 원격이면 별칭 (`PaneSpec.startProject`) */
    start: { projectId: string; folder: string; host?: string };
  } = $props();

  // ---------------------------------------------------------------------------
  // 읽기
  // ---------------------------------------------------------------------------

  /**
   * **원격 프로젝트**면 그 별칭(docs/log/2026-09-27-remote-conversations.md) — 주소에 적힌 것, 없으면(옛 배치) 프로젝트의
   * 호스트. 그때 폴더는 서버의 경로이고, 목록은 그 서버의 것이며, 새로 시작은 그 호스트의 SSH 타일이다.
   */
  const remoteAlias = $derived.by((): string | null => {
    if (start.host) return start.host;
    const p = projectById(start.projectId);
    return p && isRemote(p) ? p.host : null;
  });

  /** 뜰 때마다 목록을 다시 읽는다 — 같은 파일이면 Rust 캐시가 답한다(로컬만) */
  $effect(() => {
    if (remoteAlias !== null) return;
    untrack(() => void loadConversations());
  });

  /**
   * 원격 — 그 별칭에 붙은 타일 세션이 **있을 때만** 읽는다(새 접속을 열지 않는다). 없으면 조용한 한 줄로 기다리고, 세션이
   * 서는 순간(다른 타일이 붙거나 여기서 셸을 열어) 이 효과가 다시 돌아 읽는다. 1분 안에 다 읽었으면 캐시 그대로.
   */
  $effect(() => {
    const alias = remoteAlias;
    if (alias === null) return;
    const live = liveSessionFor(alias) !== null;
    untrack(() => {
      if (live || remoteConversations(alias).rows === null) ensureRemoteConversations(alias);
    });
  });
  const rh = $derived(remoteAlias !== null ? remoteConversations(remoteAlias) : null);

  /** 상대 시각의 "지금" — 30초에 한 칸(launcher · 대시보드와 같은 간격) */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  let shellList = $state<ShellList | null>(null);
  let clis = $state<AiCli[] | null>(null);
  /** 셸·AI 감지 둘 다 온 뒤에 단추를 세운다 — 도착 순서대로 줄이 바뀌며 깜박이지 않게(`>_` 메뉴와 같은 규칙) */
  $effect(() => {
    let alive = true;
    void Promise.all([knownShellList(), knownAiClis()]).then(([l, a]) => {
      if (!alive) return;
      shellList = l;
      clis = a;
    });
    return () => {
      alive = false;
    };
  });

  const project = $derived<Project | null>(projectById(start.projectId));
  const folderKey = $derived(pathKey(start.folder));
  const title = $derived(project?.name ?? projectTail(start.folder));
  const shownPath = $derived(remoteAlias !== null ? start.folder : shortenHome(start.folder, conversationHome()));

  const list = $derived(conversationList());
  /**
   * 범위 — "이 워크트리"(기본 · 이 폴더에서 시작한 대화) · "이 프로젝트 전체"(그 프로젝트의 모든 폴더 — 폴더가 둘 이상일
   * 때만 칩이 선다). 이 폴더의 지난 대화(`FolderConversations`)와 **같은 판정 · 같은 칩**이다
   * (docs/log/2026-09-27-folder-conversations.md). `Tab` 이 칩을 바꾼다.
   */
  const folderCtx = $derived(resolveFolderContext({ focused: start.folder, tabFolders: [] }, projects(), readyWorktrees));
  const lists = $derived(
    remoteAlias !== null
      ? { here: remoteHere(rh?.rows ?? null, start.folder, rh?.home ?? null), project: null, all: rh?.rows ?? [] }
      : folderLists(list, folderCtx),
  );
  const chips = $derived(
    remoteAlias !== null ? remoteScopeChips(true, lists.here.length, lists.all.length) : scopeChips(folderCtx, lists, true),
  );
  /** 아직 한 번도 못 읽었다 — 로컬 · 원격 모두 */
  const unread = $derived(remoteAlias !== null ? !rh || rh.rows === null : list === null);
  let pickedScope = $state<FolderScope | null>(null);
  const scope = $derived(effectiveScope(chips, pickedScope));
  const convos = $derived(listForScope(lists, scope));

  /** 브랜치 — 워크트리 사본이 있으면 그것, 없으면 가장 최근 대화가 적어 둔 것 */
  const branch = $derived.by((): string | null => {
    const w = worktreesOf(start.projectId);
    const hit = w?.state === "ok" ? w.list.find((x) => pathKey(x.path) === folderKey) : undefined;
    if (hit) return hit.branch;
    return lists.here.find((s) => s.branch)?.branch ?? null;
  });

  // ---------------------------------------------------------------------------
  // 새로 시작
  // ---------------------------------------------------------------------------

  /** 이 폴더를 열 셸 — 프로젝트에 적힌 것, 없으면 지금의 기본 셸(`>_` 메뉴 · 설정과 같은 판정) */
  const shellId = $derived(
    project?.shell ??
      (shellList ? effectiveDefaultShellId(shellList.shells, settings.defaultShell, shellList.default_id) : null),
  );
  const shellName = $derived(
    shellInfoLabel(shellId ? shellList?.shells.find((s) => s.id === shellId) : undefined, t),
  );

  const actions = $derived.by((): StartAction[] => {
    if (!shellList || !clis) return [];
    const out: StartAction[] = [{ kind: "shell" }];
    // 원격은 서버에 무엇이 깔렸는지 모른다 — 알려진 AI CLI 를 다 세운다(없으면 셸이 한 줄로 말한다)
    // 설정에서 끈 에이전트는 단추를 세우지 않는다(`[ai] disabled_agents`) — 프로젝트에 적힌 에이전트여도 같다:
    // 그때 기본 단추는 셸로 떨어진다(`defaultStartAction`). 프로젝트 값은 지우지 않는다.
    const disabled = settings.disabledAgents;
    const offered =
      remoteAlias !== null
        ? clis.length > 0
          ? withoutDisabled(clis, (c) => c.id, disabled).map((c) => ({ id: c.id, command: c.command, name: c.name }))
          : offeredAiClis(clis, disabled)
        : offeredAiClis(clis, disabled);
    for (const c of offered) out.push({ kind: "ai", id: c.id, command: c.command, name: c.name });
    return out;
  });

  /**
   * 기본 단추 — 프로젝트의 에이전트(없으면 · 설치되지 않았으면 셸). 지난 대화 줄을 고르지 않았을 때 포커스가 여기 서서
   * Enter 한 번이면 뜬다(2026-09-28 — 옛 "시작 명령" 단추 R 의 자리).
   */
  const defaultAction = $derived(defaultStartAction(actions, project?.agent ?? null));
  const actionKey = (a: StartAction) => (a.kind === "ai" ? `ai:${a.id}` : a.kind);

  /** 단추 하나 → 타일 명세. 프로젝트를 여는 길과 **같은 함수**(`paneForWorktree`)에 에이전트만 바꿔 넘긴다 */
  function paneOfAction(a: StartAction): PaneSpec {
    const base: Project = project ?? {
      id: start.projectId,
      name: title,
      host: null,
      path: start.folder,
      shell: null,
      agent: null,
      setupScript: "",
      migration: null,
      tmux: false,
      worktreeDir: null,
    };
    // 에이전트 칸에는 그 CLI 의 명령을 싣는다(`agentCommand` 는 id 를 그대로 명령으로 쓴다 — 감지 목록의 명령이 같다)
    const agent = a.kind === "shell" ? null : a.command;
    if (remoteAlias !== null) {
      // 원격 — 그 호스트의 SSH 타일(오늘 원격 프로젝트를 열던 것과 같은 명세 · 같은 첫 입력 길). MCP 토큰은 싣지 않는다
      const host = lookupHost(remoteAlias);
      if (host) rememberTarget(host);
      return paneForWorktree({ ...base, host: remoteAlias, agent }, start.folder, null, host?.meta?.scrollback);
    }
    // 로컬 에이전트는 `paneForProject` 가 MCP 토큰 표식을 켠다(`newAiPane` 과 같다 — codex 가 그것으로 인증한다)
    return paneForWorktree({ ...base, agent }, start.folder, shellId);
  }

  /** 이 타일 자리에서 갈아 끼운다 — 같은 탭 · 같은 칸. 탭 제목은 그대로다 */
  function replaceWith(pane: PaneSpec): void {
    const tab = tabOfPane(paneId);
    if (tab && replaceTile(tab.id, paneId, pane)) focusTile(tab.id, pane.id);
  }

  function runAction(a: StartAction): void {
    replaceWith(paneOfAction(a));
  }

  /** 단추 말풍선 — 이름(키). 기본 단추면 "프로젝트의 기본 (Enter)" 를 덧붙인다 */
  function actionTitle(a: StartAction, code: string | null): string {
    const base = code ? t("app.projectStart.key", { label: actionLabel(a), key: keyLetter(code) }) : actionLabel(a);
    return defaultAction && actionKey(defaultAction) === actionKey(a) ? t("app.projectStart.default", { label: base }) : base;
  }

  function actionLabel(a: StartAction): string {
    if (a.kind === "shell") return remoteAlias !== null ? t("app.projectStart.remoteShell") : shellName;
    return a.name;
  }

  // ---------------------------------------------------------------------------
  // 지난 대화
  // ---------------------------------------------------------------------------

  let expanded = $state(false);
  const visible = $derived(expanded ? convos : convos.slice(0, START_ROWS_INITIAL));
  const keyOf = (s: AgentConversation) => `${s.agent}:${s.id}`;
  /**
   * 밖에서 열린 대화(열쇠) — aynx 타일에 연결되지 않았고 파일이 2분 안에 고쳐졌다
   * (`OPEN_ELSEWHERE_WINDOW_MS` · 실기 ②). "밖에서 열림" 알약을 달고, 처음 고르는 줄이 되지 않고, 재개는 한 번 묻는다.
   */
  const elsewhere = $derived(new Set(visible.filter((s) => conversationOpenElsewhere(s, now)).map(keyOf)));
  /** 사람이 고른 줄 — 아직 안 골랐으면 `null`(그동안은 사용 중이 아닌 가장 최근 줄) */
  let sel = $state<number | null>(null);
  const selIndex = $derived(
    visible.length === 0
      ? -1
      : sel === null
        ? defaultStartIndex(visible.map((s) => elsewhere.has(keyOf(s))))
        : Math.min(sel, visible.length - 1),
  );
  const selKey = $derived(selIndex >= 0 ? keyOf(visible[selIndex]) : null);
  /** 포인터가 올라간 줄 — 단추는 이 줄에, 없으면 고른 줄에 선다(주 동작은 늘 하나) */
  let hot = $state<string | null>(null);
  /** 재개를 한 번 묻는 중인 줄 — 그 줄에만 확인이 서고, 다른 줄로 손이 가면 거둔다 */
  let confirmKey = $state<string | null>(null);
  const actsKey = $derived(confirmKey ?? hot ?? selKey);
  /** 고른 줄의 ⋯ 메뉴가 열려 있나 — 열린 동안은 마우스를 따라 고른 줄을 옮기지 않는다(메뉴로 가는 길에 다른 줄을 지난다) */
  let menuOpen = $state(false);
  /** 이름을 고치는 줄(열쇠) — 그 줄의 제목 자리에 칸이 선다(`ConvoTitleEdit` · docs/log/2026-10-24-convo-rename.md) */
  let renaming = $state<string | null>(null);

  /** 이름 바꾸기를 흐리는 까닭(툴팁) — 원격 대화는 단추가 없다(`onrename` 을 넘기지 않는다) */
  function renameBlockedOf(s: AgentConversation, open: boolean, key: string): string | null {
    return renameBlockedReason(s, { open, elsewhere: elsewhere.has(key) });
  }

  function renameDone(): void {
    renaming = null;
    void focusSelected();
  }

  /** 고른 줄을 여기로 가져올 수 있나 — 바닥 줄 안내 */
  const forkHereSel = $derived.by(() => {
    const s = selIndex >= 0 ? visible[selIndex] : null;
    return remoteAlias === null && s !== null && !isRemoteConversation(s) && canForkHere(s, start.folder);
  });

  function resume(s: AgentConversation): void {
    if (goToOpenConversation(s)) return; // 열려 있는 대화 — 그 타일로(다른 창이면 그 창으로 · 이 화면은 남는다)
    if (!s.cwdExists) return;
    // aynx 밖에서 열려 있다 — 곧장 띄우지 않고 그 줄에서 한 번 묻는다(같은 대화를 두 곳에서 잇지 않게)
    if (elsewhere.has(keyOf(s)) && confirmKey !== keyOf(s)) {
      confirmKey = keyOf(s);
      return;
    }
    confirmKey = null;
    const tab = tabOfPane(paneId);
    if (isRemoteConversation(s)) void openRemoteConversation(s, "resume", tab ? { tabId: tab.id, paneId } : undefined, "replace");
    else void openConversation(s, "resume", tab ? { tabId: tab.id, paneId } : undefined);
  }

  /** 확인을 거둔다 — 그 줄에 포커스를 되돌린다(확인 단추가 사라지며 포커스를 잃지 않게) */
  function cancelConfirm(): void {
    confirmKey = null;
    void focusSelected();
  }

  /** 범위를 바꾼다 — 목록을 접고 고른 줄을 처음으로(아직 고르지 않은 것으로) 되돌린다 */
  function setScope(next: FolderScope): void {
    pickedScope = next;
    expanded = false;
    sel = null;
    hot = null;
    confirmKey = null;
    void focusSelected();
  }

  function fork(s: AgentConversation): void {
    if (!s.cwdExists) return;
    confirmKey = null;
    const tab = tabOfPane(paneId);
    if (isRemoteConversation(s)) void openRemoteConversation(s, "fork", tab ? { tabId: tab.id, paneId } : undefined, "replace");
    else void openConversation(s, "fork", tab ? { tabId: tab.id, paneId } : undefined);
  }

  /** 여기로 가져와 계속 — 다른 폴더(워크트리)의 대화를 이 시작 화면의 폴더에서 새 대화로(로컬만 · 원래 폴더가 지워졌어도 된다) */
  function forkHere(s: AgentConversation): void {
    if (remoteAlias !== null || isRemoteConversation(s) || !canForkHere(s, start.folder)) return;
    confirmKey = null;
    const tab = tabOfPane(paneId);
    void openConversation(s, "fork", tab ? { tabId: tab.id, paneId } : undefined, "replace", start.folder);
  }

  /** 기록 보기 — 재개 · 새 대화로 계속이 이 타일 자리를 갈아 끼우도록 자리를 함께 넘긴다 */
  function view(s: AgentConversation): void {
    confirmKey = null;
    // 원격 대화도 같은 시트 — 붙은 세션으로 서버의 파일을 읽는다(docs/log/2026-09-27-remote-conversations.md "2단계")
    const tab = tabOfPane(paneId);
    viewConversation(s, tab ? { tabId: tab.id, paneId } : undefined);
  }

  /** 아래 칩 — 브랜치 · 모델 · 사용량(`convo-meta.ts` — 상태줄 지난 대화와 같은 칩). 제목 없음은 제목의 흐린 기울임이 말한다 */
  function metaOf(s: AgentConversation): ConvoMetaChip[] {
    const u = isRemoteConversation(s)
      ? s.tokens !== null
        ? { total: s.tokens, forked: s.forkedFrom !== null }
        : undefined
      : conversationUsage().get(usageKey(s.agent, s.id));
    const tokens = u ? t(u.forked ? "board.usage.tokens.fork" : "board.usage.tokens", { n: formatTokens(u.total) }) : null;
    return convoMetaChips(s, { mixed: scope !== "here", tokens, forkedLabel: t("board.convo.forked") });
  }

  // ---------------------------------------------------------------------------
  // 키보드 — 뿌리 하나에서 듣는다
  // ---------------------------------------------------------------------------

  let root = $state<HTMLDivElement | null>(null);

  async function focusSelected(): Promise<void> {
    await tick();
    const row = root?.querySelector<HTMLElement>(`[data-start-row][data-sel="true"]`);
    if (row) row.focus({ preventScroll: false });
    // 줄이 없으면 기본 단추(프로젝트의 에이전트 · 없으면 셸) — Enter 한 번이면 뜬다
    else (root?.querySelector<HTMLElement>("[data-start-default]") ?? root?.querySelector<HTMLElement>("[data-start-action]"))?.focus();
  }

  /** 뿌리가 포커스를 받았다(타일 포커스 라우팅) — 고른 줄에, 줄이 없으면 첫 단추에 넘긴다 */
  function onRootFocus(ev: FocusEvent): void {
    if (ev.target === root) void focusSelected();
  }

  /**
   * 다루는 것만 멈춰 세우고 나머지는 창의 전역 처리기로 흘려보낸다(`Ctrl+Shift+*` · `Alt+화살표` 가 살아야
   * 한다). 조합은 `ev.code` 로 가른다 — IME 가 켜져 있어도 같다. 단추 위의 Enter 는 그 단추의 것이다.
   */
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.defaultPrevented) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    const onButton = target instanceof HTMLButtonElement;
    if (confirmKey !== null && ev.code === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      cancelConfirm();
      return;
    }
    // Ctrl+Shift+Enter — 여기로 가져와 계속(상태줄 지난 대화와 같은 조합)
    if ((ev.code === "Enter" || ev.code === "NumpadEnter") && ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && !onButton) {
      const s = selIndex >= 0 ? visible[selIndex] : null;
      if (!s) return;
      ev.preventDefault();
      ev.stopPropagation();
      forkHere(s);
      return;
    }
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      // Tab — 범위 칩이 둘 이상일 때만(이 화면의 단추 사이를 도는 Tab 은 그때 범위에 양보한다)
      if (ev.code === "Tab" && chips.length > 1) {
        ev.preventDefault();
        setScope(nextScope(chips, scope));
        return;
      }
      if (!ev.shiftKey && (ev.code === "ArrowDown" || ev.code === "ArrowUp")) {
        if (visible.length === 0) return;
        ev.preventDefault();
        sel = moveStartSelection(visible.length, selIndex, ev.code === "ArrowUp" ? "up" : "down");
        hot = null;
        confirmKey = null;
        void focusSelected();
        return;
      }
      if ((ev.code === "Enter" || ev.code === "NumpadEnter") && !onButton) {
        const s = selIndex >= 0 ? visible[selIndex] : null;
        if (!s) return;
        ev.preventDefault();
        if (ev.shiftKey) fork(s);
        else resume(s);
        return;
      }
    }
    if (isViewKey(ev)) {
      const s = selIndex >= 0 ? visible[selIndex] : null;
      if (!s) return;
      ev.preventDefault();
      view(s);
      return;
    }
    const a = startActionForKey(ev, actions);
    if (a) {
      ev.preventDefault();
      runAction(a);
    }
  }

  /** 바닥 줄의 글자들 — 선 단추의 글자만 */
  const letters = $derived(
    actions
      .map(startKeyOf)
      .filter((k): k is string => k !== null)
      .map(keyLetter),
  );
</script>

<!--
  `tabindex="-1" data-tile-focus` — 이 상자가 **타일의 키보드 몸**이다(launcher 와 같은 자리): 이 타일로 포커스가
  옮겨 오면 라우팅이 여기에 주고, 여기서 고른 줄(없으면 첫 단추)로 넘긴다.
-->
<div
  class="pstart"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  data-project-start={start.projectId}
  data-folder={start.folder}
  data-remote={remoteAlias ?? undefined}
  bind:this={root}
  onfocus={onRootFocus}
  onkeydown={onKeydown}
>
  <div class="inner">
    <header class="head">
      <div class="who">
        <div class="nameline">
          <!-- 프로젝트의 얼굴 — 고른 아이콘, 없으면 호스트 독 폴더와 같은 기본 폴더 (프로젝트가 없는 폴더면 이름만) -->
          {#if project}
            <span class="picon" data-start-icon><ProjectIcon {project} size={20} /></span>
          {/if}
          <h2 class="name" data-start-name>{title}</h2>
          {#if remoteAlias !== null}
            <span class="hostchip" title={t("app.remoteConvos.hostChip", { host: remoteAlias })} data-start-host
              ><span aria-hidden="true">⇄</span> {remoteAlias}</span
            >
          {/if}
        </div>
        <span class="path" title={start.folder} data-start-path>{shownPath}</span>
      </div>
      {#if branch}
        <span class="branch" title={t("app.projectStart.branch")} data-start-branch><span class="bglyph" aria-hidden="true">⎇</span> {branch}</span>
      {/if}
    </header>

    <!-- ── 새로 시작 ── -->
    <section class="sec" aria-labelledby="pstart-new-{paneId}">
      <h3 id="pstart-new-{paneId}">
        {remoteAlias !== null ? t("app.projectStart.newOn", { host: remoteAlias }) : t("app.projectStart.new")}
      </h3>
      <div class="acts" data-start-actions>
        {#each actions as a (actionKey(a))}
          {@const code = startKeyOf(a)}
          {@const isDefault = defaultAction !== null && actionKey(defaultAction) === actionKey(a)}
          <button
            type="button"
            class="act"
            class:default={isDefault}
            data-start-action={a.kind === "ai" ? a.id : a.kind}
            data-start-default={isDefault ? "" : undefined}
            title={actionTitle(a, code)}
            onclick={() => runAction(a)}
          >
            <span class="ico">
              {#if a.kind === "shell"}
                <HostIcon icon={iconRef(shellIconName(remoteAlias !== null ? null : shellId))} size={14} />
              {:else}
                {@const logo = aiIconName(a.id)}
                <!-- 모르는 CLI 는 빈 칸 — 지어낸 로고를 붙이지 않는다(`>_` 메뉴와 같다) -->
                {#if logo}<AiGlyph name={logo} size={14} />{/if}
              {/if}
            </span>
            <span class="label">{actionLabel(a)}</span>
            {#if code}<span class="letter"><Keys combo={keyLetter(code)} size="sm" /></span>{/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- ── 지난 대화 · 이 워크트리 ── -->
    <section class="sec" aria-labelledby="pstart-past-{paneId}" data-start-past>
      {#if chips.length > 1}
        <!-- 칩이 둘이면 칩이 범위와 수를 말한다 — 머리는 "지난 대화" 까지만 -->
        <div class="pasthead">
          <h3 id="pstart-past-{paneId}">{t("app.projectStart.pastBare")}</h3>
          <ScopeChips
            {chips}
            current={scope}
            registered={remoteAlias !== null ? false : folderCtx.registered}
            host={remoteAlias}
            onpick={setScope}
          />
        </div>
      {:else}
        <h3 id="pstart-past-{paneId}">
          {t("app.projectStart.past")}{#if convos.length > 0}<span class="count">{convos.length}</span>{/if}
        </h3>
      {/if}
      {#if unread && remoteAlias !== null}
        <!-- 원격 — 읽는 중 · 붙은 세션 없음 · 실패, 조용한 한 줄. 새로 시작은 막지 않는다 -->
        <p
          class="quiet"
          data-start-loading
          data-start-remote-state={rh?.error ? "error" : rh?.offline ? "offline" : "loading"}
        >
          {rh?.error
            ? t("app.remoteConvos.error", { host: remoteAlias, reason: rh.error })
            : rh?.offline
              ? t("app.remoteConvos.offline", { host: remoteAlias })
              : t("app.remoteConvos.reading", { host: remoteAlias })}
        </p>
      {:else if unread}
        <!-- 처음 읽는 중 — 조용한 한 줄. 실패면 아무것도 적지 않는다(새로 시작만 남는다) -->
        {#if !conversationsError()}<p class="quiet" data-start-loading>{t("board.convo.loading")}</p>{/if}
      {:else if convos.length === 0}
        <!-- 대화가 아직 없다 — 그래도 화면은 선다(2026-09-27). 다른 워크트리에 대화가 있으면 "이 프로젝트 전체 보기" 한 단추.
             키보드는 새로 시작의 첫 단추(기본 셸)에 있어 Enter 는 곧장 셸이다 -->
        <div class="emptyp" data-start-empty-box>
          <p class="quiet" data-start-empty>
            {scope === "project"
              ? t("app.folderConvos.empty.project")
              : scope === "all"
                ? t("app.folderConvos.empty.all")
                : t("app.projectStart.empty")}
          </p>
          {#if scope === "here" && remoteAlias !== null && lists.all.length > 0}
            <button type="button" class="btn btn-secondary btn-sm" data-start-show-host onclick={() => setScope("host")}
              >{t("app.folderConvos.scope.host", { host: remoteAlias, n: lists.all.length })}</button
            >
          {/if}
          {#if scope === "here" && lists.project && lists.project.length > 0}
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-start-show-project
              onclick={() => setScope("project")}>{t("app.folderConvos.showProject", { n: lists.project.length })}</button
            >
          {/if}
        </div>
      {:else}
        <ul class="rows" role="listbox" aria-label={t("app.projectStart.past")}>
          {#each visible as s, i (keyOf(s))}
            {@const key = keyOf(s)}
            {@const at = conversationOpen(s)}
            {@const meta = metaOf(s)}
            {@const side = sideChatConvBadge(sideChatConvMarkOf(s.agent, s.id))}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <li
              class="crow"
              class:selected={i === selIndex}
              class:inert={!s.cwdExists}
              class:deleting={conversationDeleting(s)}
              role="option"
              aria-selected={i === selIndex}
              tabindex={i === selIndex ? 0 : -1}
              data-start-row={s.id}
              data-sel={i === selIndex ? "true" : "false"}
              data-agent={s.agent}
              data-state={at ? "open" : !s.cwdExists ? "missing" : elsewhere.has(key) ? "elsewhere" : "ok"}
              onmouseenter={() => {
                if (menuOpen) return;
                hot = key;
                sel = i;
                if (confirmKey !== null && confirmKey !== key) confirmKey = null;
              }}
              onmouseleave={() => {
                if (hot === key) hot = null;
              }}
              onfocus={() => {
                sel = i;
                if (confirmKey !== null && confirmKey !== key) confirmKey = null;
              }}
              onclick={() => (sel = i)}
              ondblclick={() => resume(s)}
            >
              <span class="logo" title={aiDisplayName(s.agent) ?? s.agent}><HostIcon icon={iconRef(s.agent)} size={16} /></span>
              <span class="main">
                <span class="tline"
                  >{#if renaming === key}<ConvoTitleEdit
                      value={s.title}
                      onsave={(name) => renameConversation(s, name)}
                      ondone={renameDone}
                    />{:else}<span class="title" class:fallback={s.titleSource === "fallback"}>{s.title}</span
                    >{/if}{#if side}<span class="pill side" data-pill="side-chat" title={t(side.title)}>{t(side.label)}</span
                    >{/if}{#if at}<span
                      class="pill open"
                      data-pill="open"
                      title={conversationOpenOtherWindow(s) ? t("board.convo.openOther.title") : undefined}
                      >{t("board.convo.open")}</span
                    >{:else if !s.cwdExists}<span class="pill" data-pill="missing" title={t("board.convo.missing.title")}
                      >{t("board.convo.missing")}</span
                    >{:else if elsewhere.has(key) && confirmKey !== key}<span
                      class="pill elsewhere"
                      data-pill="elsewhere"
                      title={t("board.convo.elsewhere.title", { when: relativeTime(s.updatedAt, now, t) })}
                      >{t("board.convo.elsewhere")}</span
                    >{/if}</span
                >
                <ConvoMeta chips={meta} />
              </span>
              {#if actsKey === key}
                <span class="racts" data-start-acts>
                  {#if confirmKey === key}
                    <!-- 한 번 묻는다 — 그래도 재개(주 동작) · 취소. Enter 한 번 더 = 그래도 재개 · Escape = 취소 -->
                    <span class="warnq" data-start-confirm>{t("board.convo.elsewhere.confirm")}</span>
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      tabindex="-1"
                      data-act="cancel"
                      onclick={cancelConfirm}>{t("board.convo.elsewhere.cancel")}</button
                    >
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      tabindex="-1"
                      data-act="resume-anyway"
                      onclick={() => resume(s)}>{t("board.convo.elsewhere.resume")}</button
                    >
                  {:else}
                    <ConvoRowActions
                      open={at}
                      cwdExists={s.cwdExists}
                      viewKey="V"
                      onview={() => view(s)}
                      onfork={() => fork(s)}
                      onhere={remoteAlias === null && !isRemoteConversation(s) && canForkHere(s, start.folder)
                        ? () => forkHere(s)
                        : undefined}
                      onrename={remoteAlias === null && !isRemoteConversation(s) ? () => (renaming = key) : undefined}
                      renameBlocked={renameBlockedOf(s, at, key)}
                      ondelete={remoteAlias === null && !isRemoteConversation(s) ? () => void deleteConversation(s) : undefined}
                      deleteBlocked={deleteBlockedReason(s, { open: at, elsewhere: elsewhere.has(key) })}
                      onprimary={() => resume(s)}
                      onmenu={(open) => (menuOpen = open)}
                      onclosefocus={() => void focusSelected()}
                    />
                  {/if}
                </span>
              {:else}
                <span class="time">{relativeTime(s.updatedAt, now, t)}</span>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="tail">
          {#if convos.length > visible.length}
            <button type="button" class="btn btn-ghost btn-sm" data-start-more onclick={() => (expanded = true)}
              >{t("board.convo.more", { n: convos.length - visible.length })}</button
            >
          {/if}
        </div>
      {/if}
      {#if remoteAlias !== null && rh && rh.rows !== null && rh.loading}
        <!-- 원격 — 읽은 줄은 두고 이어 읽는 중 한 줄("12 / 31") -->
        <p class="quiet remote-more" data-start-progress>
          {rh.progress
            ? t("app.remoteConvos.readingMore", { host: remoteAlias, done: rh.progress.done, total: rh.progress.total })
            : t("app.remoteConvos.reading", { host: remoteAlias })}
        </p>
      {:else if remoteAlias !== null && rh && rh.rows !== null && rh.error}
        <p class="quiet remote-more" data-start-error>
          {t("app.remoteConvos.error", { host: remoteAlias, reason: rh.error })}
        </p>
      {/if}
    </section>

    <!-- ── 바닥 줄 — 키 안내 ── -->
    <footer class="keys" data-start-keys>
      {#if convos.length > 0}
        <span><Keys combo="↑↓" /> {t("app.projectStart.keys.move")}</span>
        <span><Keys combo="Enter" /> {t("board.convo.resume")}</span>
        <span><Keys combo="Shift+Enter" /> {t("board.convo.fork")}</span>
        {#if forkHereSel}<span class="here"><Keys combo="Ctrl+Shift+Enter" /> {t("app.folderConvos.forkHere")}</span>{/if}
        <span><Keys combo="V" /> {t("app.projectStart.keys.view")}</span>
      {/if}
      {#if chips.length > 1}
        <span><Keys combo="Tab" /> {t("app.projectStart.keys.scope")}</span>
      {/if}
      {#if letters.length > 0}
        <span>{#each letters as letter, i (i)}{#if i > 0}<span class="keycap-sep">{" "}</span>{/if}<Keys combo={letter} />{/each} {t("app.projectStart.new")}</span>
      {/if}
    </footer>
  </div>
</div>

<style>
  /* 원격 — 머리의 호스트 칩 · 이어 읽는 중 한 줄 (docs/log/2026-09-27-remote-conversations.md) */
  .nameline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  /* 프로젝트의 얼굴 (`ProjectIcon`) — 줄지 않는 고정 자리 */
  .picon {
    display: flex;
    flex: 0 0 auto;
  }

  .nameline .name {
    min-width: 0;
  }

  .hostchip {
    flex: none;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 18px;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .remote-more {
    margin: var(--space-2) 0 0;
  }

  /* 배경을 칠하지 않는다 — 판은 PaneHost 의 `.pane-box.start`(크롬의 우물 `--surface-field`)가 깐다 */
  .pstart {
    position: absolute;
    inset: 0;
    overflow: auto;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    outline: none;
  }

  /* 가운데 한 기둥 — 폭 720, 위 여백 72(launcher 와 같은 높이에서 시작한다) */
  .inner {
    box-sizing: border-box;
    width: min(calc(720px + 2 * var(--space-4)), 100%);
    margin: 0 auto;
    padding: 72px var(--space-4) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* ── 머리 ── */
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding: 0 var(--space-2);
  }

  .who {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .name {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .path,
  .branch {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .branch {
    flex: 0 1 auto;
    max-width: 40%;
  }

  /* 브랜치 기호는 고정폭 글꼴에 없는 경우가 많다 — UI 글꼴(과 그 대체 글꼴)로 그린다 */
  .bglyph {
    font-family: var(--font-ui);
  }

  /* ── 덩어리 ── */
  .sec {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .sec h3 {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0 0 var(--space-1);
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    line-height: 20px;
    color: var(--fg-3);
  }

  .count {
    font-variant-numeric: tabular-nums;
  }

  /* 범위 칩이 선 머리 — "지난 대화" 옆에 칩 둘 */
  .pasthead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-1);
  }

  .pasthead h3 {
    margin: 0;
  }

  /* 빈 목록 — 한 줄 + (있으면) 이 프로젝트 전체 보기 */
  .emptyp {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  /* ── 새로 시작 ── */
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .act {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    max-width: 100%;
    height: 32px;
    padding: 0 var(--space-2) 0 var(--space-3);
    font-family: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .act:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .act:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .ico {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: var(--fg-3);
  }

  .label {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  /* 기본 단추(프로젝트의 에이전트 · 없으면 셸) — 우물 판(`--surface-field`, PaneHost 의 `.pane-box.start`) 위에
     **한 겹 뜬 면**(`--surface-raised`). 강조색은 쓰지 않는다(강조색은 셋뿐). 예전엔 타일 면(`--surface-tile`)으로
     "한 겹 짙게" 였는데 그 면은 터미널 테마 색이라 크롬 글자와 갈렸다(docs/log/2026-10-01-field-surface.md) */
  .act.default {
    background: var(--surface-raised);
    border-color: var(--line-strong);
  }

  /* 실행 단추의 글자 키 — 칩 모양은 전역 `.keycap`, 여기는 줄 끝 자리만 */
  .letter {
    flex: 0 0 auto;
    display: inline-flex;
  }

  /* ── 지난 대화 — 줄은 대시보드의 지난 대화와 같은 모양 ── */
  .quiet {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-3);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .crow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    outline: none;
    cursor: default;
  }

  .crow:hover {
    background: color-mix(in srgb, var(--surface-hover) 50%, transparent);
  }

  /* 고른 줄 — 이 화면의 강조 판(다른 강조는 [재개] 하나) */
  .crow.selected {
    background: var(--accent-soft);
  }

  /* 대화의 폴더가 없다 — 줄을 흐리게(상태줄 지난 대화와 같은 처방). 여기로 가져오기는 여전히 된다 */
  /* 줄 자체가 아니라 내용 칸만 흐린다 — 줄에 opacity 를 걸면 그 안에서 뜨는 ⋯ 메뉴(`ConvoRowActions`)까지 반투명해진다 */
  .crow.inert > :not(.racts) {
    opacity: 0.6;
  }

  /* 지우는 중 — 자리는 그대로 두고 내용만 흐린다(목록을 다시 읽어 줄이 빠질 때까지 · 칸이 뛰지 않게) */
  .crow.deleting > :not(.racts) {
    opacity: 0.45;
  }

  /* 선택은 판(`--accent-soft`)이 말한다 — 포커스가 고른 줄을 따라다니므로 링을 겹쳐 그리지 않는다(launcher 와 같다) */
  .crow:focus-visible {
    outline: none;
  }

  .logo {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    line-height: 0;
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .title {
    font-size: var(--t-sm);
    color: var(--fg-1);
  }

  .title.fallback {
    color: var(--fg-2);
    font-style: italic;
  }

  .time {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .racts {
    flex: 0 0 auto;
    display: inline-flex;
    gap: var(--space-2);
  }


  .pill {
    flex: 0 0 auto;
    padding: 1px var(--space-2);
    font-size: var(--t-xs);
    line-height: 18px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  /* 칩 줄 끝의 상태 칩 — 다른 칩과 같은 높이 */
  /* 제목 줄 — 제목은 말줄임, 상태 칩은 그 바로 옆(줄지 않는다) */
  .tline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .tline .title {
    min-width: 0;
  }

  .tline .pill {
    flex: none;
    line-height: 16px;
  }

  .pill.open {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  /* 밖에서 열림 — 경고색(강조색이 아니다: 주 동작이 아니라 조심하라는 표시) */
  .pill.elsewhere {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }

  /* 사이드 채팅의 대화(10-24 — 이 폴더의 지난 대화와 같은 표지) */
  .pill.side {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  /* 확인 문장 — 한 문장이 길어 줄을 바꿔 선다(단추는 줄지 않는다). 확인이 선 동안 제목 칸은 그만큼 줄어든다 */
  .warnq {
    min-width: 0;
    max-width: 380px;
    font-size: var(--t-xs);
    line-height: 16px;
    color: var(--warn);
    word-break: keep-all;
  }

  .racts:has(.warnq) {
    flex: 0 1 auto;
    min-width: 0;
    align-items: center;
  }

  .racts:has(.warnq) :global(.btn) {
    flex: 0 0 auto;
  }

  .tail {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-1);
  }

  /* ── 바닥 줄 ── */
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3) var(--space-2) 0;
    border-top: 1px solid var(--line);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .keys > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .keys .here {
    color: var(--accent);
  }
</style>
