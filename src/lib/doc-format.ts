/**
 * **마크다운 서식 — 순수 층** (2026-10-25 — 문서 타일 편집 중 우클릭 [서식 ▸]). 글 · 선택을 받아 **바꿀 한 덩어리**(범위 · 넣을 글)와 그 뒤의
 * 선택을 돌려준다. 편집기(`doc-editor-cm.ts` 의 `format`)가 그 한 덩어리를 한 번에 넣어 되돌리기 한 번이면 돌아온다.
 *
 * - **감싸기**(굵게 · 기울임 · 취소선 · 인라인 코드) — 고른 글을 표지로 감싼다. 이미 감싸여 있으면(고른 글 안쪽 끝 · 바로 바깥) 벗긴다.
 *   고른 글이 없으면 표지 둘 사이에 커서를 둔다.
 * - **링크** — `[고른 글](url)` 을 넣고 `url` 을 골라 둔다(바로 주소를 치게). 고른 글이 없으면 `[]` 안에 커서.
 * - **줄 서식**(제목 1–3 · 글머리 목록 · 번호 목록 · 체크 목록 · 인용) — 선택이 걸친 줄 전부. 모든 (빈 줄이 아닌) 줄이 이미 그 서식이면 걷고,
 *   아니면 붙인다(목록끼리는 갈아 끼운다 — 글머리 ↔ 번호 ↔ 체크). 제목은 첫 줄의 단계가 같으면 걷고 아니면 그 단계로 바꾼다.
 * - **코드 블록** — 고른 글을 ```` ``` ```` 두 줄로 감싼다(줄 머리에서 시작하지 않으면 앞에 줄바꿈 하나).
 *
 * 줄 끝은 `\n` 하나로 본다 — 편집기 안의 글(`state.doc.toString()`)이 그렇다. 원문의 줄 끝은 넣을 때 편집기가 맞춘다.
 */

export type DocFormat =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "codeblock";

/** 바꿀 한 덩어리 — `[from, to)` 를 `insert` 로, 그 뒤 선택은 `anchor` → `head` */
export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

const WRAP: Partial<Record<DocFormat, string>> = { bold: "**", italic: "*", strike: "~~", code: "`" };

/** 줄 머리의 목록 표지(들여쓰기 뒤) — 글머리(`-` `*` `+`, 체크 `[ ]` 포함) · 번호(`1.` `1)`) */
const LIST_RE = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const HEADING_RE = /^#{1,6}\s+/;
const QUOTE_RE = /^(\s*)>\s?/;

/** 그 서식이 이 줄에 이미 붙어 있나 */
function hasLineFormat(line: string, kind: DocFormat): boolean {
  switch (kind) {
    case "bullet":
      return /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(line);
    case "task":
      return /^\s*[-*+]\s+\[[ xX]\]\s/.test(line);
    case "ordered":
      return /^\s*\d+[.)]\s+/.test(line);
    case "quote":
      return QUOTE_RE.test(line);
    default:
      return false;
  }
}

/** 줄 하나에 목록 · 인용 서식을 붙인다(`n` = 번호 목록의 번호) */
function addLineFormat(line: string, kind: DocFormat, n: number): string {
  if (kind === "quote") return `> ${line}`;
  const m = LIST_RE.exec(line);
  const indent = m ? m[1] : (/^\s*/.exec(line)?.[0] ?? "");
  const body = m ? line.slice(m[0].length) : line.slice(indent.length);
  const mark = kind === "ordered" ? `${n}. ` : kind === "task" ? "- [ ] " : "- ";
  return `${indent}${mark}${body}`;
}

/** 줄 하나에서 그 서식을 걷는다 */
function removeLineFormat(line: string, kind: DocFormat): string {
  if (kind === "quote") return line.replace(QUOTE_RE, "$1");
  const m = LIST_RE.exec(line);
  return m ? m[1] + line.slice(m[0].length) : line;
}

