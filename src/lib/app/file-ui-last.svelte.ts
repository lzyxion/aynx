import {
  applyLastFileUi,
  mergeLastFileUi,
  parseLastFileUi,
  serializeLastFileUi,
  type LastFileUi,
} from "$lib/browser/file-ui-last";
import type { FileUiPatch, FileView, PaneSpec } from "$lib/session/spec";

/**
 * **새 파일 타일이 물려받는 마지막 보기**(2026-11-04 · docs/log/2026-11-04-file-ui-keep.md) — 규칙은 `$lib/browser/file-ui-last`.
 *
 * 이 브라우저 · 이 앱의 `localStorage` 에만 산다(기기별 편의 — `settings.toml` 에 쓰지 않는다 · 막히면 조용히 예전처럼). 창이 여럿이어도 읽을 때마다 저장소에서 읽어 한 벌이다.
 * 적는 것은 사람의 변경뿐이다(`app/panes` 의 `noteFileView` · `noteFileUi` — 부르는 곳은 타일의 툴바 · 키 · 슬라이더 하나). 설정에서 기본 보기를 고르면 보기 칸만 지운다.
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

/** 설정에서 기본 보기를 골랐다 — 다음 새 타일은 그 값을 따른다(나머지 칸은 그대로) */
export function forgetLastFileView(): void {
  const last = read();
  delete last.view;
  write(last);
}

/** 새로 여는 파일 타일이 지나는 문 — 복원 · 이관 · 복제는 지나지 않는다 */
export function withLastFileUi(pane: PaneSpec): PaneSpec {
  return applyLastFileUi(pane, read());
}
