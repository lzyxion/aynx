<script lang="ts">
  import { openHereFirst } from "$lib/project-locations";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import { projectMarkers } from "$lib/app/project-locations.svelte.js";
  import { tick, untrack } from "svelte";
  import { dockKind } from "$lib/app/dock.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import ProjectMenu from "$lib/browser/ProjectMenu.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { fuzzyMatch } from "$lib/hosts";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { settings, setHostSort } from "$lib/settings.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
  import { dockAgentPanes, dockProjectFolders } from "$lib/app/dock-dots.svelte.js";
  import { projectDots, worktreeDotKey } from "$lib/dock-dots";
  import { isUnbornHead } from "$lib/repo-status";
  import { worktreeChangesOf } from "$lib/app/worktree-changes.svelte.js";
  import { changeBadgeMerged, changeBadgeParts, changeBadgeText, changeBadgeTitle } from "$lib/worktree-changes";
  import { openBranchGraph } from "$lib/app/branch-graph.svelte.js";
  import {
    accordion,
    createDeferredClick,
    nestRows,
    plainClick,
    treeMotion,
    type TreeNode,
  } from "$lib/browser/tree-accordion";
  import "$lib/browser/dock-tree.css";
  import {
    isRemote,
    PROJECT_DRAG_TYPE,
    projectTail,
    projectTreeRows,
    sortProjects,
    worktreeLabel,
    type Project,
    type ProjectTreeRow,
    type WorktreeInfo,
  } from "$lib/projects";
  import {
    confirmRemoveProject,
    confirmRemoveWorktree,
    expandedProjects,
    initProjectRepo,
    loadWorktrees,
    openProject,
    openProjectForm,
    openProjectHere,
    openProjectWorktreeHere,
    openProjectWorktree,
    projects,
    refreshProjects,
    refreshShownWorktrees,
    restoreExpandedProjects,
    setProjectExpanded,
    worktreesOf,
  } from "$lib/app/projects.svelte.js";

  // ---------------------------------------------------------------------------
  // **프로젝트 독** — 저장소 폴더 목록 (docs/log/2026-09-24-projects.md).
  //
  // 처음(2026-09-24 첫 조각)에는 호스트 독 홈 맨 위의 **가짜 폴더**였다. 써 본 사용자의 말이
  // "프로젝트는 호스트 독에 속하지 않는다" 였고 그대로다: 호스트 독은 `~/.ssh/config` 의 거울
  // (폴더 = 그룹, 드래그 = 이동·접속)이라, 그 문법이 하나도 통하지 않는 줄이 섞이면 가드만
  // 늘어난다(드롭·붙여넣기·폴더 추가를 막는 넷). 그래서 **자기 독**을 얻었다 — 같은 층
  // (`Dock.svelte`)의 셋째 형제이고 `Ctrl+Shift+J` 로 여닫는다.
  //
  // 모양은 `HostList` 를 본떴다: 줄 = 아이콘 · 이름 · 위치 배지(`로컬` 또는 호스트
  // 별칭) · 폴더 꼬리 · (오른쪽 끝) 펼침 꺾쇠, 펼친 프로젝트는 아이들과 한 묶음 판(2026-10-19). **두 켜 트리**다(docs/log/2026-09-24-worktrees.md "독의 트리" — 사용자
  // 피드백 "워크트리가 메뉴 안에서만 보인다"): 프로젝트를 펼치면 그 아래 워크트리 줄들이 선다.
  // 새 워크트리는 아이 줄이 아니라 **프로젝트 줄 오른쪽의 `+`** 다(2026-09-25 — 사용자 요청 "맨 아래
  // + 새 워크트리 줄보다 프로젝트 우측의 + 로"). 줄의 모양·순서 규칙은 순수 층의 `projectTreeRows`
  // 하나다. 선택은
  // **한 줄**이다(여럿을 한꺼번에 여는 몸짓이 아직 없다 — 호스트 독의 선택 제어기를 빌리지 않은 이유).
  //
  // 키: ↑↓ 줄 이동(워크트리 줄도 지난다 — 안내 줄은 건너뛴다) · → 펼치기(펼쳐져 있으면 첫 아이로)
  // · ← 접기(아이 줄이면 부모로) · Enter 열기(워크트리 줄은 새 탭) · Ctrl+Enter 새 탭에서 열기 ·
  // F2 편집(프로젝트 줄만) ·
  // Insert 새 워크트리(그 줄의 프로젝트 — `+` 와 같은 이름 칸) · Delete 삭제(로컬 워크트리 줄은 제거
  // 확인) · Escape 는 선택 → 검색어 → (독 닫기).
  // 검색 칸에서 친 키도 이 뿌리가 듣는다(호스트 독과 같은 한 벌 규칙) — 단 ←→ 는 글자 사이를
  // 오가는 키라 검색 칸에서는 건드리지 않는다.
  // ---------------------------------------------------------------------------

  let query = $state("");
  let searchEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 고른 줄의 키 (`ProjectTreeRow.key` — 프로젝트 줄은 id 그대로, `null` = 없음) */
  let selected = $state<string | null>(null);
  /**
   * 검색어를 치는 동안은 목록이 늦게 도착해도(워크트리를 처음 읽는 중) 첫 줄을 골라 둔다 —
   * Escape 로 선택을 벗긴 뒤에는 다시 고르지 않는다(한 겹씩 벗는 규칙이 산다).
   */
  let autoPick = $state(false);
  /**
   * 열린 우클릭 메뉴 — `project: null` 이면 빈 배경 메뉴, `worktree` 가 있으면 워크트리 줄 메뉴,
   * `ask` 면 프로젝트 줄의 `+`(또는 Insert)가 연 이름 칸(프로젝트 메뉴의 그 항목과 **같은 상자**).
   */
  let menu = $state<{
    project: Project | null;
    worktree?: WorktreeInfo;
    primary?: boolean;
    ask?: boolean;
    x: number;
    y: number;
  } | null>(null);

  restoreExpandedProjects();

  /**
   * 정렬 버튼을 따른 프로젝트 순서 (`[hosts] sort` 를 호스트 독과 나눠 쓴다 — `sortProjects` 주석).
   * "지금 워크스페이스에 열린 것 먼저"(`openHereFirst`)는 **최근순에서만** 건다 — 이름순 위에 걸면 글자순이 깨져 보인다
   * (2026-10-20 사용자 보고 "글자순 정렬이 안 된다"). 이름순에서 열린 것은 줄의 표식(`open-here`)이 말한다.
   */
  const ordered = $derived.by(() => {
    const sorted = sortProjects(projects(), settings.hostSort, hostHistory());
    return settings.hostSort === "recent" ? openHereFirst(sorted, (p) => projectMarkers(p).here) : sorted;
  });

  /** 그릴 줄들 — 펼침·검색·워크트리 사본을 한데 접은 꼴 */
  const rows = $derived(projectTreeRows(ordered, query, expandedProjects(), worktreesOf, fuzzyMatch));

  /** 고를 수 있는 줄 — 안내 한 줄(읽는 중·접속 전·실패)은 건너뛴다 */
  const pickable = $derived(rows.filter((r) => r.kind !== "note"));

  /** 지금 커서가 선 줄 — 목록에서 사라졌으면(검색·삭제·접힘) 없는 것으로 본다 */
  const current = $derived(pickable.find((r) => r.key === selected) ?? null);

  /**
   * 워크트리를 **읽을 때** — 펼친 프로젝트 중 아직 안 읽은 것(독이 처음 뜰 때 저장된 펼침을
   * 채운다), 그리고 검색어가 있으면 안 읽은 **모든** 프로젝트(검색이 워크트리 이름을 훑으려면
   * 목록이 있어야 한다). 한 번 읽은 것은 다시 읽지 않는다 — 다시 읽기는 펼침·새로고침·만들기/
   * 지우기의 몫이다(시계 없음).
   */
  $effect(() => {
    const searching = query.trim() !== "";
    const open = expandedProjects();
    for (const p of projects()) {
      if (worktreesOf(p.id) !== undefined) continue;
      if (searching || open.has(p.id)) void loadWorktrees(p);
    }
  });

  /**
   * **보이게 될 때 · 창이 돌아올 때 다시 읽기** (docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md) — 이 목록은 독 안에
   * 늘 마운트돼 있고(`hidden` 으로만 숨는다) 보이는지는 `dockKind()` 가 답한다. 프로젝트 칸이 보이게 되는 순간, 그리고 그 칸이
   * 보이는 채로 창이 `focus` 를 받을 때(셸에서 병합하고 돌아온 순간) 펼친 프로젝트를 다시 읽는다. 거름(3초 · 읽는 중 ·
   * 원격은 붙은 세션만)은 `refreshShownWorktrees` 안이다. 시계는 없다.
   */
  const projectsShown = $derived(dockKind() === "projects");
  $effect(() => {
    if (projectsShown) untrack(() => refreshShownWorktrees());
  });
  $effect(() => {
    const onFocus = () => {
      if (dockKind() === "projects") refreshShownWorktrees();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  });

  /** 검색 중 고를 첫 줄 — 워크트리 때문에 저절로 펼친 프로젝트면 그 첫 워크트리(곧바로 Enter) */
  function firstPick(): string | null {
    const first = pickable[0];
    if (!first) return null;
    if (first.kind === "project" && first.auto) return pickable[1]?.key ?? first.key;
    return first.key;
  }

  $effect(() => {
    if (autoPick && query.trim() !== "" && current === null) selected = firstPick();
  });

  /** 검색어가 바뀌면 첫 줄을 고른다 — 치고 곧바로 Enter 로 열 수 있게 (팔레트와 같은 감각) */
  function onQueryInput() {
    autoPick = query.trim() !== "";
    selected = autoPick ? firstPick() : null;
  }

  function select(key: string) {
    selected = key;
    void tick().then(() =>
      listEl?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  }

  /** ↑↓ — 끝에서 멈춘다(감싸지 않는다: 호스트 독의 목록 보기와 같은 감각) */
  function move(delta: number) {
    if (pickable.length === 0) return;
    const at = current ? pickable.indexOf(current) : -1;
    const next =
      at < 0 ? (delta > 0 ? 0 : pickable.length - 1) : Math.min(pickable.length - 1, Math.max(0, at + delta));
    const row = pickable[next];
    if (row) select(row.key);
  }

  /**
   * 줄 클릭·→·← 의 한 문 — 펼침 상태는 `app/projects` 가 저장한다(창을 건너 남는다). 사람이 바꾼 자리라 그 판만 움직인다
   * (`treeMotion` — 검색의 저절로 펼침은 이 문을 지나지 않는다).
   */
  function setOpen(p: Project, open: boolean) {
    if (expandedProjects().has(p.id) !== open) treeMotion.mark(`project:${p.id}`);
    setProjectExpanded(p, open);
  }

  /** 그리는 꼴 — 펼친 프로젝트 아래 워크트리 · 안내 줄을 둥지로 접는다(판 하나 = 프로젝트 줄 + 아이들) */
  const tree = $derived(nestRows(rows, (r) => (r.kind === "project" ? 0 : 1)));

  /**
   * **한 번 누르기 = 펼치기/접기, 두 번 누르기 = 열기**(2026-10-19 — 판 펼침). 고르기는 곧바로, 펼침은
   * `CLICK_TOGGLE_DELAY_MS` 미뤘다가 그사이 두 번 누르기가 오지 않았을 때만 한다(두 번 누르기는 지금 탭에 열고 펼침은 그대로).
   * 두 번 누르기의 둘째 누르기(`detail` 2)는 걸지 않는다. Ctrl · Shift 누르기는 고르기만.
   */
  const deferredToggle = createDeferredClick();
  $effect(() => () => deferredToggle.cancel());

  function clickProject(ev: MouseEvent, key: string) {
    selected = key;
    if (!plainClick(ev) || ev.detail > 1) return;
    deferredToggle.schedule(() => {
      // 그사이 목록이 바뀌었을 수 있다 — 지금의 줄로 다시 본다. 검색이 저절로 펼친 줄은 건드리지 않는다
      const row = rows.find((r) => r.key === key);
      if (row?.kind === "project" && !row.auto) setOpen(row.project, !row.expanded);
    });
  }

  /**
   * 에이전트 점 (docs/log/2026-09-27-dock-agent-dots.md) — 워크트리 줄은 그 폴더에 **있는**(셸의 지금 폴더,
   * 모르면 시작 폴더 — 겹치면 가장 깊은 폴더) AI 타일들을, **접힌** 프로젝트 줄은 제 워크트리들의 점을 탭 점과
   * 같은 규칙으로 접는다. 원격은 그 서버의 홈으로 `~` 를 펴서 맞댄다(`~/api` 타일 ≡ git 의 `/root/api` 줄) —
   * 홈이 도착하면 `remoteHomeOf` 가 반응형이라 점이 저절로 다시 선다. 점은 보기만 한다(누름 없음).
   */
  const dots = $derived(projectDots(dockAgentPanes(), dockProjectFolders(), remoteHomeOf, t));

  function openRowMenu(ev: MouseEvent, row: ProjectTreeRow) {
    ev.preventDefault();
    ev.stopPropagation();
    selected = row.key;
    if (row.kind === "worktree")
      menu = { project: row.project, worktree: row.worktree, primary: row.primary, x: ev.clientX, y: ev.clientY };
    else menu = { project: row.project, x: ev.clientX, y: ev.clientY };
  }

  /**
   * **새 워크트리** — 프로젝트 줄의 `+`·Insert. 프로젝트 메뉴의 "새 워크트리에서 열기…" 와 **같은
   * 상자**(`ProjectMenu` 의 이름 칸)를 **프로젝트 줄** 바로 아래에 연다. 이름 검사·자리 미리 보기·
   * 만들기가 한 길이다. 펼침은 건드리지 않는다 — 상자는 떠 있는 층이라 접힌 줄 아래에도 그대로 서고,
   * 만든 뒤 새 탭이 열리므로 트리를 펼쳐 보여 줄 까닭이 없다(펼친 채면 만든 뒤 다시 읽어 줄이 선다).
   */
  function openAsk(p: Project) {
    selected = p.id;
    const el = listEl?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(p.id)}"]`);
    const r = el?.getBoundingClientRect();
    menu = { project: p, ask: true, x: r ? r.left : 40, y: r ? r.bottom + 2 : 40 };
  }

  /** 이름 칸이 지금 이 프로젝트에 열려 있는가 — 그동안은 그 줄의 `+` 를 계속 보인다 */
  const askingFor = $derived(menu?.ask ? (menu.project?.id ?? null) : null);

  function openBgMenu(ev: MouseEvent) {
    ev.preventDefault();
    menu = { project: null, x: ev.clientX, y: ev.clientY };
  }

  function closeMenu() {
    menu = null;
  }

  /** 독의 "새로고침" — 프로젝트 목록과, 이미 읽어 둔 워크트리 목록들을 다시 읽는다 */
  async function reloadAll() {
    await refreshProjects();
    for (const p of projects()) if (worktreesOf(p.id) !== undefined) void loadWorktrees(p);
  }

  /** 즐겨찾기(하단 독)로 끄는 짐 — 호스트 짐과 **다른 종류**라 터미널 타일·폴더 줄은 이것을 보지 않는다 */
  function startDrag(ev: DragEvent, p: Project) {
    const dt = ev.dataTransfer;
    if (!dt) return;
    dt.setData(PROJECT_DRAG_TYPE, p.id);
    dt.setData("text/plain", p.path);
    dt.effectAllowed = "copy";
  }

  /** 줄의 뜻대로 연다 — 프로젝트는 지금 탭에, 워크트리는 새 탭에 */
  function activate(row: ProjectTreeRow) {
    if (row.kind === "project") void openProject(row.project);
    else if (row.kind === "worktree") void openProjectWorktree(row.project, row.worktree);
  }

  function onKeydown(ev: KeyboardEvent) {
    // IME 조합 중(한글 입력)에는 방향키·Enter 가 변환용이므로 가로채지 않는다
    if (ev.isComposing || ev.keyCode === 229) return;
    // 우클릭 메뉴가 떠 있으면 키는 그쪽 것이다 (메뉴가 Escape·↑↓ 를 이미 쓴다).
    if (menu) return;
    const target = ev.target as HTMLElement | null;
    const inSearch = target !== null && target === searchEl;
    // `Ctrl+Enter` — 고른 프로젝트·워크트리를 지금 탭의 활성 타일 옆에 연다.
    // Enter는 기존 위치 포커스 또는 새 탭이다. 검색 칸에서도 통한다.
    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && ev.key === "Enter") {
      if (!current) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (current.kind === "project") void openProjectHere(current.project);
      else if (current.kind === "worktree") void openProjectWorktreeHere(current.project, current.worktree);
      return;
    }
    // 나머지 수식 조합은 앱 전역의 것이다(`Ctrl+Shift+J` 로 이 독을 닫는 것 포함) — 손대지 않는다.
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    // 툴바 버튼 위의 Enter·Space 는 그 버튼을 누르는 키다.
    const tag = target?.tagName;
    if (tag === "BUTTON" && !target?.dataset.rowKey && (ev.key === "Enter" || ev.key === " ")) return;

    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      move(1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      move(-1);
    } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      // 검색 칸에서는 글자 사이를 오가는 키다.
      if (inSearch || !current) return;
      ev.preventDefault();
      if (current.kind === "project") {
        if (ev.key === "ArrowRight") {
          // 펼쳐져 있으면 첫 아이로, 아니면 펼친다 (파일 탐색기 트리의 관례)
          if (current.expanded) {
            const next = pickable[pickable.indexOf(current) + 1];
            if (next && next.kind !== "project") select(next.key);
          } else setOpen(current.project, true);
        } else if (current.expanded && !current.auto) setOpen(current.project, false);
      } else if (ev.key === "ArrowLeft") {
        select(current.project.id); // 아이 줄의 ← 는 부모 줄로
      }
    } else if (ev.key === "Enter") {
      if (!current) return;
      ev.preventDefault();
      activate(current);
    } else if (ev.key === "F2") {
      // 이름을 고치는 키는 프로젝트 줄에만 뜻이 있다(워크트리 이름은 git 브랜치다).
      if (current?.kind !== "project") return;
      ev.preventDefault();
      openProjectForm(current.project);
    } else if (ev.key === "Insert") {
      // 새 워크트리 — 줄의 `+` 와 같은 이름 칸. 워크트리 줄에서 누르면 그 부모 프로젝트의 것이다.
      // (맨 Insert 는 전역 키바인딩에 없다 · 검색 칸에서도 글자를 바꾸지 않는 키라 양보하지 않는다)
      if (!current) return;
      ev.preventDefault();
      openAsk(current.project);
    } else if (ev.key === "Delete") {
      // 검색 칸에서는 글자를 지우는 키다 (호스트 독과 같은 양보 규칙)
      if (inSearch || !current) return;
      if (current.kind === "project") {
        ev.preventDefault();
        ev.stopPropagation();
        void confirmRemoveProject(current.project);
      } else if (current.kind === "worktree" && !current.primary) {
        // 둘째 줄부터(로컬·원격) — 메뉴의 `제거…` 와 같은 확인을 지난다 (주 폴더는 git 이 지우지 않는다)
        ev.preventDefault();
        ev.stopPropagation();
        confirmRemoveWorktree(current.project, current.worktree);
      }
    } else if (ev.key === "Escape") {
      // 선택 → 검색어 순으로 한 겹씩 벗고, 벗을 것이 없으면 올려보낸다(독이 닫는다).
      if (selected !== null) {
        ev.preventDefault();
        ev.stopPropagation();
        selected = null;
        autoPick = false;
      } else if (query !== "") {
        ev.preventDefault();
        ev.stopPropagation();
        query = "";
        autoPick = false;
      }
    }
  }

  /**
   * **검색 칸에 커서를 둔다** — 독이 열리는 순간 부른다(호스트 독의 `focusSearch` 와 같은 뜻:
   * 여는 몸짓의 뜻이 대개 "그 프로젝트를 찾아 열겠다" 다). 글자까지 고른다.
   */
  export function focusSearch(): void {
    searchEl?.focus({ preventScroll: true });
    searchEl?.select();
  }
