import {
  clampRatio,
  clampScrollback,
  clampFileZoom,
  DEFAULT_FILE_ZOOM,
  closePane,
  isDocMode,
  isDocEditView,
  migrateFileView,
  leafOf,
  listPanes,
  newBranchesPane,
  newDiffPane,
  newRunPane,
  newProducerPane,
  newQueryPane,
  canonQueryTabs,
  storedRowLimit,
  type QueryScript,
  type QueryRowLimit,
  newDocPane,
  newImagePane,
  isFileLeafKind,
  newLocalFsPane,
  newLocalPane,
  newSftpPane,
  newAdhocSshPane,
  newSshPane,
  newProjectStartPane,
  newStartPane,
  restoredTab,
  type DiffScopeKind,
  type DocMode,
  type DocEditView,
  type FileView,
  type PaneKind,
  type PaneNode,
  type PaneSpec,
  type ProducerSpec,
  type OrchMark,
  type SplitDir,
  type TabSpec,
} from "$lib/session";
import { DOC_SPLIT_DEFAULT, clampDocSplit } from "$lib/doc-edit-preview";
import { DOC_ZOOM_DEFAULT, clampDocZoom } from "$lib/doc-zoom";
import { newProducerChatId, parseOrchMark, parseProducerSpec, saveOrchMark, saveProducerSpec } from "$lib/orchestration/orch-tab";

/**
 * **탭 배치 저장·복원** (docs/log/2026-09-03-workspace-restore.md).
 *
 * 앱을 껐다 켜면 열어 두었던 탭 — 탭 목록·타일 트리·분할 비율·이름·활성 탭,
 * 그리고 타일마다 "무엇이었는가"(종류·별칭·셸·autorun·스크롤백) — 가 그대로 돌아온다.
 *
 * ## 무엇을 저장하고 무엇을 저장하지 않는가
 *
 * 저장하는 것은 **구조뿐**이다. 화면 내용(스크롤백)·세션 id·비밀번호는 **전혀** 담지 않는다:
 * 터미널 내용은 껐다 켜면 되살릴 수 있는 물건이 아니고(원격 셸은 이미 죽었다), 저장하면
 * 파일 하나에 서버 출력 이력이 통째로 남아 사고 나기 딱 좋다. 그래서 되살아나는 것은
 * "이 자리에 web-01 이 있었다" 는 **배치**뿐이고, 그 안의 글자는 새로 채워진다.
 *
 * ## 왜 SSH 는 자동으로 붙지 않는가 (복원의 핵심 결정)
 *
 * 탭 두세 개에 SSH 타일이 열 개쯤 있는 것은 흔하다. 복원과 동시에 그 전부가
 * 핸드셰이크를 시작하면 [`newSshPane`] 하나하나가 서버의 `MaxStartups` 를 두드리고
 * (그룹 전체 열기의 `openDelay` 가 푸는 문제와 **같은 문제**다), TOFU·비밀번호 모달이
 * 시작하자마자 줄줄이 뜨며, 무엇보다 **사용자가 요청하지도 않은 접속**이 앱을 켜는 것만으로
 * 일어난다. 그래서 복원된 SSH 타일은 [`PaneSpec.deferred`] 로 **연결 대기** 상태로 뜨고,
 * 사람이 타일의 [연결] 을 누르거나 `reconnect-all`(기본 `Ctrl+Shift+R`)로 한꺼번에
 * — 그때도 계단식으로 — 붙인다. 설정 `app.auto_reconnect` 를 켜면 시작 직후 그 계단식
 * 재연결이 자동으로 한 번 돈다 (기본은 꺼짐).
 *
 * ## 이 파일의 범위
 *
 * 위쪽 절반은 **순수 함수**다 ([`serialize`]·[`deserialize`]·[`parseTabFile`]) —
 * 룬도 DOM 도 없고 트리를 값으로만 다룬다. 아래쪽에 백엔드 명령 세 개의 얇은 래퍼가
 * 붙어 있고 **전부 실패를 삼킨다** (명령이 아직 없는 백엔드에서도 앱은 떠야 한다).
 */

/** 파일 형식 버전. 모르는 버전은 **통째로 무시**한다 (아래 [`parseTabFile`]) */
export const TAB_FILE_VERSION = 1;

