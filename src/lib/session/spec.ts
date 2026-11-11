// 패널·탭의 **모양** — `PaneKind`·`PaneSpec`·`PaneNode`·`TabSpec` 와 문구 함수 타입 `Tr`.
// 값은 종류 판정(`hasSession`·`isDocMode`·`isDocEditView`·`isFileView`·`migrateFileView`)뿐이고 형제 파일을 값으로 부르지 않는다(잎 모듈).

import type { Key } from "$lib/i18n/keys";
// 빠른 접속 대상의 **모양**만 빌린다 (문법·파싱은 그쪽이 단일 진실이다).
// `quick-connect.ts` 는 import 가 하나도 없는 잎 모듈이라 순환이 생길 자리가 없다.
import type { QuickConnectTarget as AdhocTarget } from "$lib/quick-connect";
// **타입만** 가져온다 — 이 파일은 순수 모듈이고 셸 통합을 값으로 부르지 않는다
// (`npm run check:cycles` 는 `import type` 을 그래프에 넣지 않는다).
import type { MarkerDistance } from "$lib/shell-integration";

/** 문구 하나를 내는 함수 — 화면 쪽은 `t` 를 그대로 넘긴다 (`i18n/ko/pane.ts` 머리말) */
export type Tr = (key: Key, params?: Record<string, string | number>) => string;

/** 빠른 접속 대상 ([`PaneSpec.adhoc`]) — `$lib/quick-connect` 의 같은 타입을 다시 내보낸다 */
export type { QuickConnectTarget as AdhocTarget } from "$lib/quick-connect";

/** **백엔드 세션을 여는** 패널의 종류 (local·ssh 만 `openSession` 을 탄다) */
export type SessionKind = "local" | "ssh";

/**
 * 패널의 종류 — 세션을 여는 두 가지에 **세션 없는 패널 종류들**을 더한 것.
 *
 * **호스트 목록에는 타일 종류가 없다** (docs/log/2026-09-08-remove-hosts-tile.md).
 * 9/3 에 `kind:"hosts"` 타일이었고 9/8 에 떠 있는 층(독)으로 옮겼다가, 같은 날 타일 쪽을
 * 지웠다 — 런처는 작업면을 한 칸 차지할 물건이 아니다. 호스트 트리(`Sidebar`)를 담는
 * 그릇은 이제 `Dock.svelte` 하나뿐이다.
 *
 * ## `"sftp"` — 세션이 없지만 **남의 세션을 빌리는** 셋째 종류
 *
 * SFTP 파일 브라우저(docs/log/2026-09-03-sftp-browser-tile.md)도 타일 하나다. SFTP 타일은
 * 세션이 **반드시 필요한데 자기 것을 열지 않는다**. 자기가 열면 터미널이 이미 붙여 놓은
 * SSH 연결 옆에 두 번째 연결이 생기고, 사용자에게는 비밀번호·TOFU 를 한 번 더 묻게 된다.
 *
 * 그래서 SFTP 타일은 **자기를 연 터미널 타일에 매여 있다** ([`PaneSpec.sourcePaneId`]):
 * 그 터미널의 세션 id 를 빌려 쓰고, 백엔드는 세션 id 하나당 SFTP 채널을 캐시하므로
 * (docs/log/2026-09-03-sftp-browser-backend.md 1절) 편집·업로드와도 같은 채널을 탄다.
 * [`hasSession`] 은 `"sftp"` 에 **거짓**이다 — 그 술어가 답하는 질문은 "세션을 쓰는가" 가
 * 아니라 "`openSession` 을 타는가(= 정리할 세션을 자기가 들고 있는가)" 이고, 빌려 쓰는
 * 쪽이 참이 되면 창이 닫힐 때 **남의 세션을 대신 닫아 버린다**.
 *
 * ## `"localfs"` — 같은 브라우저로 **로컬 디스크**를 본다
 *
 * 사람은 원격에서만 일하지 않는다 (docs/log/2026-09-03-local-fs-tile.md). 로컬 파일
 * 브라우저는 `kind:"localfs"` 타일이고, 화면은 SFTP 브라우저와 **같은 컴포넌트**다 —
 * 다른 것은 그 컴포넌트에 내려가는 백엔드 어댑터(`$lib/fs-backend`)뿐이다.
 *
 * 세션도 원본 타일도 없다 (`sourcePaneId` 없음, `hasSession` 거짓). 대신 [`PaneSpec.path`]
 * 에 **지금 보고 있는 폴더**를 들고 있어서 배치 저장·복원이 그 자리를 되살린다.
 *
 * ## `"doc"` — 파일 **한 장**을 읽는 타일 (docs/log/2026-09-27-doc-tile.md)
 *
 * 마크다운·스크립트·설정 파일을 앱 안에서 읽는다(1단계 읽기 전용). [`PaneSpec.path`] 가 그 파일의
 * 절대 경로이고, **`alias` 가 있으면 원격**이다 — 그때는 SFTP 타일과 똑같이 원본 터미널의 세션을
 * 빌린다([`PaneSpec.sourcePaneId`] · 자기 연결 없음). `alias` 가 없으면 로컬 디스크다.
 * 이름이 `"viewer"` 가 아닌 것은 편집(2단계)이 붙어도 거짓말이 되지 않게 — kind 는 배치 파일에
 * 글자 그대로 남는다.
 *
 * ## `"start"` — 아직 아무것도 열지 않은 자리 (docs/log/2026-09-04-start-page.md)
 *
 * 새 탭은 **시작 타일 하나**로 뜬다 ([`newTab`]): 로고 아래에 바로가기와
 * 최근 접속한 호스트가 서 있는 화면이다.
 *
 * **왜 "빈 root" 가 아니라 타일 한 종류인가.** "아무것도 없는 탭" 을 표현하는
 * 자연스러운 방법은 `TabSpec.root` 를 nullable 로 만드는 것처럼 보이지만, 이 코드베이스의
 * [`PaneNode`] 소비자는 **전부 non-null 을 전제**한다 — `computeLayout`·`listPanes`·
 * `findFirstPane`(트리는 비지 않는다고 doc-comment 에 적혀 있다)·`paneOf`·`serialize`·
 * `adoptTab`·드래그 판정까지. `null` 을 허용하는 순간 그 스무 곳에 분기가 하나씩 생기고,
 * 빠뜨린 한 곳이 곧 빈 화면이나 크래시가 된다. 타일 한 종류면 **기존 기계장치가 전부 그대로**
 * 돈다: 포커스·`Ctrl+D`·`close-tile`·배치 저장·복원·창 이관이 손댈 것 없이 동작한다.
 *
 * 대신 규칙이 하나 붙는다 — 시작 타일이 탭의 **유일한 잎**일 때 무언가를 열면
 * 분할하지 않고 **그 자리를 대신한다** (`+page` 의 `placePane`). 그래서 사용자는 시작 화면이
 * 결과 타일로 바뀌는 것만 보고, "쓸모없는 첫 타일" 이 옆에 남지 않는다.
 *
 * ## `"branches"` — 프로젝트 하나의 브랜치 그래프 (docs/log/2026-09-29-branch-graph.md)
 *
 * 읽기 전용 검토 타일이다(소스 컨트롤 2단계). 세션을 열지도 빌리지도 않는다 — 원격 프로젝트면 그 호스트에 **이미 붙은
 * 세션**을 그때그때 찾아 exec 한 번으로 읽는다(독 워크트리 목록 · 1단계 배지와 같은 규칙). 그래서 `sourcePaneId` 가 없고
 * 새 창으로 떼어도 된다. 주소는 [`PaneSpec.branchGraph`] 하나다.
 *
 * ## `"diff"` — 브랜치 · 커밋 · 커밋 안 한 변경의 읽기 전용 diff (docs/log/2026-10-05-diff-tile.md)
 *
 * 브랜치 타일과 같은 무리다 — 세션을 빌리지 않고(원격이면 그 호스트에 붙은 세션을 그때그때 찾는다) 주소는
 * [`PaneSpec.diff`] 하나다. 줄 코멘트는 타일 메모리에만 살고 명세에 싣지 않는다.
 *
 * ## (걷음) `"plans"` — 작업안 타일 (2026-10-07 ~ 10-25)
 *
 * 작업안은 2026-10-25 에 채팅 독의 갈래로 옮겼다(`app/plans.svelte.ts` · docs/log/2026-10-25-plans-tile-refresh.md). 저장된 배치에
 * 그 잎이 남아 있으면 복원이 조용히 빼고 형제가 자리를 차지한다(`tabs.ts` 의 `RETIRED_KINDS`).
 *
 * ## `"query"` — 쿼리 타일 (2026-10-12, docs/log/2026-10-12-query-tile.md)
 *
 * DB 연결 하나에 SQL 을 보내 결과를 표로 보는 타일이다. 세션 코어에 오르지 않는다 — 연결은 세션 서버의 DB 평면
 * (`db::table` — 열쇠 = 이 타일의 `tileKey`)에 따로 산다. 주소는 [`PaneSpec.query`](연결 id · 초안) 하나다.
 *
 * ## `"run"` — 오케스트레이션 보드 (2026-10-15 · 2b, docs/log/2026-10-14-orchestration-design.md E-1)
 *
 * Run 하나(상태 · Task · 남은 한도 · 타임라인)를 사람이 감독하는 크롬 타일이다 — 옛 작업안 타일과 같은 모양. 세션을 열지도
 * 빌리지도 않는다. 주소는 [`PaneSpec.run`](Run id) 하나이고, 없으면 Run 목록(orphaned 포함)을 그린다. 상태는 세션 서버의
 * Run 표에 있다(`orchestration_run` · 이벤트 `orchestration-changed`).
 *
 * ## `"producer"` — 프로듀서 채팅 잎 (2026-10-30 — 오케스트레이션 2단계 단계 3 · aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 5-1)
 *
 * 오케스트레이션 탭의 **고정 왼쪽 잎**이다(끌 수 없다 — 머리줄 손잡이 없음 · 탭 밖으로 못 나간다). 세션을 열지도 빌리지도 않는다 — 속은 세션
 * 서버의 프로듀서 채팅 프로세스(`server/producer`)이고 상태는 `app/producer-chat.svelte.ts` 가 쥔다. 주소는 [`PaneSpec.producer`](채팅 id ·
 * CLI · 모델 · 강도 · 스튜디오) 하나 — 토큰은 없다. 아직 안 열었으면 "새 앨범" 칸(초안), 연 뒤는 채팅.
 */
