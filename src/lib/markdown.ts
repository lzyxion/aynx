/**
 * **마크다운의 순수 층** — 글을 **블록과 인라인 토막의 목록**으로만 나눈다. HTML 은 만들지 않는다.
 *
 * 기록 보기(`ConversationViewer`)의 에이전트 말과 문서 보기 타일(`.md` 파일)이 같은 파서를 쓴다. 화면은
 * `MarkdownBlocks.svelte` 가 그 목록을 Svelte 의 글자 보간(`{text}`)으로 그린다 — 본문 글이 `{@html}` 로 가는 길이 없으니
 * `<script>` · `<img onerror>` 는 **글자 그대로** 보인다(예외는 그리기 엔진이 짠 출력 둘 — 문서 보기 타일의 mermaid SVG 와
 * KaTeX 수식, 근거는 `MarkdownBlocks` 머리말). 링크는 글자 + 주소이고, 여는 것은 화면 쪽 손잡이
 * (Ctrl+클릭 · `http`/`https` 만 — [`isWebUrl`])다. 그림은 주소만 싣는다 — 불러오는 것은 문서 보기 타일뿐이고 그것도 문서와
 * 같은 백엔드의 경로만이다(`doc-images.ts`). 그 밖의 화면에서는 대체 글자다.
 *
 * 읽는 것: 문단 · 제목(ATX `#` 와 밑줄식 `===`/`---`) · 코드 블록(울타리) · 인라인 코드 · 굵게 · 기울임 · 취소선 · 링크 ·
 * 자동 링크 · 그림 · 목록(체크박스 포함) · 인용(안에 다시 블록 — 중첩 인용 포함) · 표(구분 줄이 맞을 때만) ·
 * 가로줄 · 참조 링크(`[글][id]` · `[글][]` · `[글]` + `[id]: 주소` 정의 줄 — 정의 줄은 화면에서 빠진다) ·
 * GitHub 알림(`> [!NOTE]` · `[!TIP]` · `[!IMPORTANT]` · `[!WARNING]` · `[!CAUTION]` — 최상위 인용만) ·
 * 머리말(글 맨 앞 `---` … `---` · `+++` … `+++` — `frontmatter` 선택을 켰을 때만, 문서 보기 타일) ·
 * 각주(GitHub 식 `[^id]` 참조 + `[^id]: 글` 정의 줄 — 정의 줄은 본문에서 빠지고 글 끝 `footnotes` 블록이 된다) ·
 * 수식(`$…$` · `$$…$$` · ```math — `math` 선택을 켰을 때만, 문서 보기 타일. 그리기는 `MathView` 의 KaTeX).
 * 굵게 · 기울임 · 취소선의 안쪽은 다시 인라인으로 읽는다(`**[a](u)b**` = 굵은 링크 + 굵은 b — `inlines`, 4겹까지).
 * **모르는 문법은 글자로 떨어진다** — 잃는 것이 없다(칸이 넘치는 표는 격자 대신 고정폭 원문으로).
 */

/**
 * 인라인 토막. 모든 토막에 `text` 가 있다(보이는 글자).
 * - `link` — `href` 는 적힌 그대로(열지 말지는 화면이 [`isWebUrl`] 로 가린다). `image` 가 참이면 링크 글자가
 *   그림(`[![alt](src)](href)` — 배지 줄)이었고 `text` 는 그 대체 글자다.
 * - `image` — `text` 는 대체 글자, `href` 는 적힌 그대로의 그림 주소(불러올지는 화면 쪽 — `doc-images.ts`).
 * - `fnref` — 각주 참조 `[^id]`. `n` 은 각주 번호(글에서 **처음 참조된 순서** 1, 2, 3 …), `text` 는 보이는 그 번호,
 *   `occ` 는 같은 각주의 몇째 참조인가(1 부터 — 각주 항목의 ↩ 가 그 자리로 돌아간다). `id` 는 이름의 비교 형([`refKey`]).
 */
export type MdInline =
  | { kind: "text" | "code"; text: string }
  /**
   * 굵게 · 기울임 · 취소선 — `text` 는 안쪽 표식을 걷은 평문(링크는 글자 · 그림은 대체 글 — `inlineText` 와 같은 글자).
   * 안쪽에 표식(링크 · 코드 · 중첩 굵게/기울임 · 그림 · 수식 · 각주)이 하나라도 있으면 `inlines` 에 그 토막들 — 평문뿐이면 키 없음.
   * 그리는 쪽은 `inlines` 가 있으면 그것을, 없으면 `text` 를 그린다
   */
  | { kind: "strong" | "em" | "del"; text: string; inlines?: MdInline[] }
  /**
   * `source` — **그 자리 출처 칩** 표식(파서는 달지 않는다 — 대화 면의 `md-source-chips.ts` `placeSourceChips` 만). 그때 `text` 는
   * 칩 툴팁에 쓸 이름표 글자(같은 주소 연달음이면 ` · ` 로 이음 · 글자가 곧 주소 · 사이트 이름이면 빈 글자)
   */
  | { kind: "link"; text: string; href: string; image?: true; source?: true }
  | { kind: "image"; text: string; href: string }
  | { kind: "fnref"; text: string; id: string; n: number; occ: number }
  /** 인라인 수식 `$…$` · `` $`…`$ `` — `text` 는 TeX 원문(표식은 뗀다). `math` 선택일 때만 생긴다 */
  | { kind: "math"; text: string };

export type MdAlign = "left" | "center" | "right" | null;

/** GitHub 알림의 다섯 종류 — 표식(`[!NOTE]`)의 소문자 */
export type MdAlertType = "note" | "tip" | "important" | "warning" | "caution";

export type MdListItem = {
  depth: number;
  inlines: MdInline[];
  /** 체크박스 항목(`- [ ]` · `- [x]`)이면 그 상태, 아니면 키 없음 */
  checked?: boolean;
  /**
   * 체크박스 항목의 원문 줄(0 기준 — `\r\n` 도 한 줄 끝) — `checked` 가 있을 때만. 문서 타일이 누른 체크박스를 파일에
   * 되쓰는 자리다([`toggleTaskLine`]). 인용 · 알림 속 목록도 원문의 줄이다(`>` 를 뗀 줄마다 원문 번호를 들고 내려간다)
   */
  line?: number;
};

/** 각주 하나 — `refs` 는 본문(과 다른 각주) 속 참조 수(↩ 의 개수). 글은 인라인 한 덩어리다(이어진 줄은 줄바꿈으로 잇는다) */
export type MdFootnote = { n: number; id: string; inlines: MdInline[]; refs: number };

