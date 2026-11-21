// 터미널 하나에 셸 통합을 거는 곳 — 거는 순서(`CSI J` 엿보기 → OSC 133 → 7 → 9)와 `dispose` 의 정리 순서가 곧 동작이다.

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

/** `onstatus` 는 상태가 바뀔 때만 부른다 — 매 시퀀스마다 올리면 대량 출력 중 프레임마다 재렌더가 돈다. */
export function attachShellIntegration(
  term: Terminal,
  onstatus: (status: PaneStatus | null) => void,
  sink?: BlockSink,
): ShellIntegration {
  const s = createState(term, onstatus, sink);

  // `CSI J` 는 기본 처리 앞에서 엿보고 `false` 를 준다.
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

    /** 줄은 마커에게 묻고 열만 `B` 시점의 값을 쓴다 — 마커는 스크롤해도 자기 줄을 따라간다. */
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
