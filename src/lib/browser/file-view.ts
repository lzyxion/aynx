// 파일 타일의 보기 셋(아이콘 · 간단히 · 자세히)이 나눠 쓰는 **순수 규칙** — 아이콘 크기 단계의 배율 · 확장자 배지 ·
// 격자 보기의 2차원 화살표 이동 · 상태 줄의 요약 (docs/log/2026-10-07-file-tile-dolphin.md). 룬도 DOM 도 없다 — 격자가 한 줄에 몇 칸인지는
// 부르는 쪽(`file-keys.ts`)이 화면에서 재어 넘긴다.
import { FILE_ZOOM_MAX } from "$lib/session/spec";
import { isDirLike, isHidden, type SftpEntry } from "$lib/sftp-browser";

/**
 * 아이콘 보기의 크기 단계(`0`…`FILE_ZOOM_MAX`) → **배율**. 칸 폭·글리프 크기의 바탕은 `theme.css` 의
 * `--tile-icon-cell` · `--tile-icon-size` 이고(단계 `1` = 배율 1), 화면은 이 배율을 `--icon-scale` 로 곱한다.
 */
export const ICON_ZOOM_SCALES: readonly number[] = [0.8, 1, 1.2, 1.45, 1.75];

/** 단계 → 배율 (범위 밖은 끝으로 자른다) */
export function iconZoomScale(level: number): number {
  const at = Math.min(FILE_ZOOM_MAX, Math.max(0, Math.round(level)));
  return ICON_ZOOM_SCALES[at] ?? 1;
}

/** 단계 하나 위·아래로 (`Ctrl+휠`) — 끝에서는 멈춘다 */
export function stepIconZoom(level: number, delta: number): number {
  return Math.min(FILE_ZOOM_MAX, Math.max(0, Math.round(level) + Math.sign(delta)));
}

/**
 * 아이콘 보기의 **확장자 배지** — `report.pdf` → `PDF`. 없으면 `null`.
 *
 * 점으로 시작하는 이름(`.gitignore`)은 확장자가 아니라 이름 자체라 배지가 없다. 너무 긴 꼬리(`.backup-2026`)는
 * 배지 칸을 넘치므로 다섯 글자까지만 배지로 친다.
 */
export function extBadge(name: string): string | null {
  const at = name.lastIndexOf(".");
  if (at <= 0 || at === name.length - 1) return null;
  const ext = name.slice(at + 1);
  return ext.length <= 5 ? ext.toUpperCase() : null;
}

/** 격자가 흐르는 방향 — 아이콘은 왼쪽→오른쪽 다음 줄(`row`), 간단히는 위→아래 다음 열(`column`) */
export type GridFlow = "row" | "column";

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/**
 * **격자 보기의 화살표 한 번** — 다음 칸의 번호(보이는 순서). 커서가 없으면(`index < 0`) 진행 방향의 첫 칸
 * (→·↓ 면 맨 앞, ←·↑ 면 맨 뒤)이다.
 *
 * - 흐름 방향의 화살표(아이콘의 ←→ · 간단히의 ↑↓)는 **한 칸** — 줄 끝에서 다음 줄로 이어진다(탐색기·Dolphin).
 * - 가로지르는 화살표(아이콘의 ↑↓ · 간단히의 ←→)는 **한 줄**(`span` 칸)을 건너뛴다. 그쪽에 칸이 없으면 제자리이되,
 *   마지막 줄이 짧아 바로 그 자리가 비었으면 **마지막 칸**으로 간다(맨 아래 줄로 내려가는 손이 멈추지 않게).
 *
 * 감싸지 않는다 — 파일 목록은 수천 칸이 흔하고 끝에서 처음으로 튀면 위치 감각이 끊긴다(자세히 보기와 같은 규칙).
 */
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
  // 건너뛸 자리가 비었다 — 마지막 칸이 다음 줄에 있으면 거기로, 같은 줄이면 제자리
  return Math.floor((count - 1) / s) > Math.floor(index / s) ? count - 1 : index;
}

/** 상태 줄의 **지금 폴더** 요약 — 뿌리 한 층만 센다(펼친 하위는 세지 않는다 — 그것은 "이 폴더" 가 아니다) */
export interface FolderSummary {
  folders: number;
  files: number;
  /** 보이는 파일의 크기 합 (폴더 크기는 모른다 — 더하지 않는다) */
  bytes: number;
  /** 숨김 파일 토글이 꺼져서 **안 보이는** 항목 수 (켜져 있으면 0) */
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

/** 상태 줄의 **선택** 요약 — 하나면 그 항목 자체를, 여럿이면 개수와 파일 크기 합 */
export interface SelectionSummary {
  count: number;
  bytes: number;
  /** 하나만 골랐을 때 그 항목 (이름 · 크기 · 날짜를 적는다) */
  single: SftpEntry | null;
}

export function selectionSummary(selected: readonly SftpEntry[]): SelectionSummary {
  let bytes = 0;
  for (const e of selected) if (!isDirLike(e) && Number.isFinite(e.size) && e.size > 0) bytes += e.size;
  return { count: selected.length, bytes, single: selected.length === 1 ? selected[0] : null };
}

/** 남은 공간이 이 몫 아래면 경고 색 — 장소 패널의 막대와 같은 선 */
export const LOW_SPACE_RATIO = 0.1;

/** 쓴 몫 (0…1) — 막대의 채운 길이 */
export function usedRatio(space: { free: number; total: number }): number {
  return space.total > 0 ? Math.min(1, Math.max(0, 1 - space.free / space.total)) : 0;
}

/**
 * 지금 폴더 요약 **한 줄** — "폴더 3개, 파일 12개 (4.1 MB) · 숨김 2개" / "비어 있음". 상태 줄과 미리 보기 패널이 같은
 * 글을 쓴다. 이 모듈은 사전을 들이지 않으므로 번역 함수와 크기 글자 함수를 받는다.
 */
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
