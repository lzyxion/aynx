// 새 패널·탭 명세를 만드는 곳 — `new*Pane`·`newTab`·`restoredTab`·`clonePane`·`tabFromPane`·`adoptTab`.
// 불변식: `tab-N`·`pane-N`·탭 제목 번호 **카운터는 이 파일에만** 산다(창마다 따로 돈다) — id 를 매기는 함수는
// 전부 여기 있어야 하고 카운터를 내보내지 않는다. `paneOrder` 는 그 `pane-N` 모양에 기대므로 함께 둔다.

// 빠른 접속 대상의 **모양**과 이름 짓기 하나만 빌린다 (문법·파싱은 그쪽이 단일 진실이다).
// `quick-connect.ts` 는 import 가 하나도 없는 잎 모듈이라 순환이 생길 자리가 없다.
import { quickConnectLabel, type QuickConnectTarget as AdhocTarget } from "$lib/quick-connect";
import { canonQueryTabs, hasSession, isFileLeafKind, storedRowLimit, type DiffSpec, type PaneLeaf, type QuerySpec, type PaneNode, type PaneSpec, type ProducerSpec, type TabSpec, type Tr } from "./spec";
import { listPanes } from "./tree";
import { parseOrchMark } from "$lib/orchestration/orch-tab";
import { freshLaunchOf } from "$lib/agent-sessions";

let tabSeq = 0;
let paneSeq = 0;
/** 탭 기본 이름의 번호 — 창 하나 안에서 단조 증가한다 (닫아도 되쓰지 않는다) */
let tabTitleSeq = 0;

function nextTabId(): string {
  tabSeq += 1;
  return `tab-${tabSeq}`;
}

function nextPaneId(): string {
  paneSeq += 1;
  return `pane-${paneSeq}`;
}

/**
 * **블록 이력 스트림 id** — 이 셸 계보의 안정된 신원 (2026-09-09 · 정체성 분리).
 *
 * `pane.id`(`pane-N`)는 창마다 다시 매겨지므로 창 이관·페이지 리로드를 넘지 못한다. 그래서
 * AI 가 MCP 로 `(session, blockId)` 를 지목할 때 쓰는 **거울 키**는 이 값 하나다 — 이관에
 * 실려 따라가고([`adoptTab`]), 배치 파일에 저장돼 리로드를 넘는다(`tabs.ts`). 화면
 * 인스턴스 신원(`pane.id`)과 갈라 둔 덕에 타일이 창을 옮겨도 외부 참조가 살아 있다.
 *
 * 이관 토큰(`tear.ts` 의 `newToken`)과 **같은 crypto 난수**를 쓰되, 키로 쓰려고 128비트
 * 16진 문자열로 낸다 (`crypto` 가 없는 테스트·SSR 환경은 `Math.random` 폴백 — 유일성만
 * 지키면 되고 이 값은 짝짓기용 불투명 식별자다).
 */
export function nextHistoryStreamId(): string {
  const buf = new Uint32Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 0x1_0000_0000);
  }
  return Array.from(buf, (n) => n.toString(16).padStart(8, "0")).join("");
}

/**
 * 잎 하나짜리 트리 (= 분할되지 않은 탭의 본문).
 *
 * **패널 객체를 복사하지 않는다** — 살아 있는 패널을 트리에서 떼어 다른 곳에 다시 심을 때
 * (`movePane`·패널 → 탭 승격) 이 함수로 감싸면 `pane.id` 가 유지되어 터미널이 재마운트되지 않는다.
 */
export function leafOf(pane: PaneSpec): PaneLeaf {
  return { type: "leaf", pane };
}

/**
 * **로컬 셸 패널** 하나의 명세 — `shell` 이 없으면 백엔드 기본값(pwsh → powershell 폴백).
 *
 * 예전의 `newLocalTab` 을 대신한다. 셸은 이제 **새 탭이 아니라 지금 탭의 타일**로
 * 열리므로 ([`newTab`] 설명), 만들어야 하는 것은 탭이 아니라 잎 하나다. 번호(`"로컬 3"`)도
 * 함께 사라졌다 — 그 번호는 탭 제목을 구분하려던 장치였고, 타일의 이름은 [`paneName`] 이
 * 셸 라벨로 낸다 (같은 셸이 여럿이면 배치가 그것을 구분해 준다).
 */
export function newLocalPane(shell?: string): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "local",
    historyStreamId: nextHistoryStreamId(),
    ...(shell ? { shell } : {}),
  };
}

/**
 * 스크롤백 기본값 — `sessions.toml` 에 아무 값도 없을 때 쓴다.
 * (`[defaults] scrollback = 5000` 을 적어 둔 것과 같은 결과)
 */
export const DEFAULT_SCROLLBACK = 5000;
/**
 * 허용 범위. 밖으로 나간 값은 **잘라 맞추지 않고 통째로 무시**하고 기본값으로 돌아간다 —
 * 오타(`scrollback = 5`, `scrollback = 5000000`)를 조용히 다른 숫자로 바꿔 놓는 것보다
 * "적은 값이 안 먹었다" 가 알아채기 쉽다.
 *
 * 상한은 메모리 예산이다 — xterm.js 는 스크롤백 줄을 전부 JS 힙에 들고 있고
 * (docs/verification/xterm.md), 폭 넓은 터미널에서 20만 줄이면 이미 수백 MB 급이다.
 * 탭 여러 개가 동시에 살아 있는 앱이라 탭당 상한을 둔다.
 */
export const MIN_SCROLLBACK = 100;
export const MAX_SCROLLBACK = 200_000;

/**
 * `sessions.toml` 에서 온 값을 탭에 실어도 되는 형태로 거른다.
 * 없음·비숫자·범위 밖이면 `undefined` (= 기본값을 쓰라는 뜻).
 */
export function clampScrollback(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  if (n < MIN_SCROLLBACK || n > MAX_SCROLLBACK) return undefined;
  return n;
}

/**
 * SSH 패널 **하나**의 명세를 만든다 (세션은 아직 열리지 않는다 — 터미널이 마운트될 때 열린다).
 *
 * 어느 탭의 어느 패널 옆에 끼워 넣든([`splitPaneWith`]) 잎의 모양은 같다.
 * `scrollback` 은 `sessions.toml` 의 병합된 호스트 메타값 — 범위를 벗어나면 무시된다.
 */
export function newSshPane(alias: string, scrollback?: number | null): PaneSpec {
  const lines = clampScrollback(scrollback);
  return {
    id: nextPaneId(),
    kind: "ssh",
    historyStreamId: nextHistoryStreamId(),
    alias,
    ...(lines === undefined ? {} : { scrollback: lines }),
  };
}

