import { invoke, Channel } from "./ipc";
import { hasReason } from "$lib/error-reason";
import { translateNow } from "$lib/i18n/dict";
import type { Key } from "$lib/i18n/keys";

/**
 * **SFTP 파일 브라우저** — Rust `sftp_browser` 모듈의 얇은 래퍼
 * (계약: docs/log/2026-09-03-sftp-browser-backend.md).
 *
 * `$lib/sftp` 가 **편집·업로드**(경로를 손으로 적는 두 동작)를 맡는다면, 이 파일은 그 앞의
 * "원격에 뭐가 있는지 보고 고른다" 를 맡는다 — 목록·이동·만들기·이름 바꾸기·삭제·다운로드.
 * 둘은 백엔드에서 **같은 SFTP 채널 캐시**를 타므로(세션 id 하나당 채널 하나) 브라우저를
 * 연다고 연결이 하나 더 생기지 않고, 세션이 닫히면 둘이 함께 정리된다.
 *
 * ## 이 파일이 하는 일 / 하지 않는 일
 *
 * 하는 일은 **타입 붙이기와 오류 정규화**뿐이다. `invoke` 실패는 한국어 문자열 하나로
 * 오는데(백엔드가 전부 `Result<_, String>`), 그대로 두면 호출부가 `unknown` 을 받아
 * 매번 `typeof e === "string"` 을 다시 쓴다. 여기서 한 번 [`Error`] 로 감싸므로
 * 컴포넌트는 `catch (e) { error = (e as Error).message }` 한 줄이면 된다.
 *
 * **실패를 삼키는 함수가 하나도 없다.** `$lib/tabs` 의 래퍼들과 반대인데, 그쪽은
 * "못 읽으면 새 탭으로 시작" 이라는 멀쩡한 대안이 있지만 여기는 없다 — 목록을
 * 못 읽었는데 빈 목록을 그리면 사용자는 **디렉터리가 비어 있다고 믿는다**. 권한이 없는
 * 것과 아무것도 없는 것은 화면에서 반드시 달라야 하므로 오류는 그대로 위로 올린다.
 *
 * ## 순수 함수들 (아래쪽 절반)
 *
 * [`parentOf`]·[`formatSize`]·[`formatMtime`]·[`formatMode`]·[`isDirLike`] 는 네트워크를
 * 타지 않는다. 특히 [`parentOf`] 는 **백엔드가 `..` 을 거절하기 때문에** 있어야 한다 —
 * 상위로 올라가는 것은 프런트가 경로를 직접 계산해 절대 경로로 보내는 일이다.
 */

/**
 * 원격 항목 하나 (Rust `SftpEntry` 와 1:1, **camelCase**).
 *
 * `path` 는 언제나 절대 경로이고 **심링크를 따라가지 않은 그 자리**다 — `realpath` 로
 * 풀면 `/usr/bin/python` 을 지우라는 요청이 `python3.12` 를 지우는 요청이 되므로
 * 백엔드가 일부러 풀지 않는다. 그래서 이 경로는 그대로 삭제·이름 변경에 써도 된다.
 */
export interface SftpEntry {
  /** 이름 한 조각 (루트만 `"/"`) */
  name: string;
  /** 절대 경로 — 심링크는 따라가지 않은 그 자리 */
  path: string;
  kind: "dir" | "file" | "symlink" | "other";
  /** 바이트 (디렉터리는 서버가 주는 값 그대로 — 화면에서는 `—` 로 접는다) */
  size: number;
  /** 유닉스 **초** (밀리초 아님). 서버가 안 주면 `null` */
  mtime: number | null;
  /** 권한 비트만 (`mode & 0o7777`) — 종류는 `kind` 가 이미 말한다 */
  mode: number | null;
  symlinkTarget: string | null;
  /** 이 심링크가 **디렉터리를 가리키는가** — UI 가 링크로 들어갈 수 있는지의 근거 */
  linkIsDir: boolean;
  /**
   * **윈도우 숨김 속성**(`FILE_ATTRIBUTE_HIDDEN`) — 로컬 백엔드에만 있는 값이다
   * (docs/log/2026-09-03-local-fs-backend.md 2절).
   *
   * | 백엔드 | 값 |
   * | --- | --- |
   * | SFTP | 언제나 `null` — 프로토콜에 그런 속성이 없다 |
   * | 로컬 (윈도우) | 속성 비트 그대로 |
   * | 로컬 (그 밖) | `false` |
   *
   * 화면의 숨김 판정은 [`isHidden`] 한 곳에서 **닷파일 OR 이 값**으로 접는다.
   */
  hidden: boolean | null;
}

