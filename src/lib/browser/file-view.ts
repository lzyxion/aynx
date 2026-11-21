// 파일 타일의 보기 셋이 나눠 쓰는 순수 규칙 (docs/log/2026-10-07-file-tile-dolphin.md).
import { FILE_ZOOM_MAX } from "$lib/session/spec";
import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";

/** 단계 `1` = 배율 1 — 바탕 크기는 `theme.css` 의 `--tile-icon-cell` · `--tile-icon-size` */
export const ICON_ZOOM_SCALES: readonly number[] = [0.8, 1, 1.2, 1.45, 1.75];

export function iconZoomScale(level: number): number {
  const at = Math.min(FILE_ZOOM_MAX, Math.max(0, Math.round(level)));
  return ICON_ZOOM_SCALES[at] ?? 1;
}

export function stepIconZoom(level: number, delta: number): number {
  return Math.min(FILE_ZOOM_MAX, Math.max(0, Math.round(level) + Math.sign(delta)));
}

export function extBadge(name: string): string | null {
  const at = name.lastIndexOf(".");
  if (at <= 0 || at === name.length - 1) return null;
  const ext = name.slice(at + 1);
  return ext.length <= 5 ? ext.toUpperCase() : null;
}

/** 아이콘은 왼쪽→오른쪽 다음 줄(`row`), 간단히는 위→아래 다음 열(`column`) */
export type GridFlow = "row" | "column";

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** 감싸지 않는다 — 수천 칸 목록에서 끝에서 처음으로 튀면 위치 감각이 끊긴다 */
export function gridStep(count: number, index: number, key: ArrowKey, flow: GridFlow, span: number): number {
  if (count <= 0) return -1;
  const forward = key === "ArrowRight" || key === "ArrowDown";
  if (index < 0 || index >= count) return forward ? 0 : count - 1;
  const along = flow === "row" ? key === "ArrowLeft" || key === "ArrowRight" : key === "ArrowUp" || key === "ArrowDown";
  if (along) return Math.min(count - 1, Math.max(0, index + (forward ? 1 : -1)));
  const s = Math.max(1, Math.floor(span));
  const target = index + (forward ? s : -s);
  if (target < 0) return index;
  if (target < count) return target;
  return Math.floor((count - 1) / s) > Math.floor(index / s) ? count - 1 : index;
}

/** 뿌리 한 층만 센다 */
export interface FolderSummary {
  folders: number;
  files: number;
  /** 폴더 크기는 모른다 — 더하지 않는다 */
  bytes: number;
  /** 숨김 토글이 꺼져서 안 보이는 항목 수 */
  hidden: number;
}

export function folderSummary(entries: readonly SftpEntry[], showHidden: boolean): FolderSummary {
  const out: FolderSummary = { folders: 0, files: 0, bytes: 0, hidden: 0 };
  for (const e of entries) {
    if (!showHidden && isHidden(e)) {
      out.hidden += 1;
      continue;
    }
    if (isDirLike(e)) out.folders += 1;
    else {
      out.files += 1;
      out.bytes += Number.isFinite(e.size) && e.size > 0 ? e.size : 0;
    }
  }
  return out;
}

export interface SelectionSummary {
  count: number;
  bytes: number;
  single: SftpEntry | null;
}

export function selectionSummary(selected: readonly SftpEntry[]): SelectionSummary {
  let bytes = 0;
  for (const e of selected) if (!isDirLike(e) && Number.isFinite(e.size) && e.size > 0) bytes += e.size;
  return { count: selected.length, bytes, single: selected.length === 1 ? selected[0] : null };
}

/** 장소 패널의 막대와 같은 선 */
export const LOW_SPACE_RATIO = 0.1;

export function usedRatio(space: { free: number; total: number }): number {
  return space.total > 0 ? Math.min(1, Math.max(0, 1 - space.free / space.total)) : 0;
}

/** 이 모듈은 사전을 들이지 않으므로 번역 함수와 크기 글자 함수를 받는다 */
export function folderSummaryText(
  sum: FolderSummary,
  tr: (key: "files.status.folders" | "files.status.files" | "files.status.hidden" | "files.status.empty", params?: Record<string, string | number>) => string,
  size: (bytes: number) => string,
): string {
  const parts: string[] = [];
  if (sum.folders > 0) parts.push(tr("files.status.folders", { count: sum.folders }));
  if (sum.files > 0) parts.push(tr("files.status.files", { count: sum.files, size: size(sum.bytes) }));
  let text = parts.length > 0 ? parts.join(", ") : tr("files.status.empty");
  if (sum.hidden > 0) text += ` · ${tr("files.status.hidden", { count: sum.hidden })}`;
  return text;
}
