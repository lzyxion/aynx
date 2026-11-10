// **쿼리 타일의 여는 길 · DB 연결 고르기 모달 · DB 연결 폼의 상태** (쿼리 타일, docs/log/2026-10-12-query-tile.md).
//
// 연결은 모두 `db-connections.json` 하나에 산다(10-13 저장 하나로 — 사본은 `app/db-conns`). 여는 길은 셋이다 — 호스트 우클릭
// "DB 열기 ›"(그 호스트를 경유하는 연결 — `openHostDb`) · 팔레트 "DB 연결 열기…"(이 모달 — `openDbPicker`) · 독의 DB 칸
// (`browser/DbList` — 이미 열린 타일이 있으면 그리로 가는 규칙은 `app/db-dock`). 모두 [`openQueryTile`] 하나로 와서 **지금 탭에
// 새 타일**을 연다(`openPaneHere`). 같은 연결의 타일이 이미 있어도 새로 연다: 쿼리 타일은 연결을 하나씩 따로 쥔다.
//
// 모달은 두 화면이다 — 목록(SSH 경유 = 호스트별 · 내 PC / 직접) · 폼(새 DB 연결 · 편집 — **경유 칸**: 없음(직접) 또는 호스트).
// 독의 DB 칸 · 호스트 우클릭 "DB 연결 추가…" 는 **같은 모달의 폼만** 연다(`openConnForm` — `formOnly`: 목록으로 돌아가지 않고 저장 ·
// 취소 · Escape 가 닫는다). 폼의 규칙은 순수 `$lib/query/conn-form`, 저장은 목록 통째(`app/db-conns`), 삭제는 OS 확인 대화
// (`confirmRemoveDbConn` — 독의 호스트 · 프로젝트 삭제와 같은 `askConfirm`) 뒤 볼트의 그 id 비밀번호도 걷는다(열려 있을 때만).
//
// 폼의 **[연결 테스트]**(2026-11-09)는 저장 안 한 폼 값(저장과 같은 `connOfRow`)으로 서버 op `db_test` 를 부른다 — 타일과 같은 여는
// 고리(`openDbFlow` — 경유 SSH 관문 · DB 접속 모달)를 돌되 "이 앱에 저장" 은 숨기고 볼트에 아무것도 담지 않는다. 볼트 비밀번호로
// 물러날지는 서버가 정한다(저장된 줄과 대상이 같을 때만). 칩의 규칙은 순수 `$lib/query/conn-test`.
//
// 상태(`dbPicker`)는 여기에만 산다 — 그리는 곳은 `dialogs/DbPickerDialog.svelte`, Escape 사슬 · `anyModalOpen` 은 `app/keys`.
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { loadHosts, hostMeta, type HostEntry } from "$lib/hosts";
import { showNotice } from "$lib/app/notice";
import { openInNewTab, openPaneHere, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import {
  canonQueryTabs,
  findPane,
  newQueryPane,
  storedRowLimit,
  type PaneSpec,
  type QueryRowLimit,
  type QueryScript,
  type QuerySpec,
} from "$lib/session";
import { newTileKey } from "$lib/workspaces/schema";
import { DB_NAME_MAX, type DbConn, type DbEngine } from "$lib/db-conn";
import { stripReason } from "$lib/error-reason";
import { dbOpen, dbTest, errorMessage, type DbTested } from "$lib/query/query-backend";
import {
  beginConnTest,
  connFormKey,
  connTestMayUseVault,
  connTestReason,
  finishConnTest,
  idleConnTest,
  invalidConnTest,
  newConnTestStream,
  onConnFormChange,
  resetConnTest,
  type ConnTestState,
} from "$lib/query/conn-test";
import { openDbFlow, type DbOpenOutcome } from "$lib/query/open-flow";
import { dbConns, ensureDbConns, findDbConn, reloadDbConns, removeDbConn, saveDbConns } from "$lib/app/db-conns.svelte.js";
import {
  confirmHostKey,
  dropVaultSaves,
  ensureVaultUnlocked,
  flushVaultSaves,
  promptPassphrase,
  promptPassword,
} from "$lib/app/prompts.svelte.js";
import { dbAiFormWrite, dbAiNeedsConfirm, formAiLevel, formDbHeadless, sameDbTarget, setDbAi, type DbAiLevel } from "$lib/db-ai";
import { confirmApproveAll } from "$lib/app/approve-all-confirm";
import { dbAiHeadlessOf, dbAiLevelOf, dbAiViewOf, refreshDbAi } from "$lib/app/db-ai.svelte.js";
import {
  connOfRow,
  connRowOf,
  emptyConnRow,
  upsertConn,
  withConnEngine,
  withConnVia,
  type ConnRow,
  type ConnRowProblem,
} from "$lib/query/conn-form";

// ---------------------------------------------------------------------------
// 연결 찾기 — 타일 이름 · 엔진
// ---------------------------------------------------------------------------

/** 쿼리 타일 머리줄의 첫 이름 — "이름 · 경유 호스트"(SSH 경유) · "이름"(직접). 다른 여는 길과 같은 꼴 */
export function dbConnTabName(d: Pick<DbConn, "name" | "via">): string {
  return d.via ? `${d.name} · ${d.via}` : d.name;
}

/** 이 타일 주소의 사람 이름과 엔진. 못 찾으면 `null` */
export async function queryConnLabel(q: QuerySpec): Promise<{ name: string; engine: DbEngine } | null> {
  await ensureDbConns();
  const d = findDbConn(q.connId);
  return d ? { name: dbConnTabName(d), engine: d.engine } : null;
}

// ---------------------------------------------------------------------------
// 연결 열기 — 볼트 관문 · 경유 SSH 관문 · DB 접속 모달 · 인증 뒤 저장 (7단계 — 흐름은 `$lib/query/open-flow`)
// ---------------------------------------------------------------------------

/**
 * 이 타일의 DB 연결을 연다 — 묻고 다시 부르기를 끝까지(던지지 않는다). 같은 `stream` 이면 서버가 다시 붙인다(리로드 뒤 —
 * 그때는 아무것도 묻지 않는다). 서버에 가는 것은 id 하나이고, 경유 호스트(SSH 관문을 누구 이름으로 물을지)는 사본에서 읽는다 —
 * 서버도 같은 파일에서 다시 읽는다.
 */
export async function openDbForTile(stream: string, q: QuerySpec): Promise<DbOpenOutcome> {
  await ensureDbConns();
  const d = findDbConn(q.connId);
  const ref = { id: q.connId };
  const via = d?.via ?? null;
  const who = d ? (d.user && d.database ? `${d.user}@${d.database}` : (d.user ?? d.database ?? "")) : "";
  return openDbFlow({
    reattach: () => dbOpen(stream, ref, undefined, undefined, true),
    open: (password, ssh) => dbOpen(stream, ref, password, ssh),
    via,
    gates: { confirm: confirmHostKey, promptPassword, promptPassphrase },
    askPassword: promptPassword,
    target: { id: q.connId, name: d?.name ?? q.name ?? q.connId, who, via },
    ensureUnlocked: ensureVaultUnlocked,
    flushSaves: () => void flushVaultSaves(),
    dropSaves: dropVaultSaves,
    tr: t,
  });
}

// ---------------------------------------------------------------------------
// 타일 명세 손잡이 — 패널 자신이 들고 있어야 저장 · 이관 · 복제가 따라온다(`noteDocMode` 와 같은 규칙)
// ---------------------------------------------------------------------------

function paneById(paneId: string): PaneSpec | null {
  for (const tab of residentWindowTabs()) {
    const p = findPane(tab.root, paneId);
    if (p) return p;
  }
  return null;
}

/**
 * 이 타일의 DB 연결 열쇠(`query:<tileKey>`) — 영속 키가 아직 없으면(방금 연 타일) 지금 단다. 리로드 · 재시작 뒤에도 같은
 * 키로 복원되므로 세션 서버의 DB 연결 표가 같은 연결에 다시 붙인다.
 */
export function queryStreamOf(pane: PaneSpec): string {
  const live = paneById(pane.id) ?? pane;
  if (!live.tileKey) live.tileKey = newTileKey();
  return `query:${live.tileKey}`;
}

/**
 * 스크립트 탭과 초안(10-14) — 모양은 `canonQueryTabs` 가 고른다(탭 하나 · 이름 없음이면 예전처럼 `sql` 하나 · 상한을 넘거나 빈 초안은
 * 싣지 않는다). 같은 모양이면 쓰지 않는다(저장 디바운스가 헛돌지 않게).
 */
export function noteQueryTabs(paneId: string, scripts: QueryScript[], active: number): void {
  const p = paneById(paneId);
  if (!p?.query) return;
  const tabs = canonQueryTabs({ scripts, active });
  const before = canonQueryTabs(p.query);
  if (JSON.stringify(tabs) === JSON.stringify(before)) return;
  const q: QuerySpec = { connId: p.query.connId };
  if (tabs.sql !== undefined) q.sql = tabs.sql;
  if (p.query.maxRows !== undefined) q.maxRows = p.query.maxRows;
  if (tabs.scripts) {
    q.scripts = tabs.scripts;
    q.active = tabs.active;
  }
  if (p.query.name) q.name = p.query.name;
  p.query = q;
}

/** 결과 칸 아래 줄에서 고른 행 상한 — 기본값이면 칸을 지운다(배치 파일에 적지 않는다). 같은 값이면 쓰지 않는다 */
export function noteQueryMaxRows(paneId: string, rows: QueryRowLimit): void {
  const p = paneById(paneId);
  if (!p?.query) return;
  const next = storedRowLimit(rows);
  if (p.query.maxRows === next) return;
  const q: QuerySpec = { ...p.query };
  if (next === undefined) delete q.maxRows;
  else q.maxRows = next;
  p.query = q;
}

/** 화면용 사본(머리줄 이름) — 저장하지 않는 칸이라 배치 파일은 바뀌지 않는다 */
export function noteQueryName(paneId: string, name: string): void {
  const p = paneById(paneId);
  if (!p?.query || p.query.name === name) return;
  p.query = { ...p.query, name };
}

// ---------------------------------------------------------------------------
// 여는 길
// ---------------------------------------------------------------------------

/** 지금 탭에 쿼리 타일 하나 */
export function openQueryTile(connId: string, name?: string): void {
  openPaneHere(newQueryPane({ connId, name }));
}

/** 쿼리 타일 하나만 든 **새 탭** — 폰의 둘러보기 화면 [쿼리 열기](폰은 타일 하나만 그려서 분할로 끼우지 않는다) */
export function openQueryTileInNewTab(connId: string, name?: string): void {
  openInNewTab(newQueryPane({ connId, name }));
}

/** 호스트 우클릭 "DB 열기 ›" 의 한 줄 — 그 호스트를 경유하는 연결 하나 */
export function openHostDb(host: HostEntry, connId: string): void {
  const d = findDbConn(connId);
  openQueryTile(connId, d ? dbConnTabName({ name: d.name, via: host.name }) : undefined);
}

/** 호스트 우클릭 "DB 연결 추가…" — 경유를 그 호스트로 미리 고른 폼 */
export function addHostDb(host: HostEntry): void {
  void openConnForm({ via: host.name });
}

// ---------------------------------------------------------------------------
// DB 연결 고르기 모달 · 폼
// ---------------------------------------------------------------------------

/** 경유 칸 · 목록 묶음이 그릴 호스트 하나(호스트 칸과 같은 아이콘 · 색) */
export interface PickerHost {
  name: string;
  icon: string | null;
  color: string | null;
}

export const dbPicker = $state<{
  open: boolean;
  view: "list" | "form";
  loading: boolean;
  /** `~/.ssh/config` 의 호스트들 — 경유 칸의 후보 · 목록 묶음의 아이콘 */
  hosts: PickerHost[];
  error: string | null;
  /** 폼 — 새로 만들기면 `isNew` */
  form: ConnRow;
  isNew: boolean;
  /** 폼만 열었다(독의 DB 칸 · 호스트 우클릭) — 목록 화면이 없으므로 저장 · 취소 · Escape 가 모달을 닫는다 */
  formOnly: boolean;
  formError: string | null;
  busy: boolean;
  /**
   * **AI 권한 칸**(쿼리 타일 3a) — 고른 단계 · 사람이 만졌나 · 편집을 시작할 때의 연결(대상이 바뀌었는지 보려고 — 새 연결이면 `null`).
   * 저장은 연결 저장이 선 뒤 `delegation.toml` 에(`db_ai_set` — 스냅샷은 Rust 가 계산).
   */
  ai: DbAiLevel;
  aiTouched: boolean;
  aiOrig: DbConn | null;
  /** **헤드리스**(2026-11-09) — 타일 없이 AI 접속(볼트의 비밀번호). 단계와 같은 규칙(대상이 바뀌고 안 만졌으면 끔 · 같은 저장) */
  headless: boolean;
  headlessTouched: boolean;
}>({
  open: false,
  view: "list",
  loading: false,
  hosts: [],
  error: null,
  form: emptyConnRow("placeholder00"),
  isNew: true,
  formOnly: false,
  formError: null,
  busy: false,
  ai: "off",
  aiTouched: false,
  aiOrig: null,
  headless: false,
  headlessTouched: false,
});

/** 폼의 AI 칸을 그 연결의 지금 값으로(새 연결이면 끔) — 사본을 다시 읽은 뒤 한 번 더 맞춘다(만지기 전일 때만) */
function resetFormAi(orig: DbConn | null): void {
  dbPicker.aiOrig = orig;
  dbPicker.aiTouched = false;
  dbPicker.ai = orig ? dbAiLevelOf(orig.id) : "off";
  dbPicker.headlessTouched = false;
  dbPicker.headless = orig ? dbAiHeadlessOf(orig.id) : false;
  void refreshDbAi().then(() => {
    if (!dbPicker.aiTouched && dbPicker.aiOrig === orig) dbPicker.ai = orig ? dbAiLevelOf(orig.id) : "off";
    if (!dbPicker.headlessTouched && dbPicker.aiOrig === orig) dbPicker.headless = orig ? dbAiHeadlessOf(orig.id) : false;
  });
}

/** 편집 중 연결의 **대상**(엔진 · 경유 · 주소 · 포트 · DB · 사용자 · 파일)이 바뀌었나 — 바뀌면 옛 권한은 풀린다 */
export function connTargetChanged(): boolean {
  const orig = dbPicker.aiOrig;
  if (!orig) return false;
  const r = connOfRow(dbPicker.form);
  return r.ok && !sameDbTarget(orig, r.conn);
}

/** 폼에 보일(그리고 저장할) AI 단계 — 대상이 바뀌었고 만지지 않았으면 끔 */
export function connAiShown(): DbAiLevel {
  return formAiLevel(dbPicker.ai, dbPicker.aiTouched, connTargetChanged());
}

/** 폼에 보일(그리고 저장할) 헤드리스 — 대상이 바뀌었고 만지지 않았으면 끔 */
export function connHeadlessShown(): boolean {
  return formDbHeadless(dbPicker.headless, dbPicker.headlessTouched, connTargetChanged());
}

export function setConnHeadless(on: boolean): void {
  dbPicker.headless = on;
  dbPicker.headlessTouched = true;
}

/** 이 연결의 블록이 있는데 스냅샷이 어긋나 풀려 있다(편집 전부터) */
export function connAiBroken(): boolean {
  const orig = dbPicker.aiOrig;
  if (!orig) return false;
  const v = dbAiViewOf(orig.id);
  return v !== null && !v.identityOk;
}

export async function setConnAi(level: DbAiLevel): Promise<void> {
  // 모두 승인으로 새로 올리면 확인 상자가 먼저 선다(10-23 — [취소]면 그대로).
  if (dbAiNeedsConfirm(connAiShown(), level) && !(await confirmApproveAll("db", dbPicker.form.name.trim() || "?"))) return;
  dbPicker.ai = level;
  dbPicker.aiTouched = true;
}

/** 모달이 보는 연결 목록 · 읽기 경고(사본 그대로) */
export { dbConns as pickerConns, dbConnWarnings as pickerWarnings } from "$lib/app/db-conns.svelte.js";

export function dbPickerVisible(): boolean {
  return dbPicker.open;
}

/** 호스트 목록을 읽어 경유 칸 후보로 — 실패하면 빈 목록(직접만 고를 수 있다) */
async function loadPickerHosts(): Promise<void> {
  try {
    const cfg = await loadHosts(t);
    dbPicker.hosts = cfg.hosts
      .map((h) => {
        const m = hostMeta(h);
        return { name: h.name, icon: m.icon ?? null, color: m.color ?? null };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    dbPicker.hosts = [];
  }
}

/** 모달을 연다 — 호스트 목록 · 연결 목록을 새로 읽는다 */
export async function openDbPicker(): Promise<void> {
  dbPicker.open = true;
  dbPicker.formOnly = false;
  dbPicker.view = "list";
  dbPicker.error = null;
  dbPicker.loading = true;
  try {
    await Promise.all([loadPickerHosts(), reloadDbConns()]);
  } finally {
    dbPicker.loading = false;
  }
}

export function closeDbPicker(): void {
  if (dbPicker.busy) return;
  // 도는 [연결 테스트] 는 버린다 — 닫힌 폼 위로 비밀번호 창이 뜨지 않게.
  clearConnTest();
  dbPicker.open = false;
  dbPicker.view = "list";
  dbPicker.formError = null;
}

/** Escape — 폼이면 목록으로(폼만 열었으면 닫기), 목록이면 닫기 */
export function escapeDbPicker(): void {
  if (dbPicker.view === "form" && !dbPicker.busy && !dbPicker.formOnly) {
    clearConnTest();
    dbPicker.view = "list";
    dbPicker.formError = null;
    return;
  }
  closeDbPicker();
}

/** 한 줄 고르기 → 모달을 닫고 지금 탭에 타일 */
export function pickDb(d: DbConn): void {
  closeDbPicker();
  openQueryTile(d.id, dbConnTabName(d));
}

export function startNewConn(): void {
  clearConnTest();
  dbPicker.form = emptyConnRow();
  resetFormAi(null);
  dbPicker.isNew = true;
  dbPicker.formError = null;
  dbPicker.view = "form";
}

export function startEditConn(id: string): void {
  const d = findDbConn(id);
  if (!d) return;
  clearConnTest();
  dbPicker.form = connRowOf(d);
  resetFormAi(d);
  dbPicker.isNew = false;
  dbPicker.formError = null;
  dbPicker.view = "form";
}

/** 폼의 [목록으로] · [취소] — 폼만 열었으면 닫는다 */
export function leaveConnForm(): void {
  if (dbPicker.busy) return;
  if (dbPicker.formOnly) {
    closeDbPicker();
    return;
  }
  clearConnTest();
  dbPicker.view = "list";
  dbPicker.formError = null;
}

/**
 * **폼만 연다** — 독의 DB 칸의 [새 DB 연결] · 편집(`id`) · 호스트 우클릭 "DB 연결 추가…"(`via` — 경유를 그 호스트로 미리 고른다).
 * 고르기 목록과 **같은 모달 · 같은 폼 · 같은 저장**이다(`submitConn`). 목록을 거치지 않으므로 저장 · 취소 · Escape 가 곧 닫기다
 * (`formOnly`). 편집할 줄이 사라졌으면 열지 않는다.
 */
export async function openConnForm(opts: { id?: string; via?: string; folder?: string } = {}): Promise<void> {
  await Promise.all([ensureDbConns(), loadPickerHosts()]);
  const d = opts.id === undefined ? null : findDbConn(opts.id);
  if (opts.id !== undefined && !d) return;
  clearConnTest();
  dbPicker.form = d ? connRowOf(d) : emptyConnRow(undefined, opts.via ?? null, opts.folder ?? "");
  resetFormAi(d);
  dbPicker.isNew = !d;
  dbPicker.formOnly = true;
  dbPicker.formError = null;
  dbPicker.error = null;
  dbPicker.view = "form";
  dbPicker.open = true;
}

export function setConnEngine(engine: DbEngine): void {
  dbPicker.form = withConnEngine(dbPicker.form, engine);
}

export function setConnVia(via: string | null): void {
  dbPicker.form = withConnVia(dbPicker.form, via);
}

// ---------------------------------------------------------------------------
// [연결 테스트] — 폼 바닥 줄 왼쪽 단추 + 그 옆 칩(규칙은 `$lib/query/conn-test`)
// ---------------------------------------------------------------------------

/** 칩 하나의 상태(모듈 상태라 객체 한 칸에 둔다 — 필드 대입이 반응한다) */
export const connTestUi = $state<{ state: ConnTestState }>({ state: idleConnTest() });

/** 칩을 지운다 — 폼을 새로 열 때 · [취소] · 칸 바꾸기. 도는 시도의 답은 회차가 버린다 */
export function clearConnTest(): void {
  connTestUi.state = resetConnTest(connTestUi.state);
}

/** 폼 칸이 바뀌었을 때(그리는 쪽의 `$effect` 가 부른다) — 칩이 있으면 지운다 */
export function noteConnFormChanged(): void {
  const next = onConnFormChange(connTestUi.state, connFormKey(dbPicker.form));
  if (next !== connTestUi.state) connTestUi.state = next;
}

/** [취소] — 화면에서만 버린다(서버의 시도는 제 시한에 스스로 끝난다) · [저장] 은 그대로 쓸 수 있다 */
export function cancelConnTest(): void {
  clearConnTest();
}

/**
 * **[연결 테스트]** — 폼 값을 저장과 같은 꼴(`connOfRow`)로 만들어 한 번 붙어 본다. 폼이 틀렸으면 저장과 같은 문구를 보이고 서버에
 * 가지 않는다. 비밀번호는 서버가 청할 때만 묻고(타일과 같은 모달 — 저장 칸 없음) 볼트에 담지 않는다. 늦게 온 답 · 회차가 바뀐 뒤의
 * 물음은 버린다(묻는 창도 띄우지 않는다).
 */
export async function startConnTest(): Promise<void> {
  if (connTestUi.state.phase.kind === "running") return;
  const r = connOfRow(dbPicker.form);
  if (!r.ok) {
    // 테스트의 결과는 칩 하나로만 — 폼 안 빨간 줄(`formError`)은 [저장] 의 것이다.
    connTestUi.state = invalidConnTest(connTestUi.state, connFormKey(dbPicker.form), connProblemText(r.problem));
    return;
  }
  dbPicker.formError = null;
  const draft = r.conn;
  connTestUi.state = beginConnTest(connTestUi.state, connFormKey(dbPicker.form), Date.now());
  const gen = connTestUi.state.gen;
  const live = () => connTestUi.state.gen === gen;
  const stream = newConnTestStream();
  const via = draft.via ?? null;
  const who = draft.user && draft.database ? `${draft.user}@${draft.database}` : (draft.user ?? draft.database ?? "");
  const out = await openDbFlow<DbTested>({
    open: (password, ssh) => dbTest(stream, draft, password, ssh),
    via,
    // 경유 SSH 관문은 타일과 같다 — 저장 칸만 숨기고, 버려진 회차에는 묻지 않는다(취소로 끝난다).
    gates: {
      confirm: (p) => (live() ? confirmHostKey(p) : Promise.resolve("reject" as const)),
      promptPassword: (p) => (live() ? promptPassword({ ...p, noSave: true }) : Promise.resolve(null)),
      promptPassphrase: (p) => (live() ? promptPassphrase({ ...p, noSave: true }) : Promise.resolve(null)),
    },
    askPassword: (p) => (live() ? promptPassword(p) : Promise.resolve(null)),
    noSave: true,
    target: { id: draft.id, name: draft.name, who, via },
    // 볼트를 쓸 수 있는 테스트(저장된 연결 · 대상 그대로)만 잠긴 볼트를 열어 달라고 한다 — 판단의 진실은 서버다.
    ensureUnlocked: () => (connTestMayUseVault(dbPicker.aiOrig, draft) ? ensureVaultUnlocked() : Promise.resolve()),
    // 테스트는 볼트에 아무것도 담지 않는다(저장 칸이 없어 적어 둔 값도 없다).
    flushSaves: () => {},
    dropSaves: () => {},
    tr: t,
  });
  const phase = out.ok
    ? ({ kind: "ok", result: out.opened } as const)
    : out.kind === "cancelled"
      ? ({ kind: "cancelled" } as const)
      : ({ kind: "error", reason: connTestReason(out.raw ?? out.message), message: out.message } as const);
  connTestUi.state = finishConnTest(connTestUi.state, gen, phase);
}

/** 폼 갈래 → 문구 */
export function connProblemText(p: ConnRowProblem): string {
  switch (p) {
    case "id":
      return t("app.query.local.error.id");
    case "name":
      return t("app.query.local.error.name");
    case "name-long":
      return t("app.query.local.error.namelong", { max: DB_NAME_MAX });
    case "path":
      return t("app.query.local.error.path");
    case "path-relative":
      return t("app.query.local.error.pathrelative");
    case "host":
      return t("app.query.local.error.host");
    case "port":
      return t("app.query.local.error.port");
    case "duplicate":
      return t("app.query.local.error.duplicate");
    case "ca-required":
      return t("app.query.local.error.ca");
  }
}

/** 폼 저장 — 목록 통째로 쓴다(서버 검증이 단일 진실 — 그 문구는 그대로 보인다) */
export async function submitConn(ev?: Event): Promise<void> {
  ev?.preventDefault();
  if (dbPicker.busy) return;
  const r = upsertConn(dbConns(), dbPicker.form);
  if (!r.ok) {
    dbPicker.formError = connProblemText(r.problem);
    return;
  }
  dbPicker.busy = true;
  dbPicker.formError = null;
  // AI 권한(쿼리 타일 3a) — 연결 저장이 선 **뒤에** 적는다(스냅샷은 Rust 가 저장된 줄에서 계산한다).
  const id = dbPicker.form.id;
  const view = dbAiViewOf(id);
  // 헤드리스는 엔진 무관(SQLite 도 — 2026-11-09 · 타일 없이 AI 가 여는 것은 위임).
  const storedHeadless = dbAiHeadlessOf(id);
  const aiWrite = dbAiFormWrite({
    level: connAiShown(),
    stored: dbAiLevelOf(id),
    blockExists: view !== null,
    broken: view !== null && !view.identityOk,
    targetChanged: connTargetChanged(),
    headless: connHeadlessShown(),
    storedHeadless,
  });
  try {
    await saveDbConns(r.list);
    if (aiWrite !== null) {
      try {
        await setDbAi(id, aiWrite.level, aiWrite.headless);
      } finally {
        await refreshDbAi();
      }
    }
    dbPicker.view = "list";
  } catch (e) {
    dbPicker.formError = stripReason(errorMessage(e));
  } finally {
    dbPicker.busy = false;
  }
  if (dbPicker.view === "list" && dbPicker.formOnly) closeDbPicker();
}

/**
 * **연결 하나를 지운다 — 확인 상자 뒤**(독의 호스트 · 프로젝트 삭제와 같은 `askConfirm`. 대화를 못 띄우면 지우지 않는다). 저장이 선
 * 뒤에 볼트의 그 비밀번호도 걷는다(`removeDbConn` — 열려 있을 때만). 고르기 모달 · 독의 DB 칸이 함께 쓴다. 지웠으면 `true`.
 * 실패는 알림 한 줄(던지지 않는다).
 */
export async function confirmRemoveDbConn(d: Pick<DbConn, "id" | "name">): Promise<boolean> {
  let go = false;
  try {
    go = await askConfirm(t("app.query.picker.delete.confirm", { name: d.name }), {
      title: t("app.query.picker.delete.title"),
      kind: "warning",
      okLabel: t("app.query.picker.delete.submit"),
      cancelLabel: t("app.actions.cancel"),
      danger: true,
    });
  } catch {
    showNotice(t("app.hosts.remove.noDialog"));
    return false;
  }
  if (!go) return false;
  try {
    await removeDbConn(d.id);
    return true;
  } catch (e) {
    showNotice(stripReason(errorMessage(e)));
    return false;
  }
}

/** 모달 목록의 [지우기] — 확인 대화 뒤 */
export async function deleteConn(id: string): Promise<void> {
  const d = findDbConn(id);
  if (!d || dbPicker.busy) return;
  dbPicker.busy = true;
  dbPicker.error = null;
  try {
    await confirmRemoveDbConn(d);
  } finally {
    dbPicker.busy = false;
  }
}

// ---------------------------------------------------------------------------
// 쓰기 켜기 확인 대화 (10단계 — 알약의 규칙은 `$lib/query/write-toggle`, 그리는 곳은 `dialogs/DbWriteDialog.svelte`)
// ---------------------------------------------------------------------------

/** 확인 대화의 상태 — 한 번에 하나(모달). 답은 `resolve` 하나로 돌아간다 */
export const dbWriteConfirm = $state<{ open: boolean; target: string }>({ open: false, target: "" });
let writeResolve: ((ok: boolean) => void) | null = null;

export function dbWriteConfirmVisible(): boolean {
  return dbWriteConfirm.open;
}

/** 확인 대화가 보일 대상 — "연결 이름 · 경유 호스트"(SSH 경유) · "이름 · DB 주소"(직접) · "이름 · 파일"(SQLite). 못 찾으면 타일 이름 */
async function writeTarget(q: QuerySpec): Promise<string> {
  await ensureDbConns();
  const d = findDbConn(q.connId);
  if (!d) return q.name ?? q.connId;
  const where = d.via ?? (d.engine === "sqlite" ? d.path : d.host);
  return where ? `${d.name} · ${where}` : d.name;
}

/** "쓰기를 켤까요?" — 사람이 [쓰기 켜기]를 누르면 `true`. 이미 떠 있으면 앞의 물음은 물러선 것으로 닫는다 */
export async function askDbWrite(q: QuerySpec): Promise<boolean> {
  const target = await writeTarget(q);
  writeResolve?.(false);
  dbWriteConfirm.target = target;
  dbWriteConfirm.open = true;
  return new Promise<boolean>((resolve) => (writeResolve = resolve));
}

/** 답하고 닫는다 — Escape · 바깥 누르기 · [취소] 는 `false` */
export function closeDbWriteConfirm(ok = false): void {
  dbWriteConfirm.open = false;
  const r = writeResolve;
  writeResolve = null;
  r?.(ok);
}
