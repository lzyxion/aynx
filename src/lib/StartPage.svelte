<script lang="ts">
  import { flushSync, tick } from "svelte";
  import { loadHosts, type HostEntry } from "$lib/hosts";
  import { hostActions } from "$lib/pane/host-actions";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";
  import { clockBoxSize } from "$lib/start-clock";
  import {
    mirrorPaletteQuery,
    openPalette,
    paletteMirror,
    releasePaletteMirror,
  } from "$lib/app/overlays.svelte.js";
  import { addLocal, knownShellList } from "$lib/app/panes.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { dockAgentPanes, dockProjectFolders } from "$lib/app/dock-dots.svelte.js";
  import { projectDots } from "$lib/dock-dots";
  import {
    checkLocalRecentWorktrees,
    recentOpens,
    restoreRecentOpens,
  } from "$lib/app/recent-worktrees.svelte.js";
  import {
    launcherProjectRows,
    projectOpenedAt,
    resolveRecentWorktrees,
    withRecentWorktrees,
    type LauncherProjectRow,
  } from "$lib/recent-worktrees";
  import { remoteHomeOf } from "$lib/app/remote-home.svelte.js";
  import { historyOf, recentHosts } from "$lib/host-history";
  import { settings } from "$lib/settings.svelte.js";
  import { effectiveDefaultShellId, type ShellList } from "$lib/session";
  import {
    firstLauncherPos,
    launcherMove,
    launcherSeed,
    shellColumn,
    type LauncherArea,
    type LauncherDir,
    type LauncherPos,
  } from "$lib/launcher";
  import {
    boardBounds,
    clampClockResize,
    clampResize,
    dragLanding,
    FIT_PADDING,
    fitScale,
    isNarrowBoard,
    narrowStack,
    LAYOUT_LIFT,
    widgetCapacity,
    widgetColumns,
    widgetRowsPerColumn,
    withNewWidget,
    withoutWidget,
    withWidgetBox,
    withWidgetSize,
    type Box,
    type Guide,
    type StartWidget,
    type StartWidgetKind,
  } from "$lib/start-widgets";
  import {
    canUndoStartBoard,
    clockOptions,
    editStartBoard,
    resetStartWidgets,
    undoStartBoard,
    setClockOptions,
    setStartWidgets,
    startBoardEditable,
    startWidgets,
  } from "$lib/start-widgets.svelte.js";
  import { isRemote, sortProjects, type Project } from "$lib/projects";
  import { projectMarkers } from "$lib/app/project-locations.svelte.js";
  import { openProject, openProjectHere, openProjectWorktree, openProjectWorktreeHere, projects, worktreesOf } from "$lib/app/projects.svelte.js";
  import StartWidgetFrame from "$lib/start/StartWidgetFrame.svelte";
  import HostsWidget from "$lib/start/HostsWidget.svelte";
  import ProjectsWidget from "$lib/start/ProjectsWidget.svelte";
  import ShellsWidget from "$lib/start/ShellsWidget.svelte";
  import ClockWidget from "$lib/start/ClockWidget.svelte";
  import StartBoardMenu from "$lib/start/StartBoardMenu.svelte";
  import StartWidgetMenu from "$lib/start/StartWidgetMenu.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * **시작 화면 = launcher** — 빈 탭의 출발점 (docs/log/2026-09-25-launcher.md · 2026-10-28-start-widgets.md).
   *
   * 두 자리에서 **같은 컴포넌트**가 뜬다:
   *  ① `kind:"start"` 타일 안 (새 탭의 시작 배치)
   *  ② 탭이 **하나도 없을 때**의 본문 (`+page` 의 빈 상태)
   * 진짜 타일이 생기는 순간 사라지므로 이 화면은 늘 탭 캔버스(또는 그 타일) 하나를 통째로 쓴다.
   *
   * 2026-10-28 부터 **자유 배치 위젯 판**이다(목업 Vd194tKWh3tEUY1X3qi3uF). 고정된 세 단(최근 호스트 · 프로젝트 · 셸) 대신
   * 같은 셋이 **위젯**(유리 카드 — `start/`)으로 판 위 아무 데나 선다:
   *
   *  · **자리** — 위젯마다 `{ kind, x, y, w, h }`(판 **가운데** 기준 px — 창이 커져도 배치가 가운데에 남는다), 종류마다 하나,
   *    **겹치지 않는다**. 규칙은 순수 모듈 `start-widgets.ts`, 창에 하나뿐인 배치 + localStorage 는 `start-widgets.svelte.ts`.
   *  · **옮기기** — **편집 모드에서만**(아래 "편집 모드" 절) 위젯 몸 어디든 눌러 끈다(문턱 4px 을 넘어야 선다). 끄는 동안은 `transform` 만 바뀌고(배치 셈 없음), 보이지 않는 8px 격자 ·
   *    이웃과 맞으면 점선 안내선 · 놓일 자리의 점선 윤곽. 다른 위젯 위면 가장 가까운 빈자리에 앉는다. 저장은 놓을 때 한 번.
   *  · **크기** — 오른쪽 아래 모서리. 종류마다 최소, 커지다 이웃의 변(16px 앞)에서 멈춘다. 옛 윤곽(점선)과 보이는 줄 수 말풍선.
   *    줄은 위젯 높이에 들어가는 만큼만 세운다(안에서 굴리지 않는다), 넓으면(≥384) 두 단으로 흐른다.
   *  · **시계**(2026-11-03) — 줄이 없는 넷째 위젯(`start/ClockWidget`), 카드 없이 글자만 뜬다(프레임의 맨몸 `bare`). 고를 줄이 없어 키보드 선택이 건너뛰고, 위젯 위 우클릭
   *    메뉴(`start/StartWidgetMenu`)에 표시 줄(12/24시간 · 초 · 날짜 — 고른 값은 `start-widgets.svelte.ts` 의 따로 키)이 붙는다.
   *  · **빼기** — 머리 오른쪽 ×. **더하기**는 편집 중 빈 자리 우클릭 메뉴(`start/StartBoardMenu`), **되돌리기 · 레이아웃 리셋**은 편집 중
   *    그 메뉴와 판 위 단추 줄(되돌리기 · 레이아웃 리셋 · 완료).
   *    × · 크기 모서리는 편집 모드에서만 — 모든 위젯에 한꺼번에 선다(평소엔 호버해도 없다).
   *  · **작은 창** — 위젯들의 바깥 상자가 판에 안 들어가면 배치 전체를 `transform: scale()` 로 줄인다(키우지 않고, 굴리지도,
   *    다시 흘리지도 않는다). 줄어든 동안의 끌기 · 크기 셈은 포인터의 차를 배율로 나눈다.
   *  · **좁은 판** — 판은 창이 아니라 시작 타일이라(탭을 나누면 반이 된다) 배율이 `MIN_FIT_SCALE`(0.5 — 2026-11-03, 굴림을 덜 쓰려고 0.75 에서 내림) 아래로 내려가야 하면
   *    줄이지 않고 위젯을 읽는 순서대로 **한 줄로 쌓아 세로로 굴린다**(`narrowStack` · 뿌리에 `data-start-narrow`). 그리기 전용 —
   *    저장된 배치는 그대로라 판이 다시 넓어지면 돌아온다. 그동안 옮기기 · 크기는 없다(끄는 귀 · 모서리가 없다), × · 판
   *    메뉴(되돌리기 · 더하기 · 처음 배치)는 저장된 배치에 그대로 돈다. 키보드의 기하도 쌓인 자리로 센다(↑↓ 가 위아래 카드로).
   *  · **원격 창**(2026-11-04 — docs/log/2026-11-04-start-board-mirror.md) — 집 PC 한 벌을 따르고 편집하지 않는다. 판 우클릭이 메뉴를 열지 않으면 편집의 모든 길(편집 모드 ·
   *    × · 크기 · 더하기 · 되돌리기 · 처음 배치 · 시계 표시)이 닫힌다 — 다른 입구가 없다(`startBoardEditable`). 줄 고르기 · 키보드는 그대로.
   *
   * 줄은 전부 **이미 있는 목록과 여는 함수**를 그대로 부른다: 호스트는 호스트 독의 "접속"(`onconnect`), 프로젝트는 독의
   * 열기(`openProject`), 셸은 상태바 `>_` 메뉴의 셸 줄(`addLocal`). 그래야 "시작 화면으로 연 것" 과 "다른 길로 연 것" 의
   * 규칙(시작 타일 교체 · 기본 셸 · 탭 자동 생성)이 갈리지 않는다.
   *
   * **검색 칸 모양 단추는 걷었다**(2026-10-28) — 글자를 치면 곧바로 명령 팔레트가 뜨고(친 글자를 싣고), 팔레트는 어디서 열든
   * 제 기본 자리(타일 캔버스 기준)에 선다. 칸 자리에 겹쳐 펼치던 길(`placeAnchoredPalette` · `visibleLauncherAnchor`)도 함께 걷었다.
   *
   * **키보드**: 선택은 하나다(`--accent-soft` 판 — 이 화면의 유일한 강조). ↑↓ 는 위젯 안(가장자리에서 바로 위 · 아래 위젯으로
   * 이어진다), ←→ 는 두 단 위젯의 옆 단 → 그 방향의 가장 가까운 위젯(기하로). Enter = 연다. 글자를 치면 팔레트.
   * 규칙은 순수 모듈 `launcher.ts` 에 있다. 포커스는 줄이 아니라 **숨은 입력칸 하나**가 쥔다
   * (`aria-activedescendant` — 아래 "선택" 절) — 한글 IME 가 첫 키부터 켜져 있게.
   *
   * **성능**: 주기 박자는 상대 시각(`2분 전`)의 30초 하나뿐이고, **시작 화면이 숨었을 때**(`.pane-box.hidden` — 비활성 탭 ·
   * 줌에 가린 타일) **와 창이 뒤에 있을 때**(`document.hidden`)는 건너뛴다(아래 `now`). 앞으로 주기적으로 다시 그리는 위젯(시계 등)도
   * 같은 규칙을 따른다 — 시작 타일은 탭마다 하나씩 살아 있을 수 있다.
   */

  let {
    hosts = [],
  }: {
    /**
     * 상위가 이미 읽어 둔 호스트 목록 (`+page` 의 `hostCache`). **비어 있을 수 있다** —
     * 그 캐시를 채우는 것은 호스트 독인데, 시작 화면이 뜨는 상황은 대개 독을 아직 한 번도
     * 열지 않은 상황이기 때문이다. 그래서 아래 `$effect` 가 스스로 한 번 읽는다.
     */
    hosts?: HostEntry[];
    /*
     * **설정은 여기 없다** — 이 화면이 뜨는 상황은 저장할 것이 없는
     * 상황이고, 설정은 상태바의 ⚙ 와 `Ctrl+,` 가 어디서나 같은 자리에 있다 (2026-09-15).
     */
  } = $props();

  // ---------------------------------------------------------------------------
  // 호스트 조작은 **컨텍스트에서** 꺼낸다 (docs/log/2026-09-05-refactor-structure.md).
  // 접속(`onconnect`) · 읽은 목록을 상위 캐시에 올리는 통로(`onhosts`) · 다시 읽을 신호
  // (`refreshKey`) — 셋 다 호스트 독이 쓰는 것과 **같은 함수**다.
  // ---------------------------------------------------------------------------
  const actions = hostActions();
  const { onconnect, onhosts } = actions;
  const refreshKey = $derived(actions.refreshKey ?? 0);

  /** 스스로 읽은 호스트 목록. 아직 안 읽었으면 `null` 이라 상위 캐시를 그대로 쓴다 */
  let loaded = $state<HostEntry[] | null>(null);

  /**
   * 호스트 목록을 한 번 읽는다 — 상위 캐시만 믿으면 앱을 켜자마자 뜨는 이 화면에서 최근
   * 호스트가 언제나 비어 보인다(이력은 별칭만 들고 그릴 때 목록에서 다시 찾는다).
   * 실패는 `loadHosts` 가 삼켜 빈 목록으로 돌아온다.
   */
  $effect(() => {
    void refreshKey;
    let alive = true;
    void loadHosts(t).then((cfg) => {
      if (!alive) return;
      loaded = cfg.hosts;
      onhosts?.(cfg.hosts);
    });
    return () => {
      alive = false;
    };
  });

  const list = $derived(loaded ?? hosts);

  /**
   * 상대 시각의 "지금" — 30초마다 다시 읽는다(`2분 전` 이 화면에 그대로 굳지 않게). **보일 때만** 고친다 — 다른 탭에 숨은
   * 시작 화면(`.pane-box.hidden` → `checkVisibility()` 거짓)과 뒤에 있는 창(`document.hidden`)에서는 박자를 건너뛰고, 창이
   * 앞으로 오면 곧바로 한 번 읽는다. 판에 손 · 포커스가 올 때도 다시 읽는다(숨었다 다시 보인 탭이 다음 박자를 기다리지 않게).
   */
  let now = $state(Date.now());
  const touchNow = () => (now = Date.now());
  const visibleNow = () => !document.hidden && (root?.checkVisibility() ?? false);
  $effect(() => {
    const id = setInterval(() => {
      if (visibleNow()) touchNow();
    }, 30_000);
    const onVisibility = () => {
      if (visibleNow()) touchNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // ---------------------------------------------------------------------------
  // 판 — 배치 · 크기 · 축소 배율
  // ---------------------------------------------------------------------------

  const layout = $derived(startWidgets());
  const placedKinds = $derived(layout.map((w) => w.kind));

  let root = $state<HTMLDivElement | null>(null);
  /**
   * 판의 내용 상자 — `bind:clientWidth` 가 아니다: 그것은 바깥 상자의 크기 변화에만 다시 재서, 좁은 판에서 굴림 막대가 서도
   * 폭이 그대로 남는다(쌓인 카드가 막대만큼 오른쪽으로 치우친다). 내용 상자는 막대를 뺀 폭이다(뿌리에는 안쪽 여백이 없다).
   */
  let boardRect = $state<DOMRectReadOnly | null>(null);
  const boardW = $derived(boardRect?.width ?? 0);
  const boardH = $derived(boardRect?.height ?? 0);
  /**
   * 좁은 판인가 — 배치를 바닥 배율 아래로 줄여야 들어갈 때(머리말 "좁은 판"). 판 폭은 굴림 막대를 뺀 폭(위 `boardRect`)이라
   * 좁은 판에서 막대가 서면 판이 조금 더 좁아질 뿐 — 좁은 판 ↔ 넓은 판을 오가며 떨리지 않는다(막대가 서는 쪽이 늘 더 좁다).
   */
  const narrow = $derived(isNarrowBoard(layout, boardW, boardH));
  /** 배치 전체의 축소 배율 — 놓인 배치로만 잰다(끄는 · 크기를 바꾸는 동안 판이 흔들리지 않게). 좁은 판은 줄이지 않는다 */
  const scale = $derived(narrow ? 1 : fitScale(layout, boardW, boardH));
  /** 이 배율에서 보이는 판 좌표의 경계 — 놓기 · 크기 · 더하기가 이 안에 머문다(좁은 판에서는 쓰지 않는다) */
  const bounds = $derived(boardBounds(boardW, boardH, scale));
  /** 좁은 판의 그림 자리(굴리는 내용의 왼쪽 위 기준) — 종류로 찾는다. 넓은 판이면 비어 있다 */
  const stack = $derived(narrow ? narrowStack(layout, boardW, boardH) : null);
  const stackBy = $derived(new Map((stack?.boxes ?? []).map((b) => [b.kind, b])));

  /**
   * 끄는 중 · 크기를 바꾸는 중의 손짓. 놓기 전까지 배치(`layout`)는 그대로이고 그림만 이 값을 따른다. 둘을 따로 두는 것은
   * 줄 목록(`recent` · `projectRows` …)이 **크기 손짓만** 읽게 하려는 것이다 — 끄는 동안 포인터마다 목록을 다시 셈하지 않는다.
   *  · `drag` — 포인터의 차(`dx` · `dy` — 판 좌표)와 놓일 자리 · 안내선
   *  · `resize` — 지금 크기(`box`) — 옛 윤곽은 `orig`
   */
  type DragGesture = { kind: StartWidgetKind; startX: number; startY: number; orig: StartWidget; dx: number; dy: number; landing: Box; guides: Guide[] };
  /** `font` — 시계만: 모서리가 바꾸는 글자 크기(박스는 그 글자를 감싼다 — `clampClockResize`) */
  type ResizeGesture = { kind: StartWidgetKind; startX: number; startY: number; orig: StartWidget; box: Box; font?: number };
  let drag = $state<DragGesture | null>(null);
  let resize = $state<ResizeGesture | null>(null);

  /** 위젯의 지금 그림 상자 — 좁은 판이면 쌓인 자리, 크기를 바꾸는 중이면 그 순간의 크기 */
  function shownBox(w: StartWidget): Box {
    if (narrow) return stackBy.get(w.kind) ?? w;
    return resize?.kind === w.kind ? resize.box : w;
  }

  /** 위젯 하나에 세울 줄 수 — 그림 상자(크기를 바꾸는 중이면 그 크기)에 들어가는 만큼 */
  function capOf(kind: StartWidgetKind): number {
    const w = layout.find((x) => x.kind === kind);
    if (!w) return 0;
    const b = shownBox(w);
    return widgetCapacity(b.w, b.h);
  }

  // ---------------------------------------------------------------------------
  // 위젯의 줄들
  // ---------------------------------------------------------------------------

  /** 최근 호스트 — 접속 이력(`history.json`)에서 한 번이라도 **성공한** 곳, 늦은 순 (팔레트 "최근" 과 같은 함수) */
  const recent = $derived(recentHosts(list, hostHistory(), capOf("hosts")));

  /**
   * 프로젝트 위젯 (docs/log/2026-09-27-launcher-worktrees.md) — 프로젝트 줄과 **최근 연 워크트리** 줄을 시각 순으로 섞는다.
   * 프로젝트 줄의 시각 = 원격 호스트의 마지막 성공 접속 · 주 폴더를 마지막으로 연 시각 중 늦은 것. 에이전트 점은 독과 같은
   * 판정(`$lib/dock-dots` — 지금 폴더 → 시작 폴더, 가장 깊은 등록 폴더)이고, 프로젝트 줄은 **주 폴더 자리**의 점만 든다.
   * 그 위에서 점이 붙은 줄이 먼저(권한 대기 → 완료 → 실행 중), 위젯에 들어가는 줄 수까지.
   */
  $effect(() => restoreRecentOpens());
  const recentWorktrees = $derived(resolveRecentWorktrees(projects(), recentOpens(), worktreesOf, remoteHomeOf));
  // 적어 둔 로컬 워크트리 폴더가 아직 있나 — 뒤에서 한 번씩 묻고, 없으면 기록에서 조용히 빠진다(그리기를 막지 않는다)
  $effect(() => checkLocalRecentWorktrees(recentWorktrees));
  const projectRows = $derived.by((): LauncherProjectRow[] => {
    const history = hostHistory();
    const opens = recentOpens();
    const folders = withRecentWorktrees(dockProjectFolders(), recentWorktrees, remoteHomeOf);
    const dots = projectDots(dockAgentPanes(), folders, remoteHomeOf, t);
    const timeOf = (p: Project) => {
      const host = isRemote(p) ? (historyOf(history, p.host)?.last_ok_at ?? null) : null;
      const own = projectOpenedAt(opens, p.id);
      return host === null ? own : own === null ? host : Math.max(host, own);
    };
    return launcherProjectRows(
      sortProjects(projects(), "recent", history),
      recentWorktrees,
      timeOf,
      dots,
      folders,
      remoteHomeOf,
      capOf("projects"),
      (row) => projectMarkers(row.project, row.kind === "worktree" ? row.path : undefined).here,
    );
  });

  /** 줄 하나를 연다 — 워크트리 줄은 독 워크트리 줄의 Enter 와 같은 길(새 탭 · 시작 화면 규칙 · 탭 제목과 프로젝트 폴더) */
  function openProjectRow(row: LauncherProjectRow, here = false) {
    if (row.kind === "project") void (here ? openProjectHere : openProject)(row.project);
    else
      void (here ? openProjectWorktreeHere : openProjectWorktree)(row.project, {
        path: row.path,
        branch: row.name,
        head: null,
        bare: false,
        detached: false,
      });
  }

  /**
   * 셸 목록 — `>_` 메뉴 · `Ctrl+Shift+N` 과 **같은 캐시**(`knownShellList`). 감지는 값싸지 않아
   * (WSL 훑기) 앱이 한 번만 묻는다. 도착 전에는 위젯이 비어 있다 — "터미널" 을 먼저 그렸다가
   * "PowerShell 7" 로 바꾸면 줄이 한 번 깜빡인다.
   */
  let shellList = $state<ShellList | null>(null);
  $effect(() => {
    let alive = true;
    void knownShellList().then((l) => {
      if (alive) shellList = l;
    });
    return () => {
      alive = false;
    };
  });

  /** 지금의 기본 셸 id — `>_` 메뉴·설정·`Ctrl+Shift+N` 과 같은 규칙 하나 */
  const defaultShellId = $derived(
    shellList ? effectiveDefaultShellId(shellList.shells, settings.defaultShell, shellList.default_id) : null,
  );
  const shellCol = $derived(shellColumn(shellList?.shells ?? [], defaultShellId, capOf("shells")));

  /** 종류별 줄 */
  const itemsByKind = $derived.by(() => {
    const shellItems: Extract<LaunchItem, { kind: "shell" }>[] = shellCol.shells.map((shell) => ({
      key: `shell:${shell.id}`,
      kind: "shell",
      shell,
      isDefault: shell.id === defaultShellId,
    }));
    // 감지가 비었다(명령 실패 · 셸 없음) — "터미널" 한 줄로 백엔드 폴백에 맡긴다 (`>_` 메뉴와 같은 그물)
    if (shellList && shellItems.length === 0 && capOf("shells") > 0)
      shellItems.push({ key: "shell:", kind: "shell", shell: null, isDefault: true });
    return {
      // 시계 — 고를 줄이 없다(키보드 선택은 줄이 0 인 구역을 건너뛴다 — `launcher.ts`)
      clock: [] as LaunchItem[],
      hosts: recent.map((host): Extract<LaunchItem, { kind: "host" }> => ({ key: `host:${host.name}`, kind: "host", host })),
      projects: projectRows.map((row): Extract<LaunchItem, { kind: "project" }> => ({ key: row.key, kind: "project", row })),
      shells: shellItems,
    };
  });

  // ---------------------------------------------------------------------------
  // 선택 — 화면의 모든 줄을 지나는 **하나**
  //
  // 선택은 줄의 **키 글자**로 들고 있다(자리 번호가 아니다) — 이력이 갱신되거나 에이전트 점이
  // 바뀌어 줄 순서가 달라져도 고른 것이 그대로 남는다. 고른 줄이 사라졌으면 기본 자리(기본 셸 —
  // 그 줄의 ↵ 표시가 "지금 Enter 를 치면 이것" 이라는 뜻이다)로 돌아간다.
  //
  // 포커스는 **숨은 입력칸 하나**(`holder`)가 쥔다 — 줄은 전부 `tabindex=-1` 이고 고른 줄은
  // `aria-activedescendant` 로 가리킨다(Tab 한 번에 들어오고 한 번 더 누르면 나간다). 줄 단추를
  // 쥐던 예전 모양(roving)에서는 포커스가 편집 요소가 아니라 **Windows IME 가 꺼져 있었다** — 한글
  // 모드에서 ㅎ 을 치면 첫 키가 조합 없이 `g` 로 와 팔레트에 영문 한 글자가 찍혔다
  // (docs/log/2026-09-25-launcher.md 3절). 타일 포커스 라우팅(`[data-tile-focus]`)도 이 칸에 준다.
  //
  // 구역 = 놓인 위젯 하나(배치 순서). 구역의 사각형 · 단 수로 화살표가 위젯 사이를 오간다(`launcher.ts`).
  // ---------------------------------------------------------------------------

  const areaItems = $derived(layout.map((w): readonly LaunchItem[] => itemsByKind[w.kind]));

  const areas = $derived(
    layout.map((w, i): LauncherArea => {
      const b = shownBox(w);
      return { size: areaItems[i].length, rect: b, rows: widgetRowsPerColumn(b.h), cols: widgetColumns(b.w) };
    }),
  );

  let selKey = $state<string | null>(null);

  function posOf(key: string | null): LauncherPos | null {
    if (key === null) return null;
    for (let area = 0; area < areaItems.length; area++) {
      const index = areaItems[area].findIndex((it) => it.key === key);
      if (index >= 0) return { area, index };
    }
    return null;
  }

  /** 지금 고른 자리 — 고른 것이 없거나 사라졌으면 기본 셸, 그것도 없으면 첫 위젯의 첫 줄 */
  const selPos = $derived.by((): LauncherPos | null => {
    const at = posOf(selKey);
    if (at) return at;
    const def = itemsByKind.shells.find((it) => it.isDefault);
    return posOf(def?.key ?? null) ?? firstLauncherPos(areas);
  });
  const selected = $derived(selPos ? (areaItems[selPos.area]?.[selPos.index] ?? null) : null);

  /** 이 화면의 포커스 주인 — 편집 요소라 IME 가 켜진 채로 첫 키를 받는다(위 절) */
  let holder = $state<HTMLInputElement | null>(null);
  /** 줄의 `id` — `aria-activedescendant` 가 가리킨다. 키 글자는 아무 글자나 들어 위젯 종류 · 자리로 짓는다 */
  const uid = $props.id();
  const optId = (kind: StartWidgetKind, index: number) => `${uid}-${kind}-${index}`;
  const activeId = $derived(selPos && layout[selPos.area] ? optId(layout[selPos.area].kind, selPos.index) : undefined);

  /** 포커스를 주인에게 (넓은 판은 굴리지 않는다 — 고른 줄은 늘 보인다. 좁은 판은 화살표만 굴린다 — `moveSel`) */
  async function focusSelected() {
    await tick();
    holder?.focus({ preventScroll: true });
  }

  /**
   * 좁은 판에서 화살표로 고른 줄이 보이게 판만 굴린다. 화살표에서만 — 빈 자리를 누르거나 메뉴를 닫을 때마다 고른 줄로 끌려가면
   * 읽던 자리를 잃는다. `scrollIntoView` 를 쓰지 않는 것은 그것이 `overflow: hidden` 인 조상(타일 몸 등)까지 굴리기 때문이다.
   */
  async function revealSelected() {
    await tick();
    if (!narrow || !root || !activeId) return;
    const row = document.getElementById(activeId);
    if (!row) return;
    const r = root.getBoundingClientRect();
    const o = row.getBoundingClientRect();
    const pad = FIT_PADDING;
    if (o.top < r.top + pad) root.scrollTop -= r.top + pad - o.top;
    else if (o.bottom > r.bottom - pad) root.scrollTop += o.bottom - (r.bottom - pad);
  }

  function select(key: string) {
    selKey = key;
    void focusSelected();
  }

  function moveSel(dir: LauncherDir) {
    const next = launcherMove(areas, selPos, dir);
    const item = next ? areaItems[next.area]?.[next.index] : null;
    if (!item) return;
    select(item.key);
    void revealSelected();
  }

  /** 줄 하나를 연다 — 전부 **이미 있는 여는 함수**다 (파일 머리말). 편집 모드에서는 열지 않는다(몸 전체가 끄는 자리다) */
  function activate(item: LaunchItem) {
    if (editing) return;
    if (item.kind === "host") onconnect(item.host);
    else if (item.kind === "project") openProjectRow(item.row);
    else if (item.kind === "shell") void addLocal(item.shell ?? undefined);
  }

  /** 위젯마다의 줄 손잡이 — 선택 하나 · 여는 함수 하나를 지난다 */
  function handlersFor(kind: StartWidgetKind): LaunchRowHandlers {
    return {
      selectedKey: selected?.key ?? null,
      optId: (i) => optId(kind, i),
      onselect: select,
      onactivate: activate,
    };
  }

  /**
   * 뿌리가 포커스를 받았다(빈 자리 · 위젯의 빈 곳을 눌렀다) — 주인에게 넘긴다. 포커스 이벤트는 거품을 타지
   * 않으므로 이 처리기는 뿌리 **자신**의 포커스에만 불린다.
   */
  function onRootFocus(ev: FocusEvent) {
    if (ev.target === root) void focusSelected();
  }

  /**
   * 탭이 하나도 없을 때의 본문(②)에는 타일 포커스 라우팅이 없다 — 포커스가 `<body>` 에
   * 떨어져 있으면 스스로 한 번 받는다. 타일 안(①)에서는 라우팅이 뿌리에 준다.
   */
  $effect(() => {
    if (!root || !holder || root.closest("[data-pane]")) return;
    const active = document.activeElement;
    if (active === null || active === document.body) holder.focus({ preventScroll: true });
  });

  const DIRS: Record<string, LauncherDir> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };

  /**
   * 이 화면의 키 — 뿌리 하나에서 듣는다(포커스 주인에서 거품으로 올라온다).
   *
   * 다루는 것만 멈춰 세우고 나머지는 창의 전역 처리기로 흘려보낸다 — 시작 화면이 떠 있는 동안
   * 전역 단축키(`Ctrl+Shift+*` · `Alt+화살표` = 타일 포커스 이동)가 죽으면 안 된다.
   * 조합은 `ev.code`(물리 키)로 가른다 — 한국어 IME 가 켜져 있어도 살아 있어야 한다.
   */
  function onKeydown(ev: KeyboardEvent) {
    if (ev.defaultPrevented) return;
    const target = ev.target instanceof Element ? ev.target : null;

    // 편집 모드의 Esc = 나오기(끄는 중이면 손짓의 귀가 먼저 받아 그 손짓만 거둔다 — `startGesture`)
    if (editing && ev.key === "Escape" && !drag && !resize) {
      ev.preventDefault();
      ev.stopPropagation();
      editing = false;
      return;
    }

    if (ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && (ev.code === "Enter" || ev.code === "NumpadEnter")) {
      if (selected?.kind === "project") {
        ev.preventDefault(); ev.stopPropagation(); openProjectRow(selected.row, true); return;
      }
    }

    if (!ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      const dir = DIRS[ev.code];
      if (dir) {
        ev.preventDefault();
        moveSel(dir);
        return;
      }
      // Enter · 스페이스 — 포커스 주인 위에서(또는 뿌리 · 줄 단추). 빈 판의 [위젯 추가] 는 자기 기본 동작 그대로.
      // 스페이스는 예전 줄 단추의 기본 뜻(누르기)을 이어받는다 — 주인은 입력칸이라 그대로 두면 빈칸이 찍힌다.
      const onBody = target === holder || target === root || !!target?.hasAttribute("data-launch-key");
      if ((ev.code === "Enter" || ev.code === "NumpadEnter" || ev.code === "Space") && onBody) {
        ev.preventDefault();
        if (selected) activate(selected);
        return;
      }
    }

    // ── 글자를 치면 팔레트 (친 글자를 싣고 — `launcherSeed`) ──────────────────────────
    // IME 조합 시작(`Process` → `""`)은 여기서 아무것도 하지 않는다 — 기본 동작을 그대로 두면 조합이
    // 포커스 주인에서 시작되고, 그 `compositionstart` 가 팔레트를 거울 모드로 연다(아래 절).
    const seed = launcherSeed(ev);
    if (seed) {
      ev.preventDefault();
      openPalette(seed);
    }
  }

  // ---------------------------------------------------------------------------
  // 한글 IME — 조합은 포커스 주인에서, 팔레트는 비추기만 (docs/log/2026-09-25-launcher.md 3절)
  //
  // 조합 중에 포커스를 다른 편집 요소로 옮기면 Chromium 이 IME 조합을 **취소**한다(브라우저 쪽이
  // 포커스 변경 때 조합을 취소한다) — 첫 자모가 사라지거나 쪼개진다. 그래서 조합이 이어지는 동안
  // 포커스는 주인에 그대로 두고, 팔레트를 **거울 모드**로 열어 주인의 값을 질의로 비춘다(결과 목록이
  // 친 대로 걸러진다). 조합이 **아닌** 키가 처음 오는 순간 — 그때는 조합이 없으니 옮겨도 안전하다 —
  // 거울을 걷고 팔레트 입력칸이 포커스와 글자를 넘겨받는다(`handOver`).
  // ---------------------------------------------------------------------------

  /** 팔레트가 스스로 처리하는 키 — 넘겨받은 뒤 그 keydown 을 팔레트에 한 번 더 보낸다 */
  const PALETTE_KEYS = new Set(["Escape", "ArrowUp", "ArrowDown", "Enter"]);

  /** 주인에서 조합이 진행 중인가 (`compositionstart` ~ `compositionend`) */
  let composing = false;

  function onCompositionStart() {
    composing = true;
    if (paletteMirror() !== null) return;
    openPalette("", { mirror: true });
  }

  function onCompositionEnd() {
    composing = false;
    if (!holder) return;
    if (paletteMirror() !== null) mirrorPaletteQuery(holder.value);
    else holder.value = ""; // 거울이 이미 걷혔다(팔레트가 닫혔다) — 이 칸은 글자를 쥐지 않는다
  }

  function onHolderInput() {
    if (!holder) return;
    if (paletteMirror() !== null) mirrorPaletteQuery(holder.value);
    else if (!composing) holder.value = ""; // 거울이 아닌데 글자가 들어왔다(붙여넣기 등)
  }

  /**
   * 거울 모드 동안 주인에 온 조합 아닌 키 — 팔레트에 넘긴다. 이 keydown **안에서** 포커스까지
   * 옮긴다(`flushSync` → 팔레트의 포커스 `$effect`): 글자·Backspace 는 질의에 반영해 싣고, 팔레트가
   * 다루는 키(↑↓ · Enter · Escape · 수식 조합)는 같은 키를 팔레트 입력칸에 다시 보내며, 나머지
   * (←→ · Home/End …)는 기본 동작이 옮겨 간 입력칸에서 그대로 돈다.
   */
  function handOver(ev: KeyboardEvent) {
    if (!holder) return;
    let text = holder.value;
    const mods = ev.ctrlKey || ev.altKey || ev.metaKey;
    const printable = !mods && ev.key.length === 1;
    const backspace = !mods && ev.key === "Backspace";
    if (printable) text += ev.key;
    else if (backspace) text = text.slice(0, -1);
    const forward = !printable && !backspace && (mods || PALETTE_KEYS.has(ev.key));
    if (printable || backspace || forward) {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 전역 처리기(Escape 사슬 등)가 같은 키를 한 번 더 먹지 않게
    }
    // 질의를 먼저 싣고(팔레트의 거울 `$effect`) 그다음 거울을 걷는다 — 순서가 뒤집히면 마지막 글자가 빠진다
    mirrorPaletteQuery(text);
    flushSync();
    releasePaletteMirror();
    holder.value = "";
    flushSync();
    if (!forward) return;
    const to = document.activeElement;
    if (to && to !== holder)
      to.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ev.key,
          code: ev.code,
          ctrlKey: ev.ctrlKey,
          shiftKey: ev.shiftKey,
          altKey: ev.altKey,
          metaKey: ev.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
  }

  /** 주인의 keydown — 거울 모드면 IME 에 맡기거나 넘기고, 아니면 뿌리의 `onKeydown` 이 거품으로 받는다 */
  function onHolderKeydown(ev: KeyboardEvent) {
    if (paletteMirror() === null) return;
    if (ev.isComposing || ev.key === "Process") {
      ev.stopPropagation(); // 조합 중 — IME 의 키다(뿌리의 화살표 = 줄 선택이 돌면 안 된다)
      return;
    }
    handOver(ev);
    ev.stopPropagation();
  }

  /** 주인이 포커스를 잃었다(팔레트 줄·입력칸을 눌렀다 등) — 거울을 걷고 칸을 비운다 */
  function onHolderBlur() {
    if (paletteMirror() !== null) releasePaletteMirror();
    if (holder && !composing) holder.value = "";
  }

  // ---------------------------------------------------------------------------
  // 옮기기 · 크기 바꾸기 — 포인터 손짓
  //
  // 누르는 순간 창에 듣는 귀를 달고(놓으면 뗀다) 손짓 하나(`drag` · `resize`)를 세운다. 움직이는 동안은 순수 셈
  // (`dragLanding` · `clampResize` — `start-widgets.ts`)만 돌고 배치는 놓을 때 한 번 갈아 끼운다(저장도 그때).
  // 판이 줄어 있으면(`scale` < 1) 포인터의 차를 배율로 나눠 판 좌표로 옮긴다.
  // ---------------------------------------------------------------------------

  /** 손짓 동안 창에 단 귀를 떼는 손잡이 */
  let detach: (() => void) | null = null;

  function othersOf(kind: StartWidgetKind): StartWidget[] {
    return layout.filter((w) => w.kind !== kind);
  }

  /**
   * **옮기기의 시작은 문턱을 넘을 때다**(2026-11-03 — 따로 있던 끌 손잡이를 걷었다). 목록 위젯은 머리 줄, 시계(머리 줄 없음)는
   * 몸 어디를 눌러도 여기로 온다(`StartWidgetFrame` 의 `ongrip`). 누르는 순간에는 귀만 달고, 포인터가 [`DRAG_THRESHOLD`] 를
   * 넘게 움직여야 끌기가 선다 — 그 전에 떼면 아무 일도 없어 머리 줄의 × 클릭이 그대로 산다. 기본 동작을 막지 않는다(클릭 ·
   * 포커스가 평소대로). 줄 단추 · × · 크기 모서리 위에서 누른 것은 끌기가 아니다(줄 클릭 · 선택 · 빼기 · 크기 바꾸기가 먼저).
   */
  const DRAG_THRESHOLD = 4;

  function armDrag(w: StartWidget, ev: PointerEvent) {
    // 좁은 판은 쌓아 그린 자리라 저장된 배치의 좌표와 맞지 않는다 — 프레임도 귀를 달지 않지만 여기서도 막는다
    if (ev.button !== 0 || drag || resize || narrow || detach || !editing) return;
    const target = ev.target instanceof Element ? ev.target : null;
    // 편집 중엔 줄 위에서도 끈다(휴대폰 홈 화면처럼 — 줄은 실행되지 않는다 · `activate`). × · 모서리는 제 일
    if (target?.closest("[data-widget-remove], [data-widget-resize]")) return;
    const sx = ev.clientX;
    const sy = ev.clientY;
    const disarm = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", disarm);
      window.removeEventListener("pointercancel", disarm);
      window.removeEventListener("blur", disarm);
      if (detach === disarm) detach = null;
    };
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) < DRAG_THRESHOLD) return;
      disarm();
      window.getSelection()?.removeAllRanges(); // 누른 채 움직이는 동안 머리 줄 글자가 잡혔으면 걷는다
      startGesture("drag", w, sx, sy);
      onGestureMove(e);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", disarm);
    window.addEventListener("pointercancel", disarm);
    window.addEventListener("blur", disarm);
    detach = disarm;
  }

  /** 크기 모서리 — 누르는 순간 바로 선다(모서리는 다른 뜻이 없다) */
  function beginResize(w: StartWidget, ev: PointerEvent) {
    if (ev.button !== 0 || drag || resize || narrow) return;
    ev.preventDefault();
    ev.stopPropagation();
    detach?.();
    startGesture("resize", w, ev.clientX, ev.clientY);
  }

  function startGesture(type: "drag" | "resize", w: StartWidget, startX: number, startY: number) {
    const base = { kind: w.kind, startX, startY, orig: { ...w } };
    const box = { x: w.x, y: w.y, w: w.w, h: w.h };
    if (type === "drag") drag = { ...base, dx: 0, dy: 0, landing: box, guides: [] };
    else resize = { ...base, box, font: w.kind === "clock" ? clockOptions().size : undefined };
    const move = (e: PointerEvent) => onGestureMove(e);
    const up = () => endGesture(true);
    const cancel = () => endGesture(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      endGesture(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", cancel);
    detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    };
  }

  function onGestureMove(ev: PointerEvent) {
    const g = drag ?? resize;
    if (!g) return;
    const s = scale > 0 ? scale : 1;
    const dx = (ev.clientX - g.startX) / s;
    const dy = (ev.clientY - g.startY) / s;
    const others = othersOf(g.kind);
    if (drag) {
      const { landing, guides } = dragLanding(drag.orig, dx, dy, others, bounds);
      drag = { ...drag, dx, dy, landing, guides };
    } else if (resize?.kind === "clock") {
      const opts = clockOptions();
      const lang = locale();
      const r = clampClockResize(resize.orig, opts.size, resize.orig.w + dx, resize.orig.h + dy, others, bounds, (size) =>
        clockBoxSize(lang, { ...opts, size }),
      );
      resize = { ...resize, box: r.box, font: r.font };
    } else if (resize) {
      resize = { ...resize, box: clampResize(resize.orig, resize.orig.w + dx, resize.orig.h + dy, others, bounds) };
    }
  }

  /** 손짓을 끝낸다 — `commit` 이면 놓인 자리 · 크기를 배치에 넣고 저장한다(바뀐 것이 있을 때만) */
  function endGesture(commit: boolean) {
    const g = drag
      ? { kind: drag.kind, orig: drag.orig, next: drag.landing, font: undefined }
      : resize
        ? { kind: resize.kind, orig: resize.orig, next: resize.box, font: resize.font }
        : null;
    detach?.();
    detach = null;
    drag = null;
    resize = null;
    if (!g || !commit) return;
    const { next, orig: o } = g;
    // 시계의 크기 = 글자 크기 — 표시에 저장하고(박스는 그 글자를 감싼 값이라 아래에서 배치에도 들어간다). 둘을 한 조작으로 기록한다
    editStartBoard(() => {
      if (g.font !== undefined && g.font !== clockOptions().size) setClockOptions({ ...clockOptions(), size: g.font });
      if (next.x !== o.x || next.y !== o.y || next.w !== o.w || next.h !== o.h)
        setStartWidgets(withWidgetBox(layout, g.kind, next));
    });
    void focusSelected();
  }

  $effect(() => () => detach?.());

  /**
   * **시계 박스 = 글자를 감싼 크기** — 표시(12/24시간 · 초 · 날짜 · 글자 크기) · 언어가 바뀌면 배치의 시계 `w` · `h` 를 그 박스로
   * 다시 맞춘다(가운데를 지키고, 부딪히면 시계가 가장 가까운 빈자리로 — `withWidgetSize`). 손짓 동안은 건드리지 않는다. 맞춘 뒤에는
   * 같은 값이라 다시 돌지 않는다.
   */
  $effect(() => {
    const clock = layout.find((w) => w.kind === "clock");
    if (!clock || drag || resize) return;
    const want = clockBoxSize(locale(), clockOptions());
    if (clock.w === want.w && clock.h === want.h) return;
    setStartWidgets(withWidgetSize(layout, "clock", want, narrow ? null : bounds));
  });

  // 손짓 도중 판이 좁아졌다(타일을 나눴다 등) — 그 손짓은 넓은 판의 좌표라 놓지 않고 거둔다
  $effect(() => {
    if (narrow && (drag || resize)) endGesture(false);
  });

  /** 위젯 종류의 제목 */
  function kindTitle(kind: StartWidgetKind): string {
    return t(
      kind === "clock"
        ? "app.start.col.clock"
        : kind === "hosts"
          ? "app.start.col.hosts"
          : kind === "projects"
            ? "app.start.col.projects"
            : "app.start.col.shells",
    );
  }

  /** × — 빼기(되돌리기는 판 · 시계 우클릭 메뉴의 [되돌리기] — 지운 시계는 그때의 표시까지 돌아온다) */
  function removeWidget(kind: StartWidgetKind) {
    editStartBoard(() => setStartWidgets(withoutWidget(layout, kind)));
    void focusSelected();
  }

  // ---------------------------------------------------------------------------
  // 판 메뉴 — 빈 자리 우클릭(위젯을 더하는 길은 이것 하나)
  // ---------------------------------------------------------------------------

  let menu = $state<{ x: number; y: number } | null>(null);
  /**
   * 더할 위젯의 자리(판 좌표) — 메뉴를 열 때 적어 둔다. 메뉴 상태(`menu`)와 따로 두는 것은 항목이 **메뉴를 닫은 뒤에**
   * 돌기 때문이다(`menu-runner` — 스냅샷 → 닫기 → 실행). 닫힌 메뉴의 값을 읽지 않게 평범한 변수다.
   */
  let addAt = { x: 0, y: 0 };

  /** 창 좌표 → 판 좌표(판 가운데 기준 · 배율로 나눔) */
  function toBoard(clientX: number, clientY: number): { x: number; y: number } {
    const r = root?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    const s = scale > 0 ? scale : 1;
    return { x: (clientX - (r.left + r.width / 2)) / s, y: (clientY - (r.top + r.height / 2)) / s };
  }

  /**
   * 판 우클릭 (2026-11-03 사용자 결정)
   *  · 빈 자리 = 판 메뉴(위젯 추가 · 배치 편집 · 편집 중 되돌리기 · 레이아웃 리셋)
   *  · 위젯 위 = 위젯 메뉴(`StartWidgetMenu`) — 그 위젯의 설정(시계만 — 12/24시간 · 초 · 날짜) + 평소에만 [배치 편집].
   *    판을 고치는 줄은 위젯 메뉴에 두지 않는다. 편집 중이라 줄이 하나도 없으면 메뉴를 띄우지 않는다(되돌리기 · 리셋 · 완료는 판 위 단추 줄).
   * 안쪽이 이미 제 메뉴를 띄웠으면(`defaultPrevented`) 손대지 않는다.
   */
  function onBoardContextMenu(ev: MouseEvent) {
    const target = ev.target instanceof Element ? ev.target : null;
    if (drag || resize || ev.defaultPrevented) return;
    // 원격 창은 집 PC 한 벌을 따른다 — 편집의 유일한 입구가 이 메뉴다
    if (!startBoardEditable()) {
      ev.preventDefault();
      return;
    }
    const widget = target?.closest<HTMLElement>("[data-start-widget]");
    if (widget) {
      ev.preventDefault();
      menu = null;
      const clock = widget.dataset.startWidget === "clock";
      widgetMenu = clock || !editing ? { x: ev.clientX, y: ev.clientY, clock } : null;
      return;
    }
    ev.preventDefault();
    widgetMenu = null;
    // 좁은 판의 누른 자리는 저장된 배치의 어디와도 맞지 않는다 — 판 가운데 조금 위로 둔다
    addAt = narrow ? { x: 0, y: -LAYOUT_LIFT } : toBoard(ev.clientX, ev.clientY);
    menu = { x: ev.clientX, y: ev.clientY };
  }

  function closeMenu() {
    menu = null;
    void focusSelected();
  }

  // ---------------------------------------------------------------------------
  // 편집 모드 (2026-11-03 — 휴대폰 홈 화면처럼)
  //
  // 평소(잠김)에는 끌기 · 크기 바꾸기 · × 가 없다(호버해도 드러나지 않는다 — 줄 클릭 · 키보드 선택 · 우클릭 메뉴는 그대로). 판 · 시계
  // 우클릭 메뉴의 [배치 편집]으로 들어가면 모든 위젯에 윤곽 · × · 크기 모서리가 한꺼번에 서고 몸 어디를 끌어도 옮겨진다(줄은
  // 실행되지 않는다). 나오기 = 판 위 [완료] · Esc(끄는 중이 아닐 때) · 이 시작 화면이 안 보이게 됨(탭 전환 ·
  // 타일 바뀜). 저장하지 않는다(이 시작 화면의 메모리 — 다시 켜면 잠김). 판 메뉴의 [위젯 추가]도 편집 중에만 뜬다
  // (2026-11-03 사용자 결정 — 배치를 고치는 줄은 모두 편집 모드 안). 위젯 밖 빈 자리 누르기로는 나오지 않는다(2026-11-03 사용자 결정 — 잘못 누르면 바로 나가져서).
  // ---------------------------------------------------------------------------

  let editing = $state(false);

  function toggleEditing() {
    editing = !editing;
  }

  // 이 시작 화면이 안 보이게 되면(다른 탭 · 타일이 바뀜 · 줌에 가림) 편집 모드도 끝
  $effect(() => {
    if (!editing || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.every((e) => !e.isIntersecting)) editing = false;
    });
    io.observe(root);
    return () => io.disconnect();
  });

  /** 위젯 위 우클릭 메뉴 — 연 자리(창 좌표) · 시계인가(시계면 표시 옵션 줄이 붙는다) */
  let widgetMenu = $state<{ x: number; y: number; clock: boolean } | null>(null);

  function closeWidgetMenu() {
    widgetMenu = null;
    void focusSelected();
  }

  /** 레이아웃 리셋 — 판 메뉴 · 편집 단추 줄이 같이 쓴다(되돌리기 기록에 남는다) */
  function resetBoard() {
    editStartBoard(resetStartWidgets);
  }

  /**
   * 더하기 — 저장된 배치에 넣는다. 좁은 판에서는 경계 없이(`null`) 넣는다: 좁은 판의 판 크기로 잰 경계는 저장된 배치의 좌표와
   * 상관이 없고, 그 안에 가두면 배치가 판보다 큰 지금은 빈자리가 없어 엉뚱한 데로 밀린다. 경계 없이 넣은 자리는 다음에 판이
   * 넓어졌을 때 `fitScale` 이 맡는다(들어갈 만큼 줄이거나, 그래도 작으면 다시 좁은 판).
   */
  function addWidget(kind: StartWidgetKind) {
    editStartBoard(() => setStartWidgets(withNewWidget(layout, kind, addAt, narrow ? null : bounds)));
  }
