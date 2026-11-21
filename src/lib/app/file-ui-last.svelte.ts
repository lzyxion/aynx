import {
  applyLastFileUi,
  mergeLastFileUi,
  parseLastFileUi,
  serializeLastFileUi,
  type LastFileUi,
} from "$lib/browser/file-ui-last";
import type { FileUiPatch, FileView, PaneSpec } from "$lib/session/spec";

/**
 * 새 파일 타일이 물려받는 마지막 보기 — 기기별 편의라 `localStorage` 에만 산다(`settings.toml` 에 쓰지 않는다) (docs/log/2026-11-04-file-ui-keep.md).
 * 적는 것은 사람의 변경뿐이다.
 */
const KEY = "aynx.files.lastUi";

function read(): LastFileUi {
  try {
    return parseLastFileUi(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

function write(last: LastFileUi): void {
  try {
    const text = serializeLastFileUi(last);
    if (text === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, text);
  } catch {
    /* 막힌 저장소 — 새 타일이 기본으로 설 뿐이다 */
  }
}

export function rememberFileView(view: FileView): void {
  write({ ...read(), view });
}

export function rememberFileUi(patch: FileUiPatch): void {
  write(mergeLastFileUi(read(), patch));
}

export function forgetLastFileView(): void {
  const last = read();
  delete last.view;
  write(last);
}

/** 새로 여는 파일 타일만 지난다 — 복원 · 이관 · 복제는 지나지 않는다 */
export function withLastFileUi(pane: PaneSpec): PaneSpec {
  return applyLastFileUi(pane, read());
}
