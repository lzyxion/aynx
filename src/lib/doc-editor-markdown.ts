import type { StreamParser, StringStream } from "@codemirror/language";

/**
 * **편집기의 마크다운 모드** — 작은 StreamParser (문서 편집 E1).
 *
 * `@codemirror/legacy-modes` 에는 마크다운이 없고, `@codemirror/lang-markdown` 은 lezer 파서 한 벌을 더 들인다.
 * 편집기에서 마크다운에 바라는 것은 "제목 · 목록 · 인용 · 코드 울타리 · 강조 · 링크 · 인라인 코드가 눈에 띈다"
 * 정도라 줄 단위 토큰기 하나로 충분하다(잘못 칠해도 글은 그대로다 — 칠은 꾸밈이다). 반환하는 이름은 lezer
 * `tags` 의 이름이라 편집기의 강조 표(`doc-editor-cm.ts`)가 그대로 받는다.
 */

interface MdState {
  /** 코드 울타리 안 — 여는 울타리 글자(``` 또는 ~~~, 길이 포함). 밖이면 `null` */
  fence: string | null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export const markdownMode: StreamParser<MdState> = {
  name: "markdown",
  startState: () => ({ fence: null }),
  copyState: (s) => ({ fence: s.fence }),
  token(stream: StringStream, state: MdState): string | null {
    // 울타리 안 — 닫는 울타리까지 줄 통째로 코드
    if (state.fence !== null) {
      if (stream.sol()) {
        const m = stream.match(FENCE, false) as RegExpMatchArray | null;
        if (m && m[1][0] === state.fence[0] && m[1].length >= state.fence.length) {
          stream.skipToEnd();
          state.fence = null;
          return "meta";
        }
      }
      stream.skipToEnd();
      return "monospace";
    }

    if (stream.sol()) {
      const fence = stream.match(FENCE, false) as RegExpMatchArray | null;
      if (fence) {
        state.fence = fence[1];
        stream.skipToEnd();
        return "meta";
      }
      if (stream.match(/^ {0,3}#{1,6}(?=\s|$)/)) {
        stream.skipToEnd();
        return "heading";
      }
      if (stream.match(/^ {0,3}>\s?/)) return "quote";
      if (stream.match(/^ {0,3}([-*_])(\s*\1){2,}\s*$/)) return "contentSeparator";
      if (stream.match(/^\s*([-*+]|\d+[.)])(?=\s)/)) return "list";
    }

    if (stream.match(/^`+/)) {
      const ticks = stream.current();
      // 같은 길이의 닫는 백틱까지 — 없으면 백틱만 글자로
      const rest = stream.string.slice(stream.pos);
      const end = rest.indexOf(ticks);
      if (end < 0) return null;
      stream.pos += end + ticks.length;
      return "monospace";
    }
    if (stream.match(/^\*\*[^*]+\*\*/) || stream.match(/^__[^_]+__/)) return "strong";
    if (stream.match(/^\*[^*\s][^*]*\*/) || stream.match(/^_[^_\s][^_]*_/)) return "emphasis";
    if (stream.match(/^~~(?!~)[^~\s](?:[^~]*[^~\s])?~~(?!~)/)) return "strikethrough";
    if (stream.match(/^!?\[[^\]]*\]\([^)]*\)/)) return "link";
    if (stream.match(/^<https?:\/\/[^>]+>/)) return "url";

    // 다음 표식 앞까지 한 번에 — 글자 하나씩 도는 것보다 빠르다
    if (!stream.match(/^[^`*_~![<]+/)) stream.next();
    return null;
  },
};
