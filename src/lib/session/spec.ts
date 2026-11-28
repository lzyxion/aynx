import type { Key } from "$lib/i18n/keys";
import type { QuickConnectTarget as AdhocTarget } from "$lib/quick-connect";
import type { MarkerDistance } from "$lib/shell-integration";

export type Tr = (key: Key, params?: Record<string, string | number>) => string;

export type { QuickConnectTarget as AdhocTarget } from "$lib/quick-connect";

export type SessionKind = "local" | "ssh";

/**
 * 값은 배치 파일에 글자 그대로 남는다 — 바꾸지 않는다. 걷은 `"plans"` 잎은 복원이 뺀다(`tabs.ts` 의 `RETIRED_KINDS`).
 * `"sftp"` · 원격 `"doc"`/`"image"` 는 자기 연결을 열지 않고 원본 터미널의 세션을 빌린다 — 열면 비밀번호 · TOFU 를 또 묻는다.
 */
export type PaneKind = SessionKind | "sftp" | "localfs" | "start" | "doc" | "image" | "branches" | "diff" | "query" | "run" | "producer" | "chat";

export function isFileLeafKind(kind: PaneKind): kind is "doc" | "image" {
  return kind === "doc" || kind === "image";
}

export const QUERY_DRAFT_MAX = 32 * 1024;

/** 서버 상한 `db::ROWS_MAX`(10000)를 넘지 않는다 */
export const QUERY_ROW_LIMITS = [1000, 5000, 10000] as const;
export type QueryRowLimit = (typeof QUERY_ROW_LIMITS)[number];
export const QUERY_ROWS_DEFAULT: QueryRowLimit = 1000;

export function storedRowLimit(v: unknown): QueryRowLimit | undefined {
  return typeof v === "number" && v !== QUERY_ROWS_DEFAULT && (QUERY_ROW_LIMITS as readonly number[]).includes(v)
    ? (v as QueryRowLimit)
    : undefined;
}

/** `connId` 는 `db-connections.json` 의 연결 id 이고 볼트 열쇠와 같은 값이다 */
export interface QuerySpec {
  connId: string;
  sql?: string;
  maxRows?: QueryRowLimit;
  scripts?: QueryScript[];
  active?: number;
  name?: string;
}

export const QUERY_SCRIPTS_MAX = 20;
export const QUERY_SCRIPT_TITLE_MAX = 60;

export interface QueryScript {
  n: number;
  title?: string;
  sql?: string;
  /** 있으면 데이터 탭 — 이 칸을 모르는 예전 빌드는 빈 쿼리 탭으로 읽는다 */
  data?: QueryDataTab;
  /** 있으면 객체 목록 탭(`data` 와 배타 · 둘 다 오면 `data`) — 예전 빌드는 빈 쿼리 탭으로 읽는다 */
  list?: QueryListTab;
}

/** `query-backend` 의 `DbObjectKind` 와 같은 글자 — 배치 파일에 남는다 */
export const QUERY_LIST_KINDS = ["table", "view", "matview", "foreign", "function", "procedure", "sequence", "type"] as const;
export type QueryListKind = (typeof QUERY_LIST_KINDS)[number];

/** 찾기 글 · 정렬은 저장하지 않는다 */
export interface QueryListTab {
  schema: string;
  kind?: QueryListKind;
}

export const QUERY_DATA_KINDS = ["table", "view", "matview", "foreign", "partition"] as const;
export type QueryDataKind = (typeof QUERY_DATA_KINDS)[number];
export const QUERY_DATA_PAGE_SIZES = [100, 500, 1000] as const;
export type QueryDataPageSize = (typeof QUERY_DATA_PAGE_SIZES)[number];
export const QUERY_DATA_WHERE_MAX = 4096;
export const QUERY_DATA_NAME_MAX = 512;

export interface QueryDataTab {
  kind: QueryDataKind;
  schema?: string;
  name: string;
  where?: string;
  sort?: { col: string; dir: "asc" | "desc" };
  pageSize?: Exclude<QueryDataPageSize, 100>;
}