export type MdBlock =
  | { kind: "p"; inlines: MdInline[] }
  | { kind: "h"; level: number; inlines: MdInline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: MdListItem[] }
  /** 인용 — 안은 다시 블록들(중첩 인용 · 목록 · 코드) */
  | { kind: "quote"; blocks: MdBlock[] }
  /** GitHub 알림 — 첫 줄이 `[!NOTE]` 같은 표식뿐인 최상위 인용. `blocks` 는 표식 줄을 뺀 나머지 */
  | { kind: "alert"; type: MdAlertType; blocks: MdBlock[] }
  /** 표 — 머리 칸 · 칸 정렬 · 줄들(짧은 줄은 빈 칸으로 채웠다) */
  | { kind: "table"; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] }
  /** 표처럼 생겼지만 격자로 못 읽은 줄들 — 고정폭 그대로 */
  | { kind: "pre"; text: string }
  /**
   * 머리말 — 글 **맨 첫 줄**의 `---`(YAML) · `+++`(TOML) 부터 닫는 줄까지(표식 줄은 뺀 안쪽). `count` 는 최상위 키 수,
   * `entries` 는 안쪽이 전부 단순한 `키: 값`(TOML 은 `키 = 값`)일 때만 — 중첩 · 목록 · 여러 줄 값이 하나라도 있으면 없다
   * (화면은 원문을 고정폭으로). YAML 을 해석하지 않는다(얕게 줄 모양만 본다)
   */
  | { kind: "frontmatter"; format: "yaml" | "toml"; text: string; count: number; entries?: { key: string; value: string }[] }
  /**
   * 각주 구역 — 글 **맨 끝**에 하나(참조된 각주가 하나라도 있을 때만). 번호 순서(= 처음 참조된 순서). 참조 없는 정의는
   * 싣지 않는다(GitHub 와 같다 — 정의만 남은 각주는 고칠 거리이지 읽을 거리가 아니다). 제목이 아니라 목차에 들지 않는다
   */
  | { kind: "footnotes"; items: MdFootnote[] }
  /** 블록 수식 — `$$` … `$$` · ```math 의 TeX 원문. `math` 선택일 때만 생긴다 */
  | { kind: "math"; text: string }
  | { kind: "hr" };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
/** 빈 제목(`#` 하나만) — 위 규칙은 뒤에 공백이 있어야 하므로 따로 */
const HEADING_EMPTY = /^\s{0,3}(#{1,6})\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE = /^\s*\|/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
/** 체크박스 항목 — 뒤 글이 없어도(`- [ ]` 만) 체크박스다(GitHub 과 같다 · 편집 중 막 친 줄도 바로 보인다) */
const TASK = /^\[([ xX])\](?:\s+(.*))?$/s;
/** 표 구분 줄의 한 칸 — `---` · `:--` · `--:` · `:-:` */
const SEP_CELL = /^\s*(:?)-+(:?)\s*$/;

/** 알림 표식 줄 — 그 줄에 표식 말고 다른 글이 없다(앞뒤 공백은 된다 · 대소문자 무시) */
const ALERT = /^\s*\[!(note|tip|important|warning|caution)\]\s*$/i;

/**
 * 인용 본문(`>` 를 뗀 줄들)이 알림인가 — 그렇다면 종류. **최상위 인용만**(`depth === 0`): GitHub 도 알림을 다른
 * 요소(인용 · 목록) 속에 두지 못하게 한다 — 중첩 인용 속 `[!NOTE]` 는 일반 인용이고 표식은 글자로 남는다.
 * 표식 밑에 글이 하나도 없으면 역시 일반 인용이다(빈 알림 상자보다 적힌 글자가 정직하다).
 * [`parseLines`] 와 [`scanHeadings`] 가 같이 쓴다 — 둘의 갈래가 어긋나지 않게 판정은 여기 하나.
 */
function alertOf(body: string[], depth: number): MdAlertType | null {
  if (depth !== 0 || body.length < 2) return null;
  const m = ALERT.exec(body[0]);
  if (!m || body.slice(1).every(isBlank)) return null;
  return m[1].toLowerCase() as MdAlertType;
}

/** 인용 안의 인용이 끝없이 내려가지 않게 */
const MAX_QUOTE_DEPTH = 8;

/**
 * 역슬래시로 풀 수 있는 글자 — 마크다운의 표식들. 역슬래시 자신은 뺀다(`\\server\share` 를 지킨다). `$` 는 수식 표식이라
 * `\$` 가 글자 `$` 다(CommonMark 도 `$` 를 풀 수 있는 글자로 본다 — 수식을 끈 글에서도 같다)
 */
const ESCAPABLE = new Set("`*_[]()#!<>|{}+-.~\"'$");

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);

/**
 * 링크 글자 뒤에 흐리게 붙일 **주소 꼬리** — 없으면 `null`.
 *
 * 글자가 곧 주소면 두 번 적지 않는다. **배지 링크**(`[![alt](img)](url)` — `image` 가 참)도 꼬리를 달지 않는다:
 * README 첫머리의 배지 줄은 주소가 길고 여럿이라, 꼬리를 달면 글보다 주소가 더 많은 줄이 된다. 주소는 툴팁에 있다.
 */
export function linkUrlTail(s: { text: string; href: string; image?: true }): string | null {
  if (s.image || s.text === s.href) return null;
  return s.href;
}

/**
 * 출처 칩에 적을 **사이트 이름** — 주소의 호스트(포트 포함)에서 앞의 `www.` 만 뗀다(대화 면의 링크 칩 — `MarkdownBlocks` 의 `linkStyle="chip"`).
 *
 * 호스트는 **적힌 글자 그대로** 잘라 낸다 — `URL` 은 국제화 도메인을 퓨니코드(`xn--…`)로 바꿔 버려, 글에 `한국.kr` 이라 적혀
 * 있어도 칩이 읽을 수 없는 글자가 된다. 사용자 정보(`id@`)는 떼고 대소문자는 소문자로 맞춘다. 주소로 읽히지 않으면 `href` 그대로.
 */
export function linkHost(href: string): string {
  const m = /^https?:\/\/([^/?#]*)/i.exec(href);
  if (!m) return href;
  try {
    new URL(href);
  } catch {
    return href;
  }
  const host = m[1].slice(m[1].lastIndexOf("@") + 1).toLowerCase();
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return bare || href;
}

/** 열지 말지의 유일한 판정 — `http:` · `https:` 둘만 (터미널의 OSC 8 과 같은 규칙) */
export function isWebUrl(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** `[`(i) 에 짝인 `]` 의 자리 — 대괄호 중첩을 센다. 없으면 -1 */
function closeBracket(src: string, i: number): number {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "`") {
      // 인라인 코드 안의 대괄호는 세지 않는다
      const j = src.indexOf("`", k + 1);
      if (j > 0) k = j;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return k;
  }
  return -1;
}

/** `(`(i) 에서 시작하는 링크 대상 — 주소(꺾쇠 허용)와 선택적 제목. 못 읽으면 null */
function readTarget(src: string, i: number): { href: string; end: number } | null {
  if (src[i] !== "(") return null;
  let k = i + 1;
  while (src[k] === " ") k++;
  let href = "";
  if (src[k] === "<") {
    const j = src.indexOf(">", k + 1);
    if (j < 0) return null;
    href = src.slice(k + 1, j);
    k = j + 1;
  } else {
    let depth = 0;
    const s = k;
    while (k < src.length && !/\s/.test(src[k])) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") {
        if (depth === 0) break;
        depth--;
      }
      k++;
    }
    href = src.slice(s, k);
  }
  while (src[k] === " ") k++;
  // 선택적 제목 — "…" · '…' · (…)
  const q = src[k];
  if (q === '"' || q === "'" || q === "(") {
    const close = q === "(" ? ")" : q;
    const j = src.indexOf(close, k + 1);
    if (j < 0) return null;
    k = j + 1;
    while (src[k] === " ") k++;
  }
  if (src[k] !== ")") return null;
  return { href, end: k + 1 };
}

