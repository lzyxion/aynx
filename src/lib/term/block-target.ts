// 우클릭한 줄 → 명령 블록 · 앵커. 우클릭 그 순간에만 돈다(메뉴가 떠 있는 동안 화면은 계속 흐른다).
// 타일 값은 게터로 받는다 — `shell` 은 `mount()` 가 채우는 `let` 이다.
import type { Terminal } from "@xterm/xterm";
import { blockAtRow, blocksOf, lastFinishedBlock, type BlockLine, type CommandBlock } from "$lib/block-history";
import type { ShellIntegration } from "$lib/shell-integration";
import type { SnippetSource } from "$lib/pane/pane-menu";
import type { AskAnchor, AskBlockRef } from "$lib/ask-ai";

export interface BlockTargetHost {
  readonly paneId: string;
  readonly shell: ShellIntegration | null;
}

export function createBlockTarget(h: BlockTargetHost) {
  /** DOM 행(`.xterm-rows > div`)을 세지 않는다 — WebGL 렌더러(기본)에는 그 행이 없다. 기하로 잰다. */
  function rowAtClientY(t: Terminal, clientY: number): number | null {
    const screen = t.element?.querySelector(".xterm-screen");
    if (!screen || t.rows <= 0) return null;
    const box = screen.getBoundingClientRect();
    if (box.height <= 0) return null;
    const i = Math.floor(((clientY - box.top) / box.height) * t.rows);
    if (i < 0 || i >= t.rows) return null;
    return t.buffer.active.viewportY + i;
  }

  /** tmux 타일은 블록이 없어 `null` — 메뉴의 `screenOnly` 막기와 같은 답을 내야 줄이 유령처럼 뜨지 않는다. */
  function snippetSourceAt(t: Terminal, clientY: number): SnippetSource | null {
    const found = finishedBlockAt(t, clientY);
    return found === null ? null : { command: found.block.commandLine.trim(), fromRow: found.fromRow };
  }

  /** 스니펫 저장과 "AI 에게 묻기" 가 같은 답을 쓴다 — 같은 줄은 같은 블록이어야 한다. */
  function finishedBlockAt(t: Terminal, clientY: number): { block: CommandBlock; fromRow: boolean } | null {
    const blocks = blocksOf(h.paneId);
    const row = rowAtClientY(t, clientY);
    if (row !== null && h.shell && blocks.length > 0) {
      const lines: BlockLine[] = [];
      for (const b of blocks) {
        const line = h.shell.lineOfBlock(b.id);
        if (line !== null) lines.push({ id: b.id, line });
      }
      const id = blockAtRow(row, lines);
      const hit = id === null ? undefined : blocks.find((b) => b.id === id);
      if (hit && !hit.running && hit.commandLine.trim() !== "") return { block: hit, fromRow: true };
    }
    const last = lastFinishedBlock(h.paneId);
    return last === null ? null : { block: last, fromRow: false };
  }

  function askRefAt(t: Terminal, clientY: number): AskBlockRef | null {
    const found = finishedBlockAt(t, clientY);
    return found === null ? null : { blockId: found.block.id, fromRow: found.fromRow };
  }

  function blockAnchorOf(t: Terminal, blockId: number): AskAnchor | null {
    const screen = t.element?.querySelector(".xterm-screen");
    if (!screen || t.rows <= 0) return null;
    const box = screen.getBoundingClientRect();
    if (box.height <= 0) return null;
    const rowH = box.height / t.rows;
    const buf = t.buffer.active;
    const line = h.shell?.lineOfBlock(blockId) ?? null;
    let row = line === null ? -1 : line - buf.viewportY;
    if (row < 0 || row >= t.rows) row = Math.min(t.rows - 1, Math.max(0, buf.baseY + buf.cursorY - buf.viewportY));
    return { x: box.left + 16, y: box.top + (row + 1) * rowH + 4, align: "left" };
  }

  return { snippetSourceAt, askRefAt, blockAnchorOf };
}
