import { invoke, Channel } from "./ipc";
import { hasReason } from "$lib/error-reason";
import { translateNow } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";

/**
 * Rust `sftp_browser` 의 래퍼 — `$lib/sftp` 와 백엔드에서 같은 SFTP 채널 캐시(세션 id 하나당 채널 하나)를 탄다. 브라우저를 열어도 연결이 하나 더 생기지 않는다.
 * 실패를 삼키는 함수는 두지 않는다 — 못 읽은 목록을 빈 목록으로 그리면 사용자는 디렉터리가 비었다고 믿는다.
 */

/** Rust `SftpEntry` 와 1:1(camelCase) */
export interface SftpEntry {
  /** 루트만 `"/"` */
  name: string;
  /** 절대 경로 — 백엔드가 일부러 심링크를 풀지 않는다(풀면 링크를 지우라는 요청이 대상을 지운다). 그대로 삭제 · 이름 변경에 써도 된다 */
  path: string;
  kind: "dir" | "file" | "symlink" | "other";
  size: number;
  /** 유닉스 초(밀리초 아님) */
  mtime: number | null;
  /** 권한 비트만(`mode & 0o7777`) */
  mode: number | null;
  symlinkTarget: string | null;
  linkIsDir: boolean;
  /** 윈도우 숨김 속성 — SFTP 는 언제나 `null`, 로컬(윈도우)은 속성 비트, 로컬(그 밖)은 `false` */
  hidden: boolean | null;
}

/**
 * 폴백은 문구 키를 `translateNow` 로 그 자리에서 푼다 — 돌려주는 것이 `Error` 라 화면까지 키를 들고 갈 그릇이 없다
 * (`i18n/dict.ts` 의 `translateNow` 머리말이 말하는 예외 · `fs-backend` 의 `noSession()` 과 같은 자리). 백엔드 문구는 이미 `tr!` 을 지났다.
 */
export function errorOf(
  e: unknown,
  fallback: Key,
  params?: Record<string, string | number>,
): Error {
  return new Error(
    typeof e === "string" ? e : e instanceof Error ? e.message : translateNow(fallback, params),
  );
}

/** 이유 코드 `[session-gone]` 은 백엔드 두 갈래와 `fs-backend` 의 세션 없음이 함께 단다(`src-tauri/src/errors.rs`) — 글자가 아니라 코드라 언어를 타지 않는다 */
export function isSessionGone(message: string): boolean {
  return hasReason(message, "session-gone");
}

// ---------------------------------------------------------------------------
// 명령 — 전부 실패를 위로 올린다
// ---------------------------------------------------------------------------

export async function sftpHome(session: number): Promise<string> {
  try {
    return await invoke<string>("sftp_home", { session });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.home");
  }
}