const nameOk = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= QUERY_DATA_NAME_MAX;

export function canonDataTab(v: unknown): QueryDataTab | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.kind !== "string" || !(QUERY_DATA_KINDS as readonly string[]).includes(o.kind) || !nameOk(o.name)) return null;
  if (o.schema !== undefined && o.schema !== null && !nameOk(o.schema)) return null;
  const d: QueryDataTab = { kind: o.kind as QueryDataKind, ...(typeof o.schema === "string" ? { schema: o.schema } : {}), name: o.name };
  const where = typeof o.where === "string" ? o.where.trim() : "";
  if (where !== "" && where.length <= QUERY_DATA_WHERE_MAX) d.where = where;
  const s = o.sort as Record<string, unknown> | null | undefined;
  if (s && typeof s === "object" && nameOk(s.col) && (s.dir === "asc" || s.dir === "desc")) d.sort = { col: s.col, dir: s.dir };
  if (o.pageSize === 500 || o.pageSize === 1000) d.pageSize = o.pageSize;
  return d;
}

/** 모르는 `kind`(다음 판의 종류)는 버리고 탭은 남긴다 — 첫 종류를 보인다 */
export function canonListTab(v: unknown): QueryListTab | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!nameOk(o.schema)) return null;
  const l: QueryListTab = { schema: o.schema };
  if (typeof o.kind === "string" && (QUERY_LIST_KINDS as readonly string[]).includes(o.kind)) l.kind = o.kind as QueryListKind;
  return l;
}

export function storedDraft(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" && v.length <= QUERY_DRAFT_MAX ? v : undefined;
}

/** 명세 · 배치 파일 쓰기 · 읽기가 모두 거친다 — 키 순서가 흔들리면 자동 저장의 문자열 비교가 매번 달라진다 */
export function canonQueryTabs(raw: { sql?: unknown; scripts?: unknown; active?: unknown }): {
  sql?: string;
  scripts?: QueryScript[];
  active?: number;
} {
  const list: QueryScript[] = [];
  if (Array.isArray(raw.scripts)) {
    const seen = new Set<number>();
    for (const x of raw.scripts) {
      if (list.length >= QUERY_SCRIPTS_MAX) break;
      if (!x || typeof x !== "object") continue;
      const o = x as Record<string, unknown>;
      const n = o.n;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 9999 || seen.has(n)) continue;
      if (o.data !== undefined) {
        const data = canonDataTab(o.data);
        if (!data) continue;
        seen.add(n);
        list.push({ n, data });
        continue;
      }
      if (o.list !== undefined) {
        const lt = canonListTab(o.list);
        if (!lt) continue;
        seen.add(n);
        list.push({ n, list: lt });
        continue;
      }
      seen.add(n);
      const s: QueryScript = { n };
      const title = typeof o.title === "string" ? o.title.trim().slice(0, QUERY_SCRIPT_TITLE_MAX) : "";
      if (title !== "") s.title = title;
      const sql = storedDraft(o.sql);
      if (sql !== undefined) s.sql = sql;
      list.push(s);
    }
  }
  if (list.length === 0) {
    const sql = storedDraft(raw.sql);
    return sql === undefined ? {} : { sql };
  }
  if (list.length === 1 && list[0].n === 1 && list[0].title === undefined && list[0].data === undefined && list[0].list === undefined) {
    return list[0].sql === undefined ? {} : { sql: list[0].sql };
  }
  const active = typeof raw.active === "number" && list.some((s) => s.n === raw.active) ? raw.active : list[0].n;
  return { scripts: list, active };
}

export type DiffScopeKind = "branch" | "commit" | "wip" | "range";

/** 값은 배치 파일에 글자 그대로 남는다 — 바꾸지 않는다 */
export type DiffViewMode = "unified" | "split";

export interface DiffSpec {
  projectId: string;
  scope: DiffScopeKind;
  branch?: string;
  worktreePath?: string;
  commit?: string;
  base?: string;
  tip?: string;
  file?: string;
  view?: DiffViewMode;
  name?: string;
}

