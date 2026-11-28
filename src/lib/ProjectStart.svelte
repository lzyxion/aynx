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
  import TemplatePreview from "$lib/TemplatePreview.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import {
    deleteTabTemplate,
    openTabTemplate,
    projectTabTemplates,
    reloadTabTemplates,
    renameTabTemplate,
    templateSummary,
  } from "$lib/app/tab-templates.svelte.js";
  import { firstAiLeaf, type FirstAiPatch, type TabTemplate } from "$lib/tab-templates";
  import { agentSessionLaunchSpec, agentSessionRemoteLaunchSpec } from "$lib/context";
  import { showNotice } from "$lib/app/notice";
  import { stripReason } from "$lib/error-reason";
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
    conversationChatState,
    conversationOpen,
    conversationOpenOtherWindow,
    goToOpenConversation,
    renameBlockedReason,
    linkOpenedConversation,
    loadConversations,
    openConversation,
    openConversationInChat,
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
  import { chatOpenBlockKey, pathKey, resumeAutorunFor, shortenHome, type AgentConversation, type ChatOpenState } from "$lib/agent-sessions";
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
   * 프로젝트 시작 화면 — 프로젝트 · 워크트리를 열 때 셸 대신 서는 타일(docs/log/2026-09-26-project-start-screen.md).
   *
   * - 무엇을 고르든 이 타일 자리에서 바뀐다(`replaceTile` — 같은 탭 · 같은 칸). 새로 시작의 타일은 프로젝트를 여는 길과 같은 명세(`paneForWorktree`)로 짓는다.
   * - 키는 이 타일이 포커스를 가졌을 때만 뿌리에서 듣는다. V(기록 보기)는 새로 시작의 글자와 겹치지 않는다.
   * - 밖에서 열린 대화는 처음 고르는 줄이 되지 않고 재개 전에 한 번 묻는다 — 새 대화로 계속은 원본을 건드리지 않아 묻지 않는다.
   * - 목록이 0 이어도 화면은 그대로다 — 이미 보고 있는 화면을 셸로 바꾸지 않는다. 기록 보기(`V`)는 원격 줄에 아직 없다.
   */
  let {
    paneId,
    start,
  }: {
    paneId: string;
    /** `PaneSpec.startProject` */
    start: { projectId: string; folder: string; host?: string };
  } = $props();

  // ---------------------------------------------------------------------------
  // 읽기
  // ---------------------------------------------------------------------------

  /** 주소에 없으면(옛 배치) 프로젝트의 호스트. 원격이면 폴더는 서버의 경로다(docs/log/2026-09-27-remote-conversations.md) */
  const remoteAlias = $derived.by((): string | null => {
    if (start.host) return start.host;
    const p = projectById(start.projectId);
    return p && isRemote(p) ? p.host : null;
  });

  /** 같은 파일이면 Rust 캐시가 답한다 */
  $effect(() => {
    if (remoteAlias !== null) return;
    untrack(() => void loadConversations());
  });

  /** 원격은 그 별칭에 붙은 타일 세션이 **있을 때만** 읽는다 — 새 접속을 열지 않는다 */
  $effect(() => {
    const alias = remoteAlias;
    if (alias === null) return;
    const live = liveSessionFor(alias) !== null;
    untrack(() => {
      if (live || remoteConversations(alias).rows === null) ensureRemoteConversations(alias);
    });
  });
  const rh = $derived(remoteAlias !== null ? remoteConversations(remoteAlias) : null);

  /** 상대 시각의 "지금" — launcher · 대시보드와 같은 간격 */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  let shellList = $state<ShellList | null>(null);
  let clis = $state<AiCli[] | null>(null);
  /** 셸 · AI 감지 둘 다 온 뒤에 단추를 세운다 — 도착 순서대로 줄이 바뀌며 깜박이지 않게 */
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
  /** `FolderConversations` 와 같은 판정 · 같은 칩이다 */
  const folderCtx = $derived(resolveFolderContext({ focused: start.folder, tabFolders: [] }, projects(), readyWorktrees));
  const lists = $derived(
    remoteAlias !== null
      ? { here: remoteHere(rh?.rows ?? null, start.folder, rh?.home ?? null), project: null, all: rh?.rows ?? [] }
      : folderLists(list, folderCtx),
  );
  const chips = $derived(
    remoteAlias !== null ? remoteScopeChips(true, lists.here.length, lists.all.length) : scopeChips(folderCtx, lists, true),
  );
  const unread = $derived(remoteAlias !== null ? !rh || rh.rows === null : list === null);
  let pickedScope = $state<FolderScope | null>(null);
  const scope = $derived(effectiveScope(chips, pickedScope));
  const convos = $derived(listForScope(lists, scope));

  /** 워크트리 사본이 없으면 가장 최근 대화가 적어 둔 것 */
  const branch = $derived.by((): string | null => {
    const w = worktreesOf(start.projectId);
    const hit = w?.state === "ok" ? w.list.find((x) => pathKey(x.path) === folderKey) : undefined;
    if (hit) return hit.branch;
    return lists.here.find((s) => s.branch)?.branch ?? null;
  });

  // ---------------------------------------------------------------------------
  // 새로 시작
  // ---------------------------------------------------------------------------

  /** 없으면 지금의 기본 셸 — `>_` 메뉴 · 설정과 같은 판정 */
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
    // 원격은 서버에 무엇이 깔렸는지 모른다 — 알려진 AI CLI 를 다 세운다
    // 설정에서 끈 에이전트는 프로젝트에 적힌 것이어도 세우지 않는다 — 프로젝트 값은 지우지 않는다
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

  /** 지난 대화 줄을 고르지 않았을 때 포커스가 여기 서서 Enter 한 번이면 뜬다 */
  const defaultAction = $derived(defaultStartAction(actions, project?.agent ?? null));
  const actionKey = (a: StartAction) => (a.kind === "ai" ? `ai:${a.id}` : a.kind);

  /** 프로젝트를 여는 길과 **같은 함수**(`paneForWorktree`)에 에이전트만 바꿔 넘긴다 */
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
    const agent = a.kind === "shell" ? null : a.command;
    if (remoteAlias !== null) {
      // 원격 타일에는 MCP 토큰을 싣지 않는다(→ docs/invariants.md 전문 11)
      const host = lookupHost(remoteAlias);
      if (host) rememberTarget(host);
      return paneForWorktree({ ...base, host: remoteAlias, agent }, start.folder, null, host?.meta?.scrollback);
    }
    // 로컬 에이전트는 `paneForProject` 가 MCP 토큰 표식을 켠다 — codex 가 그것으로 인증한다
    return paneForWorktree({ ...base, agent }, start.folder, shellId);
  }

  /** 탭 제목은 그대로다 */
  function replaceWith(pane: PaneSpec): void {
    const tab = tabOfPane(paneId);
    if (tab && replaceTile(tab.id, paneId, pane)) focusTile(tab.id, pane.id);
  }

  function runAction(a: StartAction): void {
    const tpl = armedTpl;
    armed = null;
    // 템플릿을 고른 채 AI CLI 단추 — 템플릿 칸과 같은 CLI 면 저장된 그대로(추가 인자 포함 — "저장된 그대로 열기"의 길),
    // 다르면 이 단추가 띄우는 줄로 갈아 끼운다
    const autorun = tpl && a.kind === "ai" ? paneOfAction(a).autorun : undefined;
    if (tpl && autorun) {
      const saved = firstAiLeaf(tpl.root)?.autorun;
      const same = saved !== undefined && aiIconName(saved) !== null && aiIconName(saved) === aiIconName(autorun);
      void openTemplate(tpl, same ? undefined : { autorun });
      return;
    }
    replaceWith(paneOfAction(a));
  }

  function actionTitle(a: StartAction, code: string | null): string {
    const base = code ? t("app.projectStart.key", { label: actionLabel(a), key: keyLetter(code) }) : actionLabel(a);
    return defaultAction && actionKey(defaultAction) === actionKey(a) ? t("app.projectStart.default", { label: base }) : base;
  }

  function actionLabel(a: StartAction): string {
    if (a.kind === "shell") return remoteAlias !== null ? t("app.projectStart.remoteShell") : shellName;
    return a.name;
  }

  // ---------------------------------------------------------------------------
  // 템플릿
  // ---------------------------------------------------------------------------

  /** 뜰 때마다 다시 읽는다 — 다른 창이 고쳤을 수 있다 */
  $effect(() => {
    untrack(() => void reloadTabTemplates());
  });

  const templates = $derived(projectTabTemplates(start.projectId));
  const TEMPLATE_KEYS = 9;

  /** `firstAi` 를 주면 첫 AI 칸의 실행 줄(· 폴더)을 바꿔 연다. 그 칸의 타일 id 를 돌려준다 */
  async function openTemplate(tpl: TabTemplate, firstAi?: FirstAiPatch): Promise<string | null> {
    const tab = tabOfPane(paneId);
    if (!tab) return null;
    return openTabTemplate(
      tpl.id,
      {
        kind: "replace",
        tabId: tab.id,
        paneId,
        folder: start.folder,
        ...(remoteAlias !== null ? { host: remoteAlias } : {}),
      },
      firstAi ? { firstAi } : {},
    );
  }

  /**
   * 고른 템플릿 — AI 타일이 든 템플릿 카드는 곧장 열지 않고 고른 채 선다. 그 동안 `resume` 으로 가는 길 전부와 AI CLI 단추가 첫 AI 칸에
   * 그 대화 · 그 CLI 를 싣는다. 같은 카드를 다시 누르면 고르기만 푼다 · 고른 동안 위 단추들의 모양은 바꾸지 않는다(사용자 결정).
   */
  let armed = $state<string | null>(null);
  /** 목록에서 사라졌으면 `null` */
  const armedTpl = $derived(armed !== null ? (templates.find((x) => x.id === armed) ?? null) : null);
  const aiNames = $derived(actions.filter((a) => a.kind === "ai").map(actionLabel));
  /** 카드 툴팁 · 숨은 상태 줄에만 — 본문에 띄우지 않는다(사용자 결정) */
  const armedHint = $derived(
    aiNames.length > 0
      ? t("app.projectStart.template.armed", { clis: aiNames.join(" · ") })
      : t("app.projectStart.template.armedNoCli"),
  );

  function pickTemplate(tpl: TabTemplate): void {
    // 여는 것이 아니라 토글(사용자 결정) — 저장된 그대로 열기는 같은 CLI 단추
    if (armed === tpl.id) {
      armed = null;
      return;
    }
    if (firstAiLeaf(tpl.root) === null) {
      armed = null;
      void openTemplate(tpl);
      return;
    }
    armed = tpl.id;
  }

  /** 빈 곳 클릭만 고르기를 푼다 */
  function onRootClick(ev: MouseEvent): void {
    if (armed === null) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest("button, a, input, textarea, select, [role='option'], [role='menu'], [contenteditable='true']")) return;
    armed = null;
  }

  /**
   * 재개 줄은 대화의 CLI 것이다(템플릿 칸의 CLI 와 달라도). 폴더는 늘 그 대화의 폴더(명세의 `cwd`)다.
   * 첫 AI 칸이 그 대화를 열 수 없는 꼴이면 `false` — 부르는 쪽이 평소 재개로.
   */
  function resumeInTemplate(tpl: TabTemplate, s: AgentConversation): boolean {
    const leaf = firstAiLeaf(tpl.root);
    if (!leaf) return false;
    const remote = isRemoteConversation(s);
    if (remote ? !(leaf.kind === "ssh" && !leaf.adhoc && leaf.alias === s.host) : leaf.kind !== "local") return false;
    void (async () => {
      let spec;
      try {
        spec = remote
          ? await agentSessionRemoteLaunchSpec(s.host, s.agent, s.id, "resume")
          : await agentSessionLaunchSpec(s.agent, s.id, "resume");
      } catch (e) {
        showNotice(stripReason(String(e)));
        return;
      }
      const autorun = resumeAutorunFor(leaf.autorun, s.agent, s.id) ?? spec.command;
      const pane = await openTemplate(tpl, { autorun, cwd: spec.cwd });
      // 재개면 id 를 이미 안다 — 첫 훅 신호 전에도 "열림" 이 서고 두 번 열리지 않는다(`openConversation` 과 같다)
      if (pane) linkOpenedConversation(pane, s.agent, s.id);
    })();
    return true;
  }

  /** 항목은 통로 `runOnMenu` 하나 — 스냅샷 → 닫기 → 실행 */
  let tplMenu = $state<{ id: string; x: number; y: number } | null>(null);
  let tplMenuEl = $state<HTMLElement | null>(null);
  /** 템플릿 id */
  let tplRenaming = $state<string | null>(null);

  function openTplMenu(ev: MouseEvent, tpl: TabTemplate): void {
    ev.preventDefault();
    ev.stopPropagation();
    tplMenu = { id: tpl.id, x: ev.clientX, y: ev.clientY };
  }

  function closeTplMenu(): void {
    tplMenu = null;
  }

  /** 타일 안에서는 `position: fixed` 의 기준이 창이 아닐 수 있다 — `body` 끝으로 옮긴다 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    if (!tplMenuEl || !tplMenu) return;
    (tplMenuEl.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
    const r = tplMenuEl.getBoundingClientRect();
    const nx = tplMenu.x + r.width > window.innerWidth ? window.innerWidth - r.width - 4 : tplMenu.x;
    const ny = tplMenu.y + r.height > window.innerHeight ? window.innerHeight - r.height - 4 : tplMenu.y;
    tplMenuEl.style.left = Math.max(4, nx) + "px";
    tplMenuEl.style.top = Math.max(4, ny) + "px";
  });

  function tplMenuKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeTplMenu();
    }
  }

  function tplRenameDone(): void {
    tplRenaming = null;
    void focusSelected();
  }

  // ---------------------------------------------------------------------------
  // 지난 대화
  // ---------------------------------------------------------------------------

  let expanded = $state(false);
  const visible = $derived(expanded ? convos : convos.slice(0, START_ROWS_INITIAL));
  const keyOf = (s: AgentConversation) => `${s.agent}:${s.id}`;
  const elsewhere = $derived(new Set(visible.filter((s) => conversationOpenElsewhere(s, now)).map(keyOf)));
  /** 아직 안 골랐으면 `null` — 그동안은 사용 중이 아닌 가장 최근 줄 */
  let sel = $state<number | null>(null);
  const selIndex = $derived(
    visible.length === 0
      ? -1
      : sel === null
        ? defaultStartIndex(visible.map((s) => elsewhere.has(keyOf(s))))
        : Math.min(sel, visible.length - 1),
  );
  const selKey = $derived(selIndex >= 0 ? keyOf(visible[selIndex]) : null);
  /** 단추는 이 줄에, 없으면 고른 줄에 선다 — 주 동작은 늘 하나 */
  let hot = $state<string | null>(null);
  /** 재개를 한 번 묻는 중인 줄 — 다른 줄로 손이 가면 거둔다 */
  let confirmKey = $state<string | null>(null);
  const actsKey = $derived(confirmKey ?? hot ?? selKey);
  /** 열린 동안은 마우스를 따라 고른 줄을 옮기지 않는다 — 메뉴로 가는 길에 다른 줄을 지난다 */
  let menuOpen = $state(false);
  let renaming = $state<string | null>(null);

  /** 원격 대화는 단추가 없다(`onrename` 을 넘기지 않는다) */
  function renameBlockedOf(s: AgentConversation, open: boolean, key: string): string | null {
    return renameBlockedReason(s, { open, elsewhere: elsewhere.has(key) });
  }

  function renameDone(): void {
    renaming = null;
    void focusSelected();
  }

  const forkHereSel = $derived.by(() => {
    const s = selIndex >= 0 ? visible[selIndex] : null;
    return remoteAlias === null && s !== null && !isRemoteConversation(s) && canForkHere(s, start.folder);
  });

  function resume(s: AgentConversation): void {
    if (goToOpenConversation(s)) {
      armed = null;
      return;
    }
    if (!s.cwdExists) return;
    // 밖에서 열려 있다 — 한 번 묻는다(같은 대화를 두 곳에서 잇지 않게)
    if (elsewhere.has(keyOf(s)) && confirmKey !== keyOf(s)) {
      confirmKey = keyOf(s);
      return;
    }
    confirmKey = null;
    const tpl = armedTpl;
    armed = null;
    if (tpl && resumeInTemplate(tpl, s)) return;
    const tab = tabOfPane(paneId);
    if (isRemoteConversation(s)) void openRemoteConversation(s, "resume", tab ? { tabId: tab.id, paneId } : undefined, "replace");
    else void openConversation(s, "resume", tab ? { tabId: tab.id, paneId } : undefined);
  }

  /** 끄면 줄 DOM 이 오늘 그대로 — 원격 프로젝트 · SSH 대화에는 채팅 모양이 없다 */
  const chatOn = $derived(settings.chatTile && remoteAlias === null);
  function chatOf(s: AgentConversation): ChatOpenState {
    return remoteAlias !== null || isRemoteConversation(s) ? "hidden" : conversationChatState(s, now);
  }
  function chatBlockedOf(s: AgentConversation): string | null {
    const k = chatOpenBlockKey(chatOf(s));
    return k ? t(k) : null;
  }

  /** 고른 템플릿은 쓰지 않고 거둔다 — 템플릿에는 채팅 잎이 없다 */
  function chat(s: AgentConversation): void {
    if (chatOf(s) !== "ok") return;
    confirmKey = null;
    armed = null;
    const tab = tabOfPane(paneId);
    void openConversationInChat(s, tab ? { tabId: tab.id, paneId } : undefined);
  }

  /** 포커스를 되돌린다 — 확인 단추가 사라지며 포커스를 잃지 않게 */
  function cancelConfirm(): void {
    confirmKey = null;
    void focusSelected();
  }

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

  /** 다른 워크트리의 대화를 이 폴더에서 새 대화로 — 로컬만 · 원래 폴더가 지워졌어도 된다 */
  function forkHere(s: AgentConversation): void {
    if (remoteAlias !== null || isRemoteConversation(s) || !canForkHere(s, start.folder)) return;
    confirmKey = null;
    const tab = tabOfPane(paneId);
    void openConversation(s, "fork", tab ? { tabId: tab.id, paneId } : undefined, "replace", start.folder);
  }

  /** 시트의 재개 · 새 대화로 계속이 이 타일 자리를 갈아 끼우도록 자리를 함께 넘긴다 */
  function view(s: AgentConversation): void {
    confirmKey = null;
    const tab = tabOfPane(paneId);
    viewConversation(s, tab ? { tabId: tab.id, paneId } : undefined);
  }

  /** 상태줄 지난 대화와 같은 칩 */
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
    else (root?.querySelector<HTMLElement>("[data-start-default]") ?? root?.querySelector<HTMLElement>("[data-start-action]"))?.focus();
  }

  function onRootFocus(ev: FocusEvent): void {
    if (ev.target === root) void focusSelected();
  }

  /** 다루는 것만 멈춰 세운다 — 나머지(`Ctrl+Shift+*` · `Alt+화살표`)는 창의 전역 처리기로 흘려보내야 산다 */
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
    if (armed !== null && ev.code === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      armed = null;
      return;
    }
    // 상태줄 지난 대화와 같은 조합
    if ((ev.code === "Enter" || ev.code === "NumpadEnter") && ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey && !onButton) {
      const s = selIndex >= 0 ? visible[selIndex] : null;
      if (!s) return;
      ev.preventDefault();
      ev.stopPropagation();
      forkHere(s);
      return;
    }
    if ((ev.code === "Enter" || ev.code === "NumpadEnter") && ev.altKey && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey && !onButton && chatOn) {
      const s = selIndex >= 0 ? visible[selIndex] : null;
      if (!s) return;
      ev.preventDefault();
      ev.stopPropagation();
      chat(s);
      return;
    }
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey) {
      // 범위 칩이 둘 이상이면 단추 사이를 도는 Tab 은 범위에 양보한다
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
    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && templates.length > 0) {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(ev.code);
      const tpl = m ? templates[Number(m[1]) - 1] : undefined;
      if (tpl) {
        ev.preventDefault();
        pickTemplate(tpl);
        return;
      }
    }
    const a = startActionForKey(ev, actions);
    if (a) {
      ev.preventDefault();
      runAction(a);
    }
  }

  const letters = $derived(
    actions
      .map(startKeyOf)
      .filter((k): k is string => k !== null)
      .map(keyLetter),
  );
