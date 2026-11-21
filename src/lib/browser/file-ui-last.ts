/**
 * 새 파일 타일이 물려받는 마지막 보기 (docs/log/2026-11-04-file-ui-keep.md).
 * 새로 여는 길에만 얹는다 — 복원 · 이관 · 복제는 그 타일이 든 값 그대로다(그래서 `newLocalFsPane` 에 넣지 않는다).
 */
import {
  clampFileZoom,
  DEFAULT_FILE_ZOOM,
  migrateFileView,
  type FileUiPatch,
  type FileView,
  type PaneSpec,
} from "$lib/session/spec";

export interface LastFileUi {
  view?: FileView;
  hidden?: true;
  preview?: true;
  places?: false;
  zoom?: number;
}

export function parseLastFileUi(raw: string | null): LastFileUi {
  if (raw === null) return {};
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return {};
  const r = o as Record<string, unknown>;
  const out: LastFileUi = {};
  const view = migrateFileView(r.view);
  if (view) out.view = view;
  if (r.hidden === true) out.hidden = true;
  if (r.preview === true) out.preview = true;
  if (r.places === false) out.places = false;
  const zoom = clampFileZoom(r.zoom);
  if (zoom !== null && zoom !== DEFAULT_FILE_ZOOM) out.zoom = zoom;
  return out;
}

/** 비었으면 `null` — 지운다 */
export function serializeLastFileUi(last: LastFileUi): string | null {
  return Object.keys(last).length === 0 ? null : JSON.stringify(last);
}

/** `noteFileUi` 와 같은 규칙 — 기본값이면 칸을 지운다 */
export function mergeLastFileUi(last: LastFileUi, patch: FileUiPatch): LastFileUi {
  const out = { ...last };
  if (patch.zoom !== undefined) {
    if (patch.zoom === DEFAULT_FILE_ZOOM) delete out.zoom;
    else out.zoom = patch.zoom;
  }
  if (patch.places !== undefined) {
    if (patch.places) delete out.places;
    else out.places = false;
  }
  if (patch.preview !== undefined) {
    if (patch.preview) out.preview = true;
    else delete out.preview;
  }
  if (patch.hidden !== undefined) {
    if (patch.hidden) out.hidden = true;
    else delete out.hidden;
  }
  return out;
}

export function applyLastFileUi(pane: PaneSpec, last: LastFileUi): PaneSpec {
  if (pane.kind !== "localfs" && pane.kind !== "sftp") return pane;
  if (last.view) pane.fileView = last.view;
  if (last.hidden) pane.fileHidden = true;
  if (last.preview) pane.filePreview = true;
  if (last.places === false) pane.filePlaces = false;
  if (last.zoom !== undefined) pane.fileZoom = last.zoom;
  return pane;
}
