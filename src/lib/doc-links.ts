import { isWebUrl, type MdBlock, type MdInline } from "$lib/markdown";
import { isWinAbs, joinNormalize, sepOf } from "$lib/path-links";

/**
 * **문서 안의 링크** — 순수 모듈 (docs/log/2026-09-27-doc-tile.md "B7 — 상대 링크").
 *
 * 그린 마크다운의 링크 주소를 가르고([`classifyDocHref`]), 경로면 **그 문서의 폴더** 기준으로 풀고
 * ([`resolveDocLink`]), 제목에 GitHub 식 앵커 이름을 단다([`slugify`] · [`headingSlugs`]). 화면(여는 일 · 스크롤)은
 * `DocView` 와 `app/panes.svelte.ts` 의 `openDocLink` 가 한다 — 여기는 글자만 본다.
 */

/**
 * 링크 주소 한 개의 갈래.
 *
 * - `web` — `http`/`https`(지금까지와 같이 opener 로 연다 — 판정은 `isWebUrl` 하나)
 * - `anchor` — `#절` 만(같은 문서의 제목으로 스크롤)
 * - `path` — 스킴 없는 경로(상대 · 절대) + 선택적 `#절`
 * - `other` — 그 밖(`mailto:` · `javascript:` · `file:` · `//host` · 빈 주소) — **아무것도 하지 않는다**
 */
export type DocHref =
  | { kind: "web"; url: string }
  | { kind: "anchor"; anchor: string }
  | { kind: "path"; path: string; anchor?: string }
  | { kind: "other" };

/** 퍼센트 인코딩을 푼다 — 모양이 틀리면 그대로 */
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 링크 주소 → 갈래 ([`DocHref`]) */
export function classifyDocHref(href: string): DocHref {
  const h = href.trim();
  if (h === "") return { kind: "other" };
  if (isWebUrl(h)) return { kind: "web", url: h };
  if (h.startsWith("#")) {
    const anchor = decode(h.slice(1));
    return anchor === "" ? { kind: "other" } : { kind: "anchor", anchor };
  }
  // 윈도우 드라이브(`C:\` · `C:/`)는 스킴이 아니라 경로다. 그 밖의 `글자:` 는 모두 스킴
  if (!/^[A-Za-z]:[\\/]/.test(h) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(h)) return { kind: "other" };
  // 스킴 생략 주소(`//host/x`)는 다른 기계다
  if (h.startsWith("//")) return { kind: "other" };
  const hash = h.indexOf("#");
  let pathPart = hash < 0 ? h : h.slice(0, hash);
  const anchor = hash < 0 ? "" : decode(h.slice(hash + 1));
  const q = pathPart.indexOf("?");
  if (q >= 0) pathPart = pathPart.slice(0, q);
  const path = decode(pathPart);
  if (path === "") return anchor === "" ? { kind: "other" } : { kind: "anchor", anchor };
  return anchor === "" ? { kind: "path", path } : { kind: "path", path, anchor };
}

/** 윈도우 경로의 뿌리(`C:` · `\\server\share`) — 끝 구분자 없이. 없으면 `null` */
function winRoot(path: string): string | null {
  const drive = /^[A-Za-z]:/.exec(path);
  if (drive) return drive[0];
  const unc = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.exec(path);
  return unc ? unc[0].replace(/\//g, "\\") : null;
}

/** 파일 경로의 폴더 — 구분자가 없으면 `null` */
function dirOf(path: string): string | null {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? null : path.slice(0, i);
}

/**
 * 문서 안의 경로 링크 → 열 파일의 경로. `docPath` 는 지금 문서의 절대 경로, `remote` 면 원격(POSIX)이다.
 *
 * - 상대(`a.md` · `./docs/a.md` · `../x.md`) — 문서의 폴더 기준으로 잇고 `.`·`..` 를 접는다.
 * - 절대 POSIX(`/abs/x.md`) — 원격이면 그대로, 로컬 윈도우면 **그 문서의 드라이브(또는 UNC 공유) 뿌리** 기준.
 * - 윈도우 절대(`C:\…` · `C:/…`) — 로컬만(원격에서는 열 수 없다 → `null`).
 *
 * 구분자는 문서 경로의 모양을 따른다(로컬 윈도우 = `\` · 원격 = `/`).
 */
export function resolveDocLink(docPath: string, link: string, remote: boolean): string | null {
  if (docPath === "" || link === "") return null;
  if (remote) {
    if (isWinAbs(link) || !docPath.startsWith("/")) return null;
    const l = link.replace(/\\/g, "/");
    if (l.startsWith("/")) return joinNormalize("", l.slice(1), "/");
    const dir = dirOf(docPath);
    return dir === null ? null : joinNormalize(dir, l, "/");
  }
  const sep = sepOf(docPath);
  if (isWinAbs(link)) return joinNormalize(link, "", "\\");
  if (link.startsWith("/") || link.startsWith("\\")) {
    if (sep === "/") return joinNormalize("", link.slice(1), "/");
    const root = winRoot(docPath);
    return root === null ? null : joinNormalize(root, link.slice(1), "\\");
  }
  const dir = dirOf(docPath);
  return dir === null ? null : joinNormalize(dir, link, sep);
}

/**
 * GitHub 식 제목 앵커 — 소문자 · 글자/숫자/`_`/`-`/공백 밖은 지움 · 공백은 `-`. 한글 등 유니코드 글자는 남는다
 * (`github-slugger` 와 같은 규칙 · 여러 공백을 하나로 접지 않는 것까지).
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** 인라인 → 평문(링크는 글자 · 그림은 대체 글) — 앵커 이름과 목차(`doc-outline.ts`)가 같은 글자를 본다 */
export function inlineText(xs: MdInline[]): string {
  return xs.map((x) => x.text).join("");
}

/**
 * 문서 안 모든 제목(인용 · 알림 속 제목 포함 · 문서 순서)의 앵커 — 같은 이름은 `-1` · `-2` 를 붙여 가른다(GitHub 와 같다).
 * 블록 객체 자체가 열쇠다(그리는 쪽이 같은 배열을 들고 있다).
 */
export function headingSlugs(blocks: MdBlock[]): Map<MdBlock, string> {
  const out = new Map<MdBlock, string>();
  const seen = new Map<string, number>();
  const walk = (bs: MdBlock[]) => {
    for (const b of bs) {
      if (b.kind === "quote" || b.kind === "alert") walk(b.blocks);
      else if (b.kind === "h") {
        const base = slugify(inlineText(b.inlines));
        let slug = base;
        while (seen.has(slug)) {
          const n = (seen.get(base) ?? 0) + 1;
          seen.set(base, n);
          slug = `${base}-${n}`;
        }
        seen.set(slug, 0);
        out.set(b, slug);
      }
    }
  };
  walk(blocks);
  return out;
}

/**
 * 앵커가 가리키는 제목 — 적힌 그대로의 이름이 먼저, 없으면 앵커를 한 번 더 [`slugify`] 해 견준다(`#Setup Guide`
 * 처럼 사람이 손으로 쓴 앵커). 못 찾으면 `null`.
 */
export function matchAnchor(anchor: string, slugs: readonly string[]): string | null {
  if (slugs.includes(anchor)) return anchor;
  const s = slugify(anchor);
  return s !== "" && slugs.includes(s) ? s : null;
}
