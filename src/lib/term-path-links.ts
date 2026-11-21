import type { IDisposable, Terminal as XTerm } from "@xterm/xterm";
import { cellColumns } from "$lib/triggers";
import { findPathLinks, resolvePathLink, type PathLinkPlace, type ResolvedPath } from "$lib/path-links";

/**
 * 트리거 링크 · URL 자동 링크 · OSC 8 과 같이 Ctrl(맥은 ⌘)+클릭에서만 연다 — 맨 클릭은 선택 · 포커스다.
 * 등록 순서가 곧 우선순위다(xterm `Linkifier`) — `Terminal.svelte` 가 트리거 · web-links 뒤에 건다.
 * 우클릭 메뉴의 "링크 열기"(`hoveredLink`)에는 적지 않는다 — 그쪽은 브라우저로 여는 주소의 자리다.
 */
export function attachPathLinks(
  term: XTerm,
  place: () => PathLinkPlace | null,
  open: (target: NonNullable<ResolvedPath>, line?: number) => void,
): IDisposable {
  return term.registerLinkProvider({
    provideLinks(bufferLine, callback) {
      const where = place();
      const line = where ? term.buffer.active.getLine(bufferLine - 1) : undefined;
      if (!where || !line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(false);
      const found = findPathLinks(text);
      if (found.length === 0) {
        callback(undefined);
        return;
      }
      const columns = cellColumns(line);
      const links = [];
      for (const m of found) {
        const target = resolvePathLink(m, where);
        if (target === null) continue;
        const x = columns[m.start];
        const endX = columns[m.end];
        if (x === undefined || endX === undefined || endX <= x) continue;
        links.push({
          // 1부터 · `end.x` 포함 — 트리거 프로바이더와 같은 옮김(`columns[end]` 는 0부터의 열린 끝)
          range: { start: { x: x + 1, y: bufferLine }, end: { x: endX, y: bufferLine } },
          text: text.slice(m.start, m.end),
          decorations: { pointerCursor: true, underline: true },
          activate(ev: MouseEvent) {
            if (!ev.ctrlKey && !ev.metaKey) return;
            open(target, m.line);
          },
        });
      }
      callback(links.length > 0 ? links : undefined);
    },
  });
}
