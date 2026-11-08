// **내부 전용** — 화면 지우기(`clear` · `CSI 2 J` · ConPTY 의 `CSI 3 J`)로 빈 줄에 남은 표시를 걷는다.
// `CSI J` 를 기본 처리 **앞에서** 엿보는 핸들러(`registerEraseHandler`)와 걷기 몸통(`dropErased`).

import type { IDisposable } from "@xterm/xterm";
import { disposeBand } from "./band";
import { prune } from "./records";
import type { SiState } from "./state";

/**
 * 화면 지우기(`clear`)로 **글자가 지워진 줄**에 걸린 표시를 걷는다
 * (docs/log/2026-09-27-clear-highlights.md).
 *
 * 데코는 마커에 걸리고, 마커는 줄이 **지워져도**(빈 칸이 되어도) 살아 있다 — 줄이 버퍼에서
 * 사라질 때(스크롤백 밖으로 밀림 · `ED 3` 의 잘라 내기 · `term.clear()`)만 xterm 이 걷는다.
 * 그래서 `CSI 2 J` 나 ConPTY 의 줄 단위 지우기 뒤에는 색 띠·붉은 줄이 빈 줄에 남는다.
 *
 * `hit(line)` 이 참인 **프롬프트 줄**의 명령을 지워진 것으로 본다. 레코드는 **배열에서 빼지
 * 않고** 프롬프트 마커만 죽인다: 지금 도는 명령(`clear` 자신 · `clear; make`)이면 뒤이은
 * `D` 가 여전히 `current()` 로 그 레코드를 찾아야 한다 — 빼 버리면 그 `D` 가 **직전 명령**에
 * 가서 붙는다. 프롬프트 마커가 죽은 레코드는 이미 모든 소비자(점프·띠·`last`)가 건너뛰고,
 * [`prune`] 이 앞쪽부터 거둔다.
 *
 * 거터 시간 표식은 따로 판정하지 않는다 — `rec.decorations` 에 있어 **명령과 함께** 걷힌다.
 * 블록 이력(발췌)은 건드리지 않는다: 이력은 "무엇을 돌렸나" 의 기록이지 화면의 거울이 아니다
 * (셸 히스토리가 `clear` 로 지워지지 않는 것과 같다). 점프 다리([`blockLines`])만 끊겨, 그
 * 블록은 스크롤백 밖으로 밀린 블록과 같은 대접을 받는다.
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

/** 화면(뷰포트) 안의 줄인가 */
export function inViewport(s: SiState, line: number): boolean {
  const top = s.term.buffer.active.baseY;
  return line >= top && line < top + s.term.rows;
}

/** 글자가 하나도 없는 줄인가 (지워진 줄) */
export function isBlankLine(s: SiState, line: number): boolean {
  return (s.term.buffer.active.getLine(line)?.translateToString(true) ?? "") === "";
}

/**
 * `CSI J`(ED) 를 **기본 처리 앞에서** 엿본다 — `false` 를 돌려주므로 xterm 의 지우기는 그대로
 * 돈다. 이 시점의 버퍼는 아직 지워지기 전이라 줄 번호가 그대로 맞다.
 *
 * - `ED 2` — 화면 전체. 뷰포트의 줄을 지운다 (`scrollOnEraseInDisplay` 가 켜져 있으면 xterm
 *   이 지우는 대신 스크롤백으로 밀어 올리므로 글자가 살아 있다 — 손대지 않는다).
 * - `ED 3` — 스크롤백. 그 줄의 마커는 xterm 이 잘라 내며 스스로 걷지만, 참조를 쥔 쪽이
 *   우리라 여기서 함께 비운다. 그리고 ConPTY 의 화면 지우기를 위해 빈 줄 검사를 걸어 둔다.
 * - `ED 0`·`ED 1` 은 보지 않는다 — TUI·진행 막대가 커서 아래를 지우는 흔한 모양이라, 거기에
 *   반응하면 살아 있는 명령의 띠가 흔들린다. 재발을 보면 그때 넓힌다.
 *
 * **대체 화면(vim·less 등)에서는 무시한다** — 마커는 일반 화면의 줄 번호라, 대체 화면의
 * 지우기와 섞으면 엉뚱한 줄을 걷는다.
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
