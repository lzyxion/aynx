import { docImageMime } from "$lib/doc-images";

/**
 * 그림 우클릭 메뉴의 순수 조각 — 원격 창(브라우저)에는 OS 저장 대화상자가 없어(폴리필이 `dialog|save` 를 거절한다) [다른 이름으로 저장…] 을 세우지 않는다.
 */

/** 그림의 출처 — 파일(경로) · ```svg 블록(원문) · 경로 없는 그림(기록 속 사람 말에 바로 실린 것 — 복사할 링크가 없다) */
export type ImageKind = "file" | "svg" | "inline";

export type ImageMenuAction = "download" | "saveAs" | "copyImage" | "copyLink" | "copySvg";

export interface ImageMenuExtra {
  id: string;
  label: string;
  disabled?: boolean;
}

export function imageMenuActions(kind: ImageKind, remote: boolean): ImageMenuAction[] {
  const out: ImageMenuAction[] = ["download"];
  if (!remote) out.push("saveAs");
  out.push("copyImage");
  if (kind !== "inline") out.push(kind === "file" ? "copyLink" : "copySvg");
  return out;
}

export const SVG_DEFAULT_NAME = "image.svg";

/** 파일 이름에 못 쓰는 글자(Windows 기준 — 다른 OS 에서도 안전한 부분집합) · 제어 문자 */
// eslint-disable-next-line no-control-regex
const BAD_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeFileStem(text: string): string {
  const s = text.replace(/\s+/g, " ").replace(BAD_NAME_CHARS, "_").trim().replace(/^[.\s]+|[.\s]+$/g, "");
  return s.slice(0, 80).trim();
}

export function svgFileName(code: string): string {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(code);
  const stem = m ? sanitizeFileStem(m[1].replace(/<[^>]*>/g, "")) : "";
  return stem === "" ? SVG_DEFAULT_NAME : `${stem}.svg`;
}

export function fileImageName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || "image";
}

export function inlineImageName(mime: string, index: number): string {
  const exts: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  const ext = exts[mime] ?? "png";
  return `image-${index + 1}.${ext}`;
}

/** 겹치면 확장자 앞에 ` (1)` · ` (2)` … — 대소문자는 가리지 않는다(Windows · macOS 의 기본 파일 시스템). */
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

export function imageSaveFilters(name: string): { name: string; extensions: string[] }[] {
  const at = name.lastIndexOf(".");
  const ext = at > 0 ? name.slice(at + 1).toLowerCase() : "";
  if (ext === "" || docImageMime(name) === null) return [];
  return [{ name: ext.toUpperCase(), extensions: [ext] }];
}
