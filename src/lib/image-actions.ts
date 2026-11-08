import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isRemote } from "$lib/ipc";
import { baseNameOf, localBackend, winParentOf } from "$lib/fs-backend";
import { localWriteFile } from "$lib/fs-ops";
import { writeClipboard, writeClipboardImage } from "$lib/clipboard";
import { stripReason } from "$lib/error-reason";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { fileImageName, freeFileName, imageSaveFilters, svgFileName, type ImageMenuAction } from "$lib/image-menu";

/**
 * **그림 우클릭 메뉴의 일**(2026-10-24) — 항목 판정 · 이름은 순수 `image-menu.ts`, 메뉴 상자는 `ImageMenu.svelte`.
 *
 * ## 쓰는 길 — 새 Tauri 명령은 없다
 *
 * 저장은 모두 파일 타일이 탐색기 드롭을 받는 **`local_write_file`**(`fs-ops.ts` 의 `localWriteFile` — 폴더 + 이름 + 바이트 · 충돌
 * 정책)을 지난다. 바이트는 파일 그림이면 그 백엔드에서 **원본을 다시 읽은 것**(`readPreview` — 로컬 디스크 · 원격 SFTP 같은 문,
 * 화면의 `blob:` 은 캐시가 언제든 거둘 수 있어 기대지 않는다), ```svg 블록이면 원문 글자다. 다운로드 폴더는 장소 패널과 같은
 * `local_places`(OS 가 알려 주는 자리)의 `downloads` 다. 두 명령 모두 원격 관문(`remote/deny.rs`)에서 ALLOW 다.
 *
 * - [이미지 다운로드] — 다운로드 폴더에 원래 이름으로, 있으면 ` (1)` · ` (2)` …(`freeFileName` — 목록을 읽어 고른다. 그 사이 누가
 *   같은 이름을 만들면 Rust 의 `rename` 정책이 한 번 더 민다). 끝나면 토스트에 놓인 경로 + [폴더에서 보기].
 * - [다른 이름으로 저장…] — OS 저장 대화상자(덮어쓰기는 대화상자가 이미 물었다 → `overwrite`).
 * - 원격 창(브라우저)은 집 PC 의 다운로드 폴더에 쓰지 않는다 — 그 브라우저의 내려받기(`<a download>`)로 준다(저장 대화상자는
 *   메뉴에 서지 않는다 — `imageMenuActions`).
 * - [이미지 복사] — PNG 한 장(`clipboard.ts` 의 `writeClipboardImage` — PNG 가 아니면 캔버스로 바꾼다).
 */

/** 메뉴가 연 그림 — 파일(경로 · 다시 읽는 손잡이) 또는 ```svg 원문 */
export type ImageTarget =
  | { kind: "file"; path: string; mime: string; read: () => Promise<ArrayBuffer> }
  | { kind: "svg"; code: string }
  /** 경로 없는 그림(기록 속 사람 말에 바로 실린 것 — `conv-images.svelte.ts`) — 저장 이름 · 다시 읽는 손잡이 */
  | { kind: "inline"; name: string; mime: string; read: () => Promise<ArrayBuffer> };

/** 캔버스로 바꿀 때 한 변의 상한 — 웹뷰 캔버스 한도 안 */
const RASTER_MAX = 8192;

const reasonOf = (e: unknown) => stripReason(e instanceof Error ? e.message : String(e));

function nameOf(target: ImageTarget): string {
  if (target.kind === "inline") return target.name;
  return target.kind === "file" ? fileImageName(target.path) : svgFileName(target.code);
}

async function bytesOf(target: ImageTarget): Promise<Blob> {
  if (target.kind === "svg") return new Blob([target.code], { type: "image/svg+xml" });
  return new Blob([await target.read()], { type: target.mime });
}

