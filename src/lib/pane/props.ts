import type { HostEntry, HostsDrag } from "$lib/hosts";
import type {
  ConfirmHostKey,
  DocMode,
  DocEditView,
  FileUiPatch,
  FileView,
  PaneSide,
  PromptPassphrase,
  PromptPassword,
  SplitDir,
  TabSpec,
} from "$lib/session";
import type { PaneStatus } from "$lib/shell-integration";
import type { ForwardInfo } from "$lib/forward";
import type { FsDrag } from "$lib/fs-drag";

/**
 * **`PaneHost` 의 프롭 계약** — `+page` 와 주고받는 표면 전부.
 *
 * 타입 선언만 이 파일로 옮겼다 (`HostActions` 를 따로 둔 것과 같은 이유 —
 * docs/log/2026-09-05-refactor-pane-host.md). 컴포넌트는
 * `let { … }: PaneHostProps = $props()` 한 줄로 받는다.
 *
 * **계약이 한 번 바뀌었다**: `hostActions` 프롭이 사라졌다
 * (docs/log/2026-09-05-refactor-structure.md). 호스트 조작 묶음은 이제 `+page` 가 컨텍스트로
 * 심고 실제로 부르는 컴포넌트가 직접 꺼낸다 — `PaneHost` 는 그 통로가 아니다. 이 파일에서
 * `PaneHost` 가 **읽지 않고 넘기기만 하는** 프롭은 이제 하나도 없다 (`keybindings` 는 시작
 * 타일에 넘기던 값이었지만 2026-09-15 부터 헤더 ⤢ 툴팁이 직접 쓴다).
 *
 * 이 묶음이 250줄인 것은 프롭이 많아서가 아니라 **콜백마다 왜 그 모양인지가 적혀 있기
 * 때문**이다 (어느 층이 그 규칙의 주인인가 · 왜 인자에 tabId 가 붙는가 · 왜 통로를 나눴는가).
 * 그 설명은 컴포넌트의 배선을 읽는 사람이 아니라 **계약을 읽는 사람**의 것이라, 배선과
 * 한 파일에 있으면 배선이 그 아래 묻힌다.
 */