/**
 * **빠른 접속 패널** 하나의 명세 — `~/.ssh/config` 에 항목이 없는 그 자리 접속
 * (docs/log/2026-09-16-quick-connect-and-host-keys.md).
 *
 * [`newSshPane`] 과 **모양이 같은 타일**이다: `kind:"ssh"` 이고 세션도 재연결도 이관도 전부
 * 같은 길을 탄다. 다른 것은 두 칸뿐이다 — `alias` 가 설정의 별칭이 아니라 화면에 보이는
 * 이름(`user@host:port`)이고, [`PaneSpec.adhoc`] 에 실제 대상이 실려 있다.
 *
 * 생성자를 따로 둔 이유는 그 둘이 **함께여야 뜻이 있기** 때문이다. `newSshPane` 에 선택
 * 인자를 더하면 `adhoc` 없이 `user@host:port` 를 별칭으로 넘기는 호출이 생길 수 있고, 그
 * 타일은 "설정에 없는 별칭" 으로 접속을 시도해 조용히 실패한다.
 *
 * 스크롤백은 받지 않는다 — 그 값의 출처는 `sessions.toml` 의 호스트 항목인데 빠른 접속에는
 * 그 항목이 없다 (기본값을 쓴다).
 */
export function newAdhocSshPane(target: AdhocTarget): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "ssh",
    historyStreamId: nextHistoryStreamId(),
    alias: quickConnectLabel(target),
    adhoc: { ...target },
  };
}

/**
 * **AI 패널** 하나의 명세 (6단계 — docs/log/2026-09-02-mcp-frontend.md · Stage B: CLI-무관).
 *
 * 로컬 셸 패널이되 열리자마자 `command`(AI CLI — `"claude"`·`"codex"` …)를 자동 실행한다
 * (`autorun`). 쓰기 경로가 아니라 **관찰**용 분할이다 — CLI 는 MCP 로 공유된 다른 패널의
 * 맥락을 읽고, 사람이 그것을 보고 기존 Sync Input 으로 실행한다. `clonePane` 은 `autorun` 과
 * `injectMcpToken` 을 그대로 물려주므로 이 패널을 다시 분할하면 CLI 도 새 셸에서 다시 뜬다
 * (의도된 동작).
 *
 * `injectMcpToken:true` 는 세션이 열릴 때 이 셸 환경에 MCP 토큰을 심게 한다 — codex 가 그것으로
 * 인증한다(Claude는 앱 데이터의 실행 JSON 헤더를 쓴다). 어느 CLI든 켜 둔다: 표식 하나로 두
 * 갈래를 다 덮고, 토큰은 argv 가 아니라 환경으로만 간다.
 *
 * `cwd` 는 **시작 폴더**다 ([`PaneSpec.cwd`]) — 생략하면 홈이다(이 값이 생기기 전과 같다).
 * 고르는 규칙은 새 셸과 같은 하나다 (`start-dir.ts` 의 `startDirFor`): 포커스된 로컬 타일의 지금 폴더 →
 * 프로젝트 탭의 폴더 → 설정 `[ai] start_dir`.
 */
export function newAiPane(command: string, cwd?: string): PaneSpec {
  const start = cwd?.trim();
  return {
    id: nextPaneId(),
    kind: "local",
    historyStreamId: nextHistoryStreamId(),
    autorun: command,
    injectMcpToken: true,
    ...(start ? { cwd: start } : {}),
  };
}

/**
 * **SFTP 파일 브라우저 패널** 하나의 명세 (docs/log/2026-09-03-sftp-browser-tile.md).
 *
 * 자기 세션을 열지 않는다 — `sourcePaneId` 가 가리키는 **터미널 타일의 세션을 빌린다**.
 * 그래서 여는 자리는 언제나 접속된 SSH 터미널이고(헤더의 📂 또는 `open-sftp` 단축키),
 * 그 타일이 자기 id 를 준다. 세션이 없는 타일에서는 빌릴 것이 없어 열 수 없다.
 *
 * `alias` 는 원본의 별칭을 **복사**해 둔 것이다. 화면 이름("web-01")에 쓰이고,
 * 배치 복원에서 원본을 다시 찾는 열쇠이기도 하다 — 패널 id 는 창마다 새로 매겨져 파일에
 * 담아 봐야 다음 실행에서 아무것도 가리키지 못한다.
 *
 * 터미널 하나에 브라우저 하나가 자연스러운 짝이지만 **막지는 않는다** — 같은 서버의 두
 * 자리를 나란히 보고 싶을 수 있고, 둘 다 같은 SFTP 채널을 타므로 비용이 늘지 않는다.
 *
 * `path` 를 주면 거기서 시작한다 — 로컬 타일과 **같은 필드, 같은 뜻**이다
 * ([`newLocalFsPane`]). 여는 쪽(`openFilesFor`)은 원본 셸이 OSC 7 로 말해 준 폴더를 넣고,
 * 없으면 생략한다 (그러면 홈이다 — 이 값이 생기기 전과 같다). 사라진 폴더면 브라우저가
 * 오류 한 줄을 남기고 홈으로 떨어진다.
 */
export function newSftpPane(sourcePaneId: string, alias: string, path?: string): PaneSpec {
  const start = path?.trim();
  return {
    id: nextPaneId(),
    kind: "sftp",
    sourcePaneId,
    alias,
    ...(start !== undefined && start !== "" ? { path: start } : {}),
  };
}

/**
 * **시작 타일** 하나의 명세 — 세션도, 빌리는 것도, 기억할 상태도 없다
 * (docs/log/2026-09-04-start-page.md).
 *
 * `id` 와 `kind` 뿐이라 [`clonePane`]·[`adoptTab`]·배치 저장이 특별 취급 없이 지나간다.
 * 화면(`StartPage` — launcher)의 내용 — 최근 호스트 · 프로젝트 · 셸 — 은
 * 전부 패널 밖에서 온다 (`~/.ssh/config`·`history.json`·`projects`·`layouts.json`·localStorage),
 * 그래서 이 명세에 담을 것이 없다 (docs/log/2026-09-25-launcher.md).
 *
 * [`newTab`] 의 시작 배치이자, 복원이 트리를 비웠을 때의 되돌아갈 자리다
 * (`tabs.ts` 의 `rebindSftp`).
 */
export function newStartPane(): PaneSpec {
  return { id: nextPaneId(), kind: "start" };
}

/**
 * **문서 보기 타일** 하나의 명세 (docs/log/2026-09-27-doc-tile.md).
 *
 * `path` 는 파일의 절대 경로다. `source` 를 주면 **원격** — SFTP 타일처럼 그 터미널의 세션을 빌리고
 * (`sourcePaneId`) 별칭을 복사해 둔다(`alias` — 제목과 배치 복원의 열쇠). 파일 타일에서 열 때는
 * **브라우저 자신의 id 가 아니라 브라우저가 빌리던 터미널**의 id·별칭을 넘긴다 — 세션을 가진 것은
 * 그 터미널이고, 브라우저를 닫아도 문서는 살아야 한다. 없으면 로컬 파일이다(키도 두지 않는다).
 */
