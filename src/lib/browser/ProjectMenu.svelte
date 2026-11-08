<script lang="ts">
  import { tick } from "svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { hasSetupScript, isRemote, worktreePreview, type Project, type WorktreeInfo } from "$lib/projects";
  import {
    confirmRemoveProject,
    confirmRemoveWorktree,
    openProject,
    openProjectForm,
    openProjectHere,
    openProjectInNewWorktree,
    openProjectWorktree,
    openProjectWorktreeHere,
    installRemoteHooks,
    removeRemoteHooks,
    revealWorktree,
    runProjectSetupScript,
    worktreeNameError,
  } from "$lib/app/projects.svelte.js";
  import { hookTargets, loadHookTargets } from "$lib/app/agent-hooks.svelte.js";
  import { openBranchGraph } from "$lib/app/branch-graph.svelte.js";
  import { openDiff } from "$lib/app/diff-view.svelte.js";
  import { startOrchestrationHere } from "$lib/app/orchestration.svelte.js";
  // 맡기기 사본을 아직 읽지 않았으면 메뉴가 뜰 때 한 번(3차 6단계 — "이 저장소에서 AI 타일 열기" 줄이 그 사본으로 선다).
  import { worktreesOf } from "$lib/app/worktrees.svelte.js";
  import { currentWorkspaceId, workspaceList } from "$lib/app/workspaces.svelte.js";
  import { projectLocations, revealProjectLocation } from "$lib/app/project-locations.svelte.js";
  import { openBranchDelete, readAddPreview } from "$lib/app/worktree-branch.svelte.js";
  import {
    defaultRow,
    rowKey,
    rowSelectable,
    stepSelectableRow,
    worktreeRows,
    type AddPreview,
    type WorktreeRow,
  } from "$lib/worktree-add";

  /**
   * **프로젝트 독의 우클릭 메뉴** (docs/log/2026-09-24-projects.md · docs/log/2026-09-24-worktrees.md).
   *
   * 예전에는 호스트 독의 `HostMenu` 안에 `menu.kind === "project"` 갈래로 살았다. 프로젝트가
   * 자기 독(`ProjectList`)으로 나오면서(사용자 피드백 2026-09-24 — "프로젝트는 호스트 독에 속하지
   * 않는다") 메뉴도 따라 나왔다. 상자 모양·클래스는 `HostMenu` 와 **같은 값**이라 두 독의 메뉴가
   * 한 벌로 보인다(`.menu-backdrop` · `role="menu"` 라 독의 바깥 클릭 판정도 그대로 산다).
   *
   * 대상은 넷이다: 빈 배경(`project === null` — 추가·새로고침) · 프로젝트 한 줄 · 그 아래
   * 워크트리 한 줄(`worktree` 가 있다) · "새 워크트리" 이름 묻기(`ask` — 프로젝트 메뉴의 항목과
   * 독 트리의 프로젝트 줄 `+`·Insert 가 **같은 상자**를 연다 — 2026-09-25 전에는 "+ 새 워크트리…" 아이 줄).
   *
   * `워크트리 ▸` 옆목록은 **뺐다**(2026-09-24 — 워크트리가 독의 트리로 나왔다). 이 메뉴는 독에서만
   * 뜨고(다른 부르는 곳이 없다), 줄 바로 아래 같은 목록이 이미 펼쳐지므로 둘째 목록은 읽는 때만 다른
   * 사본이 된다 — 한쪽엔 있고 한쪽엔 없는 줄이 보이는 순간이 생긴다. "새 워크트리에서 열기…" 는
   * 남긴다(우클릭 한 번에 닿는 만들기 길).
   *
   * 항목 핸들러는 **전부 통로 하나**를 지난다 (`$lib/browser/menu-runner` · docs/conventions.md 의
   * "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행. 콜백이 모달(폼·확인)을 여는데 백드롭이 남아 있으면
   * 그 클릭을 가로채므로 닫는 순서가 먼저다.
   */
  let {
    project,
    worktree = null,
    primary = false,
    ask = false,
    x,
    y,
    onclose,
    onreload,
  }: {
    /** 메뉴의 대상 — `null` 이면 빈 배경 메뉴(프로젝트 추가 · 새로고침) */
    project: Project | null;
    /** 워크트리 줄의 메뉴면 그 워크트리 (`project` 는 그 부모) */
    worktree?: WorktreeInfo | null;
    /** 그 워크트리가 git 의 주 작업 폴더인가 — `제거…` 가 서지 않는다 */
    primary?: boolean;
    /** 처음부터 "새 워크트리" 이름 칸으로 연다 (독 트리 프로젝트 줄의 `+`·Insert) */
    ask?: boolean;
    x: number;
    y: number;
    onclose: () => void;
    onreload: () => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);
  const elsewhere = $derived.by(() => {
    if (!project) return [];
    const locations = projectLocations(project, worktree?.path);
    return workspaceList().filter((workspace) => workspace.id !== currentWorkspaceId()).flatMap((workspace) => {
      const location = locations.find((location) => location.workspaceId === workspace.id);
      return location ? [{ name: workspace.name, location }] : [];
    });
  });

  // 원격 훅 항목은 에이전트 표로 그린다 — 표는 한 번 읽어 둔다(이미 읽었으면 아무 일도 없다).
  void loadHookTargets();

  /** 프로젝트 항목 통로 — 대상은 **닫기 전에** 스냅샷한다 (닫고 나서 프롭을 읽지 않는다) */
  const onProject = (fn: (p: Project) => void | Promise<void>) => runOnMenu(() => project, onclose, fn);

  /** 워크트리 줄 항목 통로 — 프로젝트와 그 워크트리를 **함께** 닫기 전에 스냅샷한다 */
  const onWorktree = (fn: (p: Project, w: WorktreeInfo) => void | Promise<void>) =>
    runOnMenu(
      () => (project && worktree ? { p: project, w: worktree } : null),
      onclose,
      ({ p, w }) => fn(p, w),
    );

  // ── 새 워크트리 — 이름 묻기 (docs/log/2026-09-24-worktrees.md) ──────────────
  //
  // **이 상자 안의 상태**다 — 상위(`ProjectList`)가 알아야 할 뜻이 없다. 실행은 여전히
  // `runOnMenu` 하나를 지난다(스냅샷 → 닫기 → 실행).

  /**
   * 이름을 묻는 중인가 (폴더 추가와 같은 인라인 입력 모양). 프롭 `ask` 는 **처음 값**일 뿐이다 —
   * 메뉴는 열 때마다 새로 마운트되므로 그 뒤의 프롭 변화를 따라갈 일이 없다.
   */
  // svelte-ignore state_referenced_locally
  let wtAsk = $state(ask);
  let wtName = $state("");
  let wtError = $state<string | null>(null);
  let wtInput = $state<HTMLInputElement | null>(null);

  /**
   * 이름 칸 아래의 **온전한 자리** — 치는 대로 바뀐다. 꼬리만 보여 주던 판에서 "어디에 생기는지
   * 모르겠다" 는 피드백을 받았다(2026-09-24): 이름이 비었으면 `<이름>` 자리표시를 끼운 꼴을,
   * 치면 그 이름의 폴더 전체를 보인다. 폴더를 바꾸려면 프로젝트 편집의 "워크트리 폴더" 칸이다.
   */
  const wtWhere = $derived(
    project ? worktreePreview(project, wtName, t("app.projects.worktree.ask.name")) : null,
  );

  // ── 새 워크트리 — 브랜치 콤보박스 (docs/log/2026-10-05-worktree-one-to-one.md "콤보박스") ──────
  //
  // 이름 칸이 뜨면 재료(`readAddPreview` — 로컬 · 원격 추적 브랜치 · 주 브랜치 · 체크아웃된 것)를 **한 번** 읽는다.
  // 원격은 붙은 세션이 있을 때만 — 없거나 실패하면 `null` 이고 목록이 서지 않는다(칸은 그냥 입력 칸, 조용히). 판정의
  // 원본은 실행 때의 Rust `plan_add` 다. 줄은 순수 층 `worktreeRows` 가 짓고 줄마다 고르면 일어날 일을 말한다(옛 판정
  // 한 줄을 대신한다). 빈 칸에 포커스가 있으면 모든 브랜치가 보인다(드롭다운처럼).
  //
  // 키: ↑↓ 고를 수 있는 줄 사이(흐린 줄은 건너뛴다 · 빈 칸은 기본 강조가 없어 ↓ 가 첫 줄 · ↑ 가 끝 줄) · Enter = 강조 줄을 고른다(= 만들고 연다) · Tab = 강조 줄의 이름을
  // 칸에 채우기만 · Escape 는 목록을 먼저 접고 다음 Escape 가 상자를 닫는다(아래 창 캡처 리스너). 클릭도 Enter 와 같다.
  let wtPreview = $state<AddPreview | null>(null);
  let wtPreviewAsked = false;
  /** 목록이 펼쳐져 있나 — Escape 로 접고, 칸에 포커스가 오거나 글자를 치면 다시 편다 */
  let wtListOpen = $state(true);
  /** 사람이 옮긴 강조 줄 (-1 = 기본 — 고를 수 있는 첫 줄) */
  let wtAt = $state(-1);
  $effect(() => {
    if (!wtAsk || !project || wtPreviewAsked) return;
    wtPreviewAsked = true;
    const p = project;
    void readAddPreview(p).then((got) => {
      if (project === p) wtPreview = got;
    });
  });
  const wtRows = $derived<WorktreeRow[]>(wtPreview && wtListOpen ? worktreeRows(wtName, wtPreview) : []);
  /** 실제 강조 줄 — 사람이 고른 줄이 아직 고를 수 있으면 그것, 아니면 기본(빈 칸이면 없음 · 치면 고를 수 있는 첫 줄) */
  const wtActive = $derived(
    wtAt >= 0 && wtAt < wtRows.length && rowSelectable(wtRows[wtAt]) ? wtAt : defaultRow(wtName, wtRows),
  );

  /** 줄의 동작 표식 — 줄 오른쪽의 옅은 글자 */
  function rowTag(r: WorktreeRow): string {
    switch (r.kind) {
      case "create":
        return r.main
          ? t("app.projects.worktree.ask.row.createFrom", { main: r.main })
          : t("app.projects.worktree.ask.row.createNoMain");
      case "local":
        return t("app.projects.worktree.ask.row.local");
      case "remote":
        return t("app.projects.worktree.ask.row.remote");
      case "busy":
        return t("app.projects.worktree.ask.row.busy");
      case "ambiguous":
        return t("app.projects.worktree.ask.row.ambiguous");
    }
  }

  /** 줄을 고른다 = 그 이름으로 만들고 연다(원격만 있는 것도 `<이름>` — Rust 가 원격 추적 갈래로 간다) */
  function chooseRow(r: WorktreeRow) {
    if (!rowSelectable(r)) return;
    wtName = r.name;
    submitWorktreeAsk();
  }

  /** 이름 칸의 키 — 조합 중이면 아무것도 하지 않는다. 다룬 키는 거품을 막는다(독 · 전역 키 · 터미널로 새지 않게). */
  function worktreeAskKeydown(ev: KeyboardEvent) {
    if (ev.isComposing) return;
    const rows = wtRows;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!wtListOpen) {
        wtListOpen = true;
        wtAt = -1;
        return;
      }
      const next = stepSelectableRow(rows, wtActive, ev.key === "ArrowDown" ? 1 : -1);
      if (next >= 0) wtAt = next;
      return;
    }
    if (ev.key === "Tab" && wtActive >= 0) {
      ev.preventDefault();
      ev.stopPropagation();
      wtName = rows[wtActive].name;
      wtError = null;
      wtAt = -1;
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      // **거품을 막는다** (실기 ③): 확정이 메뉴를 닫은 뒤 이 Enter 가 독(`ProjectList`)까지
      // 올라가면, 그쪽은 "메뉴가 없다" 를 보고 선택된 "+ 새 워크트리…" 줄을 Enter 로 다시 열어
      // 이름 상자가 안 닫힌 것처럼 보였다. (2026-09-25 그 줄은 빠졌고 `+` 가 고르는 것은 프로젝트
      // 줄이다 — 지금 새면 그 프로젝트가 지금 탭에 **또 열린다**. 막는 까닭은 그대로다.)
      ev.stopPropagation();
      // 강조 줄이 있으면 그 줄을, 없으면(목록 없음 · 이름이 규칙에 어긋남 등) 예전처럼 친 이름으로 — 검사가 한 줄을 띄운다.
      if (wtActive >= 0) chooseRow(rows[wtActive]);
      else submitWorktreeAsk();
    }
  }

  async function startWorktreeAsk() {
    wtAsk = true;
    wtName = "";
    wtError = null;
    wtListOpen = true;
    wtAt = -1;
    await tick();
    wtInput?.focus();
  }

  /** 확정 — 이름을 **닫기 전에** 검사하고, 통과하면 통로를 지난다 (대상·이름 둘 다 스냅샷) */
  function submitWorktreeAsk() {
    const bad = worktreeNameError(wtName);
    if (bad) {
      wtError = bad;
      return;
    }
    const name = wtName.trim();
    runOnMenu(
      () => project,
      onclose,
      (p) => openProjectInNewWorktree(p, name),
    );
  }

  // 뜨면 포커스 — 이름 칸으로 열렸으면 그 칸, 아니면 메뉴 자체(↑↓·Escape 가 곧바로 산다).
  $effect(() => {
    if (wtAsk) wtInput?.focus();
    else menuEl?.focus();
  });

  // **이름 칸은 터미널에게 포커스를 뺏기지 않는다** (2026-09-24 실기 ③). 원격 프로젝트를 연 직후
  // 칸을 열면 접속이 끝나는 순간 터미널이 `term.focus()` 로 키보드를 되찾아(`Terminal` 의 연결 성공
  // 갈래) 친 글자가 셸로 갔다. 칸이 떠 있는 동안 xterm 으로 들어간 포커스는 **프로그램이 옮긴
  // 것뿐이다** — 사람이 터미널을 누르면 백드롭이 먼저 받아 이 상자가 닫힌다. 그래서 그때만 한
  // 프레임 뒤(그쪽 rAF 뒤) 칸으로 되돌린다. 여는 순간도 같은 rAF 로 한 번 더 준다(독·Dock 의 처방).
  $effect(() => {
    if (!wtAsk) return;
    const input = wtInput;
    if (!input) return;
    const refocus = () => {
      if (input.isConnected) input.focus({ preventScroll: true });
    };
    let raf = requestAnimationFrame(refocus);
    const onFocusIn = (ev: FocusEvent) => {
      if (ev.target instanceof Element && ev.target.closest(".xterm")) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(refocus);
      }
    };
    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  });

  // **Escape 는 포커스가 어디 있든 닫는다** (실기 ③) — 메뉴 안의 `menuKeydown` 만으로는 포커스를
  // 잃은 상자(터미널이 가져간 경우)가 Escape 를 못 들어 [취소] 말고는 닫을 길이 없었고, 열린
  // 동안 독의 Delete 가 막혀(`ProjectList` 는 메뉴가 떠 있으면 키를 넘긴다) 트리의 제거도 죽었다.
  // 캡처 단계라 xterm(Escape 를 삼킨다)보다 먼저 듣는다. IME 조합 중의 Escape 는 조합 취소다.
  $effect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.isComposing) return;
      ev.preventDefault();
      ev.stopPropagation();
      // 브랜치 목록이 펼쳐져 있고 칸에 포커스가 있으면 목록부터 접는다 — 다음 Escape 가 상자를 닫는다.
      // 포커스가 칸 밖(터미널이 가져간 경우)이면 목록과 상관없이 곧바로 닫는다(위 "포커스가 어디 있든").
      if (wtRows.length > 0 && document.activeElement === wtInput) {
        wtListOpen = false;
        wtAt = -1;
        return;
      }
      onclose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게 클램프한다 (렌더 뒤 실제 크기를 재야 하므로 effect).
  // 이름 칸이 열리면 상자가 넓어지므로(온전한 자리를 보인다) 그때 다시 잰다.
  $effect(() => {
    if (!menuEl) return;
    void wtAsk;
    void wtWhere;
    void wtRows.length;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  /** 메뉴 안 키보드 — Escape 로 닫고, ↑/↓ 로 메뉴 항목 사이를 오간다 */
  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    // 워크트리 이름 칸에서는 화살표가 글자 사이를 오간다 — 메뉴 항목으로 뛰지 않는다.
    if (wtAsk) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      const items = menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        ev.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }
</script>

<button
  type="button"
  class="menu-backdrop"
  tabindex="-1"
  aria-label={t("files.hostmenu.close.aria")}
  onclick={onclose}
  oncontextmenu={(ev) => {
    ev.preventDefault();
    onclose();
  }}
></button>
<div
  class="ctx-menu menu-surface"
  class:ask={wtAsk}
  role="menu"
  tabindex="-1"
  aria-label={t("app.projects.menu.aria")}
  data-project-menu
  bind:this={menuEl}
  onkeydown={menuKeydown}
>
  {#if project === null}
    <!-- 빈 배경 — 만들 수 있는 것은 프로젝트 하나뿐이다 (툴바 + 와 같은 진입점) -->
    <div class="ctx-title menu-title">{t("app.dock.title.projects")}</div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      onclick={() => runAfterClose(onclose, () => openProjectForm())}
    >
      {t("app.projects.add.project")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onreload)}>
      {t("files.hostmenu.refresh")}
    </button>
  {:else if wtAsk}
    <!--
      **새 워크트리 — 이름 묻기** (docs/log/2026-09-24-worktrees.md). 폴더 추가와 같은 인라인
      입력 모양이다(모달을 띄우지 않는다 — 대상이 이 줄 하나라 메뉴 자리에서 끝나는 편이 짧다).
      Enter 로 확정, Escape 로 취소. 아래 한 줄은 **만들어질 온전한 자리**다(줄여 쓰지 않고 접어서
      다 보인다 — 자리를 묻는 피드백의 답이 이 줄이다).
    -->
    <div class="ctx-title menu-title" title={project.path}>
      {t("app.projects.worktree.ask.title", { name: project.name })}
    </div>
    <input
      class="ctx-input menu-input"
      data-worktree-name
      bind:value={wtName}
      bind:this={wtInput}
      spellcheck="false"
      autocomplete="off"
      placeholder={t("app.projects.worktree.ask.placeholder")}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={wtRows.length > 0}
      aria-controls="worktree-rows"
      aria-activedescendant={wtActive >= 0 ? `worktree-row-${wtActive}` : undefined}
      onfocus={() => {
        wtListOpen = true;
      }}
      oninput={() => {
        wtError = null;
        wtListOpen = true;
        wtAt = -1;
      }}
      onkeydown={worktreeAskKeydown}
    />
    {#if wtRows.length > 0}
      <!--
        브랜치 콤보박스 — 줄마다 고르면 일어날 일을 오른쪽에 적는다. 흐린 줄(다른 워크트리에서 열림 · 여러 원격)은
        보이되 고를 수 없다. 길면 목록 안에서 스크롤한다(잘라 버리지 않는다).
      -->
      <div class="wt-rows" id="worktree-rows" role="listbox" data-worktree-rows
        aria-label={t("app.projects.worktree.ask.rows.aria")}>
        {#each wtRows as r, i (rowKey(r))}
          <button
            type="button"
            role="option"
            tabindex="-1"
            id={`worktree-row-${i}`}
            class:on={i === wtActive}
            class:create={r.kind === "create"}
            aria-selected={i === wtActive}
            aria-disabled={!rowSelectable(r)}
            data-worktree-row-kind={r.kind}
            data-worktree-row-name={r.name}
            onmousedown={(ev) => ev.preventDefault()}
            onclick={() => chooseRow(r)}
          >
            <span class="glyph" aria-hidden="true">{r.kind === "create" ? "＋" : "⎇"}</span>
            <span class="name"
              >{r.kind === "create"
                ? t("app.projects.worktree.ask.row.create", { name: r.name })
                : r.kind === "remote"
                  ? r.ref
                  : r.name}</span
            >
            <span class="tag">{rowTag(r)}</span>
          </button>
        {/each}
      </div>
    {/if}
    {#if wtError}
      <div class="ctx-error">{wtError}</div>
    {:else if wtWhere}
      <div class="ctx-hint" data-worktree-where>{t("app.projects.worktree.ask.where", { path: wtWhere })}</div>
    {:else}
      <div class="ctx-error">{t("app.projects.worktree.error.nowhere")}</div>
    {/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" data-worktree-submit onclick={submitWorktreeAsk}>
        {t("app.projects.worktree.ask.submit")}
      </button>
    </div>
  {:else if worktree}
    <!--
      **워크트리 줄의 메뉴** (독 트리 — docs/log/2026-09-24-worktrees.md "독의 트리"). 무리 순서는 파일 타일 메뉴와 같은 규칙 —
      열기 → 보기(브랜치 그래프 · 변경) → 이 폴더의 일 → 지우는 둘(브랜치 삭제 · 제거)은 맨 아래. 여는 둘은
      프로젝트 줄과 같은 뜻(열기 · 지금 탭에 타일), 로컬이면 폴더 열기와 제거(주 폴더는 git 이 지우지
      않으므로 서지 않는다). 원격은 이 PC 의 탐색기가 열 수 없고 원격 제거는 아직 없다.
    -->
    {@const remote = isRemote(project)}
    {@const noScript = !hasSetupScript(project)}
    {@const listing = worktreesOf(project.id)}
    {@const mainName = (listing?.state === "ok" ? listing.list[0]?.branch : null) ?? "main"}
    <div class="ctx-title menu-title" title={worktree.path}>{worktree.branch ?? t("app.projects.worktrees.detached")}</div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="open"
      onclick={() => onWorktree(openProjectWorktree)}
    >
      {t("app.projects.menu.open")}
    </button>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="openHere"
      onclick={() => onWorktree(openProjectWorktreeHere)}
    >
      {t("app.projects.menu.openHere")}
    </button>
    {#each elsewhere as target (target.location.workspaceId)}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-project-action="revealOpen"
        onclick={() => runOnMenu(() => target.location, onclose, revealProjectLocation)}>
        {t("app.projects.menu.revealOpen", { name: target.name })}
      </button>
    {/each}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <!-- 브랜치 그래프 — 이 워크트리의 브랜치를 고른 채로(docs/log/2026-09-29-branch-graph.md) -->
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="branches"
      onclick={() => onWorktree((p, w) => openBranchGraph(p, w.branch))}
    >
      {t("app.projects.menu.branches")}
    </button>
    <!--
      변경 보기 (docs/log/2026-10-05-diff-tile.md) — 이 워크트리 브랜치의 diff 타일, 브랜치 전체(main 대비 + 커밋 안 한 것).
      분리 HEAD(브랜치 없음)는 흐리게 — 말풍선이 까닭.
    -->
    <button
      type="button"
      class="ctx-item menu-row diffrow"
      role="menuitem"
      data-worktree-action="diff"
      disabled={!worktree.branch}
      aria-disabled={!worktree.branch}
      title={worktree.branch ? undefined : t("app.projects.menu.diff.detached")}
      onclick={() =>
        onWorktree((p, w) => {
          if (w.branch) openDiff(p, { scope: "branch", branch: w.branch, worktreePath: w.path });
        })}
    >
      <span>{t("app.projects.menu.diff")}</span><span class="menu-kbd">{t("app.projects.menu.diff.sub", { main: mainName })}</span>
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <!--
      설정 스크립트 실행 (docs/log/2026-09-28-project-agent-setup-script.md) — 그 워크트리에서 새 타일(지금 탭 옆)로 스크립트만
      돌리고 셸에 머문다. 이미 있는 워크트리 · 실패한 뒤 다시 돌릴 때. 스크립트가 비면 흐리게(누를 수 없다 — 말풍선이 까닭).
    -->
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="runSetup"
      disabled={noScript}
      aria-disabled={noScript}
      title={noScript ? t("app.projects.worktree.runSetup.empty") : undefined}
      onclick={() => onWorktree(runProjectSetupScript)}
    >
      {t("app.projects.worktree.runSetup")}
    </button>
    {#if !remote}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-worktree-action="reveal"
        onclick={() => onWorktree(revealWorktree)}
      >
        {t("app.projects.worktree.reveal")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <!-- 브랜치 삭제 (docs/log/2026-10-01-worktree-branch-ops.md) — 저장소 단위라 어느 줄에서든. 원격은 붙은 세션이 없으면 누른 뒤 알림 한 줄. -->
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-worktree-action="deleteBranch"
      onclick={() => onWorktree((p) => openBranchDelete(p))}
    >
      {t("app.projects.worktrees.branch.delete")}
    </button>
    {#if !primary}
      <!-- 원격도 — 붙은 세션이 없으면 누른 뒤 알림 한 줄(확인 상자가 뜨지 않는다) -->
      <button
        type="button"
        class="ctx-item menu-row danger"
        role="menuitem"
        data-worktree-action="remove"
        onclick={() => onWorktree(confirmRemoveWorktree)}
      >
        {t("app.projects.worktrees.remove")}
      </button>
    {/if}
  {:else}
    <!--
      프로젝트 한 줄의 메뉴 — 무리 순서(파일 타일 메뉴와 같은 규칙): 열기(새 워크트리 포함) → 브랜치 그래프 → 맡기기 · 훅 →
      편집 → 위험한 것(삭제)은 맨 아래 혼자. 이미 있는 워크트리는 독에서 이
      줄을 펼치면 보인다(옛 `워크트리 ▸` 옆목록의 자리 — 스크립트 머리말).
    -->
    <div class="ctx-title menu-title" title={project.path}>{project.name}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onProject(openProject)}>
      {t("app.projects.menu.open")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onProject(openProjectHere)}>
      {t("app.projects.menu.openHere")}
    </button>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-project-action="worktree"
      onclick={() => void startWorktreeAsk()}
    >
      {t("app.projects.menu.worktree")}
    </button>
    {#each elsewhere as target (target.location.workspaceId)}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-project-action="revealOpen"
        onclick={() => runOnMenu(() => target.location, onclose, revealProjectLocation)}>
        {t("app.projects.menu.revealOpen", { name: target.name })}
      </button>
    {/each}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <!-- 브랜치 그래프 (docs/log/2026-09-29-branch-graph.md) — 지금 탭에 분할로 -->
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-project-action="branches"
      onclick={() => onProject((p) => openBranchGraph(p))}
    >
      {t("app.projects.menu.branches")}
    </button>
    {#if !isRemote(project)}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-project-action="orchestration" onclick={() => onProject((p) => void startOrchestrationHere(p.id))}>
        {t("orch.start.openAiTile")}
      </button>
    {/if}
    {#if isRemote(project)}
      <!--
        원격 에이전트 훅 (docs/log/2026-09-24-remote-agent-signals.md · docs/log/2026-09-26-codex-hooks.md)
        — 에이전트 표(Rust `TARGETS`)를 돌며 한 벌씩. 그 서버의 설정 파일(`~/.claude/settings.json` ·
        `~/.codex/hooks.json`)에 우리 항목을 넣고 뺀다. 붙은 세션이 없으면 누른 뒤 알림 한 줄.
      -->
      {#if hookTargets().length > 0}
        <div class="ctx-sep menu-sep" role="separator"></div>
      {/if}
      {#each hookTargets() as target (target.id)}
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          data-project-action="hooksInstall"
          data-hook-agent={target.id}
          onclick={() => onProject((p) => installRemoteHooks(p, target))}
        >
          {t("app.projects.hooks.install", { agent: target.display })}
        </button>
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          data-project-action="hooksRemove"
          data-hook-agent={target.id}
          onclick={() => onProject((p) => removeRemoteHooks(p, target))}
        >
          {t("app.projects.hooks.remove", { agent: target.display })}
        </button>
      {/each}
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      data-project-action="edit"
      onclick={() => onProject((p) => openProjectForm(p))}
    >
      {t("app.projects.menu.edit")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row danger"
      role="menuitem"
      data-project-action="remove"
      onclick={() => onProject(confirmRemoveProject)}
    >
      {t("app.projects.menu.remove")}
    </button>
  {/if}
</div>

<style>
  /* 변경 보기 — 오른쪽 부연("main 대비")이 끝으로 밀리게 */
  .diffrow {
    display: flex;
    align-items: center;
  }

  /* 바깥 클릭을 받아 닫는 투명 백드롭 — 메뉴보다 한 겹 아래에 깔린다 (`HostMenu` 와 같은 값) */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /*
   * 커서 자리(JS 로 클램프)에 뜨는 작은 메뉴 상자. 모양(상자·줄·머리글·구분선·인라인 칸)은
   * 전역 메뉴 한 벌(`theme.css` 의 `.menu-*` — docs/log/2026-09-25-leftovers-menus-dots.md)이고
   * 여기 남는 것은 자리와 폭뿐이다. `ctx-*` 이름은 표식으로 남는다(검증 도구가 이 이름으로 찾는다).
   */
  .ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 160px;
    max-width: 240px;
  }

  /*
   * 이름을 묻는 동안은 넓다 — 아래 줄이 **온전한 경로**라 220px 에서는 서너 줄로 접힌다.
   * 커서 자리 클램프가 그때 다시 재므로(위 `$effect`) 넓어진 상자도 화면 밖으로 넘치지 않는다.
   */
  .ctx-menu.ask {
    width: 340px;
    max-width: calc(100vw - 8px);
  }

  /*
   * 이름 칸 아래의 **만들어질 온전한 자리** — 말줄임하지 않고 접는다(경로의 어느 조각이든
   * 보여야 한다). 고정폭 글꼴은 경로 칸(`ProjectForm`)과 같은 결이다.
   */
  .ctx-hint {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--fg-3);
    white-space: normal;
    overflow-wrap: anywhere;
    user-select: text;
  }

  /*
   * 이름 칸 아래의 브랜치 콤보박스 — 강조 줄은 메뉴 줄의 호버와 같은 면이다. 8줄쯤 넘으면 목록 안에서 스크롤한다.
   * 줄 오른쪽의 옅은 글자가 그 줄의 동작(로컬 · 원격 · 받아 옴 · 새로 만들기)이고, 고를 수 없는 줄은 통째로 흐리다.
   */
  .wt-rows {
    display: flex;
    flex-direction: column;
    max-height: calc(8 * 22px + 4px);
    overflow-y: auto;
    margin: 0 var(--space-1) var(--space-2);
    padding: 2px 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-field);
  }

  .wt-rows button {
    display: flex;
    flex: none;
    align-items: baseline;
    gap: var(--space-2);
    width: 100%;
    min-height: 22px;
    padding: 3px var(--space-2);
    border: 0;
    background: none;
    color: var(--fg-1);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    text-align: left;
    cursor: pointer;
  }

  .wt-rows .glyph {
    flex: none;
    color: var(--fg-3);
  }

  .wt-rows .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wt-rows button.create .name {
    font-family: var(--font-ui);
  }

  .wt-rows button:hover:not([aria-disabled="true"]),
  .wt-rows button.on {
    background: var(--surface-hover);
  }

  /* 고를 수 없는 줄 — `disabled` 대신 `aria-disabled`(눌러도 칸이 포커스를 잃지 않게 mousedown 을 받아 막는다) */
  .wt-rows button[aria-disabled="true"] {
    color: var(--fg-3);
    cursor: default;
    opacity: 0.7;
  }

  .wt-rows .tag {
    flex: none;
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  /* 입력의 검증 실패 한 줄 — 칸 바로 아래, 메뉴는 열린 채로 */
  .ctx-error {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
  }

  .ctx-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) 2px;
  }

  /*
   * 인라인 대화의 단추 — 모양은 전역 `.btn .btn-sm` 세 종류다 (docs/log/2026-09-25-unified-dock.md ·
   * 토큰층 "버튼 세 종류"). 취소 = 보조(회색 판), 확인 = 주(채운 강조색 — 이 상자의 하나뿐인 주 동작).
   * 옛 선 두른 단추 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이기므로 남기면 안 먹는다.
   * `ctx-btn` 은 표식으로만 남는다(검증 도구가 이 이름으로 찾는다).
   */
</style>
