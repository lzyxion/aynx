import { Channel, invoke } from "./ipc";
import { errorOf } from "$lib/sftp-browser";
import { rawUploadTooBig } from "$lib/sftp";
import type { Key } from "$lib/i18n/keys";
import type { Tr } from "$lib/session";
import { hasReason } from "$lib/error-reason";

/**
 * 파일 묶음 작업 — Rust `fs_transfer` · `local_browser` · `sftp_browser` 의 얇은 래퍼. 실패를 삼키지 않는다.
 * `op` 는 프런트가 정한다 — 백엔드가 발급하면 명령이 끝난 뒤에야 번호를 알아 취소를 못 누른다.
 */

export type OnConflict = "fail" | "overwrite" | "skip" | "rename";

/** 이미 그 자리에 있는 쪽의 절대 경로다 (원본이 아니다) */
export interface Conflict {
  path: string;
  kind: "file" | "dir";
}

/** 값은 전부 누적 총합이다 (증분이 아니다) */
export interface TransferProgress {
  op: number;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  /** 지금 쓰고 있는 대상 경로 (시작 전 · 끝난 뒤에는 `""`) */
  current: string;
}

export type OnProgress = (progress: TransferProgress) => void;

/** 취소는 오류로 돌아오고 감싸여 올라오기도 한다 — 판정은 접두사가 들어 있는가다(`$lib/error-reason` 머리말의 규칙 1) */
export function isTransferCanceled(message: string): boolean {
  return hasReason(message, "cancelled");
}

/** 창 안에서만 유일하면 된다 */
let opCounter = 0;
export function nextOp(): number {
  opCounter += 1;
  return opCounter;
}

/** 채널은 `onProgress` 가 없어도 만든다 — 백엔드가 그 인자를 필수로 받아 빼면 역직렬화에서 거절된다 */
async function runTransfer(
  command: string,
  args: Record<string, unknown>,
  onProgress: OnProgress | null,
  fallback: Key,
): Promise<string[]> {
  const channel = new Channel<TransferProgress>();
  if (onProgress) channel.onmessage = (progress) => onProgress(progress);
  try {
    return await invoke<string[]>(command, { ...args, onProgress: channel });
  } catch (e) {
    throw errorOf(e, fallback);
  }
}

// ── 로컬 ──

export function localCopy(
  paths: readonly string[],
  destDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "local_copy",
    { paths, destDir, onConflict, op },
    onProgress,
    "files.ops.fail.copy",
  );
}

export async function localMove(
  paths: readonly string[],
  destDir: string,
  onConflict: OnConflict,
): Promise<string[]> {
  try {
    return await invoke<string[]>("local_move", { paths, destDir, onConflict });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.move");
  }
}

export async function localRemoveMany(paths: readonly string[], recursive: boolean): Promise<void> {
  try {
    await invoke("local_remove_many", { paths, recursive });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.delete");
  }
}

/**
 * 탐색기에서 끌어다 놓은 파일 — OS 파일 드롭은 원본 경로를 주지 않아 `localCopy` 를 못 쓴다. 메타는 헤더(퍼센트 인코딩), 내용은 raw 바디.
 * 건너뛰었으면 `null`.
 */
export async function localWriteFile(
  destDir: string,
  file: File,
  onConflict: OnConflict,
  tr: Tr,
): Promise<string | null> {
  // 원격 창에서는 본문이 ws 프레임 하나로 가므로 그 상한 안쪽에서 먼저 거절한다 (`ipc.ts` 의 `rawBodyLimit`).
  const tooBig = rawUploadTooBig(file.size, LOCAL_WRITE_MAX_BYTES, "files.transfer.toobig.local", tr);
  if (tooBig !== null) throw new Error(tooBig);
  const headers: Record<string, string> = {
    "x-dir": encodeURIComponent(destDir),
    "x-file-name": encodeURIComponent(file.name),
    "x-on-conflict": onConflict,
  };
  try {
    const body = new Uint8Array(await file.arrayBuffer());
    return await invoke<string | null>("local_write_file", body, { headers });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.write", { name: file.name });
  }
}