/**
 * `invoke` 실패(문자열 하나)를 [`Error`] 로. 백엔드 문구는 이미 `tr!` 을 지난 것이라 그대로 싣는다.
 *
 * **폴백은 문구 키다.** 거절값이 문자열도 `Error` 도 아닐 때만 쓰이는 자리라(실제로는 거의
 * 닿지 않는다) 여기까지 한국어 리터럴이 남아 있었다. 키를 받아 [`translateNow`] 로 그 자리에서
 * 푸는 이유는 **돌려주는 것이 `Error` 이기 때문**이다 — 화면까지 키를 들고 갈 그릇이
 * `Error.message` 에는 없다 (`i18n/dict.ts` 의 `translateNow` 머리말이 말하는 바로 그 예외이고,
 * `fs-backend` 의 `noSession()` 과 같은 자리다).
 *
 * 만들어지는 순간의 언어로 굳는다는 점도 같다 — 던지자마자 화면에 닿는 글자라 문제가 없다.
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

/**
 * 이 오류가 **세션이 사라진 것**인가 — 그렇다면 화면은 오류가 아니라 "연결 대기" 배너를
 * 띄우는 편이 맞다 (재연결되면 저절로 이어진다).
 *
 * 백엔드의 두 갈래(세션 표에 없다 · 서버가 `NoConnection`/`ConnectionLost` 를 줬다)와
 * 프런트가 스스로 만드는 하나(`fs-backend` 의 세션 없음)가 **같은 이유 코드**
 * `[session-gone]` 을 단다 — 글자가 아니라 코드라 언어를 타지 않는다
 * (`$lib/error-reason` · `src-tauri/src/errors.rs`).
 */
export function isSessionGone(message: string): boolean {
  return hasReason(message, "session-gone");
}

// ---------------------------------------------------------------------------
// 명령 일곱 개 — 전부 실패를 위로 올린다
// ---------------------------------------------------------------------------

/** 로그인 홈의 절대 경로. 브라우저가 처음 열릴 때의 출발점이다 */
export async function sftpHome(session: number): Promise<string> {
  try {
    return await invoke<string>("sftp_home", { session });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.home");
  }
}

/**
 * 디렉터리 하나의 목록. **백엔드가 이미 정렬해 준다** — 디렉터리 먼저, 이름 오름차순
 * (대소문자 무시), 디렉터리를 가리키는 심링크는 디렉터리 쪽에. 프런트에서 다시 정렬하지
 * 않는 이유는 그 순서가 "들어갈 수 있는 것이 위에 모인다" 는 화면 규칙 그대로이기 때문이다.
 */
