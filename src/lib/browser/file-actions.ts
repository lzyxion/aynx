// 파일 타일의 항목 조작 — 열기(폴더 = 들어가기 · 텍스트 = 문서 타일 · 그 밖 = 편집/기본 앱) · 탐색기에서 보기 ·
// 클립보드(복사·잘라내기·붙여넣기) · 업로드 파일 칸 · 경로 복사 · 터미널에서 cd. `SftpBrowser.svelte` 가 옛 자리에서
// 하나 만들고, 메뉴(`FileMenu` — `runOnMenu` 통로)·키보드(`file-keys`)·목록(`FileList`)이 부른다. `$effect` 없음.
import { broadcastInput } from "$lib/sync.svelte";
import { toast } from "$lib/toast.svelte";
import type { FsBackend } from "$lib/fs-backend";
import { fsClip, setFsClip, type FsClipMode } from "$lib/fs-clipboard.svelte";
import { writeClipboard } from "$lib/clipboard";
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
import { isTextLike } from "$lib/doc-lang";
import type { Transfers } from "$lib/browser/fs-transfer.svelte";
import { failureOf, type FileListing } from "$lib/browser/file-listing.svelte";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 항목 조작이 타일에서 읽고 부르는 것 — 전부 게터라 그때그때의 값이다 */
export interface FileActionsHost {
  readonly backend: FsBackend;
  readonly offline: boolean;
  /** 지금 자리가 합성 루트("내 PC") 인가 */
  readonly atRoot: boolean;
  readonly isTree: boolean;
  readonly selPaths: string[];
  readonly focusEntry: SftpEntry | null;
  readonly transfers: Transfers;
  readonly fileInput: HTMLInputElement | null;
  /** 원본 터미널의 패널 id — "터미널에서 여기로 cd" 가 쓴다 */
  readonly sourcePaneId: string | null;
  readonly onopendoc?: (path: string) => void;
  readonly onupload?: (remoteDir: string, files: File[]) => void;
  readonly onnotice?: (message: string) => void;
  isRootItem(path: string): boolean;
  /** 그 폴더로 들어간다 (끊겼으면 아무것도 안 한다) */
  goTo(path: string): void;
}

export class FileActions {
  #h: FileActionsHost;
  #ls: FileListing;

  /**
   * 파일 칸이 고른 것을 보낼 폴더 — 칸을 여는 순간 정해 둔다(툴바 = 대상 폴더, 빈 곳 메뉴 = 뿌리).
   * 대화상자가 떠 있는 동안 선택이 바뀌어도 사람이 누른 그 순간의 자리로 간다.
   */
  uploadDir = "";

  constructor(h: FileActionsHost, ls: FileListing) {
    this.#h = h;
    this.#ls = ls;
  }

