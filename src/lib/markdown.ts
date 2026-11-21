/**
 * 마크다운의 순수 층 — 글을 블록 · 인라인 토막 목록으로만 나눈다. HTML 은 만들지 않는다.
 * 화면(`MarkdownBlocks.svelte`)은 글자 보간으로 그려 본문이 `{@html}` 로 가는 길이 없다(예외 — mermaid SVG · KaTeX, 근거는 `MarkdownBlocks` 머리말).
 * 링크를 여는 것은 `http`/`https` 만([`isWebUrl`]) · 그림을 불러오는 것은 문서 보기 타일뿐이다(`doc-images.ts`).
 * 모르는 문법은 글자로 떨어진다 — 잃는 것이 없다.
 */

/** `link.href` 는 적힌 그대로다 — 열지 말지는 화면이 [`isWebUrl`] 로 가린다 */
export type MdInline =
  | { kind: "text" | "code"; text: string }
  /** `text` 는 늘 평문, `inlines` 는 안쪽에 표식이 있을 때만 — 그리는 쪽은 `inlines` 가 있으면 그것을 그린다 */
  | { kind: "strong" | "em" | "del"; text: string; inlines?: MdInline[] }
  /** `source` 는 파서가 달지 않는다 — 대화 면의 `md-source-chips.ts` 만. 그때 `text` 는 칩 툴팁의 이름표 */
  | { kind: "link"; text: string; href: string; image?: true; source?: true }
  | { kind: "image"; text: string; href: string }
  /** `n` 은 처음 참조된 순서 · `occ` 는 같은 각주의 몇째 참조(↩ 가 돌아갈 자리) */
  | { kind: "fnref"; text: string; id: string; n: number; occ: number }
  | { kind: "math"; text: string };

export type MdAlign = "left" | "center" | "right" | null;

export type MdAlertType = "note" | "tip" | "important" | "warning" | "caution";

export type MdListItem = {
  depth: number;
  inlines: MdInline[];
  checked?: boolean;
  /** 원문 줄(0 기준 · 인용 속도 원문 기준) — 문서 타일이 누른 체크박스를 파일에 되쓰는 자리다 */
  line?: number;
};

export type MdFootnote = { n: number; id: string; inlines: MdInline[]; refs: number };

export type MdBlock =
  | { kind: "p"; inlines: MdInline[] }
  | { kind: "h"; level: number; inlines: MdInline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: MdListItem[] }
  | { kind: "quote"; blocks: MdBlock[] }
  | { kind: "alert"; type: MdAlertType; blocks: MdBlock[] }
  | { kind: "table"; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] }
  /** 표처럼 생겼지만 격자로 못 읽은 줄들 */
  | { kind: "pre"; text: string }
  /** `entries` 는 안쪽이 전부 단순한 `키: 값` 일 때만 — YAML 을 해석하지 않는다 */
  | { kind: "frontmatter"; format: "yaml" | "toml"; text: string; count: number; entries?: { key: string; value: string }[] }
  /** 글 맨 끝에 하나 — 참조 없는 정의는 싣지 않는다(GitHub 와 같다) */
  | { kind: "footnotes"; items: MdFootnote[] }
  | { kind: "math"; text: string }
  | { kind: "hr" };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HEADING_EMPTY = /^\s{0,3}(#{1,6})\s*$/;
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE = /^\s*\|/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const TASK = /^\[([ xX])\](?:\s+(.*))?$/s;
const SEP_CELL = /^\s*(:?)-+(:?)\s*$/;

const ALERT = /^\s*\[!(note|tip|important|warning|caution)\]\s*$/i;

/** 최상위 인용만 알림이다(GitHub 와 같다). [`parseLines`] 와 [`scanHeadings`] 가 같이 쓴다 — 판정은 여기 하나 */
function alertOf(body: string[], depth: number): MdAlertType | null {
  if (depth !== 0 || body.length < 2) return null;
  const m = ALERT.exec(body[0]);
  if (!m || body.slice(1).every(isBlank)) return null;
  return m[1].toLowerCase() as MdAlertType;
}

const MAX_QUOTE_DEPTH = 8;

/** 역슬래시 자신은 뺀다 — `\\server\share` 를 지킨다 */
const ESCAPABLE = new Set("`*_[]()#!<>|{}+-.~\"'$");

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isPunct = (c: string | undefined) => c !== undefined && /[\p{P}\p{S}]/u.test(c);

/** 호스트는 적힌 글자 그대로 잘라 낸다 — `URL` 은 국제화 도메인을 퓨니코드(`xn--…`)로 바꿔 버린다 */
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

/** 열지 말지의 유일한 판정 — `http:` · `https:` 둘만(터미널의 OSC 8 과 같은 규칙) */
export function isWebUrl(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function closeBracket(src: string, i: number): number {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "`") {
      const j = src.indexOf("`", k + 1);
      if (j > 0) k = j;
      continue;
    }
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return k;
  }
  return -1;
}

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

