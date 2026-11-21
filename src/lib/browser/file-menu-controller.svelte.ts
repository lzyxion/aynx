// 파일 타일의 우클릭 메뉴와 그 안의 인라인 폼.
import { toast } from "$lib/toast.svelte";
import { nameError, type FsBackend } from "$lib/fs-backend";
import type { SftpEntry } from "$lib/sftp-browser";
import { rebasePaths } from "$lib/file-tree";
import { hasReason, stripReason } from "$lib/error-reason";
import type { SelectionController } from "$lib/browser/selection-controller.svelte";
import type { FileListing } from "$lib/browser/file-listing.svelte";
import {
  beginInlineEdit,
  createInlineEdit,
  focusInlineEdit,
  resetInlineEdit,
} from "$lib/browser/inline-edit.svelte";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 전부 게터라 그때그때의 값이다 */
export interface FileMenuHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  readonly isTree: boolean;
  readonly sel: SelectionController;
  readonly order: string[];
  readonly selPaths: string[];
  readonly targetDir: string;
  readonly listEl: HTMLDivElement | null;
  isRootItem(path: string): boolean;
  targetDirOfEntry(entry: SftpEntry | null): string;
}

/** `entry` 가 없으면 빈 배경에서 열린 것이다 */
export type FileMenuAnchor = { x: number; y: number; entry: SftpEntry | null };

