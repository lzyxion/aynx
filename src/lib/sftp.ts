import { invoke, listen, type UnlistenFn } from "./ipc";
import { hasReason } from "$lib/error-reason";
import { translateNow } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";
import type { Tr } from "$lib/session";

/**
 * SFTP — Rust `sftp` 모듈의 얇은 래퍼 (docs/log/2026-09-02-sftp.md).
 *
 * 두 가지를 한다:
 * - **원격 파일 편집**: 내려받아 로컬 편집기로 열고, 저장할 때마다 백엔드가 되올린다.
 *   완료·실패는 `sftp-uploaded` / `sftp-upload-failed` 이벤트로 온다.
 * - **업로드**: 파일 내용을 **raw 요청 바디**로 보낸다 (아래 `uploadFile` 참고).
 *
 * 둘 다 **세션에 매달려 있다**: 세션이 닫히면 백엔드가 SFTP 채널과 편집 감시를 함께
 * 정리한다 (포트 포워딩과 같은 수명 규칙).
 */

/** 감시 중인 편집 하나 (Rust `EditInfo` 와 1:1, snake_case 유지) */
export interface EditInfo {
  id: number;
  session_id: number;
  remote_path: string;
  local_path: string;
  file_name: string;
}

/** 업로드 한 건의 결과 */
export interface UploadInfo {
  remote_path: string;
  bytes: number;
}

/** `sftp-uploaded` · `sftp-upload-failed` 페이로드 (`message` 는 실패일 때만) */
export interface UploadEvent {
  id: number;
  remote_path: string;
  message: string | null;
}

/** 업로드 모달의 기본 디렉터리 — 백엔드가 `~/` 를 벗겨 홈 기준 상대 경로로 만든다 */
export const DEFAULT_REMOTE_DIR = "~/";

/** 백엔드와 **같은 값**이어야 한다 (여기서 먼저 걸러 헛된 전송을 막는다) */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/**
 * 오류 문구를 만든다 (invoke 실패는 문자열로 온다). 폴백은 **문구 키**이고 여기서 푼다 —
 * `sftp-browser.ts` 의 `errorOf` 와 같은 함수·같은 근거다 (그쪽 머리말 참고).
 */
function errorOf(e: unknown, fallback: Key, params?: Record<string, string | number>): Error {
  return new Error(
    typeof e === "string" ? e : e instanceof Error ? e.message : translateNow(fallback, params),
  );
}

/**
 * 이 오류가 "같은 이름이 이미 있다" 인가 — 그렇다면 [덮어쓰기] 재시도를 권할 수 있다.
 * 백엔드가 앞에 다는 **이유 코드**(`[exists]`)를 본다 — 글자가 아니라 코드라 언어를 타지
 * 않는다 (`$lib/error-reason` · `src-tauri/src/errors.rs`).
 */
export function isAlreadyExists(message: string): boolean {
  return hasReason(message, "exists");
}

/** 사람이 읽는 크기 (모달 목록용) */
export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

/**
 * 파일 전송 모달의 **목적지** — 원격 세션이거나, 내 디스크다
 * (docs/log/2026-09-04-native-drag-out.md "반대 방향").
 *
 * 예전에는 세션 번호 하나였다. 탐색기에서 **로컬 파일 타일**로 파일을 끌어다 놓는 길이
 * 생기면서 목적지가 둘이 됐는데, 모달이 하는 나머지 일 — 줄마다 진행 표시, "이미
 * 있습니다" 한 줄에만 붙는 [덮어쓰기], 실패한 것만 재시도, 끝난 뒤 토스트 — 은 양쪽에서
 * 글자 하나 다르지 않다. 그래서 모달을 하나 더 만드는 대신 목적지만 값으로 갈랐다.
 */
export type UploadTarget = { kind: "remote"; session: number } | { kind: "local" };

/**
 * 업로드 목록 한 줄의 **상태** — 언어를 타지 않는 값이다.
 *
 * 예전에는 `"올리는 중"`·`"완료"` 처럼 한국어 문장이 그대로 상태였고, `+page` 가 그 글자를
 * `===` 로 비교해 CSS 클래스를 붙였다. 언어가 둘이 되는 순간 그 비교가 조용히 거짓이 되므로
 * **값과 글자를 갈랐다**: 여기는 값만 들고, 글자는 `files.transfer.state.<값>` 이다.
 */
export type UploadState = "waiting" | "uploading" | "copying" | "done" | "error";

