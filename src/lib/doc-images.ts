import { classifyDocHref, resolveDocLink } from "$lib/doc-links";
import { parseMarkdown, type MdBlock, type MdInline } from "$lib/markdown";
import { isWinAbs } from "$lib/path-links";

/**
 * **문서 타일의 그림** — 순수 모듈. `![alt](src)` 의 주소를 **불러올지** 정하고([`docImagePlan`]), 글에서 그림 주소를 모은다
 * ([`imageSrcsOf`]). 읽기 · Blob URL · 캐시는 `doc-images.svelte.ts`, 그리기는 `MarkdownBlocks` 다.
 *
 * - 불러오는 것은 **스킴 없는 경로**뿐이다(상대 · 절대 — 문서 링크와 같은 [`classifyDocHref`] · [`resolveDocLink`] 규칙, 문서와
 *   같은 백엔드). `http`/`https` · `data:` · `file:` · `//host` 같은 주소는 **불러오지 않는다** — 문서를 여는 것만으로 바깥에
 *   요청이 나가면 추적 픽셀이 된다(대체 글자 + 툴팁에 주소).
 * - 확장자는 그림 형식만(아래 표). SVG 도 `<img>` 로만 그린다 — 그 문맥에서는 스크립트가 돌지 않고 바깥 자원도 읽지 않는다
 *   (`innerHTML` 로 붙이지 않는다 — 파일 타일 미리 보기 패널과 같은 규칙).
 */

/** 이보다 큰 그림은 불러오지 않는다 — 문서 속 그림 한 장의 상한(파일 타일 미리 보기 패널은 20MB) */
export const DOC_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** 그리는 확장자 → MIME. Blob 에 MIME 을 붙여야 `<img>` 가 SVG 를 그린다(나머지는 바이트로 알아보지만 함께 적는다) */
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

/** 경로의 확장자가 그릴 그림이면 그 MIME, 아니면 `null` (점으로 시작하는 이름은 확장자가 아니다) */
export function docImageMime(path: string): string | null {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const at = name.lastIndexOf(".");
  if (at <= 0) return null;
  return IMAGE_MIME[name.slice(at + 1).toLowerCase()] ?? null;
}

/**
 * 그림 주소 하나의 할 일.
 * - `load` — 그 백엔드에서 `path` 를 읽어 그린다
 * - `skip` — 불러오지 않는다: `scheme`(스킴 있는 주소 · `//host`) · `path`(풀 수 없는 경로 · `#절` 만) · `ext`(그림 형식이 아님)
 */
export type DocImagePlan = { kind: "load"; path: string; mime: string } | { kind: "skip"; why: "scheme" | "path" | "ext" };

/** 네트워크 경로(`\\server\share\…` · `//server/…` · `\\?\UNC\…`)인가 — 로컬 윈도우에서 읽으면 SMB 연결이 나간다 */
export function isNetworkPath(path: string): boolean {
  return /^[\\/]{2}/.test(path);
}

/**
 * 기준 폴더 없이 풀 수 있는 경로 — 절대 경로만(원격 = `/…` · 로컬 = `C:\…` · `C:/…` · `\\…`). 상대 경로와 로컬의 `/…`(드라이브 뿌리를
 * 모른다)는 `null`. AI 타일 대화 면(2026-10-24): 셸이 폴더를 아직 알리지 않아도 CLI 가 적은 절대 경로 그림(Codex `savedPath` 등)은 읽는다.
 */
function absoluteOnly(path: string, remote: boolean): string | null {
  if (remote) return path.startsWith("/") ? resolveDocLink("/", path, true) : null;
  return isWinAbs(path) ? resolveDocLink(path, path, false) : null;
}

/**
 * `docPath` 는 지금 문서의 절대 경로, `remote` 면 원격(POSIX) — [`resolveDocLink`] 와 같다. `docPath` 가 비면(기준 폴더를 모른다)
 * 절대 경로만 풀고 상대 경로는 `path` 다.
 * `noNetwork` 면 푼 경로가 네트워크 경로일 때 바깥 주소처럼(`scheme`) 불러오지 않는다 — 사이드 채팅(2026-10-24): 글을 AI 가 쓰므로
 * (웹 검색 결과를 옮겨 적는 등) `![](\\host\share\a.png)` 하나로 대화를 여는 순간 SMB 요청(계정 해시)이 나가지 않게. 문서 보기 타일은
 * 공유 폴더의 문서가 제 곁 그림을 읽어야 해 끄지 않는다(문서는 사람이 연 파일이다).
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

/**
 * 링크 주소가 **그림 파일 경로**인가 — 스킴 없는 경로 + 그림 확장자(풀기 · 불러올지는 여전히 [`docImagePlan`]). 사이드 채팅의 링크 그림
 * (`MarkdownBlocks` 의 `linkImages` — 2026-10-24 실기: Codex 는 만든 SVG 를 파일로 쓰고 `[열기](C:/…/a.svg)` 링크로 답한다).
 */
export function isImageLinkHref(href: string): boolean {
  const c = classifyDocHref(href);
  return c.kind === "path" && docImageMime(c.path) !== null;
}

/**
 * 블록들 속 그림 주소(`image` 토막만 — 배지 링크 `[![a](img)](url)` 는 대체 글자 그대로라 빠진다) · 겹치면 하나.
 * `links` 면 그림 파일을 가리키는 여느 링크([`isImageLinkHref`])의 주소도 — 사이드 채팅의 링크 그림.
 */
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

/**
 * 글 여럿(사이드 채팅의 에이전트 말들 — `TranscriptBody` 의 `images`) 속 그림 주소 — 그림 파일을 가리키는 링크까지(`links`) · 겹치면 하나.
 * `](` 가 없는 글은 파싱하지 않는다(긴 대화를 볼 때마다 전부 다시 읽지 않게 — 그리기는 따로 파싱한다).
 */
export function imageSrcsOfTexts(texts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text.includes("](")) continue;
    for (const src of imageSrcsOf(parseMarkdown(text), true)) out.add(src);
  }
  return [...out];
}