</script>

<!-- `tabindex="-1" data-tile-focus` — 이 상자가 타일의 키보드 몸이다(포커스 라우팅이 여기에 준다) -->
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
  onclick={onRootClick}
>
  <div class="inner">
    <header class="head">
      <div class="who">
        <div class="nameline">
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
                <!-- 모르는 CLI 는 빈 칸 — 지어낸 로고를 붙이지 않는다 -->
                {#if logo}<AiGlyph name={logo} size={14} />{/if}
              {/if}
            </span>
            <span class="label">{actionLabel(a)}</span>
            {#if code}<span class="letter"><Keys combo={keyLetter(code)} size="sm" /></span>{/if}
          </button>
        {/each}
      </div>
    </section>

    <!-- ── 템플릿 ── -->
    {#if templates.length > 0}
      <section class="sec" aria-labelledby="pstart-tpl-{paneId}" data-start-templates>
        <h3 id="pstart-tpl-{paneId}">{t("app.projectStart.templates")}<span class="count">{templates.length}</span></h3>
        <div class="tcards">
          {#each templates as tpl, i (tpl.id)}
            {@const key = i < TEMPLATE_KEYS ? String(i + 1) : null}
            {#if tplRenaming === tpl.id}
              <div class="tcard renaming" data-start-template={tpl.id}>
                <TemplatePreview root={tpl.root} width={64} height={40} />
                <span class="tmain">
                  <ConvoTitleEdit
                    value={tpl.name}
                    label={t("app.tabTemplates.rename.aria")}
                    onsave={async (name) => void (await renameTabTemplate(tpl.id, name))}
                    ondone={tplRenameDone}
                  />
                </span>
              </div>
            {:else}
              {@const isArmed = armedTpl?.id === tpl.id}
              <button
                type="button"
                class="tcard"
                class:armed={isArmed}
                data-start-template={tpl.id}
                data-armed={isArmed ? "" : undefined}
                aria-pressed={isArmed}
                title={isArmed
                  ? armedHint
                  : key
                    ? t("app.projectStart.template.open", { name: tpl.name, key })
                    : tpl.name}
                onclick={() => pickTemplate(tpl)}
                oncontextmenu={(ev) => openTplMenu(ev, tpl)}
              >
                <TemplatePreview root={tpl.root} width={64} height={40} />
                <span class="tmain">
                  <span class="tnameline"
                    ><span class="tname">{tpl.name}</span>{#if isArmed}<span class="tcheck" aria-hidden="true">✓</span>{/if}</span
                  >
                  <span class="tsum">{templateSummary(tpl.root)}</span>
                </span>
                {#if key}<span class="letter"><Keys combo={key} size="sm" /></span>{/if}
              </button>
            {/if}
          {/each}
        </div>
        {#if armedTpl}
          <p class="thint" role="status" data-start-template-hint>{armedHint}</p>
        {/if}
      </section>
    {/if}

    <!-- ── 지난 대화 · 이 워크트리 ── -->
    <section class="sec" aria-labelledby="pstart-past-{paneId}" data-start-past>
      {#if chips.length > 1}
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
        {#if !conversationsError()}<p class="quiet" data-start-loading>{t("board.convo.loading")}</p>{/if}
      {:else if convos.length === 0}
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
              <span class="logo" title={aiDisplayName(s.agent) ?? s.agent}><AiGlyph name={s.agent} size={16} /></span>
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
                      onchat={chatOf(s) === "hidden" ? undefined : () => chat(s)}
                      chatBlocked={chatBlockedOf(s)}
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

    <!-- ── 바닥 줄 ── -->
    <footer class="keys" data-start-keys>
      {#if convos.length > 0}
        <span><Keys combo="↑↓" /> {t("app.projectStart.keys.move")}</span>
        <span><Keys combo="Enter" /> {t("board.convo.resume")}</span>
        {#if chatOn}<span data-start-chat-key><Keys combo="Alt+Enter" /> {t("board.convo.openChat")}</span>{/if}
        <span><Keys combo="Shift+Enter" /> {t("board.convo.fork")}</span>
        {#if forkHereSel}<span class="here"><Keys combo="Ctrl+Shift+Enter" /> {t("app.folderConvos.forkHere")}</span>{/if}
        <span><Keys combo="V" /> {t("app.projectStart.keys.view")}</span>
      {/if}
      {#if chips.length > 1}
        <span><Keys combo="Tab" /> {t("app.projectStart.keys.scope")}</span>
      {/if}
      {#if templates.length > 0}
        <span data-start-keys-templates
          ><Keys combo={templates.length > 1 ? `1–${Math.min(templates.length, TEMPLATE_KEYS)}` : "1"} />
          {t("app.projectStart.keys.templates")}</span
        >
      {/if}
      {#if letters.length > 0}
        <span>{#each letters as letter, i (i)}{#if i > 0}<span class="keycap-sep">{" "}</span>{/if}<Keys combo={letter} />{/each} {t("app.projectStart.new")}</span>
      {/if}
    </footer>
  </div>
</div>

{#if tplMenu}
  <div class="tpl-portal" use:portal>
    <button
      type="button"
      class="tpl-backdrop"
      tabindex="-1"
      aria-label={t("files.menu.close.aria")}
      onclick={closeTplMenu}
      oncontextmenu={(ev) => {
        ev.preventDefault();
        closeTplMenu();
      }}
    ></button>
    <div
      class="tpl-menu menu-surface"
      role="menu"
      tabindex="-1"
      aria-label={t("app.tabTemplates.menu.aria")}
      data-start-template-menu
      style:left="{tplMenu.x}px"
      style:top="{tplMenu.y}px"
      bind:this={tplMenuEl}
      onkeydown={tplMenuKeydown}
    >
      <button
        type="button"
        class="menu-row"
        role="menuitem"
        data-tpl-act="rename"
        onclick={() => runOnMenu(() => tplMenu?.id, closeTplMenu, (id) => {
          tplRenaming = id;
        })}
        >{t("app.tabTemplates.menu.rename")}</button
      >
      <div class="menu-sep" role="separator"></div>
      <button
        type="button"
        class="menu-row"
        role="menuitem"
        data-tpl-act="delete"
        onclick={() => runOnMenu(() => tplMenu?.id, closeTplMenu, (id) => void deleteTabTemplate(id))}
        >{t("app.tabTemplates.menu.delete")}</button
      >
    </div>
  </div>
{/if}

<style>
  .nameline {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

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

  /* 배경을 칠하지 않는다 — 판은 PaneHost 의 `.pane-box.start` 가 깐다 */
  .pstart {
    position: absolute;
    inset: 0;
    overflow: auto;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    outline: none;
  }

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

  /* 브랜치 기호는 고정폭 글꼴에 없는 경우가 많다 — UI 글꼴로 그린다 */
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

  .pasthead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: 0 0 var(--space-1);
  }

  .pasthead h3 {
    margin: 0;
  }

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

  /* 강조색은 쓰지 않는다(강조색은 셋뿐). `--surface-tile` 은 터미널 테마 색이라 크롬 글자와 갈린다(docs/log/2026-10-01-field-surface.md) */
  .act.default {
    background: var(--surface-raised);
    border-color: var(--line-strong);
  }

  .letter {
    flex: 0 0 auto;
    display: inline-flex;
  }

  /* ── 지난 대화 ── */
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

  .crow.selected {
    background: var(--accent-soft);
  }

  /* 줄 자체가 아니라 내용 칸만 흐린다 — 줄에 opacity 를 걸면 그 안에서 뜨는 ⋯ 메뉴(`ConvoRowActions`)까지 반투명해진다 */
  .crow.inert > :not(.racts) {
    opacity: 0.6;
  }

  /* 지우는 중 — 자리는 그대로 두고 내용만 흐린다(칸이 뛰지 않게) */
  .crow.deleting > :not(.racts) {
    opacity: 0.45;
  }

  /* 포커스가 고른 줄을 따라다니므로 링을 겹쳐 그리지 않는다 — 선택은 판이 말한다 */
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

  /* 강조색이 아니라 경고색 — 주 동작이 아니라 조심하라는 표시 */
  .pill.elsewhere {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }

  .pill.side {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

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

  /* ── 템플릿 ── */
  .tcards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .tcard {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    font-family: inherit;
    font-size: var(--t-sm);
    text-align: left;
    color: var(--fg-1);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius-surface-inner);
    cursor: pointer;
  }

  .tcard:hover {
    background: var(--surface-hover);
    border-color: var(--line-strong);
  }

  .tcard:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .tcard.renaming {
    cursor: default;
  }

  /* 고른 템플릿 — 앱의 고른 칩 · 줄과 같은 판 + 설정 카드의 "지금 쓰는 것" 과 같은 강조 테두리 */
  .tcard.armed,
  .tcard.armed:hover {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .tcard.armed:hover {
    background: var(--control-sel-bg-hover);
  }

  .tcard.armed .tsum {
    color: var(--control-sel-fg);
    opacity: 0.8;
  }

  .tnameline {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  .tcheck {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 999px;
    font-size: 10px;
    line-height: 1;
    color: var(--control-on-fg);
    background: var(--control-on-bg);
  }

  /* 화면 읽기 프로그램에만 — 눈에는 고른 카드의 툴팁(사용자 결정) */
  .thint {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .tmain {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tname,
  .tsum {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tsum {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .tpl-portal {
    display: contents;
  }

  /* `ImageMenu` 와 같은 층 */
  .tpl-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .tpl-menu {
    position: fixed;
    z-index: 106;
    min-width: 170px;
    max-width: 260px;
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