/** 목적지에 따라 갈리는 **글자 네 개**. 로직은 한 벌이고 말만 다르다 — 값은 전부 문구 키다 */
export interface UploadVerb {
  title: Key;
  /** 진행 중 한 줄의 상태 (`UploadItem.state` 와 **같은 값**이어야 한다 — 글자가 아니다) */
  ing: Extract<UploadState, "uploading" | "copying">;
  /** 버튼 글자 */
  go: Key;
  /** 끝난 뒤 토스트 한 줄 (`{n}` 개 · `{dir}`) */
  done: Key;
}

/**
 * 원격은 "올린다", 내 디스크는 "복사한다" — 같은 창에서 같은 낱말을 쓰면 어디로 가는지가
 * 흐려지므로 목적지가 말을 정한다.
 *
 * 이 파일은 vitest 가 그대로 돌리는 순수 모듈이라 사전을 들이지 않는다 — **키만** 고르고
 * 글자는 부르는 쪽(`+page.svelte` · `app/transfer.svelte.ts`)이 `t()` 로 만든다.
 */
export function uploadVerb(target: UploadTarget | null): UploadVerb {
  return target?.kind === "local"
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

/**
 * 모달의 목적지 칸 값 → 실제로 쓸 디렉터리.
 *
 * 원격은 비면 홈(`~/`)이지만 **로컬에는 그런 기본이 없다** — 빈 값은 곧 "어디에" 를 잃은
 * 것이라, 그때는 백엔드가 절대 경로가 아니라고 거절하는 편이 맞다 (조용히 아무 데나
 * 떨어뜨리지 않는다).
 */
export function uploadDirValue(typed: string, target: UploadTarget | null): string {
  const dir = typed.trim();
  if (dir !== "") return dir;
  return target?.kind === "local" ? "" : DEFAULT_REMOTE_DIR;
}

/**
 * 원격 파일을 내려받아 기본 편집기로 열고 감시를 시작한다.
 * 실패(없는 파일·크기 초과·SFTP 미지원)는 한국어 한 줄을 담은 `Error` 다.
 */
export async function editRemoteFile(sessionId: number, remotePath: string): Promise<EditInfo> {
  try {
    return await invoke<EditInfo>("edit_remote_file", { sessionId, remotePath });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.edit_remote");
  }
}

// `list_edits`·`stop_edit` 을 부르는 프런트 래퍼는 **없다**. 백엔드 명령은 있지만 그것을
// 보여 줄 화면이 없어(docs/log/2026-09-02-sftp.md 의 "편집 목록 UI 없음") 앱 어디서도
// 부르지 않았다 — 쓰이지 않는 채로 계약만 두 벌이 되므로 지웠다
// (docs/log/2026-09-05-refactor-structure.md). 화면이 생기면 그때 다시 쓴다.

/**
 * 파일 하나를 원격 디렉터리에 올린다.
 *
 * **본문이 raw 바이트다.** 일반 invoke 인자로 보내면 `Uint8Array` 가 JSON 숫자 배열로
 * 직렬화되어 1MB 짜리 파일이 수 MB 짜리 문자열이 된다 (docs/verification/tauri-data-path.md
 * 1절과 같은 근거). 그래서 바디는 파일 내용만 싣고 메타데이터는 **헤더**로 보낸다 —
 * 헤더는 ASCII 만 안전하므로 한글 이름·경로는 `encodeURIComponent` 로 감싼다.
 *
 * `overwrite` 가 거짓이면 같은 이름이 있을 때 백엔드가 거절한다 ([`isAlreadyExists`]) —
 * **덮어쓸지 묻는 것은 프런트의 몫**이라, 확인을 받은 뒤 참으로 다시 부른다.
 */
export async function uploadFile(
  sessionId: number,
  remoteDir: string,
  file: File,
  overwrite: boolean,
  tr: Tr,
): Promise<UploadInfo> {
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new Error(
      tr("files.transfer.toobig.upload", {
        size: humanSize(file.size),
        max: humanSize(UPLOAD_MAX_BYTES),
      }),
    );
  }
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

/** 편집 저장이 원격에 반영됐다 */
export function onUploaded(handler: (ev: UploadEvent) => void): Promise<UnlistenFn> {
  return listen<UploadEvent>("sftp-uploaded", (ev) => handler(ev.payload));
}

/** 편집 저장을 되올리지 못했다 (세션이 끊긴 경우가 대부분) */
export function onUploadFailed(handler: (ev: UploadEvent) => void): Promise<UnlistenFn> {
  return listen<UploadEvent>("sftp-upload-failed", (ev) => handler(ev.payload));
}