const IMAGE_ONLY = /^!\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])$/;

/** 이름([`refKey`]) → 주소. 같은 이름이 둘이면 먼저 적힌 것이 이긴다(CommonMark 와 같다) */
export type MdRefs = ReadonlyMap<string, string>;

const REF_DEF = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(<[^>]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;

export function refKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 정의가 있을 때만 링크다 — `[x]` 같은 흔한 대괄호 글이 링크로 둔갑하지 않게 */
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

function bareUrlEnd(src: string, i: number): number {
  let k = i;
  while (k < src.length && !/[\s<>"`]/.test(src[k])) k++;
  while (k > i && /[.,;:!?'*_)\]]/.test(src[k - 1])) {
    // 짝이 맞는 닫는 괄호는 주소의 일부다(위키 주소 `…_(disambiguation)`)
    if (src[k - 1] === ")" && count(src.slice(i, k), "(") >= count(src.slice(i, k), ")")) break;
    k--;
  }
  return k;
}

const count = (s: string, c: string) => s.split(c).length - 1;

/** 밑줄(`_` · `__`)은 낱말 경계에서만 표식이다 — `snake_case_name` 은 글자로 남는다 */
export function parseInline(src: string, ctx: InlineCtx = {}): MdInline[] {
  return inlineAt(src, ctx, 0);
}

/** 병적 입력 보호 — 그 아래는 안쪽을 평문으로 둔다 */
const MAX_INLINE_DEPTH = 4;

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
    // 인라인 코드 다음이어야 한다. 못 읽은 `$` 줄기는 통째로 글자 — 둘째 `$` 가 여는 짝이 되지 않게
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
    if (c === "<") {
      const m = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i, i + 2048));
      if (m) {
        flush();
        out.push({ kind: "link", text: m[1], href: m[1] });
        i += m[0].length;
        continue;
      }
    }
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
      // `**/*.ts 와 **/*.js` 는 글자 — 여는 짝 뒤 · 닫는 짝 앞은 공백이 아니다
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
      // 여는 짝 바로 뒤가 문장 부호면 앞은 공백·줄 처음이어야 한다(`src/*.ts` 는 글자) — CommonMark 보다 조금 좁다
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

function findEmClose(src: string, from: number, c: string): number {
  for (let j = src.indexOf(c, from); j >= 0; j = src.indexOf(c, j + 1)) {
    if (isSpace(src[j - 1]) || src[j - 1] === c) continue;
    if (src[j + 1] === c) {
      j++;
      continue;
    }
    if (c === "_" && isWordChar(src[j + 1])) continue;
    return j;
  }
  return -1;
}

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
 * GitHub 규칙보다 보수적이다 — 가격 · 셸 변수가 수식으로 둔갑하는 것이 수식 하나를 놓치는 것보다 나쁘다.
 * 닫는 `$` 뒤에 글자도 붙지 않는다(GitHub 은 숫자만) — `$5 and $10` · `$HOME/$USER` · `US$5` 는 글자다.
 */
function inlineMathAt(src: string, i: number): { text: string; end: number } | null {
  if (src[i + 1] === "`") {
    let n = 0;
    while (src[i + 1 + n] === "`") n++;
    const fence = "`".repeat(n);
    for (let j = src.indexOf(fence, i + 1 + n); j >= 0; j = src.indexOf(fence, j + 1)) {
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
      while (src[k + 1] === "$") k++;
      continue;
    }
    if (isSpace(src[k - 1]) || isWordChar(src[k + 1])) continue;
    return { text: src.slice(i + 1, k), end: k + 1 };
  }
  return null;
}

const MATH_FENCE = /^\s{0,3}\$\$\s*$/;
const MATH_ONE_LINE = /^\s{0,3}\$\$(.*\S.*)\$\$\s*$/;

/**
 * [`parseLines`] 와 [`scanHeadings`] 가 같이 쓴다 — 블록 속 `# …` 가 어느 쪽에서도 제목이 되지 않게.
 * 알고 받은 한계: 참조 · 각주 정의 거두기는 이 블록을 몰라 블록 속 `[x]: y` 꼴 줄은 정의로 먼저 거둬진다(TeX 에서 드물다).
 */
function mathBlockAt(lines: string[], i: number): { text: string; end: number } | null {
  const one = MATH_ONE_LINE.exec(lines[i]);
  // `$$a$$ 와 $$b$$` 는 블록이 아니다
  if (one) return one[1].includes("$$") ? null : { text: one[1].trim(), end: i + 1 };
  if (!MATH_FENCE.test(lines[i])) return null;
  const body: string[] = [];
  for (let k = i + 1; k < lines.length; k++) {
    const t = lines[k].trimEnd();
    if (t.endsWith("$$")) {
      const last = t.slice(0, -2);
      if (last.trim() !== "") body.push(last);
      const text = body.join("\n");
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

function tableAt(lines: string[], i: number): MdAlign[] | null {
  const head = lines[i];
  if (!head.includes("|") || i + 1 >= lines.length) return null;
  const align = separatorAligns(lines[i + 1]);
  if (!align) return null;
  // 파이프 없는 `---` 는 가로줄/밑줄식 제목이다
  if (!lines[i + 1].includes("|") && align.length < 2) return null;
  return splitRow(head).length === align.length ? align : null;
}

const isBlank = (l: string) => l.trim() === "";

/** 모든 토막 파싱에 같은 것을 넘긴다 — 각주 번호가 글 순서로 이어지게 */
export interface InlineCtx {
  refs?: MdRefs;
  footnotes?: FootnoteCtx;
  math?: boolean;
}

/** 번호는 `order` 의 자리 + 1 */
export interface FootnoteCtx {
  defs: ReadonlyMap<string, string>;
  order: { id: string; refs: number }[];
}

function footnoteRef(fn: FootnoteCtx, label: string): MdInline | null {
  const id = refKey(label);
  if (!fn.defs.has(id)) return null;
  let k = fn.order.findIndex((e) => e.id === id);
  if (k < 0) k = fn.order.push({ id, refs: 0 }) - 1;
  const e = fn.order[k];
  e.refs++;
  return { kind: "fnref", text: String(k + 1), id, n: k + 1, occ: e.refs };
}

/** 둘 다 문서 보기 타일만 켠다 — 에이전트 말에는 `$` 가 흔해(가격 · 셸 변수) 수식으로 둔갑하지 않게 끈다 */
export interface MdOptions {
  frontmatter?: boolean;
  math?: boolean;
}

/** 읽기 보기 · 편집 중 미리 보기 · 줄↔절(`sectionLines`)이 같은 것을 써야 짝이 맞는다 */
export const DOC_TILE_MD: Readonly<MdOptions> = { frontmatter: true, math: true };

export function parseMarkdown(src: string, opts: MdOptions = {}): MdBlock[] {
  return parseWithStarts(src, opts, null);
}

/** [`parseMarkdown`] 의 최상위 블록과 같은 순서 · 같은 길이의 0 기준 시작 줄 — 글 끝 각주 구역은 원문 자리가 없어 `null` */
export function blockStartLines(src: string, opts: MdOptions = {}): (number | null)[] {
  const starts: (number | null)[] = [];
  parseWithStarts(src, opts, starts);
  return starts;
}

function parseWithStarts(src: string, opts: MdOptions, starts: (number | null)[] | null): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const fm = opts.frontmatter ? takeFrontmatter(lines) : null;
  const footnotes: FootnoteCtx = { defs: takeFootnoteDefs(lines), order: [] };
  const math = !!opts.math;
  const ctx: InlineCtx = { refs: takeRefDefs(lines), footnotes, math };
  const top: number[] | undefined = starts ? [] : undefined;
  const blocks = parseLines(
    lines,
    lines.map((_, k) => k),
    0,
    (s) => parseInline(s, ctx),
    math,
    top,
  );
  if (fm) blocks.unshift(fm);
  const fns = footnoteBlock(footnotes, ctx);
  if (fns) blocks.push(fns);
  if (starts && top) {
    if (fm) starts.push(0);
    starts.push(...top);
    if (fns) starts.push(null);
  }
  return blocks;
}

/** 각주 글 속 참조가 새 각주를 불러 `order` 가 도는 동안 자란다 — 참조 수는 다 돈 뒤에 읽는다 */
function footnoteBlock(fn: FootnoteCtx, ctx: InlineCtx): MdBlock | null {
  if (fn.order.length === 0) return null;
  const inlines: MdInline[][] = [];
  for (let k = 0; k < fn.order.length; k++) inlines.push(parseInline(fn.defs.get(fn.order[k].id) ?? "", ctx));
  return {
    kind: "footnotes",
    items: fn.order.map((e, k) => ({ n: k + 1, id: e.id, inlines: inlines[k], refs: e.refs })),
  };
}

const FM_OPEN: Readonly<Record<string, { format: "yaml" | "toml"; close: RegExp }>> = {
  "---": { format: "yaml", close: /^(?:---|\.\.\.)[ \t]*$/ },
  "+++": { format: "toml", close: /^\+\+\+[ \t]*$/ },
};

const FM_KEY_YAML = /^("[^"]*"|'[^']*'|[^\s#:\-?[\]{},&*!|>'"%@`][^:#]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const FM_KEY_TOML = /^("[^"]*"|[A-Za-z0-9_.-]+)[ \t]*=[ \t]*(.*?)[ \t]*$/;

const unquote = (v: string) => (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0] ? v.slice(1, -1) : v);

/** 줄을 지우지 않고 빈 줄로 바꾼다 — 줄 번호가 원문 기준으로 남아야 체크박스 되쓰기 · 제목 줄이 맞는다 */
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

const FN_DEF = /^ {0,3}\[\^([^\]\s[]+)\]:[ \t]*(.*)$/;

/** `parseLines` 의 닫는 줄 규칙과 같아야 한다 */
function closesFence(line: string, fence: string): boolean {
  const t = line.trim();
  return t.startsWith(fence) && t.split("").every((c) => c === fence[0]);
}

/** 흘러오는 글의 닫히지 않은 울타리를 떼어 낸다 — 반쪽 mermaid 를 조각마다 다시 그리지 않게(거의 늘 문법 오류다). 맨 위 단계만 본다 */
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

/** 정의 줄을 빈 줄로 지운다. [`parseMarkdown`] 과 [`headingLines`] 가 같이 부른다 — 이어짐 줄의 `# …` 가 어느 쪽에서도 제목이 되지 않게 */
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

/** 알고 받은 차이: CommonMark 와 달리 줄 모양만 본다 — 문단 한가운데의 정의 꼴 줄도 거둬진다(잃는 것은 그 줄의 표시뿐) */
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

type Inl = (src: string) => MdInline[];

/**
 * `at[i]` 는 `lines[i]` 의 원문 줄 번호다(인용 속도 원문 기준). 갈래를 바꾸면 [`scanHeadings`] 도 같이 바꾼다.
 * `starts` 는 바퀴 머리에서 채운다 — 한 바퀴가 블록을 많아야 하나 내놓는 것에 기댄다
 */
function parseLines(lines: string[], at: number[], depth: number, inl: Inl, math = false, starts?: number[]): MdBlock[] {
  const out: MdBlock[] = [];
  let i = 0;
  let from = 0;
  while (i < lines.length) {
    if (starts) while (starts.length < out.length) starts.push(from);
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    from = at[i];
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
      out.push(math && lang.toLowerCase() === "math" ? { kind: "math", text: body.join("\n") } : { kind: "code", lang, text: body.join("\n") });
      continue;
    }
    // 울타리 다음이어야 한다 — 울타리 안의 `$$` 는 코드다
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
      // 칸이 넘치면 자르지 않는다(잃는다) — 원문 그대로
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
  if (starts) while (starts.length < out.length) starts.push(from);
  return out;
}

function listItem(x: { depth: number; text: string; line: number }, inl: Inl): MdListItem {
  const task = TASK.exec(x.text);
  if (task) return { depth: x.depth, inlines: inl(task[2] ?? ""), checked: task[1] !== " ", line: x.line };
  return { depth: x.depth, inlines: inl(x.text) };
}

/**
 * [`parseMarkdown`] 의 `h` 블록과 같은 순서(`headingSlugs` 가 훑는 순서)의 0 기준 줄 번호. 아래 갈래는 [`parseLines`] 를 그대로 따른다 —
 * 한쪽을 바꾸면 다른 쪽도 바꾼다. 어긋나면 미리 보기 스크롤 맞추기(`doc-edit-preview.ts`)가 개수 비교에서 걸려 조용히 쉰다.
 */
export function headingLines(src: string, opts: MdOptions = {}): { line: number; quoted: boolean }[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  // 파서와 같은 선택 · 같은 순서로 지워야 둘이 맞는다
  if (opts.frontmatter) takeFrontmatter(lines);
  takeFootnoteDefs(lines);
  takeRefDefs(lines);
  const out: { line: number; quoted: boolean }[] = [];
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
