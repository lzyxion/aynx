// 파일 타일의 **미리 보기 패널** — 무엇을 그릴지 정하는 순수 규칙 (docs/log/2026-10-07-file-tile-dolphin.md "10").
// 그림 판정 · 크기 상한 · MIME · 패널 상태. 읽기(지연 · 늦은 응답 버리기 · Blob URL)는 `PreviewPanel.svelte` 가 한다.
import { isDirLike, type SftpEntry } from "$lib/sftp-browser";

/**
 * 바이트로 받아 그릴 파일의 상한 — Rust `text_file::PREVIEW_MAX_BYTES` 의 짝이라 그쪽이 바뀌면 여기도 고친다.
 * 넘으면 묻지 않고 "너무 커서 미리 보지 않음" + 속성만 보인다.
 */
export const PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

/** 선택이 빨리 바뀔 때 읽기를 미루는 시간 — 화살표로 훑는 동안 파일마다 읽지 않게 */
export const PREVIEW_DELAY_MS = 150;

/**
 * 그림으로 그리는 확장자 → MIME. Blob 에 MIME 을 붙여야 `<img>` 가 SVG 를 그린다(나머지는 바이트로 알아보지만 함께 적는다).
 * SVG 는 **`<img>` 로만** 그린다 — 그 문맥에서는 스크립트가 돌지 않고 바깥 자원도 읽지 않는다(`innerHTML` 로 붙이지 않는다).
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

/** 이름의 확장자(소문자) — 없으면 `""` (점으로 시작하는 이름은 확장자가 아니다) */
function extOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at <= 0 ? "" : name.slice(at + 1).toLowerCase();
}

/** 그림으로 그릴 파일이면 그 MIME, 아니면 `null` */
export function imageMime(name: string): string | null {
  return IMAGE_MIME[extOf(name)] ?? null;
}

/**
 * 하나만 골랐을 때 패널이 할 일:
 * - `image` — 바이트를 읽어 그린다
 * - `too-large` — 그림이지만 상한을 넘었다(속성만)
 * - `glyph` — 그림이 아니다(폴더 · 링크 · 그 밖의 파일) — 큰 글리프 + 속성
 */
export type PreviewPlan = "image" | "too-large" | "glyph";

export function previewPlan(entry: SftpEntry): PreviewPlan {
  if (isDirLike(entry) || imageMime(entry.name) === null) return "glyph";
  return entry.size > PREVIEW_MAX_BYTES ? "too-large" : "image";
}

/** 패널 전체의 상태 — 고른 게 없으면 지금 폴더, 하나면 그 항목, 여럿이면 요약 */
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
