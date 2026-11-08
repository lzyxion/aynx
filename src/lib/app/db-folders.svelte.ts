// **독 DB 칸의 폴더 — 상태와 동작**(10-15 — 호스트 독 폴더와 같은 상호작용, 규칙은 순수 `$lib/db-folders`).
//
// 저장은 둘이다: 연결의 `folder` 칸은 연결 목록(`db-connections.json` — `app/db-conns` 의 `saveDbConns`, 통째 저장 · Rust 가 다듬는다),
// 폴더의 아이콘 · 색 · 빈 폴더는 곁 파일(`db-folders.json` — `db_folders_load`/`db_folders_save`). 바꾸기는 **연결 목록 먼저, 곁 파일
// 다음**이다(연결이 옮겨졌는데 꾸밈만 남는 쪽이 반대보다 덜 이상하다 — 다음 읽기에서 빈 폴더로 보일 뿐). 펼침은 보는 사람의 편의라
// `localStorage`(`aynx:db:expanded` — 호스트 트리의 `aynx:hosts:expanded` 와 같은 결 · 기본 접힘).
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

/** 곁 파일의 표(폴더 경로 → 아이콘 · 색) */
export function dbFolderMeta(): DbFolderMap {
  return meta;
}

/** 사람이 고른 폴더 아이콘(없으면 `null` — 테마 색 기본 폴더) */
export function dbFolderIcon(path: string): string | null {
  return folderIcon(meta[path]?.icon);
}

/** 폴더 색(없으면 `null`) */
export function dbFolderColor(path: string): string | null {
  return meta[path]?.color?.trim() || null;
}

/** 곁 파일을 다시 읽는다 — 실패는 빈 표(꾸밈 없이 연결의 폴더만 선다) */
export async function reloadDbFolders(): Promise<void> {
  meta = parseDbFolderMeta(await dbFoldersLoad().catch(() => null));
}

// ---------------------------------------------------------------------------
// 펼침 — localStorage
// ---------------------------------------------------------------------------

const EXPANDED_KEY = "aynx:db:expanded";

function loadExpanded(): ReadonlySet<string> {
  try {
    return parseExpandedGroups(localStorage.getItem(EXPANDED_KEY));
  } catch {
    return new Set();
  }
}

let expanded = $state<ReadonlySet<string>>(loadExpanded());

/** 펼쳐 둔 폴더들 */
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

/** 폴더 하나를 펼치거나 접는다 — 화살표 · →← · Enter · 더블 클릭의 한 문 */
export function setDbFolderOpen(path: string, open: boolean): void {
  if (expanded.has(path) === open) return;
  const next = new Set(expanded);
  if (open) next.add(path);
  else next.delete(path);
  saveExpanded(next);
}

// ---------------------------------------------------------------------------
// 바꾸기 — 연결 목록 먼저, 곁 파일 다음
// ---------------------------------------------------------------------------

/** 계산한 (목록, 표)를 적는다 — 바뀐 쪽만. 던진다(문구는 부르는 쪽) */
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

/** 새 폴더 이름 검사 — 걸리면 문구(메뉴가 연 채 말한다), 아니면 `null` */
export function dbNewFolderProblem(parent: string, name: string): string | null {
  const problem = dbFolderNameProblem(name, dbChildFolderNames(dbConns(), meta, parent));
  return problem ? t(problem) : null;
}

/**
 * **새 폴더** — `parent` 안에 `name`(호스트 독의 "폴더 추가…" · "하위 폴더 추가…" 와 같은 검사 셋). 검사에 걸리면 그 문구를 돌려주고
 * (메뉴가 열린 채 말한다) 아무것도 쓰지 않는다. 만들었으면 부모를 펼친다(접힌 채면 방금 만든 것이 안 보인다).
 */
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

/**
 * 끌어다 놓기 · 잘라내기 붙여넣기 — 짐(연결 · 폴더 여럿)을 `dest`(`""` = 최상위)로. 계획은 순수 `moveDbInto` 하나, 저장은 **한 번**
 * (연결 목록 통째 — 실패면 아무것도 바뀌지 않는다). 펼쳐 둔 가지는 새 경로를 따라간다. 옮겼으면 `true`.
 */
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