export async function sftpList(session: number, path: string): Promise<SftpEntry[]> {
  try {
    return await invoke<SftpEntry[]>("sftp_list", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.list", { path });
  }
}

/** 항목 하나의 속성 (심링크를 따라가지 않는다) */
export async function sftpStat(session: number, path: string): Promise<SftpEntry> {
  try {
    return await invoke<SftpEntry>("sftp_stat", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.stat", { path });
  }
}

/** 디렉터리를 만든다. 돌려주는 값은 **만들어진 절대 경로** (새로고침 뒤 골라 두는 데 쓴다) */
export async function sftpMkdir(session: number, path: string): Promise<string> {
  try {
    return await invoke<string>("sftp_mkdir", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

/** 빈 파일을 만든다(이미 있으면 거절). 돌려주는 값은 **만들어진 절대 경로** */
export async function sftpCreateFile(session: number, path: string): Promise<string> {
  try {
    return await invoke<string>("sftp_create_file", { session, path });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.mkdir", { path });
  }
}

/**
 * 이름을 바꾸거나 옮긴다. 돌려주는 값은 **바뀐 뒤의 절대 경로**.
 *
 * 대상이 이미 있으면 백엔드가 거절한다 (SFTP v3 의 `SSH_FXP_RENAME` 은 덮어쓰기를
 * 정의하지 않는다) — 화면은 그 문구를 그대로 보여 주면 된다.
 */
export async function sftpRename(session: number, from: string, to: string): Promise<string> {
  try {
    return await invoke<string>("sftp_rename", { session, from, to });
  } catch (e) {
    throw errorOf(e, "files.ops.fail.rename", { path: from });
  }
}

/**
 * 지운다. `recursive` 가 거짓인데 디렉터리가 비어 있지 않으면 백엔드가
 * `… 이(가) 비어 있지 않습니다 — 안의 항목까지 지우려면 재귀 삭제를 쓰세요` 로 거절한다 —
 * 화면은 그때 "재귀 삭제?" 를 한 번 더 묻는다. 루트와 홈은 어떤 경우에도 거절된다.
 */
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

/**
 * 파일 하나를 로컬 경로로 내려받는다 — 돌려주는 값은 받은 바이트 수.
 *
 * `onProgress` 로 흐르는 값은 **받은 누적 바이트**다 (증분이 아니다). 전체 크기는 채널로
 * 오지 않는다 — 프런트가 [`SftpEntry.size`] 로 이미 알고 있기 때문이다. 처음에 `0` 이
 * 한 번 오고, 그다음은 최소 100ms 간격이며, 마지막에 총합이 한 번 더 온다.
 *
 * **디렉터리는 받을 수 없다** (백엔드가 `폴더 다운로드는 아직 지원하지 않습니다` 로
 * 거절한다). **취소도 아직 없다** — 시작하면 끝나거나 실패할 때까지 간다.
 */
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

/**
 * 상위 디렉터리의 절대 경로. 루트(`"/"`)의 부모는 루트 자신이다 (더 갈 곳이 없다).
 *
 * **이 함수가 필요한 이유**: 백엔드의 `normalize_remote` 는 `..` 을 **거절**한다. 경로
 * 정규화를 문자열 수준에서 하는 이상 `..` 을 허용하면 심링크가 낀 자리에서 서버가 보는
 * 실제 위치와 어긋나기 때문이다. 그래서 "위로" 는 프런트가 자기 경로를 잘라 절대 경로로
 * 보내는 일이 된다 — `"/a/b/c"` → `"/a/b"`.
 *
 * 꼬리 슬래시는 먼저 떨군다 (`"/a/b/"` 도 `"/a"` 가 아니라 `"/a"` 의 자식인 `"/a/b"` 의
 * 부모, 즉 `"/a"` 여야 한다).
 */
export function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return "/";
  const at = trimmed.lastIndexOf("/");
  if (at < 0) return "/";
  return at === 0 ? "/" : trimmed.slice(0, at);
}

/** 경로 한 조각씩 이어 붙인다 (`"/a"` + `"b"` → `"/a/b"`, 루트에서도 `//` 가 안 생기게) */
export function joinPath(dir: string, name: string): string {
  const base = dir.replace(/\/+$/, "");
  return base === "" ? `/${name}` : `${base}/${name}`;
}

/** 빵부스러기 한 줄 — 루트부터 이 경로까지의 `{라벨, 절대 경로}` 목록 */
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

/**
 * 사람이 읽는 크기. `$lib/sftp` 의 [`humanSize`] 와 **일부러 다르다** — 저쪽은 업로드
 * 모달의 몇 줄짜리 목록이라 `MB` 까지면 충분하지만, 파일 목록은 GB 짜리 로그·이미지가
 * 흔히 섞이고 한 화면에 수백 줄이 서므로 자릿수를 맞춰 접는다.
 */
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

/**
 * 수정 시각 한 줄. **백엔드가 주는 값은 초**라 `× 1000` 이 필요하다 (이 곱을 빠뜨리면
 * 모든 파일이 1970년으로 보인다 — 눈에 잘 안 띄는 실수라 여기 한 곳으로 모은다).
 *
 * 올해 안이면 연도를 생략하고 `분` 까지 (`09-03 14:22`), 해를 넘겼으면 날짜만
 * (`2025-11-02`) — 목록의 폭을 일정하게 유지하면서 "최근인가" 가 먼저 읽히게 하는 배분이다.
 */
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

/**
 * 권한 비트 → `rwxr-xr-x` 아홉 글자.
 *
 * setuid·setgid·sticky 는 유닉스 관례대로 실행 자리에 **겹쳐 적는다** (`rws`·`rwS`·`rwt`).
 * 백엔드가 `mode & 0o7777` 로 종류를 이미 떼어 놨으므로 앞의 파일 종류 글자(`d`·`l`)는
 * 여기서 붙이지 않는다 — 그건 목록의 글리프가 이미 말한다.
 */
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

/**
 * **들어갈 수 있는가** — 디렉터리이거나, 디렉터리를 가리키는 심링크인가.
 *
 * 목록의 Enter·더블클릭이 "들어가기" 와 "편집" 중 무엇인지를 이 한 줄이 가른다.
 * `linkIsDir` 는 백엔드가 심링크마다 stat 을 한 번 더 걸어 채워 준 값이다 (readdir 의
 * 속성은 lstat 이라 링크가 무엇을 가리키는지 모른다). 심링크가 512개를 넘는 디렉터리에서는
 * 넘는 만큼이 `false` 로 오므로, 그런 자리에서는 링크가 파일처럼 다뤄진다 — 목록 자체가
 * 30초씩 걸리는 것보다 나은 절충이다.
 */
export function isDirLike(entry: SftpEntry): boolean {
  return entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir);
}

/**
 * 목록 줄 앞에 그릴 **글리프의 종류** — 디렉터리면 폴더, 링크면 링크(가리키는 것이
 * 디렉터리면 `dirlink`), 나머지는 파일.
 *
 * 예전에는 이모지 글자(`"📁"`)를 그대로 돌려줬다. 지금은 **종류만** 말하고 실제 도형은
 * 화면(`FileList`)이 `UiIcon` 으로 그린다 (docs/log/2026-09-04-icons-and-rows.md ·
 * docs/log/2026-09-25-duotone-glyphs.md): 이모지는 글꼴이 칠하는 그림이라 색이 고정이고,
 * 그래서 어떤 테마에서도 폴더 한 칸만 다른 앱에서 온 것처럼 보였다.
 *
 * 링크를 둘로 가르는 근거는 [`isDirLike`] 와 같은 `linkIsDir` 다 — Enter 가 "들어가기" 인
 * 링크는 그림도 폴더 몸이어야 한다. 그 값이 `false` 로 오는 자리(심링크 512개 초과)에서는
 * 들어가기와 그림이 **함께** 파일 쪽으로 떨어지므로 둘이 어긋나지 않는다.
 *
 * 종류를 문자열로 돌려주는 형태를 유지하는 이유는 이 파일이 **순수 모듈**이기 때문이다 —
 * 여기서 컴포넌트를 임포트하면 목록 규칙을 노드에서 검증할 수 없게 된다.
 */
export function glyphOf(entry: SftpEntry): "dir" | "dirlink" | "link" | "file" {
  if (entry.kind === "symlink") return entry.linkIsDir ? "dirlink" : "link";
  if (entry.kind === "dir") return "dir";
  return "file";
}

/**
 * 숨김 항목인가 — **닷파일 OR 윈도우 숨김 속성**.
 *
 * 둘을 OR 로 묶어야 한 스위치로 양쪽이 다 접힌다: 윈도우의 `NTUSER.DAT` 는 점이 없는
 * 숨김 파일이고, 유닉스의 `.bashrc` 는 속성이 없는 점 파일이다. 어느 한쪽만 보면 반은
 * 그대로 새어 나온다 (docs/log/2026-09-03-local-fs-backend.md 2절).
 *
 * 원격(SFTP)은 [`SftpEntry.hidden`] 이 언제나 `null` 이라 예전과 정확히 같은 규칙이다.
 */
export function isHidden(entry: SftpEntry): boolean {
  return entry.name.startsWith(".") || entry.hidden === true;
}