/** 저장된 잎 하나 — 런타임 전용 필드(`id`·`restore`·`openDelay`·`deferred`)는 담지 않는다 */
export interface SavedLeaf {
  tileKey?: string;
  kind: PaneKind;
  /**
   * **블록 이력 거울 키** ([`PaneSpec.historyStreamId`] · 2026-09-09 · 정체성 분리).
   *
   * `id` 와 달리 이건 **저장한다** — 이 값이 살아 돌아와야 AI 의 외부 참조 `(session, blockId)`
   * 가 앱을 껐다 켠 뒤에도 같은 스트림을 가리킨다. 이력 **내용**은 메모리 전용이라 리로드
   * 뒤엔 비어 있지만(디스크에 남기지 않는다), 참조가 "없는 세션" 오류가 아니라 **빈 이력**으로
   * 뜨는 것이 성공이다. 세션을 여는 타일(`local`·`ssh`)에만 있다 — 없으면 [`paneFrom`] 이 새로
   * 발급한다(옛 레이아웃 파일).
   */
  historyStreamId?: string;
  /**
   * kind === `"ssh"` 일 때의 `~/.ssh/config` 별칭.
   *
   * kind === `"sftp"` 도 이 칸만 저장한다 — 브라우저가 어느 터미널에 묶여 있었는지
   * (`sourcePaneId`) 는 **일부러 담지 않는다**. 패널 id 는 창 카운터가 매기는 런타임
   * 값이라 다음 실행에서는 아무것도 가리키지 못하기 때문이다. 복원 뒤 같은 별칭의 SSH
   * 타일을 찾아 다시 묶는다 ([`rebindSftp`]).
   */
  alias?: string;
  /**
   * kind === `"ssh"` · **빠른 접속 타일**의 접속 대상 ([`PaneSpec.adhoc`] ·
   * docs/log/2026-09-16-quick-connect-and-host-keys.md).
   *
   * `path`·`tmux` 와 같은 무리라 저장한다 — 이 값이 없으면 복원된 타일은 `alias`
   * (`user@host:port`)만 든 채 "설정에 없는 별칭" 으로 접속을 시도해 그 자리에서 실패한다.
   * 설정에 항목이 없는 것이 이 타일의 정의라, **파일이 그 대상을 아는 유일한 자리**다.
   */
  adhoc?: { host: string; user?: string; port?: number };
  /** kind === "local" 일 때의 셸 id (없으면 백엔드 기본 셸) */
  shell?: string;
  /**
   * kind === `"ssh"` 일 때 이 타일이 붙어 있던 **tmux 세션 이름**
   * ([`PaneSpec.tmux`] · docs/log/2026-09-16-tmux-toggle.md).
   *
   * `path` 와 같은 무리라 저장한다 — tmux 를 켜 두는 이유가 "끊겨도 그 자리로 돌아간다" 인데
   * 앱을 껐다 켜면 새 번호를 물어 남의(=방금 내가 쓰던) 세션 옆에 빈 화면이 하나 더 생기면
   * 그 말의 뜻이 하루를 못 넘긴다. 복원된 타일은 이 이름을 힌트로 되돌려 주고 백엔드가
   * `-A -D` 로 같은 세션에 다시 붙인다.
   *
   * 없어진 tmux 세션이면 그 이름으로 **새로 만들어진다**(`new-session -A`) — 오류가 아니다.
   */
  tmux?: string;
  /**
   * 원격 프로젝트가 "tmux 안 씀" 으로 연 SSH 타일 ([`PaneSpec.noTmux`] ·
   * docs/log/2026-09-24-projects.md). `adhoc` 과 같은 무리라 저장한다 — 없으면 복원된 타일이
   * 호스트 규칙대로 tmux 로 붙어 모양이 바뀐다.
   */
  noTmux?: boolean;
  /** 원격 프로젝트가 "tmux 켬" 으로 연 SSH 타일 ([`PaneSpec.forceTmux`]) — `noTmux` 와 같은 이유로 저장한다 */
  forceTmux?: boolean;
  /** 로컬 셸의 자동 실행 명령 — Claude Code 타일이 `"claude"` 로 되살아나는 근거다 */
  autorun?: string;
  /**
   * 로컬 셸의 **시작 폴더** ([`PaneSpec.cwd`]) — `autorun` 과 **같은 취급**이다.
   *
   * 되살아난 AI 타일이 claude 를 다시 띄우는데(`autorun`) 그 셸이 홈에서 뜨면 사용자가
   * 고른 프로젝트 맥락이 사라진다 — 껐다 켠 것만으로 폴더 안전 확인이 다시 나온다.
   * 그래서 이 둘은 함께 저장되고 함께 되살아난다. 없는 폴더면 백엔드가 조용히 홈으로
   * 떨어뜨리므로(`spawn_cwd`) 낡은 경로가 남아도 타일은 그대로 열린다.
   */
  cwd?: string;
  /**
   * AI 타일의 MCP 토큰 주입 표식 — `autorun` 과 함께 되살아나야 복원된 codex 타일도 인증한다
   * (Stage B). **표식(boolean)일 뿐 토큰 자체는 파일에 없다** — 실제 토큰은 세션 열 때
   * 살아 있는 McpState 에서 읽어 환경으로만 심는다. 그래서 파일에 비밀이 남지 않는다.
   */
  injectMcpToken?: boolean;
  /**
   * 타일 ↔ 대화 연결의 사본(`PaneSpec.agentLink` — 2026-10-17). 대화 id 와 에이전트 이름뿐이다. 없는 옛 파일 = 연결 없음.
   */
  agentLink?: { agent: string; id: string };
  /**
   * 로컬 셸 타일이 마지막으로 있던 폴더([`PaneSpec.lastCwd`] — 2026-11-12). 세션 서버까지 다시 떠 붙을 세션이 없으면 새 셸이
   * 이 폴더에서 뜬다. 모양은 검사하지 않는다(`cwd` 와 같은 이유 — 없는 폴더면 백엔드가 홈으로).
   */
  lastCwd?: string;
  /** 호스트별 스크롤백 (`sessions.toml` 에서 온 값) */
  scrollback?: number;
  /**
   * kind === `"localfs"` 일 때 그 브라우저가 보고 있던 폴더 (docs/log/2026-09-03-local-fs-tile.md).
   *
   * 로컬 브라우저는 프로젝트 디렉터리를 열어 두고 쓰는 물건이라, 앱을 껐다 켤 때마다 홈에서
   * 다시 찾아 들어가야 한다면 타일을 열어 두는 뜻이 반쯤 사라진다. **SFTP 와 다른 선택**인데,
   * 이유는 그쪽 경로가 원격 서버의 것이라 다음 실행에 그 서버가 붙어 있으리라는 보장이
   * 없기 때문이다 — 로컬 디스크는 늘 여기 있다.
   *
   * **빈 문자열("내 PC")은 담지 않는다.** 그러면 "키가 없다 = 정해진 자리가 없다 = 홈" 이
   * 규칙 하나로 끝난다 (드라이브 목록에서 복원되는 것보다 홈이 쓸모 있는 자리이기도 하다).
   * 경로가 사라졌으면 브라우저가 오류 한 줄을 남기고 홈으로 떨어진다.
   */
  path?: string;
  /**
   * 파일 타일의 **보기** ([`PaneSpec.fileView`] · docs/log/2026-09-25-file-tree-view.md) —
   * `path` 와 같은 무리라 저장한다. 사람이 그 타일에서 단추로 고른 값이 있을 때만 적힌다(없으면
   * 설정의 기본 보기를 따른다 — 기본을 바꾸면 따로 고른 적 없는 타일은 함께 바뀐다).
   */
  fileView?: FileView;
  /**
   * 파일 타일의 아이콘 크기 단계 · 장소 패널 끔 ([`PaneSpec.fileZoom`] · [`PaneSpec.filePlaces`]) — `fileView` 와 같은
   * 무리라 저장한다. 기본(크기 `1` · 패널 켬)이면 키가 없다.
   */
  fileZoom?: number;
  filePlaces?: false;
  /** 미리 보기 패널 켬 ([`PaneSpec.filePreview`]) — 켤 때만 적힌다 */
  filePreview?: true;
  /** 숨김 파일 보기 켬 ([`PaneSpec.fileHidden`]) — 켤 때만 적힌다(옛 파일 = 끔) */
  fileHidden?: true;
  /**
   * 문서 타일의 **보기** ([`PaneSpec.docMode`] · docs/log/2026-09-27-doc-tile.md) — `fileView` 와 같은
   * 무리라 저장한다. **기본(`rendered`)이 아닐 때만** 적힌다 — 키가 없다 = 그린 보기.
   */
  docMode?: DocMode;
  /** 문서 타일의 목차 패널 켬 ([`PaneSpec.docOutline`]) — 켤 때만 적힌다 */
  docOutline?: true;
  /** 문서 타일의 편집 중 보기 ([`PaneSpec.docEditView`]) — 나란히(기본)가 아닐 때만 적힌다 */
  docEditView?: Exclude<DocEditView, "split">;
  /** 문서 타일의 나란히 경계 비율 ([`PaneSpec.docSplit`]) — 기본(0.5)이 아닐 때만 적힌다 */
  docSplit?: number;
  /** 문서 타일의 글자 크기 % ([`PaneSpec.docZoom`]) — 기본(100)이 아닐 때만 적힌다 */
  docZoom?: number;
  /**
   * 문서 타일이 **미리 보기**인가 ([`PaneSpec.docPreview`]) — **참일 때만** 적힌다. 키가 없다 = 붙박이
   * (이 칸을 모르던 옛 배치도 붙박이로 선다 — 다음에 여는 파일이 몰래 갈아 끼우지 않는 쪽).
   */
  docPreview?: true;
  /**
   * kind === `"start"` · **프로젝트 시작 화면**의 주소 ([`PaneSpec.startProject`] ·
   * docs/log/2026-09-26-project-start-screen.md) — 프로젝트 id 와 워크트리 폴더. launcher 가 저장·복원되듯
   * 시작 화면도 **그 화면 그대로** 돌아온다(껐다 켜도 그 워크트리의 시작 화면). 대화 목록·제목은 담지 않는다 —
   * 화면이 뜰 때마다 다시 읽는다. 없으면 평범한 launcher 다. `host` 는 원격 프로젝트의 별칭(있을 때만 적는다).
   */
  startProject?: { projectId: string; folder: string; host?: string };
  /**
   * kind === `"branches"` · **브랜치 그래프의 주소** ([`PaneSpec.branchGraph`] · docs/log/2026-09-29-branch-graph.md) —
   * 프로젝트 id 와 (있으면) 고른 브랜치. 화면용 사본(`name`)은 담지 않는다 — 열 때 다시 채운다.
   */
  branchGraph?: { projectId: string; branch?: string };
  /**
   * kind === `"diff"` · **diff 타일의 주소** ([`PaneSpec.diff`] · docs/log/2026-10-05-diff-tile.md) — 프로젝트 id · 범위 ·
   * (있으면) 브랜치 · 워크트리 · 커밋 · 고른 파일 · 나란히 보기. 화면용 사본(`name`)과 줄 코멘트는 담지 않는다.
   */
  diff?: SavedDiff;
  /**
   * kind === `"query"` · **쿼리 타일의 주소** ([`PaneSpec.query`]) — 연결 id · (있으면) 초안(`QUERY_DRAFT_MAX` 이하일 때만) · 스크립트 탭.
   * 화면용 사본(`name`)은 담지 않는다. 경유 호스트는 연결(`db-connections.json`)이 쥔다 — 예전 저장본의 `host` 칸은 읽을 때 버린다.
   */
  query?: SavedQuery;
  /** kind === `"run"` · **보드 타일의 주소**(2b) — Run id. 없으면 Run 목록. */
  run?: { runId: string };
  /** kind === `"producer"` · **프로듀서 채팅 잎의 주소**(2단계 단계 3 — [`PaneSpec.producer`] 그대로 · 토큰 없음) */
  producer?: ProducerSpec;
  // (3차 6단계) 옛 조정자 표식 `orchestrationRunId`(2b)는 걷었다 — 옛 파일에 있어도 읽지 않는다(복원된 타일은 평범한 AI 타일).
}

/** 저장된 쿼리 타일 주소 — 키 순서가 늘 같아야 한다(자동 저장의 문자열 비교) */
export interface SavedQuery {
  connId: string;
  sql?: string;
  /** 고른 행 상한 — 기본값(1000)이면 없다 */
  maxRows?: QueryRowLimit;
  /** 스크립트 탭(10-14) — 둘 이상이거나 이름을 바꾼 탭이 있을 때만(아니면 `sql` 하나 — `canonQueryTabs`) */
  scripts?: QueryScript[];
  /** 고른 탭의 `n`(`scripts` 가 있을 때만) */
  active?: number;
}

