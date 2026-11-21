import { isTextLike } from "$lib/doc-lang";
import { imageMime } from "$lib/browser/preview";

/**
 * 구분자 없는 맨 이름은 점이 있을 때만 잡는다 — 점 없는 이름은 산문의 낱말과 구별되지 않는다. 경로 안의 공백은 잡지 않는다.
 * URL 과 겹치는 토막은 여기서 먼저 뺀다 — xterm 프로바이더 등록 순서에 기대지 않는다.
 */

/** `start`/`end` 는 그 줄 문자열의 반열린 구간 */
export interface PathMatch {
  start: number;
  end: number;
  path: string;
  form: "abs" | "home" | "rel";
  line?: number;
  col?: number;
}

const TOKEN = /[^\s"'`<>()[\]{}|,;=]+/g;
const URL_RE = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`<>]*/g;
const TRAILING_PUNCT = /[.,:;!?]+$/;
/** 줄은 1 또는 4번 무리, 칸은 2번(범위의 끝 줄은 버린다) */
const LINE_COL = /(?::(\d+)(?::(\d+)|-(\d+))?|#L(\d+)(?:-L?(\d+))?)$/;
const GLOB = /[*?]/;

export function isOpenablePath(path: string): boolean {
  return isTextLike(path) || imageMime(path) !== null;
}

function baseName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(i + 1);
}

function formOf(path: string): PathMatch["form"] | null {
  if (/^[A-Za-z]:[\\/]/.test(path)) return "abs";
  if (/^\\\\[^\\]/.test(path)) return "abs";
  if (path.startsWith("/")) return path.startsWith("//") ? null : "abs";
  if (/^~[\\/]/.test(path)) return "home";
  if (path.includes("/") || path.includes("\\")) return "rel";
  return path.includes(".") ? "rel" : null;
}

function urlRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(URL_RE)) out.push([m.index, m.index + m[0].length]);
  return out;
}

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
      line = Number(lc[1] ?? lc[4]);
      if (lc[2] !== undefined) col = Number(lc[2]);
      token = token.slice(0, lc.index);
    }
    const path = token;
    if (path === "" || GLOB.test(path) || path.includes("://")) continue;
    const form = formOf(path);
    if (form === null) continue;
    const name = baseName(path);
    if (name === "" || name === "." || name === "..") continue;
    if (!isOpenablePath(path)) continue;
    out.push({ start, end, path, form, ...(line !== undefined ? { line } : {}), ...(col !== undefined ? { col } : {}) });
  }
  return out;
}

/** 맨 이름도 지난다 — 대화 면 링크 주소(`doc-links.ts` 의 `hrefPathLink`)는 일부러 건 링크라서다 */
export function wholePathLink(text: string): PathMatch | null {
  const found = findPathLinks(text);
  return found.length === 1 && found[0].start === 0 && found[0].end === text.length ? found[0] : null;
}

/** 맨 이름은 산문 · 코드 조각에 너무 흔해 대화 면에서는 걸지 않는다 — 터미널 Ctrl+클릭은 이 거름을 쓰지 않는다 */
function chatCue(m: PathMatch): boolean {
  return m.form !== "rel" || /[\\/]/.test(m.path) || m.line !== undefined;
}

export function codePathLink(text: string): PathMatch | null {
  const m = wholePathLink(text);
  return m && chatCue(m) ? m : null;
}

export function prosePathLinks(text: string): PathMatch[] {
  return findPathLinks(text).filter(chatCue);
}

export function splitProsePaths(text: string): Array<{ text: string; path: boolean }> {
  const out: Array<{ text: string; path: boolean }> = [];
  let at = 0;
  for (const m of prosePathLinks(text)) {
    if (m.start > at) out.push({ text: text.slice(at, m.start), path: false });
    out.push({ text: text.slice(m.start, m.end), path: true });
    at = m.end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), path: false });
  return out;
}

/** `local` 의 `cwd` 는 셸이 마지막으로 알린 OSC 7 그대로다 — PowerShell 에서 `prompt` 를 새로 정의하면 훅이 사라져 상대 경로가 옛 폴더 기준으로 풀린다 */
export type PathLinkPlace =
  | { kind: "local"; cwd: string | null }
  | { kind: "wsl"; cwd: string | null; toLocal: (posix: string) => string | null }
  | { kind: "remote"; cwd: string | null };

/** `home` 은 홈 기준 나머지 — 홈은 느린 왕복이라 이 순수 층은 모르고 여는 자리가 잇는다 */
export type ResolvedPath = { path: string } | { home: string } | null;

export function isWinAbs(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path);
}

/** 뿌리(`C:\` · `\\server\share\` · `/`) 위로는 올라가지 않는다 */
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

export function sepOf(dir: string): "/" | "\\" {
  return isWinAbs(dir) || dir.includes("\\") ? "\\" : "/";
}

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

export function joinHome(home: string, rest: string): string {
  return joinNormalize(home, rest, sepOf(home));
}

// ── OSC 8 하이퍼링크의 주소 ──

/** 호스트가 비었거나 `localhost` 일 때만 — 그 밖의 호스트는 다른 기계의 파일이다(`ls --hyperlink` 가 원격에서 붙이는 모양) */
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

/** http · https · 로컬 타일의 로컬 `file://` 만 연다 — 그 밖의 스킴은 원격이 보낸 바이트라 여는 문을 두지 않는다(docs/log/2026-09-23-osc52-osc8.md) */
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
  return path !== null && isOpenablePath(path) ? { kind: "doc", path } : null;
}
