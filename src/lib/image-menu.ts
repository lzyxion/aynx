import { docImageMime } from "$lib/doc-images";

/**
 * **그림 우클릭 메뉴의 순수 조각**(2026-10-24) — 문서 보기 타일 · 사이드 채팅의 그림(`MarkdownBlocks` 의 `md-img` · 링크 그림 ·
 * ```svg 블록 `SvgView`)에 서는 메뉴가 **어떤 항목을 세우고 어떤 이름으로 저장하는지**만 정한다. 읽기 · 쓰기 · 클립보드는
 * `image-actions.ts`, 그리기는 `ImageMenu.svelte` 다.
 *
 * - 파일 그림(경로가 있는 것)은 [이미지 링크 복사](그 절대 경로 — 원격 문서 타일이면 원격 경로), ```svg 블록은 파일이 없어 그 자리에
 *   [SVG 코드 복사](원문)가 선다.
 * - 원격 창(브라우저)에는 OS 저장 대화상자가 없다(폴리필이 `dialog|save` 를 거절한다) — [다른 이름으로 저장…] 은 세우지 않고,
 *   [이미지 다운로드] 는 집 PC 의 다운로드 폴더가 아니라 **그 브라우저의 내려받기**로 간다(`image-actions.ts`).
 */

/** 그림의 출처 — 파일(경로) · ```svg 블록(원문) · 경로 없는 그림(기록 속 사람 말에 바로 실린 것 — 복사할 링크가 없다) */
export type ImageKind = "file" | "svg" | "inline";

export type ImageMenuAction = "download" | "saveAs" | "copyImage" | "copyLink" | "copySvg";

/** 메뉴에 설 항목들 — 순서 그대로 그린다 */
export function imageMenuActions(kind: ImageKind, remote: boolean): ImageMenuAction[] {
  const out: ImageMenuAction[] = ["download"];
  if (!remote) out.push("saveAs");
  out.push("copyImage");
  if (kind !== "inline") out.push(kind === "file" ? "copyLink" : "copySvg");
  return out;
}

/** ```svg 블록에 `<title>` 이 없거나 이름으로 쓸 글자가 남지 않을 때의 이름 */
export const SVG_DEFAULT_NAME = "image.svg";

/** 파일 이름에 못 쓰는 글자(Windows 기준 — 다른 OS 에서도 안전한 부분집합) · 제어 문자 */
// eslint-disable-next-line no-control-regex
const BAD_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** 사람이 쓴 글자를 파일 이름 줄기로 — 못 쓰는 글자는 `_`, 앞뒤 공백 · 점은 걷고 80자까지. 남는 것이 없으면 `""` */
export function sanitizeFileStem(text: string): string {
  const s = text.replace(/\s+/g, " ").replace(BAD_NAME_CHARS, "_").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  return s.slice(0, 80).trim();
}

/** ```svg 원문의 저장 이름 — 첫 `<title>` 글자가 있으면 그것, 없으면 [`SVG_DEFAULT_NAME`] */
export function svgFileName(code: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(code);
  const stem = m ? sanitizeFileStem(m[1].replace(/<[^>]*>/g, "")) : "";
  return stem === "" ? SVG_DEFAULT_NAME : `${stem}.svg`;
}

/** 파일 그림의 저장 이름 — 원래 이름(경로의 마지막 조각) */
export function fileImageName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || "image";
}

/** 경로 없는 그림의 저장 이름 — `image-<차례>.<형식>`(차례는 1부터) */
export function inlineImageName(mime: string, index: number): string {
  const exts: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  const ext = exts[mime] ?? "png";
  return `image-${index + 1}.${ext}`;
}

/**
 * `taken`(그 폴더에 이미 있는 이름들)과 겹치지 않는 이름 — 겹치면 확장자 앞에 ` (1)` · ` (2)` … (대소문자는 가리지 않는다 —
 * Windows · macOS 의 기본 파일 시스템). 점으로 시작하는 이름(`.png`)은 확장자가 없는 것으로 본다.
 */
export function freeFileName(name: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const n of taken) used.add(n.toLowerCase());
  if (!used.has(name.toLowerCase())) return name;
  const at = name.lastIndexOf(".");
  const [stem, ext] = at > 0 ? [name.slice(0, at), name.slice(at)] : [name, ""];
  for (let i = 1; i < 10000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!used.has(c.toLowerCase())) return c;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/** 저장 대화상자의 형식 칸 — 그 이름의 확장자 하나(그림 형식이 아니면 칸 없이) */
export function imageSaveFilters(name: string): { name: string; extensions: string[] }[] {
  const at = name.lastIndexOf(".");
  const ext = at > 0 ? name.slice(at + 1).toLowerCase() : "";
  if (ext === "" || docImageMime(name) === null) return [];
  return [{ name: ext.toUpperCase(), extensions: [ext] }];
}