export type PaneKind = SessionKind | "sftp" | "localfs" | "start" | "doc" | "branches" | "diff" | "query" | "run" | "producer";

/** 쿼리 타일 초안(`QuerySpec.sql`)의 상한 — 넘으면 명세에 싣지 않는다(배치 파일이 부풀지 않게) */
export const QUERY_DRAFT_MAX = 32 * 1024;

/** 쿼리 타일 행 상한의 고를 수 있는 값(위 띠 고르개) — 서버 상한(`db::ROWS_MAX` = 10000) 안 */
export const QUERY_ROW_LIMITS = [1000, 5000, 10000] as const;
export type QueryRowLimit = (typeof QUERY_ROW_LIMITS)[number];
/** 기본 행 상한 — 이 값이면 명세 · 배치 파일에 적지 않는다 */
export const QUERY_ROWS_DEFAULT: QueryRowLimit = 1000;

/** 고를 수 있는 행 상한이면 그 값 · 기본값이거나 아니면 `undefined`(적지 않는다) */
export function storedRowLimit(v: unknown): QueryRowLimit | undefined {
  return typeof v === "number" && v !== QUERY_ROWS_DEFAULT && (QUERY_ROW_LIMITS as readonly number[]).includes(v)
    ? (v as QueryRowLimit)
    : undefined;
}

/**
 * **쿼리 타일의 주소** ([`PaneSpec.query`]) — 배치 파일 · 창 이관에 실린다(`name` 은 화면용 사본이라 저장하지 않는다).
 *
 * - `connId` — `db-connections.json` 의 연결 id(볼트 열쇠와 같은 값 — 이름 · 경유를 바꿔도 따라간다). 경유 호스트는 연결이 쥔다
 *   (10-13 저장 하나로 — 예전 저장본의 `host` 칸은 읽을 때 버린다). 비면 무엇을 열지 모르는 타일이라 복원에서 빠진다.
 * - `sql` — 편집기 초안(디바운스로 적는다). [`QUERY_DRAFT_MAX`] 를 넘으면 싣지 않는다.
 * - `maxRows` — 결과 칸 아래 줄에서 고른 행 상한([`QUERY_ROW_LIMITS`]). 기본값([`QUERY_ROWS_DEFAULT`])이면 칸이 없다.
 * - `scripts` · `active` — 스크립트 탭(10-14 — 쿼리 타일 안의 [쿼리 1] [쿼리 2] …)과 고른 탭의 번호. **탭이 하나뿐이고 이름을 바꾸지
 *   않았으면 두지 않고 예전처럼 `sql` 하나로 적는다**(예전 저장본 · 예전 빌드와 같은 모양 — 옛 초안은 읽을 때 저절로 첫 탭이 된다).
 *   모양을 고르는 것은 [`canonQueryTabs`] 하나다.
 */
export interface QuerySpec {
  connId: string;
  sql?: string;
  maxRows?: QueryRowLimit;
  /** 스크립트 탭(둘 이상이거나 이름을 바꾼 탭이 있을 때만) — 차례가 곧 탭 줄의 차례 */
  scripts?: QueryScript[];
  /** 고른 탭의 `n`(`scripts` 가 있을 때만) */
  active?: number;
  /** 화면용 사본(머리줄 "app.db · web-01") — 저장하지 않는다 */
  name?: string;
}

/** 쿼리 타일 스크립트 탭의 상한 — 넘는 탭은 저장하지 않는다(배치 파일이 부풀지 않게 · 초안 하나는 [`QUERY_DRAFT_MAX`]) */
export const QUERY_SCRIPTS_MAX = 20;
/** 탭 이름의 상한(글자) */
export const QUERY_SCRIPT_TITLE_MAX = 60;

/**
 * 스크립트 탭 하나(저장 모양) — `n` 은 타일 안에서 겹치지 않는 번호(기본 이름 "쿼리 {n}" · 고른 탭의 열쇠), `title` 은 사람이 바꾼 이름,
 * `sql` 은 초안([`QUERY_DRAFT_MAX`] 이하 · 비지 않았을 때만).
 */
export interface QueryScript {
  n: number;
  title?: string;
  sql?: string;
  /**
   * 있으면 이 탭은 **데이터 탭**(2026-11-10 — 트리의 테이블 · 뷰를 두 번 눌러 연 탭, `query/data-tab`)이다 — 글(`sql`) · 이름(`title`)은
   * 두지 않는다. 행 값은 저장하지 않는다(열면 다시 조회). 이 칸을 모르는 예전 빌드는 빈 쿼리 탭으로 읽는다.
   */
  data?: QueryDataTab;
}

/** 데이터 탭이 여는 객체의 종류 — 트리의 관계(테이블 · 뷰 · 구체화 뷰 · 외부 테이블)와 PG 파티션 */
export const QUERY_DATA_KINDS = ["table", "view", "matview", "foreign", "partition"] as const;
export type QueryDataKind = (typeof QUERY_DATA_KINDS)[number];
/** 데이터 탭 쪽 크기 — 첫 값이 기본(저장하지 않는다) */
export const QUERY_DATA_PAGE_SIZES = [100, 500, 1000] as const;
export type QueryDataPageSize = (typeof QUERY_DATA_PAGE_SIZES)[number];
/** 데이터 탭 WHERE 글의 상한(글자) — 넘으면 저장하지 않는다 */
export const QUERY_DATA_WHERE_MAX = 4096;
/** 객체 · 스키마 · 정렬 열 이름의 상한(글자) — 넘는 이름은 그 탭을 버린다(엔진 식별자는 이보다 훨씬 짧다) */
export const QUERY_DATA_NAME_MAX = 512;

/**
 * 데이터 탭 하나의 저장 모양 — 객체(`schema` 없음 = 스키마 없는 이름) · 종류 · 사람이 친 WHERE 조건 글 · 정렬(열 하나) · 쪽 크기(기본이면 없음).
 * 키 순서는 늘 이 차례([`canonDataTab`]).
 */
export interface QueryDataTab {
  kind: QueryDataKind;
  schema?: string;
  name: string;
  where?: string;
  sort?: { col: string; dir: "asc" | "desc" };
  pageSize?: Exclude<QueryDataPageSize, 100>;
}

const nameOk = (v: unknown): v is string => typeof v === "string" && v !== "" && v.length <= QUERY_DATA_NAME_MAX;

/** 데이터 탭 칸의 정규화 — 못 쓸 모양(종류 · 이름이 없음 · 상한 초과)이면 `null`(그 탭을 버린다). 못 쓸 곁칸(WHERE · 정렬 · 쪽)만 떨어진다 */
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

/** 저장할 수 있는 초안이면 그 글, 아니면(비었거나 상한 초과 · 글자가 아님) `undefined` */
export function storedDraft(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" && v.length <= QUERY_DRAFT_MAX ? v : undefined;
}