/** 저장된 diff 주소 — 키 순서가 늘 같아야 한다(자동 저장의 문자열 비교) */
export interface SavedDiff {
  projectId: string;
  scope: DiffScopeKind;
  branch?: string;
  worktreePath?: string;
  commit?: string;
  base?: string;
  tip?: string;
  file?: string;
  view?: "split";
}

/** 저장된 분할 하나 — 방향과 비율 (화면 픽셀은 그때그때 다시 계산된다 · `px` 는 자르는 자리에 더하는 고정 몫 — `PaneSplit.px`) */
export interface SavedSplit {
  dir: SplitDir;
  ratio: number;
  px?: number;
  a: SavedNode;
  b: SavedNode;
}

/** 저장된 패널 트리. `dir` 이 있으면 분할, 없으면 잎이다 */
export type SavedNode = SavedLeaf | SavedSplit;

export interface SavedTab {
  tabKey?: string;
  projectId?: string;
  /** 사용자가 붙인 이름 ([`TabSpec.name`]) — 없으면 키 자체가 없다 */
  name?: string;
  /** 프로젝트 탭의 고정 제목 ([`TabSpec.pinnedTitle`]) — 없으면 키 자체가 없다(옛 파일도 같다) */
  pinnedTitle?: string;
  /** 로컬 프로젝트 탭의 폴더 ([`TabSpec.projectFolder`]) — 없으면 키 자체가 없다(옛 파일도 같다) */
  projectFolder?: string;
  /** 오케스트레이션 탭의 표지 ([`TabSpec.orch`] — 2026-10-29) — 없으면 키 자체가 없다(옛 파일도 같다) */
  orch?: OrchMark;
  /** 자동 제목 ([`TabSpec.title`]) */
  title: string;
  root: SavedNode;
}

/** 파일 하나 = 이 창의 탭 전부 + 어느 것을 보고 있었는가 */
export interface TabFile {
  version: number;
  /** 활성 탭의 위치 (범위를 벗어나면 0 으로 떨어진다) */
  activeIndex: number;
  /**
   * 탭 목록. **필드 이름은 옛 이름 그대로다** — 이 객체가 곧 `workspaces.json` 의 JSON 이라
   * 바꾸면 이미 저장된 파일을 못 읽어 열어 둔 탭 복원이 끊긴다 (docs/log/2026-09-29-workspace-to-tab.md).
   */
  workspaces: SavedTab[];
}

/** 저장된 노드가 분할인가 (복원·워크스페이스 저장 트리 조회 공용). */
export function isSavedSplit(node: SavedNode): node is SavedSplit {
  return typeof (node as SavedSplit).dir === "string";
}

// ---------------------------------------------------------------------------
// 직렬화 — 살아 있는 탭 → 파일 (순수)
// ---------------------------------------------------------------------------

/**
 * 잎 하나를 저장 모양으로. **런타임 전용 필드는 전부 떨군다**:
 * `id`(창마다 새로 매기는 화면 인스턴스 신원)·`restore`(창 이관 1회용)·
 * `openDelay`(그룹 열기 1회용)·`deferred`(복원 1회용). 그 값들이 파일에 남으면
 * 다음 실행이 "이관 도중이었다"·"몇 초 기다려라" 같은 지난 순간의 사정을 되살린다.
 */
function saveLeaf(pane: PaneSpec, workspaceKeys: boolean): SavedLeaf {
  if (workspaceKeys && pane.restart) pane = { ...pane, ...pane.restart };
  const out: SavedLeaf = { kind: pane.kind };
  if (workspaceKeys && pane.tileKey) out.tileKey = pane.tileKey;
  if (pane.alias) out.alias = pane.alias;
  // 빠른 접속 대상 — 키 순서를 **늘 같게** 담는다 (`serialize` 는 같은 배치에서 같은
  // 문자열을 내야 자동 저장의 문자열 비교가 성립한다).
  if (pane.adhoc) {
    out.adhoc = {
      host: pane.adhoc.host,
      ...(pane.adhoc.user ? { user: pane.adhoc.user } : {}),
      ...(typeof pane.adhoc.port === "number" ? { port: pane.adhoc.port } : {}),
    };
  }
  if (pane.shell) out.shell = pane.shell;
  // tmux 세션 이름 — `path` 와 같은 규칙(값이 있을 때만, 늘 같은 자리에).
  if (pane.tmux) out.tmux = pane.tmux;
  if (pane.noTmux) out.noTmux = true;
  if (pane.forceTmux) out.forceTmux = true;
  if (pane.autorun) out.autorun = pane.autorun;
  if (pane.cwd) out.cwd = pane.cwd;
  if (pane.injectMcpToken) out.injectMcpToken = true;
  if (pane.agentLink) out.agentLink = { agent: pane.agentLink.agent, id: pane.agentLink.id };
  if (pane.kind === "local" && pane.lastCwd) out.lastCwd = pane.lastCwd;
  if (typeof pane.scrollback === "number") out.scrollback = pane.scrollback;
  if (pane.path) out.path = pane.path;
  if (pane.fileView) out.fileView = pane.fileView;
  if (typeof pane.fileZoom === "number" && pane.fileZoom !== DEFAULT_FILE_ZOOM) out.fileZoom = pane.fileZoom;
  if (pane.filePlaces === false) out.filePlaces = false;
  if (pane.filePreview === true) out.filePreview = true;
  if (pane.fileHidden === true) out.fileHidden = true;
  // 문서의 보기 — 기본(그린 보기)이 아닐 때만. 같은 배치가 늘 같은 글자를 내야 한다(자동 저장의 문자열 비교).
  if (pane.kind === "doc" && pane.docMode && pane.docMode !== "rendered") out.docMode = pane.docMode;
  // 목차 패널 — 켤 때만(기본 꺼짐).
  if (pane.kind === "doc" && pane.docOutline === true) out.docOutline = true;
  // 편집 중 보기 · 나란히 비율 — 기본(나란히 · 반반)이 아닐 때만.
  if (pane.kind === "doc" && pane.docEditView) out.docEditView = pane.docEditView;
  if (pane.kind === "doc" && pane.docSplit !== undefined && pane.docSplit !== DOC_SPLIT_DEFAULT) out.docSplit = clampDocSplit(pane.docSplit);
  // 글자 크기 — 기본(100)이 아닐 때만, 단계로 맞춰.
  if (pane.kind === "doc" && pane.docZoom !== undefined) {
    const z = clampDocZoom(pane.docZoom);
    if (z !== null && z !== DOC_ZOOM_DEFAULT) out.docZoom = z;
  }
  // 미리 보기 표식 — 참일 때만(붙박이가 기본이라 키가 없다).
  if (pane.kind === "doc" && pane.docPreview === true) out.docPreview = true;
  // 이력 거울 키만은 런타임 전용이 아니다 — 저장해야 AI 외부 참조가 리로드를 넘는다
  // (세션 타일에만 있어, 다른 종류에서는 값이 없어 키도 두지 않는다).
  if (pane.historyStreamId) out.historyStreamId = pane.historyStreamId;
  // 프로젝트 시작 화면의 주소 — 시작 타일에만, 늘 같은 키 순서로.
  if (pane.kind === "start" && pane.startProject) {
    out.startProject = { projectId: pane.startProject.projectId, folder: pane.startProject.folder };
    if (pane.startProject.host) out.startProject.host = pane.startProject.host;
  }
  // 브랜치 그래프의 주소 — 프로젝트 id · (있으면) 고른 브랜치만, 늘 같은 키 순서로.
  if (pane.kind === "branches" && pane.branchGraph?.projectId) {
    out.branchGraph = { projectId: pane.branchGraph.projectId };
    if (pane.branchGraph.branch) out.branchGraph.branch = pane.branchGraph.branch;
  }
  // diff 타일의 주소 — 늘 같은 키 순서로, 값이 있는 칸만.
  if (pane.kind === "diff" && pane.diff?.projectId) {
    const d = pane.diff;
    const sd: SavedDiff = { projectId: d.projectId, scope: d.scope };
    if (d.branch) sd.branch = d.branch;
    if (d.worktreePath) sd.worktreePath = d.worktreePath;
    if (d.commit) sd.commit = d.commit;
    if (d.base) sd.base = d.base;
    if (d.tip) sd.tip = d.tip;
    if (d.file) sd.file = d.file;
    if (d.view === "split") sd.view = "split";
    out.diff = sd;
  }
  // 쿼리 타일의 주소 — 늘 같은 키 순서로. 초안은 상한 안일 때만(넘으면 싣지 않는다 — 배치 파일이 부풀지 않게).
  if (pane.kind === "query" && pane.query?.connId) {
    const q = pane.query;
    const sq: SavedQuery = { connId: q.connId };
    const tabs = canonQueryTabs(q);
    if (tabs.sql !== undefined) sq.sql = tabs.sql;
    const rows = storedRowLimit(q.maxRows);
    if (rows !== undefined) sq.maxRows = rows;
    if (tabs.scripts) {
      sq.scripts = tabs.scripts;
      sq.active = tabs.active;
    }
    out.query = sq;
  }
  // 보드 타일의 주소(2b) — Run id 하나.
  if (pane.kind === "run" && pane.run?.runId) out.run = { runId: pane.run.runId };
  // 프로듀서 채팅 잎(2단계 단계 3) — 주소 칸 그대로(키 순서 고정 · 빈 칸은 싣지 않는다).
  if (pane.kind === "producer" && pane.producer) out.producer = saveProducerSpec(pane.producer);
  return out;
}

