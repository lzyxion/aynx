// 독 DB 칸의 폴더 — 바꾸기는 연결 목록(`db-connections.json`) 먼저, 곁 파일(`db-folders.json`) 다음이다:
// 연결이 옮겨졌는데 꾸밈만 남는 쪽이 반대보다 덜 이상하다(다음 읽기에서 빈 폴더로 보일 뿐).
import { t } from "$lib/i18n/i18n.svelte.js";
import { showNotice } from "$lib/app/notice";
import { stripReason } from "$lib/error-reason";
import { dbConns, saveDbConns } from "$lib/app/db-conns.svelte.js";
import { dbFoldersLoad, dbFoldersSave, errorMessage } from "$lib/query/query-backend";
import { folderIcon } from "$lib/host-icons";
import { lastSegment, parentPath, parseExpandedGroups, rebaseExpanded } from "$lib/host-folders";
import {
  dbChildFolderNames,
  dbDragEmpty,
  dbFolderNameProblem,
  dbFolderOf,
  moveDbInto,
  parseDbFolderMeta,
  planDbPasteCopy,
  removeDbItems,
  renameDbFolder,
  serializeDbFolderMeta,
  type DbDockDrag,
  type DbFolderMap,
} from "$lib/db-folders";
import { newDbId, type DbConn } from "$lib/db-conn";

let meta = $state<DbFolderMap>({});

export function dbFolderMeta(): DbFolderMap {
  return meta;
}

export function dbFolderIcon(path: string): string | null {
  return folderIcon(meta[path]?.icon);
}

export function dbFolderColor(path: string): string | null {
  return meta[path]?.color?.trim() || null;
}

export async function reloadDbFolders(): Promise<void> {
  meta = parseDbFolderMeta(await dbFoldersLoad().catch(() => null));
}

// ── 펼침 ──

const EXPANDED_KEY = "aynx:db:expanded";

function loadExpanded(): ReadonlySet<string> {
  try {
    return parseExpandedGroups(localStorage.getItem(EXPANDED_KEY));
  } catch {
    return new Set();
  }
}

let expanded = $state<ReadonlySet<string>>(loadExpanded());

export function dbExpanded(): ReadonlySet<string> {
  return expanded;
}

function saveExpanded(next: ReadonlySet<string>): void {
  if (next === expanded) return;
  expanded = next;
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  } catch {
    /* 저장 못 해도 이번 창의 펼침은 산다 */
  }
}

export function setDbFolderOpen(path: string, open: boolean): void {
  if (expanded.has(path) === open) return;
  const next = new Set(expanded);
  if (open) next.add(path);
  else next.delete(path);
  saveExpanded(next);
}

// ── 바꾸기 — 연결 목록 먼저, 곁 파일 다음 ──

async function apply(next: { conns: DbConn[]; meta: DbFolderMap }): Promise<void> {
  if (JSON.stringify(next.conns) !== JSON.stringify(dbConns())) await saveDbConns(next.conns);
  const text = serializeDbFolderMeta(next.meta);
  if (text !== serializeDbFolderMeta(meta)) {
    await dbFoldersSave(text);
    meta = next.meta;
  }
}

function fail(e: unknown): void {
  showNotice(stripReason(errorMessage(e)));
}

export function dbNewFolderProblem(parent: string, name: string): string | null {
  const problem = dbFolderNameProblem(name, dbChildFolderNames(dbConns(), meta, parent));
  return problem ? t(problem) : null;
}

/** 검사에 걸리면 그 문구를 돌려주고 아무것도 쓰지 않는다 */
export async function createDbFolder(parent: string, name: string): Promise<string | null> {
  const problem = dbNewFolderProblem(parent, name);
  if (problem) return problem;
  const path = parent ? `${parent}/${name.trim()}` : name.trim();
  if (parent !== "") setDbFolderOpen(parent, true);
  try {
    await apply({ conns: dbConns(), meta: { ...meta, [path]: meta[path] ?? {} } });
  } catch (e) {
    fail(e);
  }
  return null;
}

