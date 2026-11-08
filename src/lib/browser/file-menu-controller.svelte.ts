// 파일 타일의 우클릭 메뉴와 그 안의 인라인 폼 — 여닫기·자리 · 이름 바꾸기 · 새 폴더 · 삭제 확인(재귀 삭제 되묻기).
// `SftpBrowser.svelte` 가 옛 상태 자리에서 하나 만들고, 그림은 `FileMenu.svelte`(항목은 `runOnMenu` 통로)다. `$effect` 없음.
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

/** 메뉴가 타일에서 읽고 부르는 것 — 전부 게터라 그때그때의 값이다 */
export interface FileMenuHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  readonly isTree: boolean;
  readonly sel: SelectionController;
  /** 지금 보이는 순서대로의 항목 경로 */
  readonly order: string[];
  /** 골라진 것들 — 보이는 순서 */
  readonly selPaths: string[];
  /** 조작의 대상 폴더 (툴바 [폴더]) */
  readonly targetDir: string;
  readonly listEl: HTMLDivElement | null;
  /** 드라이브 뿌리 줄인가 (이름 변경·삭제가 뜻이 없다) */
  isRootItem(path: string): boolean;
  /** 한 줄의 대상 폴더 — 우클릭 메뉴가 연 순간의 값 */
  targetDirOfEntry(entry: SftpEntry | null): string;
}

/** 메뉴 한 장의 자리와 대상 — `entry` 가 없으면 빈 배경에서 열린 것이다 */
export type FileMenuAnchor = { x: number; y: number; entry: SftpEntry | null };

/**
 * 오류 하나를 **인라인 편집 칸**(새 폴더·이름 바꾸기·삭제 확인)에 적을 글자로.
 *
 * [`stripReason`] 을 지나는 이유는 백엔드가 앞에 다는 이유 코드(`[exists]` …)가 기계를
 * 위한 것이기 때문이다 — 사용자는 대괄호를 볼 일이 없다 (`$lib/error-reason`).
 */