export interface PaneHostProps {
  /** 앱의 **모든** 탭. 여기서 전 탭의 패널을 한 목록으로 그린다 */
  tabs: TabSpec[];
  /** 지금 보이는 탭 (나머지 탭의 패널은 `display:none`) */
  activeId?: string | null;
  /** 그 탭에서 포커스를 가진 패널 id (상위가 탭별로 기억한다) */
  focusedPaneOf: (tab: TabSpec) => string;
  /**
   * 탭 id → 그 탭에서 동시 입력에 **포함된** 패널 집합.
   * 키가 없으면 그 탭은 동시 입력 OFF (빈 집합과 다른 상태다 —
   * docs/log/2026-09-01-drag-split-sync-select.md 2절).
   */
  syncPanes: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * 사이드바가 마지막으로 읽은 호스트 목록 (`+page` 의 캐시).
   * 패널 헤더의 **색 점**(`meta.color`)과 툴팁(`user@host:port`)을 별칭으로 여기서 찾는다.
   * 목록에 없는 별칭이면 점을 그리지 않는다 — 없는 색을 지어내지 않는다.
   */
  hosts?: HostEntry[];
  /**
   * 지금 걸린 단축키 오버라이드 — 타일 헤더 ⤢ 의 툴팁에 **지금 걸린** 최대화 조합을 적는
   * 데 쓴다 (하드코딩 없음). 예전에는 시작 타일에 그대로 넘기기만 하는 값이었는데, 시작
   * 화면이 조합을 적는 자리를 전부 잃으면서(2026-09-15) 이 컴포넌트 자신의 값이 되었다.
   */
  keybindings?: Record<string, string>;
  onfocuspane?: (tabId: string, paneId: string) => void;
  onclosepane?: (tabId: string, paneId: string) => void;
  /**
   * 헤더의 ⤢ — 이 타일의 **최대화 토글** (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
   *
   * 여기서 트리도 `zoomedPaneId` 도 직접 만지지 않는다 — 탭 상태의 주인은
   * `+page` 이고(단축키 `zoom-tile` 도 그쪽으로 온다), 이 컴포넌트는 그 값을 **읽어
   * 그리기만** 한다. 그래야 키로 켠 것과 버튼으로 켠 것이 같은 한 자리에서 갈린다.
   */
  onzoompane?: (tabId: string, paneId: string) => void;
  /** 동시 입력 포함/제외 토글 (헤더 ⋯ 메뉴의 "동시 입력 참여" · Ctrl+클릭). 켜져 있을 때만 부른다 */
  onsyncpane?: (tabId: string, paneId: string) => void;
  /**
   * 헤더 ⋯ 메뉴의 **"좌우로 분할" · "상하로 분할"**
   * (docs/log/2026-09-05-titlebar-cleanup.md).
   *
   * 예전에는 타이틀바의 ◫ ⬓ 였다 — 대상이 "활성 탭의 활성 타일" 이라 프롭에 인자가
   * 없었고, 그래서 누르기 전에 어느 타일이 활성인지를 사람이 먼저 떠올려야 했다.
   * 이제는 **가리킨 타일**이 대상이므로 신원을 함께 올린다. 나누는 규칙 자체
   * (`splitActive` — 복제·나선·최대화 해제)는 그대로 `+page` 한 곳에 있다.
   */
  onsplitpane?: (tabId: string, paneId: string, dir: SplitDir) => void;
  /** 헤더 ⋯ 메뉴의 **"포트 포워딩…"** — 그 타일의 SSH 세션에 `-L` 터널을 건다 (SSH 타일만) */
  onforwardpane?: (tabId: string, paneId: string) => void;
  /**
   * 헤더 ⋯ 메뉴의 **"새 창으로 분리"** — 드래그(헤더를 창 밖으로)와 **같은 결과**를
   * 마우스 몸짓 없이 낸다. 몸짓을 모르는 사람에게 그 기능이 존재한다는 사실을 알리는
   * 자리이기도 하다. 혼자 떼면 뜻이 깨지는 타일(SFTP·시작)에서는 상위가 거절한다.
   */
  ondetachpane?: (tabId: string, paneId: string) => void;
  /**
   * 세션 타일에서 끌어온 **호스트·폴더 묶음**을 `targetPaneId` 의 `dir`·`side` 쪽에 연다
   * (docs/log/2026-09-04-hosts-multiselect.md).
   *
   * 하나든 여럿이든, 호스트든 폴더든 **같은 콜백 하나**다. 짐을 별칭 목록으로 펴는 것
   * (폴더 → 그 아래 전부, 중복 제거)도, 하나면 분할·여럿이면 격자로 넣는 것도, 몇 개부터
   * 되묻는지도 전부 받는 쪽(`+page`)의 몫이다 — 여기서는 4분면만 정해 넘긴다.
   */
  ondrophosts?: (
    tabId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
    payload: HostsDrag,
  ) => void;
  /** 끌어온 **탭 전체**(root 서브트리)를 `targetPaneId` 의 `dir`·`side` 쪽에 병합 */
  ondroptab?: (
    sourceTabId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
  ) => void;
  /**
   * 끌어온 **패널 하나**를 트리에서 떼어 `targetPaneId` 의 `dir`·`side` 쪽으로 (탭 안 이동).
   * 탭 바에 놓는 쪽(= 새 탭으로 승격)은 `Tabs` 가 받는다.
   */
  onmovepane?: (
    paneId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
  ) => void;
  /**
   * **타일 헤더 드래그가 시작됐다** — 이 타일 하나짜리 이관 페이로드를 만들어 사서함에
   * 맡기고 그 번호를 돌려준다 (docs/log/2026-09-04-pane-tear-out.md).
   *
   * `null` 이면 이번 드래그는 **창을 넘을 수 없다** (= `x-aynx-tear` 를 싣지 않는다) —
   * 창 안 이동·분할·탭 승격은 지금까지와 똑같이 동작한다. 상위가 `null` 을 돌려주는 자리는
   * 혼자 떼면 뜻이 깨지는 타일들이다 (SFTP 는 원본 터미널의 세션을 빌리고, 시작 타일은
   * 옮겨 봐야 같은 안내 화면이다).
   *
   * **동기여야 한다.** `dragstart` 안에서 `dataTransfer` 에 실어야 하기 때문이다
   * (`Tabs` 의 같은 이름 프롭과 계약이 같다).
   */
  ontearstart?: (paneId: string) => number | null;
  /**
   * 타일 헤더 드래그가 **창 밖에서** 아무 데도 놓이지 않고 끝났다 = 이 타일만 떼어
   * **새 창으로**. 좌표는 화면 좌표(`screenX/Y`)이고, 어느 타일인지는 `pendingTear()` 가
   * 들고 있다 (탭 티어아웃의 `ontearout` 과 같은 모양).
   */
  ontearoutpane?: (screenX: number, screenY: number) => void;
  /**
   * 창 **밖**에 놓았는데 창을 넘기지 못한 드래그가 끝났다(`ontearstart` 가 `null` 이었다) — 거절 사유가
   * 저장 안 한 문서면 상위가 한 줄 알린다(docs/log/2026-09-27-doc-edit.md "F2").
   */
  ontearrefused?: () => void;
  /**
   * **다른 창의 탭·타일**을 이 창의 타일 위(4분면)에 놓았다 = 그 자리에
   * **분할로 합치기** (docs/log/2026-09-04-tear-merge-fixes.md).
   *
   * 탭 바에 놓는 합치기(`Tabs` 의 `ontearmerge`)와 짐은 완전히 같고 — 사서함의 페이로드는
   * 언제나 "탭 한 개" 다 — 갈리는 것은 **어디에 꽂느냐**뿐이다: 그쪽은 탭 목록의
   * `beforeId` 앞, 여기는 `targetPaneId` 의 `dir`·`side` 쪽. 그래서 값이 탭 id 가 아니라
   * **이관 번호**인 것만 빼면 `ondroptab` 과 같은 모양이다.
   */
  ontearmergeinto?: (
    token: number,
    targetTabId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
  ) => void;
  /**
   * **OS 파일**을 패널 위에 떨어뜨렸다 — AI CLI에는 첨부, 파일 타일에는 업로드/복사.
   *
   * `dragDropEnabled: false` 라 파일은 Tauri 이벤트가 아니라 웹 표준 DnD 로 들어온다 —
   * 즉 경로가 아니라 `File` 객체이고 내용을 읽을 수 있다
   * (docs/log/2026-09-01-drag-split-sync-select.md 코디네이터 메모).
   */
  onfiledrop?: (tabId: string, paneId: string, files: File[]) => void;
  /**
   * **파일 타일에서 끈 경로 묶음**을 터미널 타일에 떨어뜨렸다 — 같은 곳이면 경로 입력(AI 타일은 괄호 붙여넣기),
   * 다른 곳이면 AI 타일에는 사본 첨부·셸에는 안내 (`fs-drop-route.ts` 의 표 · 몸통은 `app/transfer` 의 `pasteFsDrag`).
   * 없으면 예전처럼 그 타일에 경로를 입력한다.
   */
  onfspaste?: (tabId: string, paneId: string, drag: FsDrag) => void;
  /** 패널 헤더의 ✎ — 그 패널의 세션에서 원격 파일을 편집한다 (SSH 패널만) */
  oneditremote?: (tabId: string, paneId: string) => void;
  /**
   * 패널 id → 그 패널이 지금 물고 있는 백엔드 세션 id (없으면 `null`).
   *
   * **SFTP 타일이 세션을 빌리는 통로**다 (docs/log/2026-09-03-sftp-browser-tile.md).
   * 맵 자체(`+page` 의 `paneSessions`)는 `$state` 라 이 함수의 호출은 반응형 읽기가
   * 되고, 원본 터미널이 재연결해 세션 id 가 바뀌면 브라우저의 프롭이 저절로 갱신된다.
   */
  sessionOf?: (paneId: string) => number | null;
  /**
   * 패널 id → 그 패널의 세션에 **살아 있는 포트 포워드들** (없으면 빈 배열).
   *
   * 머리줄의 포워딩 칩 하나가 읽는다 (docs/log/2026-09-17-forward-presets.md).
   * `sessionOf` 와 **같은 결**이다: 원본 표(`app/transfer` 의 `paneForwards`)가 `$state` 라
   * 이 함수의 호출이 곧 반응형 읽기이고, 포워드를 걸거나 중지하면 칩이 저절로 따라온다.
   * 함수로 받는 이유도 같다 — 타일마다 배열을 미리 만들어 내려보내면 하나가 바뀔 때마다
   * 전부가 새 객체가 된다.
   */
  forwardsOf?: (paneId: string) => ForwardInfo[];
  /**
   * 패널 헤더의 📂 — 그 터미널 타일 **옆에** 파일 브라우저를 연다.
   *
   * 종류에 따라 여는 것이 다르다: SSH 는 그 세션의 원격 파일(SFTP), 로컬 셸은 그 셸이 지금
   * 있는 폴더의 로컬 파일이다. 그 분기는 전부 받는 쪽(`app/panes.svelte.ts` 의
   * `openFilesFor`)에 있고 여기서는 "어느 타일에서 눌렸나" 만 올린다.
   */
  onopenfiles?: (tabId: string, paneId: string) => void;
  /**
   * SFTP 타일이 "이 폴더에 이 파일들을 올려 달라" 고 올린다 — `onfiledrop` 과 **같은
   * 업로드 모달**로 들어간다. 다른 점은 원격 디렉터리를 브라우저가 정해 준다는 것뿐이다.
   */
  onsftpupload?: (paneId: string, remoteDir: string, files: File[]) => void;
  /**
   * **로컬** 파일 타일이 "이 폴더에 이 파일들을 넣어 달라" 고 올린다 — 같은 모달, 다른
   * 목적지다 (원격은 SFTP 업로드, 로컬은 `local_write_file`).
   *
   * `onsftpupload` 와 통로를 나눈 이유는 `onlocalcwd`/`onsftpcwd` 를 나눈 것과 같다:
   * 합치면 상위가 다시 패널 종류를 물어 갈라야 하고, 그 검사가 두 곳에 생긴다.
   */
  onlocalupload?: (paneId: string, dir: string, files: File[]) => void;
  /**
   * SFTP 타일이 보고 있는 폴더가 바뀌었다. 상위가 기억해 두었다가 **그 타일에 파일을
   * 끌어다 놓았을 때의 목적지**로 쓴다 (드롭은 `onfiledrop` 으로 들어오는데, 그 경로에는
   * 브라우저의 내부 상태인 cwd 가 실려 있지 않다).
   */
  onsftpcwd?: (paneId: string, dir: string) => void;
  /**
   * **로컬** 파일 타일이 보고 있는 폴더가 바뀌었다 (docs/log/2026-09-03-local-fs-tile.md).
   *
   * `onsftpcwd` 와 뜻이 다르므로 통로도 다르다: 저쪽은 **드롭 목적지**를 상위가 기억해
   * 두는 값이고, 이쪽은 `PaneSpec.path` 에 실려 **배치 파일에 저장되는** 값이다. 하나로
   * 합치면 상위가 종류를 다시 물어 갈라야 하고, 그 검사가 여기와 저기 두 곳에 생긴다.
   */
  onlocalcwd?: (paneId: string, dir: string) => void;
  /**
   * 파일 타일(로컬·SFTP)의 **보기 전환** — 상위가 `PaneSpec.fileView` 에 적는다
   * (docs/log/2026-09-25-file-tree-view.md). 두 종류가 같은 통로를 쓰는 이유: 이 값은 종류를 가리지
   * 않고 패널 명세 한 칸이라, 가를 것이 없다(`onlocalcwd`/`onsftpcwd` 가 갈린 까닭이 여기에는 없다).
   */
  onfileview?: (paneId: string, view: FileView) => void;
  /**
   * 파일 타일의 **보기 곁 상태**(아이콘 크기 단계 · 장소 패널 켬/끔) — 상위가 `PaneSpec.fileZoom` · `filePlaces` 에
   * 적는다(docs/log/2026-10-07-file-tile-dolphin.md). `onfileview` 와 같은 무리라 같은 길이다.
   */
  onfileui?: (paneId: string, patch: FileUiPatch) => void;
  /**
   * 파일 타일이 "이 파일을 미리 보여 달라" 고 올린다 — 우클릭 "미리 보기" · 텍스트 파일의 더블클릭/Enter
   * (docs/log/2026-09-27-doc-tile.md). `browserPaneId` 는 **브라우저 타일**의 id 다 — 새 문서 타일은 그 옆에
   * 서고, 원격이면 브라우저가 빌리던 터미널(`sourcePaneId`)·별칭을 물려받는다(그 풀이는 받는 쪽이 한다).
   */
  onopendoc?: (tabId: string, browserPaneId: string, path: string) => void;
  /**
   * 터미널이 **파일 경로를 Ctrl+클릭**했다(화면 글자 · 로컬 타일의 OSC 8 `file://`) — 문서 보기로 연다
   * (docs/log/2026-09-27-doc-tile.md "A — 여는 길"). 경로는 그 셸의 폴더 기준으로 이미 풀려 있고(`home` 이면 홈 기준
   * 나머지), 파일인지 확인 · 자리 잡기(그 터미널 곁 · 미리 보기 규칙)는 받는 쪽(`openPathFromTerminal`)이 한다.
   */
  onopenpath?: (tabId: string, paneId: string, target: { path: string } | { home: string }) => void;
  /** 문서 타일의 [원문]/[보기] — 상위가 `PaneSpec.docMode` 에 적는다 (기본값이면 키를 지운다) */
  ondocmode?: (paneId: string, mode: DocMode) => void;
  /** 문서 타일의 [목차] — 상위가 `PaneSpec.docOutline` 에 적는다 (끄면 키를 지운다 · 미리 보기는 그대로) */
  ondocoutline?: (paneId: string, open: boolean) => void;
  /** 문서 타일의 편집 중 보기(원문만 · 나란히 · 미리 보기만) — 상위가 `PaneSpec.docEditView` 에 적는다 (나란히면 키를 지운다) */
  ondoceditview?: (paneId: string, view: DocEditView) => void;
  /** 문서 타일의 나란히 경계 비율 — 상위가 `PaneSpec.docSplit` 에 적는다 (반반이면 키를 지운다) */
  ondocsplit?: (paneId: string, ratio: number) => void;
  /** 문서 타일의 글자 크기(%) — 상위가 `PaneSpec.docZoom` 에 적는다 (100 이면 키를 지운다 · 미리 보기는 그대로) */
  ondoczoom?: (paneId: string, zoom: number) => void;
  /** 문서 타일의 [고정] — 미리 보기를 붙박이로. 상위가 `PaneSpec.docPreview` 를 지운다 */
  ondockeep?: (paneId: string) => void;
  /** 문서 타일의 [편집 종료] — 편집 때문에 고정했던 타일을 다시 미리 보기로. 상위가 `PaneSpec.docPreview` 를 켠다 */
  ondocunkeep?: (paneId: string) => void;
  /**
   * 문서 타일의 **경로 링크** Ctrl+클릭(`[x](other.md#절)` — docs/log/2026-09-27-doc-tile.md "B7 — 상대 링크").
   * `link` 는 적힌 경로 그대로(그 문서 기준 풀이 · 확인 · 자리 잡기는 받는 쪽 `openDocLink` 가 한다).
   */
  ondoclink?: (tabId: string, paneId: string, link: string, anchor?: string) => void;
  /** 값이 바뀌면 열려 있는 SFTP 타일이 전부 목록을 다시 읽는다 (업로드 성공 뒤) */
  sftpRefreshKey?: number;
  /** 안 보이는 탭의 어느 패널에든 출력이 왔다 (탭 활동 점) */
  onactivity?: (tabId: string) => void;
  /**
   * 패널의 OSC 133 명령 상태가 바뀌었다 (5단계 — 탭 상태 배지).
   * 소속 탭 id 를 여기서 붙여 준다: 상위(`+page`)는 패널→탭 매핑을 다시 계산하지 않고
   * 받은 그대로 쓰면 되고, 패널이 탭 사이를 옮겨 다녀도 다음 보고가 새 탭으로 온다.
   */
  onstatus?: (tabId: string, paneId: string, status: PaneStatus | null) => void;
  /** 패널이 물고 있는 백엔드 세션 id 가 바뀌었다 (맵은 `+page` 가 든다) */
  onsession?: (paneId: string, sessionId: number | null) => void;
  /**
   * 셸이 OSC 0/2 로 창 제목을 바꿨다 — 로컬 타일 헤더·탭이 셸 이름 대신 띄운다
   * (표시 전용 제목 저장소 `app/titles`). 소속 탭이 필요 없어 paneId 만 올린다.
   */
  ontitle?: (paneId: string, title: string) => void;
  /** 로컬 세션이 열린 직후 백엔드가 해석한 셸 id (헤더가 "로컬" 대신 진짜 셸 이름을 띄운다) */
  onshell?: (paneId: string, shell: string) => void;
  /**
   * SSH 세션이 열린 직후, 백엔드가 고른 **tmux 세션 이름**(`aynx-1` …)
   * (docs/log/2026-09-16-tmux-toggle.md).
   *
   * `onshell` 과 달리 표시용 곁 저장소가 아니라 **타일 명세**(`PaneSpec.tmux`)로 간다 —
   * 배치 파일에 저장되고 다음 접속의 힌트로 되돌아가야 하기 때문이다.
   */
  ontmux?: (paneId: string, name: string) => void;
  /**
   * tmux 세션 팝오버의 **"새 타일로 열기" · "새 세션"** (docs/log/2026-09-16-tmux-toggle.md).
   *
   * 같은 호스트로 타일을 하나 더 열되, `name` 이 있으면 그것을 **접속 힌트**로 심는다
   * (`PaneSpec.tmux` → 백엔드가 그 이름으로 `-A`). `null` 이면 힌트 없이 열어 백엔드가
   * 비어 있는 다음 번호를 고른다 = **새 세션**.
   *
   * 트리를 쥔 쪽이 여는 이유는 분할과 같다 — 새 타일이 **어디에** 설지는 배치 규칙이 정한다.
   */
  onopentmux?: (tabId: string, paneId: string, name: string | null) => void;
  /**
   * 그 타일에서 **지금 도는 명령**이 바뀌었다 (OSC 133 `C` → 명령문 · `D` → `null`).
   * 손으로 띄운 AI CLI 를 타일 아이콘·이름이 알아보는 근거다 — `ontitle`·`onshell` 과 같은
   * 표시 전용 저장소(`app/titles`)로 간다.
   */
  oncommand?: (paneId: string, command: string | null) => void;
  /**
   * **타일링 캔버스의 픽셀 크기를 읽는 함수**를 상위에 건네준다 (마운트에서 한 번)
   * — docs/log/2026-09-04-tiling-move-resize.md.
   *
   * 새 타일의 자동 분할 방향(`autoSplitDir`)은 "지금 타일이 가로로 긴가 세로로 긴가" 로
   * 정해지는데, 레이아웃이 내는 `Rect` 는 퍼센트와 px 가 섞여 있어 **두 축을 견주려면
   * 컨테이너의 실제 두 변**이 필요하다. 그 값을 아는 것은 캔버스를 들고 있는 여기뿐이다.
   *
   * 크기를 `$state` 로 올려 보내지 않고 **함수 하나**를 건네는 이유: 이 값은 렌더에 쓰이지
   * 않고 키를 누른 그 순간에만 읽힌다. 상태로 두면 창 크기가 바뀔 때마다 상위를 다시
   * 그리는 의존성이 하나 늘 뿐, 답은 똑같다 (Terminal 이 `registerCommands` 로 창구를
   * 올려 두는 것과 같은 모양이다).
   */
  onmeasure?: (measure: () => { w: number; h: number }) => void;
  confirmHostKey?: ConfirmHostKey;
  promptPassword?: PromptPassword;
  promptPassphrase?: PromptPassphrase;
}