</script>

<!--
  뿌리가 키를 듣는다 — 검색 칸에서 친 키도 버블링으로 여기까지 온다(규칙은 한 벌).
  `role="presentation"` 은 호스트 트리의 뿌리와 같은 규칙이다(껍데기일 뿐 뜻은 안쪽에 있다).
-->
<div class="projects" role="presentation" tabindex="-1" data-project-dock onkeydown={onKeydown}>
  <!--
    검색 줄 — 런처 독 세 칸이 같은 모양으로 맨 위에 세우는 줄(`Dock.svelte` 의 `.dock-search` ·
    docs/log/2026-09-25-unified-dock.md). 칸 오른쪽에 이 칸의 조작 둘(정렬 · 프로젝트 추가)이 선다.
  -->
  <div class="dock-search">
    <label class="dock-search-box">
      <UiIcon name="search" size={14} />
      <input
        class="search"
        type="search"
        bind:value={query}
        bind:this={searchEl}
        oninput={onQueryInput}
        placeholder={t("app.projects.search.placeholder")}
        aria-label={t("app.projects.search.aria")}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <!--
      정렬 — 호스트 독과 **같은 칸**(`[hosts] sort`)이다. 지금 순서의 그림을 보인다(누르면 저쪽).
    -->
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      title={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-label={settings.hostSort === "recent" ? t("app.hosts.sort.recent") : t("app.hosts.sort.name")}
      aria-pressed={settings.hostSort === "recent"}
      data-project-sort={settings.hostSort}
      onclick={() => setHostSort(settings.hostSort === "recent" ? "name" : "recent")}
      ><UiIcon name={settings.hostSort === "recent" ? "sort-recent" : "sort-name"} size={14} /></button
    >
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      data-project-add
      title={t("app.projects.add.project")}
      aria-label={t("app.projects.add.project")}
      onclick={() => openProjectForm()}><UiIcon name="plus" size={14} /></button
    >
  </div>

  <!--
    본문 — 빈 곳 우클릭은 배경 메뉴(프로젝트 추가 · 새로고침).
    a11y: 이 상자에 role 을 주지 않는다 — 배경은 비어 있음 그 자체가 대상이다(호스트 독과 같다).
  -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="body" oncontextmenu={openBgMenu}>
    {#if projects().length === 0}
      <p class="empty" data-project-empty>{t("app.projects.empty")}</p>
    {:else if rows.length === 0}
      <p class="empty">{t("app.projects.noMatch")}</p>
    {:else}
      <ul class="list" aria-label={t("app.projects.list.aria")} bind:this={listEl}>
        {@render branch(tree)}
      </ul>
    {/if}
  </div>

  <!-- 줄들은 편 꼴(`rows`)로 오고, 그리기는 둥지 꼴(`nestRows`)이다 — 펼친 프로젝트와 그 아이들이 한 묶음 판으로 선다 -->
  {#snippet branch(nodes: TreeNode<ProjectTreeRow>[])}
        {#each nodes as node (node.row.key)}
          {@const row = node.row}
          {#if row.kind === "project"}
            {@const p = row.project}
            {@const remote = isRemote(p)}
            {@const opened = projectMarkers(p)}
            {@const motionKey = `project:${p.id}`}
            <!--
              프로젝트 줄 — 아이콘 → 이름 → 위치 배지(`로컬` 또는 호스트 별칭) → (오른쪽 끝) 폴더 꼬리 →
              `+`(새 워크트리) → 펼침 꺾쇠. 한 번 클릭 = 선택 + (잠깐 뒤) **펼치기/접기**, 더블클릭·Enter = **열기**
              (지금 탭에 · 펼침은 그대로), 우클릭 = 프로젝트 메뉴. 끌기는 **즐겨찾기(하단 독)로만** 뜻이 있다(`PROJECT_DRAG_TYPE`).
            -->
            <li class="dtree-node" class:open={row.expanded} class:still={!treeMotion.allows(motionKey)}>
              <button
                type="button"
                class="item"
                class:selected={selected === row.key}
                data-project-id={p.id}
                data-row-key={row.key}
                aria-expanded={row.expanded}
                title={remote ? `${p.host}:${p.path}` : p.path}
                draggable="true"
                ondragstart={(ev) => startDrag(ev, p)}
                onclick={(ev) => clickProject(ev, row.key)}
                ondblclick={() => {
                  deferredToggle.cancel();
                  void openProject(p);
                }}
                oncontextmenu={(ev) => openRowMenu(ev, row)}
              >
                <span class="line">
                  <span class="lead"><ProjectIcon project={p} size={ROW_ICON_PX} /></span>
                  <span class="name-cell">
                    <span class="name">{p.name}</span>
                    {#if opened.here}
                      <span class="open-here" data-project-open-here title={t("app.projects.badge.openHere")}>
                        <UiIcon name="layout" size={12} label={t("app.projects.badge.openHere")} />
                      </span>
                    {/if}
                    {#if !row.expanded && dots.project[p.id]}
                      {@const pdot = dots.project[p.id]}
                      <!-- 접힌 프로젝트 줄 — 워크트리들의 점을 하나로 (펼치면 워크트리 줄로 내려간다) -->
                      <AgentStatusGlyph
                        state={pdot.state}
                        data-agent-dot={pdot.state}
                        data-project-dot={p.id}
                        title={pdot.label}
                        aria-label={pdot.label}
                      />
                    {/if}
                    <span class="where" class:remote>{remote ? p.host : t("app.projects.badge.local")}</span>
                  </span>
                  {#if opened.badge}<span class="open-elsewhere" data-project-open-elsewhere>{opened.badge}</span>{/if}
                  <span class="hint">{projectTail(p.path)}</span>
                  <!--
                    새 워크트리 `+` — 화살표와 같은 까닭으로 줄 단추 **안**의 조각이고, 클릭·더블클릭을
                    여기서 멈춰 줄의 선택·열기·펼침과 섞이지 않는다. 키보드 길은 Insert(와 프로젝트
                    메뉴의 "새 워크트리에서 열기…"). 줄에 손이 올라갔거나 · 골랐거나 · 이 줄의 이름 칸이
                    떠 있을 때만 보인다(레이아웃 독의 `⋯`·파일 목록의 손잡이와 같은 규칙 — 평소엔 이름이
                    주인공이다). 원격은 접속 전이어도 선다 — 첫 입력이 만든다(뺀 "+" 줄과 같은 조건).
                  -->
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                  <span
                    class="row-add"
                    class:open={askingFor === p.id}
                    data-worktree-add={p.id}
                    title={`${t("app.projects.tree.add")} (Insert)`}
                    aria-label={t("app.projects.tree.add")}
                    onclick={(ev) => {
                      ev.stopPropagation();
                      openAsk(p);
                    }}
                    ondblclick={(ev) => ev.stopPropagation()}
                    ><UiIcon name="plus" size={12} /></span
                  >
                  <!-- 펼침 꺾쇠 — 줄 오른쪽 끝, 펼치면 위로 돈다. 그림일 뿐 누름은 줄의 것이다(키보드 길은 →·←) -->
                  <span
                    class="dtree-chev"
                    data-project-twisty
                    aria-hidden="true"
                    title={row.expanded ? t("app.projects.tree.collapse") : t("app.projects.tree.expand")}
                    ><UiIcon name="chevron-down" size={14} /></span
                  >
                </span>
              </button>
              {#if node.children.length > 0}
                <ul class="dtree-kids" transition:accordion={{ key: motionKey }}>
                  {@render branch(node.children)}
                </ul>
              {/if}
            </li>
          {:else if row.kind === "worktree"}
            {@const w = row.worktree}
            {@const opened = projectMarkers(row.project, w.path)}
            {@const label = worktreeLabel(w)}
            {@const dot = dots.worktree[worktreeDotKey(row.project.id, w.path)]}
            {@const changes = row.primary ? undefined : worktreeChangesOf(row.project.id, w.path)}
            {@const badge = changeBadgeParts(changes)}
            {@const merged = changeBadgeMerged(changes)}
            <!--
              워크트리 줄 — 왼쪽 폴더 이름 바로 옆에 열림 아이콘·에이전트 점을 둔다.
              주 폴더는 이름을 굵게 하고 `주 폴더` 표식을 붙인다. 브랜치(없으면 `분리된 HEAD`)는 항상 맨 오른쪽이다.
              툴팁은 온전한 경로. 더블클릭·Enter = **새 탭에서** 열기(워크트리마다 탭 하나 — 탭 점이
              뭉개지지 않게), 우클릭 = 워크트리 메뉴.
            -->
            <li class="dtree-node">
              <button
                type="button"
                class="item child"
                class:selected={selected === row.key}
                data-row-key={row.key}
                data-worktree-row={w.path}
                data-worktree-parent={row.project.id}
                title={t("app.projects.worktrees.open.title", { path: w.path })}
                onclick={() => (selected = row.key)}
                ondblclick={() => void openProjectWorktree(row.project, w)}
                oncontextmenu={(ev) => openRowMenu(ev, row)}
              >
                <span class="line">
                  <span class="name-cell">
                    <span class="branch" class:primary={row.primary}>{label.tail}</span>
                    {#if opened.here}
                      <span class="open-here" data-worktree-open-here title={t("app.projects.badge.openHere")}>
                        <UiIcon name="layout" size={12} label={t("app.projects.badge.openHere")} />
                      </span>
                    {/if}
                    {#if dot}
                      <AgentStatusGlyph
                        state={dot.state}
                        data-agent-dot={dot.state}
                        title={dot.label}
                        aria-label={dot.label}
                      />
                    {/if}
                    {#if row.primary}
                      <span class="where" data-worktree-primary>{t("app.projects.worktrees.primary")}</span>
                    {/if}
                  </span>
                  {#if row.primary && isUnbornHead(w.head)}
                    <!-- 커밋 없는 저장소 — 새 워크트리(+)는 첫 커밋부터 권한다(고아 브랜치를 막는다) -->
                    <span class="where" data-worktree-nocommit>{t("app.projects.worktrees.noCommit")}</span>
                  {/if}
                  {#if opened.badge}<span class="open-elsewhere" data-worktree-open-elsewhere>{opened.badge}</span>{/if}
                  {#if badge.length > 0 || merged}
                    <!--
                      변경 배지 — main 과의 merge-base 이후 커밋한 더한/뺀 줄(+ 연한 초록 · − 연한 빨강)과 main 보다 앞선
                      커밋(↑ 회색) (docs/log/2026-09-29-worktree-badges.md 의 10-04 절). 커밋이 모두 main 에 들어갔으면 숫자
                      대신 회색 칩 "병합됨" 하나. 커밋 안 한 변경은 세지 않는다(그래프의 ✎ 줄). 주 폴더 줄에는 달지 않는다.
                      **누르면 브랜치 그래프**(그 브랜치를 고른 채 — docs/log/2026-09-29-branch-graph.md). 줄 단추 **안**의
                      조각이라(단추 안에 단추를 둘 수 없다) 화살표 · `+` 와 같이 클릭 · 더블클릭을 여기서 멈춘다. 키보드 길은
                      워크트리 줄 우클릭 메뉴의 "브랜치 그래프" 다.
                    -->
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <span
                      class="changes"
                      class:merged
                      data-worktree-changes={merged ? "merged" : changeBadgeText(badge)}
                      title={`${changeBadgeTitle(changes, t)}\n${t("app.projects.worktrees.changes.open")}`}
                      onclick={(ev) => {
                        ev.stopPropagation();
                        selected = row.key;
                        openBranchGraph(row.project, w.branch);
                      }}
                      ondblclick={(ev) => ev.stopPropagation()}
                      >{#if merged}{t("app.projects.worktrees.changes.merged")}{:else}{#each badge as part, i (part.kind)}{#if i > 0}{" "}{/if}<span
                            class="part {part.kind}">{part.sym}{part.n}</span
                          >{/each}{/if}</span
                    >
                  {/if}
                  {#if merged && !row.primary}
                    <!--
                      [정리] — 병합된 워크트리를 끝내는 길(워크트리 = 브랜치 1:1, docs/log/2026-10-05-worktree-one-to-one.md).
                      메뉴의 "제거…" · Delete 와 **같은 확인 상자**(`confirmRemoveWorktree`)를 연다 — "브랜치도 삭제" 칸은 그
                      흐름이 정한 대로, 자동으로 지우는 것은 없다. 원격은 붙은 세션이 있어야 한다(없으면 그 흐름의 알림 한 줄).
                      배지와 같은 까닭으로 줄 단추 **안**의 조각이라 클릭 · 더블클릭을 여기서 멈춘다(키보드 길은 Delete).
                    -->
                    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                    <span
                      class="cleanup"
                      data-worktree-cleanup
                      title={t("app.projects.worktrees.cleanup.title")}
                      onclick={(ev) => {
                        ev.stopPropagation();
                        selected = row.key;
                        confirmRemoveWorktree(row.project, w);
                      }}
                      ondblclick={(ev) => ev.stopPropagation()}>{t("app.projects.worktrees.cleanup")}</span
                    >
                  {/if}
                  <span class="hint">{label.branch ?? t("app.projects.worktrees.detached")}</span>
                  <!-- 프로젝트 줄의 꺾쇠 칸만큼 비운다 — 오른쪽 끝 글자들이 세로로 맞는다 -->
                  <span class="dtree-chev-pad" aria-hidden="true"></span>
                </span>
              </button>
            </li>
          {:else if row.note === "notRepo"}
            <!--
              git 저장소가 아니다 — 오류 한 줄 대신 무엇이 없는지와 할 수 있는 일(docs/log/2026-09-28-project-create.md).
              줄 자체는 고를 수 없고(↑↓ 가 건너뛴다) 단추만 누른다. 누르면 `git init` + 빈 첫 커밋 뒤 목록을 다시 읽는다.
            -->
            <li class="note repo-note" data-worktree-note="notRepo">
              <span>{t("app.projects.worktrees.notRepo")}</span>
              <button
                type="button"
                class="btn btn-secondary note-btn"
                data-repo-init={row.project.id}
                onclick={() => void initProjectRepo(row.project)}>{t("app.projects.worktrees.init")}</button
              >
            </li>
          {:else}
            <!-- 안내 한 줄 — 누를 수 없고 고를 수도 없다 (↑↓ 가 건너뛴다) -->
            <li
              class="note"
              class:error={row.note === "error"}
              data-worktree-note={row.note}
              title={row.note === "error" ? (row.message ?? "") : undefined}
            >
              {row.note === "loading"
                ? t("app.projects.worktrees.loading")
                : row.note === "offline"
                  ? t("app.projects.worktrees.offline")
                  : row.message}
            </li>
          {/if}
        {/each}
  {/snippet}

  {#if menu}
    <ProjectMenu
      project={menu.project}
      worktree={menu.worktree ?? null}
      primary={menu.primary ?? false}
      ask={menu.ask ?? false}
      x={menu.x}
      y={menu.y}
      onclose={closeMenu}
      onreload={() => void reloadAll()}
    />
  {/if}
</div>

<style>
  .open-here {
    display: inline-flex;
    align-items: center;
    width: 12px;
    height: 12px;
    color: var(--fg-2);
    flex-shrink: 0;
  }
  .open-elsewhere { color: var(--fg-3); font-size: var(--t-xs); white-space: nowrap; }
  .projects {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* 재질 글래스면 판은 독 상자가 칠하고 여기는 비운다(`--glass-inner`) */
    background: var(--glass-inner, var(--surface-raised-solid));
    user-select: none;
  }

  .projects:focus {
    outline: none;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  /* 줄의 치수는 호스트 목록과 **같은 토큰**이다 (`theme.css` 의 `--row-*`) — 두 독이 한 벌로 읽힌다 */
  .list {
    margin: 0;
    padding: var(--row-inset);
    list-style: none;
  }

  .item {
    display: block;
    width: 100%;
    padding: var(--row-pad-y) var(--row-pad-x);
    text-align: left;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .item:hover {
    background: var(--surface-hover);
  }

  /* 고른 줄 — 이 화면의 유일한 강조 판이다 (명세의 "강조 셋" 중 하나) */
  .item.selected {
    background: var(--accent-soft);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    min-width: 0;
  }

  .lead {
    flex: 0 0 var(--row-icon);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
  }

  .name-cell {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .name {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--row-font);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
   * 위치 — 이름 곁의 뒷글자(12 · 흐림). 예전의 칩 판은 걷었다(2026-09-25 — 목업의 "meta 12px
   * fg-3"). 원격은 한 단 진하게(`--fg-2`) 서서 로컬과 갈린다 — 강조색 판은 고른 줄의 몫이라
   * 여기서 쓰지 않는다 (docs/log/2026-09-25-unified-dock.md).
   */
  .where {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .where.remote {
    color: var(--fg-2);
  }

  /* 폴더 꼬리 — 오른쪽 끝, 흐림 (온전한 경로는 줄의 툴팁) */
  .hint {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
   * 새 워크트리 `+` — 줄 오른쪽 끝. 자리는 늘 비워 두므로(투명할 뿐) 나타났다 사라져도 폴더 꼬리가
   * 밀리지 않는다(`FileList` 의 손잡이와 같은 규칙). 보이지 않을 때는 **잡히지도 않는다** — 투명한
   * 채로 눌리면 유령 단추가 된다.
   */
  .row-add {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: var(--fg-3);
    border-radius: var(--radius-sm);
    opacity: 0;
    pointer-events: none;
    transition: opacity 90ms ease;
  }

  .item:hover .row-add,
  .item.selected .row-add,
  .item:focus-visible .row-add,
  .row-add.open {
    opacity: 1;
    pointer-events: auto;
  }

  .row-add:hover,
  .row-add.open {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /*
   * 워크트리 줄 — 펼침 판 안에서 14px 들여 선다(호스트 · DB 트리의 한 단과 같은 값).
   * 한 켜 아래라는 것을 판과 들여쓰기로 말한다 — 이음선은 긋지 않는다(두 켜뿐이다).
   */
  .item.child {
    padding-left: calc(var(--row-pad-x) + 14px);
  }

  .branch {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--row-font);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 주 폴더(= 저장소 자신)는 굵게 — 곁의 `주 폴더` 표식과 함께 "지울 수 없는 줄" 로 읽힌다 */
  .branch.primary {
    font-weight: 600;
  }

  /* 주 폴더를 포함해 모든 워크트리의 브랜치는 맨 오른쪽에 둔다. */
  .item.child .hint {
    margin-left: auto;
  }

  /*
   * 변경 배지 — 칩 바탕 없이 모노 글꼴 글자만. GitHub 식 `+84 −19` 는 사용자 결정으로 색을 다시 들였지만 **연하게**:
   * `--ok`·`--err` 를 흐린 글자색(`--fg-3`)에 섞어 채도를 낮춘다(상태 점보다 튀지 않게 — 토큰이라 라이트/다크 둘 다 따라간다).
   * `↑` 는 회색 그대로. 누르면 브랜치 그래프다(2단계) — 손가락 커서 · 누를 자리임을 말하는 옅은 판(hover).
   */
  .changes {
    flex: 0 0 auto;
    padding: 0 3px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--fg-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    white-space: nowrap;
  }

  .changes:hover {
    background: var(--surface-hover);
    color: var(--fg-2);
  }

  .changes .plus {
    color: color-mix(in srgb, var(--ok) 70%, var(--fg-3));
  }

  .changes .minus {
    color: color-mix(in srgb, var(--err) 70%, var(--fg-3));
  }

  /* 병합됨 — 숫자 자리에 작은 회색 칩(색은 주 행동 · 선택 줄 · 입력 대기 점에만 쓴다). 같은 자리 · 같은 글자 크기. */
  .changes.merged {
    border: 1px solid var(--line);
    color: var(--fg-2);
    font-family: var(--font-ui);
  }

  /* [정리] — 병합됨 칩 옆의 작은 글자 단추. 줄을 누르지 않게 조용히(흐린 글자, 호버에만 면) — 칩보다 튀지 않는다. */
  .cleanup {
    flex: none;
    padding: 0 3px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--fg-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    white-space: nowrap;
  }

  .cleanup:hover {
    background: var(--surface-hover);
    color: var(--fg-1);
  }

  /* 안내 한 줄 (읽는 중 · 접속 후 표시됩니다 · git 의 실패 한 줄) — 흐리게, 한 줄로 */
  .note {
    padding: var(--row-pad-y) var(--row-pad-x);
    padding-left: calc(var(--row-pad-x) + 14px);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note.error {
    color: var(--err);
  }

  /* 저장소가 아닌 프로젝트 — 사실 한 줄 + 단추 하나 (줄은 접히지 않게 두 줄로 선다) */
  .note.repo-note {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    color: var(--fg-2);
    white-space: normal;
  }

  .note-btn {
    height: 24px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
  }

  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /*
   * MD3 목록 줄(2026-10-18 — End-4 식 목업) — **독 안에서만**(`.dock.launcher`): 줄은 알약(`--radius-row` — 2026-10-29 C안, 펼침 판 안에서도 같은 알약) · 호버는 상태 층 · 고른 줄은
   * secondaryContainer(`--accent-soft`) + onSecondaryContainer. 앞자리는 28px 칸이고, 프로젝트 줄은 원형 아바타
   * (--m3-secondary-container). 오른쪽 보조 글자는 outlineVariant 테두리의 보조 칩이다.
   */
  :global(.dock.launcher) .item {
    border-radius: var(--radius-row);
  }

  :global(.dock.launcher) .item:hover {
    background: color-mix(in srgb, var(--fg-1) var(--state-hover), transparent);
  }

  /* 재질 글래스면 고른 줄 = 흰 반투명 칠(`--glass-pick` — theme.css 재질 절, 평면은 없어 그대로) */
  :global(.dock.launcher) .item.selected {
    color: var(--on-accent-soft);
    background: var(--glass-pick, var(--accent-soft));
  }

  :global(.dock.launcher) .lead {
    flex-basis: 28px;
    height: 28px;
  }

  :global(.dock.launcher) .item:not(.folder, .child) > .line > .lead {
    border-radius: 50%;
    color: var(--m3-on-secondary-container);
    background: var(--m3-secondary-container);
  }

  :global(.dock.launcher) :is(.where) {
    padding: 1px 8px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
</style>