function editFailureOf(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

export class FileMenuController {
  #h: FileMenuHost;
  #ls: FileListing;

  /** 우클릭 메뉴 — `entry` 가 없으면 빈 배경에서 열린 것이다 */
  menu = $state<FileMenuAnchor | null>(null);
  /**
   * 열린 메뉴의 **대상 폴더** — 항목 메뉴면 그 줄의 폴더(`targetDirOf`), 빈 곳이면 뿌리. `menu` 와
   * 따로 두는 이유: 붙여넣기·업로드 같은 항목은 메뉴를 **닫은 뒤에** 돌므로(`runAfterClose`) 그때
   * `menu` 는 이미 `null` 이다.
   */
  menuDir = $state("");
  /** 메뉴 안의 인라인 폼 (이름 변경·새 폴더·삭제 확인) */
  menuMode = $state<"menu" | "rename" | "newfolder" | "newfile" | "confirm">("menu");
  edit = createInlineEdit();
  /** 삭제 확인에서 "재귀 삭제" 를 물어야 하는가 (안 빈 디렉터리라고 백엔드가 답했다) */
  confirmRecursive = $state(false);
  /** 지금 삭제 확인이 걸려 있는 경로들 (하나일 수도, 고른 것 전부일 수도 있다) */
  removeTargets = $state<string[]>([]);
  /**
   * 새 폴더 · 새 파일을 만들 자리 — 폼을 여는 순간 정해 둔다(툴바 = 대상 폴더, 빈 곳 메뉴 = 뿌리, 폴더 메뉴 =
   * 그 폴더). 메뉴 제목이 이 경로를 보여 준다.
   */
  newFolderDir = $state("");

  constructor(h: FileMenuHost, ls: FileListing) {
    this.#h = h;
    this.#ls = ls;
  }

  // ── 삭제 (여럿) ─────────────────────────────────────────────────────────────

  /**
   * 삭제. **처음에는 언제나 `recursive: false`** 로 부른다 — 안 빈 디렉터리면 백엔드가
   * 거절하고, 그때 비로소 "재귀 삭제?" 를 한 번 더 묻는다. 처음부터 재귀로 부르면
   * "빈 줄 알았던 폴더" 를 통째로 지우고도 사용자는 그 사실을 모른다.
   *
   * 여럿을 지우다 멈추면 **이미 지워진 것이 있다** (백엔드는 첫 실패에서 멈추고 어디까지
   * 했는지를 오류에 싣는다). 그래서 실패한 자리에서 목록을 다시 읽어, 다음 시도의 대상을
   * **아직 남아 있는 것들로 좁힌다** — 없는 경로를 다시 지우라고 하면 그 자리에서 또 멈춘다.
   */
  submitRemove = async (recursive: boolean) => {
    const list = this.removeTargets;
    if (this.#h.offline || list.length === 0 || list.some(this.#h.isRootItem)) return;
    try {
      await this.#h.backend.removeMany(list, recursive);
      this.closeMenu();
      // 지운 폴더의 펼침은 버린다 — 같은 이름이 다시 생겼을 때 저절로 펼쳐져 서지 않게
      for (const p of list) this.#ls.expanded = rebasePaths(this.#ls.expanded, p, null);
      // **되돌릴 수 없는 조작**이라 무엇이 일어났는지 한 줄로 남긴다.
      toast.success(
        list.length > 1
          ? t("files.browser.removed.many", { count: list.length })
          : t("files.browser.removed.one"),
      );
      await this.#ls.load(this.#ls.cwd);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (list.length > 1) {
        // 여럿 중 어디까지 지워졌는지 — 트리에서는 대상이 여러 폴더에 흩어져 있을 수 있어 목록
        // 하나로는 가를 수 없다. 남은 것을 하나씩 `stat` 으로 물어 좁힌다(없으면 지워진 것).
        const alive = await Promise.all(
          list.map((p) => this.#h.backend.stat(p).then(() => true, () => false)),
        );
        this.removeTargets = list.filter((_, i) => alive[i]);
        void this.#ls.load(this.#ls.cwd, this.removeTargets);
      }
      // **이유 코드로 알아본다** — 글자가 아니라 `[not-empty]` 라 언어를 타지 않는다
      // (`$lib/error-reason` · `src-tauri/src/errors.rs`).
      if (!recursive && hasReason(message, "not-empty")) {
        this.confirmRecursive = true;
        this.edit.error = stripReason(message);
        return;
      }
      this.edit.error = stripReason(message);
    }
  };

  // ── 만들기 · 이름 변경 ──────────────────────────────────────────────────────

  submitNewFolder = () => this.#submitNew("folder");

  /** [새 파일…] — 새 폴더와 같은 폼 · 같은 자리(`newFolderDir`)에 빈 파일 하나 */
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
      // 백엔드가 만들어진 **절대 경로**를 돌려주므로 새로고침 뒤 그것을 골라 둔다.
      const path = this.#h.backend.joinPath(dir, name);
      const made = kind === "file" ? await this.#h.backend.createFile(path) : await this.#h.backend.mkdir(path);
      this.closeMenu();
      // 하위 폴더에 만들었으면 그 폴더를 펼쳐 둔다 — 접힌 채면 방금 만든 것이 안 보인다
      // (호스트 트리의 "하위 폴더를 만들면 부모를 펼친다" 와 같은 까닭).
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
      // 이름만 바꾼다 = **같은 부모** 아래의 새 이름 (옮기기는 이 UI 의 일이 아니다).
      const to = this.#h.backend.joinPath(this.#h.backend.parentOf(target.path), name);
      const moved = await this.#h.backend.rename(target.path, to);
      this.closeMenu();
      // 펼쳐 둔 폴더의 이름을 바꿨으면 펼침이 새 이름을 따라간다(호스트 트리의 `rebaseExpanded`)
      this.#ls.expanded = rebasePaths(this.#ls.expanded, target.path, moved);
      await this.#ls.load(this.#ls.cwd, [moved]);
    } catch (e) {
      this.edit.error = editFailureOf(e);
    }
  };

  // ── 우클릭 메뉴 ─────────────────────────────────────────────────────────────

  openMenu = (ev: MouseEvent, entry: SftpEntry | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.#h.offline) return;
    // 우클릭의 선택 규칙 — 이미 골라진 것 위면 선택을 지키고, 밖이면 그 줄 하나만 고른다.
    if (entry) this.#h.sel.pickForMenu(entry.path, this.#h.order);
    // 이 메뉴의 "여기" — 항목 메뉴면 그 줄의 대상 폴더, 빈 곳이면 뿌리. 메뉴가 닫힌 뒤에 도는
    // 항목(붙여넣기·업로드)이 읽으므로 메뉴 상태 밖에 스냅숏해 둔다 (docs/conventions.md 의 메뉴 규칙).
    this.menuDir = this.#h.targetDirOfEntry(entry);
    // 창 밖으로 나가지 않게 대충 클램프한다 (메뉴는 최대 220×320 쯤이다).
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
    // 확장자를 남기고 이름만 고르는 것이 관례지만, 원격 파일은 확장자가 없는 것이 흔해
    // (로그·소켓·바이너리) 전체를 고른다 — 어차피 바로 타이핑하면 지워진다.
    await focusInlineEdit(this.edit, true);
  };

  startNewFolder = (dir: string) => this.#startNew(dir, "newfolder");

  /** [새 파일…] — 새 폴더와 같은 대상 폴더(`menuDir`)에 이름 칸을 연다 */
  startNewFile = (dir: string) => this.#startNew(dir, "newfile");

  #startNew = async (dir: string, mode: "newfolder" | "newfile") => {
    if (this.#h.backend.isSyntheticRoot(dir)) return;
    this.newFolderDir = dir;
    beginInlineEdit(this.edit, "");
    this.menuMode = mode;
    await focusInlineEdit(this.edit);
  };

  /**
   * 삭제 확인을 연다. 대상은 **고른 것 전부**이고, 고른 것이 없으면 우클릭한 그 줄 하나다
   * (`openMenu` 가 이미 그 줄을 골라 두므로 대개는 같은 값이 된다).
   */
  startRemove = () => {
    const anchor = this.menu?.entry;
    const list = this.#h.selPaths.length > 0 ? this.#h.selPaths : anchor ? [anchor.path] : [];
    if (list.length === 0 || list.some(this.#h.isRootItem)) return;
    this.removeTargets = list;
    this.edit.error = null;
    this.confirmRecursive = false;
    this.menuMode = "confirm";
  };

  /**
   * 툴바 ＋ [폴더] — **대상 폴더**에 새 폴더 (들어가기 보기 = 지금 폴더, 트리 = 고른 줄의 폴더).
   * 좌표가 없으므로 트리에서 대상이 하위 폴더면 그 줄 아래에, 아니면 목록 위쪽에 띄운다.
   */
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