export function newDocPane(path: string, source?: { paneId: string; alias: string }): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "doc",
    path,
    ...(source ? { sourcePaneId: source.paneId, alias: source.alias } : {}),
  };
}

/**
 * **이미지 타일** 하나의 명세 (2026-11-14) — [`newDocPane`] 과 같은 주소(파일의 절대 경로 · 원격이면 빌릴 터미널 id 와 별칭)다.
 * 둘은 "파일 한 장 타일"(`isFileLeafKind`)이라 복원 · 이관 · 원본 다시 묶기가 같은 길을 탄다. 배율 · 이동 위치는 싣지 않는다(열 때마다 맞춤).
 */
export function newImagePane(path: string, source?: { paneId: string; alias: string }): PaneSpec {
  return {
    id: nextPaneId(),
    kind: "image",
    path,
    ...(source ? { sourcePaneId: source.paneId, alias: source.alias } : {}),
  };
}

/**
 * **브랜치 그래프 타일** 하나의 명세 (docs/log/2026-09-29-branch-graph.md) — 프로젝트 id 와 (있으면) 고를 브랜치.
 * 값이 없는 칸은 키도 두지 않는다(자동 저장의 문자열 비교).
 */
export function newBranchesPane(projectId: string, branch?: string | null): PaneSpec {
  const b = branch?.trim();
  return { id: nextPaneId(), kind: "branches", branchGraph: b ? { projectId, branch: b } : { projectId } };
}

/**
 * **diff 타일** 하나의 명세 (docs/log/2026-10-05-diff-tile.md) — 값이 없는 칸은 키도 두지 않는다(자동 저장의 문자열 비교).
 * 화면용 사본(`name`)은 부르는 쪽이 단다.
 */
export function newDiffPane(diff: DiffSpec): PaneSpec {
  const d: DiffSpec = { projectId: diff.projectId, scope: diff.scope };
  if (diff.branch?.trim()) d.branch = diff.branch.trim();
  if (diff.worktreePath?.trim()) d.worktreePath = diff.worktreePath.trim();
  if (diff.commit?.trim()) d.commit = diff.commit.trim();
  if (diff.base?.trim()) d.base = diff.base.trim();
  if (diff.tip?.trim()) d.tip = diff.tip.trim();
  if (diff.file) d.file = diff.file;
  if (diff.view === "split") d.view = "split";
  if (diff.name) d.name = diff.name;
  return { id: nextPaneId(), kind: "diff", diff: d };
}

/**
 * **오케스트레이션 보드 타일** 하나의 명세(2b) — 주소는 Run id 하나(없으면 Run 목록 — orphaned 포함). 상태는 세션 서버의
 * Run 표에 있다(`orchestration_run`).
 */
export function newRunPane(runId?: string): PaneSpec {
  const id = runId?.trim();
  return id ? { id: nextPaneId(), kind: "run", run: { runId: id } } : { id: nextPaneId(), kind: "run" };
}

/**
 * **프로듀서 채팅 잎** 하나의 명세(2단계 단계 3) — 오케스트레이션 탭의 왼쪽 고정 잎. 채팅 id 는 부르는 쪽이 짓는다(`newProducerChatId`).
 */
export function newProducerPane(p: ProducerSpec): PaneSpec {
  return { id: nextPaneId(), kind: "producer", producer: { ...p } };
}

/**
 * **쿼리 타일** 하나의 명세 (2026-10-12) — 연결 id · (있으면) 초안 · 스크립트 탭. 탭 모양은 [`canonQueryTabs`] 가 고른다
 * (초안이 [`QUERY_DRAFT_MAX`] 를 넘거나 비면 싣지 않는다). 화면용 사본(`name`)은 부르는 쪽이 단다.
 */
export function newQueryPane(q: QuerySpec): PaneSpec {
  const query: QuerySpec = { connId: q.connId.trim() };
  const tabs = canonQueryTabs(q);
  if (tabs.sql !== undefined) query.sql = tabs.sql;
  const rows = storedRowLimit(q.maxRows);
  if (rows !== undefined) query.maxRows = rows;
  if (tabs.scripts) {
    query.scripts = tabs.scripts;
    query.active = tabs.active;
  }
  if (q.name) query.name = q.name;
  return { id: nextPaneId(), kind: "query", query };
}

/**
 * 이 타일이 **남의 세션을 빌려 쓰는가** — SFTP 타일, 그리고 별칭이 있는(원격) 파일 한 장 타일(문서 · 그림 — `isFileLeafKind`).
 *
 * 그런 타일은 혼자 새 창으로 떼어 가면 그 자리에서 원본을 잃는다 — 창을 넘는 길은 원본과 **함께**
 * 가는 탭 티어아웃이다. 판정이 두 곳(`startPaneTear` · 타일 ⋯ 메뉴의 "새 창으로 분리")에서 갈리면
 * 메뉴에는 있는데 누르면 아무 일도 없는 항목이 생기므로 여기 하나로 모은다.
 */
export function borrowsSession(pane: Pick<PaneSpec, "kind" | "alias">): boolean {
  if (pane.kind === "sftp") return true;
  return isFileLeafKind(pane.kind) && (pane.alias?.trim() ?? "") !== "";
}

/**
 * 이 트리에 **같은 파일을 보는 문서 타일**이 이미 있는가 — 있으면 그 명세, 없으면 `null` (순수 함수 · [`findFilePane`] 의 문서 갈래).
 */
export function findDocPane(
  root: PaneNode,
  path: string,
  source?: { paneId: string; alias: string },
): PaneSpec | null {
  return findFilePane(root, "doc", path, source);
}

/**
 * 이 타일이 그 파일을 보는 그 종류의 파일 한 장 타일인가 — [`findFilePane`] · [`findNewDocPane`] 의 "같다" 한 줄(순수 함수).
 *
 * "같다" 는 종류가 같고 경로가 글자 그대로 같고, 원격이면 **같은 터미널(`sourcePaneId`)·같은 별칭**을 빌리는 것이다.
 * 로컬은 별칭이 없는 것끼리만 같다.
 */
function isSameFile(
  p: PaneSpec,
  kind: "doc" | "image",
  path: string,
  source?: { paneId: string; alias: string },
): boolean {
  if (p.kind !== kind || p.path !== path) return false;
  const alias = p.alias?.trim() ?? "";
  return source ? alias === source.alias.trim() && p.sourcePaneId === source.paneId : alias === "";
}

