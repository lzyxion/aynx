import { Channel, invoke } from "./ipc";
import { errorOf } from "$lib/sftp-browser";
import type { Key } from "$lib/i18n/keys";
import type { Tr } from "$lib/session";
import { hasReason } from "$lib/error-reason";

/**
 * **파일 묶음 작업** — Rust `fs_transfer`·`local_browser`·`sftp_browser` 의 얇은 래퍼
 * (계약: docs/log/2026-09-04-fs-batch-ops-backend.md).
 *
 * `sftp-browser.ts` 가 "하나를 만지는" 명령들(목록·이름 바꾸기·하나 지우기)을 감싼다면
 * 여기는 **여럿을 한꺼번에** 옮기는 열다섯 개다: 복사·이동·여러 개 지우기·충돌 사전 조회 ·
 * 업로드·다운로드 · **서로 다른 곳 사이의 복사·이동 넷** · 취소. 규칙은 저쪽과 같다 —
 * 타입 붙이기와 오류 정규화만 하고 **실패를 삼키지 않는다**.
 *
 * ## `op` 는 프런트가 정한다
 *
 * 전송 번호는 백엔드가 발급하지 않는다. 발급하려면 명령이 **끝난 뒤에야** 번호를 알 수
 * 있는데, 취소는 그 전에 눌러야 뜻이 있기 때문이다. 그래서 [`nextOp`] 가 창 안에서
 * 단조 증가하는 수를 주고, 그 번호가 전송 명령·진행률 이벤트·[`transferCancel`] 셋을
 * 한 줄로 꿴다.
 *
 * ## 취소는 **오류로** 돌아온다
 *
 * 취소된 전송은 **이유 코드 `[cancelled]`** 를 단 오류로 돌아온다 (백엔드의
 * `errors::cancelled`). 화면은 이것을 빨간 오류가 아니라 "취소됨" 으로 그려야 하므로
 * 판정을 [`isTransferCanceled`] 한 곳에 모아 둔다.
 */

/** 목적지에 같은 이름이 이미 있을 때 무엇을 할 것인가 */
export type OnConflict = "fail" | "overwrite" | "skip" | "rename";

/**
 * 부딪히는 것 하나 — **이미 그 자리에 있는 쪽**의 절대 경로다 (원본이 아니다).
 * 사전 조회([`localConflicts`]·[`sftpConflicts`])는 최상위 항목만 본다.
 */
export interface Conflict {
  path: string;
  kind: "file" | "dir";
}

/** 진행률 한 건 — 값은 전부 **누적 총합**이다 (증분이 아니다) */
export interface TransferProgress {
  /** 이 전송의 번호 ([`transferCancel`] 에 그대로 쓴다) */
  op: number;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  /** 지금 쓰고 있는 **대상** 경로 (시작 전·끝난 뒤에는 `""`) */
  current: string;
}

export type OnProgress = (progress: TransferProgress) => void;

/**
 * 이 오류가 **사용자가 누른 취소**인가 — 그렇다면 화면은 빨간 오류가 아니라 "취소됨" 이라고
 * 적는다. 사용자가 시킨 일이 시킨 대로 된 것을 실패로 그리면 무언가 고장 났다고 읽는다.
 *
 * 취소 문구는 **감싸여** 올라오기도 한다 (`"3개 이동 완료, 4번째에서 중단: …"`) — 그래서
 * 판정은 접두사가 **들어 있는가**다 (`$lib/error-reason` 머리말의 규칙 1).
 */
export function isTransferCanceled(message: string): boolean {
  return hasReason(message, "cancelled");
}

/**
 * 다음 전송 번호. **창 안에서만 유일하면 된다** — 취소 깃발은 백엔드의 전역 맵이지만
 * 번호가 겹쳐도 서로의 전송을 끊을 뿐이고, 그마저 창 하나에서 전송이 동시에 여럿 돌지
 * 않는 이 UI 에서는 일어나지 않는다 (타일마다 전송 하나, 시작할 때마다 새 번호다).
 */
let opCounter = 0;
export function nextOp(): number {
  opCounter += 1;
  return opCounter;
}

/**
 * 전송 명령 다섯의 공통 몸통 — 진행률 채널을 만들어 붙이고 결과를 그대로 올린다.
 *
 * 채널은 `onProgress` 가 없어도 **만든다**: 백엔드가 그 인자를 필수로 받으므로 빼면
 * 역직렬화에서 거절된다 (아무도 안 듣는 채널은 그냥 버려진다).
 */
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

