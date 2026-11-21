import type { StreamParser, StringStream } from "@codemirror/language";
import { mdTags } from "$lib/doc-editor-md-tags";

/**
 * 편집기의 마크다운 모드 — 줄 단위 StreamParser(`@codemirror/lang-markdown` 은 lezer 파서 한 벌을 더 들여 쓰지 않는다).
 * 무엇을 수식 · 각주로 보는지는 미리 보기 파서(`markdown.ts`)가 기준이다. 줄 단위라 다른 점: 인라인 수식은 한 줄 안에서만 짝을 찾고,
 * 닫지 않은 `$$` 도 연 줄부터 칠하고, 각주 참조는 정의가 없어도 칠한다.
 */

interface MdState {
  /** 여는 울타리 글자(길이 포함). 밖이면 `null` */
  fence: string | null;
  fenceMath: boolean;
  mathBlock: boolean;
  /** 이 줄 안에서 칠하는 수식 본문이 끝나는 열 — 밖이면 `-1` */
  mathEnd: number;
  /** 본문 뒤의 닫는 표식 길이 — 줄 통째 본문이면 0 */
  mathClose: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
/** `markdown.ts` 의 `MATH_FENCE` · `MATH_ONE_LINE` 과 같다 */
const MATH_FENCE = /^\s{0,3}\$\$\s*$/;
const MATH_ONE_LINE = /^\s{0,3}\$\$(.*\S.*)\$\$\s*$/;
/** `markdown.ts` 의 `FN_DEF` 와 같은 이름 규칙 */
const FN_DEF_HEAD = /^ {0,3}\[\^[^\]\s[]+\]:/;
/** `markdown.ts` 의 `ESCAPABLE` 과 같다 */
const ESCAPED = /^\\[`*_[\]()#!<>|{}+\-.~"'$]/;

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/** `markdown.ts` 의 `inlineMathAt` 과 같은 규칙 — 그쪽이 바뀌면 이것도 바꾼다(시험 `doc-editor-markdown.test.ts`) */
export function inlineMathSpan(src: string, i: number): { from: number; to: number; end: number } | null {
  if (src[i + 1] === "`") {
    let n = 0;
    while (src[i + 1 + n] === "`") n++;
    const fence = "`".repeat(n);
    for (let j = src.indexOf(fence, i + 1 + n); j >= 0; j = src.indexOf(fence, j + 1)) {
      if (src[j - 1] === "`" || src[j + n] === "`") continue;
      if (src[j + n] !== "$") return null;
      return src.slice(i + 1 + n, j).trim() === "" ? null : { from: i + 1 + n, to: j, end: j + n + 1 };
    }
    return null;
  }
  if (src[i + 1] === "$" || src[i - 1] === "$" || isSpace(src[i + 1]) || isWordChar(src[i - 1])) return null;
  for (let k = i + 1; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "`") {
      let n = 0;
      while (src[k + n] === "`") n++;
      const j = src.indexOf("`".repeat(n), k + n);
      k = j >= 0 ? j + n - 1 : k + n - 1;
      continue;
    }
    if (c !== "$") continue;
    if (src[k + 1] === "$") {
      while (src[k + 1] === "$") k++;
      continue;
    }
    if (isSpace(src[k - 1]) || isWordChar(src[k + 1])) continue;
    return { from: i + 1, to: k, end: k + 1 };
  }
  return null;
}

function startMath(state: MdState, to: number, close: number): void {
  state.mathEnd = to;
  state.mathClose = close;
}

function mathToken(stream: StringStream, state: MdState): string {
  if (stream.pos >= state.mathEnd) {
    stream.pos = Math.min(stream.string.length, stream.pos + state.mathClose);
    state.mathEnd = -1;
    return "mathMark";
  }
  const end = state.mathEnd;
  if (stream.peek() === "\\") {
    const m = /^\\[A-Za-z]+/.exec(stream.string.slice(stream.pos, end));
    if (m) {
      stream.pos += m[0].length;
      return "texCommand";
    }
    stream.pos = Math.min(end, stream.pos + 2);
    return "math";
  }
  const next = stream.string.indexOf("\\", stream.pos);
  stream.pos = next >= 0 && next < end ? next : end;
  return "math";
}