/**
 * **탭 저장 모양의 유일한 판정** — 명세 · 배치 파일 쓰기 · 읽기가 모두 거친다(키 순서도 늘 같다: `sql` → `scripts` → `active`).
 *
 * - `scripts` 가 쓸 만한 배열이면(1~[`QUERY_SCRIPTS_MAX`]개 — 넘는 뒤 탭은 버림 · `n` 은 양의 정수이고 겹치지 않음 · 못 쓸 칸은 그
 *   탭만 버림) 그것을 쓴다. 단 **탭 하나 · `n` 1 · 이름 없음 · 데이터 탭 아님**이면 예전 모양(`sql` 하나)으로 접는다. 데이터 탭
 *   (`data` 칸 — [`canonDataTab`])도 같은 번호 줄에 선다(번호는 쿼리 탭과 함께 겹치지 않는다).
 * - 아니면 예전 모양 — `sql` 하나(옛 단일 초안 — 화면이 첫 탭 "쿼리 1" 로 읽는다).
 * - `active` 는 있는 탭의 `n` 일 때만, 아니면 첫 탭.
 */
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
      // 데이터 탭(`data` 칸이 있다) — 칸이 못 쓸 모양이면 그 탭만 버린다(빈 쿼리 탭으로 바꾸지 않는다). 글 · 이름은 두지 않는다.
      if (o.data !== undefined) {
        const data = canonDataTab(o.data);
        if (!data) continue;
        seen.add(n);
        list.push({ n, data });
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
  if (list.length === 1 && list[0].n === 1 && list[0].title === undefined && list[0].data === undefined) {
    return list[0].sql === undefined ? {} : { sql: list[0].sql };
  }
  const active = typeof raw.active === "number" && list.some((s) => s.n === raw.active) ? raw.active : list[0].n;
  return { scripts: list, active };
}

/**
 * diff 타일의 비교 범위 — 브랜치 전체(main 대비) · 커밋 하나 · 커밋 안 한 변경 (docs/log/2026-10-05-diff-tile.md) · 정한 두 커밋
 * 사이(`range` — 오케스트레이션 보고의 `base … 보고 커밋`, 2026-10-15 4단계. 보드의 [diff 보기]만 연다)
 */
export type DiffScopeKind = "branch" | "commit" | "wip" | "range";

/** diff 타일의 보기 — 한 줄 · 나란히. 값은 배치 파일에 글자 그대로 적히므로 **바꾸지 않는다** */
export type DiffViewMode = "unified" | "split";

/**
 * **diff 타일의 주소** ([`PaneSpec.diff`] · docs/log/2026-10-05-diff-tile.md) — 배치 파일 · 창 이관에 실린다(`name` 은 화면용
 * 사본이라 저장하지 않는다). `branch` 가 없는 것은 분리 HEAD 워크트리의 `wip` 뿐이다.
 */
export interface DiffSpec {
  projectId: string;
  scope: DiffScopeKind;
  branch?: string;
  /** 그 워크트리(커밋 안 한 것 · 문서로 열기) — `wip` 이면 반드시 */
  worktreePath?: string;
  /** `commit` 범위의 커밋 */
  commit?: string;
  /** `range` 의 시작 · 끝 커밋(보고의 기준 · 보고 커밋 — `commit` 과 따로 두어 범위를 오가도 남는다) */
  base?: string;
  tip?: string;
  /** 고른 파일(저장소 뿌리 기준) */
  file?: string;
  /** 고른 보기 — 기본(한 줄)이면 두지 않는다 */
  view?: DiffViewMode;
  /** 화면용 사본(머리줄 "변경 · feat-retry") — 저장하지 않는다 */
  name?: string;
}

/**
 * **문서 타일의 보기** — 마크다운을 그린 것(`rendered`, 기본) · 원문(`source`) (docs/log/2026-09-27-doc-tile.md).
 * 마크다운 파일에만 뜻이 있다. 값은 배치 파일(`SavedLeaf.docMode`)에 글자 그대로 적히므로 **바꾸지 않는다**.
 */
export type DocMode = "rendered" | "source";

/** 알려진 문서 보기 값인가 — 배치 파일에서 읽은 글자를 거를 때 */
export function isDocMode(v: unknown): v is DocMode {
  return v === "rendered" || v === "source";
}

/**
 * **문서 편집 중의 보기**(마크다운만) — 원문만(`source`) · 나란히(`split`, 기본) · 미리 보기만(`preview`).
 * 넓은 타일에서 고른 값이고, 값은 배치 파일(`SavedLeaf.docEditView`)에 글자 그대로 적히므로 **바꾸지 않는다**.
 */
export type DocEditView = "source" | "split" | "preview";

/** 알려진 편집 보기 값인가 — 배치 파일에서 읽은 글자를 거를 때 */
export function isDocEditView(v: unknown): v is DocEditView {
  return v === "source" || v === "split" || v === "preview";
}

/**
 * **파일 타일의 보기** — 아이콘(격자) · 간단히(위→아래로 흐르고 열이 옆으로 는다) · 자세히(목록 + 폴더 펼침)
 * (docs/log/2026-10-07-file-tile-dolphin.md — KDE Dolphin 의 세 보기). 값은 `settings.toml` 의 `[files] default_view` 와
 * 배치 파일(`SavedLeaf.fileView`)에 글자 그대로 적히므로 **바꾸지 않는다**.
 *
 * 옛 두 값(`tree` 트리 · `navigate` 들어가기 — docs/log/2026-09-25-file-tree-view.md)은 읽을 때 `details` 로 옮긴다
 * ([`migrateFileView`]). 자세히 보기가 옛 트리를 흡수했고(펼침 화살표), 옛 들어가기는 펼치지 않은 자세히와 같다.
 */
export type FileView = "icons" | "compact" | "details";

/** 알려진 보기 값인가 — 지금의 세 글자만 (옛 값은 [`migrateFileView`] 가 받는다) */
export function isFileView(v: unknown): v is FileView {
  return v === "icons" || v === "compact" || v === "details";
}

/**
 * 파일·배치에서 읽은 보기 글자 → 지금의 보기. 옛 `tree`·`navigate` 는 `details` 로 옮기고, 모르는 글자면 `null`
 * (부르는 쪽이 칸을 떨어뜨려 기본 보기로 선다). 설정 키 id(`default_view`)·배치 칸 이름(`fileView`)은 그대로다.
 */
export function migrateFileView(v: unknown): FileView | null {
  if (isFileView(v)) return v;
  if (v === "tree" || v === "navigate") return "details";
  return null;
}

/**
 * 파일 타일이 올리는 **보기 곁 상태 한 조각** — 아이콘 크기 단계 · 장소 패널 켬/끔. 상위가 패널 명세의
 * `fileZoom` · `filePlaces` 에 옮겨 적는다(`app/panes.svelte.ts` 의 `noteFileUi`).
 */
export interface FileUiPatch {
  zoom?: number;
  places?: boolean;
  /** 미리 보기 패널 켬/끔 (기본 꺼짐) */
  preview?: boolean;
  /** 숨김 파일 보기 켬/끔 (기본 꺼짐) */
  hidden?: boolean;
}

/** 아이콘 보기의 크기 단계 — `0`(가장 작다) … `FILE_ZOOM_MAX`. 단계마다의 배율은 `browser/file-view.ts` 의 표 */
export const FILE_ZOOM_MAX = 4;
/** 고른 적 없을 때의 단계 */
export const DEFAULT_FILE_ZOOM = 1;

/** 파일·배치에서 읽은 크기 단계 — 범위 안의 정수만, 아니면 `null` */
export function clampFileZoom(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  return v >= 0 && v <= FILE_ZOOM_MAX ? v : null;
}

/**
 * 이 종류가 **백엔드 세션을 여는** 패널인가 (= `local`·`ssh`).
 *
 * 세션 없는 패널(`sftp`·`localfs`·`start`·`doc`·`branches`)을 제외해야 하는 자리가 여러 곳이다 — 창이
 * 닫힐 때의 세션 정리·동시 입력 집합·AI 공유 보고 등. 그때마다 `!== "sftp" && …` 를
 * 늘려 쓰면 종류가 하나 더 늘 때 빠뜨리는 자리가 생기므로, **긍정형 한 곳**으로 모은다.
 * 타입 술어라 통과하면 `kind` 가 [`SessionKind`] 로 좁혀진다.
 *
 * **`"sftp"` 가 거짓인 것이 헷갈릴 수 있다** — SFTP 타일은 분명히 세션을 쓴다. 하지만 이
 * 술어가 답하는 질문은 "세션을 쓰는가" 가 아니라 **"자기 세션을 여는가"** 다. SFTP 타일은
 * 자기를 연 터미널의 세션을 빌릴 뿐이라([`PaneSpec.sourcePaneId`]) 열지도 닫지도 않는다.
 * 참으로 두면 창이 닫힐 때 세션 정리가 **원본 터미널의 세션을 한 번 더 닫고**, 동시 입력
 * 집합에 파일 목록이 끼어들며, 직렬화가 있지도 않은 버퍼를 찾는다.
 */
export function hasSession(kind: PaneKind): kind is SessionKind {
  return kind === "local" || kind === "ssh";
}

/**
 * 터미널 한 장의 크기 (열·행) — 이관 짐(`$lib/tear`)과 복원 지시서가 함께 쓴다.
 *
 * 여기 사는 이유는 순환이다: `tear.ts` 는 이 파일을 import 하므로 반대 방향으로 둘 수 없다.
 */
export interface TermSize {
  cols: number;
  rows: number;
}