/** 백엔드가 이미 정렬해 준다(디렉터리 · 디렉터리 심링크 먼저, 이름 오름차순 대소문자 무시) */
export async function sftpList(session: number, path: string): Promise<SftpEntry[]> {
  try {
    return await invoke<SftpEntry[]>("sftp_list", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.list", { path });
  }
}

/** 심링크를 따라가지 않는다 */
export async function sftpStat(session: number, path: string): Promise<SftpEntry> {
  try {
    return await invoke<SftpEntry>("sftp_stat", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.stat", { path });
  }
}

/** 만들어진 절대 경로를 돌려준다 */
export async function sftpMkdir(session: number, path: string): Promise<string> {
  try {
    return await invoke<string>("sftp_mkdir", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

/** 이미 있으면 거절한다 */
export async function sftpCreateFile(session: number, path: string): Promise<string> {
  try {
    return await invoke<string>("sftp_create_file", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

/** 대상이 이미 있으면 백엔드가 거절한다 — SFTP v3 의 `SSH_FXP_RENAME` 은 덮어쓰기를 정의하지 않는다 */
export async function sftpRename(session: number, from: string, to: string): Promise<string> {
  try {
    return await invoke<string>("sftp_rename", { session, from, to });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.rename", { path: from });
  }
}

/** 루트와 홈은 백엔드가 어떤 경우에도 거절한다 */
export async function sftpRemove(
  session: number,
  path: string,
  recursive: boolean,
): Promise<void> {
  try {
    await invoke("sftp_remove", { session, path, recursive });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.remove", { path });
  }
}

/** `onProgress` 의 값은 받은 누적 바이트다(증분 아님) — 전체 크기는 채널로 오지 않는다 */
export async function sftpDownload(
  session: number,
  remote: string,
  local: string,
  onBytes: (received: number) => void,
): Promise<number> {
  const onProgress = new Channel<number>();
  onProgress.onmessage = (received) => onBytes(received);
  try {
    return await invoke<number>("sftp_download", { session, remote, local, onProgress });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.download", { path: remote });
  }
}

// ---------------------------------------------------------------------------
// 순수 함수 — 경로 계산과 표시 형식
// ---------------------------------------------------------------------------

/** 백엔드의 `normalize_remote` 가 `..` 을 거절하므로 "위로" 는 프런트가 경로를 잘라 절대 경로로 보낸다 */
export function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return "/";
  const at = trimmed.lastIndexOf("/");
  if (at < 0) return "/";
  return at === 0 ? "/" : trimmed.slice(0, at);
}

export function joinPath(dir: string, name: string): string {
  const base = dir.replace(/\/+$/, "");
  return base === "" ? `/${name}` : `${base}/${name}`;
}

export function crumbsOf(path: string): { label: string; path: string }[] {
  const out = [{ label: "/", path: "/" }];
  let at = "";
  for (const seg of path.split("/")) {
    if (seg === "") continue;
    at = `${at}/${seg}`;
    out.push({ label: seg, path: at });
  }
  return out;
}

/** `$lib/sftp` 의 `humanSize` 와 일부러 다르다 — 파일 목록은 GB 가 흔하고 수백 줄이 서서 자릿수를 맞춰 접는다 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** 백엔드가 주는 값은 초라 `× 1000` 이 필요하다 — 빠뜨리면 모든 파일이 1970년으로 보인다 */
export function formatMtime(mtime: number | null, now: Date = new Date()): string {
  if (mtime === null || !Number.isFinite(mtime)) return "—";
  const at = new Date(mtime * 1000);
  if (Number.isNaN(at.getTime())) return "—";
  const p2 = (n: number) => String(n).padStart(2, "0");
  const md = `${p2(at.getMonth() + 1)}-${p2(at.getDate())}`;
  if (at.getFullYear() === now.getFullYear()) {
    return `${md} ${p2(at.getHours())}:${p2(at.getMinutes())}`;
  }
  return `${at.getFullYear()}-${md}`;
}

/** 앞의 파일 종류 글자(`d` · `l`)는 붙이지 않는다 — 목록의 글리프가 말한다 */
export function formatMode(mode: number | null): string {
  if (mode === null || !Number.isFinite(mode)) return "—";
  const bits = mode & 0o7777;
  const rwx = ["r", "w", "x"];
  let out = "";
  for (let group = 0; group < 3; group += 1) {
    const shift = (2 - group) * 3;
    for (let bit = 0; bit < 3; bit += 1) {
      out += (bits >> (shift + (2 - bit))) & 1 ? rwx[bit] : "-";
    }
  }
  // setuid(0o4000)·setgid(0o2000)·sticky(0o1000) 를 각 묶음의 x 자리에 겹쳐 적는다.
  const special: [number, number, string, string][] = [
    [0o4000, 2, "s", "S"],
    [0o2000, 5, "s", "S"],
    [0o1000, 8, "t", "T"],
  ];
  for (const [flag, at, on, off] of special) {
    if (!(bits & flag)) continue;
    out = out.slice(0, at) + (out[at] === "x" ? on : off) + out.slice(at + 1);
  }
  return out;
}

/** 심링크가 많은 디렉터리에서는 백엔드가 넘는 만큼 `linkIsDir` 를 `false` 로 준다 — 그 링크는 파일처럼 다뤄진다(알고 받은 절충) */
export function isDirLike(entry: SftpEntry): boolean {
  return entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir);
}

/**
 * `isDirLike` 와 같은 `linkIsDir` 로 가른다 — 들어가기와 그림이 어긋나지 않게.
 * 종류만 문자열로 돌려준다 — 여기서 컴포넌트를 임포트하면 목록 규칙을 노드에서 검증할 수 없다.
 */
export function glyphOf(entry: SftpEntry): "dir" | "dirlink" | "link" | "file" {
  if (entry.kind === "symlink") return entry.linkIsDir ? "dirlink" : "link";
  if (entry.kind === "dir") return "dir";
  return "file";
}

/** 닷파일 OR 윈도우 숨김 속성 — 한쪽만 보면 점 없는 숨김 파일(`NTUSER.DAT`)이나 점 파일이 새어 나온다 */
export function isHidden(entry: SftpEntry): boolean {
  return entry.name.startsWith(".") || entry.hidden === true;
}
