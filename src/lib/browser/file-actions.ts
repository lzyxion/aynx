// 파일 타일의 항목 조작.
import { broadcastInput } from "$lib/sync.svelte";
import { toast } from "$lib/toast.svelte";
import type { FsBackend } from "$lib/fs-backend";
import { fsClip, setFsClip, type FsClipMode } from "$lib/fs-clipboard.svelte";
import { writeClipboard } from "$lib/clipboard";
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
import { isTextLike } from "$lib/doc-lang";
import { imageMime } from "$lib/browser/preview";
import type { Transfers } from "$lib/browser/fs-transfer.svelte";
import { failureOf, type FileListing } from "$lib/browser/file-listing.svelte";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 전부 게터라 그때그때의 값이다 */
export interface FileActionsHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  /** 합성 루트("내 PC") 인가 */
  readonly atRoot: boolean;
  readonly isTree: boolean;
  readonly selPaths: string[];
  readonly focusEntry: SftpEntry | null;
  readonly transfers: Transfers;
  readonly fileInput: HTMLInputElement | null;
  readonly sourcePaneId: string | null;
  readonly onopendoc?: (path: string) => void;
  readonly onupload?: (remoteDir: string, files: File[]) => void;
  readonly onnotice?: (message: string) => void;
  isRootItem(path: string): boolean;
  goTo(path: string): void;
}

export class FileActions {
  #h: FileActionsHost;
  #ls: FileListing;

  /** 칸을 여는 순간 정해 둔다 — 대화상자가 떠 있는 동안 선택이 바뀌어도 누른 순간의 자리로 간다 */
  uploadDir = "";

  constructor(h: FileActionsHost, ls: FileListing) {
    this.#h = h;
    this.#ls = ls;
  }

  /** 텍스트 · 그림은 미리 보기가 먼저다(docs/log/2026-09-27-doc-tile.md) — 모르는 확장자는 편집/기본 앱 쪽(보수적) */
  openEntry = (entry: SftpEntry) => {
    if (isDirLike(entry)) {
      this.#h.goTo(entry.path);
      return;
    }
    const onopendoc = this.#h.onopendoc;
    if (onopendoc && this.#h.backend.canView && (imageMime(entry.name) !== null || isTextLike(entry.name))) {
      onopendoc(entry.path);
      return;
    }
    if (this.#h.backend.canEdit) void this.editEntry(entry);
    else if (this.#h.backend.canOpenExternal) void this.openExternally(entry);
    // 바깥으로 열 길이 없으면(원격 창) 아무 반응 없이 끝내지 않고 미리 보기 타일로 연다
    else if (onopendoc && this.#h.backend.canView) onopendoc(entry.path);
  };

  editEntry = async (entry: SftpEntry) => {
    const backend = this.#h.backend;
    if (this.#h.offline || !backend.edit) return;
    try {
      const name = await backend.edit(entry.path);
      this.#h.onnotice?.(t("files.browser.edit.opened", { name }));
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  openExternally = async (entry: SftpEntry) => {
    const backend = this.#h.backend;
    if (!backend.openExternal) return;
    try {
      await backend.openExternal(entry.path);
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  revealEntry = async (entry: SftpEntry) => {
    const backend = this.#h.backend;
    if (!backend.reveal) return;
    try {
      await backend.reveal(entry.path);
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  revealHere = async () => {
    const backend = this.#h.backend;
    if (!backend.reveal || !this.#ls.hasCwd || this.#h.atRoot) return;
    try {
      await backend.reveal(this.#ls.cwd);
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  // ── 클립보드 ──

  targets = (): string[] => {
    if (this.#h.selPaths.length > 0) return this.#h.selPaths;
    const focusEntry = this.#h.focusEntry;
    return focusEntry ? [focusEntry.path] : [];
  };

  copySelection = (mode: FsClipMode) => {
    const paths = this.targets();
    if (paths.length === 0 || paths.some(this.#h.isRootItem)) return;
    setFsClip(mode, this.#h.backend.key, paths);
  };

  pasteInto = (dir: string) => {
    if (!fsClip()) return;
    if (this.#h.isTree && dir !== this.#ls.cwd) this.#ls.expand(dir);
    void this.#h.transfers.pasteInto(dir);
  };

  // ── 업로드 ──

  /** Tauri `open` 대화상자는 쓰지 않는다 — 경로만 주는데 `upload_file` 은 파일 내용(`File`)을 raw 바디로 보낸다 */
  pickUpload = (dir: string) => {
    const backend = this.#h.backend;
    if (this.#h.offline || !backend.canUpload || backend.isSyntheticRoot(dir)) return;
    this.uploadDir = dir;
    this.#h.fileInput?.click();
  };

  onPicked = (ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ""; // 같은 파일을 다시 골라도 change 가 오게 비운다
    if (files.length > 0) this.uploadTo(this.uploadDir, files);
  };

  /** 빈 바닥에 끌어다 놓은 OS 파일은 여기로 오지 않는다 — `PaneHost` → `+page` 의 `dropFiles` 길이다 */
  uploadTo = (dir: string, files: File[]) => {
    const backend = this.#h.backend;
    if (this.#h.offline || !this.#ls.hasCwd || !backend.canUpload || backend.isSyntheticRoot(dir)) return;
    this.#h.onupload?.(dir, files);
  };

  // ── 우클릭 메뉴 ──

  copyPath = async (entry: SftpEntry) => {
    if (await writeClipboard(entry.path)) this.#h.onnotice?.(t("files.browser.copypath.done"));
    else toast.error(t("files.browser.copypath.fail"));
  };

  cdHere = () => {
    const target = this.#h.sourcePaneId;
    if (!target || !this.#ls.hasCwd) return;
    const quoted = `'${this.#ls.cwd.replaceAll("'", `'\\''`)}'`;
    broadcastInput([target], `cd ${quoted}\r`);
    this.#h.onnotice?.(t("files.browser.cdhere.done"));
  };
}
