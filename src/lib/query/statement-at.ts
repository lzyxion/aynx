/**
 * **실행할 문장 고르기** — 쿼리 타일 편집기의 `Ctrl+Enter` 가 보낼 범위(쿼리 타일 6단계). **순수 함수**.
 *
 * 선택 영역이 있으면 그것을, 없으면 **커서가 놓인 문장**을 보낸다. 문장 경계는 서버 가드(`src-tauri/src/db/guard.rs` 의
 * `scan`)와 **같은 규칙의 렉서**로 찾는다 — 작은따옴표 · 큰따옴표 · 백틱 · SQLite `[식별자]` · `--` · `/* *\/`(PG 중첩) ·
 * MySQL `#` · PG `$tag$` · PG `E'…'` 를 알아보고, 그 밖(최상위)의 `;` 로 가른다.
 *
 * 여기는 **범위 고르기용**이다 — 최종 판정(문장 하나 · 읽기 전용 허용 목록)은 서버가 한다. 그래서 서버의 "백슬래시 두
 * 해석" 은 두지 않고 엔진의 기본 해석 하나(PG 표준 문자열 = 백슬래시 아님 · MySQL = 백슬래시 이스케이프)만 쓴다 — 어긋나도
 * 결과는 서버의 "한 번에 문장 하나만" 거절 한 줄이다.
 *
 * 커서가 문장 **사이**(공백 · 주석 · 빈 줄)에 있으면: 바로 앞 문장(끝 `;` 까지 포함한 자리에서 이어지는 빈자리면 그
 * 문장 — 쳐 놓고 곧바로 `Ctrl+Enter` 하는 손), 앞 문장이 없으면(맨 위) 다음 문장.
 */
import type { DbDialect } from "./query-backend";

/** 문장 하나 — `[start, end)` 는 첫 코드 글자부터 마지막 코드 글자 뒤까지(끝 `;` · 앞뒤 공백 · 바깥 주석 없음) */
export interface Statement {
  start: number;
  end: number;
  /** 이 문장을 닫은 `;` 뒤 자리 — 닫는 `;` 가 없으면(마지막 문장) `end` 와 같다 */
  close: number;
}

interface Lex {
  backslash: boolean;
  dqBackslash: boolean;
  dollar: boolean;
  eStrings: boolean;
  nested: boolean;
  hashComment: boolean;
  dashSpace: boolean;
  brackets: boolean;
  backtick: boolean;
}

function lexOf(d: DbDialect): Lex {
  switch (d) {
    case "sqlite":
      return { backslash: false, dqBackslash: false, dollar: false, eStrings: false, nested: false, hashComment: false, dashSpace: false, brackets: true, backtick: true };
    case "postgres":
      return { backslash: false, dqBackslash: false, dollar: true, eStrings: true, nested: true, hashComment: false, dashSpace: false, brackets: false, backtick: false };
    case "mysql":
      return { backslash: true, dqBackslash: true, dollar: false, eStrings: false, nested: false, hashComment: true, dashSpace: true, brackets: false, backtick: true };
  }
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isIdent = (c: string | undefined) => c !== undefined && (/[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) >= 0x80);
const isIdentStart = (c: string | undefined) => c !== undefined && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80);

