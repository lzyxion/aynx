import { isTextLike } from "$lib/doc-lang";

/**
 * **터미널 글자 속 파일 경로** — 순수 모듈 (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
 *
 * 터미널 한 줄에서 파일 경로로 보이는 토막을 찾고([`findPathLinks`]), 그것을 그 타일에서 열 수 있는 경로로 푼다
 * ([`resolvePathLink`]). xterm 에 거는 일은 `term-path-links.ts` 가 한다 — 여기는 글자만 본다.
 *
 * ## 잡는 모양
 *
 * - 절대: `C:\a\b.md` · `C:/a/b.md` · `\\server\share\x.txt` · `/etc/nginx/nginx.conf`
 * - 홈: `~/notes.md` (`~\x` 도)
 * - 상대: `./x.md` · `../x.md` · `docs/x.md` · `src\a.ts` — 구분자가 있는 것. 구분자가 없는 **맨 이름**
 *   (`README.md` · `package.json` — `ls` 출력)은 **점이 있을 때만**(`README` 처럼 점 없는 이름은 산문의 낱말과
 *   구별되지 않는다).
 * - 꼬리 `:12` · `:12:3`(컴파일러 · grep 출력)은 경로에서 떼어 `line`/`col` 로 둔다(v1 은 버린다 — 스크롤 이동은
 *   후속). 링크 범위에는 꼬리까지 든다(눈에 보이는 토막 전체가 밑줄).
 *
 * **이름이 [`isTextLike`] 인 것만** 잡는다 — 오탐 억제이자 여는 길이 문서 보기뿐이라서다(이진 파일을 걸어 봐야
 * 열 곳이 없다). URL 과 겹치는 토막은 버린다(URL 이 이긴다 — `https://x/docs/a.md` 의 `/docs/a.md` 를 따로 걸지
 * 않는다). xterm 도 먼저 등록된 프로바이더(web-links)가 이기지만, 여기서 먼저 빼 두면 순서에 기대지 않는다.
 *
 * 경로 안의 공백은 잡지 않는다(따옴표로 싼 경로 포함 — v1).
 */

/** 한 줄에서 찾은 경로 토막 하나 — `start`/`end` 는 그 줄 문자열의 반열린 구간 */
export interface PathMatch {
  start: number;
  end: number;
  /** 꼬리(`:12:3`)를 뗀 경로 글자 그대로 */
  path: string;
  /** `abs` 절대(윈도우 · UNC · POSIX) · `home` `~/…` · `rel` 상대 */
  form: "abs" | "home" | "rel";
  line?: number;
  col?: number;
}