/** 값은 배치 파일(`SavedLeaf.docMode`)에 글자 그대로 남는다 — 바꾸지 않는다 */
export type DocMode = "rendered" | "source";

export function isDocMode(v: unknown): v is DocMode {
  return v === "rendered" || v === "source";
}

/** 값은 배치 파일(`SavedLeaf.docEditView`)에 글자 그대로 남는다 — 바꾸지 않는다 */
export type DocEditView = "source" | "split" | "preview";

export function isDocEditView(v: unknown): v is DocEditView {
  return v === "source" || v === "split" || v === "preview";
}

/** 값은 `settings.toml` `[files] default_view` 와 배치 파일에 글자 그대로 남는다 — 바꾸지 않는다(옛 값은 [`migrateFileView`]) */
export type FileView = "icons" | "compact" | "details";

export function isFileView(v: unknown): v is FileView {
  return v === "icons" || v === "compact" || v === "details";
}

export function migrateFileView(v: unknown): FileView | null {
  if (isFileView(v)) return v;
  if (v === "tree" || v === "navigate") return "details";
  return null;
}

export interface FileUiPatch {
  zoom?: number;
  places?: boolean;
  preview?: boolean;
  hidden?: boolean;
}

/** Rust `remote/mirror.rs` 의 아이콘 크기 단계 끝과 같은 값 */
export const FILE_ZOOM_MAX = 4;
export const DEFAULT_FILE_ZOOM = 1;

export function clampFileZoom(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v >= 0 && v <= FILE_ZOOM_MAX ? v : null;
}

/**
 * "세션을 쓰는가" 가 아니라 "자기 세션을 여는가" 를 묻는다 — `"sftp"` 를 참으로 두면 창이 닫힐 때 원본 터미널의 세션을
 * 대신 닫는다.
 */
export function hasSession(kind: PaneKind): kind is SessionKind {
  return kind === "local" || kind === "ssh";
}

export interface TermSize {
  cols: number;
  rows: number;
}