/**
 * 패널 하나는 터미널이나 세션 없는 파일·시작 화면 한 장이다 ([`PaneKind`] 설명 참고).
 * `id` 는 프런트 전용 키 (백엔드 세션 id 와 다름) 이며 **화면 인스턴스의 신원**이다 —
 * 렌더링이 이 id 로 키를 잡으므로 분할·리사이즈로 트리가 새로 만들어져도
 * 같은 id 의 터미널은 언마운트되지 않는다 (= 세션이 끊기지 않는다).
 */
export interface PaneSpec {
  /** v2 영속 키 — 런타임 pane-N과 독립적이다. */
  tileKey?: string;
  /** 소비된 실행 옵션과 별개인 재시작 명세(ON 창 이관만). */
  restart?: Pick<PaneSpec, "autorun" | "cwd" | "injectMcpToken">;
  id: string;
  kind: PaneKind;
  /**
   * kind === `"ssh"` 일 때 `~/.ssh/config` 별칭.
   *
   * kind === `"sftp"` 도 이 칸을 쓴다 — **원본 터미널의 별칭을 복사해 둔 것**이다.
   * 제목("web-01")에 쓰이고, 배치 복원이 원본을 다시 찾는 열쇠이기도 하다
   * ([`sourcePaneId`] 는 창마다 새로 매겨지는 값이라 파일에 담을 수 없다).
   */
  alias?: string;
  /**
   * **kind === `"ssh"` · 빠른 접속 전용** — `~/.ssh/config` 에 항목이 없는 접속 대상
   * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
   *
   * 값이 있으면 [`alias`] 는 **설정의 별칭이 아니라 화면에 보이는 이름**(`user@host:port`)이고,
   * 백엔드는 config 를 보지 않고 이 세 칸으로 붙는다 (`open_ssh_session` 의 `adhoc` 인자).
   * 비어 있는 칸은 백엔드가 채운다 — 사용자 이름은 OS 사용자, 포트는 22.
   *
   * **`path` 와 같은 무리라 1회용이 아니다**: [`clonePane`](분할 복제)·[`adoptTab`](창 이관)이
   * 그대로 물려주고 배치 파일에도 저장된다(`SavedLeaf.adhoc`). 그래야 끊긴 타일의 재연결도,
   * 앱을 껐다 켠 뒤의 복원도 같은 서버로 돌아간다 — 값이 사라지면 그 타일은 `alias` 만 든
   * 채 "설정에 없는 별칭" 으로 접속을 시도하고, `user@host:port` 는 호스트 이름이 아니라서
   * 곧바로 실패한다.
   */
  adhoc?: AdhocTarget;
  /**
   * **kind === `"sftp"` · 원격 `"doc"` 전용** — 이 브라우저가 세션을 빌려 쓰는 터미널 타일의 `pane.id`
   * (docs/log/2026-09-03-sftp-browser-tile.md). 원격 문서 타일도 같은 뜻 · 같은 배선이다
   * (docs/log/2026-09-27-doc-tile.md).
   *
   * SFTP 타일은 자기 세션을 열지 않는다 ([`PaneKind`]·[`hasSession`] 설명). 대신 매 프레임
   * `+page` 의 패널→세션 맵에서 **이 id 로 세션을 찾아** 쓴다. 그래서 배선이 저절로 따라온다:
   *
   * - 원본이 `exit` 로 죽으면 맵에서 그 항목이 사라져 브라우저는 세션 `null` → 대기 배너.
   * - 원본이 **재연결**되면 세션 id 가 새 값으로 바뀌는데, 브라우저는 id 를 들고 있는 게
   *   아니라 매번 조회하므로 새 세션으로 그냥 이어진다 (보고 있던 경로를 유지한 채 새로고침).
   * - 원본 타일을 닫으면 조회가 영영 실패해 "원본 터미널 없음" 배너가 남는다.
   *
   * **id 를 복사해 둔 것이 아니라 참조라는 점이 요점**이다. 세션 id 를 복사해 두면 재연결
   * 순간에 죽은 id 를 붙들고 "세션을 찾을 수 없습니다" 를 반복한다.
   *
   * 창 이관([`adoptTab`])에서는 패널 id 가 전부 새로 매겨지므로 **이 값도 같은 표로 옮겨
   * 준다**. 원본이 옮겨진 서브트리 밖에 있었다면 옮길 짝이 없어 값이 남지만, 새 창에는 그
   * id 를 가진 패널이 없으므로 조회가 실패해 "원본 터미널 없음" 배너로 뜬다 (타일 자체는
   * 살려 둔다 — 사용자가 만든 타일을 말없이 지우지 않는다).
   */
  sourcePaneId?: string;
  /**
   * **kind === `"localfs"` 전용** — 그 브라우저가 지금 보고 있는 폴더의 절대 경로
   * (docs/log/2026-09-03-local-fs-tile.md). 빈 문자열은 합성 루트("내 PC")다.
   * (`"sftp"` 도 같은 뜻으로 쓰고, `"doc"` 에서는 **보고 있는 파일**의 절대 경로다 — 없으면 그 타일은
   * 뜻이 없어 배치 복원이 버린다.)
   *
   * 브라우저가 폴더를 옮길 때마다 갱신되고, 그 값이 그대로 배치 파일에 실린다
   * (`SavedLeaf.path`). 그래서 앱을 껐다 켜면 **보던 폴더**로 돌아온다 — 로컬 브라우저는
   * 프로젝트 디렉터리를 열어 두고 쓰는 물건이라 매번 홈에서 다시 찾아 들어가면 뜻이 반쯤
   * 사라진다.
   *
   * **1회용이 아니다.** `restore`·`autorun`·`openDelay` 와 달리 [`clonePane`]·[`adoptTab`]
   * 이 그대로 물려준다: 타일을 복제하거나 다른 창으로 찢어 옮겼을 때 그 브라우저가 홈으로
   * 튕기면 "같은 것을 하나 더" 라는 조작의 뜻이 깨진다.
   */
  path?: string;
  /**
   * **kind === `"localfs"` · `"sftp"` 전용** — 이 파일 타일의 보기(아이콘 · 간단히 · 자세히)
   * (docs/log/2026-10-07-file-tile-dolphin.md · 옛 두 값은 [`migrateFileView`]).
   *
   * 없으면 설정 `[files] default_view`(기본 자세히)를 따른다. 툴바의 보기 단추(`Ctrl+1/2/3`)를 누르면 **이
   * 타일에만** 적힌다 — 같은 창에 아이콘 타일과 자세히 타일을 나란히 둘 수 있다.
   *
   * **`path` 와 같은 무리라 1회용이 아니다**: [`clonePane`](복제)·[`adoptTab`](창 이관)이 위
   * 스프레드로 그대로 물려주고 배치 파일에도 저장된다(`SavedLeaf.fileView`). 타일을 찢어 옮겼더니
   * 보기가 바뀌어 있으면 "같은 타일" 이라는 뜻이 깨진다.
   */
  fileView?: FileView;
  /**
   * **kind === `"localfs"` · `"sftp"` 전용** — 아이콘 보기의 크기 단계(`0`…`4`, 없으면 `1`) ·
   * 장소 패널을 껐는가(`false` 일 때만 적힌다 — 없으면 켜져 있다). `F9`·상태 줄 슬라이더·`Ctrl+휠`이 바꾼다
   * (docs/log/2026-10-07-file-tile-dolphin.md). `fileView` 와 **같은 무리**라 복제·이관이 스프레드로 물려주고 배치
   * 파일에도 저장된다(`SavedLeaf.fileZoom` · `SavedLeaf.filePlaces`).
   */
  fileZoom?: number;
  filePlaces?: false;
  /** 미리 보기 패널을 켰는가(`F11`) — **켤 때만** 적힌다(기본 꺼짐). `filePlaces` 와 같은 무리다 */
  filePreview?: true;
  /** 숨김 파일을 보이는가 — **켤 때만** 적힌다(기본 꺼짐 · 2026-11-04 전에는 화면 상태라 F5 에 풀렸다). `filePreview` 와 같은 무리다 */
  fileHidden?: true;
  /**
   * **kind === `"doc"` 전용** — 마크다운 파일을 그려서 볼지(`rendered`) 원문으로 볼지(`source`)
   * (docs/log/2026-09-27-doc-tile.md).
   *
   * **기본(`rendered`)이면 키가 없다** — 머리줄의 [원문]/[보기] 단추가 `source` 를 고를 때만 적힌다.
   * `fileView` 와 같은 무리라 1회용이 아니다: [`clonePane`]·[`adoptTab`] 이 스프레드로 물려주고
   * 배치 파일에도 저장된다(`SavedLeaf.docMode`).
   */
  docMode?: DocMode;
  /**
   * **kind === `"doc"` 전용** — 그린 마크다운 곁의 **목차 패널**을 켰는가. **켤 때만** 적힌다(기본 꺼짐 — 키가 없다).
   * `docMode` 와 같은 무리라 복제·이관이 스프레드로 물려주고 배치 파일에도 저장된다(`SavedLeaf.docOutline`).
   * 읽기 편의일 뿐이라 켜고 꺼도 미리 보기(`docPreview`)를 고정하지 않는다.
   */
  docOutline?: true;
  /**
   * **kind === `"doc"` 전용** — 마크다운 편집 중 고른 보기([`DocEditView`]). **나란히(기본)가 아닐 때만** 적힌다.
   * `docOutline` 과 같은 무리(복제·이관이 물려주고 배치 파일에 저장 — `SavedLeaf.docEditView`), 미리 보기를 고정하지 않는다.
   */
  docEditView?: Exclude<DocEditView, "split">;
  /**
   * **kind === `"doc"` 전용** — 나란히의 왼쪽(편집기) 몫, 0.2~0.8. **기본(0.5)이 아닐 때만** 적힌다(`SavedLeaf.docSplit`).
   */
  docSplit?: number;
  /**
   * **kind === `"doc"` 전용** — 문서 글자 크기(%, `doc-zoom.ts` 의 단계 — 본문 위 `Ctrl+휠`). **100(기본)이 아닐 때만**
   * 적힌다(`SavedLeaf.docZoom`). `docOutline` 과 같은 무리(복제·이관이 물려주고 배치 파일에 저장), 미리 보기를 고정하지 않는다.
   */
  docZoom?: number;
  /**
   * **kind === `"doc"` 전용 — 미리 보기 문서**(VS Code 의 미리 보기 탭과 같은 뜻 · docs/log/2026-09-27-doc-tile.md
   * "미리 보기 타일 재사용"). 파일 타일에서 연 문서는 이 표식을 달고 서고, 다음에 여는 파일이 **이 타일 자리를
   * 갈아 끼운다**(`planDocOpen`) — 탭 하나에 미리 보기는 많아야 하나다.
   *
   * **참일 때만 키가 있다** — 없으면 "붙박이(kept)" 다. 그래서 이 칸을 모르던 때의 배치 파일은 전부 붙박이로
   * 복원된다(아무것도 몰래 바뀌지 않는 쪽). 툴바의 [고정]이나 [원문]/[보기] 전환(명시적인 손길)이 이 키를
   * 지운다. 배치 파일에 저장되고(`SavedLeaf.docPreview`) 창 이관(`adoptTab`)도 그대로 옮기지만,
   * **분할 복제(`clonePane`)는 떨군다** — 복사본이 모르는 새 몰래 갈아 끼워지면 안 된다.
   */
  docPreview?: true;
  /**
   * kind === "local" 일 때 열 셸의 [`ShellInfo.id`].
   * 없으면 백엔드 기본값 (pwsh → powershell 폴백).
   */
  shell?: string;
  /**
   * **kind === `"ssh"` · tmux 호스트 전용** — 이 타일이 붙어 있는 tmux 세션 이름(`aynx-1` …)
   * (docs/log/2026-09-16-tmux-toggle.md).
   *
   * 값이 있다는 것 자체가 **"이 타일은 화면만 있는 세션이다"**(간이 모드)라는 뜻이다:
   * 셸 통합(OSC 133) 파서를 아예 붙이지 않고, 블록에 기대는 기능(명령 점프·마지막 출력
   * 복사·`#` 블록 검색·AI 의 명령 읽기)이 **꺼진 것으로 표시된다**. 조용히 깨지는 대신
   * 머리줄의 `tmux` 칩과 메뉴의 흐린 항목이 그 사실을 말한다.
   *
   * 값을 정하는 쪽은 **백엔드**다 — `open_ssh_session` 이 이 호스트에서 비어 있는 이름을
   * 골라 결과에 실어 주고, 타일이 그것을 여기 적는다. 다음 접속(재연결)에는 이 값이 **힌트로
   * 되돌아가** 같은 tmux 세션에 다시 붙는다(`-A -D`). 그래서 끊겼다 붙은 타일이 자기 자리로
   * 돌아온다.
   *
   * **1회용이 아니다** — `path` 와 같은 무리라 [`adoptTab`](창 이관)이 그대로 물려주고 배치
   * 파일에도 저장된다(`SavedLeaf.tmux`). 다만 [`clonePane`] 은 **물려주지 않는다**: 복제는
   * 새 타일이고, 물려주면 두 타일이 같은 tmux 세션을 물어 서로의 화면을 빼앗는다(`-A -D`).
   */
  tmux?: string;
  /**
   * 이 패널의 스크롤백 줄 수 (`sessions.toml` 의 호스트별 값).
   * 없으면 [`DEFAULT_SCROLLBACK`]. **터미널 생성 시 1회만** 읽힌다.
   */
  scrollback?: number;
  /**
   * 자동 실행 명령 (6단계 — AI 패널 · docs/log/2026-09-02-mcp-frontend.md).
   *
   * **로컬**: 세션이 열리면 터미널이 이 문자열에 `\r` 을 붙여 **딱 한 번** 써 넣는다
   * (`newAiPane` 은 `"claude"` 를 넣어 AI 분할 패널을 만든다).
   *
   * **SSH (2026-09-24 — 원격 프로젝트, docs/log/2026-09-24-projects.md)**: 터미널이 쓰지 않고
   * **첫 접속**에 [`cwd`] 와 함께 백엔드로 실어 보낸다(`OpenOptions.start`) — Rust 가 첫 입력
   * 한 줄(`cd -- '<폴더>' && <명령>`, tmux 호스트면 tmux 세션의 명령)로 조립한다. 원격 셸에
   * **로컬** 명령을 밀어 넣는 것이 아니라, 사람이 프로젝트 폼에 적은 **그 서버의** 명령이다.
   *
   * **1회용이다** — 재연결·창 이관으로 터미널이 다시 마운트돼도 다시 실행되지 않는다 (`restore`
   * 가 있으면 실행하지 않고, `adoptTab` 은 이 값을 떨군다, SSH 는 터미널이 첫 접속에서만
   * 싣는다). [`clonePane`] 은 물려준다 — AI·프로젝트 타일을 분할하면 새 셸도 같은 명령으로
   * 뜬다(의도된 동작).
   */
  autorun?: string;
  /**
   * **로컬 셸 전용** 시작 폴더 — 세션을 열 때 그 폴더에서 셸을 띄운다.
   *
   * AI 타일 때문에 생겼다: 홈에서 뜬 Claude Code 는 폴더 안전 확인만 반복하고 프로젝트
   * 맥락이 없다. 2026-09-27 부터 새 셸도 같은 규칙으로 싣는다 — 규칙은 `start-dir.ts` 의 `startDirFor` 하나이고
   * 순서는 **포커스된 로컬 타일의 지금 폴더(프로젝트 탭이면 그 폴더 안일 때만) → 프로젝트 탭의 폴더 → AI 는 설정
   * `[ai] start_dir` → 없음(=홈)** 이다 (docs/log/2026-09-27-new-terminal-cwd.md).
   *
   * **`autorun` 과 같은 1회용 수명**이다: 세션을 여는 순간 백엔드로 실려 나가고
   * ([`openSession`] → `open_local_session`), [`clonePane`] 은 물려주며(분할한 AI 셸도 같은
   * 프로젝트에서 뜬다 — `autorun` 이 다시 도는 것과 짝이다), [`adoptTab`] 은 떨군다(넘어간
   * 타일의 세션은 저쪽 창에서 이미 열렸다). `restore`(창 이관 재부착)는 새 세션을 열지
   * 않으므로 이 값을 보지 않는다.
   *
   * **없는 폴더는 오류가 아니다** — 백엔드가 조용히 홈으로 떨어뜨린다
   * (`src-tauri/src/pty.rs` 의 `spawn_cwd`). 시작 폴더 하나 덜 맞는 것과 타일이 안 열리는
   * 것은 무게가 다르다.
   *
   * **SSH 패널에서는 원격 프로젝트의 폴더다** (2026-09-24) — 그 서버의 경로이고(`~/…` 허용),
   * [`autorun`] 과 한 벌로 첫 접속에만 실려 나간다. 없는 폴더면 `cd` 가 실패해 명령은 돌지
   * 않는다(셸의 오류 한 줄이 남는다). 배치 복원(`tabs.ts`)은 SSH 잎의 이 값을 되살리지
   * 않는다 — 되살아난 타일은 tmux 힌트로 **돌고 있던 에이전트에** 다시 붙는 것이 뜻이다.
   */
  cwd?: string;
  /**
   * **kind === `"ssh"` · 원격 프로젝트 전용** — tmux 호스트라도 이 타일은 **평범한 셸**로 연다
   * (프로젝트 폼의 tmux 토글을 끈 경우 · docs/log/2026-09-24-projects.md).
   *
   * **1회용이 아니다** — `adhoc` 과 같은 무리라 [`clonePane`]·[`adoptTab`] 이 물려주고 배치
   * 파일에도 저장된다(`SavedLeaf.noTmux`). 재연결마다 백엔드로 실려 가야 하기 때문이다: 첫
   * 접속만 셸이고 재연결은 호스트 규칙대로 tmux 가 되면 같은 타일이 모양을 바꾼다.
   */
  noTmux?: boolean;
  /**
   * **kind === `"ssh"` · 원격 프로젝트 전용** — [`noTmux`] 의 짝: 프로젝트 폼의 tmux 토글을 **켠**
   * 타일은 호스트 설정과 무관하게 tmux 로 붙는다(2026-09-24 실기 ④ — 예전에는 호스트도 켜져
   * 있어야 했다). 수명·저장·물려주기는 `noTmux` 와 같다(재연결도 같은 모양이어야 한다).
   */
  forceTmux?: boolean;
  /**
   * **kind === `"ssh"` · 원격 "새 워크트리에서 열기" 전용** — 접속한 뒤 · 첫 입력 전에 앱(Rust
   * `remote_worktree::prepare`)이 그 전송로의 exec 로 저장소 `repo` 에 워크트리 `name` 을 만든다(첫 커밋이 없으면
   * 타일 위쪽 막대로 묻는다 — 2026-09-29 B안, docs/log/2026-09-29-remote-worktree-after-connect.md). 그때 [`cwd`] 는
   * 만들 워크트리의 폴더다.
   *
   * **1회용이고, `autorun`·`cwd` 보다 더 짧다** — 터미널이 마운트에서 첫 입력 재료로 잡는 즉시
   * 명세에서 **지운다**(`openDelay` 와 같은 자리). 분할 복제가 물려받으면 같은 워크트리를 한 번
   * 더 만들려다 실패 줄을 남기므로, 복제본은 `cwd`·`autorun` 만 들고 그 폴더로 들어간다.
   * [`clonePane`]·[`adoptTab`] 도 떨군다(마운트 전에 복제되는 드문 경우까지).
   *
   * `projectId` 는 앱 안에서만 쓰인다 — 준비가 `ready` 로 끝나면 그 프로젝트의 독 워크트리 목록을 한 번 다시 읽는다
   * (Rust 로 가는 `SshStart.worktree` 에는 싣지 않는다).
   */
  worktree?: { repo: string; name: string; projectId?: string };
  /**
   * **프로젝트 설정 스크립트** (docs/log/2026-09-28-project-agent-setup-script.md) — 세션이 열리면 이 타일에서
   * 프로젝트 `projectId` 의 설정 스크립트를 먼저 돌린다. 스크립트 글자는 싣지 않는다 — Rust 가 `projects.json` 에서
   * 읽어 그 셸이 돌릴 **한 줄**을 짓는다(`setup_script::project_setup_line` · 원격은 첫 입력의 `SshStart.setup`).
   *
   * - 로컬: `autorun` 없이 연다. 끝 신호(OSC 7717)가 성공이면 터미널이 `agent`(에이전트 id — 실행 파일 이름)를 AI
   *   타일과 같은 문(`agentAutorunCommand`)으로 띄우고, 실패면 오류 막대를 세운다. 기록은 `repo`(주 작업 폴더)의
   *   곁 파일에 남는다.
   * - 원격: `autorun`(에이전트)은 그대로 두고 이것을 함께 싣는다 — Rust 가 첫 입력을 `sh -c '<스크립트>' && <에이전트>`
   *   로 짓는다. 끝 신호는 오류 막대에만 쓴다.
   *
   * **`worktree` 와 같은 1회용**이다 — 터미널이 마운트에서 읽는 즉시 지우고, [`clonePane`]·[`adoptTab`] 도 떨군다
   * (분할한 타일이 스크립트를 또 돌리지 않게).
   */
  setup?: { projectId: string; repo: string; agent: string | null; agentName: string | null };
  /**
   * **AI 타일 표식** — 세션이 열릴 때 이 셸 환경에 MCP 토큰(`AYNX_MCP_TOKEN` · 개발 빌드는
   * `AYNX_DEV_MCP_TOKEN`)을 주입한다 (Stage B — CLI-무관 AI). 등록은 이제 이 변수를 읽지 않는다 —
   * claude 도 codex 도 제 설정 파일에 토큰을 담는다(docs/log/2026-09-28-codex-mcp-headers.md). 남은
   * 독자는 실행 설정의 Codex bearer_token_env_var와 훅 스크립트의 물러남이다. 값이 아니라 **표식**이라, 실제 토큰은
   * Rust 가 관리 상태에서 읽어 argv 아닌 환경으로만 심는다.
   *
   * **`autorun` 과 같은 1회용 수명**이다: [`clonePane`] 이 물려주고(분할하면 새 AI 셸도
   * 인증), [`adoptTab`] 이 떨군다(다른 창으로 넘어간 타일은 저쪽 창에서 이미 열렸다).
   */
  injectMcpToken?: boolean;
  /**
   * **이 타일 ↔ 대화 연결의 사본**(2026-10-17) — `app/agent-sessions` 의 연결 표(메모리)가 쓸 때 함께 적고 지울 때 함께 지운다.
   * 저장 · F5 · 앱 재시작 · 창 이관을 건너 산 세션에 **다시 붙은** 타일이 같은 대화를 곧바로 안다(AI 타일의 대화 면). 그 타일의
   * 터미널이 마운트되며 표로 다시 심고(`seedAgentLink`), **새 세션이 서면**(재연결 아닌 새 셸 — `agentSessionRestarted`) 버린다.
   * 대화 id 와 에이전트 이름뿐이다(제목 · 본문 없음). [`clonePane`] 은 떨군다(복제는 새 대화다).
   */
  agentLink?: { agent: string; id: string };
  // (3차 6단계) 오케스트레이션 조정자 타일 표식(`orchestrationRunId` — 2b)은 걷었다: 어느 AI 타일이든 `start_run` · `adopt_run` 으로 조정자가
  // 되고(묶음은 서버 표) 명세에는 표식이 없다. 옛 `tabs.json` 의 그 칸은 읽지 않는다(`tabs.ts` — 복원된 타일은 평범한 AI 타일).
  /**
   * **다른 창에서 넘어온 패널**의 복원 지시서 (docs/log/2026-09-02-tear-out.md).
   *
   * 있으면 터미널은 새 세션을 열지 않는다 — `buffer` 를 그대로 화면에 재생하고
   * `sessionId` 의 **살아 있는** 세션에 출력을 다시 붙인다 (`reattachSession`).
   * `sessionId` 가 `null` 이면 붙일 세션이 없다는 뜻이라 안내 한 줄만 남긴다.
   *
   * **1회용이다** — 터미널이 마운트에서 읽는 즉시 지운다. 남겨 두면 그 패널이
   * 다시 마운트될 때 낡은 버퍼를 또 재생하고 이미 죽은 세션 id 를 다시 잡는다.
   */
  restore?: {
    sessionId: number | null;
    buffer: string;
    /**
     * 넘어온 블록 마커의 자리 (`MarkerDistance` · 2026-09-09). **버퍼를 다 쓴 뒤**에
     * 풀어야 뜻이 있어 버퍼와 같은 봉투에 담는다 — 그래야 `#` 검색의 점프와 실패 거터
     * 표시가 새 창에서도 산다 (없으면 "화면에서 밀려난 블록입니다" 로 떨어진다).
     */
    markers?: MarkerDistance[];
    /**
     * 버퍼를 뜬 **소스 터미널의 크기** (2026-09-09). 없으면 옛 페이로드다.
     *
     * 직렬화 문자열은 **그 열 수에서만** 원래의 줄바꿈을 재현한다 — 다른 폭에 쓰면 xterm 이
     * 그 자리에서 리플로해 줄이 밀리고, 아직 심지 않은 [`markers`] 의 거리가 통째로 어긋난다.
     * 그래서 새 창은 이 크기로 **먼저 되돌린 뒤** 버퍼를 쓰고, 마커를 심고 나서 자기
     * 타일 크기로 맞춘다 (docs/log/2026-09-08-block-history-store.md).
     */
    size?: TermSize;
    /**
     * [`buffer`] 를 뜬 순간 소스 화면에 반영돼 있던 출력 오프셋 (`TearPane.consumed` — R02). 재부착에 실어
     * 이관 틈의 출력을 재생한다. 없으면(옛 짐) 재생 없이 재그림에 맡긴다.
     */
    consumed?: number;
  };
  /**
   * **첫 접속을 이만큼(ms) 늦춘다** — 그룹 전체 열기의 계단식 시작
   * (docs/log/2026-09-03-group-open-tiled.md).
   *
   * 그룹 폴더를 끌어다 놓으면 패널 N 개가 **같은 프레임에** 마운트되고, 아무것도 안 하면
   * N 개의 SSH 핸드셰이크가 같은 순간에 서버를 두드린다. sshd 의 `MaxStartups`(기본
   * 10:30:100)는 그 "아직 인증 안 끝난 연결" 수를 세므로, 호스트가 몰려 있는 그룹에서는
   * 뒤쪽 몇 개가 이유 없이 거절당한다. [`RECONNECT_JITTER`] 가 재연결에서 해결하는 것과
   * **정확히 같은 문제**라, 여기서도 같은 처방을 쓴다 — 시작 시각을 흩뿌린다.
   * (지터가 아니라 계단인 이유: 여는 순간이 한 번뿐이라 결정적인 간격이면 충분하고,
   * 그래야 왼쪽 위부터 순서대로 붙는 것이 눈에 보인다.)
   *
   * **1회용이다** — `autorun`·`restore` 와 같은 규칙이다. 터미널이 마운트에서 읽는 즉시
   * 지우고, `adoptTab`(창 이관)·`clonePane`(분할 복제)도 이 값을 떨군다. 남겨 두면 이미
   * 열려 있던 패널을 찢어 옮기거나 복제할 때마다 아무 이유 없이 몇 초씩 검은 화면이 된다.
   * **재연결·재부착에는 적용되지 않는다** (최초 `startSession` 앞에서만 기다린다).
   */
  openDelay?: number;
  /**
   * **배치 복원으로 뜬 SSH 타일** — 마운트에서 세션을 열지 말라는 표시
   * (docs/log/2026-09-03-workspace-restore.md).
   *
   * 앱을 켜면 저장된 탭이 통째로 되살아나는데, 그 안의 SSH 타일이 전부 같은
   * 순간에 접속을 시작하면 [`openDelay`] 가 푸는 문제(sshd `MaxStartups`)가 그대로
   * 재현되는 데다, TOFU·비밀번호 모달이 앱을 켜자마자 줄줄이 뜬다. 무엇보다 **사용자가
   * 요청한 적 없는 접속**이다. 그래서 이 표시가 있으면 터미널은 "복원됨 — 연결되지 않음"
   * 배너만 띄우고 기다린다: 사람이 [연결] 을 누르거나, `reconnect-all`(기본
   * `Ctrl+Shift+R`)이 계단식으로 부르거나, 설정 `app.auto_reconnect` 가 켜져 있어
   * 시작 직후 그 계단식이 자동으로 한 번 돌 때 붙는다.
   *
   * **1회용이다** — `autorun`·`restore`·`openDelay` 와 같은 규칙이다. 접속을 시작하는
   * 순간 지우고([`clonePane`]·[`adoptTab`] 도 떨군다), 그래서 복원된 타일을 복제하거나
   * 다른 창으로 찢어 옮기면 여느 타일처럼 곧바로 접속한다 (그 조작 자체가 사람의 요청이다).
   */
  deferred?: boolean;
  /**
   * **블록 이력 거울 키** — 이 셸 계보의 안정된 신원 ([`nextHistoryStreamId`] · 2026-09-09).
   *
   * 세션을 여는 타일(`local`·`ssh`)에만 붙는다 (세션 없는 타일은 거울에 실리지 않는다).
   * 프런트 블록 저장소(`block-history.ts`)는 여전히 `pane.id` 로 키를 잡지만, **Rust 거울로
   * 나가는 키**(`context.ts` 의 `reportSession`·`pushSessionBlock`…)는 이 값이다. `pane.id` 는
   * 창마다 새로 매겨져 이관·리로드를 넘지 못하는데, 이 값은 [`adoptTab`] 이 보존하고
   * (`sessionId` 처럼 — `autorun`·`openDelay` 같은 1회용과 다르다) 배치 파일에 저장돼
   * 리로드를 넘는다. 그래서 AI 의 외부 참조 `(session=streamId, blockId)` 가 창 이관·리로드
   * 뒤에도 같은 스트림을 가리킨다. 복제([`clonePane`])는 새 셸 계보라 **새로 발급**한다.
   */
  historyStreamId?: string;
  /**
   * **kind === `"start"` 전용 — 프로젝트 시작 화면** (docs/log/2026-09-26-project-start-screen.md).
   *
   * 있으면 이 시작 타일은 빈 탭의 launcher 가 아니라 **그 프로젝트·워크트리 폴더의 시작 화면**이다
   * (새로 시작 — 셸 · AI CLI · 시작 명령 / 지난 대화 — 재개 · 새 대화로 계속). 로컬 프로젝트를 여는데
   * 그 폴더에 지난 대화가 하나라도 있으면 셸 대신 이 타일이 선다([`newProjectStartPane`]).
   *
   * `folder` 는 **워크트리 폴더**(주 폴더 포함) 그대로다. `cwd` 칸을 쓰지 않은 이유: 그 칸은 "셸을
   * 여는 폴더" 라 [`adoptTab`] 이 1회용으로 떨군다 — 이 값은 창을 옮겨도, 껐다 켜도 남아야 하는 **화면의
   * 주소**다(`path` 와 같은 무리). 배치 파일에도 저장된다(`SavedLeaf.startProject`). 대화 제목은 여기에도
   * 파일에도 싣지 않는다 — 화면이 뜰 때마다 목록을 다시 읽는다.
   *
   * `host` 는 **원격 프로젝트**의 별칭이다(2026-09-27 — docs/log/2026-09-27-remote-conversations.md): 그때 `folder` 는 서버의
   * 경로(`~/work/api`)이고, 이 PC 의 폴더로 쓰이면 안 된다(탭의 프로젝트 폴더 · 로컬 대화의 기준 폴더가 거른다).
   */
  startProject?: { projectId: string; folder: string; host?: string };
  /**
   * **kind === `"branches"` 전용 — 브랜치 그래프의 주소** (docs/log/2026-09-29-branch-graph.md). 어느 프로젝트의 그래프인가
   * (`projectId`)와 사람이 고른 브랜치(`branch` — 없으면 타일이 고른다). 배치 파일 · 창 이관에는 이 둘만 실린다
   * (`SavedLeaf.branchGraph`) — 그래프 자체는 열 때마다 다시 읽는다.
   *
   * `name` 은 **화면용 사본**(프로젝트 이름 — 머리줄 "브랜치 · api-server")이다. 타일이 읽을 때 채우고 저장하지 않는다.
   * 칸을 고칠 때는 객체를 **통째로 새로** 단다 — 분할 복제(`clonePane`)가 스프레드로 같은 객체를 나눠 들기 때문이다.
   */
  branchGraph?: { projectId: string; branch?: string; name?: string };
  /**
   * **kind === `"diff"` 전용 — diff 타일의 주소** ([`DiffSpec`] · docs/log/2026-10-05-diff-tile.md). 칸을 고칠 때는
   * `branchGraph` 와 같이 객체를 **통째로 새로** 단다(분할 복제가 같은 객체를 나눠 들지 않게).
   */
  diff?: DiffSpec;
  /**
   * **kind === `"query"` 전용 — 쿼리 타일의 주소** ([`QuerySpec`]). 칸을 고칠 때는 `branchGraph` 와 같이 객체를 **통째로 새로**
   * 단다(분할 복제가 같은 객체를 나눠 들지 않게).
   */
  query?: QuerySpec;
  /**
   * **kind === `"run"` 전용 — 보드 타일의 주소**(2b) — Run id. 없으면 Run 목록(orphaned 포함)을 그린다. 칸을 고칠 때는 객체를
   * **통째로 새로** 단다(분할 복제가 같은 객체를 나눠 들지 않게). `name` 은 화면용 사본(Run 이름 — 보드가 읽을 때 채우고 저장하지 않는다).
   */
  run?: { runId: string; name?: string };
  /**
   * **kind === `"producer"` 전용 — 프로듀서 채팅 잎의 주소**(2단계 단계 3) — [`ProducerSpec`]. 칸을 고칠 때는 객체를 **통째로 새로** 단다.
   * 배치 파일 · 창 이관 · 원격 거울에 실린다(토큰 없음).
   */
  producer?: ProducerSpec;
}

