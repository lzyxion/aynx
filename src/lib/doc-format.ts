/** 마크다운 서식 — 순수 층. 바꿀 한 덩어리를 돌려줘 되돌리기 한 번이면 돌아온다. 줄 끝은 `\n` 하나로 본다(`state.doc.toString()`). */

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

/** `[from, to)` 를 `insert` 로, 그 뒤 선택은 `anchor` → `head` */
export interface FormatEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

const WRAP: Partial<Record<DocFormat, string>> = { bold: "**", italic: "*", strike: "~~", code: "`" };

const LIST_RE = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const HEADING_RE = /^#{1,6}\s+/;
const QUOTE_RE = /^(\s*)>\s?/;

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

function addLineFormat(line: string, kind: DocFormat, n: number): string {
  if (kind === "quote") return `> ${line}`;
  const m = LIST_RE.exec(line);
  const indent = m ? m[1] : (/^\s*/.exec(line)?.[0] ?? "");
  const body = m ? line.slice(m[0].length) : line.slice(indent.length);
  const mark = kind === "ordered" ? `${n}. ` : kind === "task" ? "- [ ] " : "- ";
  return `${indent}${mark}${body}`;
}

function removeLineFormat(line: string, kind: DocFormat): string {
  if (kind === "quote") return line.replace(QUOTE_RE, "$1");
  const m = LIST_RE.exec(line);
  return m ? m[1] + line.slice(m[0].length) : line;
}

function wrapEdit(doc: string, a: number, b: number, mark: string): FormatEdit {
  const sel = doc.slice(a, b);
  const m = mark.length;
  if (sel.length >= 2 * m && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(m, sel.length - m);
    return { from: a, to: b, insert: inner, anchor: a, head: a + inner.length };
  }
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
  const start = a + lead.length + 4;
  return sel === ""
    ? { from: a, to: b, insert: `${lead}\`\`\`\n\n\`\`\``, anchor: start, head: start }
    : { from: a, to: b, insert, anchor: start, head: start + sel.length };
}

/** 끝이 줄 머리에 딱 걸렸으면(줄 여럿을 끝까지 골랐다) 그 줄은 넣지 않는다 */
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
  return a === b
    ? { from: start, to: end, insert, anchor: start + insert.length, head: start + insert.length }
    : { from: start, to: end, insert, anchor: start, head: start + insert.length };
}

export function docFormatEdit(doc: string, from: number, to: number, kind: DocFormat): FormatEdit {
  const a = Math.max(0, Math.min(from, to, doc.length));
  const b = Math.min(doc.length, Math.max(from, to));
  const mark = WRAP[kind];
  if (mark !== undefined) return wrapEdit(doc, a, b, mark);
  if (kind === "link") return linkEdit(a, b, doc.slice(a, b));
  if (kind === "codeblock") return codeBlockEdit(doc, a, b);
  return lineEdit(doc, a, b, kind);
}