// ---------------------------------------------------------------------------
// 앱 안 클립보드 — 잘라내기 · 복사 · 붙여넣기 (호스트 독의 `hosts-clipboard` 와 같은 결 — OS 클립보드가 아니다)
// ---------------------------------------------------------------------------

/** 담은 방식 — 복사(붙이면 복제) / 잘라내기(붙이면 그 폴더로 이동) */
export type DbClipMode = "copy" | "cut";

const clip = $state<{ value: { mode: DbClipMode; payload: DbDockDrag } | null }>({ value: null });

/** 지금 담긴 것(없으면 `null`) */
export function dbClip(): { mode: DbClipMode; payload: DbDockDrag } | null {
  return clip.value;
}

/** 담는다 — 빈 짐이면 담지 않는다(빈 클립보드로 덮지 않게) */
export function setDbClip(mode: DbClipMode, payload: DbDockDrag): void {
  if (dbDragEmpty(payload)) return;
  clip.value = { mode, payload: { conns: [...payload.conns], folders: [...payload.folders] } };
}

/** 이 줄이 잘려 있는가(연결 `conn:<id>` · 폴더 `f:<경로>`) — 반투명하게 그린다. 복사는 표시하지 않는다 */
export function isDbCut(key: string): boolean {
  const c = clip.value;
  if (c?.mode !== "cut") return false;
  if (key.startsWith("f:")) return c.payload.folders.includes(key.slice(2));
  return key.startsWith("conn:") && c.payload.conns.includes(key.slice(5));
}

/**
 * `dest` 폴더에 붙여넣는다 — 잘라내기면 이동(드롭과 같은 길 · 한 번 쓰고 비운다), 복사면 복제(`planDbPasteCopy` — 새 id · `-copy`,
 * 볼트 비밀번호는 옮기지 않는다). 저장은 한 번.
 */
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

/**
 * **고른 것 지우기**(확인은 부르는 쪽 — `app/db-dock` 의 `deleteDbSelection`) — 연결 목록을 **한 번에** 저장하고(Rust 가 빠진 id 의 AI 권한
 * 블록을 걷는다) 꾸밈을 치운다. 지운 연결 id 를 돌려준다(볼트 비밀번호 걷기는 부르는 쪽). 실패는 알리고 `null`.
 */
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

/** **그룹 해제** — 안의 연결은 최상위로(아래 폴더는 한 단 올라간다) · 그 폴더의 꾸밈은 버린다. 연결은 지우지 않는다 */
export async function dissolveDbFolder(path: string): Promise<void> {
  try {
    await apply(renameDbFolder(dbConns(), meta, path, ""));
    saveExpanded(rebaseExpanded(expanded, path, ""));
  } catch (e) {
    fail(e);
  }
}

/** 폴더 편집 상자가 쥔 값(`FolderEditDialog` 의 `FolderEdit` 과 같은 모양) */
export interface DbFolderEdit {
  path: string;
  name: string;
  icon: string;
  color: string;
  error: string | null;
  saving: boolean;
}

/** 편집 상자를 열 때의 값 — 아이콘은 **사람이 고른 것**만(기본 폴더는 비운 칸) */
export function dbFolderEditOf(path: string): DbFolderEdit {
  return { path, name: lastSegment(path), icon: dbFolderIcon(path) ?? "", color: dbFolderColor(path) ?? "", error: null, saving: false };
}

/**
 * **폴더 편집 저장** — 이름을 먼저(접두사 다시 쓰기 — 꾸밈도 함께 옮겨진다), 그다음 아이콘 · 색. 검사(비었나 · `/` · 같은 층 겹침 —
 * 자기 자신은 빼고)나 저장이 실패하면 상자의 `error` 에 한 줄 적고 `false`(상자를 연 채 둔다). 성공이면 `true`.
 * 아이콘 · 색을 다 비우면 꾸밈 항목을 지운다 — 단 **연결이 하나도 없는 폴더는 빈 항목을 남긴다**(그것이 폴더의 유일한 존재 증거다).
 */
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