function editFailureOf(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

export class FileMenuController {
  #h: FileMenuHost;
  #ls: FileListing;

  menu = $state<FileMenuAnchor | null>(null);
  /** `menu` 와 따로 둔다 — 붙여넣기 · 업로드는 메뉴를 닫은 뒤에 돌아 그때 `menu` 는 이미 `null` 이다 */
  menuDir = $state("");
  menuMode = $state<"menu" | "rename" | "newfolder" | "newfile" | "confirm">("menu");
  edit = createInlineEdit();
  confirmRecursive = $state(false);
  removeTargets = $state<string[]>([]);
  /** 폼을 여는 순간 정해 둔다 */
  newFolderDir = $state("");

  constructor(h: FileMenuHost, ls: FileListing) {
    this.#h = h;
    this.#ls = ls;
  }

  // ── 삭제 ──

  /**
   * 처음에는 언제나 `recursive: false` — 처음부터 재귀면 빈 줄 알았던 폴더를 통째로 지우고도 모른다.
   * 여럿을 지우다 멈추면 남은 것으로 대상을 좁힌다 — 없는 경로를 다시 지우라고 하면 그 자리에서 또 멈춘다.
   */
  submitRemove = async (recursive: boolean) => {
    const list = this.removeTargets;
    if (this.#h.offline || list.length === 0 || list.some(this.#h.isRootItem)) return;
    try {
      await this.#h.backend.removeMany(list, recursive);
      this.closeMenu();
      // 지운 폴더의 펼침은 버린다 — 같은 이름이 다시 생겼을 때 저절로 펼쳐져 서지 않게
      for (const p of list) this.#ls.expanded = rebasePaths(this.#ls.expanded, p, null);
      toast.success(
        list.length > 1
          ? t("files.browser.removed.many", { count: list.length })
          : t("files.browser.removed.one"),
      );
      await this.#ls.load(this.#ls.cwd);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (list.length > 1) {
        // 트리에서는 대상이 여러 폴더에 흩어져 목록 하나로는 못 가른다 — 하나씩 `stat` 으로 묻는다
        const alive = await Promise.all(
          list.map((p) => this.#h.backend.stat(p).then(() => true, () => false)),
        );
        this.removeTargets = list.filter((_, i) => alive[i]);
        void this.#ls.load(this.#ls.cwd, this.removeTargets);
      }
      // 글자가 아니라 이유 코드로 본다 — Rust `src-tauri/src/errors.rs` 와 같은 값
      if (!recursive && hasReason(message, "not-empty")) {
        this.confirmRecursive = true;
        this.edit.error = stripReason(message);
        return;
      }
      this.edit.error = stripReason(message);
    }
  };

  // ── 만들기 · 이름 변경 ──

  submitNewFolder = () => this.#submitNew("folder");

  submitNewFile = () => this.#submitNew("file");

  #submitNew = async (kind: "folder" | "file") => {
    const name = this.edit.value.trim();
    const dir = this.newFolderDir;
    if (this.#h.offline || this.#h.backend.isSyntheticRoot(dir)) return;
    if (name === "") {
      this.edit.error = t(kind === "file" ? "files.browser.newfile.empty" : "files.browser.newfolder.empty");
      return;
    }
    const bad = nameError(name, this.#h.backend.sep);
    if (bad) {
      this.edit.error = t(bad);
      return;
    }
    try {
      const path = this.#h.backend.joinPath(dir, name);
      const made = kind === "file" ? await this.#h.backend.createFile(path) : await this.#h.backend.mkdir(path);
      this.closeMenu();
      if (this.#h.isTree && dir !== this.#ls.cwd) this.#ls.setExpanded(dir, true);
      await this.#ls.load(this.#ls.cwd, [made]);
    } catch (e) {
      this.edit.error = editFailureOf(e);
    }
  };

  submitRename = async () => {
    const target = this.menu?.entry;
    const name = this.edit.value.trim();
    if (this.#h.offline || !target || this.#h.isRootItem(target.path)) return;
    if (name === "") {
      this.edit.error = t("files.browser.rename.empty");
      return;
    }
    const bad = nameError(name, this.#h.backend.sep);
    if (bad) {
      this.edit.error = t(bad);
      return;
    }
    if (name === target.name) {
      this.closeMenu();
      return;
    }
    try {
      const to = this.#h.backend.joinPath(this.#h.backend.parentOf(target.path), name);
      const moved = await this.#h.backend.rename(target.path, to);
      this.closeMenu();
      this.#ls.expanded = rebasePaths(this.#ls.expanded, target.path, moved);
      await this.#ls.load(this.#ls.cwd, [moved]);
    } catch (e) {
      this.edit.error = editFailureOf(e);
    }
  };

  // ── 우클릭 메뉴 ──

  openMenu = (ev: MouseEvent, entry: SftpEntry | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.#h.offline) return;
    if (entry) this.#h.sel.pickForMenu(entry.path, this.#h.order);
    this.menuDir = this.#h.targetDirOfEntry(entry);
    // 메뉴는 최대 220×320 쯤이다
    const x = Math.min(ev.clientX, window.innerWidth - 230);
    const y = Math.min(ev.clientY, window.innerHeight - 330);
    this.menu = { x: Math.max(4, x), y: Math.max(4, y), entry };
    this.menuMode = "menu";
    resetInlineEdit(this.edit);
    this.confirmRecursive = false;
  };

  closeMenu = () => {
    this.menu = null;
    this.menuMode = "menu";
    this.edit.error = null;
    this.confirmRecursive = false;
  };

  startRename = async () => {
    if (!this.menu?.entry || this.#h.isRootItem(this.menu.entry.path)) return;
    beginInlineEdit(this.edit, this.menu.entry.name);
    this.menuMode = "rename";
    // 확장자만 남기지 않고 전체를 고른다 — 원격 파일은 확장자가 없는 것이 흔하다
    await focusInlineEdit(this.edit, true);
  };

  startNewFolder = (dir: string) => this.#startNew(dir, "newfolder");

  startNewFile = (dir: string) => this.#startNew(dir, "newfile");

  #startNew = async (dir: string, mode: "newfolder" | "newfile") => {
    if (this.#h.backend.isSyntheticRoot(dir)) return;
    this.newFolderDir = dir;
    beginInlineEdit(this.edit, "");
    this.menuMode = mode;
    await focusInlineEdit(this.edit);
  };

  startRemove = () => {
    const anchor = this.menu?.entry;
    const list = this.#h.selPaths.length > 0 ? this.#h.selPaths : anchor ? [anchor.path] : [];
    if (list.length === 0 || list.some(this.#h.isRootItem)) return;
    this.removeTargets = list;
    this.edit.error = null;
    this.confirmRecursive = false;
    this.menuMode = "confirm";
  };

  newFolderHere = () => {
    const dir = this.#h.targetDir;
    if (this.#h.offline || !this.#ls.hasCwd || this.#h.backend.isSyntheticRoot(dir)) return;
    const listEl = this.#h.listEl;
    const rowEl =
      dir === this.#ls.cwd ? null : listEl?.querySelector<HTMLElement>(`[data-path="${CSS.escape(dir)}"]`);
    const box = (rowEl ?? listEl)?.getBoundingClientRect();
    this.menu = box
      ? { x: box.left + 16, y: rowEl ? box.bottom : box.top + 16, entry: null }
      : { x: 0, y: 0, entry: null };
    void this.startNewFolder(dir);
  };
}