/** 경로를 끊는 글자 — 공백 · 따옴표 · 괄호 · 파이프 · 쉼표 · 세미콜론 · `=`(`--out=docs/a.md`) */
const TOKEN = /[^\s"'`<>()[\]{}|,;=]+/g;
/** URL(스킴 + `://`) — 이 구간과 겹치는 경로는 버린다 */
const URL_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`<>]*/g;
/** 토막 끝의 문장 부호 — 경로의 일부가 아니다(`see docs/a.md.` 의 마침표) */
const TRAILING_PUNCT = /[.,:;!?]+$/;
/** `:12` · `:12:3` 꼬리 */
const LINE_COL = /:(\d+)(?::(\d+))?$/;
/** 글롭 글자가 섞이면 경로가 아니라 패턴이다 */
const GLOB = /[*?]/;

/** 경로의 마지막 조각 */
function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(i + 1);
}

/** 모양 판정 — 경로가 아니면 `null` */
function formOf(path: string): PathMatch["form"] | null {
  if (/^[A-Za-z]:[\\/]/.test(path)) return "abs";
  if (/^\\\\[^\\]/.test(path)) return "abs";
  if (path.startsWith("/")) return path.startsWith("//") ? null : "abs";
  if (/^~[\\/]/.test(path)) return "home";
  if (path.includes("/") || path.includes("\\")) return "rel";
  // 맨 이름 — 점이 있어야 한다(맨 앞 점 하나뿐인 `.env` 같은 이름도 된다)
  return path.includes(".") ? "rel" : null;
}

/** 한 줄의 URL 구간들 */
function urlRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_RE)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** 터미널 한 줄에서 경로로 보이는 토막들 (왼쪽부터) */
export function findPathLinks(text: string): PathMatch[] {
  const urls = urlRanges(text);
  const out: PathMatch[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index;
    let token = m[0].replace(TRAILING_PUNCT, "");
    if (token === "") continue;
    const end = start + token.length;
    if (urls.some(([a, b]) => start < b && end > a)) continue;
    let line: number | undefined;
    let col: number | undefined;
    const lc = LINE_COL.exec(token);
    if (lc) {
      line = Number(lc[1]);
      if (lc[2] !== undefined) col = Number(lc[2]);
      token = token.slice(0, lc.index);
    }
    const path = token;
    if (path === "" || GLOB.test(path) || path.includes("://")) continue;
    const form = formOf(path);
    if (form === null) continue;
    const name = baseName(path);
    if (name === "" || name === "." || name === "..") continue;
    if (!isTextLike(path)) continue;
    out.push({ start, end, path, form, ...(line !== undefined ? { line } : {}), ...(col !== undefined ? { col } : {}) });
  }
  return out;
}

/**
 * 경로를 풀 자리 — 그 터미널이 어디의 셸인가.
 *
 * - `local` — 이 컴퓨터의 셸. `cwd` 는 그 셸이 알려 준 폴더(OSC 7) 그대로.
 * - `wsl` — 이 컴퓨터의 WSL 셸. 셸이 보여 주는 경로는 배포판 안의 POSIX 경로라 `toLocal`(보통
 *   `wslCwdToWindows`)로 이 컴퓨터의 경로로 옮긴다. `cwd` 도 POSIX 다.
 * - `remote` — SSH 셸. 경로는 원격의 POSIX 경로이고 윈도우 모양은 열 수 없다.
 */
export type PathLinkPlace =
  | { kind: "local"; cwd: string | null }
  | { kind: "wsl"; cwd: string | null; toLocal: (posix: string) => string | null }
  | { kind: "remote"; cwd: string | null };

/**
 * 푼 결과 — 바로 열 경로(`path`) 또는 **홈 기준 나머지**(`home` — 여는 자리가 백엔드의 `home()` 을 물어 잇는다:
 * 홈은 느린 왕복이라 이 순수 층이 모른다). 열 수 없으면 `null`(링크를 걸지 않는다).
 */
export type ResolvedPath = { path: string } | { home: string } | null;

export function isWinAbs(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path);
}

/**
 * `base` 폴더에 `rel` 을 잇고 `.`·`..` 를 접는다. 구분자는 `sep` 하나로 맞춘다(`\` 면 `/` 도 `\` 로).
 * 뿌리(`C:\` · `\\server\share\` · `/`) 위로는 올라가지 않는다.
 */
export function joinNormalize(base: string, rel: string, sep: "/" | "\\"): string {
  const full = `${base}${sep}${rel}`;
  const unified = sep === "\\" ? full.replace(/\//g, "\\") : full;
  let root = "";
  let rest = unified;
  const drive = /^[A-Za-z]:\\/.exec(unified);
  const unc = /^\\\\[^\\]+\\[^\\]+\\?/.exec(unified);
  if (sep === "\\" && drive) {
    root = drive[0];
    rest = unified.slice(root.length);
  } else if (sep === "\\" && unc) {
    root = unc[0].endsWith("\\") ? unc[0] : `${unc[0]}\\`;
    rest = unified.slice(unc[0].length);
  } else if (unified.startsWith(sep)) {
    root = sep;
    rest = unified.slice(1);
  }
  const parts: string[] = [];
  for (const seg of rest.split(sep)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return root + parts.join(sep);
}

/** 폴더 경로의 구분자 — 드라이브 · UNC · 역슬래시가 보이면 `\`, 아니면 `/` */
export function sepOf(dir: string): "/" | "\\" {
  return isWinAbs(dir) || dir.includes("\\") ? "\\" : "/";
}

/** 찾은 토막 → 그 타일에서 열 경로 (위 [`ResolvedPath`]) */
export function resolvePathLink(m: Pick<PathMatch, "path" | "form">, place: PathLinkPlace): ResolvedPath {
  const { path, form } = m;
  if (form === "abs") {
    if (place.kind === "remote") return isWinAbs(path) ? null : { path };
    if (place.kind === "wsl" && !isWinAbs(path)) {
      const local = place.toLocal(path);
      return local ? { path: local } : null;
    }
    return { path };
  }
  if (form === "home") {
    // WSL 의 `~` 는 배포판 안의 홈이다 — 이 컴퓨터의 홈(`local_home`)이 아니다. 옮길 길이 없어 걸지 않는다.
    if (place.kind === "wsl") return null;
    return { home: path.slice(2) };
  }
  const cwd = place.cwd?.trim() ?? "";
  if (cwd === "") return null;
  if (place.kind === "remote") {
    if (!cwd.startsWith("/")) return null;
    return { path: joinNormalize(cwd, path.replace(/\\/g, "/"), "/") };
  }
  if (place.kind === "wsl") {
    if (!cwd.startsWith("/")) return null;
    const local = place.toLocal(joinNormalize(cwd, path.replace(/\\/g, "/"), "/"));
    return local ? { path: local } : null;
  }
  return { path: joinNormalize(cwd, path, sepOf(cwd)) };
}

/** 홈 폴더에 나머지를 잇는다 ([`ResolvedPath`] 의 `home` 갈래를 여는 자리가 마무리할 때) */
export function joinHome(home: string, rest: string): string {
  return joinNormalize(home, rest, sepOf(home));
}

// ---------------------------------------------------------------------------
// OSC 8 하이퍼링크의 주소
// ---------------------------------------------------------------------------

/**
 * `file://` 주소 → 이 컴퓨터의 경로. 호스트가 비었거나 `localhost` 일 때만(그 밖의 호스트는 다른 기계의 파일이다 —
 * `ls --hyperlink` 가 원격에서 붙이는 모양). `file:///C:/a/b.md` 는 `C:/a/b.md`. 모양이 아니면 `null`.
 */
export function fileUrlToLocalPath(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "" && host !== "localhost") return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  return path === "" || path === "/" ? null : path;
}

/**
 * OSC 8 링크를 눌렀을 때 할 일 — `web`(http · https 만, 기존 동작) · `doc`(로컬 타일의 로컬 `file://` 이고 이름이
 * 텍스트로 보일 때) · `null`(아무것도 하지 않는다 — 그 밖의 스킴은 **원격이 보낸 바이트**라 여는 문을 두지 않는다:
 * docs/log/2026-09-23-osc52-osc8.md).
 */
export type OscLinkAction = { kind: "web"; url: string } | { kind: "doc"; path: string } | null;

export function oscLinkAction(uri: string, localTile: boolean): OscLinkAction {
  let protocol: string;
  try {
    protocol = new URL(uri).protocol;
  } catch {
    return null;
  }
  if (protocol === "http:" || protocol === "https:") return { kind: "web", url: uri };
  if (protocol !== "file:" || !localTile) return null;
  const path = fileUrlToLocalPath(uri);
  return path !== null && isTextLike(path) ? { kind: "doc", path } : null;
}
