/** 문서 편집의 [비교] — 디스크 판(왼쪽)과 편집 글(오른쪽)의 줄 diff. UI 스레드에서 돌아 두 한도를 넘으면 `too-large` 로 그만둔다. */

import { normalizeEol } from "$lib/doc-edit";

export const COMPARE_MAX_LINES = 40_000;
export const COMPARE_MAX_EDITS = 2_000;
export const COMPARE_CONTEXT = 3;

export interface CompareLine {
  no: number;
  text: string;
}

export type CompareRow =
  | { kind: "same"; left: CompareLine; right: CompareLine }
  | { kind: "del"; left: CompareLine }
  | { kind: "add"; right: CompareLine }
  | { kind: "change"; left: CompareLine; right: CompareLine }
  /** `id` 는 결과 안에서 하나뿐 — 펼친 상태의 열쇠 */
  | { kind: "fold"; id: number; rows: CompareRow[] };

export type CompareResult =
  | { kind: "same" }
  | { kind: "eol-only" }
  | { kind: "too-large" }
  | { kind: "diff"; rows: CompareRow[]; hunks: number };

export function compareTexts(disk: string, mine: string): CompareResult {
  if (disk === mine) return { kind: "same" };
  const a = normalizeEol(disk, "\n");
  const b = normalizeEol(mine, "\n");
  if (a === b) return { kind: "eol-only" };
  const al = a.split("\n");
  const bl = b.split("\n");
  if (al.length + bl.length > COMPARE_MAX_LINES) return { kind: "too-large" };
  const ops = diffLines(al, bl, COMPARE_MAX_EDITS);
  if (ops === null) return { kind: "too-large" };
  const full = rowsOf(ops, al, bl);
  return { kind: "diff", rows: foldSame(full, COMPARE_CONTEXT), hunks: countHunks(full) };
}

type Op = "=" | "-" | "+";

export function diffLines(a: readonly string[], b: readonly string[], maxEdits: number): Op[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const ids = new Map<string, number>();
  const idOf = (s: string) => {
    let v = ids.get(s);
    if (v === undefined) {
      v = ids.size;
      ids.set(s, v);
    }
    return v;
  };
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  const x = new Int32Array(n);
  const y = new Int32Array(m);
  for (let i = 0; i < n; i++) x[i] = idOf(a[pre + i]);
  for (let j = 0; j < m; j++) y[j] = idOf(b[pre + j]);

  const mid = myers(x, y, maxEdits);
  if (mid === null) return null;
  const out: Op[] = [];
  for (let i = 0; i < pre; i++) out.push("=");
  for (const op of mid) out.push(op);
  for (let i = 0; i < suf; i++) out.push("=");
  return out;
}

function myers(x: Int32Array, y: Int32Array, maxEdits: number): Op[] | null {
  const n = x.length;
  const m = y.length;
  if (n === 0 || m === 0) {
    if (n + m > maxEdits) return null;
    return [...Array<Op>(n).fill("-"), ...Array<Op>(m).fill("+")];
  }
  const max = Math.min(n + m, maxEdits);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  /** `trace[d]` = 걸음 d 를 시작할 때의 V 의 [-d, d] 칸 */
  const trace: Int32Array[] = [];
  let end = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) {
        i++;
        j++;
      }
      v[off + k] = i;
      if (i >= n && j >= m) {
        end = d;
        break outer;
      }
    }
  }
  if (end < 0) return null;

  const rev: Op[] = [];
  let i = n;
  let j = m;
  for (let d = end; d > 0; d--) {
    const t = trace[d];
    const at = (k: number) => t[k + d];
    const k = i - j;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const pi = at(prevK);
    const pj = pi - prevK;
    while (i > pi && j > pj) {
      rev.push("=");
      i--;
      j--;
    }
    if (i === pi) {
      rev.push("+");
      j--;
    } else {
      rev.push("-");
      i--;
    }
  }
  while (i > 0 && j > 0) {
    rev.push("=");
    i--;
    j--;
  }
  return rev.reverse();
}

function rowsOf(ops: readonly Op[], a: readonly string[], b: readonly string[]): CompareRow[] {
  const rows: CompareRow[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === "=") {
      rows.push({ kind: "same", left: { no: i + 1, text: a[i] }, right: { no: j + 1, text: b[j] } });
      i++;
      j++;
      k++;
      continue;
    }
    const dels: CompareLine[] = [];
    const adds: CompareLine[] = [];
    while (k < ops.length && ops[k] !== "=") {
      if (ops[k] === "-") {
        dels.push({ no: i + 1, text: a[i] });
        i++;
      } else {
        adds.push({ no: j + 1, text: b[j] });
        j++;
      }
      k++;
    }
    const pair = Math.min(dels.length, adds.length);
    for (let p = 0; p < pair; p++) rows.push({ kind: "change", left: dels[p], right: adds[p] });
    for (let p = pair; p < dels.length; p++) rows.push({ kind: "del", left: dels[p] });
    for (let p = pair; p < adds.length; p++) rows.push({ kind: "add", right: adds[p] });
  }
  return rows;
}

function countHunks(rows: readonly CompareRow[]): number {
  let n = 0;
  let inDiff = false;
  for (const r of rows) {
    const diff = r.kind !== "same";
    if (diff && !inDiff) n++;
    inDiff = diff;
  }
  return n;
}

export function foldSame(rows: readonly CompareRow[], context: number): CompareRow[] {
  const near = new Uint8Array(rows.length);
  rows.forEach((r, idx) => {
    if (r.kind === "same") return;
    for (let q = Math.max(0, idx - context); q <= Math.min(rows.length - 1, idx + context); q++) near[q] = 1;
  });
  const out: CompareRow[] = [];
  let id = 0;
  let idx = 0;
  while (idx < rows.length) {
    if (near[idx] || rows[idx].kind !== "same") {
      out.push(rows[idx]);
      idx++;
      continue;
    }
    const start = idx;
    while (idx < rows.length && !near[idx] && rows[idx].kind === "same") idx++;
    const run = rows.slice(start, idx);
    if (run.length === 1) out.push(run[0]);
    else out.push({ kind: "fold", id: id++, rows: run });
  }
  return out;
}

export type UnifiedRow = Exclude<CompareRow, { kind: "change" }>;

export function unifiedRows(rows: readonly CompareRow[]): UnifiedRow[] {
  const out: UnifiedRow[] = [];
  let dels: UnifiedRow[] = [];
  let adds: UnifiedRow[] = [];
  const flush = () => {
    out.push(...dels, ...adds);
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === "change") {
      dels.push({ kind: "del", left: r.left });
      adds.push({ kind: "add", right: r.right });
    } else if (r.kind === "del") dels.push(r);
    else if (r.kind === "add") adds.push(r);
    else {
      flush();
      out.push(r);
    }
  }
  flush();
  return out;
}