/** 링크 글자가 그림 하나뿐이면 그 대체 글자 — 그림은 인라인(`![a](src)`)이든 참조(`![a][id]` · `![a][]`)든 */
const IMAGE_ONLY = /^!\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])$/;

/**
 * **참조 정의** — 이름(소문자 · 공백 한 칸으로 접은 것) → 주소. `parseMarkdown` 이 글 전체에서 먼저 모아
 * 인라인 파서에 넘긴다. 같은 이름이 둘이면 **먼저 적힌 것**이 이긴다(CommonMark 와 같다).
 */
export type MdRefs = ReadonlyMap<string, string>;

/**
 * 정의 줄 `[id]: 주소 "제목"` — 주소는 꺾쇠(`<…>`)도 된다. 제목은 읽고 버린다(툴팁은 주소다).
 * `[^1]: …` 은 각주 정의라 여기서 보지 않는다([`takeFootnoteDefs`] 가 먼저 가져간다).
 */
const REF_DEF = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(<[^>]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;

/** 참조 이름의 비교 형 — 대소문자 · 공백 차이는 같은 이름이다 */
export function refKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * `[`(open)…`]`(close) 뒤의 **참조 대상** — `[글][id]` · `[글][]`(글이 곧 이름) · `[글]`(줄임). 정의가 없으면
 * `null` 이고 글자로 남는다. 정의가 있을 때만 링크라서 `[x]` 같은 흔한 대괄호 글이 링크로 둔갑하지 않는다.
 */
function refTarget(src: string, open: number, close: number, refs: MdRefs | undefined): { href: string; end: number } | null {
  if (!refs || refs.size === 0) return null;
  let id = src.slice(open + 1, close);
  let end = close + 1;
  if (src[close + 1] === "[") {
    const j = src.indexOf("]", close + 2);
    if (j < 0) return null;
    const named = src.slice(close + 2, j);
    if (named.trim() !== "") id = named;
    end = j + 1;
  }
  const href = refs.get(refKey(id));
  return href === undefined ? null : { href, end };
}

/** 맨 주소의 끝 — 공백 전까지, 뒤에 붙은 문장 부호는 뗀다 */
function bareUrlEnd(src: string, i: number): number {
  let k = i;
  while (k < src.length && !/[\s<>"`]/.test(src[k])) k++;
  while (k > i && /[.,;:!?'*_)\]]/.test(src[k - 1])) {
    // 짝이 맞는 닫는 괄호는 주소의 일부다 (위키 주소 `…_(disambiguation)`)
    if (src[k - 1] === ")" && count(src.slice(i, k), "(") >= count(src.slice(i, k), ")")) break;
    k--;
  }
  return k;
}

const count = (s: string, c: string) => s.split(c).length - 1;

/**
 * 인라인 — `코드`(같은 길이의 백틱 짝) · 굵게(`**`/`__`) · 기울임(`*`/`_`) · 링크 · 그림 · 자동 링크(`<https://…>`
 * 와 맨 `https://…`) · 역슬래시 풀기. 짝이 없으면 글자 그대로.
 *
 * 밑줄(`_` · `__`)은 **낱말 경계에서만** 표식이다 — `snake_case_name` · `foo__bar__baz` 는 글자로 남는다.
 *
 * 취소선은 GFM 의 `~~글~~` — **물결 둘**만 표식이다(하나 `~/x` · 셋 이상 `~~~` 은 글자). 여는 짝 뒤 · 닫는 짝 앞은
 * 공백이 아니고, 닫는 짝은 인라인 코드 안에서 찾지 않는다.
 *
 * 각주 참조 `[^id]` 는 그 이름의 정의가 있을 때만(`ctx.footnotes`) 위첨자 토막이다 — 없으면 글자 그대로(`[x]` 처럼).
 *
 * **굵게 · 기울임 · 취소선의 안쪽도 다시 인라인으로 읽는다**(`**[a](u)b**` = 굵은 링크 + 굵은 b — GitHub 와 같다 ·
 * [`emphasis`]). 중첩은 [`MAX_INLINE_DEPTH`] 겹까지 — 그 아래는 안쪽을 평문으로 둔다(병적 입력 보호).
 */
export function parseInline(src: string, ctx: InlineCtx = {}): MdInline[] {
  return inlineAt(src, ctx, 0);
}

/** 굵게 · 기울임 · 취소선의 안쪽을 다시 읽는 겹 상한 */
const MAX_INLINE_DEPTH = 4;

/** 굵게 · 기울임 · 취소선 토막 — 안쪽을 다시 읽고, 표식이 있을 때만 `inlines` 를 단다(`text` 는 늘 평문) */
function emphasis(kind: "strong" | "em" | "del", inner: string, ctx: InlineCtx, depth: number): MdInline {
  if (depth >= MAX_INLINE_DEPTH) return { kind, text: unescape(inner) };
  const xs = inlineAt(inner, ctx, depth + 1);
  const text = xs.map((x) => x.text).join("");
  return xs.every((x) => x.kind === "text") ? { kind, text } : { kind, text, inlines: xs };
}

function inlineAt(src: string, ctx: InlineCtx, depth: number): MdInline[] {
  const { refs, footnotes, math } = ctx;
  const out: MdInline[] = [];
  let buf = "";
  const flush = () => {
    if (buf !== "") out.push({ kind: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && ESCAPABLE.has(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      let n = 0;
      while (src[i + n] === "`") n++;
      const fence = "`".repeat(n);
      let j = src.indexOf(fence, i + n);
      // 더 긴 백틱 줄의 일부는 짝이 아니다
      while (j >= 0 && src[j + n] === "`") {
        let k = j;
        while (src[k] === "`") k++;
        j = src.indexOf(fence, k);
      }
      if (j >= 0) {
        flush();
        const inner = src.slice(i + n, j);
        const trimmed = inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ") ? inner.slice(1, -1) : inner;
        out.push({ kind: "code", text: trimmed });
        i = j + n;
        continue;
      }
      buf += fence;
      i += n;
      continue;
    }
    // 인라인 수식 — 인라인 코드 다음(코드 속 `$` 는 이미 코드다). 못 읽은 `$` 줄기는 통째로 글자(둘째 `$` 가 여는 짝이 되지 않게)
    if (c === "$" && math) {
      const m = inlineMathAt(src, i);
      if (m) {
        flush();
        out.push({ kind: "math", text: m.text });
        i = m.end;
        continue;
      }
      let n = 0;
      while (src[i + n] === "$") n++;
      buf += "$".repeat(n);
      i += n;
      continue;
    }
    // 각주 참조 `[^id]` — 이름에 공백 · 대괄호가 없고 정의가 있을 때만
    if (c === "[" && src[i + 1] === "^" && footnotes) {
      const j = src.indexOf("]", i + 2);
      const label = j > i + 2 ? src.slice(i + 2, j) : "";
      const ref = label !== "" && !/[\s[]/.test(label) ? footnoteRef(footnotes, label) : null;
      if (ref) {
        flush();
        out.push(ref);
        i = j + 1;
        continue;
      }
    }
    // 그림 `![alt](src)` · 링크 `[text](href)`
    if ((c === "!" && src[i + 1] === "[") || c === "[") {
      const open = c === "!" ? i + 1 : i;
      const close = closeBracket(src, open);
      const target = close > open ? (readTarget(src, close + 1) ?? refTarget(src, open, close, refs)) : null;
      if (target) {
        flush();
        const label = src.slice(open + 1, close);
        if (c === "!") {
          out.push({ kind: "image", text: label, href: target.href });
        } else {
          const img = IMAGE_ONLY.exec(label.trim());
          out.push(img ? { kind: "link", text: img[1], href: target.href, image: true } : { kind: "link", text: unescape(label), href: target.href });
        }
        i = target.end;
        continue;
      }
    }
    // 자동 링크 `<https://…>`
    if (c === "<") {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i, i + 2048));
      if (m) {
        flush();
        out.push({ kind: "link", text: m[1], href: m[1] });
        i += m[0].length;
        continue;
      }
    }
    // 맨 주소 — 낱말 한가운데에서는 시작하지 않는다
    if ((c === "h" || c === "H") && !isWordChar(src[i - 1]) && /^https?:\/\/[^\s<>]/i.test(src.slice(i, i + 9))) {
      const end = bareUrlEnd(src, i);
      const url = src.slice(i, end);
      if (/^https?:\/\/[^\s]+/i.test(url) && url.length > url.indexOf("//") + 2) {
        flush();
        out.push({ kind: "link", text: url, href: url });
        i = end;
        continue;
      }
    }
    // 취소선 `~~글~~` — 물결이 정확히 둘인 줄기만(앞 글자가 물결이면 더 긴 줄기의 꼬리다)
    if (c === "~" && src[i + 1] === "~" && src[i + 2] !== "~" && src[i - 1] !== "~") {
      const j = isSpace(src[i + 2]) ? -1 : findDelClose(src, i + 2);
      if (j > i + 2) {
        flush();
        out.push(emphasis("del", src.slice(i + 2, j), ctx, depth));
        i = j + 2;
        continue;
      }
      buf += "~~";
      i += 2;
      continue;
    }
    if ((c === "*" || c === "_") && src[i + 1] === c) {
      const mark = c + c;
      // 여는 짝 뒤 · 닫는 짝 앞은 공백이 아니다(`**/*.ts 와 **/*.js` 는 글자). 밑줄 둘은 낱말 경계에서만
      const okOpen = !isSpace(src[i + 2]) && (c === "*" || !isWordChar(src[i - 1]));
      let j = okOpen ? src.indexOf(mark, i + 2) : -1;
      while (j >= 0 && (isSpace(src[j - 1]) || (c === "_" && isWordChar(src[j + 2])))) j = src.indexOf(mark, j + 1);
      // 닫는 줄기가 셋(`***a***` · `**a *b***`)이고 안쪽의 홑 표식이 짝을 못 찾았으면 한 칸 뒤의 둘이 굵게의 짝이다 —
      // 앞의 하나는 안쪽 기울임이 닫는다
      if (j > i + 2 && src[j + 2] === c && count(src.slice(i + 2, j), c) % 2 === 1) j++;
      if (j > i + 2) {
        flush();
        out.push(emphasis("strong", src.slice(i + 2, j), ctx, depth));
        i = j + 2;
        continue;
      }
      // 짝 없는 `**` 는 둘 다 글자 — 한 글자씩 기울임을 찾지 않는다
      buf += mark;
      i += 2;
      continue;
    }
    if ((c === "*" || c === "_") && !isSpace(src[i + 1])) {
      // 여는 짝 바로 뒤가 문장 부호면 앞은 공백·줄 처음이어야 한다(`src/*.ts` 는 글자) — CommonMark 의 왼쪽 기댐보다 조금 좁다
      const okOpen = (!isPunct(src[i + 1]) || isSpace(src[i - 1])) && (c === "*" || !isWordChar(src[i - 1]));
      const j = okOpen ? findEmClose(src, i + 1, c) : -1;
      if (j > i + 1) {
        flush();
        out.push(emphasis("em", src.slice(i + 1, j), ctx, depth));
        i = j + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** 기울임의 닫는 짝 — 앞이 공백이 아니고, 같은 글자 둘(`**`)의 일부가 아니며, 밑줄이면 뒤가 낱말이 아니다 */
function findEmClose(src: string, from: number, c: string): number {
  for (let j = src.indexOf(c, from); j >= 0; j = src.indexOf(c, j + 1)) {
    if (isSpace(src[j - 1]) || src[j - 1] === c) continue;
    if (src[j + 1] === c) {
      j++; // `**` 는 건너뛴다
      continue;
    }
    if (c === "_" && isWordChar(src[j + 1])) continue;
    return j;
  }
  return -1;
}

/**
 * 취소선의 닫는 짝 — 물결이 정확히 둘이고 앞이 공백이 아니다. 인라인 코드(같은 길이 백틱 짝) 속 · 역슬래시로 푼
 * 물결은 건너뛴다. 없으면 -1
 */
function findDelClose(src: string, from: number): number {
  for (let k = from; k < src.length; k++) {
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
    if (c !== "~") continue;
    let n = 0;
    while (src[k + n] === "~") n++;
    if (n === 2 && !isSpace(src[k - 1])) return k;
    k += n - 1;
  }
  return -1;
}

/**
 * `src[i]` 의 `$` 에서 시작하는 **인라인 수식** — `{ text: TeX, end: 다음 자리 }`, 아니면 `null`. GitHub 규칙에 맞추되 더 보수적이다
 * (가격 · 셸 변수가 수식으로 둔갑하는 것이 수식 하나를 놓치는 것보다 나쁘다):
 *
 * - `` $`…`$ `` — GitHub 의 백틱 형식. 같은 길이 백틱 짝 바로 뒤에 `$` 가 와야 한다. 안은 그대로 TeX 다.
 * - `$…$` — 여는 `$` 뒤 · 닫는 `$` 앞이 공백이 아니다. 닫는 `$` 뒤에 **글자 · 숫자가 붙지 않는다**(GitHub 은 숫자만 —
 *   `$HOME/$USER` 같은 셸 줄을 지키려 글자도 뺀다). 여는 `$` 앞도 글자 · 숫자가 아니다(`US$5`). `$$` 줄기는 인라인이 아니다.
 * - 안의 `\$` 는 TeX 의 달러라 닫는 짝이 아니고, 인라인 코드(같은 길이 백틱 짝) 속 `$` 도 닫는 짝이 아니다.
 *
 * 그래서 `$5 and $10` · `$HOME/$USER` · `US$5` 는 글자다.
 */
function inlineMathAt(src: string, i: number): { text: string; end: number } | null {
  if (src[i + 1] === "`") {
    let n = 0;
    while (src[i + 1 + n] === "`") n++;
    const fence = "`".repeat(n);
    for (let j = src.indexOf(fence, i + 1 + n); j >= 0; j = src.indexOf(fence, j + 1)) {
      // 더 긴 백틱 줄기의 일부는 짝이 아니다
      if (src[j - 1] === "`" || src[j + n] === "`") continue;
      if (src[j + n] !== "$") return null;
      const text = src.slice(i + 1 + n, j).trim();
      return text === "" ? null : { text, end: j + n + 1 };
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
      // `$$` 줄기는 닫는 짝이 아니다 — 통째로 건너뛴다
      while (src[k + 1] === "$") k++;
      continue;
    }
    if (isSpace(src[k - 1]) || isWordChar(src[k + 1])) continue;
    return { text: src.slice(i + 1, k), end: k + 1 };
  }
  return null;
}

/** 수식 블록의 여는 줄 — `$$` 만(앞 공백 셋까지) · 한 줄 꼴 `$$ … $$` */
const MATH_FENCE = /^\s{0,3}\$\$\s*$/;
const MATH_ONE_LINE = /^\s{0,3}\$\$(.*\S.*)\$\$\s*$/;

/**
 * `lines[i]` 에서 시작하는 **수식 블록** — `{ text: TeX, end: 블록 다음 줄 }`, 아니면 `null`. 보수적이다:
 *
 * - 한 줄 꼴: 줄 전체가 `$$ … $$`.
 * - 여러 줄 꼴: 여는 줄이 `$$` **뿐**이고, 끝이 `$$` 로 끝나는 줄(그 앞 글은 TeX 의 마지막 줄)에서 닫는다. 빈 줄이 끼어도
 *   된다(울타리처럼). 닫지 않았으면 수식이 아니다 — 글자로 남는다(잃지 않는다).
 *
 * `$$ 5 and $$` 처럼 줄 **한가운데**에서 시작하는 `$$` 는 블록이 아니다(문단의 글자 — 인라인 규칙도 `$$` 를 읽지 않는다).
 * [`parseLines`] 와 [`scanHeadings`] 가 같이 쓴다 — 블록 속 `# …` 가 어느 쪽에서도 제목이 되지 않는다. 참조 · 각주 정의
 * 줄 거두기는 이 블록을 모른다(블록 속에 `[x]: y` 꼴 줄이 있으면 정의로 먼저 거둬진다 — TeX 에서 드물다).
 */
function mathBlockAt(lines: string[], i: number): { text: string; end: number } | null {
  const one = MATH_ONE_LINE.exec(lines[i]);
  // 한 줄에 `$$` 짝이 둘 이상(`$$a$$ 와 $$b$$`)이면 블록이 아니다
  if (one) return one[1].includes("$$") ? null : { text: one[1].trim(), end: i + 1 };
  if (!MATH_FENCE.test(lines[i])) return null;
  const body: string[] = [];
  for (let k = i + 1; k < lines.length; k++) {
    const t = lines[k].trimEnd();
    if (t.endsWith("$$")) {
      const last = t.slice(0, -2);
      if (last.trim() !== "") body.push(last);
      const text = body.join("\n");
      // 빈 블록(`$$` 두 줄)은 수식이 아니다 — 글자로 남는다
      return text.trim() === "" ? null : { text, end: k + 1 };
    }
    body.push(lines[k]);
  }
  return null;
}

function unescape(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
      out += s[++i];
      continue;
    }
    out += s[i];
  }
  return out;
}

/** 표 한 줄 → 칸들(`\|` 는 칸 나눔이 아니다) · 앞뒤 파이프는 뗀다 */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** 구분 줄이면 칸 정렬들, 아니면 null */
function separatorAligns(line: string): MdAlign[] | null {
  if (!line.includes("-") || !/^[\s|:-]+$/.test(line)) return null;
  const cells = splitRow(line);
  const out: MdAlign[] = [];
  for (const c of cells) {
    const m = SEP_CELL.exec(c);
    if (!m) return null;
    out.push(m[1] && m[2] ? "center" : m[2] ? "right" : m[1] ? "left" : null);
  }
  return out;
}

/** `i` 줄이 표의 머리인가 — 파이프가 있고 다음 줄이 칸 수가 같은 구분 줄 */
function tableAt(lines: string[], i: number): MdAlign[] | null {
  const head = lines[i];
  if (!head.includes("|") || i + 1 >= lines.length) return null;
  const align = separatorAligns(lines[i + 1]);
  if (!align) return null;
  // 파이프 없는 구분 줄(`---`)은 가로줄/밑줄식 제목이다 — 표로 읽지 않는다
  if (!lines[i + 1].includes("|") && align.length < 2) return null;
  return splitRow(head).length === align.length ? align : null;
}

const isBlank = (l: string) => l.trim() === "";

/**
 * 인라인 파서가 글 전체에서 받는 것 — 참조 링크 정의 · 각주 정의와 번호표. [`parseMarkdown`] 이 만들어 모든 토막 파싱에
 * 같은 것을 넘긴다(각주 번호가 글 순서로 이어지게).
 */
export interface InlineCtx {
  refs?: MdRefs;
  footnotes?: FootnoteCtx;
  /** 인라인 수식을 읽는가(`MdOptions.math`) */
  math?: boolean;
}

/** 각주 — 정의(이름 → 원문 글) · 참조된 순서의 목록(번호는 자리 + 1) */
export interface FootnoteCtx {
  defs: ReadonlyMap<string, string>;
  order: { id: string; refs: number }[];
}

/** 각주 참조 하나를 센다 — 정의가 없으면 `null`(글자로 남는다). 처음 참조면 다음 번호를 받는다 */
function footnoteRef(fn: FootnoteCtx, label: string): MdInline | null {
  const id = refKey(label);
  if (!fn.defs.has(id)) return null;
  let k = fn.order.findIndex((e) => e.id === id);
  if (k < 0) k = fn.order.push({ id, refs: 0 }) - 1;
  const e = fn.order[k];
  e.refs++;
  return { kind: "fnref", text: String(k + 1), id, n: k + 1, occ: e.refs };
}

/**
 * 파싱 선택 — 둘 다 문서 보기 타일(파일)만 켜고 기록 보기 같은 남의 말은 끈다.
 * - `frontmatter` — 글 맨 앞 머리말을 블록으로 뗀다(파일의 머리말).
 * - `math` — 수식 `$…$` · `` $`…`$ `` · `$$…$$` · ```math 를 수식 토막 · 블록으로(그리기는 `MathView` — KaTeX). 에이전트
 *   말에는 `$` 가 흔하다(가격 · 셸 변수) — 거기서 글이 수식으로 둔갑하지 않게 끈다.
 */
export interface MdOptions {
  frontmatter?: boolean;
  math?: boolean;
}

/** 문서 보기 타일의 선택 — 읽기 보기 · 편집 중 미리 보기 · 줄↔절(`sectionLines`)이 **같은 것**을 써야 짝이 맞는다 */
export const DOC_TILE_MD: Readonly<MdOptions> = { frontmatter: true, math: true };

/** 글 → 블록들 */
export function parseMarkdown(src: string, opts: MdOptions = {}): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const fm = opts.frontmatter ? takeFrontmatter(lines) : null;
  const footnotes: FootnoteCtx = { defs: takeFootnoteDefs(lines), order: [] };
  const math = !!opts.math;
  const ctx: InlineCtx = { refs: takeRefDefs(lines), footnotes, math };
  const blocks = parseLines(
    lines,
    lines.map((_, k) => k),
    0,
    (s) => parseInline(s, ctx),
    math,
  );
  if (fm) blocks.unshift(fm);
  const fns = footnoteBlock(footnotes, ctx);
  if (fns) blocks.push(fns);
  return blocks;
}

/**
 * 참조된 각주들 → 글 끝 블록(없으면 `null`). 각주 글도 인라인 파싱하는데, 그 안의 참조가 **새 각주**를 부를 수 있어
 * 목록이 도는 동안 자란다(번호는 계속 이어진다 — GitHub 와 같다). 참조 수는 다 돈 뒤에 읽는다.
 */
function footnoteBlock(fn: FootnoteCtx, ctx: InlineCtx): MdBlock | null {
  if (fn.order.length === 0) return null;
  const inlines: MdInline[][] = [];
  for (let k = 0; k < fn.order.length; k++) inlines.push(parseInline(fn.defs.get(fn.order[k].id) ?? "", ctx));
  return {
    kind: "footnotes",
    items: fn.order.map((e, k) => ({ n: k + 1, id: e.id, inlines: inlines[k], refs: e.refs })),
  };
}

/** 머리말 여는 줄 → 형식 · 닫을 수 있는 줄 */
const FM_OPEN: Readonly<Record<string, { format: "yaml" | "toml"; close: RegExp }>> = {
  "---": { format: "yaml", close: /^(?:---|\.\.\.)[ \t]*$/ },
  "+++": { format: "toml", close: /^\+\+\+[ \t]*$/ },
};

/** 최상위 키 줄 — YAML `키: 값`(콜론 뒤는 공백이나 줄 끝) · TOML `키 = 값`. 따옴표 키도 된다. 값은 `m[2]` */
const FM_KEY_YAML = /^("[^"]*"|'[^']*'|[^\s#:\-?[\]{},&*!|>'"%@`][^:#]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const FM_KEY_TOML = /^("[^"]*"|[A-Za-z0-9_.-]+)[ \t]*=[ \t]*(.*?)[ \t]*$/;

/** 값의 양끝 따옴표 한 겹을 뗀다(짝이 맞을 때만) */
const unquote = (v: string) => (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v);

/**
 * 글 **맨 첫 줄**이 `---`(또는 `+++`)이고 뒤에 닫는 줄(`---` · `...` / `+++`)이 있으면 그 사이를 머리말 블록으로 떼고 그
 * 줄들을 **빈 줄로 지운다**(줄 번호는 그대로 — 체크박스 · 제목 줄이 원문 기준으로 남는다). 맨 앞이 아니거나 닫지 않았으면
 * `null` 이고 글은 그대로다(가로줄 · 밑줄식 제목). 맨 앞의 BOM 은 건너뛴다.
 *
 * 항목은 얕게만 본다 — 최상위 줄이 전부 `키: 값`(값이 있고 `|` · `>` 여러 줄 표식이 아닌 것) · 빈 줄 · `#` 주석일 때만
 * `entries` 를 싣는다. 들여 쓴 줄 · `- 목록` · 값 없는 `키:`(밑에 중첩) · TOML `[표]` 가 하나라도 있으면 원문만.
 * [`parseMarkdown`] 과 [`headingLines`] 가 같이 쓴다 — 머리말 속 `# …` 줄이 어느 쪽에서도 제목이 되지 않는다.
 */
function takeFrontmatter(lines: string[]): MdBlock | null {
  const first = (lines[0] ?? "").replace(/^﻿/, "").trimEnd();
  const open = FM_OPEN[first];
  if (!open) return null;
  let end = -1;
  for (let k = 1; k < lines.length; k++) {
    if (open.close.test(lines[k])) {
      end = k;
      break;
    }
  }
  if (end < 0) return null;
  const body = lines.slice(1, end);
  const keyRe = open.format === "yaml" ? FM_KEY_YAML : FM_KEY_TOML;
  let count = 0;
  let simple = true;
  const entries: { key: string; value: string }[] = [];
  for (const l of body) {
    if (isBlank(l) || /^[ \t]*#/.test(l)) continue;
    const m = /^[ \t]/.test(l) ? null : keyRe.exec(l);
    if (!m) {
      simple = false;
      continue;
    }
    count++;
    const value = m[2] ?? "";
    if (value === "" || /^[|>][+-]?\d*$/.test(value)) simple = false;
    else entries.push({ key: unquote(m[1].trim()), value: unquote(value) });
  }
  for (let k = 0; k <= end; k++) lines[k] = "";
  const text = body.join("\n");
  return simple
    ? { kind: "frontmatter", format: open.format, text, count, entries }
    : { kind: "frontmatter", format: open.format, text, count };
}

/** 각주 정의 줄 `[^id]: 글` — 이름에 공백 · 대괄호가 없다. 글은 비어도 된다(밑의 들여 쓴 줄에서 시작) */
const FN_DEF = /^ {0,3}\[\^([^\]\s[]+)\]:[ \t]*(.*)$/;

/** 울타리(`fence` — 여는 표식)를 닫는 줄인가 — 같은 글자로 같은 길이 이상, 뒤에 아무것도 없다(`parseLines` 의 규칙과 같다) */
function closesFence(line: string, fence: string): boolean {
  const t = line.trim();
  return t.startsWith(fence) && t.split("").every((c) => c === fence[0]);
}

/**
 * **흘러오는 글의 열린 울타리를 떼어 낸다**(사이드 채팅 v2 — 모델 글이 조각으로 자라는 동안). 글 끝까지 닫히지 않은 울타리 코드 블록이
 * 있으면 `open` = 그 여는 줄부터 끝까지, `done` = 그 앞이다. 없으면 `{ done: 글, open: null }`.
 *
 * 그리는 쪽은 `done` 만 다이어그램(```mermaid)으로 그리고 `open` 은 여느 코드 블록으로 둔다 — 닫히지 않은 mermaid 를 조각마다 다시
 * 그리지 않게(그리는 중의 반쪽 글은 거의 늘 문법 오류다). 판정은 [`parseLines`] 와 같은 여는 줄(`FENCE`) · 닫는 줄([`closesFence`])
 * 규칙이고, 맨 위 단계만 본다(인용 `>` 속 울타리는 열린 채로 세지 않는다 — 그쪽은 다이어그램이 되지 않는 드문 경우다).
 */
export function splitOpenFence(text: string): { done: string; open: string | null } {
  let fence: string | null = null;
  let start = 0;
  let off = 0;
  for (const line of text.split("\n")) {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
    } else {
      const f = FENCE.exec(line);
      if (f) {
        fence = f[1];
        start = off;
      }
    }
    off += line.length + 1;
  }
  return fence === null ? { done: text, open: null } : { done: text.slice(0, start), open: text.slice(start) };
}

/**
 * 각주 정의를 **모으고 지운다**(빈 줄로 — 참조 링크 정의처럼 본문에 서지 않는다). 정의 줄 바로 밑의 **들여 쓴 줄들**(공백
 * 둘 이상 · 탭)은 같은 각주의 이어짐이다(줄바꿈으로 잇는다). 빈 줄을 건넌 둘째 문단 · 목록 같은 블록은 받지 않는다 —
 * 단순하게, 각주는 한 덩어리 글이다(빈 줄 뒤 들여 쓴 줄은 본문 문단으로 남아 잃지 않는다). 울타리 코드 안 · 인용(`>`)
 * 속은 보지 않는다. 같은 이름이 둘이면 먼저 적힌 것이 이기고 뒤의 것도 지운다(참조 링크 정의와 같다).
 * [`parseMarkdown`] 과 [`headingLines`] 가 같이 부른다 — 이어짐 줄의 `# …` 가 어느 쪽에서도 제목이 되지 않는다.
 */
function takeFootnoteDefs(lines: string[]): Map<string, string> {
  const defs = new Map<string, string>();
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = f[1];
      continue;
    }
    const m = FN_DEF.exec(line);
    if (!m) continue;
    const body = m[2].trim() === "" ? [] : [m[2].trim()];
    let k = i + 1;
    while (k < lines.length && !isBlank(lines[k]) && /^(?: {2,}|\t)/.test(lines[k])) body.push(lines[k++].trim());
    const id = refKey(m[1]);
    if (!defs.has(id)) defs.set(id, body.join("\n"));
    for (let j = i; j < k; j++) lines[j] = "";
    i = k - 1;
  }
  return defs;
}

/**
 * 참조 정의 줄을 **모으고 지운다**(빈 줄로 — 그래서 화면에 서지 않는다). 울타리 코드 블록 안은 보지 않는다.
 *
 * CommonMark 는 정의가 문단 한가운데를 끊지 못하게 하지만 여기서는 줄의 모양만 본다 — 정의처럼 생긴 줄이 문단
 * 중간에 오는 일은 드물고, 와도 잃는 것은 그 한 줄의 표시뿐이다(주소는 링크가 쓴다). 인용(`>`) 안의 정의는
 * 모으지 않는다(글자로 남는다).
 */
function takeRefDefs(lines: string[]): Map<string, string> {
  const refs = new Map<string, string>();
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = f[1];
      continue;
    }
    const m = REF_DEF.exec(line);
    if (!m) continue;
    const key = refKey(m[1]);
    if (key === "") continue;
    const href = m[2].startsWith("<") ? m[2].slice(1, -1) : m[2];
    if (!refs.has(key)) refs.set(key, href);
    lines[i] = "";
  }
  return refs;
}

/** 인라인 파서 — 참조 정의를 물고 있다 */
type Inl = (src: string) => MdInline[];

/** `at[i]` 는 `lines[i]` 의 원문 줄 번호다 — 인용 속으로 내려가도 원문 기준([`scanHeadings`] 와 같은 셈) */
function parseLines(lines: string[], at: number[], depth: number, inl: Inl, math = false): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (t.startsWith(mark[0].repeat(mark.length)) && t.replace(new RegExp(`^\\${mark[0]}+`), "").trim() === "") {
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      const lang = fence[2] ?? "";
      // ```math 는 수식 블록(`math` 선택일 때만 — 끄면 여느 코드 블록)
      out.push(math && lang.toLowerCase() === "math" ? { kind: "math", text: body.join("\n") } : { kind: "code", lang, text: body.join("\n") });
      continue;
    }
    // 수식 블록 `$$` … `$$` — 울타리 다음(울타리 안의 `$$` 는 코드다). [`scanHeadings`] 도 같은 자리에서 건너뛴다
    const mb = math ? mathBlockAt(lines, i) : null;
    if (mb) {
      out.push({ kind: "math", text: mb.text });
      i = mb.end;
      continue;
    }
    // 표는 가로줄보다 먼저 — `|---|---|` 가 구분 줄이다
    const align = tableAt(lines, i);
    if (align) {
      const start = i;
      const header = splitRow(lines[i]);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|") && !FENCE.test(lines[i])) rows.push(splitRow(lines[i++]));
      // 칸이 넘치는 줄이 있으면 자르지 않고(잃는다) 원문 그대로
      if (rows.some((r) => r.length > header.length)) {
        out.push({ kind: "pre", text: lines.slice(start, i).map((l) => l.trim()).join("\n") });
        continue;
      }
      out.push({
        kind: "table",
        align,
        header: header.map(inl),
        rows: rows.map((r) => header.map((_, k) => inl(r[k] ?? ""))),
      });
      continue;
    }
    if (HR.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }
    const h = HEADING.exec(line) ?? HEADING_EMPTY.exec(line);
    if (h) {
      out.push({ kind: "h", level: h[1].length, inlines: inl(h[2] ?? "") });
      i++;
      continue;
    }
    if (TABLE.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && TABLE.test(lines[i])) rows.push(lines[i++].trim());
      out.push({ kind: "pre", text: rows.join("\n") });
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      const bodyAt: number[] = [];
      while (i < lines.length && !isBlank(lines[i]) && QUOTE.test(lines[i])) {
        bodyAt.push(at[i]);
        body.push(QUOTE.exec(lines[i++])![1]);
      }
      const alert = alertOf(body, depth);
      if (alert) {
        out.push({ kind: "alert", type: alert, blocks: parseLines(body.slice(1), bodyAt.slice(1), depth + 1, inl, math) });
        continue;
      }
      const blocks =
        depth < MAX_QUOTE_DEPTH
          ? parseLines(body, bodyAt, depth + 1, inl, math)
          : [{ kind: "p", inlines: inl(body.join("\n")) } as MdBlock];
      out.push({ kind: "quote", blocks });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2][0]);
      const start = ordered ? parseInt(li[2], 10) : 1;
      const items: { depth: number; text: string; line: number }[] = [];
      while (i < lines.length) {
        const m = LIST.exec(lines[i]);
        if (m && !HR.test(lines[i])) {
          items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, "  ").length / 2)), text: m[3], line: at[i] });
          i++;
          continue;
        }
        // 들여 쓴 이어짐 줄은 앞 항목에 붙는다
        if (!isBlank(lines[i]) && /^\s+/.test(lines[i]) && items.length > 0) {
          items[items.length - 1].text += "\n" + lines[i].trim();
          i++;
          continue;
        }
        break;
      }
      out.push({ kind: "list", ordered, start, items: items.map((x) => listItem(x, inl)) });
      continue;
    }
    // 문단 — 다른 블록이 시작하는 줄이나 빈 줄까지. 바로 밑이 `===`/`---` 면 밑줄식 제목
    const body: string[] = [];
    let setext = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (body.length > 0) {
        const s = SETEXT.exec(l);
        if (s) {
          setext = s[1][0] === "=" ? 1 : 2;
          i++;
          break;
        }
        if (isBlank(l) || FENCE.test(l) || HEADING.test(l) || HR.test(l) || TABLE.test(l) || QUOTE.test(l) || LIST.test(l) || tableAt(lines, i) || (math && mathBlockAt(lines, i) !== null)) break;
      }
      body.push(l);
      i++;
    }
    const inlines = inl(setext ? body.map((l) => l.trim()).join("\n") : body.join("\n"));
    out.push(setext ? { kind: "h", level: setext, inlines } : { kind: "p", inlines });
  }
  return out;
}

