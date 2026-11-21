<script lang="ts">
  import { workspaceList, workspaceMainWindow } from "$lib/app/workspaces.svelte.js";
  import { canDeleteWorkspace } from "$lib/workspaces/sidebar";
  import { untrack } from "svelte";
  import {
    fuzzyMatch,
    hostLabel,
    hostMeta,
    hostSearchText,
    hostsInGroup,
    type GroupMeta,
    type HostEntry,
  } from "$lib/hosts";
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import { folderIcon, iconRef } from "$lib/host-icons";
  import {
    CONVERSATION_QUERY_WORDS,
    conversationMatches,
    conversationQuery,
    type ConversationPaletteEntry,
  } from "$lib/agent-sessions";
  import type { UsagePaletteEntry } from "$lib/agent-usage";
  import {
    ACTIONS,
    actionLabel,
    comboFromEvent,
    displayCombo,
    effectiveCombo,
    type Overrides,
  } from "$lib/keybindings";
  import { locale, t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { tabDisplayTitle, type TabSpec } from "$lib/session";
  import UiIcon from "$lib/UiIcon.svelte";
  import { DOCK_ACTION_ICONS, LAUNCHER_SEGMENTS } from "$lib/dock";
  import { chatDockAvailable } from "$lib/app/chat-dock.svelte.js";
  import { placeDefaultPalette, type CanvasRect } from "$lib/launcher";
  import {
    looksLikeAddress,
    parseQuickConnect,
    quickConnectLabel,
    type QuickConnectTarget,
  } from "$lib/quick-connect";
  import {
    shouldOfferSave,
    snippetSaveLabel,
    SNIPPET_QUERY_PREFIX,
    type SnippetPaletteEntry,
  } from "$lib/snippets";
  import {
    historyPaletteEntries,
    relativeTime,
    HISTORY_QUERY_PREFIX,
    type HistoryEntry,
  } from "$lib/history-search";
  import { blockMarkTitle } from "$lib/finish-notify";
  import { isRemote as remoteWindow } from "$lib/app/window.svelte.js";
  import { recentHosts, type HostHistory } from "$lib/host-history";
  import {
    isRemote,
    projectSearchText,
    projectTail,
    sortProjects,
    type Project,
  } from "$lib/projects";
  import type { ThemeProfile } from "$lib/theme-profiles";
  import Keys from "$lib/Keys.svelte";
  import {
    settingsIndexFor,
    settingPath,
    settingSearchText,
    type SettingsIndexEntry,
  } from "$lib/settings-index";

  /**
   * 명령 팔레트 — 아무것도 실행하지 않는다. 고른 것을 콜백으로 올릴 뿐이다 — 그룹 열기 확인 · 접속 지연 같은 규칙은
   * `+page` 에 있고, 여기 다시 적으면 드래그로 연 것과 팔레트로 연 것이 조용히 갈린다.
   */

  let {
    hosts,
    groupMeta = {},
    tabs,
    themeProfiles = [],
    snippets = [],
    history = [],
    hostHistory = {},
    projects = [],
    conversations = [],
    conversationsLoading = false,
    onopenconversation,
    onviewconversation,
    usage = [],
    noAgents = false,
    onopenusage,
    onopenproject,
    onopenprojectnew,
    seed = "",
    mirror = null,
    measureCanvas,
    activeTabId,
    keybindings,
    onclose,
    onconnect,
    onconnectnew,
    onquickconnect,
    onopengroup,
    onapplythemeprofile,
    oninsertsnippet,
    onsavesnippet,
    onmanagesnippets,
    templates = [],
    onopentemplate,
    onmanagetemplates,
    oninserthistory,
    onselecttab,
    onrunaction,
    onopensetting,
  }: {
    hosts: HostEntry[];
    groupMeta?: Record<string, GroupMeta>;
    tabs: TabSpec[];
    themeProfiles?: readonly ThemeProfile[];
    snippets?: readonly SnippetPaletteEntry[];
    history?: readonly HistoryEntry[];
    hostHistory?: HostHistory;
    projects?: readonly Project[];
    conversations?: readonly ConversationPaletteEntry[];
    conversationsLoading?: boolean;
    onopenconversation?: (agent: string, id: string, fork: boolean) => void;
    onviewconversation?: (agent: string, id: string) => void;
    usage?: readonly UsagePaletteEntry[];
    noAgents?: boolean;
    onopenusage?: () => void;
    onopenproject?: (p: Project) => void;
    onopenprojectnew?: (p: Project) => void;
    /** 열릴 때 한 번만 뜻이 있다(`{#if}` 마운트) — 그 뒤로는 사용자가 친 글자가 주인이다 */
    seed?: string;
    mirror?: string | null;
    /** 없거나 `null` 을 돌려주면 CSS 자리(창 위 12vh 가운데) */
    measureCanvas?: () => CanvasRect | null;
    activeTabId: string | null;
    keybindings: Overrides;
    onclose: () => void;
    onconnect: (host: HostEntry) => void;
    onconnectnew: (host: HostEntry) => void;
    onquickconnect?: (target: QuickConnectTarget) => void;
    onopengroup: (path: string) => void;
    onapplythemeprofile?: (id: string) => void;
    oninsertsnippet?: (id: string) => void;
    onsavesnippet?: (command: string) => void;
    onmanagesnippets?: () => void;
    templates?: readonly { id: string; name: string; detail: string; keywords: string }[];
    onopentemplate?: (id: string) => void;
    onmanagetemplates?: () => void;
    /** `run` 이 참이면 넣고 곧바로 실행(`Shift+Enter`) */
    oninserthistory?: (command: string, run: boolean) => void;
    onselecttab: (tabId: string) => void;
    onrunaction: (id: string) => void;
    onopensetting?: (section: string, anchor: string | null) => void;
  } = $props();

  /**
   * 종류가 한 배열에 섞인다 — 섹션마다 배열을 따로 두면 ↑↓ 이동이 섹션 경계에서 끊긴다. 머리글은 종류가 바뀌는 자리에
   * 서므로 "관리…" · 저장 · 빈 상태 줄은 새 종류로 만들지 않는다(만들면 머리글이 한 번 더 선다).
   */
  type PaletteItem =
    | { kind: "quick"; key: string; target: QuickConnectTarget; label: string }
    | { kind: "host"; key: string; host: HostEntry }
    /** `host` 와 따로 둔 것은 머리글 때문이다. 같은 호스트가 아래 묶음에도 서므로 키 접두사(`r:`)를 달리한다 */
    | { kind: "recent"; key: string; host: HostEntry }
    | { kind: "project"; key: string; project: Project }
    | { kind: "group"; key: string; path: string; count: number }
    | { kind: "tab"; key: string; tab: TabSpec }
    | { kind: "theme"; key: string; profile: ThemeProfile }
    /** `id` 가 `null` 이면 "템플릿 관리…" 줄 */
    | { kind: "template"; key: string; id: string | null; name: string; detail: string }
    /** `id` 가 `null` 이면 "스니펫 관리…" 줄 */
    | {
        kind: "snippet";
        key: string;
        id: string | null;
        label: string;
        detail: string;
        /** 저장 줄이면 저장할 명령 — `id === null` 만으로는 관리 줄과 구분되지 않는다 */
        save?: string;
      }
    /** `command` 가 빈 문자열이면 빈 상태 줄 — 진짜 이력 줄의 명령문은 비지 않는다(`collectHistory` 가 걸러 낸다) */
    | {
        kind: "history";
        key: string;
        command: string;
        tail: string;
        title: string;
        failed: boolean;
        /** 못 읽었거나 실행 중이면 `ok` · `failed` 둘 다 거짓이다 */
        ok: boolean;
      }
    /** `entry` 가 `null` 이면 빈 상태 줄(읽는 중 · 없음) */
    | { kind: "conversation"; key: string; entry: ConversationPaletteEntry | null; tail: string; empty: string }
    | { kind: "usage"; key: string; entry: UsagePaletteEntry }
    | { kind: "action"; key: string; id: string; label: string; combo: string }
    | { kind: "setting"; key: string; entry: SettingsIndexEntry; path: string[] };

  const SECTION_LABEL: Record<PaletteItem["kind"], Key> = {
    quick: "commands.palette.section.quick",
    recent: "commands.palette.section.recent",
    host: "commands.palette.section.host",
    project: "commands.palette.section.project",
    group: "commands.palette.section.group",
    tab: "commands.palette.section.workspace", // i18n 키는 옛 이름 그대로 (docs/conventions.md 용어표)
    theme: "commands.palette.section.theme",
    template: "commands.palette.section.template",
    snippet: "commands.palette.section.snippet",
    history: "commands.palette.section.history",
    conversation: "commands.palette.section.conversation",
    usage: "commands.palette.section.usage",
    action: "commands.palette.section.action",
    setting: "commands.palette.section.setting",
  };

  /** 호스트 수백 개를 DOM 에 올리면 팔레트가 뜨는 첫 프레임이 늦다 */
  const MAX_ITEMS = 40;

  /** 독의 그림을 그대로 빌린다 — 표를 여기 다시 적으면 한쪽만 고치는 사고가 난다 */
  const ACTION_ICON = new Map([
    ...DOCK_ACTION_ICONS,
    ...LAUNCHER_SEGMENTS.map((s) => [s.action ?? s.paletteId ?? "", s.icon] as const),
  ]);

  let query = $state(untrack(() => seed));
  /** 읽을 때 `sel` 로 죈다 — 여기에 죄어 넣으면 질의를 지웠을 때 커서가 엉뚱한 곳에 남는다 */
  let selRaw = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  let vw = $state(0);
  let vh = $state(0);
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const canvas = measureCanvas?.() ?? null;
    return canvas ? placeDefaultPalette(canvas, vw, vh) : null;
  });

  /**
   * 거울 모드 — launcher 의 숨은 입력칸이 IME 조합을 쥔 동안 입력칸은 포커스를 가져가지 않는다
   * (조합 중에 포커스가 옮겨 가면 Chromium 이 조합을 취소한다).
   */
  $effect(() => {
    if (mirror !== null) query = mirror;
  });

  $effect(() => {
    if (mirror !== null || !inputEl) return;
    inputEl.focus();
    const end = inputEl.value.length;
    inputEl.setSelectionRange(end, end);
  });

  /** `;`(`SNIPPET_QUERY_PREFIX`)는 `Ctrl+Shift+;` 가 찍은 채 여는 글자다 */
  const parsed = $derived.by(() => {
    // 낱말 접두사(`대화 ` · `conv `)가 먼저다 — 글자 하나 접두사와 겹치지 않는다.
    const convo = conversationQuery(query);
    if (convo !== null) return { scope: "conv", q: convo };
    const raw = query.trimStart();
    const head = raw[0];
    if (
      head === ">" ||
      head === "@" ||
      head === "#" ||
      head === SNIPPET_QUERY_PREFIX ||
      head === HISTORY_QUERY_PREFIX
    ) {
      return { scope: head, q: raw.slice(1).trim() };
    }
    return { scope: "", q: raw.trim() };
  });

  function wants(kind: PaletteItem["kind"]): boolean {
    const s = parsed.scope;
    // 이력 · 지난 대화는 접두사가 있어야 선다 — 수백 줄이 호스트 · 명령 줄을 파묻는다
    if (s === "") return kind !== "history" && kind !== "conversation";
    if (s === "conv") return kind === "conversation";
    if (s === ">") return kind === "action" || kind === "setting";
    if (s === "@") return kind === "tab";
    if (s === SNIPPET_QUERY_PREFIX) return kind === "snippet";
    if (s === HISTORY_QUERY_PREFIX) return kind === "history";
    return kind === "group";
  }

  /**
   * 이미 있는 별칭이거나 걸리는 호스트 · 프로젝트가 있으면(주소처럼 보이면 예외) 서지 않는다 — 맨 위에 서므로
   * `web` 까지 친 순간 Enter 한 번이 엉뚱한 곳(설정을 안 쓰는 접속)으로 간다.
   */
  const quickTarget = $derived.by((): QuickConnectTarget | null => {
    if (parsed.scope !== "") return null;
    const q = parsed.q;
    if (q === "") return null;
    if (hosts.some((h) => h.name.toLowerCase() === q.toLowerCase())) return null;
    if (!looksLikeAddress(q) && hosts.some((h) => fuzzyMatch(q, hostSearchText(h)))) return null;
    if (!looksLikeAddress(q) && projects.some((p) => fuzzyMatch(q, projectSearchText(p)))) return null;
    return parseQuickConnect(q);
  });

  /** 같은 등급 안에서는 `~/.ssh/config` 등장 순서가 남는다(안정 정렬) — 파일을 고쳐 순서를 정할 수 있어야 한다 */
  function hostRank(h: HostEntry, q: string): number {
    if (q === "") return 2;
    const name = h.name.toLowerCase();
    const needle = q.toLowerCase().replace(/\s+/g, "");
    if (name === needle) return 0;
    if (name.startsWith(needle)) return 1;
    return 2;
  }

  /** 조상 경로까지 — 빼면 `#prod` 로 딱 그 폴더를 열 수 없다 */
  const groupPaths = $derived.by(() => {
    const out = new Set<string>();
    for (const h of hosts) {
      const g = (hostMeta(h).group ?? "").trim();
      if (g === "") continue;
      const segs = g.split("/").filter((s) => s.trim() !== "");
      let acc = "";
      for (const seg of segs) {
        acc = acc === "" ? seg : `${acc}/${seg}`;
        out.add(acc);
      }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  });

  /** 파일 타일 층(`scope: "files"`)은 뺀다 — 실행은 그 타일의 키 처리가 하고, 팔레트가 열리면 타일이 포커스를 잃는다 */
  const paletteActions = $derived(
    ACTIONS.filter((a) => a.scope !== "files" && a.id !== "command-palette" && !/^workspace-[1-9]$/.test(a.id)
      && (!["switch-workspace", "next-workspace", "prev-workspace"].includes(a.id) || workspaceMainWindow())
      && (a.id !== "ai-panel" || !noAgents)
      // 채팅 독은 주 창에만 있다(보조 창 · 원격 창에는 독이 마운트되지 않는다)
      && (a.id !== "open-chat-dock" || chatDockAvailable())
      // 끝내기 · 원격 파일 편집은 메인 PC 전용이다
      && (a.id !== "quit-app" || !remoteWindow)
      && (a.id !== "edit-remote" || !remoteWindow)),
  );

  /** 단축키 레지스트리에 없는 명령 — 남은 `Ctrl+Shift` 글자가 없어서다. 조합 칸만 빈다 */
  const PALETTE_ONLY: readonly { id: string; key: Key }[] = [
    { id: "branch-graph", key: "commands.palette.action.branchGraph" },
    { id: "open-db", key: "commands.palette.action.openDb" },
    { id: "open-alerts-dock", key: "commands.palette.action.alertsDock" },
    // 탭 템플릿 · 설정 옮기기 — 전역 단축키는 두지 않는다
    { id: "save-tab-template", key: "commands.palette.action.saveTemplate" },
    { id: "export-settings", key: "commands.palette.action.exportSettings" },
    { id: "import-settings", key: "commands.palette.action.importSettings" },
    { id: "new-workspace", key: "app.workspaces.new" },
    { id: "rename-workspace", key: "app.workspaces.edit" },
    { id: "delete-workspace", key: "app.workspaces.delete" },
    // 오케스트레이션 — 키바인딩 없음(id 결정은 사용자 몫)
    { id: "orchestration-start", key: "orch.start.openAiTile" },
    { id: "orchestration-board", key: "orch.palette.board" },
  ];

  /** 영문 id 도 훑는다 — 한국어 화면에서도 `>set` 이 "설정 열기" 를 찾게(팔레트를 치는 손은 대개 영문 자판이다) */
  function actionSearchText(id: string, label: string): string {
    return `${label} ${id}`;
  }

  const items = $derived.by(() => {
    const q = parsed.q;
    const out: PaletteItem[] = [];

    if (quickTarget) {
      const target = quickConnectLabel(quickTarget);
      out.push({
        kind: "quick",
        key: `q:${target}`,
        target: quickTarget,
        label: t("commands.palette.quick.row", { target }),
      });
    }

    if (query.trim() === "") {
      for (const h of recentHosts(hosts, hostHistory)) {
        out.push({ kind: "recent", key: `r:${h.name}`, host: h });
      }
    }

    if (wants("host")) {
      const matched = hosts.filter((h) => fuzzyMatch(q, hostSearchText(h)));
      const ranked = matched
        .map((h, i) => ({ h, rank: hostRank(h, q), i }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i);
      for (const { h } of ranked) out.push({ kind: "host", key: `h:${h.name}`, host: h });
    }

    // 호스트 뒤 — 같은 글자가 둘에 걸리면 익숙한 쪽(호스트)이 먼저 서야 Enter 가 놀라지 않는다
    if (wants("project")) {
      for (const p of sortProjects(projects, "name", {})) {
        if (!fuzzyMatch(q, projectSearchText(p))) continue;
        out.push({ kind: "project", key: `p:${p.id}`, project: p });
      }
    }

    if (wants("group")) {
      for (const path of groupPaths) {
        if (!fuzzyMatch(q, path)) continue;
        out.push({
          kind: "group",
          key: `g:${path}`,
          path,
          count: hostsInGroup(hosts, path).length,
        });
      }
    }

    if (wants("tab")) {
      for (const tab of tabs) {
        if (!fuzzyMatch(q, tabDisplayTitle(tab, t))) continue;
        out.push({ kind: "tab", key: `w:${tab.id}`, tab });
      }
    }


    if (wants("theme")) {
      for (const profile of themeProfiles) {
        if (!fuzzyMatch(q, `${t("commands.palette.section.theme")} ${profile.name}`)) continue;
        out.push({ kind: "theme", key: `t:${profile.id}`, profile });
      }
    }

    if (wants("template")) {
      const words = t("commands.palette.template.keywords");
      for (const e of templates) {
        if (!fuzzyMatch(q, `${words} ${e.keywords}`)) continue;
        out.push({ kind: "template", key: `tpl:${e.id}`, id: e.id, name: e.name, detail: e.detail });
      }
      const manage = t("commands.palette.template.manage");
      if (fuzzyMatch(q, `${manage} ${t("commands.palette.template.manageKeywords")}`)) {
        out.push({ kind: "template", key: "tpl:manage", id: null, name: manage, detail: t("commands.palette.template.manageTail") });
      }
    }

    if (wants("snippet")) {
      const snippetWord = t("commands.palette.section.snippet");
      for (const e of snippets) {
        if (!fuzzyMatch(q, `${snippetWord} ${e.keywords}`)) continue;
        out.push({
          kind: "snippet",
          key: `s:${e.id}`,
          id: e.id,
          label: t("commands.palette.snippet.row", { name: e.name }),
          detail: e.detail,
        });
      }
      // 저장 줄은 `;` 접두사를 요구한다 — 검색 결과가 아니라 만드는 조작이라 매 질의마다 서면 시끄럽다
      const known = snippets.map((s) => s.command);
      if (parsed.scope === SNIPPET_QUERY_PREFIX && shouldOfferSave(q, known)) {
        out.push({
          kind: "snippet",
          key: "s:save",
          id: null,
          label: t("commands.palette.snippet.save", { command: snippetSaveLabel(q) }),
          detail: t("commands.palette.snippet.saveTail"),
          save: q,
        });
      }
      // 관리 줄은 위가 하나도 없어도 선다 — 스니펫이 없는 사람에게 만들러 갈 길이 남게
      const manage = t("commands.palette.snippet.manage");
      if (fuzzyMatch(q, `${manage} ${t("commands.palette.snippet.manageKeywords")}`)) {
        out.push({
          kind: "snippet",
          key: "s:manage",
          id: null,
          label: manage,
          detail: t("commands.palette.snippet.manageTail"),
        });
      }
    }

    if (wants("history")) {
      const now = Date.now();
      for (const e of historyPaletteEntries(q, history, fuzzyMatch)) {
        out.push({
          kind: "history",
          key: `!:${e.command}`,
          command: e.command,
          tail: t("commands.palette.history.tail", {
            pane: e.paneLabel,
            when: relativeTime(e.startedAt, now, t),
          }),
          title: blockMarkTitle(
            { commandLine: e.command, startedAt: e.startedAt, endedAt: e.endedAt, exit: e.exit },
            t,
          ),
          failed: e.exit !== null && e.exit !== 0,
          ok: e.exit === 0,
        });
      }
      // 이력이 통째로 비었을 때만 — 질의에 안 걸린 것(`palette.empty`)과 다른 사실이다
      if (history.length === 0) {
        out.push({
          kind: "history",
          key: "!:empty",
          command: "",
          tail: "",
          title: "",
          failed: false,
          ok: false,
        });
      }
    }

    if (wants("conversation")) {
      const now = Date.now();
      for (const e of conversations) {
        // 부분 글자 — 부분수열이면 긴 제목이 거의 다 걸린다(`conversationMatches` 주석)
        if (!conversationMatches(q, e)) continue;
        const state =
          e.state === "open"
            ? t("commands.palette.conversation.open")
            : e.state === "missing"
              ? t("commands.palette.conversation.missing")
              : relativeTime(e.updatedAt, now, t);
        out.push({ kind: "conversation", key: `c:${e.key}`, entry: e, tail: `${e.scope} · ${state}`, empty: "" });
      }
      if (conversations.length === 0) {
        out.push({
          kind: "conversation",
          key: "c:empty",
          entry: null,
          tail: "",
          empty: t(conversationsLoading ? "commands.palette.conversation.loading" : "commands.palette.conversation.empty"),
        });
      }
    }

    // 사용량 — 찾는 중일 때만(빈 질의에서 늘 서면 명령 줄을 민다)
    if (wants("usage") && q !== "") {
      const words = t("commands.palette.usage.keywords");
      for (const e of usage) {
        if (!fuzzyMatch(q, `${e.label} ${words}`)) continue;
        out.push({ kind: "usage", key: e.key, entry: e });
      }
    }

    if (wants("action")) {
      for (const a of paletteActions) {
        const name = actionLabel(a.id);
        const label = t(name.key, name.params);
        if (!fuzzyMatch(q, actionSearchText(a.id, label))) continue;
        out.push({
          kind: "action",
          key: `a:${a.id}`,
          id: a.id,
          label,
          combo: displayCombo(effectiveCombo(a.id, keybindings)),
        });
      }
      for (const a of PALETTE_ONLY) {
        if (a.id.endsWith("-workspace") && !workspaceMainWindow()) continue;
        // 설정 옮기기는 원격 창에 없다 — 메인 PC 의 파일 대화상자를 연다
        if (remoteWindow && (a.id === "export-settings" || a.id === "import-settings")) continue;
        const label = t(a.key);
        if (!fuzzyMatch(q, actionSearchText(a.id, label))) continue;
        out.push({ kind: "action", key: `a:${a.id}`, id: a.id, label, combo: "" });
      }
    }

    // 설정은 빈 질의에서 안 뜬다 — 예순 줄이 명령 줄을 `MAX_ITEMS` 에서 잘라 낸다
    if (wants("setting") && q !== "") {
      const tr = (k: Key) => t(k);
      const root = t("commands.palette.setting.root");
      for (const entry of settingsIndexFor(remoteWindow)) {
        if (!fuzzyMatch(q, `${root} ${settingSearchText(entry, tr)}`)) continue;
        out.push({
          kind: "setting",
          key: `set:${entry.section}:${entry.anchor ?? ""}`,
          entry,
          path: [root, ...settingPath(entry, tr)],
        });
      }
    }

    return out.slice(0, MAX_ITEMS);
  });

  const sel = $derived(items.length === 0 ? -1 : Math.min(selRaw, items.length - 1));

  $effect(() => {
    void query;
    selRaw = 0;
  });

  $effect(() => {
    const i = sel;
    if (i < 0 || !listEl) return;
    const row = listEl.querySelectorAll<HTMLElement>("[data-row]")[i];
    row?.scrollIntoView({ block: "nearest" });
  });

  function isSectionHead(i: number): boolean {
    return i === 0 || items[i - 1].kind !== items[i].kind;
  }

  /** 대화 줄의 `Ctrl` = 기록 보기 — 재개와 달리 경로가 사라진 대화(`missing`)에서도 된다 */
  function viewIfAsked(item: PaletteItem, ev: { ctrlKey: boolean; shiftKey: boolean }): boolean {
    if (item.kind !== "conversation" || item.entry === null || !ev.ctrlKey || ev.shiftKey || !onviewconversation) {
      return false;
    }
    const { agent, id } = item.entry;
    onclose();
    onviewconversation(agent, id);
    return true;
  }

  function workspaceDeleteDisabled(item: PaletteItem): boolean {
    return item.kind === "action" && item.id === "delete-workspace" && !canDeleteWorkspace(workspaceList().length);
  }

  function run(item: PaletteItem, alt = false) {
    if (workspaceDeleteDisabled(item)) return;
    // 빈 상태 줄은 닫지도 않는다 — 팔레트가 닫히면 사람은 자기가 무언가를 실행한 줄 안다
    if (item.kind === "history" && item.command === "") return;
    if (item.kind === "conversation" && (item.entry === null || item.entry.state === "missing")) return;
    onclose();
    switch (item.kind) {
      case "quick":
        onquickconnect?.(item.target);
        break;
      case "host":
      case "recent":
        if (alt) onconnectnew(item.host);
        else onconnect(item.host);
        break;
      case "project":
        if (alt) onopenprojectnew?.(item.project);
        else onopenproject?.(item.project);
        break;
      case "group":
        onopengroup(item.path);
        break;
      case "tab":
        onselecttab(item.tab.id);
        break;
      case "theme":
        onapplythemeprofile?.(item.profile.id);
        break;
      case "template":
        if (item.id === null) onmanagetemplates?.();
        else onopentemplate?.(item.id);
        break;
      case "snippet":
        if (item.save !== undefined) onsavesnippet?.(item.save);
        else if (item.id === null) onmanagesnippets?.();
        else oninsertsnippet?.(item.id);
        break;
      case "history":
        oninserthistory?.(item.command, alt);
        break;
      case "conversation":
        if (item.entry) onopenconversation?.(item.entry.agent, item.entry.id, alt);
        break;
      case "usage":
        onopenusage?.();
        break;
      case "action":
        onrunaction(item.id);
        break;
      case "setting":
        onopensetting?.(item.entry.section, item.entry.anchor ?? null);
        break;
    }
  }

  /** 이력 · 대화는 `Shift` 만 — 실행 여부가 걸린 자리라 모르는 조합을 "실행" 쪽으로 읽지 않는다 */
  function isVariant(item: PaletteItem, ev: { shiftKey: boolean; ctrlKey: boolean }): boolean {
    if (item.kind === "history" || item.kind === "conversation") return ev.shiftKey;
    if (item.kind === "host" || item.kind === "recent" || item.kind === "project") {
      return ev.shiftKey || ev.ctrlKey;
    }
    return false;
  }

  /** 적힌 조합이 곧 `isVariant` 가 받는 조합이어야 한다 */
  function variantHint(item: PaletteItem): { mod: string; label: string } | null {
    if (item.kind === "history") {
      return item.command === "" ? null : { mod: "Shift", label: t("commands.palette.history.hint.shiftEnter") };
    }
    if (item.kind === "project") return { mod: "Ctrl", label: t("commands.palette.hint.here") };
    if (item.kind === "host" || item.kind === "recent") {
      return { mod: "Ctrl", label: t("commands.palette.hint.newTab") };
    }
    if (item.kind === "conversation" && (item.entry?.state === "ok" || item.entry?.state === "elsewhere")) {
      return { mod: "Shift", label: t("commands.palette.conversation.hint.shiftEnter") };
    }
    return null;
  }

  /** 창 전역 단축키는 입력칸 포커스 동안 `isEditableTarget` 에 막혀 오지 않는다 — 팔레트를 닫는 조합(토글)은 여기서 본다 */
  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬이 뒤이어 다른 모달까지 닫지 않게
      onclose();
      return;
    }

    const combo = comboFromEvent(ev);
    if (combo && combo === effectiveCombo("command-palette", keybindings)) {
      ev.preventDefault();
      onclose();
      return;
    }

    const n = items.length;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (n > 0) selRaw = (sel + 1) % n;
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n > 0) selRaw = (sel - 1 + n) % n;
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      const item = items[sel];
      if (item && !viewIfAsked(item, ev)) run(item, isVariant(item, ev));
    }
  }

  /** `!` 동안 Enter 는 넣기만 · `Shift+Enter` 는 넣고 실행이다 — 힌트를 고정해 두면 실행 여부가 화면과 어긋난다 */
  const historyScope = $derived(parsed.scope === HISTORY_QUERY_PREFIX);
  const enterHint = $derived(
    t(
      historyScope
        ? "commands.palette.history.hint.enter"
        : parsed.scope === "conv"
          ? "commands.palette.conversation.hint.enter"
          : "commands.palette.hint.enter",
    ),
  );

  function hostHint(h: HostEntry): string {
    const g = (hostMeta(h).group ?? "").trim();
    return g !== "" ? g : hostLabel(h);
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="overlay"
  class:placed={placed !== null}
  role="presentation"
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) onclose();
  }}