/** 살아 있는 트리 → 저장 명세. serialize는 영속 workspace 키까지 포함한다. */
export function saveNode(node: PaneNode, workspaceKeys = false): SavedNode {
  if (node.type === "leaf") return saveLeaf(node.pane, workspaceKeys);
  return {
    dir: node.dir,
    ratio: node.ratio,
    ...(node.px ? { px: node.px } : {}),
    a: saveNode(node.a, workspaceKeys),
    b: saveNode(node.b, workspaceKeys),
  };
}

/**
 * 지금 열려 있는 탭 전부를 파일 모양으로 — **순수 함수**.
 *
 * 자동 저장([`+page.svelte`] 의 디바운스 `$effect`)이 매번 이 결과를 `JSON.stringify` 해
 * 직전 값과 비교하므로, **같은 배치면 같은 문자열**이 나와야 한다. 그래서 여기서는
 * 순서가 정해진 필드만, 값이 있을 때만 담는다 (`undefined` 를 넣으면 키 유무가 흔들린다).
 */
export function serialize(tabs: readonly TabSpec[], activeId: string | null): TabFile {
  const at = tabs.findIndex((t) => t.id === activeId);
  return {
    version: TAB_FILE_VERSION,
    activeIndex: at < 0 ? 0 : at,
    workspaces: tabs.map((tab) => {
      const name = tab.name?.trim();
      const pinnedTitle = tab.pinnedTitle?.trim();
      const projectFolder = tab.projectFolder?.trim();
      const orch = saveOrchMark(tab.orch);
      return {
        ...(name ? { name } : {}),
        ...(pinnedTitle ? { pinnedTitle } : {}),
        ...(projectFolder ? { projectFolder } : {}),
        ...(orch ? { orch } : {}),
        ...(tab.tabKey ? { tabKey: tab.tabKey } : {}),
        ...(tab.projectId ? { projectId: tab.projectId } : {}),
        title: tab.title,
        root: saveNode(tab.root, true),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// 검증 — 파일 → 믿을 수 있는 모양 (순수, 절대 throw 하지 않는다)
//
// 이 파일은 사람이 손으로 고칠 수도 있고, 옛 버전이 남긴 것일 수도 있다. 그런 값 하나가
// 부팅을 통째로 막으면 앱을 못 켠다 — 그래서 **모르면 null 을 돌려주고 새 탭으로
// 시작**한다. 부분 복구(고칠 수 있는 만큼만 살리기)는 하지 않는다: 반쯤 복원된 배치는
// 사용자가 무엇을 잃었는지 알 수 없어 더 나쁘다.
// ---------------------------------------------------------------------------

// `"start"` 도 저장·복원한다 (docs/log/2026-09-04-start-page.md) — **빈 탭을 열어
// 둔 채 앱을 껐으면 그대로 돌아와야 한다.** 빼면 그 탭의 잎이 사라져 파일 전체가
// `null` 로 떨어지고(모르는 kind = 파일을 의심한다), 나머지 멀쩡한 배치까지 함께 날아간다.
//
// `"hosts"` 는 **뺐다** (docs/log/2026-09-08-remove-hosts-tile.md). 그 종류의 잎이 남아 있는
// 파일은 위 규칙 그대로 모르는 kind 로 취급된다 — `workspaces.json` 이면 파일 전체를 버리고
// 새 탭으로 시작한다. v2 원본 검증은 workspaces/schema와 migrate가 맡는다. 마이그레이션
// 코드를 두지 않은 것은 그 값을 저장해 둔 파일이 없기 때문이다(타일은 하루를 못 살았다).
//
// `"doc"`(문서 보기 — docs/log/2026-09-27-doc-tile.md)도 여기 있어야 한다. 빠지면 문서 타일 하나를 열어 둔
// 채 껐을 때 **파일 전체**가 날아간다(위 규칙).
//
// `"branches"`(브랜치 그래프 — docs/log/2026-09-29-branch-graph.md)도 같은 까닭으로 여기 있다.
//
// `"diff"`(diff 타일 — docs/log/2026-10-05-diff-tile.md)도 같은 까닭으로 여기 있다.
//
// `"query"`(쿼리 타일 — 2026-10-12)도 같은 까닭으로 여기 있다.
//
// `"run"`(오케스트레이션 보드 — 2026-10-15 · 2b)도 같은 까닭으로 여기 있다.
//
// `"producer"`(프로듀서 채팅 잎 — 2026-10-30 · 2단계 단계 3)도 같은 까닭으로 여기 있다.
//
// `"image"`(이미지 타일 — 2026-11-14)도 같은 까닭으로 여기 있다.
const KNOWN_KINDS: readonly PaneKind[] = ["local", "ssh", "sftp", "localfs", "start", "doc", "image", "branches", "diff", "query", "run", "producer"];

// **걷은 종류** — 이 잎이 남은 파일을 버리지 않고 **잎만 조용히 뺀다**(형제가 자리를 차지한다 · 탭이 그 잎 하나뿐이었으면 시작 타일).
// `"plans"`(작업안 타일 — 2026-10-07 ~ 10-25, 채팅 독의 갈래로 옮겼다 · docs/log/2026-10-25-plans-tile-refresh.md). 위 "모르는 kind =
// 파일을 의심한다" 규칙의 예외다 — 이 앱이 스스로 써 둔 값이라 파일 전체를 버릴 까닭이 없다.
export const RETIRED_KINDS: readonly string[] = ["plans"];

/** 저장 트리의 잎이 걷은 종류인가(원시 값 · 검증된 잎 모두) */
function isRetiredLeaf(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const kind = (raw as Record<string, unknown>).kind;
  return typeof kind === "string" && RETIRED_KINDS.includes(kind);
}

/**
 * 저장 트리에서 **걷은 종류의 잎을 뺀다**(순수) — 분할의 한쪽이 그 잎이면 다른 쪽이 그 자리를 차지한다(타일 닫기와 같은 접힘).
 * 트리 전체가 그 잎뿐이면 `null`(부르는 쪽이 시작 타일로).
 */
export function pruneRetiredLeaves(node: SavedNode): SavedNode | null {
  return pruneLeaves(node, isRetiredLeaf);
}

/** 저장 트리에서 `drop` 이 고른 잎을 뺀다(순수 — 분할의 한쪽이 빠지면 다른 쪽이 그 자리를 차지한다). 전부 빠지면 `null` */
function pruneLeaves(node: SavedNode, drop: (leaf: SavedNode) => boolean): SavedNode | null {
  if (isSavedSplit(node)) {
    const a = pruneLeaves(node.a, drop);
    const b = pruneLeaves(node.b, drop);
    if (a === null) return b;
    if (b === null) return a;
    return a === node.a && b === node.b ? node : { ...node, a, b };
  }
  return drop(node) ? null : node;
}

/**
 * 저장된 빠른 접속 대상 하나를 되살린다 — 못 쓸 모양이면 `null` (순수 함수).
 *
 * 받는 것은 **모양**뿐이다: `host` 는 비어 있지 않은 문자열, `user` 는 있으면 문자열,
 * `port` 는 있으면 1–65535 정수. 호스트 **문법**(점·대괄호·금지 문자)은 보지 않는다 —
 * 그 규칙은 `quick-connect.ts` 와 백엔드에 있고, 여기에 한 벌 더 두면 세 규칙이 갈라진다.
 */
function parseAdhoc(raw: unknown): SavedLeaf["adhoc"] | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const host = typeof o.host === "string" ? o.host.trim() : "";
  if (host === "") return null;
  const user = typeof o.user === "string" ? o.user.trim() : "";
  const port =
    typeof o.port === "number" && Number.isInteger(o.port) && o.port >= 1 && o.port <= 65535
      ? o.port
      : undefined;
  return {
    host,
    ...(user !== "" ? { user } : {}),
    ...(port !== undefined ? { port } : {}),
  };
}

/** 대화 연결 사본 — 아는 에이전트 둘 · id 는 영숫자와 `-` 8–64자(Claude UUID · Codex id). 모양이 틀리면 칸을 떨군다 */
function parseAgentLink(raw: unknown): SavedLeaf["agentLink"] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { agent, id } = raw as Record<string, unknown>;
  if (agent !== "claude" && agent !== "codex") return null;
  if (typeof id !== "string" || !/^[0-9A-Za-z-]{8,64}$/.test(id)) return null;
  return { agent, id: id.toLowerCase() };
}

function parseLeaf(raw: Record<string, unknown>): SavedLeaf | null {
  const kind = raw.kind;
  // 걷은 종류의 잎이 트리 전체였다 — 파일을 버리지 않고 시작 타일로(분할 안의 것은 [`parseNode`] 가 이미 뺐다)
  if (isRetiredLeaf(raw)) return { kind: "start" };
  if (typeof kind !== "string" || !KNOWN_KINDS.includes(kind as PaneKind)) return null;
  const out: SavedLeaf = { kind: kind as PaneKind };
  if (typeof raw.tileKey === "string") out.tileKey = raw.tileKey;
  if (typeof raw.alias === "string" && raw.alias.trim() !== "") out.alias = raw.alias.trim();
  // 빠른 접속 대상 — **호스트 문법은 검사하지 않는다**(판정은 `quick-connect.ts` 와 백엔드
  // 두 곳이면 충분하다). 여기서 보는 것은 모양뿐이고, 못 쓸 값이면 칸 하나만 떨어뜨린다
  // (그러면 그 타일은 설정 별칭으로 붙으려다 평소의 접속 실패 배너를 낸다).
  const adhoc = parseAdhoc(raw.adhoc);
  if (adhoc) out.adhoc = adhoc;
  if (typeof raw.shell === "string" && raw.shell.trim() !== "") out.shell = raw.shell.trim();
  // tmux 세션 이름 — 모양은 백엔드가 다시 잠근다(`[A-Za-z0-9-]`, `valid_tmux_name`). 여기서
  // 규칙을 한 벌 더 두면 두 규칙이 갈라진다. 못 쓸 이름이면 힌트가 무시되고 새 번호가 잡힌다.
  if (typeof raw.tmux === "string" && raw.tmux.trim() !== "") out.tmux = raw.tmux.trim();
  if (raw.noTmux === true) out.noTmux = true;
  if (raw.forceTmux === true) out.forceTmux = true;
  if (typeof raw.autorun === "string" && raw.autorun.trim() !== "") out.autorun = raw.autorun;
  // 시작 폴더도 **모양을 검사하지 않는다** — 아래 `path` 와 같은 이유다 (판정은 백엔드 하나).
  if (typeof raw.cwd === "string" && raw.cwd.trim() !== "") out.cwd = raw.cwd.trim();
  if (raw.injectMcpToken === true) out.injectMcpToken = true;
  const link = parseAgentLink(raw.agentLink);
  if (link) out.agentLink = link;
  if (typeof raw.lastCwd === "string" && raw.lastCwd.trim() !== "") out.lastCwd = raw.lastCwd.trim();
  const lines = clampScrollback(typeof raw.scrollback === "number" ? raw.scrollback : undefined);
  if (lines !== undefined) out.scrollback = lines;
  // 경로는 **모양을 검사하지 않는다** — 절대/상대·구분자 방향·존재 여부의 판정은 전부
  // 백엔드에 있고(docs/log/2026-09-03-local-fs-backend.md 6절), 여기서 규칙을 한 벌 더
  // 두면 두 규칙이 갈라진다. 못 읽는 경로면 브라우저가 오류를 보이고 홈으로 떨어진다.
  if (typeof raw.path === "string" && raw.path.trim() !== "") out.path = raw.path.trim();
  // 보기 — 아는 세 값만 받는다. 옛 `tree`·`navigate` 는 `details` 로 옮기고(`migrateFileView`), 모르는 글자면 칸을
  // 떨어뜨려 설정의 기본 보기로 선다.
  const view = migrateFileView(raw.fileView);
  if (view) out.fileView = view;
  // 아이콘 크기 단계 — 범위 안의 정수만(밖이면 칸을 떨어뜨려 기본 크기). 장소 패널은 `false` 만 적힌다.
  const zoom = clampFileZoom(raw.fileZoom);
  if (zoom !== null && zoom !== DEFAULT_FILE_ZOOM) out.fileZoom = zoom;
  if (raw.filePlaces === false) out.filePlaces = false;
  if (raw.filePreview === true) out.filePreview = true;
  if (raw.fileHidden === true) out.fileHidden = true;
  // 문서의 보기 — 문서 잎에만, 아는 값이고 기본이 아닐 때만(모르는 글자면 그 칸만 떨어져 그린 보기로 선다).
  if (out.kind === "doc" && isDocMode(raw.docMode) && raw.docMode !== "rendered") out.docMode = raw.docMode;
  // 목차 패널 — 문서 잎에만, **`true` 만**(다른 글자면 그 칸만 떨어져 꺼진 채 선다).
  if (out.kind === "doc" && raw.docOutline === true) out.docOutline = true;
  // 편집 중 보기 — 문서 잎에만, 아는 값이고 기본(나란히)이 아닐 때만. 비율은 숫자면 20~80% 로 묶고 기본이면 떨군다.
  if (out.kind === "doc" && isDocEditView(raw.docEditView) && raw.docEditView !== "split") out.docEditView = raw.docEditView;
  if (out.kind === "doc" && typeof raw.docSplit === "number" && Number.isFinite(raw.docSplit)) {
    const r = clampDocSplit(raw.docSplit);
    if (r !== DOC_SPLIT_DEFAULT) out.docSplit = r;
  }
  // 글자 크기 — 문서 잎에만, 숫자면 가장 가까운 단계로 맞추고 기본(100)이면 떨군다.
  if (out.kind === "doc") {
    const z = clampDocZoom(raw.docZoom);
    if (z !== null && z !== DOC_ZOOM_DEFAULT) out.docZoom = z;
  }
  // 미리 보기 표식 — 문서 잎에만, **`true` 만**(다른 글자면 그 칸만 떨어져 붙박이로 선다).
  if (out.kind === "doc" && raw.docPreview === true) out.docPreview = true;
  // 이력 거울 키를 실어 나른다 — 없으면 [`paneFrom`] 이 새로 발급한다(옛 레이아웃 파일).
  if (typeof raw.historyStreamId === "string" && raw.historyStreamId.trim() !== "")
    out.historyStreamId = raw.historyStreamId.trim();
  // 프로젝트 시작 화면의 주소 — 두 칸이 다 비어 있지 않은 글자일 때만. 못 쓸 모양이면 그 칸만 떨어뜨려
  // 평범한 launcher 로 선다(파일 전체를 의심할 일이 아니다).
  if (out.kind === "start" && raw.startProject && typeof raw.startProject === "object") {
    const sp = raw.startProject as Record<string, unknown>;
    const projectId = typeof sp.projectId === "string" ? sp.projectId.trim() : "";
    const folder = typeof sp.folder === "string" ? sp.folder.trim() : "";
    const host = typeof sp.host === "string" ? sp.host.trim() : "";
    if (projectId !== "" && folder !== "") out.startProject = host !== "" ? { projectId, folder, host } : { projectId, folder };
  }
  // 브랜치 그래프의 주소 — 프로젝트 id 가 비어 있지 않은 글자일 때만(브랜치는 있으면). 못 쓸 모양이면 칸이 떨어지고,
  // 주소 없는 잎은 복원 뒤 [`rebindSftp`] 가 뺀다(여기서 null 을 주면 파일 전체가 날아간다).
  if (out.kind === "branches" && raw.branchGraph && typeof raw.branchGraph === "object") {
    const bg = raw.branchGraph as Record<string, unknown>;
    const projectId = typeof bg.projectId === "string" ? bg.projectId.trim() : "";
    const branch = typeof bg.branch === "string" ? bg.branch.trim() : "";
    if (projectId !== "") out.branchGraph = branch !== "" ? { projectId, branch } : { projectId };
  }
  // diff 타일의 주소 — 프로젝트 id 와 아는 범위가 있을 때만. 못 쓸 칸은 떨어지고, 주소 없는 잎은 [`rebindSftp`] 가 뺀다.
  if (out.kind === "diff" && raw.diff && typeof raw.diff === "object") {
    const d = raw.diff as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const projectId = text(d.projectId);
    const scope = d.scope;
    if (projectId !== "" && (scope === "branch" || scope === "commit" || scope === "wip" || scope === "range")) {
      const sd: SavedDiff = { projectId, scope };
      if (text(d.branch)) sd.branch = text(d.branch);
      if (text(d.worktreePath)) sd.worktreePath = text(d.worktreePath);
      if (text(d.commit)) sd.commit = text(d.commit);
      if (text(d.base)) sd.base = text(d.base);
      if (text(d.tip)) sd.tip = text(d.tip);
      if (typeof d.file === "string" && d.file !== "") sd.file = d.file;
      if (d.view === "split") sd.view = "split";
      out.diff = sd;
    }
  }
  // 쿼리 타일의 주소 — 연결 id 가 비어 있지 않은 글자일 때만(초안은 상한 안이면). 못 쓸 모양이면 칸이 떨어지고, 주소 없는
  // 잎은 [`rebindSftp`] 가 뺀다(여기서 null 을 주면 파일 전체가 날아간다). 예전(10-13 전) 저장본의 `host` 칸은 버린다 — 연결 id
  // 하나로 열린다(경유는 연결이 쥔다).
  if (out.kind === "query" && raw.query && typeof raw.query === "object") {
    const q = raw.query as Record<string, unknown>;
    const connId = typeof q.connId === "string" ? q.connId.trim() : "";
    if (connId !== "") {
      const sq: SavedQuery = { connId };
      const tabs = canonQueryTabs(q);
      if (tabs.sql !== undefined) sq.sql = tabs.sql;
      const rows = storedRowLimit(q.maxRows);
      if (rows !== undefined) sq.maxRows = rows;
      if (tabs.scripts) {
        sq.scripts = tabs.scripts;
        sq.active = tabs.active;
      }
      out.query = sq;
    }
  }
  // 보드 타일의 주소(2b) — 비어 있지 않은 Run id 글자일 때만(모양은 서버가 판정한다 — 모르는 id 면 보드가 '없음' 을 그린다).
  if (out.kind === "run" && raw.run && typeof raw.run === "object") {
    const runId = (raw.run as Record<string, unknown>).runId;
    if (typeof runId === "string" && runId.trim() !== "") out.run = { runId: runId.trim() };
  }
  // 프로듀서 채팅 잎(2단계 단계 3) — 모양이 틀리면 칸만 버린다(복원이 새 채팅 id 로 다시 짓는다 — 잎은 빼지 않는다).
  if (out.kind === "producer") {
    const p = parseProducerSpec(raw.producer);
    if (p) out.producer = p;
  }
  // 별칭 없는 SSH 잎은 되살려 봐야 접속할 곳이 없다 — 파일 전체를 의심한다.
  if (out.kind === "ssh" && !out.alias) return null;
  // 별칭 없는 SFTP 잎도 마찬가지다 — 별칭이 원본 터미널을 다시 찾는 **유일한 열쇠**라
  // (아래 [`rebindSftp`]) 없으면 어디에도 붙일 수 없는 타일이 된다.
  if (out.kind === "sftp" && !out.alias) return null;
  // 문서 잎은 **여기서 버리지 않는다** — 별칭이 없는 것은 로컬 파일이라 정상이고, 경로가 없는 것은 그
  // 잎 하나만 뜻이 없다(null 을 돌려주면 파일 전체가 날아간다). 경로 없는 잎은 복원 뒤 [`rebindSftp`] 가
  // 빼고 형제를 승격시킨다.
  return out;
}

/**
 * 원시 값 하나 → 믿을 수 있는 저장 트리, 아니면 `null` — **순수 함수, throw 하지 않는다**.
 *
 * [`saveNode`] 와 같은 이유로 내보낸다: 배치 프리셋 파일의 `tree` 도 **같은 검증**을 지나야
 * 한다 (같은 잎 모양을 쓰므로 규칙이 갈리면 한쪽 파일만 통과하는 값이 생긴다).
 */
export function parseNode(
  raw: unknown,
  depth = 0,
): SavedNode | null {
  // 깊이 상한은 손으로 만든 순환/거대 트리에 대한 방어다 (실제 배치는 10 을 넘지 않는다).
  if (depth > 64 || !raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.dir === "string") {
    if (o.dir !== "row" && o.dir !== "col") return null;
    // 걷은 종류의 잎은 조용히 빼고 형제가 자리를 차지한다([`RETIRED_KINDS`])
    if (isRetiredLeaf(o.a)) return parseNode(o.b, depth + 1);
    if (isRetiredLeaf(o.b)) return parseNode(o.a, depth + 1);
    const a = parseNode(o.a, depth + 1);
    const b = parseNode(o.b, depth + 1);
    if (!a || !b) return null;
    return {
      dir: o.dir,
      ratio: clampRatio(typeof o.ratio === "number" ? o.ratio : NaN),
      ...(typeof o.px === "number" && Number.isFinite(o.px) && o.px !== 0 ? { px: o.px } : {}),
      a,
      b,
    };
  }
  return parseLeaf(o);
}

/**
 * 백엔드가 준 원시 JSON 문자열을 검증된 [`TabFile`] 로 — **모양이 조금이라도
 * 어긋나면 `null`**. 파싱 실패·모르는 버전·빈 목록도 전부 `null` 이다.
 */
export function parseTabFile(json: string | null | undefined): TabFile | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== TAB_FILE_VERSION) return null;
  if (!Array.isArray(o.workspaces) || o.workspaces.length === 0) return null;

  const saved: SavedTab[] = [];
  for (const w of o.workspaces) {
    if (!w || typeof w !== "object") return null;
    const t = w as Record<string, unknown>;
    const root = parseNode(t.root);
    if (!root) return null;
    const name = typeof t.name === "string" ? t.name.trim() : "";
    const pinnedTitle = typeof t.pinnedTitle === "string" ? t.pinnedTitle.trim() : "";
    const projectFolder = typeof t.projectFolder === "string" ? t.projectFolder.trim() : "";
    const orch = parseOrchMark(t.orch);
    saved.push({
      ...(name ? { name } : {}),
      ...(pinnedTitle ? { pinnedTitle } : {}),
      ...(projectFolder ? { projectFolder } : {}),
      ...(orch ? { orch } : {}),
      ...(typeof t.tabKey === "string" ? { tabKey: t.tabKey } : {}),
      ...(typeof t.projectId === "string" ? { projectId: t.projectId } : {}),
      title: typeof t.title === "string" ? t.title : "",
      root,
    });
  }

  const at = typeof o.activeIndex === "number" ? Math.floor(o.activeIndex) : 0;
  return {
    version: TAB_FILE_VERSION,
    activeIndex: at >= 0 && at < saved.length ? at : 0,
    workspaces: saved,
  };
}

// ---------------------------------------------------------------------------
// 역직렬화 — 파일 → 살아 있는 탭 (순수, 새 id)
// ---------------------------------------------------------------------------

export interface DeserializeOptions {
  /**
   * 복원된 SSH 타일을 **연결 대기**([`PaneSpec.deferred`])로 둘 것인가. 기본 `true` —
   * 이 파일 첫머리의 "왜 SSH 는 자동으로 붙지 않는가" 가 그 이유다.
   * `false` 로 부르는 자리는 지금 없다 (테스트·후속 기능을 위한 구멍).
   */
  deferSsh?: boolean;
}

/**
 * 저장된 잎 → **새 패널 명세**. 패널 생성자를 그대로 지나므로 id 는 이 창 카운터에서
 * 새로 나온다 (`adoptTab` 이 창 이관에서 하는 것과 같은 재부여).
 *
 * 로컬 셸은 **새 셸**로 되살아난다 — 죽은 프로세스를 되살릴 방법이 없으니 같은 셸을 같은
 * 자리에 새로 여는 것이 할 수 있는 전부다. `autorun` 은 남기므로 Claude Code 타일
 * (`autorun:"claude"`)은 복원과 함께 claude 를 다시 띄운다 (이것은 로컬 명령이라 안전하다).
 */
function paneFrom(leaf: SavedLeaf, deferSsh: boolean): PaneSpec {
  const pane = basePaneFrom(leaf, deferSsh);
  if (leaf.tileKey) pane.tileKey = leaf.tileKey;
  return pane;
}

/** 종류별 되살리기 — [`paneFrom`] 이 그 위에 종류와 무관한 성질을 얹는다 */
function basePaneFrom(leaf: SavedLeaf, deferSsh: boolean): PaneSpec {
  switch (leaf.kind) {
    case "ssh": {
      // 빠른 접속 타일은 **대상이 파일에만 있다** — 그래서 되살릴 때도 전용 생성자를 쓰되
      // 화면 이름(`alias`)은 저장된 것을 그대로 쓴다 (사람이 보던 글자가 그대로 돌아온다).
      const pane = leaf.adhoc
        ? { ...newAdhocSshPane(leaf.adhoc), alias: leaf.alias ?? "" }
        : newSshPane(leaf.alias ?? "", leaf.scrollback ?? null);
      if (deferSsh) pane.deferred = true;
      // 붙어 있던 tmux 세션으로 되돌아가는 힌트 (없으면 백엔드가 새 번호를 고른다).
      if (leaf.tmux) pane.tmux = leaf.tmux;
      // 원격 프로젝트의 "tmux 안 씀" — 재연결도 같은 모양이어야 한다 (`autorun`·`cwd` 는 되살리지
      // 않는다: 그 둘은 첫 접속 한 번의 것이다 — docs/log/2026-09-24-projects.md).
      if (leaf.noTmux) pane.noTmux = true;
      if (leaf.forceTmux) pane.forceTmux = true;
      // 복원된 SSH의 시작 폴더는 위치·저장 힌트로만 보존한다(첫 접속 명령은 재실행하지 않는다).
      if (leaf.cwd) pane.restart = { cwd: leaf.cwd };
      // 저장된 거울 키를 되살린다 (없으면 생성자가 발급한 새 값 그대로 — 옛 레이아웃 파일).
      if (leaf.historyStreamId) pane.historyStreamId = leaf.historyStreamId;
      if (leaf.agentLink) pane.agentLink = { ...leaf.agentLink };
      return pane;
    }
    case "local": {
      const pane = newLocalPane(leaf.shell);
      if (leaf.autorun) pane.autorun = leaf.autorun;
      // autorun 과 함께 되살린다 — 복원된 AI 타일이 그 프로젝트 폴더에서 다시 뜬다.
      if (leaf.cwd) pane.cwd = leaf.cwd;
      // autorun 과 함께 되살린다 — 복원된 AI 타일이 첫 세션에서 토큰을 주입하게 (codex 인증).
      if (leaf.injectMcpToken) pane.injectMcpToken = true;
      // 마지막 폴더 — 붙을 세션이 없으면 새 셸이 거기서 뜬다(`session/last-cwd`)
      if (leaf.lastCwd) pane.lastCwd = leaf.lastCwd;
      const lines = clampScrollback(leaf.scrollback);
      if (lines !== undefined) pane.scrollback = lines;
      if (leaf.historyStreamId) pane.historyStreamId = leaf.historyStreamId;
      if (leaf.agentLink) pane.agentLink = { ...leaf.agentLink };
      return pane;
    }
    // 시작 타일은 들고 있는 상태가 없다 — 종류 하나로 그대로 되살아난다. 프로젝트 시작 화면이면
    // 그 주소(프로젝트 id · 워크트리 폴더)만 되살린다 — 목록은 화면이 뜨며 다시 읽는다.
    case "start":
      return leaf.startProject
        ? newProjectStartPane(leaf.startProject.projectId, leaf.startProject.folder, leaf.startProject.host)
        : newStartPane();
    // 로컬 브라우저는 **빌릴 것이 없어** 그대로 되살아난다 (세션도 원본 타일도 없다).
    // 저장해 둔 폴더가 있으면 거기서, 없으면 홈에서 시작한다.
    case "localfs": {
      const pane = newLocalFsPane(leaf.path);
      if (leaf.fileView) pane.fileView = leaf.fileView;
      if (leaf.fileZoom !== undefined) pane.fileZoom = leaf.fileZoom;
      if (leaf.filePlaces === false) pane.filePlaces = false;
      if (leaf.filePreview === true) pane.filePreview = true;
      if (leaf.fileHidden === true) pane.fileHidden = true;
      return pane;
    }
    case "sftp": {
      // `sourcePaneId` 는 여기서 채울 수 없다 — 원본 터미널 패널이 아직 만들어지지 않았을
      // 수도 있고(트리 순서는 사용자가 정한다), 그 id 는 어차피 이번 실행에서 새로 매겨진다.
      // 빈 값으로 두고 트리가 다 세워진 뒤 [`rebindSftp`] 가 별칭으로 짝을 찾는다.
      // 보던 폴더(`path`)는 로컬 브라우저와 같은 규칙으로 되살린다 — 사라졌으면 홈이다.
      const pane = newSftpPane("", leaf.alias ?? "", leaf.path);
      if (leaf.fileView) pane.fileView = leaf.fileView;
      if (leaf.fileZoom !== undefined) pane.fileZoom = leaf.fileZoom;
      if (leaf.filePlaces === false) pane.filePlaces = false;
      if (leaf.filePreview === true) pane.filePreview = true;
      if (leaf.fileHidden === true) pane.fileHidden = true;
      return pane;
    }
    // 문서 보기 — 로컬이면 그대로, 원격(별칭 있음)이면 SFTP 와 같이 `sourcePaneId` 를 비워 두고
    // [`rebindSftp`] 가 같은 별칭의 SSH 타일에 다시 묶는다. 경로가 없으면 빈 값으로 두고 거기서 뺀다.
    case "doc": {
      const alias = leaf.alias?.trim();
      const pane = newDocPane(leaf.path ?? "", alias ? { paneId: "", alias } : undefined);
      if (leaf.docMode) pane.docMode = leaf.docMode;
      if (leaf.docOutline === true) pane.docOutline = true;
      if (leaf.docEditView) pane.docEditView = leaf.docEditView;
      if (leaf.docSplit !== undefined) pane.docSplit = clampDocSplit(leaf.docSplit);
      if (leaf.docZoom !== undefined) {
        const z = clampDocZoom(leaf.docZoom);
        if (z !== null && z !== DOC_ZOOM_DEFAULT) pane.docZoom = z;
      }
      if (leaf.docPreview === true) pane.docPreview = true;
      return pane;
    }
    // 그림 보기 — 문서 보기와 같은 주소(로컬 그대로 · 원격은 [`rebindSftp`] 가 다시 묶는다). 배율 · 이동 위치는 저장하지 않는다.
    case "image": {
      const alias = leaf.alias?.trim();
      return newImagePane(leaf.path ?? "", alias ? { paneId: "", alias } : undefined);
    }
    // 브랜치 그래프 — 주소(프로젝트 id · 고른 브랜치)만 되살린다. 그래프는 타일이 뜨며 다시 읽는다. 주소가 없으면
    // 빈 id 로 두고 [`rebindSftp`] 가 뺀다.
    case "branches":
      return newBranchesPane(leaf.branchGraph?.projectId ?? "", leaf.branchGraph?.branch);
    // diff 타일 — 주소만 되살린다(파일 목록 · diff 는 타일이 뜨며 다시 읽는다). 주소가 없으면 빈 id 로 두고
    // [`rebindSftp`] 가 뺀다.
    case "diff":
      return newDiffPane(leaf.diff ?? { projectId: "", scope: "branch" });
    // 오케스트레이션 보드 — 주소(Run id)만 되살린다. 없으면 Run 목록이다(빼지 않는다).
    case "run":
      return newRunPane(leaf.run?.runId);
    // 프로듀서 채팅 잎 — 주소만 되살린다(채팅은 잎이 뜨며 서버 표에 다시 붙는다 · 없으면 끝난 이유를 묻는다). 칸이 없으면 새 채팅 id.
    case "producer":
      return newProducerPane(leaf.producer ?? { chatId: newProducerChatId(), cli: "claude", model: "", effort: "", studio: "" });
    // 쿼리 타일 — 주소(연결 id · 초안)만 되살린다. 연결은 타일이 뜨며 연다(같은 `tileKey` 면 서버가 다시 붙인다).
    // 주소가 없으면 빈 id 로 두고 [`rebindSftp`] 가 뺀다.
    case "query":
      return newQueryPane(leaf.query ?? { connId: "" });
    // 여기까지 오는 값은 [`parseNode`] 가 이미 걸렀다. 남은 것은 검증을 지나지 않는
    // 다른 입구(직접 부르는 테스트·미래의 파일 형식)에 대한 마지막 방어선이고, 그 자리는
    // **시작 타일**이다 — 앱 전체에서 "아직 아무것도 아닌 칸" 을 뜻하는 값 하나.
    default:
      return newStartPane();
  }
}

function nodeFrom(node: SavedNode, deferSsh: boolean): PaneNode {
  if (isSavedSplit(node)) {
    return {
      type: "split",
      dir: node.dir,
      ratio: clampRatio(node.ratio),
      ...(node.px ? { px: node.px } : {}),
      a: nodeFrom(node.a, deferSsh),
      b: nodeFrom(node.b, deferSsh),
    };
  }
  return leafOf(paneFrom(node, deferSsh));
}

/**
 * 복원된 트리의 **SFTP 잎을 원본 터미널에 다시 묶는다** — 짝이 없으면 그 잎을 뺀다
 * (docs/log/2026-09-03-sftp-browser-tile.md).
 *
 * ## 왜 별칭으로 찾는가 (패널 id 가 아니라)
 *
 * SFTP 타일이 가리키던 `sourcePaneId` 는 **지난 실행의 `pane-N`** 이다. 패널 id 는 창
 * 카운터에서 나오는 화면 인스턴스 신원이라 다음 실행에서는 아무것도 가리키지 않는다 —
 * 그래서 애초에 파일에 담지 않는다 ([`saveLeaf`] 가 런타임 전용 필드를 떨구는 것과 같은
 * 규칙). 파일에 남는 것은 별칭뿐이고, 복원 뒤 **같은 탭 안에서 그 별칭의 SSH
 * 타일**을 찾는 것이 다시 묶는 유일한 길이다.
 *
 * 같은 별칭의 SSH 타일이 여럿이면 **트리에서 먼저 나오는 것**(왼쪽·위 우선 = 화면에서
 * 읽는 순서)에 붙인다. 어느 쪽이든 같은 서버의 같은 홈을 보므로 사용자가 보는 화면은
 * 다르지 않고, 규칙이 정해져 있어야 껐다 켤 때마다 짝이 바뀌지 않는다.
 *
 * ## 짝이 없으면 왜 잎을 빼는가
 *
 * 배치에서 터미널만 지우고 브라우저를 남겼거나, 별칭이 `~/.ssh/config` 에서 사라진
 * 경우다. 그대로 두면 앱을 켤 때마다 **아무것도 할 수 없는 배너 타일**이 자리를 차지하고,
 * 사용자는 그것을 매번 손으로 닫아야 한다. 복원의 목적은 "쓸 수 있는 어제" 를 돌려주는
 * 것이지 죽은 타일을 보존하는 것이 아니다. 그래서 잎을 빼고 형제를 승격시킨다
 * ([`closePane`] — 평범한 타일 닫기와 **같은 경로**라 비율·분할 모양이 그대로 접힌다).
 *
 * 탭이 SFTP 잎 하나뿐이었다면 트리가 비므로 **시작 타일**로 되돌린다 —
 * [`newTab`] 의 시작 배치와 같은 값이라 "빈 탭" 이 어떻게 생겼는지에
 * 대한 답이 앱 전체에서 하나로 유지된다 (docs/log/2026-09-04-start-page.md).
 *
 * ## 원격 문서 타일도 같은 규칙이다 (docs/log/2026-09-27-doc-tile.md)
 *
 * 별칭이 있는 문서 타일은 SFTP 타일처럼 세션을 빌리므로 **같은 짝 찾기·같은 버리기**를 탄다. 별칭이 없는
 * 문서(로컬 파일)는 빌릴 것이 없어 그대로 두되, **경로가 없는 문서**는 무엇을 보여 줄지 모르는 타일이라
 * 여기서 뺀다(파싱 단계에서 버리면 파일 전체가 날아가므로 이 자리까지 미뤘다). 이름은 옛 그대로 둔다.
 * 이미지 타일도 같은 무리(파일 한 장 타일 — `isFileLeafKind`)라 같은 규칙을 탄다.
 */
function rebindSftp(root: PaneNode): PaneNode {
  const panes = listPanes(root);
  const orphans: string[] = [];

  for (const pane of panes) {
    // 주소 없는 브랜치 그래프 — 무엇을 그릴지 모르는 타일이라 뺀다(빌릴 세션은 없다).
    if (pane.kind === "branches") {
      if (!pane.branchGraph?.projectId) orphans.push(pane.id);
      continue;
    }
    // 주소 없는 diff 타일도 같다.
    if (pane.kind === "diff") {
      if (!pane.diff?.projectId) orphans.push(pane.id);
      continue;
    }
    // 연결 id 없는 쿼리 타일도 같다.
    if (pane.kind === "query") {
      if (!pane.query?.connId) orphans.push(pane.id);
      continue;
    }
    if (isFileLeafKind(pane.kind)) {
      if (!pane.path) {
        orphans.push(pane.id);
        continue;
      }
      if (!pane.alias?.trim()) continue; // 로컬 문서 · 그림 — 빌릴 것이 없다
    } else if (pane.kind !== "sftp") {
      continue;
    }
    const alias = pane.alias?.trim();
    const source = alias
      ? panes.find((p) => p.kind === "ssh" && p.alias?.trim() === alias)
      : undefined;
    if (source) pane.sourcePaneId = source.id;
    else orphans.push(pane.id);
  }

  let next: PaneNode | null = root;
  for (const id of orphans) {
    next = closePane(next, id);
    if (next === null) return leafOf(newStartPane());
  }
  return next;
}

/**
 * 저장된 트리 하나 → **이 창에서 바로 쓸 수 있는 패널 트리** (순수, 새 id).
 *
 * 복원의 규칙이 전부 여기 모여 있다: 잎마다 새 패널 명세를 만들고([`paneFrom`]),
 * SSH 는 **연결 대기**로 두고(파일 첫머리의 "왜 자동으로 붙지 않는가"), SFTP 잎은
 * 같은 트리 안의 터미널에 다시 묶는다([`rebindSftp`]).
 *
 */
export function restoreNode(node: SavedNode, opts: DeserializeOptions = {}): PaneNode {
  // 워크스페이스 v2 파일은 Rust 가 읽어 검증 없이 넘긴다 — 걷은 종류의 잎은 여기서 뺀다([`pruneRetiredLeaves`])
  const pruned = pruneRetiredLeaves(node) ?? { kind: "start" };
  return rebindSftp(nodeFrom(pruned, opts.deferSsh ?? true));
}

/**
 * 저장된 트리 하나 → **탭 하나** (순수, 새 id).
 *
 * `rebindSftp` 가 여기서 **탭마다 따로** 도는 것이 요점이다 — SFTP 타일은 자기
 * 탭 안의 터미널에만 붙는다. 옆 탭의 같은 별칭에 붙이면 보이지도 않는
 * 타일의 세션을 빌리게 되고, 그 탭을 닫는 순간 이유 없이 배너로 바뀐다.
 */
export function restoreTab(
  node: SavedNode,
  title?: string,
  name?: string,
  opts: DeserializeOptions = {},
  pinnedTitle?: string,
  projectFolder?: string,
): TabSpec {
  return restoredTab(restoreNode(node, opts), title, name, pinnedTitle, projectFolder);
}

/**
 * 검증된 파일 → 이 창에서 바로 쓸 수 있는 탭 목록 — **순수 함수**.
 *
 * 모든 id 는 새로 매긴다 (`restoredTab`·패널 생성자). 활성 탭은 `activeIndex` 가
 * 가리키는 것이고, 목록이 비어 있으면 `activeId` 는 `null` 이다 (호출부가 그때
 * `newTab()` 로 떨어진다).
 */
export function deserialize(
  file: TabFile,
  opts: DeserializeOptions = {},
): { tabs: TabSpec[]; activeId: string | null } {
  const tabs = file.workspaces.map((w) => {
    const tab = restoreTab(w.root, w.title, w.name, opts, w.pinnedTitle, w.projectFolder);
    if (w.tabKey) tab.tabKey = w.tabKey;
    if (w.projectId) tab.projectId = w.projectId;
    if (w.orch) tab.orch = { ...w.orch };
    return tab;
  });
  return { tabs, activeId: tabs[file.activeIndex]?.id ?? tabs[0]?.id ?? null };
}
