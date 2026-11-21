import { isDirLike, type SftpEntry } from "$lib/sftp-browser";

/** Rust `text_file::PREVIEW_MAX_BYTES` 의 짝 — 그쪽이 바뀌면 여기도 고친다 */
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

export const PREVIEW_DELAY_MS = 150;

/**
 * Blob 에 MIME 을 붙여야 `<img>` 가 SVG 를 그린다.
 * SVG 는 `<img>` 로만 그린다 — 그 문맥에서는 스크립트가 돌지 않고 바깥 자원도 읽지 않는다(`innerHTML` 로 붙이지 않는다).
 */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

function extOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at <= 0 ? "" : name.slice(at + 1).toLowerCase();
}

export function imageMime(name: string): string | null {
  return IMAGE_MIME[extOf(name)] ?? null;
}

export type PreviewPlan = "image" | "too-large" | "glyph";

export function previewPlan(entry: SftpEntry): PreviewPlan {
  if (isDirLike(entry) || imageMime(entry.name) === null) return "glyph";
  return entry.size > PREVIEW_MAX_BYTES ? "too-large" : "image";
}

export type PreviewSubject =
  | { kind: "folder" }
  | { kind: "one"; entry: SftpEntry; plan: PreviewPlan }
  | { kind: "many"; count: number; bytes: number };

export function previewSubject(selected: readonly SftpEntry[]): PreviewSubject {
  if (selected.length === 0) return { kind: "folder" };
  if (selected.length === 1) return { kind: "one", entry: selected[0], plan: previewPlan(selected[0]) };
  let bytes = 0;
  for (const e of selected) if (!isDirLike(e) && Number.isFinite(e.size) && e.size > 0) bytes += e.size;
  return { kind: "many", count: selected.length, bytes };
}