// ---------------------------------------------------------------------------
// 로컬 넷
// ---------------------------------------------------------------------------

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
 * **바이트 한 덩어리를 로컬 폴더에 파일로 쓴다** — 탐색기에서 로컬 타일로 끌어다 놓은
 * 파일이 지나는 길 (`local_write_file`).
 *
 * 이 파일의 다른 열다섯과 달리 인자가 **경로가 아니라 `File`** 이다. OS 파일 드롭은 웹
 * 표준 DnD 로 들어오는데 (`dragDropEnabled: false`) 거기에는 원본 경로가 실려 오지 않기
 * 때문이다 — 그래서 `localCopy` 를 쓸 수 없다. 모양은 원격 업로드([`uploadFile`])와 같다:
 * 메타는 헤더로(한글 때문에 퍼센트 인코딩), 내용은 **raw 바디**로.
 *
 * 돌려주는 값은 **실제로 놓인 경로** — 정책이 `"rename"` 이면 밀린 이름이고,
 * `"skip"` 으로 건너뛰었으면 `null` 이다.
 */
export async function localWriteFile(
  destDir: string,
  file: File,
  onConflict: OnConflict,
  tr: Tr,
): Promise<string | null> {
  if (file.size > LOCAL_WRITE_MAX_BYTES) {
    throw new Error(
      tr("files.transfer.toobig.local", {
        size: `${Math.round(file.size / (1024 * 1024))}MB`,
        max: `${Math.round(LOCAL_WRITE_MAX_BYTES / (1024 * 1024))}MB`,
      }),
    );
  }
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

/** 백엔드의 `WRITE_MAX_BYTES` 와 **같은 값**이어야 한다 (여기서 먼저 걸러 헛된 복사를 막는다) */
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

// ---------------------------------------------------------------------------
// 원격 여섯
// ---------------------------------------------------------------------------

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

/**
 * 로컬 **경로들**을 원격 폴더로. `$lib/sftp` 의 `uploadFile` 과 다른 문이다 — 그쪽은
 * 웹 표준 DnD 가 주는 **바이트**를 통째로 받고(100MB 상한), 이쪽은 경로를 받아 청크로
 * 흘린다(상한 없음). 타일 사이 드래그와 붙여넣기가 이쪽이다.
 */
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

// ---------------------------------------------------------------------------
// 서로 다른 곳 사이 넷 (커밋 `a4eda4b` — docs/log/2026-09-04-fs-batch-ops-backend.md "후속")
//
// 위의 여섯이 "한 세션 안" 이나 "한쪽이 로컬" 인 반면, 이 넷은 **두 자리를 한 전송으로
// 묶는다**. 그래서 둘의 성질이 앞의 것들과 다르다:
//
// - `*_between` 은 세션을 **둘** 받는다(`from`·`to`). `from === to` 면 백엔드가 같은
//   세션용 명령으로 위임하므로, 프런트는 두 서버가 같은지 따지지 않고 하나만 부른다.
// - 이동 셋은 **이름 바꾸기가 아니라 복사 + 원본 삭제**다. 그래서 위의 `*_move`(진행률도
//   취소도 없는 rename)와 달리 진행률·취소가 있고, 실패하면 "N개 이동 완료, M번째에서
//   중단" 이라는 **어디까지 했는지가 담긴** 오류가 온다 — 그 문구를 그대로 화면에 세운다
//   (여기서 다시 쓰지 않는 이유다: 우리가 아는 것보다 백엔드가 아는 것이 정확하다).
// ---------------------------------------------------------------------------

/** 원격 A 의 경로들을 원격 B 의 폴더로 **복사** (`from === to` 면 백엔드가 제자리 복사로 위임) */
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

/** 원격 A → 원격 B **이동** — 항목 하나가 완전히 놓인 뒤에만 그 원본을 지운다 */
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

/** 로컬 경로들을 원격 폴더로 **이동** (올린 뒤 원본 삭제, 항목 단위) */
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

/** 원격 경로들을 로컬 폴더로 **이동** (받은 뒤 원본 삭제, 항목 단위) */
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

// ---------------------------------------------------------------------------
// 취소 (로컬·원격 공용)
// ---------------------------------------------------------------------------

/**
 * 전송 하나를 취소한다 — 깃발만 세우고 바로 돌아온다 (실제 중단은 전송 쪽이 다음
 * 청크에서). **없는 번호도 성공**이라 시작 직전에 눌러도 유실되지 않는다.
 */
export async function transferCancel(op: number): Promise<void> {
  try {
    await invoke("transfer_cancel", { op });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.cancel");
  }
}