/** [`PaneSpec.producer`] — 프로듀서 채팅 잎의 주소. 토큰 · 본문은 없다(채팅 토큰은 서버 프로세스 환경 · 임시 파일에만). */
export interface ProducerSpec {
  /** 논리적 채팅 id(`pc-` + uuid — 서버 레지스트리 열쇠 · 귀속 장부의 이름) */
  chatId: string;
  /** 프로듀서 CLI(`claude` · `codex`) */
  cli: string;
  /** 모델(빈 값 = CLI 기본) */
  model: string;
  /** 추론 강도(빈 값 = CLI 기본) */
  effort: string;
  /** 스튜디오(맡긴 저장소 경로 — 서버가 지금 맡기기에서 다시 읽는다) */
  studio: string;
  /** 채팅을 열었다(첫 보내기 — 그 뒤 잎은 "새 앨범" 칸이 아니라 채팅) */
  opened?: boolean;
  /** 턴이 한 번 선 대화 id(서버 표를 잃었을 때 이어 가기 — 서버 재시작 · TTL) */
  conv?: string;
  /**
   * (단계 5) [오케스트레이션으로 이어 가기]로 갈라 온 원본 — 그 AI 타일의 대화(`agentLink` 의 `{agent, id}` — 경로 없음). 이 채팅 자신의 대화(`conv`)가
   * 서기 전에 서버 표를 잃으면 다시 열 때 `fork{from}` 으로 연다(스튜디오는 서버가 그 대화의 기록된 cwd 에서 다시 정한다).
   */
  forkFrom?: { agent: string; conv: string };
}

