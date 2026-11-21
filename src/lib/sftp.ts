import { invoke, isRemote, listen, rawBodyLimit, type UnlistenFn } from "./ipc";
import { hasReason } from "$lib/error-reason";
import { translateNow } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import type { Tr } from "$lib/session";

/**
 * SFTP — Rust `sftp` 모듈의 얇은 래퍼: 원격 파일 편집(저장마다 백엔드가 되올린다) · 업로드 (docs/log/2026-09-02-sftp.md).
 * 둘 다 세션에 매달려 있다 — 세션이 닫히면 백엔드가 SFTP 채널과 편집 감시를 함께 정리한다.
 */

/** Rust `EditInfo` 와 1:1, snake_case 유지 */
export interface EditInfo {
  id: number;
  session_id: number;
  remote_path: string;
  local_path: string;
  file_name: string;
}

export interface UploadInfo {
  remote_path: string;
  bytes: number;
}

/** `message` 는 실패일 때만 */
export interface UploadEvent {
  id: number;
  remote_path: string;
  message: string | null;
}

/** 백엔드가 `~/` 를 벗겨 홈 기준 상대 경로로 만든다 */
export const DEFAULT_REMOTE_DIR = "~/";

/** Rust `sftp.rs` 의 `UPLOAD_MAX_BYTES` 와 같은 값 */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** `sftp-browser.ts` 의 `errorOf` 와 같은 함수 · 같은 근거다 (그쪽 머리말 참고). */
function errorOf(e: unknown, fallback: Key, params?: Record<string, string | number>): Error {
  return new Error(
    typeof e === "string" ? e : e instanceof Error ? e.message : translateNow(fallback, params),
  );
}

/** 글자가 아니라 이유 코드(`[exists]`)를 본다 — 언어를 타지 않는다. */
export function isAlreadyExists(message: string): boolean {
  return hasReason(message, "exists");
}

export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/** 정수 MiB 가 아닌 상한은 떼지 않고 `humanSize` 로 둔다 — 반올림한 거짓 상한을 보이지 않게. */
export function limitLabel(bytes: number): string {
  const mib = 1024 * 1024;
  return bytes >= mib && bytes % mib === 0 ? `${bytes / mib}MB` : humanSize(bytes);
}

/** 원격 창이면 상한이 ws 프레임 안쪽으로 줄고 문구도 원격 창 것이다. `remoteWindow` 는 시험을 위해 인자로 받는다. */
export function rawUploadTooBig(
  size: number,
  limit: number,
  mainKey: Key,
  tr: Tr,
  remoteWindow: boolean = isRemote,
): string | null {
  const max = rawBodyLimit(limit, remoteWindow);
  if (size <= max) return null;
  return tr(remoteWindow ? "files.transfer.toobig.device.upload" : mainKey, {
    size: humanSize(size),
    max: limitLabel(max),
  });
}

/** 전송 모달의 목적지 — 모달은 한 벌이고 목적지만 값으로 가른다 (docs/log/2026-09-04-native-drag-out.md). */
export type UploadTarget = { kind: "remote"; session: number } | { kind: "local" };

/** 언어를 타지 않는 값 — 글자는 `files.transfer.state.<값>` 이다. 글자를 `===` 로 비교하면 언어가 바뀔 때 조용히 거짓이 된다. */
export type UploadState = "waiting" | "uploading" | "copying" | "done" | "error";

/** 값은 전부 문구 키다 */
export interface UploadVerb {
  title: Key;
  /** `UploadItem.state` 와 같은 값이어야 한다 */
  ing: Extract<UploadState, "uploading" | "copying">;
  go: Key;
  /** `{n}` 개 · `{dir}` */
  done: Key;
}

/**
 * 원격은 "올린다", 내 디스크는 "복사한다". vitest 가 그대로 돌리는 순수 모듈이라 키만 고른다.
 * 원격 창에서는 "로컬" 타일이 메인 PC 디스크라 그 기기의 파일이 ws 로 올라간다 — 그래서 SFTP 쪽 말을 쓴다.
 */
export function uploadVerb(target: UploadTarget | null, remoteWindow = false): UploadVerb {
  return target?.kind === "local" && !remoteWindow
    ? {
        title: "files.transfer.verb.local.title",
        ing: "copying",
        go: "files.transfer.verb.local.go",
        done: "files.transfer.upload.summary.local",
      }
    : {
        title: "files.transfer.verb.remote.title",
        ing: "uploading",
        go: "files.transfer.verb.remote.go",
        done: "files.transfer.upload.summary.remote",
      };
}

/** 로컬에는 기본 폴더가 없다 — 빈 값이면 백엔드가 절대 경로가 아니라고 거절하는 편이 맞다(조용히 아무 데나 떨어뜨리지 않는다). */
export function uploadDirValue(typed: string, target: UploadTarget | null): string {
  const dir = typed.trim();
  if (dir !== "") return dir;
  return target?.kind === "local" ? "" : DEFAULT_REMOTE_DIR;
}

export async function editRemoteFile(sessionId: number, remotePath: string): Promise<EditInfo> {
  try {
    return await invoke<EditInfo>("edit_remote_file", { sessionId, remotePath });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.edit_remote");
  }
}

/**
 * 본문은 raw 바이트다 — invoke 인자로 보내면 `Uint8Array` 가 JSON 숫자 배열이 되어 수 배로 부푼다 (docs/verification/tauri-data-path.md).
 * 메타데이터는 헤더로 — 헤더는 ASCII 만 안전해 이름 · 경로를 `encodeURIComponent` 로 감싼다. 덮어쓸지 묻는 것은 프런트의 몫이다.
 */
export async function uploadFile(
  sessionId: number,
  remoteDir: string,
  file: File,
  overwrite: boolean,
  tr: Tr,
): Promise<UploadInfo> {
  // 원격 창에서는 본문이 ws 프레임 하나로 가므로 그 상한 안쪽에서 먼저 거절한다 (`ipc.ts` 의 `rawBodyLimit`).
  const tooBig = rawUploadTooBig(file.size, UPLOAD_MAX_BYTES, "files.transfer.toobig.upload", tr);
  if (tooBig !== null) throw new Error(tooBig);
  const headers: Record<string, string> = {
    "x-session-id": String(sessionId),
    "x-remote-dir": encodeURIComponent(remoteDir),
    "x-file-name": encodeURIComponent(file.name),
  };
  if (overwrite) headers["x-overwrite"] = "1";

  try {
    const body = new Uint8Array(await file.arrayBuffer());
    return await invoke<UploadInfo>("upload_file", body, { headers });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.upload", { name: file.name });
  }
}

export function onUploaded(handler: (ev: UploadEvent) => void): Promise<UnlistenFn> {
  return listen<UploadEvent>("sftp-uploaded", (ev) => handler(ev.payload));
}

export function onUploadFailed(handler: (ev: UploadEvent) => void): Promise<UnlistenFn> {
  return listen<UploadEvent>("sftp-upload-failed", (ev) => handler(ev.payload));
}