</script>

<!--
  타일 안(`.pane-body`)에서도 빈 본문(`main`)에서도 같은 `position:absolute; inset:0` 이다 — 이 뿌리가 곧 **판**이다.

  `tabindex="-1"` — 빈 자리를 누르면 포커스가 여기 떨어지고, 여기서 포커스 주인(숨은 입력칸)으로
  넘긴다(`onRootFocus`). **타일의 키보드 몸**(`data-tile-focus`)은 뿌리가 아니라 그 주인이다.
-->
<div
  class="start"
  class:narrow
  role="presentation"
  tabindex="-1"
  data-launcher
  data-start-narrow={narrow ? "" : undefined}
  bind:this={root}
  bind:contentRect={boardRect}
  onfocus={onRootFocus}
  onfocusin={touchNow}
  onpointerenter={touchNow}
  onkeydown={onKeydown}
  oncontextmenu={onBoardContextMenu}
  data-start-editing={editing ? "" : undefined}
>
  <!--
    **포커스 주인** — 이 화면의 키보드 몸(`data-tile-focus`)이자 Tab 정거장 하나. 눈에 보이지 않는
    입력칸이다(`display:none` 이 아니다 — 포커스를 받아야 한다). 편집 요소라 Windows IME 가 켜진
    채로 첫 키를 받고, 조합은 여기서 시작된다(거울 모드 — 위 script 의 IME 절). 판 위쪽 가운데 — 팔레트가 서는
    자리(캔버스 위 + 높이 12% · 가로 가운데 · 폭 560) — 에 겹쳐 두어 IME 후보 창이 팔레트 입력칸 근처에 뜬다.
    고른 줄은 `aria-activedescendant` 가 가리킨다. `data-ime-proxy` — 편집 필드로 치지 않는다(전역 단축키가 그대로
    먹는다 · `isEditableTarget`).
  -->
  <input
    class="holder"
    type="text"
    bind:this={holder}
    data-tile-focus
    data-ime-proxy
    aria-label={t("app.start.list.aria")}
    aria-activedescendant={activeId}
    autocomplete="off"
    autocorrect="off"
    spellcheck="false"
    onkeydown={onHolderKeydown}
    oncompositionstart={onCompositionStart}
    oncompositionend={onCompositionEnd}
    oninput={onHolderInput}
    onblur={onHolderBlur}
  />

  <!-- 판 가운데가 (0, 0) 인 무대 — 작은 창이면 통째로 줄인다(`fitScale`). 위젯 · 윤곽 · 안내선은 모두 이 좌표계.
       좁은 판이면 굴리는 내용의 왼쪽 위가 (0, 0) 이고 높이가 쌓인 덩어리의 높이다(그 높이로 뿌리가 굴린다 — `narrowStack`) -->
  <div
    class="stage"
    class:narrow
    style:transform={scale < 1 ? `scale(${scale})` : undefined}
    style:--start-scale={scale}
    style:height={stack ? `${stack.height}px` : undefined}
    data-start-scale={scale}
  >
    {#if drag}
      <!-- 놓일 자리 — 점선 윤곽 -->
      <div
        class="outline landing"
        style:width="{drag.landing.w}px"
        style:height="{drag.landing.h}px"
        style:transform="translate({drag.landing.x}px, {drag.landing.y}px)"
        data-widget-landing
      ></div>
      {#each drag.guides as g (g.axis + g.at)}
        <div
          class="guide {g.axis}"
          style:transform={g.axis === "x" ? `translate(${g.at}px, ${g.from}px)` : `translate(${g.from}px, ${g.at}px)`}
          style:width={g.axis === "y" ? `${g.to - g.from}px` : undefined}
          style:height={g.axis === "x" ? `${g.to - g.from}px` : undefined}
          data-widget-guide={g.axis}
        ></div>
      {/each}
    {:else if resize}
      <!-- 옛 크기 — 점선 윤곽 · 보이는 줄 수 말풍선 -->
      <div
        class="outline previous"
        style:width="{resize.orig.w}px"
        style:height="{resize.orig.h}px"
        style:transform="translate({resize.orig.x}px, {resize.orig.y}px)"
      ></div>
      <!-- 시계는 줄이 없어 줄 수 말풍선이 없다(숫자가 위젯 크기를 따라 커지는 것이 곧 미리보기다) -->
      {#if resize.kind !== "clock"}
        <div
          class="size-tip"
          style:transform="translate({resize.box.x + resize.box.w + 8}px, {resize.box.y + resize.box.h - 24}px)"
          data-widget-size-tip
        >
          {t("app.start.widget.rows", { n: widgetCapacity(resize.box.w, resize.box.h) })}
        </div>
      {/if}
    {/if}

    {#each layout as w (w.kind)}
      {@const box = shownBox(w)}
      {@const items = itemsByKind[w.kind]}
      <StartWidgetFrame
        kind={w.kind}
        title={kindTitle(w.kind)}
        {box}
        offset={drag?.kind === w.kind ? { dx: drag.dx, dy: drag.dy } : null}
        mode={drag?.kind === w.kind ? "drag" : resize?.kind === w.kind ? "resize" : null}
        fixed={narrow}
        {editing}
        bare={w.kind === "clock"}
        rows={widgetRowsPerColumn(box.h)}
        count={items.length}
        empty={w.kind === "hosts"
          ? t("app.start.empty.hosts")
          : w.kind === "projects"
            ? t("app.start.empty.projects")
            : ""}
        ongrip={(ev) => armDrag(w, ev)}
        onresize={(ev) => beginResize(w, ev)}
        onremove={() => removeWidget(w.kind)}
      >
        {#if w.kind === "clock"}
          <ClockWidget options={clockOptions()} font={resize?.kind === "clock" ? resize.font : undefined} />
        {:else if w.kind === "hosts"}
          <HostsWidget items={itemsByKind.hosts} handlers={handlersFor("hosts")} {now} />
        {:else if w.kind === "projects"}
          <ProjectsWidget items={itemsByKind.projects} handlers={handlersFor("projects")} />
        {:else if w.kind === "shells"}
          <ShellsWidget items={itemsByKind.shells} handlers={handlersFor("shells")} />
        {/if}
      </StartWidgetFrame>
    {/each}
  </div>

  {#if editing}
    <!-- 편집 모드 단추 줄 — 판 위쪽 가운데(위젯보다 위 층 · 포커스를 가져가지 않는다): 되돌리기 · 완료 · 레이아웃 리셋
         (2026-11-03 사용자 — 판 메뉴의 편집 중 두 줄과 같은 동작 · 아이콘만, 이름은 툴팁 · 읽기 이름으로) -->
    <div class="edit-bar" data-start-edit-bar>
      <button
        type="button"
        class="btn"
        data-start-edit-undo
        disabled={!canUndoStartBoard()}
        title={t("app.start.board.menu.undo")}
        aria-label={t("app.start.board.menu.undo")}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={undoStartBoard}><UiIcon name="undo" size={16} /></button
      >
      <button
        type="button"
        class="btn btn-primary"
        data-start-edit-done
        title={t("app.start.board.edit.done")}
        aria-label={t("app.start.board.edit.done")}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={() => (editing = false)}><UiIcon name="check" size={16} /></button
      >
      <button
        type="button"
        class="btn"
        data-start-edit-reset
        title={t("app.start.board.menu.reset")}
        aria-label={t("app.start.board.menu.reset")}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={resetBoard}><UiIcon name="reset" size={16} /></button
      >
    </div>
  {/if}
</div>

{#if menu}
  <StartBoardMenu
    x={menu.x}
    y={menu.y}
    placed={placedKinds}
    onclose={closeMenu}
    onadd={addWidget}
    canUndo={canUndoStartBoard()}
    onundo={undoStartBoard}
    onreset={resetBoard}
    {editing}
    onedit={toggleEditing}
  />
{/if}

{#if widgetMenu}
  <StartWidgetMenu
    x={widgetMenu.x}
    y={widgetMenu.y}
    clock={widgetMenu.clock ? clockOptions() : null}
    onclose={closeWidgetMenu}
    onpick={setClockOptions}
    {editing}
    onedit={() => (editing = true)}
  />
{/if}

<style>
  /* 편집 모드의 단추 줄 — 판 위쪽 가운데(글래스 부품 · 알약은 `.btn` 공용 모양). 위젯 위 층 */
  .edit-bar {
    position: absolute;
    top: var(--space-3);
    left: 50%;
    z-index: 5;
    display: flex;
    gap: var(--space-2);
    transform: translateX(-50%);
    white-space: nowrap;
  }

  /* 아이콘만 — 정사각(높이는 `.btn` 의 28px) */
  .edit-bar .btn {
    width: 28px;
    padding: 0;
  }

  /*
   * 배경을 **칠하지 않는다** — 이 화면은 `.pane-box.chrome` 안에 들어가는데, 불투명한 판을
   * 깔면 창 투명도 슬라이더를 내려도 이 자리만 안 비친다. 칠해지는 것은 위젯 카드 · 손이 올라간 줄 · 고른 줄뿐이다.
   * 굴리지 않는다(`overflow: hidden`) — 작은 창은 배치를 통째로 줄인다(`fitScale`). 좁은 판만 세로로 굴린다(가로는 아니다 —
   * 카드 폭이 판에 맞춰 줄었다). 굴리는 상자는 흐림을 막지 않는다(막는 것은 조상의 `opacity` · `filter` · `clip-path` · `mask`).
   */
  .start {
    position: absolute;
    inset: 0;
    overflow: hidden;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    outline: none;
  }

  .start.narrow {
    overflow-x: hidden;
    overflow-y: auto;
  }

  /* 포커스 주인 — 팔레트가 서는 자리(가로 가운데 · 위 12% · 폭 560 · 높이 48)에 겹친 보이지 않는 입력칸. 글자 · 커서 · 조합 밑줄이
     보이지 않고 손도 닿지 않는다. 커서 자리는 팔레트 입력칸의 글자 시작점(안쪽 16 + 아이콘 16 + 틈 12) — IME 후보 창이 그 아래,
     거울 모드로 뜬 팔레트 입력칸 자리에 선다 */
  .holder {
    position: absolute;
    top: 12%;
    left: 50%;
    box-sizing: border-box;
    width: min(var(--palette-w), calc(100% - 2 * var(--space-4)));
    height: 48px;
    margin: 0;
    padding: 0 var(--space-4) 0 calc(var(--space-4) + 16px + var(--space-3));
    font-family: inherit;
    font-size: var(--t-md);
    color: transparent;
    caret-color: transparent;
    background: transparent;
    border: 0;
    outline: none;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-50%);
  }

  /* 무대 — 판 가운데의 0 × 0 점. 위젯은 여기서 `translate()` 로 선다. 줄일 때의 중심도 이 점이다 */
  .stage {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    transform-origin: 0 0;
  }

  /* 좁은 판의 무대 — 뿌리의 흐름 안에 서는 내용 상자(폭 = 판, 높이 = 쌓인 덩어리)라 그 높이만큼 뿌리가 굴린다 */
  .stage.narrow {
    position: relative;
    top: 0;
    left: 0;
    width: 100%;
  }

  /* 점선 윤곽 — 놓일 자리 · 옛 크기 */
  .outline {
    position: absolute;
    top: 0;
    left: 0;
    box-sizing: border-box;
    border: 1.5px dashed color-mix(in srgb, var(--accent) 70%, transparent);
    border-radius: var(--radius-surface);
    pointer-events: none;
  }

  .outline.landing {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .outline.previous {
    border-color: var(--line-strong);
  }

  /* 맞춤 안내선 — 이웃과 변 · 가운데가 맞는 줄 */
  .guide {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .guide.x {
    width: 0;
    border-left: 1px dashed var(--accent);
  }

  .guide.y {
    height: 0;
    border-top: 1px dashed var(--accent);
  }

  /* 크기 말풍선 — 보이는 줄 수 */
  .size-tip {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 3;
    padding: 2px var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
    white-space: nowrap;
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-raised);
    pointer-events: none;
  }

</style>
