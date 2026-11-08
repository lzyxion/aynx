// 터미널 하나에 셸 통합을 **거는 곳** — 상태를 만들고, 핸들러를 순서대로 걸고, 창구(`ShellIntegration`)를 조립한다.
// 거는 순서(`CSI J` 엿보기 → OSC 133 → 7 → 9)와 `dispose` 의 정리 순서는 나누기 전과 같다 — 몸통은 형제 파일들에 있다.

import type { Terminal } from "@xterm/xterm";
import { bandBlock, disposeBand } from "./band";
import { lineOfBlock, markerDistances, restoreMarkers } from "./block-lines";
import { registerOsc7, registerOsc9 } from "./cwd-handlers";
import { registerEraseHandler } from "./erase";
import { jump } from "./jump";
import { registerOsc133 } from "./osc133";
import { blockOutput, canCopyOutput, copyOutput, last, tail } from "./record-text";
import { current } from "./records";
import { createState } from "./state";
import type { BlockSink, PaneStatus, ShellIntegration } from "./types";

/**
 * 터미널 하나에 OSC 133 핸들러를 건다.
 *
 * `onstatus` 는 상태가 **바뀔 때만** 부른다 — 대량 출력 중에 매 시퀀스마다 상위 `$state`
 * 를 건드리면 프레임마다 재렌더가 돈다 (활동 점이 500ms 스로틀을 두는 것과 같은 이유).
 * OSC 133 은 명령당 네 번뿐이라 스로틀 없이도 충분하지만, 그래도 같은 값을 두 번
 * 올리지는 않는다.
 */
export function attachShellIntegration(
  term: Terminal,
  onstatus: (status: PaneStatus | null) => void,
  sink?: BlockSink,
): ShellIntegration {
  const s = createState(term, onstatus, sink);

  // 거는 순서가 곧 동작이다 — 나누기 전과 같다 (`CSI J` 는 기본 처리 앞에서 엿보고 `false` 를 준다).
  const ed = registerEraseHandler(s);
  const osc = registerOsc133(s);
  const osc7 = registerOsc7(s);
  const osc9 = registerOsc9(s);

  const api: ShellIntegration = {
    status: () => s.status,
    cwd: () => s.cwd,
    tail: (lines) => tail(s, lines),
    last: () => last(s),
    jump: (dir) => jump(s, dir),
    lineOfBlock: (blockId) => lineOfBlock(s, blockId),
    bandBlock: (blockId) => bandBlock(s, blockId),
    clearBand: () => disposeBand(s),
    markerDistances: () => markerDistances(s),
    restoreMarkers: (entries) => restoreMarkers(s, entries),
    blockOutput: (blockId) => blockOutput(s, blockId),
    copyOutput: () => copyOutput(s),
    canCopyOutput: () => canCopyOutput(s),

    /**
     * 줄은 **마커에게 묻고** 열만 `B` 시점의 값을 쓴다 (머리말). 마커가 스크롤백 밖으로
     * 밀려 죽었으면 앵커도 없다 — 그 자리는 이미 화면에 없으므로 제안이 가리킬 칸도 없다.
     */
    inputAnchor() {
      if (!s.inputMode) return null;
      const rec = current(s);
      const b = rec?.bMarker;
      if (!b || b.isDisposed) return null;
      return { line: b.line, col: rec?.bCol ?? 0 };
    },

    resetSource() {
      s.sourceTag = null;
      s.inputMode = false;
    },

    diagnostics: () => ({ source: s.sourceTag, ...s.diag }),

    dispose() {
      s.sourceTag = null;
      s.inputMode = false;
      osc.dispose();
      osc7.dispose();
      osc9.dispose();
      ed.dispose();
      s.eraseCheckPending = false;
      for (const rec of s.records) {
        for (const d of rec.decorations) d.dispose();
      }
      for (const d of s.restored) d.dispose();
      s.restored.length = 0;
      disposeBand(s);
      s.records.length = 0;
      s.blockLines.clear();
      // 마커는 터미널 dispose 가 함께 정리한다 (개별 dispose 는 불필요한 재렌더만 부른다).
    },
  };

  return api;
}