/** `q` 로 감싼 리터럴의 끝(닫는 따옴표 뒤) — 겹친 `qq` 는 글자 하나. 안 닫히면 `null` */
function skipQuoted(s: string, open: number, q: string, backslash: boolean): number | null {
  let j = open + 1;
  while (j < s.length) {
    const c = s[j];
    if (backslash && c === "\\") {
      j += 2;
      continue;
    }
    if (c === q) {
      if (s[j + 1] === q) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return null;
}

/** PG `$tag$` 여는 표지의 끝(둘째 `$` 뒤) — 표지가 아니면 `null`. 태그는 비거나 숫자로 시작하지 않는 식별자 */
function dollarTag(s: string, i: number): number | null {
  let j = i + 1;
  if (/[0-9]/.test(s[j] ?? "")) return null;
  while (j < s.length && (/[A-Za-z0-9_]/.test(s[j]) || s.charCodeAt(j) >= 0x80)) j++;
  return s[j] === "$" ? j + 1 : null;
}

/** 글 전체를 문장으로 가른다 — 코드가 없는 문장(`;;` · 주석뿐)은 빠진다 */
export function splitStatements(sql: string, dialect: DbDialect): Statement[] {
  const o = lexOf(dialect);
  const n = sql.length;
  const out: Statement[] = [];
  let code: { s: number; e: number } | null = null;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    const next = sql[i + 1];
    const dash = c === "-" && next === "-" && (!o.dashSpace || i + 2 >= n || isSpace(sql[i + 2]) || sql.charCodeAt(i + 2) < 0x20);
    if (dash || (o.hashComment && c === "#")) {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n) {
        if (o.nested && sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
          continue;
        }
        if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
          continue;
        }
        j++;
      }
      i = Math.min(j, n);
      continue;
    }
    if (c === ";") {
      if (code) out.push({ start: code.s, end: code.e, close: i + 1 });
      code = null;
      i++;
      continue;
    }
    const prevIdent = i > 0 && isIdent(sql[i - 1]);
    let end: number | null;
    if (c === "'") end = skipQuoted(sql, i, "'", o.backslash);
    else if (o.eStrings && (c === "E" || c === "e") && next === "'" && !prevIdent) end = skipQuoted(sql, i + 1, "'", true);
    else if (c === '"') end = skipQuoted(sql, i, '"', o.dqBackslash);
    else if (o.backtick && c === "`") end = skipQuoted(sql, i, "`", false);
    else if (o.brackets && c === "[") {
      const p = sql.indexOf("]", i + 1);
      end = p < 0 ? null : p + 1;
    } else if (o.dollar && c === "$" && !prevIdent) {
      const openEnd = dollarTag(sql, i);
      if (openEnd === null) end = i + 1;
      else {
        const p = sql.indexOf(sql.slice(i, openEnd), openEnd);
        end = p < 0 ? null : p + (openEnd - i);
      }
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdent(sql[j])) j++;
      end = j;
    } else end = i + 1;
    const stop = end ?? n;
    code = { s: code ? code.s : i, e: stop };
    i = stop;
    if (end === null) break; // 안 닫힌 리터럴 — 끝까지가 이 문장이다
  }
  if (code) out.push({ start: code.s, end: code.e, close: code.e });
  return out;
}

/**
 * 커서가 놓인 문장 — 머리말의 규칙. 문장이 하나도 없으면 `null`.
 *
 * 문장 안(`[start, close]` — 닫는 `;` 바로 뒤까지)이면 그 문장. 사이면 앞 문장, 앞이 없으면 다음 문장.
 */
export function statementAt(sql: string, dialect: DbDialect, cursor: number): Statement | null {
  const all = splitStatements(sql, dialect);
  if (all.length === 0) return null;
  let before: Statement | null = null;
  for (const st of all) {
    if (cursor >= st.start && cursor <= st.close) return st;
    if (st.close <= cursor) before = st;
    else break;
  }
  return before ?? all.find((st) => st.start >= cursor) ?? all[all.length - 1];
}

/**
 * `Ctrl+Enter` 가 보낼 글자와 범위 — 선택이 비어 있지 않으면(공백만이 아니면) 그것, 아니면 커서의 문장.
 * 보낼 것이 없으면 `null`(빈 편집기 · 주석뿐).
 */
export function runTarget(
  sql: string,
  dialect: DbDialect,
  sel: { from: number; to: number },
): { from: number; to: number; text: string } | null {
  const from = Math.min(sel.from, sel.to);
  const to = Math.max(sel.from, sel.to);
  if (to > from && sql.slice(from, to).trim() !== "") return { from, to, text: sql.slice(from, to) };
  const st = statementAt(sql, dialect, sel.to);
  return st ? { from: st.start, to: st.end, text: sql.slice(st.start, st.end) } : null;
}