>
  <div
    class="palette glass-raised"
    style={placed
      ? `left:${placed.left}px;top:${placed.top}px;width:${placed.width}px;max-height:${placed.maxHeight}px`
      : undefined}
    role="dialog"
    aria-modal="true"
    aria-label={t("commands.palette.aria")}
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <div class="search">
      <UiIcon name="search" size={16} />
      <input
        class="q"
        type="text"
        bind:this={inputEl}
        bind:value={query}
        placeholder={t("commands.palette.placeholder")}
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        aria-label={t("commands.palette.search.aria")}
      />
    </div>

    <div class="results" bind:this={listEl}>
      {#if items.length === 0}
        <p class="empty">{t("commands.palette.empty")}</p>
      {:else}
        {#each items as item, i (item.key)}
          {#if isSectionHead(i)}
            <p class="section">{t(SECTION_LABEL[item.kind])}</p>
          {/if}
          <button
            type="button"
            data-row
            data-action={item.kind === "action" ? item.id : undefined}
            disabled={workspaceDeleteDisabled(item)}
            data-recent={item.kind === "recent" ? "" : undefined}
            class="row"
            class:sel={i === sel}
            class:inert={workspaceDeleteDisabled(item) || (item.kind === "history" && item.command === "") ||
              (item.kind === "conversation" && (item.entry === null || item.entry.state === "missing"))}
            title={workspaceDeleteDisabled(item) ? t("app.workspaces.deleteDisabled") : item.kind === "history" && item.title !== "" ? item.title : null}
            onmouseenter={() => (selRaw = i)}
            onclick={(ev) => {
              if (!viewIfAsked(item, ev)) run(item, isVariant(item, ev));
            }}
          >
            {#if item.kind === "quick"}
              <span class="lead"><UiIcon name="server" size={14} /></span>
              <span class="label">{item.label}</span>
              <span class="tail">{t("commands.palette.quick.tail")}</span>
            {:else if item.kind === "host" || item.kind === "recent"}
              {@const meta = hostMeta(item.host)}
              <span class="lead">
                <HostIcon icon={meta.icon} size={14} fallback="server" color={meta.color} />
              </span>
              <span class="label">{item.host.name}</span>
              <span class="tail">{hostHint(item.host)}</span>
            {:else if item.kind === "project"}
              <span class="lead"><ProjectIcon project={item.project} size={14} /></span>
              <span class="label">{item.project.name}</span>
              <span class="tail"
                >{isRemote(item.project)
                  ? t("commands.palette.project.tail.remote", {
                      host: item.project.host,
                      tail: projectTail(item.project.path),
                    })
                  : t("commands.palette.project.tail.local", {
                      tail: projectTail(item.project.path),
                    })}</span
              >
            {:else if item.kind === "group"}
              <span class="lead"><HostIcon
                  icon={folderIcon(groupMeta[item.path]?.icon)}
                  size={14}
                  fallback="folder"
                  color={groupMeta[item.path]?.color || null}
                /></span
              >
              <span class="label">{item.path}</span>
              <span class="tail">{t("commands.palette.group.tail", { count: item.count })}</span>
            {:else if item.kind === "tab"}
              <span class="lead"><UiIcon name="tab" size={14} /></span>
              <span class="label">{tabDisplayTitle(item.tab, t)}</span>
              <span class="tail"
                >{item.tab.id === activeTabId ? t("commands.palette.workspace.current") : ""}</span
              >
            {:else if item.kind === "theme"}
              <span class="lead"><UiIcon name="palette" size={14} /></span>
              <span class="label">{t("commands.palette.theme.row", { name: item.profile.name })}</span>
              <span class="tail">{t("commands.palette.theme.tail")}</span>
            {:else if item.kind === "template"}
              <span class="lead"><UiIcon name={item.id === null ? "settings" : "layout"} size={14} /></span>
              <span class="label" data-template-entry={item.id ?? undefined}>{item.name}</span>
              <span class="tail">{item.detail}</span>
            {:else if item.kind === "snippet"}
              <span class="lead">
                <UiIcon
                  name={item.save !== undefined
                    ? "bookmark"
                    : item.id === null
                      ? "settings"
                      : "terminal"}
                  size={14}
                />
              </span>
              <span class="label">{item.label}</span>
              <span class="tail preview" class:mono={item.id !== null}>{item.detail}</span>
            {:else if item.kind === "history"}
              <span class="lead"><UiIcon name="reset" size={14} /></span>
              {#if item.command === ""}
                <span class="label muted">{t("commands.palette.history.empty")}</span>
              {:else}
                <span class="label mono">{item.command}</span>
                {#if item.ok || item.failed}
                  <span class="tail glyph" class:fail={item.failed} aria-hidden="true"
                    >{item.failed ? "✗" : "✓"}</span
                  >
                {/if}
                <span class="tail">{item.tail}</span>
              {/if}
            {:else if item.kind === "conversation"}
              {#if item.entry}
                <span class="lead"><AiGlyph name={item.entry.agent} size={14} /></span>
                <span class="label" class:fallback={item.entry.fallback}>{item.entry.title}</span>
                {#if item.entry.state === "elsewhere"}
                  <span
                    class="elsewhere"
                    data-conversation-elsewhere
                    title={t("board.convo.elsewhere.title", { when: relativeTime(item.entry.updatedAt, Date.now(), t) })}
                    >{t("commands.palette.conversation.elsewhere")}</span
                  >
                {/if}
                <span class="tail">{item.tail}</span>
              {:else}
                <span class="lead"><UiIcon name="reset" size={14} /></span>
                <span class="label muted">{item.empty}</span>
              {/if}
            {:else if item.kind === "usage"}
              <span class="lead"><HostIcon icon={iconRef(item.entry.agent)} size={14} /></span>
              <span class="label" data-usage-entry={item.entry.agent}>{item.entry.label}</span>
            {:else if item.kind === "setting"}
              <span class="lead"><UiIcon name="settings" size={14} /></span>
              <span class="label">{item.path.join(" › ")}</span>
            {:else}
              <span class="lead"
                ><UiIcon
                  name={ACTION_ICON.get(item.id) ?? "command"}
                  size={14}
                /></span
              >
              <span class="label">{item.label}</span>
              <span class="tail">{#if item.combo}<Keys combo={item.combo} />{/if}</span>
            {/if}
            {#if i === sel && !workspaceDeleteDisabled(item) && !(item.kind === "history" && item.command === "") && !(item.kind === "conversation" && (item.entry === null || item.entry.state === "missing"))}
              {@const v = variantHint(item)}
              <span class="keys" data-keys>
                {#if item.kind === "conversation" && item.entry && onviewconversation}
                  <Keys combo="Ctrl+↵" /><span class="kl">{t("commands.palette.conversation.hint.ctrlEnter")}</span>
                {/if}
                {#if v}
                  <Keys combo="{v.mod}+↵" /><span class="kl">{v.label}</span>
                {/if}
                <Keys combo="↵" />
              </span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <div class="foot" data-palette-foot>
      <span class="grp"><Keys combo="↑↓" />{t("commands.palette.foot.move")}</span>
      <span class="grp"><Keys combo="↵" />{enterHint}</span>
      <span class="grp"><Keys combo="Esc" />{t("commands.palette.foot.close")}</span>
      <span class="prefixes">
        <span class="grp"><code>&gt;</code>{t("commands.palette.hint.action")}</span>
        <span class="grp"><code>@</code>{t("commands.palette.hint.tab")}</span>
        <span class="grp"><code>#</code>{t("commands.palette.hint.group")}</span>
        <span class="grp"><code>{SNIPPET_QUERY_PREFIX}</code>{t("commands.palette.hint.snippet")}</span>
        <span class="grp"><code>{HISTORY_QUERY_PREFIX}</code>{t("commands.palette.hint.history")}</span>
        <span class="grp"
          ><code>{CONVERSATION_QUERY_WORDS[locale() === "ko" ? 0 : 1]}</code>{t("commands.palette.hint.conversation")}</span
        >
      </span>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* `+page` 의 `.overlay` 보다 한 단계 위 — Escape 순서도 팔레트가 맨 먼저다 */
    z-index: 110;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh var(--space-4) var(--space-4);
    background: var(--bg-overlay);
    /* 배경색만 페이드 — 막의 `opacity` 는 안쪽 글래스 판의 흐림을 끈다 */
    animation: overlay-fade-in 160ms ease-out;
  }

  .palette {
    transform-origin: 50% 0;
    animation: palette-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  /* 글래스 — `opacity` 대신 판 색 · 선 · 그림자와 내용만 페이드(theme.css `glass-surface-in`) */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-material="glass"]) .palette {
      --glass-in-from: translateY(-8px) scale(0.98);
      animation-name: glass-surface-in;
    }
    :global(:root[data-material="glass"]) .palette > :global(*) {
      animation: glass-content-in 200ms ease-out;
    }
  }

  @keyframes palette-in {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay,
    .palette {
      animation: none;
    }
  }

  /* `.overlay` 의 12vh 가운데는 캔버스를 못 잰 때의 물러설 자리다 */
  .overlay.placed {
    display: block;
    padding: 0;
  }

  .overlay.placed .palette {
    position: absolute;
    max-width: none;
  }

  /* 불투명이다 — 터미널 글자 위에 뜨므로 창 투명도를 내려도 뒤 글자가 비치면 안 된다 */
  .palette {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--palette-w);
    max-height: 70vh;
    overflow: hidden;
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .search {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 48px;
    padding: 0 var(--space-4);
    color: var(--fg-3);
    border-bottom: 1px solid var(--line);
  }

  .q {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    outline: none;
  }

  .q::placeholder {
    color: var(--fg-3);
  }

  .results {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-1) var(--space-2) var(--space-2);
  }

  .section {
    margin: 0;
    padding: var(--space-3) var(--space-3) var(--space-1); /* 좌우 = 줄 안쪽 여백 — 머리글이 줄 아이콘과 같은 x */
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }

  .empty {
    margin: 0;
    padding: var(--space-6) var(--space-2);
    font-size: var(--t-sm);
    text-align: center;
    color: var(--fg-3);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 32px;
    padding: 0 var(--space-3);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .row.sel {
    background: var(--accent-soft);
  }

  .lead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    color: var(--fg-3);
  }


  .row.inert {
    cursor: default;
  }
  .row:disabled {
    opacity: 0.45;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label.mono {
    font-family: var(--font-mono);
  }

  .label.muted {
    color: var(--fg-3);
  }

  .label.fallback {
    color: var(--fg-2);
    font-style: italic;
  }

  .tail {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .elsewhere {
    flex: 0 0 auto;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    border-radius: 999px;
  }

  .tail.glyph {
    line-height: 1;
  }

  .tail.glyph.fail {
    color: var(--err);
  }

  /* `.tail` 은 줄지 않는 칸이라 긴 명령 미리보기 하나가 이름을 밀어낸다 — 줄의 절반까지만 */
  .tail.preview {
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keys {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .keys .kl {
    margin-right: var(--space-2);
  }

  /* 접두사는 칩이 아니라 글자 하나 — 칩이면 560px 바닥 줄이 넘친다 */
  .foot code {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .foot {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: 36px;
    padding: 0 var(--space-4);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    border-top: 1px solid var(--line);
    overflow: hidden;
  }

  .foot .grp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* 좁으면 이쪽이 먼저 잘린다(키 셋이 먼저다) */
  .prefixes {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
  }
</style>
