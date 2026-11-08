// 터미널 타일의 **우클릭한 줄 → 명령 블록 · 앵커** — `Terminal.svelte` 에서 뗀 어댑터(2026-10-26 분할 3차).
// 화면 좌표 → 버퍼 줄 → 블록(스니펫 저장 · "AI 에게 묻기" 대상) · 블록 줄 아래 화면 좌표. DOM(`.xterm-screen`) · xterm 버퍼를 읽으므로
// 순수 함수가 아니다(순수 규칙은 `$lib/block-history` 의 `blockAtRow`). 타일의 값(`pane.id` · 셸 통합)은 게터로 받는다 —
// `shell` 은 `mount()` 가 채우는 `let` 이다. 부르는 자리는 `Terminal` 의 우클릭(`onmenu`) · 터미널 창구(`blockAnchor`).
//
// 우클릭한 줄 → 명령 블록 (docs/log/2026-09-16-snippets.md)
//
// 우클릭 메뉴의 "스니펫으로 저장" 은 **가리킨 줄의 명령**을 대상으로 삼는다. 그 다리가
// 여기 둘이고, 둘 다 우클릭 **그 순간**에만 돈다 (메뉴가 떠 있는 동안 화면은 계속 흐른다).
//
// 재료는 `Terminal` 에 모여 있어 게터로 받는다: 화면 기하(어느
// 줄을 눌렀나)는 xterm 인스턴스가, 블록 → 줄 다리는 `shell.lineOfBlock` 이, 블록 자체는
// 이력 저장소가 쥔다. 규칙만큼은 순수 층에 있다 (`blockAtRow` — 테스트가 그것을 본다).
import type { Terminal } from "@xterm/xterm";
import { blockAtRow, blocksOf, lastFinishedBlock, type BlockLine, type CommandBlock } from "$lib/block-history";
import type { ShellIntegration } from "$lib/shell-integration";
import type { SnippetSource } from "$lib/pane/pane-menu";
import type { AskAnchor, AskBlockRef } from "$lib/ask-ai";

/** 타일에서 읽는 것 — 게터라 그때그때의 값이다 */
export interface BlockTargetHost {
  /** 이 타일의 패널 id — 블록 이력의 열쇠 */
  readonly paneId: string;
  /** 이 타일의 셸 통합(블록 → 프롬프트 줄 다리) — 아직 없으면 `null` */
  readonly shell: ShellIntegration | null;
}

export function createBlockTarget(h: BlockTargetHost) {
  /**
   * 화면 세로 좌표 → **버퍼의 절대 줄 번호** (밖이면 `null`).
   *
   * xterm 은 "이 픽셀이 몇 번째 줄인가" 를 공개 API 로 알려 주지 않는다. DOM 행
   * (`.xterm-rows > div`)을 세는 길도 있지만 **WebGL 렌더러에서는 그 행들이 없다** — 이 앱은
   * 기본이 WebGL 이다. 남는 것은 기하다: `.xterm-screen` 의 높이를 `rows` 로 나눈 것이 한
   * 줄의 높이이고, 거기에 스크롤 위치(`viewportY`)를 더하면 절대 줄이 된다.
   */
  function rowAtClientY(t: Terminal, clientY: number): number | null {
    const screen = t.element?.querySelector(".xterm-screen");
    if (!screen || t.rows <= 0) return null;
    const box = screen.getBoundingClientRect();
    if (box.height <= 0) return null;
    const i = Math.floor(((clientY - box.top) / box.height) * t.rows);
    if (i < 0 || i >= t.rows) return null;
    return t.buffer.active.viewportY + i;
  }

  /**
   * 우클릭한 자리에서 **스니펫으로 남길 만한 명령** — 없으면 `null`.
   *
   * 두 갈래다.
   *
   * 1. **그 줄의 블록.** 살아 있는 마커로 각 블록의 프롬프트 줄을 얻어(`lineOfBlock`) 순수
   *    규칙에 넘긴다(`blockAtRow`). 아직 도는 명령이거나 명령문이 비었으면 답이 아니다.
   * 2. **이 타일의 마지막 끝난 명령.** 커서 밑에 블록이 없을 때(스크롤백 위쪽·마커가 밀려난
   *    자리·셸 통합이 막 붙은 세션) 물러서는 자리다. 라벨이 달라지므로 `fromRow` 로 알린다.
   *
   * 화면만 있는 세션(tmux 타일)은 블록이 아예 생기지 않아 자연히 `null` 이다 (메뉴 쪽에서도
   * `screenOnly` 로 한 번 더 막는다 — 두 곳이 같은 답을 내야 줄이 유령처럼 뜨지 않는다).
   */
  function snippetSourceAt(t: Terminal, clientY: number): SnippetSource | null {
    const found = finishedBlockAt(t, clientY);
    return found === null ? null : { command: found.block.commandLine.trim(), fromRow: found.fromRow };
  }

  /**
   * 우클릭한 줄의 **끝난 블록** — 없으면 이 타일의 마지막 끝난 블록(`fromRow: false`), 그것도 없으면 `null`.
   * 스니펫 저장과 "이 블록을 AI 에게 묻기…" 가 같은 답을 쓴다(위 두 갈래 — 같은 줄은 같은 블록이어야 한다).
   */
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

  /** 우클릭한 줄의 "AI 에게 묻기" 대상 — [`finishedBlockAt`] 과 같은 답을 손잡이로 */
  function askRefAt(t: Terminal, clientY: number): AskBlockRef | null {
    const found = finishedBlockAt(t, clientY);
    return found === null ? null : { blockId: found.block.id, fromRow: found.fromRow };
  }

  /**
   * 그 블록의 프롬프트 줄 **바로 아래**의 화면 좌표 — 단축키로 연 고르기 상자가 설 자리
   * (docs/log/2026-09-28-ask-ai-block.md). 줄이 화면 밖(스크롤백 위 · 마커가 밀려났다)이면 커서 줄 아래다.
   */
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
