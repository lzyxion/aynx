import { classifyDocHref, resolveDocLink } from "$lib/doc-links";
import { parseMarkdown, type MdBlock, type MdInline } from "$lib/markdown";
import { isWinAbs } from "$lib/path-links";

/**
 * 문서 타일의 그림 — 순수 모듈. 불러오는 것은 스킴 없는 경로뿐이다 — `http` · `data:` · `file:` · `//host` 를 불러오면 문서를 여는 것만으로
 * 바깥에 요청이 나가 추적 픽셀이 된다. SVG 도 `<img>` 로만 그린다(`innerHTML` 로 붙이지 않는다 — 스크립트 · 바깥 자원이 돌지 않게).
 */

export const DOC_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Blob 에 MIME 을 붙여야 `<img>` 가 SVG 를 그린다 */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

/** 점으로 시작하는 이름은 확장자가 아니다 */
export function docImageMime(path: string): string | null {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const at = name.lastIndexOf(".");
  if (at <= 0) return null;
  return IMAGE_MIME[name.slice(at + 1).toLowerCase()] ?? null;
}

export type DocImagePlan = { kind: "load"; path: string; mime: string } | { kind: "skip"; why: "scheme" | "path" | "ext" };

/** 로컬 윈도우에서 읽으면 SMB 연결이 나간다 */
export function isNetworkPath(path: string): boolean {
  return /^[\\/]{2}/.test(path);
}

/** 로컬의 `/…` 는 드라이브 뿌리를 몰라 `null` */
function absoluteOnly(path: string, remote: boolean): string | null {
  if (remote) return path.startsWith("/") ? resolveDocLink("/", path, true) : null;
  return isWinAbs(path) ? resolveDocLink(path, path, false) : null;
}

/**
 * `docPath` 가 비면 절대 경로만 푼다. `noNetwork`(사이드 채팅) — 글을 AI 가 쓰므로 `![](\\host\share\a.png)` 하나로 대화를 여는 순간
 * SMB 요청(계정 해시)이 나가지 않게 막는다. 문서 보기 타일은 사람이 연 파일이라 끄지 않는다.
 */
export function docImagePlan(docPath: string, src: string, remote: boolean, noNetwork = false): DocImagePlan {
  const c = classifyDocHref(src);
  if (c.kind === "web" || c.kind === "other") return { kind: "skip", why: "scheme" };
  if (c.kind !== "path") return { kind: "skip", why: "path" };
  const path = docPath === "" ? absoluteOnly(c.path, remote) : resolveDocLink(docPath, c.path, remote);
  if (path === null) return { kind: "skip", why: "path" };
  if (noNetwork && !remote && isNetworkPath(path)) return { kind: "skip", why: "scheme" };
  const mime = docImageMime(path);
  return mime === null ? { kind: "skip", why: "ext" } : { kind: "load", path, mime };
}

export function isImageLinkHref(href: string): boolean {
  const c = classifyDocHref(href);
  return c.kind === "path" && docImageMime(c.path) !== null;
}

/** 배지 링크 `[![a](img)](url)` 는 대체 글자 그대로라 빠진다 */
export function imageSrcsOf(blocks: readonly MdBlock[], links = false): string[] {
  const out = new Set<string>();
  const inl = (xs: readonly MdInline[]) => {
    for (const x of xs) {
      if (x.kind === "image") out.add(x.href);
      else if (links && x.kind === "link" && !x.image && isImageLinkHref(x.href)) out.add(x.href);
      else if ((x.kind === "strong" || x.kind === "em" || x.kind === "del") && x.inlines) inl(x.inlines);
    }
  };
  const walk = (bs: readonly MdBlock[]) => {
    for (const b of bs) {
      if (b.kind === "p" || b.kind === "h") inl(b.inlines);
      else if (b.kind === "list") for (const it of b.items) inl(it.inlines);
      else if (b.kind === "table") {
        for (const c of b.header) inl(c);
        for (const r of b.rows) for (const c of r) inl(c);
      } else if (b.kind === "quote" || b.kind === "alert") walk(b.blocks);
      else if (b.kind === "footnotes") for (const it of b.items) inl(it.inlines);
    }
  };
  walk(blocks);
  return [...out];
}

/** `](` 가 없는 글은 파싱하지 않는다 — 긴 대화를 볼 때마다 전부 다시 읽지 않게 */
export function imageSrcsOfTexts(texts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text.includes("](")) continue;
    for (const src of imageSrcsOf(parseMarkdown(text), true)) out.add(src);
  }
  return [...out];
}