/** `dest` `""` = 최상위 */
export async function moveDbDrag(drag: DbDockDrag, dest: string): Promise<boolean> {
  const next = moveDbInto(dbConns(), meta, drag, dest);
  if (!next) return false;
  try {
    await apply(next);
    let open = expanded;
    for (const m of next.moved) open = rebaseExpanded(open, m.from, m.to);
    saveExpanded(open);
    if (dest !== "") setDbFolderOpen(dest, true);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

// ── 앱 안 클립보드 — OS 클립보드가 아니다 ──

export type DbClipMode = "copy" | "cut";

const clip = $state<{ value: { mode: DbClipMode; payload: DbDockDrag } | null }>({ value: null });

export function dbClip(): { mode: DbClipMode; payload: DbDockDrag } | null {
  return clip.value;
}

/** 빈 짐이면 담지 않는다(빈 클립보드로 덮지 않게) */
export function setDbClip(mode: DbClipMode, payload: DbDockDrag): void {
  if (dbDragEmpty(payload)) return;
  clip.value = { mode, payload: { conns: [...payload.conns], folders: [...payload.folders] } };
}

/** `key` = 연결 `conn:<id>` · 폴더 `f:<경로>` */
export function isDbCut(key: string): boolean {
  const c = clip.value;
  if (c?.mode !== "cut") return false;
  if (key.startsWith("f:")) return c.payload.folders.includes(key.slice(2));
  return key.startsWith("conn:") && c.payload.conns.includes(key.slice(5));
}

/** 복사면 복제 — 볼트 비밀번호는 옮기지 않는다 */
export async function pasteDbClip(dest: string): Promise<void> {
  const c = clip.value;
  if (!c) return;
  if (c.mode === "cut") {
    if (await moveDbDrag(c.payload, dest)) clip.value = null;
    return;
  }
  const plan = planDbPasteCopy(dbConns(), meta, c.payload, dest, () => newDbId());
  for (const n of plan.notices) showNotice(t(n.key, n.params));
  if (plan.copied === 0 && serializeDbFolderMeta(plan.meta) === serializeDbFolderMeta(meta)) return;
  try {
    await apply(plan);
    if (dest !== "") setDbFolderOpen(dest, true);
  } catch (e) {
    fail(e);
  }
}

/** 확인 · 볼트 비밀번호 걷기는 부르는 쪽(`app/db-dock` 의 `deleteDbSelection`) */
export async function removeDbSelectionNow(drag: DbDockDrag): Promise<string[] | null> {
  const next = removeDbItems(dbConns(), meta, drag);
  try {
    await apply(next);
    let open = expanded;
    for (const f of drag.folders) open = rebaseExpanded(open, f, "");
    saveExpanded(open);
    const c = clip.value;
    if (c) {
      const left = {
        conns: c.payload.conns.filter((id) => !next.removed.includes(id)),
        folders: c.payload.folders.filter((f) => !drag.folders.some((g) => f === g || f.startsWith(`${g}/`))),
      };
      clip.value = dbDragEmpty(left) ? null : { mode: c.mode, payload: left };
    }
    return next.removed;
  } catch (e) {
    fail(e);
    return null;
  }
}

export async function dissolveDbFolder(path: string): Promise<void> {
  try {
    await apply(renameDbFolder(dbConns(), meta, path, ""));
    saveExpanded(rebaseExpanded(expanded, path, ""));
  } catch (e) {
    fail(e);
  }
}

/** `FolderEditDialog` 의 `FolderEdit` 과 같은 모양 */
export interface DbFolderEdit {
  path: string;
  name: string;
  icon: string;
  color: string;
  error: string | null;
  saving: boolean;
}

export function dbFolderEditOf(path: string): DbFolderEdit {
  return { path, name: lastSegment(path), icon: dbFolderIcon(path) ?? "", color: dbFolderColor(path) ?? "", error: null, saving: false };
}

/** 연결이 하나도 없는 폴더는 꾸밈을 다 비워도 빈 항목을 남긴다 — 그것이 폴더의 유일한 존재 증거다 */
export async function saveDbFolderEdit(f: DbFolderEdit): Promise<boolean> {
  const name = f.name.trim();
  const oldName = lastSegment(f.path);
  const parent = parentPath(f.path);
  const taken = dbChildFolderNames(dbConns(), meta, parent);
  if (name !== oldName) {
    const problem = dbFolderNameProblem(name, taken);
    if (problem) {
      f.error = t(problem);
      return false;
    }
  } else if (name === "") {
    f.error = t("app.hosts.folder.name.empty");
    return false;
  }
  f.saving = true;
  f.error = null;
  try {
    let next = { conns: dbConns(), meta: { ...meta } };
    let path = f.path;
    if (name !== oldName) {
      const to = parent ? `${parent}/${name}` : name;
      next = renameDbFolder(next.conns, next.meta, f.path, to);
      path = to;
    }
    const icon = f.icon.trim();
    const color = f.color.trim();
    const empty = !next.conns.some((c) => {
      const p = dbFolderOf(c);
      return p === path || p.startsWith(`${path}/`);
    });
    const m: DbFolderMap = { ...next.meta };
    if (icon || color) m[path] = { ...(icon ? { icon } : {}), ...(color ? { color } : {}) };
    else if (empty) m[path] = {};
    else delete m[path];
    await apply({ conns: next.conns, meta: m });
    if (path !== f.path) saveExpanded(rebaseExpanded(expanded, f.path, path));
    f.path = path;
    return true;
  } catch (e) {
    f.error = stripReason(errorMessage(e));
    return false;
  } finally {
    f.saving = false;
  }
}
