import { Channel, invoke, isRemote } from "./ipc";
import { localWatch, type FsWatch } from "./fs-watch";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { editRemoteFile } from "$lib/sftp";
import {
  localConflicts,
  localCopy,
  localMove,
  localRemoveMany,
  localToSftpMove,
  localWriteFile,
  sftpConflicts,
  sftpCopy,
  sftpCopyBetween,
  sftpDownloadPaths,
  sftpMove,
  sftpMoveBetween,
  sftpRemoveMany,
  sftpToLocalMove,
  sftpUploadPaths,
  transferCancel,
  type Conflict,
  type OnConflict,
  type OnProgress,
  type TransferProgress,
} from "$lib/fs-ops";
import {
  crumbsOf as posixCrumbsOf,
  errorOf,
  joinPath as posixJoinPath,
  parentOf as posixParentOf,
  sftpDownload,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpCreateFile,
  sftpRemove,
  sftpRename,
  sftpStat,
  type SftpEntry,
} from "$lib/sftp-browser";
import { withReason } from "$lib/error-reason";
import { translateNow } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import type { Tr } from "$lib/session";

/**
 * 파일 브라우저의 백엔드 어댑터 — 원격(`sftp_*`, POSIX) · 로컬(`local_*`, 윈도우 경로).
 * 능력 플래그는 버튼이 묻는 질문 그대로 둔다(종류 검사 대신). 플래그가 참이면 그 메서드가 있어야 한다.
 */
export interface FsBackend {
  /** 같은 원본인가의 비교 키 — 객체 신원(`===`)으로 보면 리렌더마다 헛되이 다시 읽는다 */
  readonly key: string;
  /** 원격은 세션이 없으면 거짓, 로컬은 언제나 참 */
  readonly online: boolean;
  readonly sep: "/" | "\\";
  /** 원격은 업로드, 로컬은 가져오기 — OS 파일 드롭은 경로가 아니라 내용(`File`)을 준다([`uploadBytes`]) */
  readonly canUpload: boolean;
  readonly canDownload: boolean;
  readonly canEdit: boolean;
  /** 원격 창에서는 거짓 — [`localShellCaps`] */
  readonly canOpenExternal: boolean;
  /** 원격 창에서는 거짓 — [`localShellCaps`] */
  readonly canReveal: boolean;
  /** 능력이다 — 지금 부를 수 있는지는 `online` 이 말한다(세션 없는 원격은 `[session-gone]` 으로 실패) */
  readonly canView: boolean;
  /** 능력이다 — `canView` 와 같다 */
  readonly canWrite: boolean;

  /** 로컬만(`["C:\\", "D:\\"]`), 원격은 `null` */
  roots(): Promise<string[]> | null;
  /** 로컬의 `""`("내 PC") 하나뿐 — 만들 자리도 지울 것도 없어 화면이 그 조작들을 끈다 */
  isSyntheticRoot(path: string): boolean;

  home(): Promise<string>;
  /** 실패하면 빈 목록이다 */
  places(): Promise<BackendPlace[]>;
  /** 모르면 `null` — 던지지 않는다. 원격은 서버가 `statvfs@openssh.com` 확장을 알릴 때만 */
  freeSpace(path: string): Promise<DiskSpace | null>;
  list(path: string): Promise<SftpEntry[]>;
  stat(path: string): Promise<SftpEntry>;
  mkdir(path: string): Promise<string>;
  /** 이미 있으면 `[exists]` 로 거절하고 덮어쓰지 않는다 */
  createFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<string>;
  remove(path: string, recursive: boolean): Promise<void>;

  // ── 묶음 작업 ──
  // 두 백엔드가 모두 하는 일이라 플래그도 옵셔널도 없다 — 백엔드가 늘면 반드시 채운다.