/**
 * 이 트리에 **같은 파일을 보는 그 종류의 파일 한 장 타일**(문서 · 그림)이 이미 있는가 — 있으면 그 명세, 없으면 `null` (순수 함수).
 * 파일 타일에서 같은 파일을 두 번 열면 새 타일을 세우지 않고 이미 있는 타일로 포커스를 옮기는 데 쓴다.
 */
export function findFilePane(
  root: PaneNode,
  kind: "doc" | "image",
  path: string,
  source?: { paneId: string; alias: string },
): PaneSpec | null {
  for (const p of listPanes(root)) if (isSameFile(p, kind, path, source)) return p;
  return null;
}

/**
 * `before`(요청 전에 있던 타일 id) 뒤 **새로 나타난, 그 파일을 보는 문서 타일** — 있으면 그 명세, 없으면 `null` (순수 함수).
 *
 * 원격 창(원격 웹 · 폰)이 문서를 열면 집 PC 가 **새 id** 로 세우므로(`app/mirror-requests` 의 `fresh`) 연 명세의 id 로는 그 타일을
 * 찾을 수 없다 — 거울에 새로 선 타일 중 같은 파일([`findDocPane`] 과 같은 판정)을 그 타일로 본다(`app/panes` 의 `setLineOnOpened`).
 */
export function findNewDocPane(
  panes: Iterable<PaneSpec>,
  before: ReadonlySet<string>,
  path: string,
  source?: { paneId: string; alias: string },
): PaneSpec | null {
  for (const p of panes) if (!before.has(p.id) && isSameFile(p, "doc", path, source)) return p;
  return null;
}

/**
 * 파일 타일에서 문서를 **어디에** 열까 (순수 함수 · docs/log/2026-09-27-doc-tile.md "미리 보기 타일 재사용").
 *
 * 1. 같은 파일을 보는 문서 타일([`findDocPane`])이 있으면 → 그리로 포커스(`focus`). 미리 보기든 붙박이든.
 * 2. 없고 이 탭(트리)에 **미리 보기 문서**(`docPreview`)가 있으면 → 그 타일 자리를 갈아 끼운다(`replace`).
 *    원본이 달라도 된다(로컬 → 원격) — 칸은 "지금 훑어보는 파일" 의 자리다.
 * 3. 둘 다 없으면 → 파일 타일 옆에 새로 세운다(`beside`).
 *
 * 붙박이 문서는 절대 갈아 끼우지 않는다. 트리는 탭 하나의 것이라 다른 탭의 미리 보기는 보이지도 않는다.
 * **저장 안 한 문서**(`isDirty`)도 갈아 끼우지 않는다 — 편집을 시작하면 고정되므로 미리 보기인 채 저장 안 한
 * 글을 들 일은 없지만, 그 약속이 한 번 새면 다음 더블클릭이 글을 말없이 버린다(docs/log/2026-09-27-doc-edit.md "F2").
 * 그때는 옆에 새로 선다(`beside`).
 */
export type DocOpenPlan = { kind: "focus"; paneId: string } | { kind: "replace"; paneId: string } | { kind: "beside" };

export function planDocOpen(
  root: PaneNode,
  path: string,
  source?: { paneId: string; alias: string },
  isDirty: (paneId: string) => boolean = () => false,
): DocOpenPlan {
  return planFileOpen(root, "doc", path, source, isDirty);
}

/**
 * 파일 한 장 타일(문서 · 그림)을 **어디에** 열까 — [`planDocOpen`] 의 규칙을 종류로 넓힌 것(순수 함수).
 * 같은 종류 · 같은 파일([`findFilePane`])이면 `focus`, 없으면 문서만 미리 보기 칸을 갈아 끼우고(`replace` — 위 규칙 그대로),
 * 그림은 미리 보기 표식이 없어 늘 `beside` 다(이전/다음으로 같은 칸에서 훑는다).
 */
export function planFileOpen(
  root: PaneNode,
  kind: "doc" | "image",
  path: string,
  source?: { paneId: string; alias: string },
  isDirty: (paneId: string) => boolean = () => false,
): DocOpenPlan {
  const same = findFilePane(root, kind, path, source);
  if (same) return { kind: "focus", paneId: same.id };
  if (kind === "doc") {
    const preview = listPanes(root).find((p) => p.kind === "doc" && p.docPreview === true && !isDirty(p.id));
    if (preview) return { kind: "replace", paneId: preview.id };
  }
  return { kind: "beside" };
}

/**
 * **프로젝트 시작 화면** 타일 하나 — 종류는 시작 타일(`"start"`) 그대로이고 [`PaneSpec.startProject`]
 * 한 칸이 더 붙는다 (docs/log/2026-09-26-project-start-screen.md).
 *
 * 종류를 새로 만들지 않은 이유: launcher 와 **같은 한때의 자리**라서다 — 헤더가 없고, 분할로 복제되지
 * 않고, 새 창으로 떼어지지 않고, 탭에 혼자 있으면 무엇을 열든 그 자리를 대신한다(`isLoneStart`).
 * 그 규칙들이 전부 `kind === "start"` 를 보므로 칸 하나면 새 종류의 스무 갈래가 생기지 않는다.
 * 화면을 가르는 것은 `PaneHost` 한 곳이다(칸이 있으면 `ProjectStart`, 없으면 `StartPage`).
 */
export function newProjectStartPane(projectId: string, folder: string, host?: string | null): PaneSpec {
  const h = host?.trim();
  return { id: nextPaneId(), kind: "start", startProject: h ? { projectId, folder, host: h } : { projectId, folder } };
}

/**
 * **로컬 파일 브라우저 패널** 하나의 명세 (docs/log/2026-09-03-local-fs-tile.md).
 *
 * SFTP 타일과 화면은 같지만 **매인 데가 없다** — 세션도 원본 타일도 빌리지 않고 이 컴퓨터의
 * 디스크를 곧바로 본다. 그래서 어디서든(시작 타일 하나뿐인 빈 탭에서도) 열 수 있고,
 * 몇 개를 열어 두어도 서로 아무 관계가 없다.
 *
 * `path` 를 주면 거기서 시작한다 (배치 복원이 저장해 둔 자리). 없으면 홈이다 — 그 판단은
 * 브라우저가 하고, 여기서는 **값이 없으면 키도 두지 않는다** (자동 저장이 문자열 비교로
 * 변화를 재므로 `undefined` 키가 섞이면 같은 배치가 다른 글자로 보인다).
 */
export function newLocalFsPane(path?: string): PaneSpec {
  const start = path?.trim();
  return {
    id: nextPaneId(),
    kind: "localfs",
    ...(start !== undefined && start !== "" ? { path: start } : {}),
  };
}

