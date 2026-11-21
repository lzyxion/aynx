import { isWebUrl, type MdBlock, type MdInline } from "$lib/markdown";
import { isWinAbs, joinNormalize, sepOf, wholePathLink, type PathMatch } from "$lib/path-links";

/** 문서 안의 링크 — 순수 모듈 (docs/log/2026-09-27-doc-tile.md "B7 — 상대 링크"). */

/** `other`(`mailto:` · `javascript:` · `file:` · `//host` · 빈 주소)는 아무것도 하지 않는다 */
export type DocHref =
  | { kind: "web"; url: string }
  | { kind: "anchor"; anchor: string }
  | { kind: "path"; path: string; anchor?: string }
  | { kind: "other" };

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function classifyDocHref(href: string): DocHref {
  const h = href.trim();
  if (h === "") return { kind: "other" };
  if (isWebUrl(h)) return { kind: "web", url: h };
  if (h.startsWith("#")) {
    const anchor = decode(h.slice(1));
    return anchor === "" ? { kind: "other" } : { kind: "anchor", anchor };
  }
  // 윈도우 드라이브(`C:\` · `C:/`)는 스킴이 아니라 경로다
  if (!/^[A-Za-z]:[\\/]/.test(h) && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(h)) return { kind: "other" };
  // `//host/x` 는 다른 기계다
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

/** 대화 면의 링크 주소 → 터미널 경로 링크와 같은 토막. 문서 링크와 달리 그 타일 셸의 폴더 기준으로 푼다(부르는 쪽) */
export function hrefPathLink(href: string): PathMatch | null {
  const h = classifyDocHref(href);
  if (h.kind !== "path") return null;
  const m = wholePathLink(h.path);
  if (m === null) return null;
  const range = h.anchor !== undefined ? /^L(\d+)(?:-L?\d+)?$/.exec(h.anchor) : null;
  return range ? { start: m.start, end: m.end, path: m.path, form: m.form, line: Number(range[1]) } : m;
}

function winRoot(path: string): string | null {
  const drive = /^[A-Za-z]:/.exec(path);
  if (drive) return drive[0];
  const unc = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.exec(path);
  return unc ? unc[0].replace(/\//g, "\\") : null;
}

function dirOf(path: string): string | null {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? null : path.slice(0, i);
}

/** 로컬 윈도우의 `/abs` 는 그 문서의 드라이브(또는 UNC 공유) 뿌리 기준. 원격에서 윈도우 절대 경로는 `null` */
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

/** `github-slugger` 와 같은 규칙 — 여러 공백을 하나로 접지 않는 것까지 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}

/** 앵커 이름과 목차(`doc-outline.ts`)가 같은 글자를 본다 */
export function inlineText(xs: MdInline[]): string {
  return xs.map((x) => x.text).join("");
}

/** 인용 · 알림 속 제목도 번호를 먹는다(GitHub 와 같다). 블록 객체 자체가 열쇠다 */
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

export function matchAnchor(anchor: string, slugs: readonly string[]): string | null {
  if (slugs.includes(anchor)) return anchor;
  const s = slugify(anchor);
  return s !== "" && slugs.includes(s) ? s : null;
}