/** 분할 방향 — `row` = 좌우(세로 분할선), `col` = 상하(가로 분할선) */
export type SplitDir = "row" | "col";

export interface PaneLeaf {
  type: "leaf";
  pane: PaneSpec;
}

export interface PaneSplit {
  type: "split";
  dir: SplitDir;
  /** a 가 차지하는 비율 (0~1). [`MIN_RATIO`]~[`MAX_RATIO`] 로 클램프해 쓴다 */
  ratio: number;
  /**
   * 자르는 자리에 더하는 고정 px(선택 — 없으면 0). 자리 = 부모 폭 × `ratio` + `px` 라 넓은 창에서 a 가 덜 크고 좁은 창에서 덜 준다.
   * 앱이 쥔 오케스트레이션 탭의 프로듀서 칸만 쓴다(`orchestration/orch-tab.ts` 의 `orchRoot`) — 사람이 분할선을 끌면 걷힌다(`SplitView`)
   */
  px?: number;
  a: PaneNode;
  b: PaneNode;
}

/** 탭 하나가 품는 패널 트리. 잎이 터미널, 가지가 분할 */
export type PaneNode = PaneLeaf | PaneSplit;

/**
 * 탭 하나 = 패널 트리 하나. 잎이 1개면 분할 없는 평범한 탭이다.
 *
 * ## 코드의 `tab` = UI 의 **탭** (docs/log/2026-09-03-workspaces-v1.md · docs/log/2026-09-29-workspace-to-tab.md)
 *
 * 한때 화면 이름은 "워크스페이스" 였고 이 파일의 식별자(`TabSpec`·`tabs`·`activeId`·
 * `TAB_DRAG_TYPE`…)만 `tab` 이었다. 2026-09-29 에 워크스페이스라는 층을 두지 않기로 하면서
 * 화면도 코드도 **탭** 하나로 맞췄다. 옛 이름이 남은 곳은 호환 때문뿐이다 — 저장 파일
 * `workspaces.json`(과 그 안의 `workspaces` 필드) · 단축키 id `workspace-1`~`9` · i18n 키.
 *
 * 개념의 핵심: 탭은 **호스트 하나가 아니라 이름 붙인 타일 배치**다. 예전엔
 * 호스트를 더블클릭하면 그 호스트 이름의 탭이 하나 생겼지만, 지금은 **지금 보고 있는
 * 탭 안에 타일로 열린다**. 새 탭은 탭 바 `+`(또는 `new-tab`
 * 단축키)로 명시적으로 만든다.
 */