/** 메뉴 항목 하나 — 메뉴 통로(`runOnMenu`)가 닫은 뒤 부른다. `el` 은 우클릭한 `<img>`(캔버스 크기의 마지막 기댈 곳) */
export function runImageAction(action: ImageMenuAction, target: ImageTarget, el: HTMLImageElement | null): void {
  if (action === "download") void downloadImage(target);
  else if (action === "saveAs") void saveImageAs(target);
  else if (action === "copyImage") copyImage(target, el);
  else if (action === "copyLink" && target.kind === "file") void copyText(target.path, t("files.doc.md.image.menu.linkCopied"));
  else if (action === "copySvg" && target.kind === "svg") void copyText(target.code, t("files.doc.md.image.menu.svgCopied"));
}

async function copyText(text: string, done: string): Promise<void> {
  if (await writeClipboard(text)) toast.success(done);
  else toast.error(t("files.doc.md.image.menu.copyFailed"));
}

function savedToast(path: string): void {
  toast.success(t("files.doc.md.image.menu.saved", { path }), {
    action: {
      label: t("files.doc.md.image.menu.reveal"),
      run: () => void localBackend().reveal?.(path).catch(() => {}),
    },
  });
}

async function downloadImage(target: ImageTarget): Promise<void> {
  const name = nameOf(target);
  try {
    const blob = await bytesOf(target);
    if (isRemote) {
      // 원격 창 — 이 브라우저의 내려받기로(집 PC 의 폴더가 아니다)
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    const be = localBackend();
    const dir = (await be.places()).find((p) => p.kind === "downloads")?.path;
    if (!dir) {
      toast.error(t("files.doc.md.image.menu.noDownloads"));
      return;
    }
    const free = freeFileName(name, (await be.list(dir)).map((e) => e.name));
    const path = await localWriteFile(dir, new File([blob], free), "rename", t);
    if (path !== null) savedToast(path);
  } catch (e) {
    toast.error(t("files.doc.md.image.menu.saveFailed", { reason: reasonOf(e) }));
  }
}

async function saveImageAs(target: ImageTarget): Promise<void> {
  const name = nameOf(target);
  let path: string | null = null;
  try {
    path = await saveDialog({ defaultPath: name, filters: imageSaveFilters(name) });
  } catch (e) {
    console.error("[aynx] 저장 대화상자를 열지 못했습니다", e);
  }
  if (path === null) return; // 사용자가 취소했다
  try {
    const blob = await bytesOf(target);
    // 덮어쓸지는 OS 대화상자가 이미 물었다
    const saved = await localWriteFile(winParentOf(path), new File([blob], baseNameOf(path)), "overwrite", t);
    if (saved !== null) savedToast(saved);
  } catch (e) {
    toast.error(t("files.doc.md.image.menu.saveFailed", { reason: reasonOf(e) }));
  }
}

/** 그림 바이트 → PNG — 이미 PNG 면 그대로, 아니면(SVG · JPEG …) 캔버스에 그려 바꾼다 */
async function pngOf(target: ImageTarget, el: HTMLImageElement | null): Promise<Blob> {
  const blob = await bytesOf(target);
  if (blob.type === "image/png") return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // 크기를 모르는 SVG(`viewBox` 만)는 화면에 그려진 크기 — 벡터는 화면 배율만큼 키워 흐리지 않게
    const svg = blob.type === "image/svg+xml";
    let w = img.naturalWidth || el?.clientWidth || 300;
    let h = img.naturalHeight || el?.clientHeight || 150;
    if (svg) {
      const k = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      w *= k;
      h *= k;
    }
    const fit = Math.min(1, RASTER_MAX / Math.max(w, h));
    w = Math.max(1, Math.round(w * fit));
    h = Math.max(1, Math.round(h * fit));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 동기로 `clipboard.write` 까지 간다 — 누른 손(사용자 활성화)이 살아 있을 때 불려야 해서, 그림 바꾸기는 약속으로 넘긴다 */
function copyImage(target: ImageTarget, el: HTMLImageElement | null): void {
  void writeClipboardImage(pngOf(target, el)).then((ok) =>
    ok ? toast.success(t("files.doc.md.image.menu.copied")) : toast.error(t("files.doc.md.image.menu.copyFailed")),
  );
}