export const markdownMode: StreamParser<MdState> = {
  name: "markdown",
  startState: () => ({ fence: null, fenceMath: false, mathBlock: false, mathEnd: -1, mathClose: 0 }),
  copyState: (s) => ({ ...s }),
  tokenTable: mdTags,
  token(stream: StringStream, state: MdState): string | null {
    if (stream.sol()) state.mathEnd = -1;
    if (state.mathEnd >= 0) return mathToken(stream, state);

    if (state.fence !== null) {
      if (stream.sol()) {
        const m = stream.match(FENCE, false) as RegExpMatchArray | null;
        if (m && m[1][0] === state.fence[0] && m[1].length >= state.fence.length) {
          stream.skipToEnd();
          state.fence = null;
          state.fenceMath = false;
          return "meta";
        }
      }
      if (state.fenceMath) {
        startMath(state, stream.string.length, 0);
        return mathToken(stream, state);
      }
      stream.skipToEnd();
      return "monospace";
    }

    if (state.mathBlock) {
      const t = stream.string.trimEnd();
      if (t.endsWith("$$")) {
        state.mathBlock = false;
        startMath(state, t.length - 2, 2);
      } else startMath(state, stream.string.length, 0);
      return mathToken(stream, state);
    }

    if (stream.sol()) {
      const fence = stream.match(FENCE, false) as RegExpMatchArray | null;
      if (fence) {
        state.fence = fence[1];
        state.fenceMath = fence[2].toLowerCase() === "math";
        stream.skipToEnd();
        return "meta";
      }
      if (stream.match(FN_DEF_HEAD)) return "footnoteDef";
      const one = MATH_ONE_LINE.exec(stream.string);
      // `$$a$$ 와 $$b$$` 는 블록이 아니다
      if (one && !one[1].includes("$$")) {
        stream.match(/^\s{0,3}\$\$/);
        startMath(state, stream.string.trimEnd().length - 2, 2);
        return "mathMark";
      }
      if (MATH_FENCE.test(stream.string)) {
        state.mathBlock = true;
        stream.skipToEnd();
        return "mathMark";
      }
      if (stream.match(/^ {0,3}#{1,6}(?=\s|$)/)) {
        stream.skipToEnd();
        return "heading";
      }
      if (stream.match(/^ {0,3}>\s?/)) return "quote";
      if (stream.match(/^ {0,3}([-*_])(\s*\1){2,}\s*$/)) return "contentSeparator";
      if (stream.match(/^\s*([-*+]|\d+[.)])(?=\s)/)) return "list";
    }

    if (stream.match(ESCAPED)) return null;
    if (stream.match(/^`+/)) {
      const ticks = stream.current();
      const rest = stream.string.slice(stream.pos);
      const end = rest.indexOf(ticks);
      if (end < 0) return null;
      stream.pos += end + ticks.length;
      return "monospace";
    }
    if (stream.peek() === "$") {
      const m = inlineMathSpan(stream.string, stream.pos);
      if (m) {
        stream.pos = m.from;
        startMath(state, m.to, m.end - m.to);
        return "mathMark";
      }
      // 둘째 `$` 가 여는 짝이 되지 않게 줄기를 통째로 글자로 — 미리 보기와 같다
      stream.match(/^\$+/);
      return null;
    }
    // 링크보다 먼저 — 미리 보기와 같은 차례
    if (stream.peek() === "[" && stream.string[stream.pos + 1] === "^") {
      const j = stream.string.indexOf("]", stream.pos + 2);
      if (j > stream.pos + 2 && !/[\s[]/.test(stream.string.slice(stream.pos + 2, j))) {
        stream.pos = j + 1;
        return "footnoteRef";
      }
    }
    if (stream.match(/^\*\*[^*]+\*\*/) || stream.match(/^__[^_]+__/)) return "strong";
    if (stream.match(/^\*[^*\s][^*]*\*/) || stream.match(/^_[^_\s][^_]*_/)) return "emphasis";
    if (stream.match(/^~~(?!~)[^~\s](?:[^~]*[^~\s])?~~(?!~)/)) return "strikethrough";
    if (stream.match(/^!?\[[^\]]*\]\([^)]*\)/)) return "link";
    if (stream.match(/^<https?:\/\/[^>]+>/)) return "url";

    if (!stream.match(/^[^`*_~![<$\\]+/)) stream.next();
    return null;
  },
};