function wrapEdit(doc: string, a: number, b: number, mark: string): FormatEdit {
  const sel = doc.slice(a, b);
  const m = mark.length;
  // 고른 글이 표지까지 품었다 — 벗긴다
  if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(m, sel.length - m);
    return { from: a, to: b, insert: inner, anchor: a, head: a + inner.length };
  }
  // 고른 글 바로 바깥이 표지다 — 벗긴다
  if (a >= m && doc.slice(a - m, a) === mark && doc.slice(b, b + m) === mark) {
    return { from: a - m, to: b + m, insert: sel, anchor: a - m, head: a - m + sel.length };
  }
  return { from: a, to: b, insert: `${mark}${sel}${mark}`, anchor: a + m, head: a + m + sel.length };
}

function linkEdit(a: number, b: number, sel: string): FormatEdit {
  if (sel === "") return { from: a, to: b, insert: "[](url)", anchor: a + 1, head: a + 1 };
  const urlAt = a + sel.length + 3; // `[` + 글 + `](`
  return { from: a, to: b, insert: `[${sel}](url)`, anchor: urlAt, head: urlAt + 3 };
}

function codeBlockEdit(doc: string, a: number, b: number): FormatEdit {
  const sel = doc.slice(a, b);
  const lead = a === 0 || doc[a - 1] === "\n" ? "" : "\n";
  const body = sel === "" || sel.endsWith("\n") ? sel : `${sel}\n`;
  const insert = `${lead}\`\`\`\n${body}\`\`\``;
  const start = a + lead.length + 4; // 여는 줄 뒤
  return sel === ""
    ? { from: a, to: b, insert: `${lead}\`\`\`\n\n\`\`\``, anchor: start, head: start }
    : { from: a, to: b, insert, anchor: start, head: start + sel.length };
}

/** 선택이 걸친 줄들의 범위 — 끝이 줄 머리에 딱 걸렸으면(줄 여럿을 끝까지 골랐다) 그 줄은 빼지 않는다: 선택이 비지 않는 한 앞 줄까지 */
function lineSpan(doc: string, a: number, b: number): { start: number; end: number } {
  const start = doc.lastIndexOf("\n", a - 1) + 1;
  const last = b > a && doc[b - 1] === "\n" ? b - 1 : b;
  const nl = doc.indexOf("\n", last);
  return { start, end: nl < 0 ? doc.length : nl };
}

function lineEdit(doc: string, a: number, b: number, kind: DocFormat): FormatEdit {
  const { start, end } = lineSpan(doc, a, b);
  const lines = doc.slice(start, end).split("\n");
  let out: string[];
  if (kind === "h1" || kind === "h2" || kind === "h3") {
    const level = Number(kind[1]);
    const first = /^(#{1,6})\s+/.exec(lines[0] ?? "");
    const off = first !== null && first[1].length === level;
    out = lines.map((l) => {
      const bare = l.replace(HEADING_RE, "");
      return off || bare.trim() === "" ? bare : `${"#".repeat(level)} ${bare}`;
    });
  } else {
    const filled = lines.filter((l) => l.trim() !== "");
    const off = filled.length > 0 && filled.every((l) => hasLineFormat(l, kind));
    let n = 0;
    out = lines.map((l) => {
      if (l.trim() === "") return l;
      n += 1;
      return off ? removeLineFormat(l, kind) : addLineFormat(l, kind, n);
    });
  }
  const insert = out.join("\n");
  // 빈 선택이면 커서를 그 줄 끝으로, 아니면 바뀐 줄 전부를 고른다
  return a === b
    ? { from: start, to: end, insert, anchor: start + insert.length, head: start + insert.length }
    : { from: start, to: end, insert, anchor: start, head: start + insert.length };
}

/** 그 서식을 지금 선택(`from` · `to` — 순서 무관)에 건다 */
export function docFormatEdit(doc: string, from: number, to: number, kind: DocFormat): FormatEdit {
  const a = Math.max(0, Math.min(from, to, doc.length));
  const b = Math.min(doc.length, Math.max(from, to));
  const mark = WRAP[kind];
  if (mark !== undefined) return wrapEdit(doc, a, b, mark);
  if (kind === "link") return linkEdit(a, b, doc.slice(a, b));
  if (kind === "codeblock") return codeBlockEdit(doc, a, b);
  return lineEdit(doc, a, b, kind);
}
