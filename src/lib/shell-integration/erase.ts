// **내부 전용** — 화면 지우기(`clear` · `CSI 2 J` · ConPTY 의 `CSI 3 J`)로 빈 줄에 남은 표시를 걷는다 (docs/log/2026-09-27-clear-highlights.md).
// 마커는 줄이 지워져 빈 칸이 되어도 살아 있어, 그냥 두면 색 띠 · 붉은 줄이 빈 줄에 남는다.

import type { IDisposable } from "@xterm/xterm";
import { disposeBand } from "./band";
import { prune } from "./records";
import type { SiState } from "./state";

/**
 * 레코드는 배열에서 빼지 않고 프롬프트 마커만 죽인다 — 지금 도는 명령(`clear; make`)의 뒤이은 `D` 가 `current()` 로 그 레코드를 찾아야 한다.
 * 빼 버리면 그 `D` 가 직전 명령에 가서 붙는다. 블록 이력(발췌)은 건드리지 않는다 — 이력은 화면의 거울이 아니다.
 */
export function dropErased(s: SiState, hit: (line: number) => boolean) {
  for (const rec of s.records) {
    const m = rec.promptMarker;
    if (m.isDisposed || !hit(m.line)) continue;
    for (const d of rec.decorations) d.dispose();
    rec.decorations.length = 0;
    m.dispose();
    rec.bMarker?.dispose();
  }
  for (const [id, m] of s.blockLines) {
    if (m.isDisposed || hit(m.line)) {
      // 레코드와 같은 마커면 위에서 이미 죽었다. 이관으로 되심은 것은 우리 것이라 여기서 죽인다.
      if (!m.isDisposed) m.dispose();
      s.blockLines.delete(id);
    }
  }
  for (let i = s.restored.length - 1; i >= 0; i--) {
    const d = s.restored[i];
    if (d.marker.isDisposed || hit(d.marker.line)) {
      d.dispose();
      s.restored.splice(i, 1);
    }
  }
  if (s.band && (s.band.marker.isDisposed || hit(s.band.marker.line))) disposeBand(s);
  s.jumpCursor = null;
  prune(s);
}

export function inViewport(s: SiState, line: number): boolean {
  const top = s.term.buffer.active.baseY;
  return line >= top && line < top + s.term.rows;
}

export function isBlankLine(s: SiState, line: number): boolean {
  return (s.term.buffer.active.getLine(line)?.translateToString(true) ?? "") === "";
}

/**
 * 기본 처리 앞에서 엿본다(`false` → xterm 의 지우기는 그대로) — 이 시점의 버퍼는 지워지기 전이라 줄 번호가 맞다.
 * `scrollOnEraseInDisplay` 면 `ED 2` 가 스크롤백으로 밀어 올려 글자가 살아 있다 — 손대지 않는다.
 * `ED 0` · `ED 1` 은 보지 않는다 — TUI · 진행 막대의 흔한 모양이라 살아 있는 띠가 흔들린다. 재발을 보면 그때 넓힌다.
 * 대체 화면에서는 무시한다 — 마커는 일반 화면의 줄 번호다.
 */
export function registerEraseHandler(s: SiState): IDisposable {
  return s.term.parser.registerCsiHandler({ final: "J" }, (params) => {
    if (s.term.buffer.active.type !== "normal") return false;
    const mode = params[0];
    if (mode === 2 && !s.term.options.scrollOnEraseInDisplay) {
      dropErased(s, (line) => inViewport(s, line));
    } else if (mode === 3) {
      const top = s.term.buffer.active.baseY;
      dropErased(s, (line) => line < top);
      s.eraseCheckPending = true;
    }
    return false;
  });
}
