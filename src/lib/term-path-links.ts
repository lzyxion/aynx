import type { IDisposable, Terminal as XTerm } from "@xterm/xterm";
import { cellColumns } from "$lib/triggers";
import { findPathLinks, resolvePathLink, type PathLinkPlace, type ResolvedPath } from "$lib/path-links";

/**
 * **터미널의 파일 경로를 Ctrl+클릭으로 문서 보기에** — xterm 링크 프로바이더 하나
 * (docs/log/2026-09-27-doc-tile.md "A — 여는 길"). 글자 판정은 순수 층 `path-links.ts`, 여기는 xterm 에 거는 일뿐이다.
 *
 * 규칙은 트리거 링크 · URL 자동 링크 · OSC 8 과 **같다**: 맨 클릭은 아무것도 하지 않고(터미널에서 맨 클릭은 선택 ·
 * 포커스다) **Ctrl(맥은 ⌘)+클릭**에서만 연다. 한 화면에 여러 종류의 링크가 섞이는데 사람은 그것을 구별할 수 없다.
 *
 * **등록 순서가 곧 우선순위다**(xterm 은 먼저 등록된 프로바이더의 링크를 쓴다 — `Linkifier`). `Terminal.svelte` 는
 * 이것을 트리거 · web-links **뒤에** 건다: 사용자의 규칙과 URL 이 경로를 이긴다. `findPathLinks` 도 URL 과 겹치는
 * 토막을 미리 빼므로 순서에만 기대지 않는다.
 *
 * `place()` 는 호버마다 부른다 — 셸이 `cd` 하면 다음 호버부터 새 폴더가 기준이다. `null` 이면 링크를 걸지 않는다.
 * 우클릭 메뉴의 "링크 열기"(`hoveredLink`)에는 적지 않는다 — 그쪽은 브라우저로 여는 주소의 자리다.
 *
 * 꼬리 `:12` 가 있으면 그 줄(1 기준)을 `open` 의 둘째 인자로 같이 올린다 — 여는 쪽이 문서 타일에 한 번짜리 "이 줄로" 를
 * 건다(`app/doc-anchors`). 꼬리가 없으면 `undefined` 이고 동작은 예전 그대로다.
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