function listItem(x: { depth: number; text: string; line: number }, inl: Inl): MdListItem {
  const task = TASK.exec(x.text);
  if (task) return { depth: x.depth, inlines: inl(task[2] ?? ""), checked: task[1] !== " ", line: x.line };
  return { depth: x.depth, inlines: inl(x.text) };
}

/**
 * **제목 블록이 원문 몇째 줄에서 시작하나** — [`parseMarkdown`] 이 만드는 `h` 블록과 **같은 순서**(인용 · 알림 속은 그 자리에서
 * 안으로 — `headingSlugs` 가 훑는 순서)의 0 기준 줄 번호. `quoted` 는 인용 · 알림 속 제목이다. 밑줄식 제목은 글 첫 줄이 자리다.
 *
 * 편집 중 미리 보기의 스크롤 맞추기(`doc-edit-preview.ts`)가 "커서 줄 → 절" 을 잇는 데 쓴다. 블록에 줄 번호를 싣지 않고
 * 따로 훑는 것은 파서의 모양(블록 타입)을 그대로 두려는 것이다 — 그래서 아래 갈래는 [`parseLines`] 의 갈래를 **그대로**
 * 따른다(울타리 · 표 · 가로줄 · 제목 · 파이프 줄 · 인용 · 목록 · 문단/밑줄식). **한쪽을 바꾸면 다른 쪽도 바꾼다** —
 * 어긋나면 짝짓기가 개수 비교에서 걸려 맞추기가 조용히 쉰다(잘못된 절로 가지는 않는다).
 */
