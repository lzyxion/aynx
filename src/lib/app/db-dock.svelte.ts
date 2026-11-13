// **독의 DB 칸 — 상태와 동작** (2026-10-12, docs/log/2026-10-12-query-tile.md). 그리는 곳은 `browser/DbList.svelte` ·
// 메뉴는 `browser/DbMenu.svelte`, 줄 묶기 · 검색 · 열린 곳 판정은 순수 `$lib/db-dock`.
//
// 데이터는 연결 목록 하나다 — `db-connections.json`(10-13 저장 하나로 · 사본은 `app/db-conns`, 모달 저장 · 삭제가 같은 사본을
// 고친다). 여기 사는 것은 **볼트에 비밀번호가 있는 연결 id** 하나뿐이다
// (값이 아니라 대상 — `vault.list`). 편집 · 새로 만들기는 모두 **같은 폼**(`app/query` 의 `openConnForm`), 삭제는 **모든 연결**에
// OS 확인 대화(`confirmRemoveDbConn`).
//
// 여는 규칙(프로젝트 칸의 Enter 와 같다): 지금 워크스페이스에 그 연결의 쿼리 타일이 있으면 **그리로 간다**, 없으면 지금 탭에
// 새로 연다. 같은 연결을 하나 더 여는 길은 Ctrl+Enter · 메뉴 "새 타일로 열기"(쿼리 타일은 연결을 하나씩 따로 쥔다).
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

/** 연결 목록 · 읽기 경고(`db-connections.json` 사본) */
export { dbConns as dbDockConnList, dbConnWarnings as dbDockWarnings } from "$lib/app/db-conns.svelte.js";

/** 그 연결의 쿼리 타일이 열려 있는 자리 전부 — 이 창의 상주 탭 + 다른 워크스페이스 · 보조 창의 저장본 */
export function dbOpenLocations(): DbOpenLocation[] {
  const { live, saved } = openPaneLocations(queryPlace);
  return [...live, ...saved];
}

// ---------------------------------------------------------------------------
// 볼트 — 저장됨 표식(자물쇠)과 "저장된 비밀번호 지우기"
// ---------------------------------------------------------------------------

let savedIds = $state<ReadonlySet<string>>(new Set());

/** 이 연결의 비밀번호가 볼트에 있는가(잠겼거나 볼트가 없으면 모른다 = 없음) */
export function dbPasswordSaved(id: string): boolean {
  return savedIds.has(id);
}

/** 볼트 목록을 한 번 훑는다 — 칸이 보이게 될 때 · 창이 돌아올 때 · 지운 뒤 */
export async function refreshDbDockSaved(): Promise<void> {
  const items = await vault.list().catch(() => []);
  savedIds = new Set(items.filter((i) => i.kind === "db_password").map((i) => i.target));
}

// 연결 폼이 비밀번호를 담거나 지웠다 — 자물쇠를 다시 읽는다(폼은 이 모듈을 부르지 못한다: 이 모듈이 `app/query` 를 부른다)
onDbPasswordsChanged(() => void refreshDbDockSaved());

/** 칸이 보이게 될 때 — 연결 목록(파일) · 폴더 곁 파일 · 볼트 표식을 다시 읽는다 */
export function refreshDbDock(): void {
  void reloadDbConns();
  void reloadDbFolders();
  void refreshDbDockSaved();
}

// ---------------------------------------------------------------------------
// 동작 — 줄 · 메뉴가 부른다
// ---------------------------------------------------------------------------

/** 열기 — 지금 워크스페이스에 그 연결의 타일이 있으면 그리로, 없으면 지금 탭에 새로 */
export async function openDbConn(c: DbDockConn): Promise<void> {
  const here = dbFocusTarget(dbConnLocations(dbOpenLocations(), c.id), currentWorkspaceId());
  if (here) {
    await revealProjectLocation(here);
    return;
  }
  openQueryTile(c.id, c.tabName);
}

/** 새 타일로 열기 — 열려 있어도 하나 더(지금 탭) */
export function openDbConnNew(c: DbDockConn): void {
  openQueryTile(c.id, c.tabName);
}