/** Rust `local_browser.rs` 의 `WRITE_MAX_BYTES` 와 같은 값이어야 한다 */
export const LOCAL_WRITE_MAX_BYTES = 100 * 1024 * 1024;

export async function localConflicts(
  paths: readonly string[],
  destDir: string,
): Promise<Conflict[]> {
  try {
    return await invoke<Conflict[]>("local_conflicts", { paths, destDir });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.conflicts");
  }
}

// ── 원격 ──

export function sftpCopy(
  session: number,
  paths: readonly string[],
  destDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "sftp_copy",
    { session, paths, destDir, onConflict, op },
    onProgress,
    "files.ops.fail.copy",
  );
}

export async function sftpMove(
  session: number,
  paths: readonly string[],
  destDir: string,
  onConflict: OnConflict,
): Promise<string[]> {
  try {
    return await invoke<string[]>("sftp_move", { session, paths, destDir, onConflict });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.move");
  }
}

export async function sftpRemoveMany(
  session: number,
  paths: readonly string[],
  recursive: boolean,
): Promise<void> {
  try {
    await invoke("sftp_remove_many", { session, paths, recursive });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.delete");
  }
}

export async function sftpConflicts(
  session: number,
  paths: readonly string[],
  destDir: string,
): Promise<Conflict[]> {
  try {
    return await invoke<Conflict[]>("sftp_conflicts", { session, paths, destDir });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.conflicts");
  }
}

/** `$lib/sftp` 의 `uploadFile`(바이트 · 100MB 상한)과 다른 문이다 — 경로를 받아 청크로 흘린다(상한 없음) */
export function sftpUploadPaths(
  session: number,
  localPaths: readonly string[],
  remoteDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "sftp_upload_paths",
    { session, localPaths, remoteDir, onConflict, op },
    onProgress,
    "files.ops.fail.upload_many",
  );
}

export function sftpDownloadPaths(
  session: number,
  remotePaths: readonly string[],
  localDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "sftp_download_paths",
    { session, remotePaths, localDir, onConflict, op },
    onProgress,
    "files.ops.fail.download_many",
  );
}

// ── 서로 다른 곳 사이 ──
// `from === to` 면 백엔드가 같은 세션용 명령으로 위임한다. 이동은 복사 + 원본 삭제라 진행률 · 취소가 있고,
// 실패 문구("N개 이동 완료, M번째에서 중단")는 백엔드 것을 그대로 세운다.

export function sftpCopyBetween(
  from: number,
  paths: readonly string[],
  to: number,
  destDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "sftp_copy_between",
    { from, paths, to, destDir, onConflict, op },
    onProgress,
    "files.ops.fail.copy",
  );
}

/** 항목 하나가 완전히 놓인 뒤에만 그 원본을 지운다 */
export function sftpMoveBetween(
  from: number,
  paths: readonly string[],
  to: number,
  destDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "sftp_move_between",
    { from, paths, to, destDir, onConflict, op },
    onProgress,
    "files.ops.fail.move",
  );
}

export function localToSftpMove(
  session: number,
  localPaths: readonly string[],
  remoteDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "local_to_sftp_move",
    { session, localPaths, remoteDir, onConflict, op },
    onProgress,
    "files.ops.fail.move",
  );
}

export function sftpToLocalMove(
  session: number,
  remotePaths: readonly string[],
  localDir: string,
  onConflict: OnConflict,
  op: number,
  onProgress: OnProgress | null,
): Promise<string[]> {
  return runTransfer(
    "sftp_to_local_move",
    { session, remotePaths, localDir, onConflict, op },
    onProgress,
    "files.ops.fail.move",
  );
}

// ── 취소 ──

/** 깃발만 세우고 바로 돌아온다. 없는 번호도 성공이라 시작 직전에 눌러도 유실되지 않는다 */
export async function transferCancel(op: number): Promise<void> {
  try {
    await invoke("transfer_cancel", { op });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.cancel");
  }
}