  /**
   * 항목 하나를 "연다" — 들어갈 수 있으면 들어가고, 아니면 백엔드가 할 수 있는 쪽으로.
   *
   * 파일의 뜻이 백엔드마다 다르다: 원격은 **로컬 편집기로 내려받아 열고**(저장하면 자동
   * 업로드), 로컬은 **기본 앱으로 연다**. 둘 다 "그 파일로 뭔가 하려는" 같은 몸짓이라
   * 더블클릭·Enter 하나에 묶어 두고, 무엇이 일어나는지는 능력 플래그가 정한다.
   *
   * **텍스트로 보이는 파일은 미리 보기가 먼저다** (docs/log/2026-09-27-doc-tile.md · 사용자 결정 2026-09-27) —
   * 판정은 `isTextLike`(이름·확장자 표) 하나이고, 모르는 확장자는 예전 그대로다(보수적). 외부 편집·기본 앱으로
   * 열기는 우클릭 메뉴에 그대로 남는다.
   */
  openEntry = (entry: SftpEntry) => {
    if (isDirLike(entry)) {
      this.#h.goTo(entry.path);
      return;
    }
    const onopendoc = this.#h.onopendoc;
    if (onopendoc && this.#h.backend.canView && isTextLike(entry.name)) {
      onopendoc(entry.path);
      return;
    }
    if (this.#h.backend.canEdit) void this.editEntry(entry);
    else if (this.#h.backend.canOpenExternal) void this.openExternally(entry);
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

  /** 기본 앱으로 열기 (로컬 전용) */
  openExternally = async (entry: SftpEntry) => {
    const backend = this.#h.backend;
    if (!backend.openExternal) return;
    try {
      await backend.openExternal(entry.path);
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  /** 탐색기에서 보기 (로컬 전용) — 폴더도 파일도 그 항목이 **골라진 채로** 열린다 */
  revealEntry = async (entry: SftpEntry) => {
    const backend = this.#h.backend;
    if (!backend.reveal) return;
    try {
      await backend.reveal(entry.path);
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  /** 지금 보고 있는 폴더를 탐색기로 (배경 우클릭) — 합성 루트에는 열 자리가 없다 */
  revealHere = async () => {
    const backend = this.#h.backend;
    if (!backend.reveal || !this.#ls.hasCwd || this.#h.atRoot) return;
    try {
      await backend.reveal(this.#ls.cwd);
    } catch (e) {
      this.#ls.error = failureOf(e);
    }
  };

  // ── 클립보드 (docs/log/2026-09-04-fs-multiselect-clipboard.md) ───────────────

  /** 조작의 대상 — 고른 것이 있으면 그것들, 없으면 커서가 앉은 한 줄 (탐색기의 관례) */
  targets = (): string[] => {
    if (this.#h.selPaths.length > 0) return this.#h.selPaths;
    const focusEntry = this.#h.focusEntry;
    return focusEntry ? [focusEntry.path] : [];
  };

  copySelection = (mode: FsClipMode) => {
    const paths = this.targets();
    // "내 PC" 의 드라이브 뿌리는 담아 봐야 붙일 수 없다
    if (paths.length === 0 || paths.some(this.#h.isRootItem)) return;
    setFsClip(mode, this.#h.backend.key, paths);
  };

  /**
   * 붙여넣기 — `dir` 로. 트리에서 뿌리가 아닌 폴더에 붙이면 **그 폴더를 펼쳐 둔다** — 접힌 채면
   * 방금 놓인 것이 보이지 않아 "됐나?" 가 된다(끝난 뒤 다시 읽기가 펼친 폴더까지 읽고 골라 둔다).
   */
  pasteInto = (dir: string) => {
    if (!fsClip()) return;
    if (this.#h.isTree && dir !== this.#ls.cwd) this.#ls.expand(dir);
    void this.#h.transfers.pasteInto(dir);
  };

  // ── 업로드 ──────────────────────────────────────────────────────────────────

  /**
   * ⬆ 업로드 — **웹 파일 칸**(`<input type="file">`)으로 고른다.
   *
   * Tauri 의 `open` 대화상자를 쓰지 않는 이유가 있다: 그쪽은 **경로 문자열**을 주는데,
   * 기존 업로드 경로(`upload_file`)는 파일 **내용**을 raw 바디로 보내므로 `File` 객체가
   * 필요하다. `<input type="file">` 은 웹뷰가 같은 OS 파일 선택 창을 띄우면서 `File` 을
   * 그대로 주므로, 화면상 차이 없이 기존 경로를 그대로 탄다.
   */
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

  /**
   * 파일 목록을 `dir` 로 — 상위의 업로드 모달로 넘긴다.
   *
   * **빈 바닥에 끌어다 놓는 길은 여기로 오지 않는다** — 그쪽은 `PaneHost` 의 드래그
   * 기계장치를 지나 `+page` 의 `dropFiles` 로 가고, 목적지 경로는 이 컴포넌트가
   * `oncwd` 로 올려 둔 값(뿌리)에서 읽힌다. 트리 보기의 **폴더 줄 위**에 놓은 것은 드래그
   * 제어기가 받아 여기로 온다(`receiveFiles`).
   */
  uploadTo = (dir: string, files: File[]) => {
    const backend = this.#h.backend;
    if (this.#h.offline || !this.#ls.hasCwd || !backend.canUpload || backend.isSyntheticRoot(dir)) return;
    this.#h.onupload?.(dir, files);
  };

  // ── 우클릭 메뉴 ─────────────────────────────────────────────────────────────

  copyPath = async (entry: SftpEntry) => {
    // OS 클립보드로 나가는 문은 `$lib/clipboard` 하나다 (실패를 다루는 방식이 한 자리에 있다).
    if (await writeClipboard(entry.path)) this.#h.onnotice?.(t("files.browser.copypath.done"));
    else toast.error(t("files.browser.copypath.fail"));
  };

  /**
   * "터미널에서 여기로 cd" — 원본 터미널에 `cd '<경로>'` 한 줄을 **친 것처럼** 넣는다.
   *
   * 동시 입력 레지스트리(`broadcastInput`)를 그대로 쓴다: 터미널에 문자열을 흘려 넣는
   * 통로는 앱에 그것 하나뿐이고, 키가 패널 id 라 원본 타일만 정확히 골라 보낼 수 있다.
   * 작은따옴표로 감싸는 것은 공백·한글 경로 때문이고, 경로 안의 `'` 는 셸 관례대로
   * `'\''` 로 끊어 이어 붙인다.
   */
  cdHere = () => {
    const target = this.#h.sourcePaneId;
    if (!target || !this.#ls.hasCwd) return;
    const quoted = `'${this.#ls.cwd.replaceAll("'", `'\\''`)}'`;
    broadcastInput([target], `cd ${quoted}\r`);
    this.#h.onnotice?.(t("files.browser.cdhere.done"));
  };
}
