import type { DocFilesSeed } from "$lib/doc-files";
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

/** `PaneHost` 의 프롭 계약 — `+page` 와 주고받는 표면 전부 */
export interface PaneHostProps {
  tabs: TabSpec[];
  activeId?: string | null;
  focusedPaneOf: (tab: TabSpec) => string;
  /** 키가 없으면 그 탭은 동시 입력 OFF — 빈 집합과 다른 상태다 */
  syncPanes: ReadonlyMap<string, ReadonlySet<string>>;
  hosts?: HostEntry[];
  keybindings?: Record<string, string>;
  onfocuspane?: (tabId: string, paneId: string) => void;
  onclosepane?: (tabId: string, paneId: string) => void;
  /** 탭 상태의 주인은 `+page` 다 — 여기서 트리 · `zoomedPaneId` 를 만지지 않아야 키와 버튼이 한 자리에서 갈린다 */
  onzoompane?: (tabId: string, paneId: string) => void;
  onsyncpane?: (tabId: string, paneId: string) => void;
  onsplitpane?: (tabId: string, paneId: string, dir: SplitDir) => void;
  onforwardpane?: (tabId: string, paneId: string) => void;
  ondetachpane?: (tabId: string, paneId: string) => void;
  ondrophosts?: (
    tabId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
    payload: HostsDrag,
  ) => void;
  ondroptab?: (
    sourceTabId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
  ) => void;
  onmovepane?: (
    paneId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
  ) => void;
  /**
   * `null` 이면 이번 드래그는 창을 넘을 수 없다(`x-aynx-tear` 를 싣지 않는다).
   * 동기여야 한다 — `dragstart` 안에서 `dataTransfer` 에 실어야 한다(`Tabs` 의 같은 이름 프롭과 같은 계약).
   */
  ontearstart?: (paneId: string) => number | null;
  ontearoutpane?: (screenX: number, screenY: number) => void;
  ontearrefused?: () => void;
  ontearmergeinto?: (
    token: number,
    targetTabId: string,
    targetPaneId: string,
    dir: SplitDir,
    side: PaneSide,
  ) => void;
  /** `dragDropEnabled: false` 라 파일은 Tauri 이벤트가 아니라 웹 표준 DnD 의 `File` 로 온다(경로가 아니다) */
  onfiledrop?: (tabId: string, paneId: string, files: File[]) => void;
  onfspaste?: (tabId: string, paneId: string, drag: FsDrag) => void;
  oneditremote?: (tabId: string, paneId: string) => void;
  /** SFTP 타일이 세션을 빌리는 통로 — 반응형 읽기라 원본 터미널이 재연결하면 프롭이 저절로 갱신된다 */
  sessionOf?: (paneId: string) => number | null;
  /** 함수로 받는다 — 타일마다 배열을 내려보내면 하나가 바뀔 때마다 전부가 새 객체가 된다 */
  forwardsOf?: (paneId: string) => ForwardInfo[];
  onopenfiles?: (tabId: string, paneId: string) => void;
  onsftpupload?: (paneId: string, remoteDir: string, files: File[]) => void;
  onlocalupload?: (paneId: string, dir: string, files: File[]) => void;
  onsftpcwd?: (paneId: string, dir: string) => void;
  /** `PaneSpec.path` 에 실려 배치 파일에 저장되는 값 — 드롭 목적지를 기억할 뿐인 `onsftpcwd` 와 합치지 않는다 */
  onlocalcwd?: (paneId: string, dir: string) => void;
  onfileview?: (paneId: string, view: FileView) => void;
  onfileui?: (paneId: string, patch: FileUiPatch) => void;
  /** `browserPaneId` 는 브라우저 타일의 id 다 — 원격이면 새 문서 타일이 그 브라우저가 빌리던 터미널을 물려받는다 */
  onopendoc?: (tabId: string, browserPaneId: string, path: string) => void;
  /** `line` 은 1 기준 */
  onopenpath?: (tabId: string, paneId: string, target: { path: string } | { home: string }, line?: number) => void;
  ondocmode?: (paneId: string, mode: DocMode) => void;
  ondocoutline?: (paneId: string, open: boolean) => void;
  ondocfiles?: (paneId: string, open: boolean) => void;
  ondocswitch?: (tabId: string, paneId: string, path: string, files?: DocFilesSeed) => void;
  ondoceditview?: (paneId: string, view: DocEditView) => void;
  ondocsplit?: (paneId: string, ratio: number) => void;
  ondoczoom?: (paneId: string, zoom: number) => void;
  ondockeep?: (paneId: string) => void;
  ondocunkeep?: (paneId: string) => void;
  /** `link` 는 적힌 경로 그대로다 — 풀이는 받는 쪽(`openDocLink`)이 한다 */
  ondoclink?: (tabId: string, paneId: string, link: string, anchor?: string) => void;
  sftpRefreshKey?: number;
  onactivity?: (tabId: string) => void;
  onstatus?: (tabId: string, paneId: string, status: PaneStatus | null) => void;
  onsession?: (paneId: string, sessionId: number | null) => void;
  ontitle?: (paneId: string, title: string) => void;
  onshell?: (paneId: string, shell: string) => void;
  /** 표시용 곁 저장소가 아니라 `PaneSpec.tmux` 로 간다 — 배치 파일에 저장돼 다음 접속의 힌트가 된다 */
  ontmux?: (paneId: string, name: string) => void;
  /** `name` 이 `null` 이면 힌트 없이 열어 백엔드가 다음 번호를 고른다 = 새 세션 */
  onopentmux?: (tabId: string, paneId: string, name: string | null) => void;
  oncommand?: (paneId: string, command: string | null) => void;
  /** 렌더에 쓰이지 않고 키를 누른 순간에만 읽혀 `$state` 가 아니라 함수로 건넨다 */
  onmeasure?: (measure: () => { w: number; h: number }) => void;
  confirmHostKey?: ConfirmHostKey;
  promptPassword?: PromptPassword;
  promptPassphrase?: PromptPassphrase;
}
