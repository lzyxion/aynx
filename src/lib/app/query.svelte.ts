// 쿼리 타일의 여는 길 · DB 연결 고르기 모달 · DB 연결 폼의 상태(docs/log/2026-10-12-query-tile.md).
// 같은 연결의 타일이 이미 있어도 새로 연다 — 쿼리 타일은 연결을 하나씩 따로 쥔다.
// [연결 테스트]는 볼트에 아무것도 담지 않는다 — 볼트 비밀번호로 물러날지는 서버가 정한다(저장된 줄과 대상이 같을 때만).
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
import * as vault from "$lib/vault";
import { dbConns, dbPasswordsChanged, ensureDbConns, findDbConn, reloadDbConns, removeDbConn, saveDbConns } from "$lib/app/db-conns.svelte.js";
import {
  confirmHostKey,
  dropVaultSaves,
  ensureVaultUnlocked,
  flushVaultSaves,
  promptPassphrase,
  promptPassword,
  refreshVaultUi,
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

// ── 연결 찾기 ──

export function dbConnTabName(d: Pick<DbConn, "name" | "via">): string {
  return d.via ? `${d.name} · ${d.via}` : d.name;
}

export async function queryConnLabel(q: QuerySpec): Promise<{ name: string; engine: DbEngine } | null> {
  await ensureDbConns();
  const d = findDbConn(q.connId);
  return d ? { name: dbConnTabName(d), engine: d.engine } : null;
}

// ── 연결 열기 ──

/** 서버에 가는 것은 id 하나다 — 서버가 같은 파일에서 연결을 다시 읽는다 */
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

// ── 타일 명세 손잡이 — 잎 명세에 들어야 저장 · 이관 · 복제가 따라온다 ──

function paneById(paneId: string): PaneSpec | null {
  for (const tab of residentWindowTabs()) {
    const p = findPane(tab.root, paneId);
    if (p) return p;
  }
  return null;
}

/** 머리 `query:` 는 Rust `reap.rs` 와 같은 글자 — 영속 `tileKey` 라 리로드 · 재시작 뒤에도 같은 연결에 다시 붙는다 */
export function queryStreamOf(pane: PaneSpec): string {
  const live = paneById(pane.id) ?? pane;
  if (!live.tileKey) live.tileKey = newTileKey();
  return `query:${live.tileKey}`;
}

/** 같은 모양이면 쓰지 않는다 — 저장 디바운스가 헛돌지 않게 */
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

/** 저장하지 않는 칸이다 */
export function noteQueryName(paneId: string, name: string): void {
  const p = paneById(paneId);
  if (!p?.query || p.query.name === name) return;
  p.query = { ...p.query, name };
}

// ── 여는 길 ──

export function openQueryTile(connId: string, name?: string): void {
  openPaneHere(newQueryPane({ connId, name }));
}

/** 폰은 타일 하나만 그려서 분할로 끼우지 않는다 */
export function openQueryTileInNewTab(connId: string, name?: string): void {
  openInNewTab(newQueryPane({ connId, name }));
}

export function openHostDb(host: HostEntry, connId: string): void {
  const d = findDbConn(connId);
  openQueryTile(connId, d ? dbConnTabName({ name: d.name, via: host.name }) : undefined);
}

export function addHostDb(host: HostEntry): void {
  void openConnForm({ via: host.name });
}

// ── DB 연결 고르기 모달 · 폼 ──

export interface PickerHost {
  name: string;
  icon: string | null;
  color: string | null;
}

export const dbPicker = $state<{
  open: boolean;
  view: "list" | "form";
  loading: boolean;
  hosts: PickerHost[];
  error: string | null;
  form: ConnRow;
  isNew: boolean;
  /** 목록 화면이 없으므로 저장 · 취소 · Escape 가 모달을 닫는다 */
  formOnly: boolean;
  formError: string | null;
  busy: boolean;
  /** AI 권한 저장은 연결 저장이 선 뒤다 — 스냅샷은 Rust 가 저장된 줄에서 계산한다 */
  ai: DbAiLevel;
  aiTouched: boolean;
  /** 편집을 시작할 때의 연결 — 대상이 바뀌었는지 본다(새 연결이면 `null`) */
  aiOrig: DbConn | null;
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

/**
 * 폼의 비밀번호 칸 — 친 값은 이 상태와 서버로 가는 한 번의 호출에만 살고 폼을 열고 닫을 때 비운다.
 * 볼트의 값은 받지 않는다 — `stored` 는 있다 · 없다만(잠겨 있으면 모름 = `false`).
 */
export const connPw = $state<{ text: string; save: boolean; stored: boolean }>({
  text: "",
  save: true,
  stored: false,
});

function resetFormPw(orig: DbConn | null): void {
  connPw.text = "";
  connPw.save = true;
  connPw.stored = false;
  if (orig)
    void vault.hasDbPassword(orig.id).then((has) => {
      if (dbPicker.aiOrig === orig) connPw.stored = has;
    });
}

export function setConnPassword(v: string): void {
  connPw.text = v;
  clearConnTest();
}

/** 체크 + 친 값은 인증 확인 없이 볼트에 담는다(사용자 결정 — 틀리면 접속 모달이 다시 묻는다) · 체크 끔은 지운다 */
async function applyFormPassword(id: string, sqlite: boolean): Promise<void> {
  const text = connPw.text;
  connPw.text = "";
  if (sqlite) return;
  const put = connPw.save && text !== "";
  if (!put && connPw.save) return;
  try {
    const st = await vault.status();
    if (put) {
      if (st.state === "absent") await vault.create(null);
      else await ensureVaultUnlocked();
      await vault.storeDbPassword(id, text);
    } else {
      // 잠긴 볼트는 있는지 모르니 열고 지운다(지우기는 멱등)
      if (st.state === "absent" || (st.state === "unlocked" && !connPw.stored)) return;
      await ensureVaultUnlocked();
      await vault.remove("db_password", id);
    }
    refreshVaultUi();
    dbPasswordsChanged();
  } catch (e) {
    // 담기 실패만 알린다 — 지우기 실패는 잠긴 볼트를 건너뛴 경우뿐이다
    if (put) showNotice(t("app.query.form.password.notSaved", { why: stripReason(errorMessage(e)) }));
  }
}

function resetFormAi(orig: DbConn | null): void {
  resetFormPw(orig);
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

/** 대상이 바뀌면 옛 권한은 풀린다 */
export function connTargetChanged(): boolean {
  const orig = dbPicker.aiOrig;
  if (!orig) return false;
  const r = connOfRow(dbPicker.form);
  return r.ok && !sameDbTarget(orig, r.conn);
}

/** 보일 값이 곧 저장할 값이다 — 대상이 바뀌었고 만지지 않았으면 끔 */
export function connAiShown(): DbAiLevel {
  return formAiLevel(dbPicker.ai, dbPicker.aiTouched, connTargetChanged());
}

/** 보일 값이 곧 저장할 값이다 — 대상이 바뀌었고 만지지 않았으면 끔 */
export function connHeadlessShown(): boolean {
  return formDbHeadless(dbPicker.headless, dbPicker.headlessTouched, connTargetChanged());
}

export function setConnHeadless(on: boolean): void {
  dbPicker.headless = on;
  dbPicker.headlessTouched = true;
}

export function connAiBroken(): boolean {
  const orig = dbPicker.aiOrig;
  if (!orig) return false;
  const v = dbAiViewOf(orig.id);
  return v !== null && !v.identityOk;
}

export async function setConnAi(level: DbAiLevel): Promise<void> {
  if (dbAiNeedsConfirm(connAiShown(), level) && !(await confirmApproveAll("db", dbPicker.form.name.trim() || "?"))) return;
  dbPicker.ai = level;
  dbPicker.aiTouched = true;
}

export { dbConns as pickerConns, dbConnWarnings as pickerWarnings } from "$lib/app/db-conns.svelte.js";

export function dbPickerVisible(): boolean {
  return dbPicker.open;
}

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
  // 도는 [연결 테스트] 는 버린다 — 닫힌 폼 위로 비밀번호 창이 뜨지 않게
  clearConnTest();
  connPw.text = "";
  dbPicker.open = false;
  dbPicker.view = "list";
  dbPicker.formError = null;
}

export function escapeDbPicker(): void {
  if (dbPicker.view === "form" && !dbPicker.busy && !dbPicker.formOnly) {
    clearConnTest();
    dbPicker.view = "list";
    dbPicker.formError = null;
    return;
  }
  closeDbPicker();
}

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

// ── [연결 테스트] ──

export const connTestUi = $state<{ state: ConnTestState }>({ state: idleConnTest() });

/** 도는 시도의 답은 회차가 버린다 */
export function clearConnTest(): void {
  connTestUi.state = resetConnTest(connTestUi.state);
}

export function noteConnFormChanged(): void {
  const next = onConnFormChange(connTestUi.state, connFormKey(dbPicker.form));
  if (next !== connTestUi.state) connTestUi.state = next;
}

/** 화면에서만 버린다 — 서버의 시도는 제 시한에 스스로 끝난다 */
export function cancelConnTest(): void {
  clearConnTest();
}

/** 회차가 바뀐 뒤의 물음은 버린다 — 묻는 창도 띄우지 않는다 */
export async function startConnTest(): Promise<void> {
  if (connTestUi.state.phase.kind === "running") return;
  const r = connOfRow(dbPicker.form);
  if (!r.ok) {
    // 테스트의 결과는 칩 하나로만 — 폼 안 빨간 줄(`formError`)은 [저장] 의 것이다
    connTestUi.state = invalidConnTest(connTestUi.state, connFormKey(dbPicker.form), connProblemText(r.problem));
    return;
  }
  dbPicker.formError = null;
  const draft = r.conn;
  const typed = draft.engine === "sqlite" ? "" : connPw.text;
  connTestUi.state = beginConnTest(connTestUi.state, connFormKey(dbPicker.form), Date.now());
  const gen = connTestUi.state.gen;
  const live = () => connTestUi.state.gen === gen;
  const stream = newConnTestStream();
  const via = draft.via ?? null;
  const who = draft.user && draft.database ? `${draft.user}@${draft.database}` : (draft.user ?? draft.database ?? "");
  const out = await openDbFlow<DbTested>({
    open: (password, ssh) => dbTest(stream, draft, password, ssh),
    via,
    gates: {
      confirm: (p) => (live() ? confirmHostKey(p) : Promise.resolve("reject" as const)),
      promptPassword: (p) => (live() ? promptPassword({ ...p, noSave: true }) : Promise.resolve(null)),
      promptPassphrase: (p) => (live() ? promptPassphrase({ ...p, noSave: true }) : Promise.resolve(null)),
    },
    askPassword: (p) => (live() ? promptPassword(p) : Promise.resolve(null)),
    noSave: true,
    target: { id: draft.id, name: draft.name, who, via },
    ...(typed !== "" ? { formPassword: typed } : {}),
    // 판단의 진실은 서버다 — 여기는 잠긴 볼트를 열어 달라고 할지만 정한다
    ensureUnlocked: () =>
      typed === "" && connTestMayUseVault(dbPicker.aiOrig, draft) ? ensureVaultUnlocked() : Promise.resolve(),
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

/** 서버 검증이 단일 진실 — 그 문구는 그대로 보인다 */
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
  const id = dbPicker.form.id;
  const view = dbAiViewOf(id);
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
    await applyFormPassword(id, dbPicker.form.engine === "sqlite");
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

/** 확인 대화를 못 띄우면 지우지 않는다 */
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

// ── 쓰기 켜기 확인 대화 ──

export const dbWriteConfirm = $state<{ open: boolean; target: string }>({ open: false, target: "" });
let writeResolve: ((ok: boolean) => void) | null = null;

export function dbWriteConfirmVisible(): boolean {
  return dbWriteConfirm.open;
}

async function writeTarget(q: QuerySpec): Promise<string> {
  await ensureDbConns();
  const d = findDbConn(q.connId);
  if (!d) return q.name ?? q.connId;
  const where = d.via ?? (d.engine === "sqlite" ? d.path : d.host);
  return where ? `${d.name} · ${where}` : d.name;
}

/** 이미 떠 있으면 앞의 물음은 물러선 것(`false`)으로 닫는다 */
export async function askDbWrite(q: QuerySpec): Promise<boolean> {
  const target = await writeTarget(q);
  writeResolve?.(false);
  dbWriteConfirm.target = target;
  dbWriteConfirm.open = true;
  return new Promise<boolean>((resolve) => (writeResolve = resolve));
}

export function closeDbWriteConfirm(ok = false): void {
  dbWriteConfirm.open = false;
  const r = writeResolve;
  writeResolve = null;
  r?.(ok);
}