export interface TabSpec {
  /** 메인 창 개발 플래그에서만 소속을 부여한다. */
  workspaceId?: string;
  tabKey?: string;
  projectId?: string;
  id: string;
  /**
   * 자동으로 붙은 제목 — [`newTab`] 의 `"탭 N"`(옛 파일에는 `"워크스페이스 N"`). 패널 승격([`tabFromPane`])은
   * 떼어 낸 탭의 값을 그대로 물려받는다(옛 파일에는 그때 적힌 패널 이름이 남아 있을 수 있다). 사용자가
   * [`name`] 을 붙이면 화면에서는 가려진다.
   */
  title: string;
  /**
   * **사용자가 직접 붙인 탭 이름** (탭 더블클릭 · 우클릭 → 이름 변경).
   *
   * 있으면 [`tabDisplayTitle`] 이 이 값만 보여 준다 — 패널이 몇 개든, 무엇이 들었든
   * 흔들리지 않는 고정 이름이다 ("배포", "장애 대응" 처럼 **일의 이름**을 붙이라는 뜻).
   * 비우면(빈 문자열로 확정) 키를 지워 자동 제목으로 되돌아간다.
   *
   * v1 에서는 **저장하지 않는다** — 앱을 껐다 켜면 사라진다 (비밀번호 정책이 정해진 뒤에
   * 배치 복원과 함께 다룬다). 창 이관([`adoptTab`])에는 따라간다.
   */
  name?: string;
  /**
   * **이 탭이 무엇을 위해 만들어졌는가의 이름** — 프로젝트·워크트리를 새 탭으로 열 때 붙는 고정 제목
   * (`Aynx` · `Aynx · feat-message` — `app/tabs.svelte.ts` 의 `openInNewTab` 이 적는 유일한 자리).
   *
   * [`title`](자동 제목)과 달리 타일이 늘어도 합성 제목에 밀리지 않는다 — 프로젝트 탭은 안에 셸·에이전트가
   * 몇 개 뜨든 그 프로젝트의 탭이다(사용자 요청 2026-09-27). [`name`](사용자 이름)과 달리 사람이 붙인 것이
   * 아니라서 이름을 붙이면 그쪽이 이기고, 이름을 비우면 자동·합성 제목이 아니라 **이 값으로** 돌아온다.
   * 우선순위는 [`tabFixedTitle`] 한 곳이다. 배치 파일에 저장되고 창 이관([`adoptTab`])에 따라간다.
   * 없는 탭(옛 파일·평범한 탭)은 지금까지와 같다.
   */
  pinnedTitle?: string;
  /**
   * **이 탭이 만들어진 로컬 프로젝트·워크트리 폴더** — [`pinnedTitle`] 의 짝이다. 같은 자리(`openInNewTab`)가
   * 적되 **로컬** 프로젝트·워크트리일 때만이다(원격 경로는 이 컴퓨터에 없는 자리다).
   *
   * 쓰는 곳은 하나 — 이 탭에 새로 여는 셸·AI 타일의 시작 폴더(`start-dir.ts` 의 [`startDirFor`] —
   * docs/log/2026-09-27-new-terminal-cwd.md): 포커스된 타일의 폴더가 이 폴더 **안**이 아니면 이 폴더에서 뜬다.
   * 배치 파일에 저장되고 창 이관([`adoptTab`])에 따라간다. 없는 탭(옛 파일·평범한 탭)은 평범한 탭이다.
   */
  projectFolder?: string;
  root: PaneNode;
  /**
   * **지금 최대화된 타일**의 잎 id (`zoom-tile` — docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
   *
   * 트리를 건드리지 않는 **화면 상태**다. 최대화는 그 타일 하나를 캔버스 전체 사각형으로
   * 그리고 나머지를 숨기기만 하므로, 인스턴스가 전부 살아 있고(세션이 안 끊긴다) 되돌리면
   * 분할선 비율까지 그대로다. 트리를 실제로 접었다 펴는 구현이었다면 그 둘을 손으로
   * 되살려야 했고, 그 사이에 타일 하나가 언마운트되면 세션이 죽는다.
   *
   * **저장하지 않는다** ([`serialize`] 가 이 키를 쓰지 않는다) — 앱을 다시 켰을 때 "타일이
   * 하나뿐인 탭" 처럼 보이는 상태로 복원되면 나머지 타일을 되찾을 길을 모른다.
   * 창 이관에도 싣지 않는다 (같은 이유).
   */
  zoomedPaneId?: string | null;
  /**
   * **오케스트레이션 탭의 표지**(2026-10-29 — docs/log/2026-10-29-orchestration-player-tab.md D1 · D2). 있으면 이 탭은 앱이 쥔 고정
   * 배치(왼쪽 프로듀서 로컬 AI 타일 · 오른쪽 플레이어 잎 `kind:"run"` · 아래 재생 막대 띠)다 — 모양 판정 · 배치 계획은
   * `orchestration/orch-tab.ts` 의 순수 함수. `runId` 가 있으면 앨범 탭, 없으면 홈(프로듀서 없음) · 준비 중(프로듀서 있음).
   * 배치 파일 · 창 이관 · 원격 거울에 실린다. 다른 타일을 받지 않는다(D11).
   */
  orch?: OrchMark;
}

/** [`TabSpec.orch`] — 오케스트레이션 탭의 표지. 칸을 고칠 때는 객체를 통째로 새로 단다(같은 객체를 나눠 들지 않게). */
export interface OrchMark {
  /** 탭 안 경로. 옛 표지와 모르는 값은 라이브러리로 버린다. */
  view?: "library" | "studio" | "new" | "album" | "track" | "artists";
  /** `view:"studio"` — 스튜디오(화면 낱말)의 저장소. 서버 문자열 그대로(열쇠) */
  repo?: string;
  runId?: string;
  taskId?: string;
  attemptId?: string;
  /** new · album · track — 스튜디오 화면을 거쳐 들어왔으면 그 저장소(← · Esc 가 돌아갈 곳). 없으면 라이브러리로 돌아간다(옛 저장 값 포함) */
  fromRepo?: string;
}