  /** 돌려주는 값은 실제로 놓인 자리들(이름이 밀렸으면 밀린 이름) */
  copy(
    paths: readonly string[],
    destDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 이름 바꾸기 한 번이라 진행률도 취소도 없다 */
  move(paths: readonly string[], destDir: string, onConflict: OnConflict): Promise<string[]>;
  /** 첫 실패에서 멈추고 어디까지 했는지를 오류에 싣는다 */
  removeMany(paths: readonly string[], recursive: boolean): Promise<void>;
  /** 최상위 항목만 */
  conflicts(paths: readonly string[], destDir: string): Promise<Conflict[]>;
  /** 없는 번호도 성공 */
  cancel(op: number): Promise<void>;

  // ── 서로 다른 곳 사이 ──
  // 원격 백엔드에만 있다. 목적지가 원격이면 목적지가, 로컬이면 출발지가 부른다(로컬 백엔드에는 세션이 없다).

  copyFromRemote?(
    from: FsBackend,
    paths: readonly string[],
    destDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  /** 항목 단위 — 하나가 놓인 뒤 그 원본 삭제 */
  moveFromRemote?(
    from: FsBackend,
    paths: readonly string[],
    destDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  uploadPathsMove?(
    localPaths: readonly string[],
    remoteDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  downloadPathsMove?(
    remotePaths: readonly string[],
    localDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;

  uploadPaths?(
    localPaths: readonly string[],
    remoteDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;
  downloadPaths?(
    remotePaths: readonly string[],
    localDir: string,
    onConflict: OnConflict,
    op: number,
    onProgress: OnProgress | null,
  ): Promise<string[]>;

  /** 로컬만 — 원격의 짝은 세션을 받는 `uploadFile`(`sftp.ts`). 건너뛰었으면 `null` */
  uploadBytes?(destDir: string, file: File, onConflict: OnConflict, tr: Tr): Promise<string | null>;

  /** 흐르는 값은 받은 누적 바이트 */
  download?(remote: string, local: string, onBytes: (received: number) => void): Promise<number>;
  /** 돌려주는 값은 안내에 쓸 파일 이름 */
  edit?(path: string): Promise<string>;
  openExternal?(path: string): Promise<void>;
  reveal?(path: string): Promise<void>;
  /**
   * 미리 보기 그림의 원시 바이트(`ipc::Response`) — 화면은 Blob URL 로 그린다(자산 프로토콜의 허용 범위를 넓히지 않는 길).
   * 상한(`browser/preview.ts` 의 `PREVIEW_MAX_BYTES`)을 넘거나 폴더면 실패한다.
   */
  readPreview(path: string): Promise<ArrayBuffer>;
  /**
   * 이미지 타일의 큰 그림 — 상한은 `image/read-plan.ts` 의 `IMAGE_MAX_BYTES`(Rust `text_file::IMAGE_MAX_BYTES`).
   * 취소는 같은 `op` 로 [`cancel`] — `[cancelled]` 로 실패한다. 원격 창의 [이 기기로 다운로드]도 이 길을 쓴다.
   */
  readImage(path: string, op: number, onProgress: OnProgress | null): Promise<ArrayBuffer>;
  readText?(path: string): Promise<TextFile>;
  /**
   * `expectedVersion` 이 디스크의 지금 version 과 다르면 `[conflict]`, 파일이 없으면 `[missing]`. `null` 은 [덮어쓰기] 강제 저장뿐이다.
   * 돌려주는 `version` 이 다음 저장의 `expectedVersion` 이다.
   */
  writeText?(path: string, text: string, expectedVersion: string | null): Promise<SavedFile>;
  /** 로컬만 — 원격 파일 타일은 ⟳ 로만 읽는다 */
  watch?(onChange: (dirs: string[]) => void): FsWatch;
  /** 로컬만(원격은 `file-picker.ts` 가 SFTP 로 떨어진다). 타입이 인라인인 것은 `file-picker.ts` 를 들이면 고리가 되기 때문이다 */
  listTextFiles?(
    root: string,
    limit: number,
  ): Promise<{ root: string; files: { rel: string; path: string }[]; truncated: boolean }>;

  /** 더 갈 곳이 없으면 자기 자신 (화면의 ↑ 비활성 판정) */
  parentOf(path: string): string;
  joinPath(dir: string, name: string): string;
  crumbsOf(path: string): Crumb[];
}

/** Rust `text_file::VIEW_MAX_BYTES` 의 짝 — 그쪽이 바뀌면 여기도 고친다 */
export const TEXT_VIEW_MAX_BYTES = 2 * 1024 * 1024;

/** Rust `text_file::TextFile` 의 짝(serde camelCase) */
export interface TextFile {
  /** `binary` 면 `""` */
  text: string;
  /** 파일 전체 크기 — 잘렸으면 `text` 보다 크다 */
  size: number;
  truncated: boolean;
  /** 앞 8 KiB 에 NUL 이 있었다 — 보여 주지 않는다 */
  binary: boolean;
  /** UTF-8 이 아닌 바이트가 대체 문자로 바뀌었다 */
  lossy: boolean;
  /** 불투명하다 — 같은지 비교만 한다 */
  version: string;
}

/** Rust `text_file::SavedFile` 의 짝 */
export interface SavedFile {
  version: string;
  size: number;
}

/** Rust `fs_space::DiskSpace` 의 짝(`free` 는 이 사용자가 쓸 수 있는 만큼) */
export interface DiskSpace {
  free: number;
  total: number;
}

/** Rust `local_browser::LocalPlace` 의 짝. `label` 이 있으면 종류로 찾은 사전 이름을 이긴다 */
export interface BackendPlace {
  kind: "home" | "desktop" | "documents" | "downloads" | "root";
  path: string;
  label?: string;
}

export interface Crumb {
  label: string;
  path: string;
  /** 합성 루트(`내 PC`)의 문구 키 — 있으면 `label` 은 비어 있다 */
  labelKey?: Key;
}

/** 화면이 미리 막는다 — 윈도우의 `:` · `\` 는 백엔드에서 경로로 해석돼 이름 바꾸기가 조용히 옮기기가 된다 */
export function nameError(name: string, sep: string): Key | null {
  if (sep === "\\") {
    return /[\\/:*?"<>|]/.test(name) ? "files.ops.name.windows" : null;
  }
  return name.includes("/") ? "files.ops.name.posix" : null;
}

// ── 윈도우 경로 문법 ──

function uncRootOf(path: string): string | null {
  const m = /^\\\\([^\\]+)\\([^\\]+)/.exec(path);
  return m ? `\\\\${m[1]}\\${m[2]}` : null;
}

/** 백엔드는 `/` 와 `\` 를 모두 받지만 화면은 한 벌로만 비교 · 표시해야 한다. `""` = 합성 루트 */
export function winNormalize(path: string): string {
  const raw = path.trim();
  if (raw === "") return "";
  const unc = /^[\\/]{2}[^\\/]/.test(raw);
  // UNC 의 앞 두 개도 함께 접히므로 뒤에서 되살린다
  let out = raw.replace(/[\\/]+/g, "\\");
  if (unc) out = `\\${out}`;
  if (/^[A-Za-z]:$/.test(out)) return `${out}\\`;
  if (out.length > 1 && out.endsWith("\\") && !/^[A-Za-z]:\\$/.test(out)) {
    out = out.replace(/\\+$/, "");
  }
  return out;
}

/** 드라이브 뿌리와 UNC 공유 뿌리의 위는 `""`(내 PC) — 공유 목록을 읽는 명령이 백엔드에 없다 */
export function winParentOf(path: string): string {
  const p = winNormalize(path);
  if (p === "") return "";
  if (/^[A-Za-z]:\\$/.test(p)) return "";
  const unc = uncRootOf(p);
  if (unc !== null && unc === p) return "";
  const at = p.lastIndexOf("\\");
  if (at < 0) return "";
  const head = p.slice(0, at);
  if (/^[A-Za-z]:$/.test(head)) return `${head}\\`;
  if (unc !== null && head.length < unc.length) return unc;
  return head === "" ? "" : head;
}

export function winJoinPath(dir: string, name: string): string {
  const base = winNormalize(dir);
  if (base === "") return winNormalize(name);
  return base.endsWith("\\") ? `${base}${name}` : `${base}\\${name}`;
}

/** 언제나 내 PC 부터다. UNC 는 공유 전체가 한 조각이다 */
export function winCrumbsOf(path: string): Crumb[] {
  const out: Crumb[] = [{ label: "", path: "", labelKey: "files.browser.mypc" }];
  const p = winNormalize(path);
  if (p === "") return out;

  const unc = uncRootOf(p);
  let head: string;
  if (unc !== null) {
    head = unc;
    out.push({ label: unc, path: unc });
  } else {
    const drive = /^([A-Za-z]:)/.exec(p);
    if (!drive) return out; // 모양을 못 알아보면 뿌리만 (상대 경로는 백엔드가 이미 거절한다)
    head = `${drive[1]}\\`;
    out.push({ label: drive[1], path: head });
  }

  let at = head;
  for (const seg of p.slice(head.length).split("\\")) {
    if (seg === "") continue;
    at = at.endsWith("\\") ? `${at}${seg}` : `${at}\\${seg}`;
    out.push({ label: seg, path: at });
  }
  return out;
}

// ── 로컬 명령 래퍼 — 실패를 삼키지 않는다 ──

async function localHome(): Promise<string> {
  try {
    return await invoke<string>("local_home");
  } catch (e) {
    throw errorOf(e, "files.ops.fail.home");
  }
}

async function localPlaces(): Promise<BackendPlace[]> {
  try {
    return await invoke<BackendPlace[]>("local_places");
  } catch (e) {
    console.warn("[aynx] 장소 패널의 붙박이 폴더를 읽지 못했습니다 (무시):", e);
    return [];
  }
}

async function freeSpaceOf(command: string, args: Record<string, unknown>): Promise<DiskSpace | null> {
  try {
    return (await invoke<DiskSpace | null>(command, args)) ?? null;
  } catch {
    return null;
  }
}

async function localRoots(): Promise<string[]> {
  try {
    return await invoke<string[]>("local_roots");
  } catch (e) {
    throw errorOf(e, "files.ops.fail.roots");
  }
}

async function localList(path: string): Promise<SftpEntry[]> {
  try {
    return await invoke<SftpEntry[]>("local_list", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.list", { path });
  }
}

async function localStat(path: string): Promise<SftpEntry> {
  try {
    return await invoke<SftpEntry>("local_stat", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.stat", { path });
  }
}

async function localMkdir(path: string): Promise<string> {
  try {
    return await invoke<string>("local_mkdir", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

async function localCreateFile(path: string): Promise<string> {
  try {
    return await invoke<string>("local_create_file", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

async function localRename(from: string, to: string): Promise<string> {
  try {
    return await invoke<string>("local_rename", { from, to });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.rename", { path: from });
  }
}

async function localRemove(path: string, recursive: boolean): Promise<void> {
  try {
    await invoke("local_remove", { path, recursive });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.remove", { path });
  }
}

async function localReadPreview(path: string): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("local_read_preview", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

async function sftpReadPreview(session: number, path: string): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("sftp_read_preview", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

/** 진행률 채널은 늘 만든다 — 백엔드가 그 인자를 필수로 받는다. `[cancelled]` · `[session-gone]` 표식은 문구에 남는다 */
async function readImageVia(command: string, args: Record<string, unknown>, path: string, onProgress: OnProgress | null): Promise<ArrayBuffer> {
  const channel = new Channel<TransferProgress>();
  if (onProgress) channel.onmessage = (p) => onProgress(p);
  try {
    return await invoke<ArrayBuffer>(command, { ...args, path, onProgress: channel });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

async function localReadText(path: string): Promise<TextFile> {
  try {
    return await invoke<TextFile>("local_read_text", { path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

async function sftpReadText(session: number, path: string): Promise<TextFile> {
  try {
    return await invoke<TextFile>("sftp_read_text", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.open", { path });
  }
}

/** `[conflict]` · `[missing]` · `[session-gone]` 표식이 문구에 남아야 화면이 `hasReason` 으로 가른다(`errorOf` 는 백엔드 문구를 그대로 싣는다) */
async function localWriteText(path: string, text: string, expectedVersion: string | null): Promise<SavedFile> {
  try {
    return await invoke<SavedFile>("local_write_text", { path, text, expectedVersion });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.write", { name: baseNameOf(path) });
  }
}

async function sftpWriteText(
  session: number,
  path: string,
  text: string,
  expectedVersion: string | null,
): Promise<SavedFile> {
  try {
    return await invoke<SavedFile>("sftp_write_text", { session, path, text, expectedVersion });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.write", { name: baseNameOf(path) });
  }
}

/** 크기 · 시각 · 권한은 모른다 — 지어내지 않는다 */
function rootEntry(root: string): SftpEntry {
  return {
    name: root.replace(/[\\/]+$/, ""), // "C:\" → "C:"
    path: root,
    kind: "dir",
    size: 0,
    mtime: null,
    mode: null,
    symlinkTarget: null,
    linkIsDir: false,
    hidden: false,
  };
}

// ── 팩토리 ──

/** 백엔드와 같은 `[session-gone]` 표식 — 화면은 오류 대신 "연결 대기" 배너로 접는다. 룬을 못 들여 `translateNow` 를 쓴다 */
function noSession(): never {
  throw new Error(withReason("session-gone", translateNow("files.ops.session.gone")));
}

const OFFLINE_REMOTE: FsBackend = makeRemote(null);

/** 객체 신원을 고정하려고 캐시한다 — 리렌더마다 새 객체면 `$effect` 가 헛돈다 */
const REMOTE_CACHE = new Map<number, FsBackend>();

/** 재연결로 세션 id 가 바뀌면 [`key`] 가 바뀌고, 브라우저가 보던 경로를 다시 읽는다 */
export function remoteBackend(session: number | null): FsBackend {
  if (session === null) return OFFLINE_REMOTE;
  const cached = REMOTE_CACHE.get(session);
  if (cached) return cached;
  const made = makeRemote(session);
  REMOTE_CACHE.set(session, made);
  return made;
}

function sessionOfKey(key: string): number | null {
  const m = /^ssh:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** 없으면 부르기 전에 멈춘다 (로컬을 원격 자리에 넘긴 배선 실수) */
function otherSession(from: FsBackend): number {
  const id = sessionOfKey(from.key);
  if (id === null) noSession();
  return id;
}

/**
 * 원격 창에서는 거짓 — 메인 PC 의 편집기를 띄우는 일이라 `remote/deny.rs` 가 `edit_remote_file` 을 거절한다.
 * 메서드(`edit`)는 그대로 둔다. `remoteWindow` 는 시험을 위해 인자로 받는다.
 */
export function remoteEditCap(remoteWindow: boolean = isRemote): boolean {
  return !remoteWindow;
}

function makeRemote(session: number | null): FsBackend {
  const sid = () => (session === null ? noSession() : session);
  return {
    key: session === null ? "ssh:none" : `ssh:${session}`,
    online: session !== null,
    sep: "/",
    canUpload: true,
    canDownload: true,
    canEdit: remoteEditCap(),
    canOpenExternal: false,
    canReveal: false,
    canView: true,
    canWrite: true,
    roots: () => null,
    isSyntheticRoot: () => false,
    home: () => sftpHome(sid()),
    places: async () => {
      if (session === null) return [];
      const root: BackendPlace = { kind: "root", path: "/", label: "/" };
      try {
        return [{ kind: "home", path: await sftpHome(session), label: "~" }, root];
      } catch {
        return [root];
      }
    },
    freeSpace: (path) =>
      session === null ? Promise.resolve(null) : freeSpaceOf("sftp_free_space", { session, path }),
    list: (path) => sftpList(sid(), path),
    stat: (path) => sftpStat(sid(), path),
    mkdir: (path) => sftpMkdir(sid(), path),
    createFile: (path) => sftpCreateFile(sid(), path),
    rename: (from, to) => sftpRename(sid(), from, to),
    remove: (path, recursive) => sftpRemove(sid(), path, recursive),
    copy: (paths, destDir, onConflict, op, onProgress) =>
      sftpCopy(sid(), paths, destDir, onConflict, op, onProgress),
    move: (paths, destDir, onConflict) => sftpMove(sid(), paths, destDir, onConflict),
    removeMany: (paths, recursive) => sftpRemoveMany(sid(), paths, recursive),
    conflicts: (paths, destDir) => sftpConflicts(sid(), paths, destDir),
    cancel: (op) => transferCancel(op),
    uploadPaths: (localPaths, remoteDir, onConflict, op, onProgress) =>
      sftpUploadPaths(sid(), localPaths, remoteDir, onConflict, op, onProgress),
    downloadPaths: (remotePaths, localDir, onConflict, op, onProgress) =>
      sftpDownloadPaths(sid(), remotePaths, localDir, onConflict, op, onProgress),
    copyFromRemote: (from, paths, destDir, onConflict, op, onProgress) =>
      sftpCopyBetween(otherSession(from), paths, sid(), destDir, onConflict, op, onProgress),
    moveFromRemote: (from, paths, destDir, onConflict, op, onProgress) =>
      sftpMoveBetween(otherSession(from), paths, sid(), destDir, onConflict, op, onProgress),
    uploadPathsMove: (localPaths, remoteDir, onConflict, op, onProgress) =>
      localToSftpMove(sid(), localPaths, remoteDir, onConflict, op, onProgress),
    downloadPathsMove: (remotePaths, localDir, onConflict, op, onProgress) =>
      sftpToLocalMove(sid(), remotePaths, localDir, onConflict, op, onProgress),
    download: (remote, local, onBytes) => sftpDownload(sid(), remote, local, onBytes),
    edit: async (path) => (await editRemoteFile(sid(), path)).file_name,
    readText: (path) => sftpReadText(sid(), path),
    // async — 세션 없음(`sid()` 의 던짐)도 거절된 약속으로 온다
    readPreview: async (path) => sftpReadPreview(sid(), path),
    readImage: async (path, op, onProgress) => readImageVia("sftp_read_image", { session: sid(), op }, path, onProgress),
    // async — 세션 없음(`sid()` 의 던짐)도 거절된 약속으로 온다: 저장 쪽은 `.catch` 하나로 받는다
    writeText: async (path, text, expectedVersion) =>
      sftpWriteText(sid(), path, text, expectedVersion),
    parentOf: posixParentOf,
    joinPath: posixJoinPath,
    crumbsOf: posixCrumbsOf,
  };
}

/** 창을 넘어도 같은 뜻인 유일한 키다 — 원격 키의 세션 번호는 창마다 따로 도는 카운터다 */
export const LOCAL_KEY = "local";

/**
 * 원격 창에서는 둘 다 거짓 — 원격 창의 폴리필이 `opener|open_path` · `opener|reveal_item_in_dir` 를 거절한다(`remote/polyfill.js`).
 * 메서드는 그대로 둔다(플래그가 거짓이면 화면이 부르지 않는다). `remoteWindow` 는 시험을 위해 인자로 받는다.
 */
export function localShellCaps(remoteWindow: boolean = isRemote): { canOpenExternal: boolean; canReveal: boolean } {
  return { canOpenExternal: !remoteWindow, canReveal: !remoteWindow };
}

/** 합성 루트 `""` = "내 PC" — `local_roots` 를 디렉터리 목록처럼 돌려준다 */
const LOCAL: FsBackend = {
  key: LOCAL_KEY,
  online: true,
  sep: "\\",
  // 탐색기에서 끌어다 놓은 파일을 받는 자리다
  canUpload: true,
  canDownload: false,
  canEdit: false,
  ...localShellCaps(),
  canView: true,
  canWrite: true,
  roots: () => localRoots(),
  isSyntheticRoot: (path) => winNormalize(path) === "",
  home: () => localHome(),
  places: () => localPlaces(),
  freeSpace: (path) => (winNormalize(path) === "" ? Promise.resolve(null) : freeSpaceOf("local_free_space", { path })),
  list: async (path) => {
    if (winNormalize(path) === "") return (await localRoots()).map(rootEntry);
    return localList(path);
  },
  stat: (path) => localStat(path),
  mkdir: (path) => localMkdir(path),
  createFile: (path) => localCreateFile(path),
  rename: (from, to) => localRename(from, to),
  remove: (path, recursive) => localRemove(path, recursive),
  copy: (paths, destDir, onConflict, op, onProgress) =>
    localCopy(paths, destDir, onConflict, op, onProgress),
  move: (paths, destDir, onConflict) => localMove(paths, destDir, onConflict),
  removeMany: (paths, recursive) => localRemoveMany(paths, recursive),
  conflicts: (paths, destDir) => localConflicts(paths, destDir),
  cancel: (op) => transferCancel(op),
  uploadBytes: (destDir, file, onConflict, tr) => localWriteFile(destDir, file, onConflict, tr),
  openExternal: async (path) => {
    try {
      await openPath(path);
    } catch (e) {
      throw errorOf(e, "files.ops.fail.open", { path });
    }
  },
  reveal: async (path) => {
    try {
      await revealItemInDir(path);
    } catch (e) {
      throw errorOf(e, "files.ops.fail.reveal", { path });
    }
  },
  readText: (path) => localReadText(path),
  readPreview: (path) => localReadPreview(path),
  readImage: (path, op, onProgress) => readImageVia("local_read_image", { op }, path, onProgress),
  writeText: (path, text, expectedVersion) => localWriteText(path, text, expectedVersion),
  watch: (onChange) => localWatch(onChange),
  // 감싸지 않는다 — 팔레트가 받던 실패 문구 그대로(`stripReason` 은 부르는 쪽)
  listTextFiles: (root, limit) =>
    invoke<{ root: string; files: { rel: string; path: string }[]; truncated: boolean }>("list_text_files", { root, limit }),
  parentOf: winParentOf,
  joinPath: winJoinPath,
  crumbsOf: winCrumbsOf,
};

export function localBackend(): FsBackend {
  return LOCAL;
}

/**
 * 드래그 · 클립보드의 짐에는 키만 싣고 받는 쪽이 여기서 편다. 모르는 모양이면 `null`.
 * 재연결 뒤의 옛 키는 살아 있는 객체를 돌려주지만 그 명령이 실패한다 — 새 세션으로 바꿔치기하면 A 서버에서 자른 것이 B 서버에 붙는다.
 */
export function backendFromKey(key: string): FsBackend | null {
  if (key === LOCAL.key) return LOCAL;
  const session = sessionOfKey(key);
  if (session === null) return null;
  return remoteBackend(session);
}

/** 구분자 둘(`/` · `\`)을 함께 본다 — 어느 백엔드의 경로든 통한다 */
export function baseNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}
