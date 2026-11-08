<script lang="ts">
  import { untrack } from "svelte";
  import { LOCAL_KEY, type BackendPlace, type DiskSpace, type FsBackend } from "$lib/fs-backend";
  import { fsClip } from "$lib/fs-clipboard.svelte";
  import { fsRefreshSignal } from "$lib/fs-refresh.svelte";
  import { watchPathsOf, watchSwitchDelay, watchWanted } from "$lib/fs-auto-refresh";
  import { windowActive } from "$lib/app/window-active.svelte.js";
  import type { FsWatch } from "$lib/fs-watch";
  import type { OnConflict } from "$lib/fs-ops";
  import { isHidden, type SftpEntry } from "$lib/sftp-browser";
  import {
    entryOrder,
    fileTreeRows,
    filterRows,
    navOrder as navOrderOf,
    targetDirOf,
    type FileTreeRow,
  } from "$lib/file-tree";
  import { DEFAULT_FILE_ZOOM, type FileUiPatch, type FileView } from "$lib/session";
  import {
    folderSummary,
    iconZoomScale,
    selectionSummary,
    stepIconZoom,
  } from "$lib/browser/file-view";
  import { stripReason } from "$lib/error-reason";
  import { createNav } from "$lib/browser/nav-controller.svelte";
  import BrowserToolbar from "$lib/browser/BrowserToolbar.svelte";
  import BrowserNav from "$lib/browser/BrowserNav.svelte";
  import BrowserViewPick from "$lib/browser/BrowserViewPick.svelte";
  import {
    fileMenuTools,
    toPaneMenuItems,
    type ToolbarTool,
  } from "$lib/browser/toolbar-tools";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { filePlacesLayout } from "$lib/pane/head-span";
  import LocationBar from "$lib/browser/LocationBar.svelte";
  import PlacesPanel from "$lib/browser/PlacesPanel.svelte";
  import FilterBar from "$lib/browser/FilterBar.svelte";
  import FileStatusBar from "$lib/browser/FileStatusBar.svelte";
  import PreviewPanel from "$lib/browser/PreviewPanel.svelte";
  import { previewSubject } from "$lib/browser/preview";
  import { placeSections } from "$lib/browser/places";
  import FileList from "$lib/browser/FileList.svelte";
  import FileMenu from "$lib/browser/FileMenu.svelte";
  import TransferPanel from "$lib/browser/TransferPanel.svelte";
  import { createSelection } from "$lib/browser/selection-controller.svelte";
  import { boxesIn, createMarquee } from "$lib/browser/marquee.svelte";
  import { createTransfers } from "$lib/browser/fs-transfer.svelte";
  import { createDragController } from "$lib/browser/drag-controller.svelte";
  import { failureOf, FileListing } from "$lib/browser/file-listing.svelte";
  import { FileMenuController } from "$lib/browser/file-menu-controller.svelte";
  import { FileActions } from "$lib/browser/file-actions";
  import { FileKeys } from "$lib/browser/file-keys";
  import { displayCombo, effectiveCombo, resolveBindings } from "$lib/keybindings";
  import { registerTileFind } from "$lib/app/tile-find";
  import { settings } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **파일 브라우저** — 타일 하나를 채우는 파일 목록. 원격(SFTP)과 **로컬 디스크**가
   * 같은 화면을 쓴다 (docs/log/2026-09-03-sftp-browser-tile.md ·
   * docs/log/2026-09-03-local-fs-tile.md).
   *
   * ## 여기 남은 것은 **상태 배선과 백엔드 호출**뿐이다
   *
   * 그림(줄·툴바·빵부스러기·메뉴·전송 막대)과 기계장치(선택·러버밴드·드래그·전송)는
   * `$lib/browser/` 로 내려갔다 (docs/log/2026-09-05-refactor-browsers.md). 그 조각들은
   * 세션 타일(`Sidebar.svelte`)과 나눠 쓰는 것이거나, 이 타일의 것이지만 화면이 아닌 것이다.
   *
   * ## 어디를 보는지는 [`backend`] 만 안다
   *
   * 이 컴포넌트에는 `sftp_*` 도 `local_*` 도 없고 세션 id 도 없다 — 명령 묶음과 경로
   * 문법(`/` ↔ `\`)과 **할 수 있는 일**(업로드·다운로드·기본 앱으로 열기…)이 전부
   * [`FsBackend`] 한 값에 담겨 프롭으로 내려온다. 화면이 `kind === "localfs"` 같은 검사를
   * 하나도 하지 않는 것이 요점이다: 백엔드가 하나 늘어도 여기는 그대로다.
   *
   * ## 세션을 빌린다 (원격일 때)
   *
   * 원격 백엔드는 세션을 **열지 않는다**. 자기를 연 터미널 타일이 물고 있는 세션을
   * 상위(`+page` 의 패널→세션 맵)가 매 프레임 조회해 내려 준다. 그래서 배선 하나로
   * 세 가지가 저절로 풀린다:
   *
   * - 원본 터미널이 `exit` 로 죽으면 `backend.online` 이 거짓이 되어 **대기 배너**가 뜬다.
   * - 원본이 재연결되면 백엔드의 [`FsBackend.key`] 가 바뀌고, 아래 `$effect` 가 그것을
   *   알아채 **보고 있던 경로를 그대로 다시 읽는다**.
   * - 원본 타일 자체가 사라지면 `sourceGone` 이 참이 되어 다른 배너가 뜬다. 이 둘은
   *   **다른 상태**다: 하나는 기다리면 돌아오고 하나는 돌아오지 않는다.
   *
   * ## 오류를 삼키지 않는다
   *
   * 목록을 못 읽었을 때 빈 목록을 그리면 사용자는 **디렉터리가 비어 있다고 믿는다**.
   * 권한이 없는 것과 아무것도 없는 것은 화면에서 반드시 달라야 하므로, 실패하면 목록을
   * 건드리지 않고 오류 줄 + [재시도] 를 띄운다.
   *
   * ## 세 보기 — 아이콘 · 간단히 · 자세히(기본) (docs/log/2026-10-07-file-tile-dolphin.md)
   *
   * **자세히**는 예전 트리 보기다 — 폴더를 그 자리에서 펼친다(펼칠 때 처음 읽는다 — 게으른 읽기, 타일마다 캐시,
   * docs/log/2026-09-25-file-tree-view.md). **아이콘**·**간단히**는 지금 폴더 한 층을 격자로 늘어놓는다. 세 보기 모두
   * "뿌리" 는 `cwd` 하나이고, 더블클릭·Enter 로 폴더에 들어가는 것은 **뿌리를 그 폴더로 옮기는 일**이다 — 그래서
   * 경로 칸·뒤로/앞으로·`cwd` 보고(`oncwd`)가 보기와 상관없이 같은 뜻으로 산다. 보기는 타일마다 기억되고
   * (`PaneSpec.fileView`) 새 타일은 이 기기에서 마지막으로 고른 값(`app/file-ui-last`), 없으면 설정 `[files] default_view` 를 따른다. 아이콘 크기(`PaneSpec.fileZoom`) · 숨김(`PaneSpec.fileHidden`)도 타일의 것이다.
   */
  let {
    backend,
    view = "details",
    onview,
    zoom = DEFAULT_FILE_ZOOM,
    places = true,
    preview = false,
    showHidden = false,
    projects = [],
    onfileui,
    initialPath = null,
    alias = "",
    active = false,
    shown = true,
    sourceGone = false,
    sourcePaneId = null,
    onupload,
    oncwd,
    onopendoc,
    onnotice,
    refreshKey = 0,
    paneId = null,
  }: {
    /** 어디를 보고 무엇을 할 수 있는가 — 원격이면 세션을 빌린 어댑터, 로컬이면 디스크 */
    backend: FsBackend;
    /** 보기 — 타일의 것(`PaneSpec.fileView`)이 없으면 상위가 설정 기본값을 채워 내려 준다 */
    view?: FileView;
    /** 툴바의 보기 전환 — 상위가 패널 명세에 적는다 (배치 저장·창 이관이 따라온다) */
    onview?: (view: FileView) => void;
    /** 아이콘 보기의 크기 단계 (`PaneSpec.fileZoom`, 없으면 기본) */
    zoom?: number;
    /** 장소 패널이 켜져 있는가 (`PaneSpec.filePlaces` — 없으면 켜짐) */
    places?: boolean;
    /** 미리 보기 패널이 켜져 있는가 (`PaneSpec.filePreview` — 없으면 꺼짐) */
    preview?: boolean;
    /** 숨김 파일을 보이는가 (`PaneSpec.fileHidden` — 없으면 꺼짐) */
    showHidden?: boolean;
    /** 장소 패널의 프로젝트 무리 — 이 백엔드의 것만(로컬 = 호스트 없음 · 원격 = 같은 별칭). 고르는 것은 상위다 */
    projects?: readonly { id: string; name: string; path: string }[];
    /** 아이콘 크기 · 장소 패널 · 미리 보기 · 숨김을 바꿨다 — 상위가 패널 명세에 적는다 (`onview` 와 같은 길) */
    onfileui?: (patch: FileUiPatch) => void;
    /**
     * **처음 열 경로** — 배치 복원이 저장해 둔 자리다 (로컬 타일의 `PaneSpec.path`).
     * 없으면 홈에서 시작한다. 그 경로가 사라졌으면 오류를 한 줄 남기고 홈으로 떨어진다
     * ([`loadStart`]) — 폴더가 없어졌다고 타일이 빈 화면으로 뜨면 안 된다.
     */
    initialPath?: string | null;
    /** 원본 터미널의 별칭 (배너 문구에만 쓴다) */
    alias?: string;
    /** 이 타일이 지금 보이는 활성 타일인가 — 키보드를 그때만 잡는다 */
    active?: boolean;
    /**
     * 이 타일이 화면에 그려져 있는가(`HostBox.shown` — 숨은 탭 · 다른 워크스페이스면 거짓). **로컬 감시 전용** — 보이지 않는
     * 타일은 OS 디렉터리 핸들을 쥐지 않는다(아래 "감시를 걸어 둘까"). 없으면 늘 보인다.
     */
    shown?: boolean;
    /** 원본 터미널 타일이 **아예 없어졌다** (닫혔거나 이관에서 빠졌다) */
    sourceGone?: boolean;
    /** 원본 터미널의 패널 id — "터미널에서 여기로 cd" 가 쓴다 */
    sourcePaneId?: string | null;
    /**
     * 파일을 지금 폴더에 올려 달라 — **상위의 업로드 모달**을 그대로 쓴다
     * (덮어쓰기 확인·진행 표시가 이미 거기 있다).
     */
    onupload?: (remoteDir: string, files: File[]) => void;
    /** 지금 보고 있는 폴더가 바뀌었다 — 상위가 파일 드롭의 대상 경로로 쓴다 */
    oncwd?: (dir: string) => void;
    /**
     * 이 파일을 **문서 보기 타일**로 열어 달라 (docs/log/2026-09-27-doc-tile.md) — 우클릭 "미리 보기" 와
     * 텍스트 파일의 더블클릭·Enter. 어디에 세우고 무엇을 빌릴지는 상위가 정한다. 없으면 두 길 모두 없다.
     */
    onopendoc?: (path: string) => void;
    onnotice?: (message: string) => void;
    /**
     * **값이 바뀌면 목록을 다시 읽는다** (호스트 트리의 `refreshKey` 와 같은 패턴).
     *
     * 업로드가 끝난 뒤가 이 값의 유일한 용도다. 업로드는 이 컴포넌트를 떠나 상위의 모달로
     * 가므로 (`onupload`) 언제 끝났는지를 여기서 알 길이 없는데, 그렇다고 새로 올린 파일이
     * 목록에 없으면 사용자는 업로드가 실패했다고 읽는다.
     */
    refreshKey?: number;
    /** 이 타일의 id — `find` 액션(`Ctrl+F`)의 문에 적는다(`app/tile-find.ts`). 없으면 적지 않는다 */
    paneId?: string | null;
  } = $props();

  // ── 상태 ────────────────────────────────────────────────────────────────────

  /**
   * 조각들(`$lib/browser/file-*`)이 이 타일에서 읽고 부르는 것 — **게터 객체 하나**를 함께 본다(값으로 넘기면
   * 한 프레임 낡는다). 조각마다 자기 몫의 모양(`FileListingHost` · `FileMenuHost` · `FileActionsHost` · `FileKeysHost`)으로만 읽는다.
   */
  const tile = {
    get backend() {
      return backend;
    },
    get offline() {
      return offline;
    },
    get isTree() {
      return isTree;
    },
    get view() {
      return view;
    },
    get showHidden() {
      return showHidden;
    },
    get initialPath() {
      return initialPath;
    },
    get listEl() {
      return listEl;
    },
    get fileInput() {
      return fileInput;
    },
    get nav() {
      return nav;
    },
    get sel() {
      return sel;
    },
    get order() {
      return order;
    },
    get navOrder() {
      return navOrder;
    },
    get rows() {
      return rows;
    },
    get rowById() {
      return rowById;
    },
    get selPaths() {
      return selPaths;
    },
    get focusEntry() {
      return focusEntry;
    },
    get targetDir() {
      return targetDir;
    },
    get atRoot() {
      return atRoot;
    },
    get active() {
      return active;
    },
    get pathFocused() {
      return pathFocused;
    },
    get fileBindings() {
      return fileBindings;
    },
    get sourcePaneId() {
      return sourcePaneId;
    },
    get onopendoc() {
      return onopendoc;
    },
    get onupload() {
      return onupload;
    },
    get onnotice() {
      return onnotice;
    },
    get oncwd() {
      return oncwd;
    },
    get transfers() {
      return transfers;
    },
    get listing() {
      return ls;
    },
    get menus() {
      return mc;
    },
    get copySelection() {
      return actions.copySelection;
    },
    get pasteInto() {
      return actions.pasteInto;
    },
    get openEntry() {
      return actions.openEntry;
    },
    get targets() {
      return actions.targets;
    },
    get pathDraft() {
      return pathDraft;
    },
    set pathDraft(value: string) {
      pathDraft = value;
    },
    isRootItem,
    targetDirOfEntry,
    goTo,
    runFileAction,
  };

  /**
   * 목록 읽기 — 뿌리(`cwd`)·목록·느린 읽기 깃발·오류 줄·트리 캐시(펼침·폴더·"더 보기")·재연결 감지 키.
   * 상태와 손잡이는 `$lib/browser/file-listing.svelte` 에 있고, 그것을 부르는 `$effect` 는 여기 남는다.
   */
  const ls = new FileListing(tile);

  /** 경로 칸의 편집 중인 값 — 확정(Enter)해야 `cwd` 가 된다 */
  let pathDraft = $state("");
  let pathFocused = $state(false);

  let listEl = $state<HTMLDivElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  /** 타일의 키보드 몸(`[data-tile-focus]`) — 경로 칸의 Escape 가 물러날 자리다 */
  let rootEl = $state<HTMLDivElement | null>(null);
  /** 경로 칸 — `Ctrl+L`(`files-location`)이 그 칸을 입력으로 바꾼다 */
  let locationBar = $state<LocationBar | null>(null);

  /**
   * 파일 타일 층의 단축키 — `조합 → 액션 id` (docs/log/2026-10-07-file-tile-dolphin.md). 사용자가 설정에서 다시 묶을
   * 수 있어 `keybindings.ts` 의 리졸버를 지난다. 실행은 `FileKeys` 가 이 타일이 활성일 때만 [`runFileAction`] 으로 한다.
   */
  const fileBindings = $derived(resolveBindings(settings.keybindings).files);

  /** 파일 타일 층 액션 하나를 실행한다 — 모르는 id 면 `false`(키를 놓아준다) */
  function runFileAction(id: string): boolean {
    switch (id) {
      case "files-location":
        void locationBar?.edit();
        return true;
      case "files-view-icons":
        onview?.("icons");
        return true;
      case "files-view-compact":
        onview?.("compact");
        return true;
      case "files-view-details":
        onview?.("details");
        return true;
      case "files-places":
        onfileui?.({ places: !places });
        return true;
      case "files-filter":
        openFilter();
        return true;
      case "files-preview":
        onfileui?.({ preview: !preview });
        return true;
    }
    return false;
  }

  /**
   * 우클릭 메뉴와 그 안의 인라인 폼(이름 변경·새 폴더·삭제 확인) — `$lib/browser/file-menu-controller.svelte`.
   * 그림은 `FileMenu` 이고 항목은 `runOnMenu` 통로를 지난다 (docs/conventions.md 의 메뉴 규칙).
   */
  const mc = new FileMenuController(tile, ls);

  // ── 파생 ────────────────────────────────────────────────────────────────────

  /** 트리 보기인가 */
  const isTree = $derived(view === "details");

  /**
   * 거르기 전의 줄 — 순수 모형 하나(`fileTreeRows`)가 세 보기를 다 편다(아이콘·간단히는 뿌리 한 층). 숨김 파일은
   * 토글이 꺼져 있으면 층마다 빠지고, 정렬은 백엔드 것을 그대로 쓴다. 게으른 읽기의 그물은 이것을 본다(필터가 곁줄을
   * 빼도 펼쳐 둔 폴더는 읽혀야 거를 것이 생긴다).
   */
  const allRows = $derived(
    fileTreeRows(ls.cwd, ls.entries, {
      tree: isTree,
      showHidden,
      expanded: ls.expanded,
      folders: ls.folders,
      limits: ls.limits,
    }),
  );

  // ── 필터 줄 (`Ctrl+I` · docs/log/2026-10-07-file-tile-dolphin.md) ─────────────────────────────

  /** 필터 줄이 열려 있는가 — 닫으면 거르기도 풀린다(열려 있지 않은 필터가 목록을 줄여 두지 않게) */
  let filterOn = $state(false);
  let filterQuery = $state("");
  let filterBar = $state<FilterBar | null>(null);

  /** 거른 결과 — 맞는 줄과 그 조상 폴더(`filterRows`). 필터가 닫혀 있으면 줄 그대로다 */
  const filtered = $derived(filterRows(allRows, filterOn ? filterQuery : ""));

  /** 화면에 그릴 줄 — 선택·키보드·끌기·마퀴가 전부 이 순서를 본다 */
  const rows = $derived(filtered.rows);

  /** 필터 줄을 연다(이미 열려 있으면 칸에 포커스만) — `Ctrl+I` · 툴바 단추 */
  function openFilter() {
    filterOn = true;
    void filterBar?.focus();
  }

  /** 필터 줄을 닫고 거르기를 푼다 — 키보드는 타일 몸으로 돌아간다(곧바로 ↑↓ 가 먹게) */
  function closeFilter() {
    filterOn = false;
    filterQuery = "";
    rootEl?.focus({ preventScroll: true });
  }

  // `find` 액션(`Ctrl+F` — 2026-10-19)도 이 줄을 연다 — 파일 타일의 "찾기" 는 이름 거르기다(`Ctrl+I` 는 별칭으로 남는다)
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return untrack(() =>
      registerTileFind(id, () => {
        openFilter();
        return true;
      }),
    );
  });

  // 열리는 순간 칸에 포커스 — 단추로 열었든 키로 열었든 같다(`bind:this` 는 그 다음 틱에 선다)
  $effect(() => {
    if (filterOn && filterBar) untrack(() => void filterBar?.focus());
  });

  /** id → 줄 (커서·메뉴·대상 폴더가 줄을 되찾는 표) */
  const rowById = $derived(new Map(rows.map((r) => [r.id, r] as const)));

  const crumbs = $derived(backend.crumbsOf(ls.cwd));

  /** 연결이 없다 = 세션이 없거나 원본이 사라졌다 (배너가 다르다). 로컬은 언제나 거짓 */
  const offline = $derived(!backend.online);

  /** 지금 자리가 **합성 루트**("내 PC") 인가 — 거기에는 만들 자리도 붙일 자리도 없다 */
  const atRoot = $derived(ls.hasCwd && backend.isSyntheticRoot(ls.cwd));

  /**
   * 이 항목이 **드라이브 뿌리**(합성 루트 "내 PC" 바로 아래)인가 — 이름 변경·삭제·복사·끌기가
   * 뜻이 없는 줄이다 (백엔드도 거절한다).
   *
   * 예전에는 타일 하나의 `atRoot` 로 충분했다: "내 PC" 를 보고 있으면 보이는 줄이 전부 드라이브였다.
   * 트리 보기에서는 "내 PC" 아래로 `C:\` 를 펼치면 드라이브와 그 안의 파일이 한 화면에 서므로
   * **줄마다** 묻는다. 들어가기 보기에서는 예전 판정과 정확히 같은 답이 나온다.
   */
  function isRootItem(path: string): boolean {
    return !backend.isSyntheticRoot(path) && backend.isSyntheticRoot(backend.parentOf(path));
  }

  /**
   * 이 타일이 **내 디스크**를 보고 있는가. 능력 플래그로 갈리지 않는 것 하나 — **글자**가
   * 남았다: 같은 조작(`canUpload`)이 원격에서는 "업로드", 로컬에서는 "가져오기" 다.
   */
  const isLocal = $derived(backend.key === LOCAL_KEY);

  /**
   * 경로 칸에 그릴 조각 — 원격이면 뿌리 `/` 를 **`<별칭>:/`** 로 적는다(scp 표기 — 2026-10-20: 머리줄에서 타일 아이콘(호스트 로고)을 걷어
   * 어느 서버인지는 이 조각이 말한다. 로컬은 처음부터 `내 PC` 다). 경로 · 열쇠는 그대로라 이동 · 드롭은 예전과 같다.
   * 지금 폴더 이름(`folderName`)은 원래 조각(`crumbs`)을 읽는다.
   */
  const shownCrumbs = $derived(
    isLocal || alias === "" || crumbs[0]?.path !== "/"
      ? crumbs
      : [{ ...crumbs[0], label: `${alias}:/`, title: `${alias}:/` }, ...crumbs.slice(1)],
  );

  /**
   * 장소 패널의 그려지는 상자 · 머리줄 무리 끝 x · 새 폴더 · 업로드 접힘 — 한 값에서(`pane/head-span` 의 `filePlacesLayout` — 좁힐 때 경로 칸이
   * 최대한 남는 순서: 정렬 해제(목록의 권한 칸이 숨는 순간) → 패널 아이콘만 → 단추 접기 → 패널 없음). 타일 폭은 뿌리 상자(`.sftp`)를 잰다.
   * 머리줄과 몸은 같은 타일 상자 안에 왼쪽 끝을 맞춰 서므로 패널 폭이 곧 목록 열의 x 다.
   */
  let tileW = $state(0);
  /**
   * 목록 칸(`FileList` 의 `.list`)의 **그려진 내용 폭** — 컨테이너 `file-list` 가 보는 값(안쪽 여백 · 스크롤 막대 뺀 것)과 같다. 경로 칸 정렬은 이 폭이
   * "권한" 칸이 숨는 문턱(`FILE_LIST_MODE_MIN_W`) 아래로 갈 때 풀린다 — 장소 패널 · 미리 보기 패널을 빼고 계산하지 않고 잰다(머리줄은 몸 밖이라 되먹지 않는다).
   */
  let listW = $state(0);
  $effect(() => {
    const el = listEl;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1].contentRect.width);
      if (w !== listW) listW = w;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  const placesLayout = $derived(filePlacesLayout({ on: places, width: tileW, listW }));

  /**
   * 줄 오른쪽 끝의 **내보내기 손잡이**를 그릴 자리인가.
   *
   * 셸에 넘길 수 있는 것은 **로컬에 실제로 있는 경로**뿐이라 원격 타일에는 손잡이가 없다
   * (그쪽 길은 우클릭 [다운로드]다). 합성 루트("내 PC")의 드라이브 뿌리도 끌 자리가 아니다 —
   * 그 줄은 목록 상자가 `isRootItem` 으로 따로 뺀다.
   */
  const canExport = $derived(isLocal && !offline);

  // ---------------------------------------------------------------------------
  // 다중 선택 — 규칙도 배선도 세션 타일과 **같은 파일**이 들고 있다
  // (`$lib/browser/selection-controller.svelte` 위의 `$lib/selection`).
  //
  // 여기서는 그 컨트롤러가 아는 유일한 언어인 **id 문자열과 그 순서**로 줄을 번역해 줄
  // 뿐이고, id 는 항목의 **절대 경로**다 (한 디렉터리 안에서 유일하고, 목록이 다시 읽혀도
  // 같은 파일을 계속 가리킨다).
  // ---------------------------------------------------------------------------

  const sel = createSelection();

  /** 지금 보이는 순서대로의 **항목** 경로 — Shift 범위·마퀴·끌기·`Ctrl+A` 가 이 순서를 본다 */
  const order = $derived(entryOrder(rows));

  /**
   * 키보드 커서가 걷는 순서 — 항목에 "N개 더 보기" 곁줄을 더한 것(↑↓·Home·End). 들어가기
   * 보기에는 곁줄이 없어 `order` 와 같다. 곁줄 id 는 선택에 들어가도 `selPaths` 가 걸러 낸다.
   */
  const navOrder = $derived(navOrderOf(rows));

  /** 키보드 커서가 앉은 항목 (Enter·F2 의 대상) — 곁줄이면 `null` */
  const focusEntry = $derived.by(() => {
    const row = sel.focus === null ? undefined : rowById.get(sel.focus);
    return row?.kind === "entry" ? row.entry : null;
  });

  /** 골라진 것들 — **보이는 순서**로 편 절대 경로 (조작·드래그·클립보드가 모두 이 값을 쓴다) */
  const selPaths = $derived(order.filter((p) => sel.has(p)));

  // 목록이 바뀌면(새로고침·폴더 이동·숨김 토글·접기) 사라진 줄을 선택에서 떨어낸다.
  $effect(() => sel.prune(navOrder));

  /**
   * **조작의 대상 폴더** (docs/log/2026-09-25-file-tree-view.md 의 "대상 폴더") — `Ctrl+V` · 툴바
   * [폴더] · [업로드/가져오기] 가 어디로 가는가.
   *
   * 들어가기 보기에서는 예전 그대로 **지금 폴더**다. 트리 보기에는 "들어가 있는 폴더" 가 뿌리
   * 하나뿐이라 **고른 줄**이 그 자리를 대신한다: 폴더면 그 폴더, 파일이면 그 파일이 든 폴더,
   * 아무것도 안 골랐으면 뿌리 (호스트 트리의 `folderOfRow` 와 같은 규칙). 커서만 앉고 골라지지
   * 않은 줄(선택을 비운 뒤의 보이지 않는 커서)은 대상이 되지 않는다 — 호스트 트리가 겪은 그 함정이다.
   */
  const targetDir = $derived.by(() => {
    if (!isTree) return ls.cwd;
    const id = sel.focus;
    const row = id !== null && sel.has(id) ? rowById.get(id) : undefined;
    return targetDirOf(row, ls.cwd);
  });

  /** 대상 폴더가 "내 PC" 라 받을 자리가 없는가 — 툴바 [업로드]·[폴더] 를 끈다 */
  const targetBlocked = $derived(!ls.hasCwd || backend.isSyntheticRoot(targetDir));

  /**
   * 툴바 말풍선의 둘째 줄 — **어디로 가는가**. 트리에서 대상이 하위 폴더일 때만 붙인다(뿌리면
   * 빵부스러기·경로 칸이 이미 말한다). 없으면 빈 글자라 첫 줄 그대로다.
   */
  const targetNote = $derived(
    isTree && targetDir !== ls.cwd ? `\n${t("files.tree.target", { dir: targetDir })}` : "",
  );

  /**
   * 도구줄의 단추 — **줄 위**(`tools`)와 **⋯ 안**(`menuTools`) 두 표(2026-10-20 B안 · `BrowserToolbar` 의 접기 규칙 · `toolbar-tools.ts`).
   * 경로 칸이 줄의 남는 폭을 다 가져가야 긴 경로가 읽히므로 줄 위 단추는 전부 그림 단추이고, 이름은 말풍선과 `aria-label` 이 말한다.
   *
   * 줄 위 — 이 폴더에 만드는 것(새 폴더 · 업로드/가져오기 — 좁으면 ⋯ 로 접힌다) · 찾기:
   * - **밖에서 온 파일을 대상 폴더로** — 원격에서는 업로드, 로컬에서는 가져오기다(같은 조작이라 플래그도 하나다:
   *   `canUpload`). "내 PC" 에는 놓을 자리가 없으므로 그때만 끈다. 대상은 아이콘·간단히 보기에서 지금 폴더, 자세히
   *   보기에서 고른 줄의 폴더다(`targetDir`). 말풍선의 둘째 줄이 대상이 지금 폴더와 다를 때의 "대상: …" 이다.
   * - 찾기(`Ctrl+F` · `Ctrl+I`) — 켜면 목록 위에 "폴더에서 찾기" 칸이 선다. 다시 누르면 닫히고 거르기도 풀린다.
   *
   * ⋯ 안 — 숨김 파일 보기 · 장소 패널(`F9`) · 미리 보기 패널(`F11`). 켬/끔은 타일의 것
   * (`PaneSpec.filePlaces` · `filePreview`)이고 숨김 파일만 이 화면의 것이다. 머리줄이 서 있으면 이 줄들은 **타일 ⋯ 맨 위**에 얹힌다.
   */
  const tools = $derived.by((): ToolbarTool[] => {
    const dropLabel = isLocal ? t("files.browser.import") : t("files.browser.upload");
    const list: ToolbarTool[] = [
      {
        id: "newfolder",
        icon: "folder-plus",
        label: t("files.browser.newfolder.title"),
        title: targetBlocked
          ? t("files.browser.newfolder.blocked.title")
          : t("files.browser.newfolder.title") + targetNote,
        disabled: offline || targetBlocked,
        fold: true,
        run: () => mc.newFolderHere(),
      },
    ];
    if (backend.canUpload) {
      list.push({
        id: "upload",
        icon: "upload",
        label: dropLabel,
        title: targetBlocked ? t("files.browser.upload.blocked.title") : dropLabel + targetNote,
        disabled: offline || targetBlocked,
        fold: true,
        run: () => actions.pickUpload(targetDir),
      });
    }
    const findCombo = hintOf("find");
    list.push({
      id: "filter-toggle",
      icon: "search",
      label: t("files.filter.toggle"),
      title: findCombo ? `${t("files.filter.toggle")} (${findCombo})` : t("files.filter.toggle"),
      pressed: filterOn,
      action: "files-filter",
      run: () => (filterOn ? closeFilter() : openFilter()),
    });
    return list;
  });

  const menuTools = $derived.by((): ToolbarTool[] => [
    {
      id: "hidden",
      icon: "show-hidden",
      label: t("files.browser.hidden.show"),
      pressed: showHidden,
      run: () => onfileui?.({ hidden: !showHidden }),
    },
    {
      id: "places",
      icon: "layout",
      label: t("files.places.toggle"),
      pressed: places,
      action: "files-places",
      run: () => onfileui?.({ places: !places }),
    },
    {
      id: "preview",
      icon: "preview",
      label: t("files.preview.toggle"),
      pressed: preview,
      action: "files-preview",
      run: () => onfileui?.({ preview: !preview }),
    },
  ]);

  /** 액션에 **지금 걸린** 조합 글자(사용자 오버라이드를 지난 것 — 없으면 빈 글자) */
  function hintOf(action: string | undefined): string {
    return action ? displayCombo(effectiveCombo(action, settings.keybindings)) : "";
  }

  /**
   * **머리줄이 서 있는가** — 서 있으면 도구줄이 머리줄로 올라간다(뒤로/앞으로는 맨 앞 · 빵부스러기가 이름 자리 · 도구 ⋯ 는 타일 ⋯ 와 하나 —
   * `pane/pane-tools.svelte.ts`). 머리줄이 없으면(설정 `tile_header` · 폰) 예전처럼 목록 위에 제 줄을 그린다.
   */
  const inHead = $derived(paneId !== null && paneHeadShown(paneId));

  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, {
      lead: fileLead,
      bar: fileBar,
      replaceName: true,
      // 타일 아이콘은 없다 — 로컬 · 원격은 경로 칸 첫 조각이 말한다(`shownCrumbs`)
      hideIcon: true,
      // 장소 패널이 펼쳐져 있으면 맨 앞 조각이 그 폭을 쥐고 경로 칸은 목록 열 위에서 시작한다
      span: () => placesLayout.span,
      // 타일 ⋯ 맨 위의 줄 — 지금 접힘(`filePlacesLayout` 의 `fold` — 타일 폭)을 읽는다(접힌 새 폴더 · 업로드가 먼저)
      menu: () => toPaneMenuItems(fileMenuTools(tools, menuTools, placesLayout.fold), hintOf),
      run: (key) => [...tools, ...menuTools].find((tool) => tool.id === key)?.run(),
    });
  });

  /** 한 줄의 대상 폴더 — 우클릭 메뉴가 연 순간의 값 (들어가기 보기에서는 언제나 지금 폴더) */
  function targetDirOfEntry(entry: SftpEntry | null): string {
    if (!isTree || !entry) return ls.cwd;
    return targetDirOf(rowById.get(entry.path), ls.cwd);
  }

  // ---------------------------------------------------------------------------
  // 전송 · 드래그 · 러버밴드 — 기계장치 셋은 `$lib/browser/` 에 있고 여기서는 배선만 한다.
  //
  // 셋 다 **읽기 함수**로 이 타일의 상태를 본다 (값으로 넘기면 한 프레임 낡는다).
  // ---------------------------------------------------------------------------

  const transfers = createTransfers({
    backend: () => backend,
    hasCwd: () => ls.hasCwd,
    offline: () => offline,
    selPaths: () => selPaths,
    reload: (keep = []) => ls.load(ls.cwd, keep),
    setError: (message) => (ls.error = message === null ? null : stripReason(message)),
    failureOf,
    notice: (message) => onnotice?.(message),
    consumeSignal: (tick) => (seenRefreshTick = tick),
  });

  const drag = createDragController({
    backend: () => backend,
    locked: isRootItem,
    offline: () => offline,
    order: () => order,
    selection: sel,
    busy: () => transfers.busy,
    canReceive: (dir) => transfers.canReceive(dir),
    bringIn: (src, paths, destDir, mode) => transfers.bringIn(src, paths, destDir, mode),
    // 트리 보기의 폴더 줄 위에 놓은 OS 파일 — 업로드 모달로 (툴바 [업로드] 와 같은 문)
    receiveFiles: (dir, files) => actions.uploadTo(dir, files),
  });

  const marquee = createMarquee({
    root: () => listEl,
    rects: () => boxesIn(listEl, listEl, "data-path"),
    selection: () => sel.state,
    apply: (rects, box, additive, base) => sel.marquee(rects, box, additive, base),
    onEmptyClick: () => sel.clear(),
    // 줄 위 = HTML5 드래그(옮기기)의 자리다
    isItem: (t) => t instanceof Element && t.closest(".row") !== null,
  });

  /**
   * **뒤로 · 앞으로** — 이력은 타일마다 하나이고 메모리에만 산다 (탭 저장에는
   * 넣지 않는다: 배치 복원이 되살리는 것은 "어느 폴더" 이지 "어떤 길로 왔는가" 가 아니다).
   *
   * 갈 수 있는지는 **실제로 읽어 봐야** 안다 (권한·삭제된 폴더·빠진 USB). 그래서 판정이
   * 곧 `load` 이고, 실패하면 컨트롤러가 그 자리를 이력에서 떨어낸다 — 오류 줄은 `load` 가
   * 이미 세워 두었으므로 여기서 더 말할 것이 없다 (`onDropped` 를 주지 않는 이유).
   */
  const nav = createNav({
    ready: () => !offline && !ls.loading,
    go: (path) => ls.load(path),
  });

  /** 타일이 사라질 때 남은 시계를 거둔다 (닫힌 타일이 상태를 건드리지 않게) */
  $effect(() => () => clearTimeout(ls.slowTimer));

  // ── 트리 — 게으른 읽기 · 펼치기 · 접기 ─────────────────────────────────────

  /**
   * **게으른 읽기의 그물** — 펼쳐 둔 폴더가 화면에 "읽는 중" 으로 섰는데 아무도 읽고 있지 않으면
   * 여기서 읽는다. 펼치기(`expand`)가 스스로 읽으므로 평소에는 할 일이 없고, 다음 경우를 받는다:
   * 뿌리를 옮겼더니 그 아래에 예전에 펼쳐 둔(캐시에 없는) 폴더가 있다 · 보기를 트리로 바꿨다 ·
   * 숨김을 켜서 펼쳐 둔 숨김 폴더가 드러났다 · 재연결로 캐시를 비웠다.
   */
  $effect(() => {
    if (!isTree || offline) return;
    for (const row of allRows) {
      if (row.kind !== "loading") continue;
      const path = row.parent;
      if (ls.inflight.has(path) || ls.folders.get(path)?.status === "loading") continue;
      untrack(() => void ls.fetchFolder(path));
    }
  });

  /**
   * 화살표 클릭 — 그 줄을 고르고(호스트 트리와 같은 감각) 펼치기/접기를 뒤집는다.
   * 오류가 난 폴더는 접힌 것으로 서 있으므로 누르면 다시 읽는다.
   */
  function toggleRow(row: Extract<FileTreeRow, { kind: "entry" }>) {
    sel.click({ ctrlKey: false, metaKey: false, shiftKey: false }, row.id, order);
    if (row.expanded) ls.collapse(row.entry.path);
    else ls.expand(row.entry.path);
  }

  // ── 장소 패널 (docs/log/2026-10-07-file-tile-dolphin.md) ────────────────────────────────────────

  /** 백엔드가 알려 준 붙박이 자리 · 드라이브(+ 남은 공간) — 패널이 처음 보일 때(와 백엔드가 바뀔 때) 한 번 읽는다 */
  let basePlaces = $state.raw<BackendPlace[]>([]);
  let drives = $state.raw<{ path: string; space: DiskSpace | null }[]>([]);
  /**
   * 마지막으로 장소를 읽은 백엔드 키 — 같은 키면 다시 읽지 않는다. **`$state` 가 아니다**(아래 효과 안에서만 읽고 쓰는
   * 표식이다 — `seenRefresh` 와 같은 사정). 재연결로 키가 바뀌면 원격 홈을 다시 묻는다.
   */
  let placesKey: string | null = null;

  $effect(() => {
    const key = backend.key;
    if (!places || !backend.online || placesKey === key) return;
    placesKey = key;
    untrack(() => void loadPlaces(backend));
  });

  async function loadPlaces(be: FsBackend) {
    basePlaces = await be.places();
    const roots = await (be.roots() ?? Promise.resolve(null)).catch(() => null);
    if (!roots) {
      drives = [];
      return;
    }
    drives = roots.map((path) => ({ path, space: null }));
    const spaces = await Promise.all(roots.map((root) => be.freeSpace(root)));
    if (be.key === backend.key) drives = roots.map((path, i) => ({ path, space: spaces[i] }));
  }

  // ── 상태 줄 (docs/log/2026-10-07-file-tile-dolphin.md) ─────────────────────────────────────────

  /** 지금 폴더 요약(뿌리 한 층)과 선택 요약 — 순수 함수 둘(`browser/file-view.ts`) */
  const folderSum = $derived(folderSummary(ls.entries, showHidden));
  const selectionSum = $derived(
    selectionSummary(
      selPaths.flatMap((p) => {
        const row = rowById.get(p);
        return row?.kind === "entry" ? [row.entry] : [];
      }),
    ),
  );

  /**
   * 지금 폴더가 사는 볼륨의 **남은 공간** — 모르면 `null`(칸이 없다). 폴더를 옮길 때와 새로고침(`spaceTick`)에 다시
   * 묻는다. 늦게 온 옛 답이 새 답을 덮지 않게 번호를 단다(`spaceSeq` — 화면이 읽지 않아 `$state` 가 아니다).
   */
  let space = $state<DiskSpace | null>(null);
  let spaceTick = $state(0);
  let spaceSeq = 0;
  $effect(() => {
    void spaceTick;
    const path = ls.cwd;
    const be = backend;
    if (!ls.hasCwd || !be.online) {
      space = null;
      return;
    }
    const seq = ++spaceSeq;
    untrack(() => {
      void be.freeSpace(path).then((v) => {
        if (seq === spaceSeq) space = v;
      });
    });
  });

  // ── 미리 보기 패널 (`F11` · docs/log/2026-10-07-file-tile-dolphin.md "10") ─────────────────────

  /** 패널이 그릴 것 — 고른 항목들(보이는 순서)에서 정한다(`browser/preview.ts`) */
  const previewSubj = $derived(
    previewSubject(
      selPaths.flatMap((p) => {
        const row = rowById.get(p);
        return row?.kind === "entry" ? [row.entry] : [];
      }),
    ),
  );

  /** 지금 폴더의 이름 — 빵부스러기 마지막 조각(합성 루트면 "내 PC") */
  const folderName = $derived.by(() => {
    const last = crumbs[crumbs.length - 1];
    return last ? (last.labelKey ? t(last.labelKey) : last.label) : ls.cwd;
  });

  /** 폴더의 항목 수 — 읽어 둔 적이 있을 때만(펼친 폴더의 캐시). 숨김 토글을 따른다 */
  function itemCountOf(path: string): number | null {
    const state = ls.folders.get(path);
    if (state?.status !== "ok") return null;
    return showHidden ? state.entries.length : state.entries.filter((e) => !isHidden(e)).length;
  }

  /** 패널의 무리 셋 — 원격 프로젝트의 `~` 는 붙박이 홈으로 푼다 */
  const placeSecs = $derived(
    placeSections({
      base: basePlaces,
      projects,
      drives,
      home: isLocal ? null : (basePlaces.find((p) => p.kind === "home")?.path ?? null),
    }),
  );

  /**
   * 아이콘 크기 한 단계 (`Ctrl+휠` · 상태 줄 슬라이더) — 상위가 패널 명세에 적어 배치·이관에 실린다.
   * 보기 전환은 `onview` 를 곧장 부른다(툴바 단추 · `Ctrl+1/2/3`) — 커서가 곁줄에 있었으면 그 줄이 없는 보기에서는
   * 정리 효과(`sel.prune`)가 알아서 떨군다.
   */
  function setZoom(level: number) {
    if (level !== zoom) onfileui?.({ zoom: level });
  }

  /**
   * **끌면서 접힌 폴더 위에 머물면 펼친다** (~600ms — 탐색기·VS Code 의 감각). 트리 보기 전용.
   * 목적지(`drag.dropDir`)가 바뀌면 시계를 다시 건다 — 줄 목록은 구독하지 않는다(펼친 순간
   * 줄이 바뀌어 시계가 헛되이 다시 걸리지 않게).
   */
  const DRAG_EXPAND_MS = 600;
  $effect(() => {
    const dir = drag.dropDir;
    if (!isTree || dir === null) return;
    const row = untrack(() => rowById.get(dir));
    if (row?.kind !== "entry" || !row.expandable || row.expanded) return;
    const timer = setTimeout(() => ls.expand(dir), DRAG_EXPAND_MS);
    return () => clearTimeout(timer);
  });

  /**
   * **백엔드 따라가기** — 이 컴포넌트의 핵심 배선.
   *
   * [`FsBackend.key`] 가 바뀔 때마다 돈다. 세 경우가 있다:
   * 1. 처음 붙었다 (`hasCwd` 가 거짓) → 저장된 경로나 홈에서 시작한다.
   * 2. **끊겼다가 다시 붙었다** (`loadedKey` 와 다르다) → 보고 있던 경로를 그대로 다시
   *    읽는다. 재연결이 홈으로 튕기지 않는 이유가 여기다.
   * 3. 끊겼다 (`online` 이 거짓) → 아무것도 하지 않는다. 목록은 화면에 남겨 두고 배너만
   *    덮는다 — 다시 붙으면 같은 자리로 돌아올 것이므로 지울 이유가 없다.
   */
  $effect(() => {
    if (!backend.online) return;
    if (backend.key === ls.loadedKey) return;
    if (!ls.hasCwd) void ls.loadStart();
    else void ls.load(ls.cwd, selPaths);
  });

  function refresh() {
    spaceTick += 1;
    if (!ls.hasCwd) void ls.loadStart();
    else void ls.load(ls.cwd, selPaths);
  }

  /**
   * 상위가 마지막으로 요청한 새로고침 번호. **`$state` 가 아니다** — 렌더에 쓰이지 않고
   * 아래 `$effect` 안에서만 읽고 쓰는 표식이라 반응성이 필요 없다. `null` 은 "아직 한 번도
   * 안 봤다" 는 뜻이고, 그래서 첫 마운트에서는 헛되이 한 번 더 읽지 않는다.
   */
  let seenRefresh: number | null = null;

  $effect(() => {
    const key = refreshKey;
    const first = seenRefresh === null;
    const changed = !first && key !== seenRefresh;
    seenRefresh = key;
    if (!changed) return;
    // 아직 아무것도 못 읽었으면(연결 전) 할 일이 없다 — 붙는 순간 위 `$effect` 가 읽는다.
    if (ls.hasCwd && backend.online) void ls.load(ls.cwd, selPaths);
  });

  /**
   * 마지막으로 본 **형제 타일의 새로고침 신호** 번호 (`$lib/fs-refresh.svelte`).
   *
   * 위 `seenRefresh` 와 같은 이유로 `$state` 가 아니다. 시작값이 지금 값인 것도 같은 뜻이다 —
   * 마운트하자마자 남이 예전에 보낸 신호로 한 번 더 읽지 않는다. 전송 엔진이 자기가 보낸
   * 신호를 여기에 바로 적어(자기 소비) 목적지 타일이 두 번 읽는 것을 막는다.
   */
  let seenRefreshTick = fsRefreshSignal().tick;

  $effect(() => {
    const { tick, key } = fsRefreshSignal();
    if (tick === seenRefreshTick) return;
    seenRefreshTick = tick;
    // 아래 값들은 **읽되 구독하지 않는다** — 이 효과가 도는 조건은 신호 하나뿐이어야 한다.
    untrack(() => {
      if (key !== backend.key || !ls.hasCwd || !backend.online || ls.loading) return;
      void ls.load(ls.cwd, selPaths);
    });
  });

  // ── 자동 새로고침 (docs/log/2026-10-21-file-tile-auto-refresh.md) ─────────────────────────────────────
  //
  // **로컬 타일만** — 보이는 폴더의 OS 변경 알림(`backend.watch` — Rust 가 이미 300ms · 2초로 모아 보낸다). 원격 타일은 감시가
  // 없고 ⟳ 로만 읽는다(같은 날 원격 갈래를 걷었다 — 이 앱의 터미널 · AI 만 잡고 바깥 변경은 못 잡는 반쪽 자동은 목록을 믿어도
  // 되는지 알 수 없게 한다). 설정 `[files] auto_refresh` 를 끄면 감시가 걷힌다(⟳ 는 그대로).

  const autoOn = $derived(settings.fileAutoRefresh);

  /**
   * **감시를 걸어 둘까** — 설정 켬 · 이 타일이 보이는 탭에 있다(`shown`) · 이 창이 활성이다(`app/window-active` — 창마다 따로,
   * 원격 웹 창은 브라우저 탭의 포커스 · 가시성이 같은 뜻으로 선다). Windows 는 하위 폴더에 열린 디렉터리 핸들이 있으면 **상위
   * 폴더 이름 바꾸기를 막는다**(실측 EPERM — docs/log/2026-10-21-file-tile-auto-refresh.md "상위 폴더 이름 바꾸기 잠금"). 사람이
   * 이 창을 떠나 탐색기로 가면 핸들을 놓고, 돌아오면 한 번 읽고 다시 건다.
   */
  const watchWant = $derived(watchWanted(autoOn, shown, windowActive()));
  /**
   * 실제로 감시를 거는가 — `watchWant` 를 따르되 **끄기는 유예 뒤**(`watchSwitchDelay` — 1초). 메뉴 · 대화상자 · 파일 고르기로
   * 포커스가 잠깐 깜빡일 때마다 걷고 거는 소동이 없게. 켜기는 곧바로.
   */
  let watchOn = $state(untrack(() => watchWant));
  $effect(() => {
    const want = watchWant;
    const delay = watchSwitchDelay(watchOn, want);
    if (delay === null) return;
    if (delay === 0) {
      watchOn = want;
      return;
    }
    const timer = setTimeout(() => (watchOn = want), delay);
    return () => clearTimeout(timer);
  });

  /** 감시할 폴더 — 지금 폴더 + 트리에서 보이게 펼친 폴더(`fs-auto-refresh` 의 `watchPathsOf`) */
  const watchPaths = $derived(ls.hasCwd ? watchPathsOf(ls.cwd, allRows, backend.isSyntheticRoot(ls.cwd)) : []);

  /**
   * 자동 읽기를 **미룰 때** — 읽는 중 · 메뉴와 그 안의 인라인 폼(이름 바꾸기 · 새 폴더 · 삭제 확인)이 열려 있다 · 경로 칸을
   * 고치는 중(`load` 가 칸 글자를 덮는다) · 끌거나 러버밴드로 고르는 중. 목록을 갈아 끼우면 선택이 바뀌고(`sel`) 칸 글자가
   * 덮여 사람 손 밑의 것이 깨진다 — 풀리면 아래 효과가 쌓인 것을 한 번에 읽는다.
   */
  const autoBusy = $derived(
    ls.loading || mc.menu !== null || pathFocused || drag.draggingPaths !== null || marquee.box !== null,
  );

  /** 쌓인 바뀜 — 바뀐 감시 폴더들. 화면이 읽지 않으므로 `$state` 가 아니다(`seenRefresh` 와 같은 사정) */
  let pendingDirs = new Set<string>();
  /** 이 타일의 감시 — 효과 안에서만 읽고 쓴다(`$state` 아님) */
  let watch: FsWatch | null = null;
  /**
   * 감시가 걸려 있지 않던 때가 있다 — 다시 걸 때 그동안 놓친 바뀜을 한 번 읽는다(`$state` 아님). 시작값은 "마운트 때 못 걸었나" —
   * 숨은 탭에서 마운트돼 첫 읽기만 하고 기다리던 타일도 처음 보일 때 한 번 읽는다.
   */
  let missedWhileOff = untrack(() => !watchOn);

  /** 쌓인 바뀜을 읽는다 — 미룰 때면 그대로 두고(풀리면 아래 효과가 부른다), 뿌리가 바뀌었으면 뿌리째(펼친 폴더도 함께) */
  function flushAuto() {
    if (!ls.hasCwd || offline) {
      pendingDirs = new Set();
      return;
    }
    if (autoBusy || pendingDirs.size === 0) return;
    const dirs = pendingDirs;
    pendingDirs = new Set();
    if (dirs.has(ls.cwd)) {
      void ls.load(ls.cwd, selPaths);
      return;
    }
    // 펼친 하위 폴더만 바뀌었다 — 그 폴더만 다시 읽는다(접혔으면 다음에 펼칠 때 캐시가 낡아 있지 않게 지금 읽어 둘 이유도 없다)
    for (const dir of dirs) if (ls.expanded.has(dir) && !ls.inflight.has(dir)) void ls.fetchFolder(dir);
  }

  /**
   * **감시의 수명** — 백엔드(감시를 줄 수 있는 것 = 로컬)와 `watchOn`(설정 · 보임 · 창 활성 + 유예)을 따라 세우고 걷는다. 타일이
   * 사라지거나 백엔드가 바뀌거나 `watchOn` 이 거짓이 되면 걷힌다(`local_watch_stop` → Rust 참조 수가 0 이 된 경로는 `unwatch` —
   * OS 핸들이 닫힌다 · 페이지 리로드 · 창 파괴는 Rust 가 창 단위로 걷는다). 볼 경로는 아래 효과가 따라 고친다 — 처음 한 번은 여기서
   * 넣는다(새로 선 감시는 경로가 바뀌지 않아도 받아야 한다). **다시 걸 때는 한 번 읽는다**(걷혀 있던 동안의 바뀜 — 미룸을 따른다).
   */
  $effect(() => {
    const open = backend.watch;
    if (!watchOn || !open) return;
    const w = untrack(() => open((dirs) => {
      for (const d of dirs) pendingDirs.add(d);
      flushAuto();
    }));
    watch = w;
    untrack(() => {
      w.set(watchPaths);
      if (missedWhileOff && ls.hasCwd) {
        pendingDirs.add(ls.cwd); // 뿌리째 = 펼친 폴더도 함께(`ls.load`)
        flushAuto();
      }
      missedWhileOff = false;
    });
    return () => {
      w.dispose();
      if (watch === w) watch = null;
      pendingDirs = new Set();
      missedWhileOff = true;
    };
  });

  // 볼 경로가 바뀌었다(뿌리를 옮겼다 · 펼쳤다 · 접었다) — 같은 목록이면 감시가 알아서 건너뛴다
  $effect(() => {
    const paths = watchPaths;
    untrack(() => watch?.set(paths));
  });

  // 미룸이 풀렸다 — 그동안 쌓인 바뀜을 한 번에(쌓인 것은 반응형이 아니라 풀림만 이 효과를 깨운다)
  $effect(() => {
    if (!autoBusy) untrack(flushAuto);
  });

  function goTo(path: string) {
    if (offline) return;
    void ls.load(path);
  }

  /**
   * 항목 조작 — 열기 · 편집 · 기본 앱 · 탐색기에서 보기 · 클립보드 · 업로드 파일 칸 · 경로 복사 · 터미널에서 cd
   * (`$lib/browser/file-actions`). 메뉴·키보드·목록이 같은 손잡이를 부른다.
   */
  const actions = new FileActions(tile, ls);

  // ── 키보드 ──────────────────────────────────────────────────────────────────

  /** 목록의 키 조작 — 창 전역에서 잡고 `active` 로 거른다 (`$lib/browser/file-keys`) */
  const keys = new FileKeys(tile);
  $effect(() => () => clearTimeout(keys.typeAheadTimer));

  /** 경로 칸의 Enter — 읽혔으면 `true`(칸이 닫힌다), 못 읽었으면 `false`(칸이 남고 오류 줄이 이유를 말한다) */
  async function submitPath(path: string): Promise<boolean> {
    if (offline) return false;
    return ls.load(path);
  }

  /**
   * 끌고 있는 동안의 힌트 한 줄 — 앱 안 드래그일 때만 (네이티브로 끌고 있는 중이라면 이미
   * 그 길을 아는 사람이다).
   *
   * 앞머리는 **모든 타일**에 뜬다: 수정키가 뜻을 바꾸는 규칙(`fs-route.ts` 의 `dragMode`)은
   * 원격에서도 로컬에서도 같고, 그것을 알려 줄 자리가 여기 말고 없다 — 커서의 `+` 표시는
   * 이미 쥐고 있는 사람에게만 보이지, **쥘 수 있다는 사실**은 말해 주지 않는다. 그리고 이
   * 수정키는 `dragstart` 가 아니라 **놓는 순간**에 읽히므로, 끌고 있는 지금 눌러도 늦지 않다.
   *
   * 뒷말은 로컬 타일에서만 붙는 **끌어내기 안내**다. 놓을 때 `Alt` 를 떼라는 말은 잔소리가
   * 아니라 실기에서 걸린 자리다: 윈도우는 드롭 시점의 `Alt` 를 **"바로 가기 만들기"** 로
   * 읽는데(Ctrl=복사·Shift=이동·Alt=링크) 우리가 실어 보내는 데이터 객체는 `copy` 만 허용해서,
   * `Alt` 를 쥔 채 놓으면 탐색기가 거절한다. 이쪽 몸짓은 **시작하는 순간에만** 고를 수 있으므로
   * 이 줄이 알려 주는 것은 "다음번에는 이렇게" 다.
   *
   * `TransferPanel` 의 `.hint` 는 **한 줄 말줄임**이라 둘을 합쳐도 한 줄을 넘지 않게 짧게 적는다.
   */
  const dragHint = $derived(
    drag.draggingPaths && !drag.nativeDragging && !transfers.job
      ? backend.key === LOCAL_KEY
        ? t("files.browser.draghint.local")
        : t("files.browser.draghint.remote")
      : null,
  );
</script>

<!--
  도구줄 두 조각 — 머리줄이 서 있으면 머리줄이 그린다(뒤로/앞으로 · 보기 고르개 = 맨 앞(타일 아이콘 앞 — 사용자 실기 10-20) · 나머지 = 이름 자리부터 ⋯ 앞까지), 아니면 목록 위에 한 줄로
  (`inHead` · `pane/pane-tools.svelte.ts`). 스니펫이라 어디에 그려지든 이 화면의 상태 · 단축키 · `bind:this` 가 그대로다.
-->
{#snippet fileLead()}
  <BrowserNav
    canBack={nav.canBack}
    canForward={nav.canForward}
    disabled={offline}
    onback={() => void nav.go("back")}
    onforward={() => void nav.go("forward")}
  />
  <BrowserViewPick {view} {onview} />
{/snippet}

{#snippet fileBar(head: boolean)}
  <BrowserToolbar
    inHead={head}
    nav={fileLead}
    navSpan={placesLayout.span}
    folded={placesLayout.fold}
    foldOver={placesLayout.foldOver}
    {tools}
    {menuTools}
    disabled={offline}
  >
    {#snippet location()}
      <LocationBar
        bind:this={locationBar}
        bind:draft={pathDraft}
        crumbs={shownCrumbs}
        current={ls.cwd}
        dropTarget={drag.dropDir}
        disabled={offline}
        flat={head}
        placeholder={backend.sep === "\\"
          ? t("files.browser.path.placeholder")
          : t("files.browser.path.placeholder.posix")}
        onnavigate={goTo}
        onsubmit={submitPath}
        onrefresh={refresh}
        onfocuschange={(focused) => (pathFocused = focused)}
        onescape={() => rootEl?.focus({ preventScroll: true })}
        ondragover={drag.dirDragOver}
        ondragleave={drag.dirDragLeave}
        ondrop={drag.applyDrop}
      />
    {/snippet}
  </BrowserToolbar>
{/snippet}

<!--
  포인터 셋이 **탐색기로 끌어내기**의 몸이다 (docs/log/2026-09-04-native-drag-out.md "D"·"E").
  손잡이로 시작했든 `Alt` 로 시작했든 여기서부터는 같은 길이다. 창에 붙인 것은 손이 줄 밖으로
  나가도 같은 포인터를 계속 따라가야 하기 때문이다 (`setPointerCapture` 는 OLE 몫이라 걸 수 없다).

  같은 두 줄이 네이티브 드래그의 **보험**도 겸한다 — 웹 드래그가 없어 `dragend` 가 오지
  않으므로, 플러그인의 끝 신호가 오지 않는 드문 경우에 반투명해진 줄을 되돌릴 자리가 여기다.
-->
<svelte:window
  onkeydown={keys.onKeydown}
  onpointermove={drag.pointerMove}
  onpointerup={drag.pointerEnd}
  onpointercancel={drag.pointerEnd}
/>

<!--
  `tabindex="-1" data-tile-focus` — 이 상자가 **타일의 키보드 몸**이다
  (docs/log/2026-09-03-hosts-toolbar-tile-focus.md · docs/log/2026-09-03-local-fs-tile.md).
  `Alt+화살표`로 이 타일에 들어오면 `PaneHost` 가 바디 대신 여기에 포커스를 주므로,
  경로 칸의 Escape 가 물러날 자리도 여기다. 탭 순회에는 끼지 않는다 (`-1`).
-->
<div
  class="sftp"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  bind:this={rootEl}
  bind:clientWidth={tileW}
  oncontextmenu={(ev) => mc.openMenu(ev, null)}
  onmouseup={nav.mouseUp}
  onauxclick={nav.auxClick}
>
  {#if !inHead}{@render fileBar(false)}{/if}

  {#if backend.canUpload}
    <!-- 화면에 없는 파일 칸 — 업로드·가져오기 단추(`tools`)가 이것을 대신 누른다 (`pickUpload` 의 근거). 도구줄이 머리줄로 오가도 남게 몸에 둔다 -->
    <input
      class="hidden-input"
      type="file"
      multiple
      tabindex="-1"
      aria-hidden="true"
      bind:this={fileInput}
      onchange={actions.onPicked}
    />
  {/if}

  <!--
    배너 두 개는 **뜻이 다르다**: 하나는 기다리면 돌아오고(재연결), 하나는 돌아오지 않는다
    (원본 타일이 사라졌다). 같은 문구로 접으면 사용자가 기다려야 할지 닫아야 할지 모른다.
  -->
  {#if sourceGone}
    <p class="banner gone">{t("files.browser.source.gone")}</p>
  {:else if offline}
    <p class="banner wait">
      {alias
        ? t("files.browser.offline.alias", { alias })
        : t("files.browser.offline")}
    </p>
  {/if}

  {#if ls.error}
    <p class="banner err">
      <span class="err-text">{ls.error}</span>
      <button type="button" class="retry" onclick={refresh} disabled={offline}>
        {t("files.browser.retry")}
      </button>
    </p>
  {/if}

  <!--
    몸통 — 왼쪽 장소 패널 | 오른쪽 목록 기둥(목록 · 전송 막대). 패널은 타일 폭에 따라 접힌다(아이콘만 · 숨김 —
    `pane/head-span` 의 `filePlacesLayout` — 머리줄 경로 칸의 x 와 한 값). 끄면(`F9`) 아예 그리지 않는다.
  -->
  <div class="body">
    {#if placesLayout.mode !== "none"}
      <PlacesPanel
        sections={placeSecs}
        current={ls.cwd}
        width={placesLayout.boxW}
        mini={placesLayout.mode === "mini"}
        dropTarget={drag.dropDir}
        disabled={offline}
        onpick={goTo}
        ondragover={drag.dirDragOver}
        ondragleave={drag.dirDragLeave}
        ondrop={drag.applyDrop}
      />
    {/if}
    <div class="main">
      <!-- 찾기 줄은 목록 **위**(10-20 사용자 — 찾기 띠는 위에 선다) -->
      {#if filterOn}
        <FilterBar bind:this={filterBar} bind:query={filterQuery} count={filtered.count} onclose={closeFilter} />
      {/if}

      <FileList
        {rows}
        totalCount={ls.entries.length}
        selection={sel}
        {order}
        {marquee}
        {drag}
        backendKey={backend.key}
        cwd={ls.cwd}
        hasCwd={ls.hasCwd}
        loading={ls.loading}
        slowLoad={ls.slowLoad}
        {canExport}
        mode={view}
        iconScale={iconZoomScale(zoom)}
        onzoom={(delta) => setZoom(stepIconZoom(zoom, delta))}
        isLocked={isRootItem}
        onopen={actions.openEntry}
        onmenu={mc.openMenu}
        ontoggle={toggleRow}
        onmore={ls.showMore}
        filter={filterOn ? filterQuery : ""}
        matched={filtered.matched}
        bind:el={listEl}
      />

      <TransferPanel
        job={transfers.job}
        percent={transfers.percent}
        pending={transfers.pending}
        hint={dragHint}
        oncancel={() => void transfers.cancelJob()}
        onresolve={(policy: OnConflict) => void transfers.resolveConflicts(policy)}
        ondismiss={() => transfers.dismiss()}
      />

      <FileStatusBar
        folder={folderSum}
        selection={selectionSum}
        {space}
        iconsView={view === "icons"}
        {zoom}
        onzoom={setZoom}
      />
    </div>
    {#if preview}
      <PreviewPanel {backend} subject={previewSubj} {folderName} folder={folderSum} {itemCountOf} />
    {/if}
  </div>
</div>

{#if mc.menu}
  <!--
    `atRoot` 는 메뉴마다 뜻이 다르다: 항목 메뉴면 **그 대상에 드라이브 뿌리가 끼었는가**(`isRootItem` —
    트리에서는 "내 PC" 아래 드라이브와 그 안의 파일이 한 화면에 선다), 빈 곳 메뉴면 뿌리가 "내 PC"
    인가. 붙여넣기·업로드·새 폴더는 메뉴가 연 순간 정해 둔 `menuDir` 로 간다(항목 메뉴 = 그 줄의 대상
    폴더, 빈 곳 = 뿌리) — 메뉴가 닫힌 뒤에 도는 항목이라 `menu` 를 읽을 수 없다.
  -->
  <FileMenu
    menu={mc.menu}
    mode={mc.menuMode}
    edit={mc.edit}
    {backend}
    cwd={ls.cwd}
    newFolderDir={mc.newFolderDir}
    tree={isTree}
    atRoot={mc.menu.entry
      ? (sel.count >= 2 ? selPaths : [mc.menu.entry.path]).some(isRootItem)
      : atRoot}
    {isLocal}
    selCount={sel.count}
    {selPaths}
    busy={transfers.job !== null}
    hasClip={fsClip() !== null}
    removeTargets={mc.removeTargets}
    confirmRecursive={mc.confirmRecursive}
    {sourcePaneId}
    onclose={mc.closeMenu}
    oncut={() => actions.copySelection("cut")}
    oncopy={() => actions.copySelection("copy")}
    onpaste={() => actions.pasteInto(mc.menuDir)}
    ondownload={(paths) => void transfers.startDownload(paths)}
    onexport={(paths) => void transfers.exportToFolder(paths)}
    onopenentry={actions.openEntry}
    onpreview={onopendoc ? (e) => onopendoc(e.path) : undefined}
    oneditentry={(e) => void actions.editEntry(e)}
    onopenexternal={(e) => void actions.openExternally(e)}
    onreveal={(e) => void actions.revealEntry(e)}
    oncopypath={(e) => void actions.copyPath(e)}
    onstartrename={() => void mc.startRename()}
    onstartremove={mc.startRemove}
    onstartnewfolder={() => void mc.startNewFolder(mc.menuDir)}
    onstartnewfile={() => void mc.startNewFile(mc.menuDir)}
    onpickupload={() => actions.pickUpload(mc.menuDir)}
    onimportfolders={() => void transfers.importFolders(mc.menuDir)}
    onrevealhere={() => void actions.revealHere()}
    onrefresh={refresh}
    oncdhere={actions.cdHere}
    onsubmitrename={() => void mc.submitRename()}
    onsubmitnewfolder={() => void mc.submitNewFolder()}
    onsubmitnewfile={() => void mc.submitNewFile()}
    onsubmitremove={(recursive) => void mc.submitRemove(recursive)}
  />
{/if}

<style>
  /*
   * 타일을 꽉 채운다. 배경은 `--bg-panel`(합성된 값) 이다 — `--term-bg` 를 쓰면 투명도
   * 슬라이더가 안 먹는다 (PaneHost 의 `.chrome` 규칙과 같은 근거).
   */
  .sftp {
    /* `relative` 는 충돌 대화상자(`.dialog-veil`)의 좌표 원점이다 — 그 물음은 **이 타일의
       것**이라 타일 안에 갇혀야 한다 (타일이 여럿이면 각자 자기 것만 묻는다). */
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    /* 글래스 크롬 타일이면 판(흐림 + `--glass-mid`)은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    border-radius: inherit;
    font-family: var(--font-ui);
    /* 상태 줄 · 미리 보기 패널이 **타일 폭**으로 접힌다(`@container file-tile`). 장소 패널은 JS 판정(`filePlacesLayout` — 머리줄과 한 값) */
    container: file-tile / inline-size;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }

  .main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }


  /* 타일 상자와 같은 규칙 — 포커스 링은 그리지 않는다 (`PaneHost` 의 `.pane-body:focus`).
     어느 타일이 포커스인지는 상자의 활성 테두리가 이미 말하고, 여기 링이 하나 더 뜨면
     타일 안에 네모가 이중으로 겹친다. */
  .sftp:focus {
    outline: none;
  }

  .hidden-input {
    display: none;
  }

  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    margin: 0;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1.4;
    border-bottom: 1px solid var(--border);
  }

  /* 기다리면 돌아온다 — 경고(앰버) */
  .banner.wait {
    color: var(--warn);
    background: var(--warn-soft);
  }

  /* 돌아오지 않는다 · 실패 — 마젠타 */
  .banner.gone,
  .banner.err {
    color: var(--err);
    background: var(--err-soft);
  }

  .err-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .retry {
    flex: 0 0 auto;
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .retry:hover:not(:disabled) {
    background: var(--bg-hover);
  }
</style>