/** 편집 — 경유든 직접이든 같은 폼 */
export async function editDbConn(c: DbDockConn): Promise<void> {
  await openConnForm({ id: c.id });
}

/**
 * 복제 — 호스트 복제(`app/hosts/row-actions` 의 `duplicateHost`)와 같은 모양: 모달 없이 곧장 `<이름>-copy` 로 만들고 알림 한 줄
 * (실패도 알림 — 던지지 않는다). 새 id 를 뽑고 비밀 아닌 칸은 모두 옮긴다(`duplicateConnIn` — 폴더 칸도라 복제본은 원본 폴더에 선다). **볼트 비밀번호는 옮기지 않는다** —
 * 값은 세션 서버 밖으로 나오지 않고 옮기는 op 도 없다. 복제본은 처음 열 때 비밀번호를 묻는다.
 */
export async function duplicateDbConn(c: DbDockConn): Promise<void> {
  try {
    const r = duplicateConnIn(dbConns(), c.id, newDbId());
    if (!r) {
      showNotice(t("app.db.dock.duplicate.missing", { name: c.name }));
      return;
    }
    await saveDbConns(r.list);
    // 원본에 저장된 비밀번호가 있었을 때만 "옮기지 않았다" 를 덧붙인다(없던 것을 말하면 헷갈린다)
    const key = savedIds.has(c.id) ? "app.db.dock.duplicate.donePassword" : "app.db.dock.duplicate.done";
    showNotice(t(key, { name: c.name, copy: r.copy.name }));
  } catch (e) {
    showNotice(t("app.db.dock.duplicate.fail", { message: stripReason(errorMessage(e)) }));
  }
}

/** 저장된 비밀번호 지우기 — 값은 볼트 밖으로 나오지 않는다(대상만 넘긴다). 실패는 토스트 */
export async function forgetDbConnPassword(c: DbDockConn): Promise<void> {
  try {
    await vault.remove("db_password", c.id);
  } catch (e) {
    toast.error(stripReason(e instanceof Error ? e.message : String(e)));
  }
  await refreshDbDockSaved();
}

/** 삭제 — OS 확인 대화 뒤(볼트 항목도 걷는다 — `confirmRemoveDbConn`). 지웠으면 `true` */
export async function deleteDbConn(c: Pick<DbDockConn, "id" | "name">): Promise<boolean> {
  const gone = await confirmRemoveDbConn(c);
  if (gone) await refreshDbDockSaved();
  return gone;
}

/**
 * **고른 것 지우기**(여러 줄 · 폴더 — Delete · 다중 메뉴 "제거…") — 호스트 독의 제거와 같은 뜻: 폴더는 그 아래 연결을 전부 지우고 꾸밈을
 * 치운다. **언제나 OS 확인 대화**(무엇을 몇 개 · 함께 지우는 것)를 거치고, 대화를 못 띄우면 지우지 않는다. 연결 하나만 골랐으면 한 줄
 * 삭제와 같은 대화(`confirmRemoveDbConn`). 뒤처리는 한 줄 삭제와 같다 — 즐겨찾기 칸 빼기(`forgetDbFavorites`) · 볼트 비밀번호 걷기(`forgetDbPasswords`) · AI 권한 블록(Rust
 * `db_conn_save` 가 목록에서 빠진 id 의 것을). 연결 목록 저장은 한 번(실패면 아무것도 지우지 않는다). 지웠으면 `true`.
 */
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

/** [새 DB 연결] — 고르기 모달의 폼만 연다 */
export function newDbConn(): void {
  void openConnForm();
}

/** 폴더 메뉴의 "새 DB 연결…" — 그 폴더에 만든다(폼에 폴더 칸은 없고 줄이 그대로 들고 간다) */
export function newDbConnIn(folder: string): void {
  void openConnForm({ folder });
}

/** 문구 — 엔진 이름 */
export function dbEngineLabel(engine: DbDockConn["engine"]): string {
  return t(`app.query.engine.${engine}`);
}