/** `id` 는 화면 인스턴스의 키다(백엔드 세션 id 아님) — 트리를 다시 지을 때 바꾸면 터미널이 언마운트돼 세션이 끊긴다 */
export interface PaneSpec {
  /** 영속 키 — 런타임 `id`(pane-N)와 따로다 */
  tileKey?: string;
  /** 소비된 실행 옵션과 별개인 재시작 명세(ON 창 이관만). */
  restart?: Pick<PaneSpec, "autorun" | "cwd" | "injectMcpToken">;
  id: string;
  kind: PaneKind;
  /** `"sftp"` 에서는 원본 터미널 별칭의 사본 — 배치 복원이 원본을 다시 찾는 열쇠다(`sourcePaneId` 는 파일에 담을 수 없다) */
  alias?: string;
  /** 있으면 `alias` 는 화면 이름(`user@host:port`)일 뿐이라, 이 칸을 잃으면 그 타일은 접속에 곧바로 실패한다 */
  adhoc?: AdhocTarget;
  /**
   * 세션을 빌려 쓰는 원본 터미널의 `pane.id` — 세션 id 사본이 아니라 패널 참조라 재연결된 새 세션으로 이어진다
   * (사본이면 죽은 id 를 붙든다 · docs/log/2026-09-03-sftp-browser-tile.md).
   */
  sourcePaneId?: string;
  /** `localfs` · `sftp` 는 보고 있는 폴더(빈 문자열 = 합성 루트 "내 PC"), `doc` · `image` 는 보고 있는 파일의 절대 경로 */
  path?: string;
  fileView?: FileView;
  fileZoom?: number;
  filePlaces?: false;
  filePreview?: true;
  fileHidden?: true;
  docMode?: DocMode;
  docOutline?: true;
  docFiles?: true;
  docEditView?: Exclude<DocEditView, "split">;
  docSplit?: number;
  docZoom?: number;
  /** 미리 보기 문서 — 다음에 여는 파일이 이 자리를 갈아 끼운다(`planDocOpen`). 복제가 물려받으면 복사본이 몰래 갈아 끼워진다 */
  docPreview?: true;
  shell?: string;
  /** 붙어 있는 tmux 세션 이름(백엔드가 정한다) — 복제가 물려받으면 두 타일이 같은 세션을 물어 화면을 빼앗는다(`-A -D`) */
  tmux?: string;
  scrollback?: number;
  autorun?: string;
  /** 시작 폴더 — 로컬은 이 PC 의 경로, SSH 는 원격 프로젝트의 서버 경로 */
  cwd?: string;
  /** 재연결마다 백엔드로 실려 가야 한다 — 1회용으로 두면 재연결에서 tmux 로 바뀐다(`forceTmux` 도 같다) */
  noTmux?: boolean;
  forceTmux?: boolean;
  /** 1회용 — 남으면 마운트 · 복제마다 같은 워크트리를 또 만들려다 실패한다 */
  worktree?: { repo: string; name: string; projectId?: string };
  /** 프로젝트 설정 스크립트를 먼저 돌리라는 표식(글자는 Rust 가 `projects.json` 에서 읽는다) — 1회용, 남으면 스크립트가 또 돈다 */
  setup?: { projectId: string; repo: string; agent: string | null; agentName: string | null };
  /**
   * AI 타일 표식 — 세션이 열릴 때 MCP 토큰(`AYNX_MCP_TOKEN` · 개발 빌드 `AYNX_DEV_MCP_TOKEN`)을 셸 환경에만 심는다. Codex 는 그 변수
   * 이름으로 인증하고 Claude 는 앱 데이터의 실행 설정 파일을 쓴다 — 사용자 CLI 설정 파일에는 토큰이 없다(Rust `agent_mcp.rs` · → docs/invariants.md 전문 1).
   */
  injectMcpToken?: boolean;
  /** `app/agent-sessions` 의 연결 표와 함께 적고 함께 지우는 사본 — 따로 고치면 다시 붙은 타일이 엉뚱한 대화를 잡는다 */
  agentLink?: { agent: string; id: string };
  /** 셸이 마지막으로 알린 폴더 — 붙을 세션이 없을 때 새 셸을 여기서 연다(`last-cwd.ts`) */
  lastCwd?: string;
  /** 다른 창에서 넘어온 패널의 복원 지시서 — 1회용, 남으면 다시 마운트될 때 낡은 버퍼를 또 재생하고 죽은 세션 id 를 잡는다 */
  restore?: {
    sessionId: number | null;
    buffer: string;
    /** 버퍼를 다 쓴 뒤에 심어야 거리가 맞는다 */
    markers?: MarkerDistance[];
    /** 직렬화 문자열은 이 열 수에서만 줄바꿈을 재현한다 — 이 크기로 먼저 되돌린 뒤 버퍼를 쓰고 마커를 심는다 */
    size?: TermSize;
    /** 버퍼를 뜬 순간의 출력 오프셋(`TearPane.consumed`) — 이관 틈의 출력을 재생한다 */
    consumed?: number;
  };
  /** 첫 접속 지연(ms) — 그룹 열기가 sshd `MaxStartups` 에 거절되지 않게 하는 계단. 남으면 이관 · 복제마다 검은 화면이 된다 */
  openDelay?: number;
  /** 배치 복원으로 뜬 SSH 타일 — 사람이 [연결] · `reconnect-all` 을 부르기 전에는 접속하지 않는다 */
  deferred?: boolean;
  /** Rust 거울로 나가는 셸 계보 키 — AI 의 `(session, blockId)` 참조가 이관 · 리로드 뒤에도 같은 스트림을 가리키게 한다 */
  historyStreamId?: string;
  /** `host` 가 있으면 `folder` 는 서버 경로다 — 이 PC 의 폴더로 쓰면 안 된다 */
  startProject?: { projectId: string; folder: string; host?: string };
  /** 칸을 고칠 때는 객체를 통째로 새로 단다 — 분할 복제가 같은 객체를 나눠 든다(`diff` · `query` · `run` · `producer` · `chat` 도 같다) */
  branchGraph?: { projectId: string; branch?: string; name?: string };
  diff?: DiffSpec;
  query?: QuerySpec;
  run?: { runId: string; name?: string };
  producer?: ProducerSpec;
  chat?: ChatTileSpec;
}