/**
 * 로컬 브라우저 타일의 표시 이름 — `<마지막 경로 요소>`(경로가 없으면 `내 PC`). 종류는 앞자리 아이콘이 말한다.
 *
 * 경로 전체(`C:\Users\wl\projects\aynx`)를 그대로 헤더에 적으면 타일이 좁아질수록 앞부터
 * 잘려 **가장 중요한 마지막 조각**이 먼저 사라진다. 사람이 그 타일을 알아보는 값은 지금
 * 보고 있는 폴더 이름이므로 그것만 남긴다 (전체 경로는 브라우저의 빵부스러기가 늘 보여 준다).
 *
 * **앞의 📁 를 뺐다** (docs/log/2026-09-04-icons-and-rows.md). 이 값은 탭·패널 헤더에 그대로
 * 박히는 **문자열 한 칸**이라 SVG 를 넣을 자리가 없는데, 이모지는 글꼴이 칠하는 그림이라
 * 테마를 따르지 않는다 — 앱 전체에서 폴더가 `--folder` 색으로 통일된 뒤로는 그 한 글자만
 * 노랗게 남았다. 그래서 **텍스트 전용 자리에는 컬러 이모지를 쓰지 않는다**는 규칙을 세우고,
 * 종류 표시는 이름 **밖**의 앞자리 아이콘(`PaneIcon` — 탭·헤더·상태바가 함께 쓴다)에 맡긴다.
 * 그 자리는 SVG 라 테마 색 폴더를 그대로 그린다 (예전엔 탭의 한 글자 글리프였다).
 *
 * 구분자는 `\`·`/` 둘 다 받는다 — 백엔드가 둘 다 받는 것과 같은 관용이다.
 */
export function localFsName(path: string | undefined, tr: Tr): string {
  const p = path?.trim() ?? "";
  if (p === "") return tr("pane.name.files.local");
  const last = p.split(/[\\/]+/).filter((s) => s !== "").at(-1);
  return last ?? p;
}

/**
 * 자동 탭 제목의 **저장 형태** — 언제나 이 글자다 (`탭 3`).
 *
 * ## 왜 만들 때 번역하지 않는가
 *
 * [`TabSpec.title`] 은 **레이아웃 파일에 그대로 적히는 값**이다. 만드는 자리에서 번역하면
 * 영어로 켠 날 만든 탭이 파일에 `"Tab 3"` 으로 남고, 한국어로 돌아와도 그 탭만 영어로
 * 선다 — 자동 제목은 "사용자가 붙인 이름" 이 아니라 **번호 한 칸**이므로 그렇게 굳을
 * 이유가 없다. 그래서 저장은 한 가지 형태로 고정하고(호환을 위해 지금까지와 같은 `탭 N`),
 * 화면은 [`defaultTabNumber`] 로 번호를 되읽어 `app.tabs.default` 로 그린다.
 */
const DEFAULT_TAB_TITLE = (n: number): string => `탭 ${n}`;

/**
 * 제목이 **자동 탭 제목**이면 그 번호, 아니면 `null` — 순수 함수다.
 *
 * 세 꼴을 모두 읽는다: 지금의 `탭 N` · 영어로 저장됐던 `Tab N`(단계 ②·③ 사이에 만들어진
 * 레이아웃 파일) · 옛 이름 `워크스페이스 N`. 사용자가 손으로 붙인 이름은
 * [`TabSpec.name`] 에 따로 살므로 여기서 잘못 잡아갈 위험이 없고, 설령 제목이 우연히 같은
 * 꼴이어도 보이는 글자는 같은 번호의 같은 문장이다.
 */
