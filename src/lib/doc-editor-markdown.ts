import type { StreamParser, StringStream } from "@codemirror/language";
import { mdTags } from "$lib/doc-editor-md-tags";

/**
 * **편집기의 마크다운 모드** — 작은 StreamParser (문서 편집 E1).
 *
 * `@codemirror/legacy-modes` 에는 마크다운이 없고, `@codemirror/lang-markdown` 은 lezer 파서 한 벌을 더 들인다.
 * 편집기에서 마크다운에 바라는 것은 "제목 · 목록 · 인용 · 코드 울타리 · 강조 · 링크 · 인라인 코드가 눈에 띈다"
 * 정도라 줄 단위 토큰기 하나로 충분하다(잘못 칠해도 글은 그대로다 — 칠은 꾸밈이다). 반환하는 이름은 lezer
 * `tags` 의 이름이라 편집기의 강조 표(`doc-editor-cm.ts`)가 그대로 받는다.
 *
 * **수식 · 각주**(2026-11-11)는 lezer `tags` 에 맞는 이름이 없어 `tokenTable` 로 따로 단 표지([`mdTags`])로 칠한다.
 * 무엇을 수식 · 각주로 보는지는 **미리 보기 파서(`markdown.ts`)가 기준**이다 — 그쪽 규칙을 줄 단위로 옮겼다:
 *
 * - 인라인 수식은 [`inlineMathSpan`](`markdown.ts` 의 `inlineMathAt` 과 같은 규칙 — `$5 and $10` · `$HOME/$USER` · `US$5` 는 글자).
 *   인라인 코드 · `\$` 뒤는 보지 않는다. 다만 **한 줄 안에서만** 짝을 찾는다(미리 보기는 문단 안 줄바꿈을 건너 닫을 수 있다).
 * - 블록 수식 — 줄 전체가 `$$ … $$`, 또는 `$$` 뿐인 줄에서 `$$` 로 끝나는 줄까지. 줄 단위 토큰기는 앞 줄을 내다볼 수 없어
 *   **닫는 줄이 없어도 연 줄부터 칠한다**(울타리 코드와 같은 모양 — 미리 보기는 닫지 않은 `$$` 를 글자로 둔다). 인용 속 `$$` 는 보지 않는다.
 * - ```math 울타리 본문은 수식.
 * - 각주 참조 `[^id]` 는 이름에 공백 · 대괄호가 없을 때. 미리 보기는 **정의가 있을 때만** 위첨자로 그리지만 토큰기는 글 전체를
 *   모르므로 정의가 없어도 칠한다. 정의 줄은 머리 `[^id]:` 만 칠하고 뒤의 글은 여느 본문이다.
 *
 * 수식은 문서 타일의 미리 보기가 늘 켜 두는 선택(`DOC_TILE_MD` 의 `math`)이라 편집기도 늘 칠한다 — 이 모드는 문서 타일 편집기만 받는다.
 */

interface MdState {
  /** 코드 울타리 안 — 여는 울타리 글자(``` 또는 ~~~, 길이 포함). 밖이면 `null` */
  fence: string | null;
  /** 그 울타리가 ```math 인가 — 본문이 수식 */
  fenceMath: boolean;
  /** 여러 줄 블록 수식(`$$` 뿐인 줄로 연 것) 안 */
  mathBlock: boolean;
  /** 이 줄 안에서 칠하는 수식 본문이 끝나는 열 — 밖이면 `-1`. 줄이 바뀌면 걷는다 */
  mathEnd: number;
  /** 본문 뒤의 닫는 표식 길이(`$` 1 · `` `$ `` 백틱 수 + 1 · `$$` 2 · 줄 통째 본문이면 0) */
  mathClose: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
/** 수식 블록의 여는 줄 · 한 줄 꼴 — `markdown.ts` 의 `MATH_FENCE` · `MATH_ONE_LINE` 과 같다 */
const MATH_FENCE = /^\s{0,3}\$\$\s*$/;
const MATH_ONE_LINE = /^\s{0,3}\$\$(.*\S.*)\$\$\s*$/;
/** 각주 정의 줄의 머리 — `markdown.ts` 의 `FN_DEF` 와 같은 이름 규칙 */
const FN_DEF_HEAD = /^ {0,3}\[\^[^\]\s[]+\]:/;
/** `\` 로 글자가 되는 것 — `markdown.ts` 의 `ESCAPABLE` 과 같다 */
const ESCAPED = /^\\[`*_[\]()#!<>|{}+\-.~"'$]/;

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);

/**
 * `src[i]` 의 `$` 에서 시작하는 **인라인 수식** 자리 — 본문 `[from, to)` 와 닫는 표식 뒤 `end`, 아니면 `null`.
 * `markdown.ts` 의 `inlineMathAt` 과 **같은 규칙**이다(그쪽 머리말 — `` $`…`$ `` · 여닫는 `$` 의 앞뒤 글자 · `\$` · 인라인 코드 속 `$` ·
 * `$$` 줄기). 그쪽이 바뀌면 이것도 바꾼다(시험 `doc-editor-markdown.test.ts`).
 */
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

/** 이 줄의 `[from, to)` 가 수식 본문이고 뒤에 `close` 글자의 닫는 표식이 온다 */
function startMath(state: MdState, to: number, close: number): void {
  state.mathEnd = to;
  state.mathClose = close;
}

/** 수식 본문 · 닫는 표식 한 토막 — TeX 명령어(`\frac`)는 따로 */
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
    // 줄 통째 수식 본문(앞 줄의 것)은 줄이 바뀌면 걷는다
    if (stream.sol()) state.mathEnd = -1;
    if (state.mathEnd >= 0) return mathToken(stream, state);

    // 울타리 안 — 닫는 울타리까지 줄 통째로 코드(```math 면 수식)
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

    // 여러 줄 블록 수식 안 — `$$` 로 끝나는 줄에서 닫는다
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
      // 한 줄에 `$$` 짝이 둘 이상(`$$a$$ 와 $$b$$`)이면 블록이 아니다
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

    // `\$` · `\[` 같은 이스케이프는 글자(미리 보기와 같다 — 수식 · 각주 · 강조를 열지 않는다)
    if (stream.match(ESCAPED)) return null;
    if (stream.match(/^`+/)) {
      const ticks = stream.current();
      // 같은 길이의 닫는 백틱까지 — 없으면 백틱만 글자로
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
      // 못 읽은 `$` 줄기는 통째로 글자(둘째 `$` 가 여는 짝이 되지 않게 — 미리 보기와 같다)
      stream.match(/^\$+/);
      return null;
    }
    // 각주 참조 `[^id]` — 링크보다 먼저(미리 보기와 같은 차례)
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

    // 다음 표식 앞까지 한 번에 — 글자 하나씩 도는 것보다 빠르다
    if (!stream.match(/^[^`*_~![<$\\]+/)) stream.next();
    return null;
  },
};