/** 토큰을 싣지 않는다 — 배치 파일 · 창 이관 · 원격 거울로 나간다 */
export interface ChatTileSpec {
  /** "ct-" + crypto.randomUUID()(소문자) — 서버 표의 열쇠 */
  chatId: string;
  cli: "claude" | "codex";
  /** "" = CLI 기본 */
  model: string;
  /** "" = CLI 기본 */
  effort: string;
  /** 타일 폴더(이 PC 의 절대 경로) · "" = 홈(서버에 null) */
  cwd: string;
  /** 첫 턴이 선 뒤에만 — 있으면 다시 세울 때 resume */
  conv?: string;
  /** 사람이 그 타일에서 고른 CLI 권한 모드 — 없으면 사용자 CLI 설정. Claude: default · acceptEdits · plan · auto / Codex: readOnly · auto · plan */
  permMode?: string;
  /** 사람이 고른 Codex 속도 등급 id — 없으면 CLI 기본(스레드 · 사용자 config) */
  tier?: string;
}

/** 토큰을 싣지 않는다 — 이 명세는 배치 파일 · 창 이관 · 원격 거울로 나간다 */
export interface ProducerSpec {
  /** `pc-` + uuid — 서버 레지스트리의 열쇠 */
  chatId: string;
  cli: string;
  model: string;
  effort: string;
  studio: string;
  opened?: boolean;
  conv?: string;
  forkFrom?: { agent: string; conv: string };
}

/** `row` = 좌우(세로 분할선), `col` = 상하(가로 분할선) */
export type SplitDir = "row" | "col";

export interface PaneLeaf {
  type: "leaf";
  pane: PaneSpec;
}

export interface PaneSplit {
  type: "split";
  dir: SplitDir;
  ratio: number;
  /** 자르는 자리에 더하는 고정 px — 오케스트레이션 탭의 프로듀서 칸만 쓴다(`orchestration/orch-tab.ts` 의 `orchRoot`) */
  px?: number;
  a: PaneNode;
  b: PaneNode;
}

/** 비지 않는다 — 소비자가 전부 non-null 을 전제하므로 빈 탭은 `null` 이 아니라 `"start"` 잎 하나다 */
export type PaneNode = PaneLeaf | PaneSplit;

/** 옛 이름 "워크스페이스" 는 호환 때문에 남는다 — `workspaces.json` · 단축키 id `workspace-1`~`9` · i18n 키는 바꾸지 않는다 */
export interface TabSpec {
  /** 메인 창 개발 플래그에서만 소속을 부여한다. */
  workspaceId?: string;
  tabKey?: string;
  projectId?: string;
  id: string;
  title: string;
  name?: string;
  pinnedTitle?: string;
  /** 로컬 프로젝트 · 워크트리일 때만 적는다 — 원격 경로는 이 PC 에 없는 자리다 */
  projectFolder?: string;
  root: PaneNode;
  /** 저장 · 이관하지 않는다 — 최대화된 채 복원되면 나머지 타일을 되찾을 길을 모른다 */
  zoomedPaneId?: string | null;
  /** 오케스트레이션 탭의 표지 — 앱이 쥔 고정 배치라 다른 타일을 받지 않는다(`orchestration/orch-tab.ts`) */
  orch?: OrchMark;
}

/** 칸을 고칠 때는 객체를 통째로 새로 단다(같은 객체를 나눠 들지 않게) */
export interface OrchMark {
  /** 옛 표지와 모르는 값은 라이브러리로 버린다 */
  view?: "library" | "studio" | "new" | "album" | "track" | "artists";
  /** 서버 문자열 그대로(열쇠) */
  repo?: string;
  runId?: string;
  taskId?: string;
  attemptId?: string;
  fromRepo?: string;
}