export function defaultTabNumber(title: string): number | null {
  const m = /^(?:탭|Tab|워크스페이스) (\d+)$/.exec(title.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 저장된 제목 한 칸을 **화면 글자**로 — 자동 제목이면 지금 언어로 옮기고, 사용자가 남긴
 * 제목이면 글자 그대로다. 탭 바·창 제목·팔레트·검색이 전부 이 문을 지난다.
 */
export function tabTitleLabel(title: string, tr: Tr): string {
  const n = defaultTabNumber(title);
  return n === null ? title : tr("app.tabs.default", { n });
}

/**
 * **탭 하나** — 이 파일이 만드는 **유일한** [`TabSpec`] 생성자다
 * (docs/log/2026-09-03-workspaces-v1.md).
 *
 * 제목은 `"탭 N"` 이고 (전역 카운터 · [`DEFAULT_TAB_TITLE`] — 번역하지 않는다),
 * 시작 배치는 **시작 타일 하나**다.
 *
 * ## 왜 시작 타일로 시작하는가 (docs/log/2026-09-04-start-page.md)
 *
 * 탭은 "무엇을 여는가" 가 아니라 "어디에 여는가" 다 — 만들자마자 그 안에
 * 호스트·셸·파일·설정을 **타일로 열어 넣는** 것이 전부인 그릇이다. 그래서 빈 화면 대신
 * **고를 것이 보이는 화면**으로 시작한다.
 *
 * 예전에는 그 화면이 **호스트 타일**이었다 (docs/log/2026-09-03-hosts-tile.md). 트리 하나로
 * 시작하는 것은 "서버에 붙는다" 는 한 가지 길만 보여 주고, 무엇보다 그 트리가 **결과 배치에
 * 계속 남는다** — 셸 하나만 열고 싶었던 사람은 쓰지도 않을 트리를 매번 닫아야 했다.
 * 지금은 [`newStartPane`] 이다: 로고 아래에 새 터미널·호스트·로컬 파일·설정·명령 팔레트와
 * 최근 접속한 호스트가 서 있고, 무엇이든 고르면 시작 타일이 **그 결과로 바뀐다**
 * (`+page` 의 `placePane` — 유일한 잎일 때는 분할이 아니라 교체다).
 *
 * 그래서 탭은 언제나 사용자가 실제로 연 것들만 담는다. 호스트 트리는 이제
 * 아예 타일이 아니라 **떠 있는 층**이라(`Dock.svelte`) 배치에 남을 자리가 없다
 * (docs/log/2026-09-08-remove-hosts-tile.md).
 *
 * 예전의 종류별 탭 생성자(`newSshTab`·`newLocalTab`·`newAiTab`·`newSettingsTab`·
 * `newHostsTab`)는 **전부 사라졌다** — 그것들이 "탭 = 호스트 하나" 모델의 몸통이었다.
 * 지금은 종류마다 **패널** 생성자만 있고([`newSshPane`]·[`newLocalPane`]·[`newAiPane`]),
 * 그 패널이 탭 안으로 들어간다.
 */
export function newTab(): TabSpec {
  tabTitleSeq += 1;
  return {
    id: nextTabId(),
    title: DEFAULT_TAB_TITLE(tabTitleSeq),
    root: leafOf(newStartPane()),
  };
}

/**
 * **저장된 배치에서 되살린** 탭 하나 (docs/log/2026-09-03-workspace-restore.md).
 *
 * [`newTab`] 와 달리 시작 배치를 만들지 않는다 — 트리는 `$lib/tabs` 의
 * `deserialize` 가 저장된 잎들로 이미 지어서 넘겨 준다. 여기서 하는 일은 **이 창의 id 를
 * 매기고**(`adoptTab` 이 창 이관에서 하는 것과 같은 재부여) 제목·이름을 얹는 것뿐이다.
 *
 * 자동 제목은 저장된 값을 그대로 쓰되, 그것이 자동 제목의 꼴이면([`defaultTabNumber`])
 * 전역 카운터를 그 번호까지 끌어올린다 — 안 그러면 복원 직후에 만든 새 탭이 이미
 * 복원된 것과 **같은 번호**를 다시 받아 탭 바에 같은 이름이 둘 생긴다. 옛 `워크스페이스 N`
 * 과 영어로 저장됐던 `Tab N` 도 같은 문이 읽는다.
 *
 * [`newTab`] 와 같은 이유로 **여기서도 번역하지 않는다** — 저장되는 값이다.
 */
export function restoredTab(
  root: PaneNode,
  title?: string,
  name?: string,
  pinnedTitle?: string,
  projectFolder?: string,
): TabSpec {
  tabTitleSeq += 1;
  const kept = title?.trim();
  const finalTitle = kept && kept !== "" ? kept : DEFAULT_TAB_TITLE(tabTitleSeq);
  const numbered = defaultTabNumber(finalTitle);
  if (numbered !== null) tabTitleSeq = Math.max(tabTitleSeq, numbered);
  const named = name?.trim();
  const pinned = pinnedTitle?.trim();
  const folder = projectFolder?.trim();
  return {
    id: nextTabId(),
    title: finalTitle,
    ...(named ? { name: named } : {}),
    ...(pinned ? { pinnedTitle: pinned } : {}),
    ...(folder ? { projectFolder: folder } : {}),
    root,
  };
}

/**
 * 같은 종류의 **새** 패널을 만든다 (새 id = 새 세션).
 * ssh 면 같은 별칭으로 다시 접속하고, local 이면 같은 셸을 다시 연다.
 * 스크롤백 같은 호스트 메타도 그대로 물려받는다.
 */
export function clonePane(src: PaneSpec): PaneSpec {
  // `adhoc`(빠른 접속 대상)은 위 스프레드가 그대로 옮긴다 — **의도된 것**이다. 복제는 "같은
  // 것을 하나 더" 이고, 그 타일에게 "같은 것" 은 곧 그 서버다 (`alias` 와 짝이라 한쪽만
  // 옮기면 접속이 조용히 실패한다). 객체 참조를 공유해도 값은 바뀌지 않는 칸이라 무해하다.
  const copy: PaneSpec = { ...src, id: nextPaneId() };
  // 복제는 다른 타일이다. 영속 키는 workspace 층이 새로 부여한다.
  delete copy.tileKey;
  // 블록 이력 스트림 id 는 **새로 발급**한다 — 복제는 새 셸을 새 계보로 여는 것이라
  // (id = 새 세션) 이력 거울도 원본과 갈라져야 한다. 물려주면 두 타일이 같은 거울 키를
  // 공유해 한쪽의 블록이 다른 쪽 AI 참조에 섞인다. `hasSession` 이 아닌 종류(설정·파일·시작)의
  // 원본에는 애초에 이 값이 없어 그대로 `undefined` 로 남는다.
  if (src.historyStreamId !== undefined) copy.historyStreamId = nextHistoryStreamId();
  // `openDelay` 는 그룹 전체 열기가 **그 순간에만** 쓰는 계단 지연이다 (1회용).
  // 물려주면 이미 떠 있는 패널을 복제할 때마다 이유 없이 검은 화면이 몇 초 간다.
  delete copy.openDelay;
  // `deferred`(배치 복원의 연결 대기)도 1회용이다 — 복제는 사람이 방금 요청한 조작이므로
  // 새 타일은 여느 분할처럼 곧바로 접속해야 한다. 남겨 두면 복제본이 또 배너로 뜬다.
  delete copy.deferred;
  // tmux 세션 이름도 **떨군다** — 복제는 새 타일이다. 물려주면 두 타일이 같은 tmux 세션
  // 이름을 힌트로 들고 가고, 재접속이 `-A -D`(낡은 클라이언트 떼기)라 서로의 화면을 번갈아
  // 빼앗는다. 비워 두면 백엔드가 이 호스트에서 비어 있는 다음 번호를 골라 준다 —
  // 그것이 "같은 것을 하나 더" 라는 조작의 뜻이다. (`adoptTab` 은 반대로 그대로 물려준다:
  // 같은 타일이 창만 옮기는 것이라 자기 자리로 돌아가야 한다.)
  delete copy.tmux;
  // 원격 워크트리 만들기 재료도 떨군다 — 복제본은 이미 있는 그 폴더(`cwd`)로 들어가기만 한다.
  delete copy.worktree;
  // 설정 스크립트도 떨군다 — 한 워크트리에서 한 번이다(복제본은 셸 · 에이전트만).
  delete copy.setup;
  // 미리 보기 표식도 떨군다 — 복제본은 사람이 "하나 더" 를 골라 세운 것이라 붙박이다. 물려주면 탭에 미리
  // 보기가 둘이 되고, 다음에 여는 파일이 그중 하나를 사람이 모르는 새 갈아 끼운다.
  delete copy.docPreview;
  // 대화 연결 사본도 떨군다 — 복제본은 새 셸 · 새 대화다(`agentLink` 머리말).
  delete copy.agentLink;
  // 같은 이유로 재개 줄의 autorun 은 새 대화로 뜨는 실행 줄로 — AI 타일의 autorun 은 마지막 대화의 재개 줄로 바뀌어 산다
  // (`resumeAutorunFor`). 물려주면 두 타일이 한 대화를 이어 쓴다. 창 이관 재시작 명세(`restart`)도 새 객체로(나눠 들지 않게).
  if (copy.autorun) copy.autorun = freshLaunchOf(copy.autorun);
  if (copy.restart) copy.restart = { ...copy.restart, ...(copy.restart.autorun ? { autorun: freshLaunchOf(copy.restart.autorun) } : {}) };
  // 마지막 폴더도 떨군다 — 복제본은 시작 폴더 규칙(`cwd`)으로 선다(`lastCwd` 머리말).
  delete copy.lastCwd;
  // 쿼리 타일의 주소는 **새 객체로** — 같은 객체를 두 타일이 나눠 들면 한쪽의 초안이 다른 쪽에 적힌다. 연결은 새로 연다
  // (영속 키 `tileKey` 를 위에서 떨궜으니 세션 서버의 DB 연결 표에서도 다른 열쇠다).
  if (copy.query) copy.query = { ...copy.query };
  return copy;
}

/**
 * 패널 하나를 담은 **새 탭**을 만든다 (패널을 탭 바로 끌어 올린 승격).
 *
 * `pane` 을 **복사하지 않고 그대로** 잎에 담는다 — 그것이 요점이다. `pane.id` 가 유지되면
 * 전역 패널 목록(`PaneHost`)의 keyed each 에서 같은 항목이라 DOM 상자도 xterm 도 세션도
 * 그대로다 (바뀌는 것은 `data-tab` 과 style 뿐).
 *
 * **제목은 떼어 낸 탭(`from`)의 것을 그대로 이어받는다** (docs/log/2026-09-30-tear-title-and-agent-handoff.md) —
 * 자동 제목(`탭 3`)이든 사람이 붙인 이름([`TabSpec.name`])이든 프로젝트 탭의 고정 제목([`TabSpec.pinnedTitle`] ·
 * 짝인 [`TabSpec.projectFolder`])이든 글자 그대로다. 같은 창이면 같은 이름의 탭이 둘 서지만 그것이 사용자가
 * 고른 규칙이다(2026-09-30 확인).
 *
 * 예전에는 **그 패널의 이름**(`paneName`)을 제목으로 적었다. 그런데 순수 `paneName` 은 런타임 신호(셸 이름 ·
 * OSC 제목 · 도는 명령)를 모르므로 셸 id 가 안 실린 로컬 타일은 화면에 "PowerShell 7"·"Claude Code" 로 서
 * 있어도 **"로컬"** 이 되었다 — 떼기만 하면 탭 이름이 "로컬" 로 바뀌던 사용자 보고의 절반이다.
 *
 * 부르는 자리는 둘이다 — 같은 창의 새 탭 승격(`promotePane`)과 새 창으로 떼기(`startPaneTear` — 헤더를 창 밖으로
 * 끄는 몸짓과 ⋯ 메뉴 "새 창으로 분리" 가 공유한다). 두 입구가 이 한 함수를 지나므로 규칙이 갈리지 않는다.
 */
export function tabFromPane(
  pane: PaneSpec,
  from: Pick<TabSpec, "title" | "name" | "pinnedTitle" | "projectFolder">,
): TabSpec {
  return {
    id: nextTabId(),
    title: from.title,
    ...(from.name?.trim() ? { name: from.name } : {}),
    ...(from.pinnedTitle?.trim() ? { pinnedTitle: from.pinnedTitle } : {}),
    ...(from.projectFolder?.trim() ? { projectFolder: from.projectFolder } : {}),
    root: leafOf(pane),
  };
}

/**
 * 패널의 **생성 순번** — 전역 렌더 목록의 고정 정렬 키다.
 *
 * `PaneHost` 는 모든 탭의 모든 패널을 한 `{#each}` 로 그리는데, 목록을 "탭 순서 → 트리
 * 순서" 로 만들면 탭 순서를 바꾸거나 패널을 다른 탭으로 옮길 때마다 keyed each 가 살아 있는
 * DOM 노드를 **옮긴다**. 노드 이동은 재마운트는 아니지만 (제거+삽입이라) 포커스가 날아가고
 * xterm 렌더러가 흔들릴 여지가 있다. id 가 단조 증가(`pane-N`)하므로 그 순번으로 정렬하면
 * **기존 패널의 DOM 순서는 영원히 불변**이 되고, 남는 조작은 새 패널 삽입과 닫힌 패널 제거뿐이다.
 * 패널은 전부 절대배치라 DOM 순서가 화면 순서와 무관하다 — 정렬을 마음대로 골라도 된다.
 */
export function paneOrder(paneId: string): number {
  const n = Number(paneId.slice(paneId.lastIndexOf("-") + 1));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 이관된 탭을 **이 창의 id 체계로** 다시 붙인다 (창 이관 — docs/log/2026-09-02-tear-out.md).
 *
 * `tab-N`·`pane-N` 카운터는 **창마다 따로** 돈다. 넘어온 명세의 id 를 그대로 쓰면 이 창이
 * 이미 쓰고 있는 번호와 부딪혀 keyed each 가 엉킨다 (같은 키의 상자 두 개). 백엔드 세션은
 * `restore.sessionId` 로 따로 잡으므로 프런트 id 는 마음대로 새로 매겨도 된다.
 *
 * `restoreOf` 는 **원본 pane.id** 로 복원 지시서를 찾아 주는 함수다 (호출부가 이관
 * 페이로드에서 만든다). 순수 함수 — 입력 트리를 건드리지 않는다.
 *
 * ## 패널을 가리키는 값도 함께 옮긴다 ([`PaneSpec.sourcePaneId`])
 *
 * id 를 새로 매기는 순간 **패널 id 를 담고 있는 필드는 전부 낡은 값이 된다**. 지금 그런
 * 필드는 SFTP 브라우저가 원본 터미널을 가리키는 `sourcePaneId` 하나뿐이다. 그대로 두면
 * 브라우저는 새 창에 존재하지 않는 id 를 붙들고 영영 "원본 터미널 없음" 을 띄운다 —
 * 터미널이 **바로 옆에 같이 넘어왔는데도** 그렇다.
 *
 * 그래서 두 번 훑는다: 먼저 트리를 옮기며 `옛 id → 새 id` 표를 만들고, 그다음 그 표로
 * `sourcePaneId` 를 고쳐 쓴다. 한 번에 못 하는 이유는 브라우저가 트리에서 원본 터미널보다
 * **먼저 나올 수 있기** 때문이다 (분할 순서는 사용자가 정한다).
 *
 * 원본이 옮겨진 서브트리 **밖**이면 표에 없다. 그때는 `sourcePaneId` 를 **지운다** —
 * 낡은 id 를 남기면 새 창에서 우연히 같은 번호를 받은 무관한 패널의 세션을 빌리게 된다
 * (`pane-3` 은 창마다 다른 패널이다). 값이 없으면 브라우저는 "원본 터미널 없음" 배너로
 * 뜨고, 타일 자체는 남는다 — 사용자가 만든 타일을 말없이 지우지 않는다.
 *
 * ## 트리 **밖의** 부속 상태는 `onAdopt` 로 옮긴다
 *
 * `PaneSpec` 에 들어 있지 않은 채 타일에 딸려 사는 것들이 있다 — 블록 이력
 * (`$lib/block-history`)과 AI 공유 옵트인(`$lib/ai.svelte.ts`). 이 함수는 그것들을 알지
 * 못하고 알 필요도 없지만(순수 트리 조작이다), **표는 여기에만 있다.** 그래서 표를 한 번
 * 넘겨주고 옮겨 심는 일은 호출부(`tear.ts` 의 `restoreTab`)가 한다.
 */
export function adoptTab(
  tab: TabSpec,
  restoreOf: (originalPaneId: string) => PaneSpec["restore"],
  onAdopt?: (idMap: ReadonlyMap<string, string>) => void,
): TabSpec {
  /** 옛 pane.id → 이 창에서 새로 매긴 id (두 번째 훑기가 참조를 고치는 데 쓴다) */
  const idMap = new Map<string, string>();

  const walk = (node: PaneNode): PaneNode => {
    if (node.type === "leaf") {
      const pane: PaneSpec = { ...node.pane, id: nextPaneId() };
      idMap.set(node.pane.id, pane.id);
      // 설정·호스트 패널은 세션도 직렬화 버퍼도 없다 — 복원 지시서 없이 **평범한 패널로**
      // 옮기고 새 창이 그 UI(설정 화면·호스트 트리)를 처음부터 그린다 (재부착 없음).
      // 호스트 트리는 새 창에서 config 를 다시 읽으므로 옮겨 붙일 상태 자체가 없다.
      const restore = hasSession(node.pane.kind) ? restoreOf(node.pane.id) : undefined;
      if (restore) pane.restore = restore;
      else delete pane.restore;
      if (tab.workspaceId) pane.restart = pane.restart ?? {
        autorun: pane.autorun, cwd: pane.cwd, injectMcpToken: pane.injectMcpToken,
      };
      // autorun 은 원래 창에서 이미 한 번 실행됐다 — 이관/합치기로 다시 마운트될 때 AI CLI 가
      // 두 번째로 뜨지 않게 여기서 떨군다 (autorun 은 최초 1회용).
      delete pane.autorun;
      // 시작 폴더도 같은 1회용이다 — 저쪽 창이 이미 그 폴더에서 셸을 열었고, 이 타일이
      // 이 창에서 새 세션을 열 일이 생기면(종료 뒤 Enter) 그때는 여느 로컬 타일이다.
      delete pane.cwd;
      // MCP 토큰 주입 표식도 같은 1회용 — 저쪽 창에서 이미 열린 세션이 그대로 넘어온다
      // (재부착이라 새 셸을 열지 않는다). 남겨 두면 뜻 없는 표식이 붙은 채 산다.
      delete pane.injectMcpToken;
      // 원격 워크트리 만들기 재료도 같은 1회용이다 — 저쪽 창에서 이미 만들었다.
      delete pane.worktree;
      // 설정 스크립트도 같다 — 저쪽 창에서 이미 돌았다.
      delete pane.setup;
      // openDelay 도 같은 이유로 떨군다 — 이 패널은 저쪽 창에서 이미 열렸다. 남겨 두면
      // 이관된 타일이 아무 이유 없이 몇 초 늦게 뜬다 (계단 지연은 여는 그 순간의 것이다).
      delete pane.openDelay;
      // 연결 대기 표시도 떨군다 — 탭을 새 창으로 찢는 것 자체가 사람의 요청이라, 넘어간
      // 타일은 저쪽 창에서 평범하게 접속한다 (분리 창은 배치를 저장·복원하지 않는다).
      delete pane.deferred;
      // `adhoc`(빠른 접속 대상)도 **보존한다** — 위 스프레드가 옮겨 왔고 여기서 떨구지
      // 않는다. `alias` 와 한 벌이라, 넘어간 타일이 새 창에서 재연결할 때 이 값이 없으면
      // `user@host:port` 를 별칭으로 들고 "설정에 없는 호스트" 를 두드린다.
      // `historyStreamId` 는 **보존한다** — 위 스프레드가 이미 옮겨 왔고, 여기서 떨구지
      // 않는다(1회용 값들과 다르다). 이 값이 살아 있어야 AI 의 외부 참조가 창을 넘어도 같은
      // 스트림을 가리킨다. 세션 자체가 `restore.sessionId` 로 살아 넘어가는 것과 같은 자리다.
      return { type: "leaf", pane };
    }
    return { ...node, a: walk(node.a), b: walk(node.b) };
  };

  /**
   * 두 번째 훑기 — 패널을 **가리키는** 값을 새 id 체계로 옮긴다. 표에 없는 원본(= 함께
   * 넘어오지 않은 터미널)은 지운다 (위 doc-comment 의 근거).
   */
  const relink = (node: PaneNode): void => {
    if (node.type === "leaf") {
      const src = node.pane.sourcePaneId;
      if (src === undefined) return;
      const moved = idMap.get(src);
      if (moved) node.pane.sourcePaneId = moved;
      else delete node.pane.sourcePaneId;
      return;
    }
    relink(node.a);
    relink(node.b);
  };

  const root = walk(tab.root);
  // `walk` 이 만든 잎은 전부 **이 함수가 방금 만든 새 객체**라 여기서 제자리 수정해도
  // 입력 트리는 그대로다 (이 파일의 순수성 규칙을 깨지 않는다).
  relink(root);
  // 트리 밖의 부속 상태(블록 이력·AI 공유)를 옮길 수 있게 표를 넘긴다 — 무엇을 옮길지는
  // 호출부가 안다 (위 doc-comment 의 근거).
  onAdopt?.(idMap);

  return {
    id: nextTabId(),
    title: tab.title,
    ...(tab.tabKey ? { tabKey: tab.tabKey } : {}),
    ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
    ...(tab.projectId ? { projectId: tab.projectId } : {}),
    // **사용자가 붙인 이름은 따라간다** — 탭을 새 창으로 찢어도 "배포" 는 계속
    // "배포" 여야 한다. 창을 넘으면 이름이 사라진다면 이름을 붙일 이유가 없다.
    // (`title` 의 번호는 저쪽 창 카운터의 값이지만 그대로 둔다 — 이름 없는 탭은
    // 이관 뒤에도 같은 글자로 보이는 편이 덜 놀랍고, 새 번호를 매기면 이 창의 번호와 겹친다.)
    ...(tab.name ? { name: tab.name } : {}),
    // 프로젝트 탭의 고정 제목도 같은 이유로 따라간다 — 짐은 JSON 이라 글자일 때만.
    ...(typeof tab.pinnedTitle === "string" && tab.pinnedTitle.trim()
      ? { pinnedTitle: tab.pinnedTitle.trim() }
      : {}),
    // 프로젝트 폴더도 한 벌로 따라간다 — 옮긴 탭도 그 프로젝트의 탭이다(새 셸이 그 폴더에서 뜬다).
    ...(typeof tab.projectFolder === "string" && tab.projectFolder.trim()
      ? { projectFolder: tab.projectFolder.trim() }
      : {}),
    // 오케스트레이션 탭의 표지도 따라간다(2026-10-29 — 뜯어 간 앨범 탭은 저쪽 창에서도 앨범 탭이다). 짐은 JSON 이라 모양을 다시 본다.
    ...(tab.orch && typeof tab.orch === "object"
      ? { orch: parseOrchMark(tab.orch) ?? { view: "library" as const } }
      : {}),
    root,
  };
}
