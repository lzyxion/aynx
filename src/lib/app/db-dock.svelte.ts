// 독의 DB 칸 — 상태와 동작. 볼트에서는 비밀번호가 있는 연결 id(대상)만 쥔다 — 값이 아니다.
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import * as vault from "$lib/vault";
import { stripReason } from "$lib/error-reason";
import { currentWorkspaceId } from "$lib/app/workspaces.svelte.js";
import { openPaneLocations, revealProjectLocation } from "$lib/app/project-locations.svelte.js";
import { dbConns, forgetDbFavorites, forgetDbPasswords, onDbPasswordsChanged, reloadDbConns, saveDbConns } from "$lib/app/db-conns.svelte.js";
import { dbDragEmpty, removeDbItems, type DbDockDrag } from "$lib/db-folders";
import { showNotice } from "$lib/app/notice";
import { errorMessage } from "$lib/query/query-backend";
import { duplicateConnIn, newDbId } from "$lib/db-conn";
import { confirmRemoveDbConn, openConnForm, openQueryTile } from "$lib/app/query.svelte.js";
import { dbConnLocations, dbFocusTarget, queryPlace, type DbDockConn, type DbOpenLocation } from "$lib/db-dock";
import { reloadDbFolders, removeDbSelectionNow } from "$lib/app/db-folders.svelte.js";

export { dbConns as dbDockConnList, dbConnWarnings as dbDockWarnings } from "$lib/app/db-conns.svelte.js";

export function dbOpenLocations(): DbOpenLocation[] {
  const { live, saved } = openPaneLocations(queryPlace);
  return [...live, ...saved];
}

// ── 볼트 ──

let savedIds = $state<ReadonlySet<string>>(new Set());

/** 잠겼거나 볼트가 없으면 모른다 = 없음 */
export function dbPasswordSaved(id: string): boolean {
  return savedIds.has(id);
}

export async function refreshDbDockSaved(): Promise<void> {
  const items = await vault.list().catch(() => []);
  savedIds = new Set(items.filter((i) => i.kind === "db_password").map((i) => i.target));
}

// 연결 폼은 이 모듈을 부르지 못한다(이 모듈이 `app/query` 를 부른다) — 그래서 알림으로 받는다
onDbPasswordsChanged(() => void refreshDbDockSaved());

export function refreshDbDock(): void {
  void reloadDbConns();
  void reloadDbFolders();
  void refreshDbDockSaved();
}

// ── 동작 ──

export async function openDbConn(c: DbDockConn): Promise<void> {
  const here = dbFocusTarget(dbConnLocations(dbOpenLocations(), c.id), currentWorkspaceId());
  if (here) {
    await revealProjectLocation(here);
    return;
  }
  openQueryTile(c.id, c.tabName);
}

export function openDbConnNew(c: DbDockConn): void {
  openQueryTile(c.id, c.tabName);
}

export async function editDbConn(c: DbDockConn): Promise<void> {
  await openConnForm({ id: c.id });
}

/** 볼트 비밀번호는 옮기지 않는다 — 값은 세션 서버 밖으로 나오지 않고 옮기는 op 도 없다 */
export async function duplicateDbConn(c: DbDockConn): Promise<void> {
  try {
    const r = duplicateConnIn(dbConns(), c.id, newDbId());
    if (!r) {
      showNotice(t("app.db.dock.duplicate.missing", { name: c.name }));
      return;
    }
    await saveDbConns(r.list);
    const key = savedIds.has(c.id) ? "app.db.dock.duplicate.donePassword" : "app.db.dock.duplicate.done";
    showNotice(t(key, { name: c.name, copy: r.copy.name }));
  } catch (e) {
    showNotice(t("app.db.dock.duplicate.fail", { message: stripReason(errorMessage(e)) }));
  }
}

export async function forgetDbConnPassword(c: DbDockConn): Promise<void> {
  try {
    await vault.remove("db_password", c.id);
  } catch (e) {
    toast.error(stripReason(e instanceof Error ? e.message : String(e)));
  }
  await refreshDbDockSaved();
}

export async function deleteDbConn(c: Pick<DbDockConn, "id" | "name">): Promise<boolean> {
  const gone = await confirmRemoveDbConn(c);
  if (gone) await refreshDbDockSaved();
  return gone;
}

/** 확인 대화를 못 띄우면 지우지 않는다 · AI 권한 블록은 Rust `db_conn_save` 가 목록에서 빠진 id 의 것을 걷는다 */
export async function deleteDbSelection(drag: DbDockDrag): Promise<boolean> {
  if (dbDragEmpty(drag)) return false;
  const list = dbConns();
  if (drag.folders.length === 0 && drag.conns.length === 1) {
    const c = list.find((d) => d.id === drag.conns[0]);
    return c ? deleteDbConn({ id: c.id, name: c.name }) : false;
  }
  const n = removeDbItems(list, {}, drag).removed.length;
  const parts: string[] = [];
  if (drag.folders.length > 0) parts.push(t("app.hosts.remove.what.groups", { count: drag.folders.length }));
  if (drag.conns.length > 0) parts.push(t("app.db.dock.remove.what.conns", { count: drag.conns.length }));
  const tail = n === 0 ? t("app.db.dock.remove.tail.foldersOnly") : t("app.db.dock.remove.tail.conns", { count: n });
  let go = false;
  try {
    go = await askConfirm(t("app.db.dock.remove.confirm", { what: parts.join(" · "), tail }), {
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
  const removed = await removeDbSelectionNow(drag);
  if (removed === null) return false;
  forgetDbFavorites(removed);
  await forgetDbPasswords(removed);
  await refreshDbDockSaved();
  return true;
}

export function newDbConn(): void {
  void openConnForm();
}

export function newDbConnIn(folder: string): void {
  void openConnForm({ folder });
}

export function dbEngineLabel(engine: DbDockConn["engine"]): string {
  return t(`app.query.engine.${engine}`);
}