export function headingLines(src: string, opts: MdOptions = {}): { line: number; quoted: boolean }[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  // 머리말 속 `# …` 줄은 제목이 아니다 — 파서와 같이 먼저 지운다(같은 선택을 넘겨야 둘이 맞는다)
  if (opts.frontmatter) takeFrontmatter(lines);
  // 각주 · 참조 정의 줄도 파서와 같은 순서로 지운다(각주의 들여 쓴 이어짐 줄이 제목이 되지 않게)
  takeFootnoteDefs(lines);
  takeRefDefs(lines);
  const out: { line: number; quoted: boolean }[] = [];
  // 수식 블록(`$$` … `$$`) 속 `# …` 도 제목이 아니다 — 같은 `math` 선택이어야 파서와 맞는다
  scanHeadings(
    lines,
    lines.map((_, k) => k),
    0,
    out,
    !!opts.math,
  );
  return out;
}

function scanHeadings(lines: string[], at: number[], depth: number, out: { line: number; quoted: boolean }[], math = false): void {
  const quoted = depth > 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      i++;
      while (i < lines.length) {
        const t = lines[i].trim();
        i++;
        if (t.startsWith(mark[0].repeat(mark.length)) && t.replace(new RegExp(`^\\${mark[0]}+`), "").trim() === "") break;
      }
      continue;
    }
    const mb = math ? mathBlockAt(lines, i) : null;
    if (mb) {
      i = mb.end;
      continue;
    }
    if (tableAt(lines, i)) {
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|") && !FENCE.test(lines[i])) i++;
      continue;
    }
    if (HR.test(line)) {
      i++;
      continue;
    }
    if (HEADING.test(line) || HEADING_EMPTY.test(line)) {
      out.push({ line: at[i], quoted });
      i++;
      continue;
    }
    if (TABLE.test(line)) {
      while (i < lines.length && TABLE.test(lines[i])) i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      const bodyAt: number[] = [];
      while (i < lines.length && !isBlank(lines[i]) && QUOTE.test(lines[i])) {
        bodyAt.push(at[i]);
        body.push(QUOTE.exec(lines[i++])![1]);
      }
      // 알림이면 표식 줄을 뺀 나머지가 본문이다(파서와 같이 — 표식 줄 밑 `===` 가 밑줄식 제목이 되지 않는다).
      // 알림 속 제목도 인용 속 제목과 같이 `quoted` — 목차 · 절에 들지 않는다
      if (alertOf(body, depth)) scanHeadings(body.slice(1), bodyAt.slice(1), depth + 1, out, math);
      // 깊이 상한을 넘은 인용은 파서가 한 문단으로 접는다 — 제목이 없다
      else if (depth < MAX_QUOTE_DEPTH) scanHeadings(body, bodyAt, depth + 1, out, math);
      continue;
    }
    if (LIST.test(line)) {
      let any = false;
      while (i < lines.length) {
        if (LIST.test(lines[i]) && !HR.test(lines[i])) {
          any = true;
          i++;
          continue;
        }
        if (!isBlank(lines[i]) && /^\s+/.test(lines[i]) && any) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }
    const start = i;
    let n = 0;
    let setext = false;
    while (i < lines.length) {
      const l = lines[i];
      if (n > 0) {
        if (SETEXT.test(l)) {
          setext = true;
          i++;
          break;
        }
        if (isBlank(l) || FENCE.test(l) || HEADING.test(l) || HR.test(l) || TABLE.test(l) || QUOTE.test(l) || LIST.test(l) || tableAt(lines, i) || (math && mathBlockAt(lines, i) !== null)) break;
      }
      n++;
      i++;
    }
    if (setext) out.push({ line: at[start], quoted });
  }
}
