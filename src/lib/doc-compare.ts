/**
 * **문서 편집의 [비교] — 줄 단위 diff** (순수 모듈). 편집 중 "디스크의 파일이 바뀌었습니다" 띠의 [비교]가 디스크 판(왼쪽)과
 * 편집기의 지금 글(오른쪽)을 견준다 — 그림 · 읽기 · 닫기는 `DocView` 와 `doc/DocCompareView.svelte`.
 *
 * - [`compareTexts`] — 두 글 → 같음 · 줄 끝만 다름 · 너무 큼 · 행 목록. 줄 끝은 둘 다 `\n` 으로 맞춘 뒤 견준다(편집기는 원문의
 *   우세한 줄 끝을 `lineSeparator` 로 쥐어 `getText` 가 그 줄 끝으로 돌려준다 — `doc-edit.ts` 의 `detectEol`).
 * - 계산은 **Myers O(ND)**(앞뒤 같은 줄을 먼저 떼고 가운데만). 보호 한도 둘 — 줄 수 합 [`COMPARE_MAX_LINES`] · 편집 거리
 *   [`COMPARE_MAX_EDITS`] 를 넘으면 그만두고 `too-large` 다(UI 스레드에서 돈다 — 오래 잡지 않게).
 * - 행은 나란히 그리기의 것이다: 같음 · 지움 · 더함 · 바뀜(지운 줄과 더한 줄을 차례로 짝지은 한 행). 다른 곳 앞뒤
 *   [`COMPARE_CONTEXT`] 줄 밖의 같은 줄은 접힘 한 행(`fold` — 안의 행을 들고 있어 펼칠 수 있다). 좁은 타일의 한 칸 보기는
 *   [`unifiedRows`] 가 바뀜 행을 "지움들 다음 더함들" 로 편다.
 */

import { normalizeEol } from "$lib/doc-edit";

/** 줄 수 합(디스크 + 편집) 한도 — 넘으면 견주지 않는다 */
export const COMPARE_MAX_LINES = 40_000;
/** 편집 거리(지운 줄 + 더한 줄) 한도 — 넘으면 계산을 그만둔다 */
export const COMPARE_MAX_EDITS = 2_000;
/** 다른 곳 앞뒤로 펼쳐 두는 같은 줄 수 */
export const COMPARE_CONTEXT = 3;

/** 한 칸의 줄 — `no` 는 1 기준 줄 번호 */
export interface CompareLine {
  no: number;
  text: string;
}

export type CompareRow =
  | { kind: "same"; left: CompareLine; right: CompareLine }
  | { kind: "del"; left: CompareLine }
  | { kind: "add"; right: CompareLine }
  | { kind: "change"; left: CompareLine; right: CompareLine }
  /** 같은 줄 묶음을 접은 한 행 — `id` 는 결과 안에서 하나뿐(펼친 상태의 열쇠), `rows` 는 모두 `same` */
  | { kind: "fold"; id: number; rows: CompareRow[] };

export type CompareResult =
  | { kind: "same" }
  | { kind: "eol-only" }
  | { kind: "too-large" }
  /** `hunks` = 다른 곳(이어진 다른 줄 묶음) 수 */
  | { kind: "diff"; rows: CompareRow[]; hunks: number };

/** 디스크 글(왼쪽)과 편집 글(오른쪽)을 견준다 */
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

/** 편집 한 걸음 — `=` 같음(양쪽 하나씩) · `-` 왼쪽 하나 · `+` 오른쪽 하나 */
type Op = "=" | "-" | "+";

/**
 * 줄 diff — 편집 거리가 `maxEdits` 를 넘으면 `null`. 앞뒤 같은 줄을 떼고 가운데를 Myers 로 푼다. 줄은 같은 글이면 같은
 * 번호로 바꿔 견준다(긴 줄의 글자 비교를 되풀이하지 않게).
 */
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

/** Myers O(ND) — 앞으로 훑으며 걸음마다 V 를 떠 두고(되짚기에 쓴다) 끝에서 거꾸로 짚는다 */
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

  // 되짚기 — 끝(n, m)에서 걸음마다 앞 대각선으로
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

/** 걸음들 → 나란히 행. 같음 사이의 지움 · 더함 묶음은 차례로 짝지어 바뀜, 남는 쪽은 홀로 */
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

/** 다른 곳 수 — 이어진 다른 행 묶음 */
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

/** 다른 행에서 `context` 줄 넘게 떨어진 같은 행 묶음을 접는다(한 줄뿐인 묶음은 접지 않는다 — 접은 행이 더 길다) */
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

/** 한 칸 보기의 행 — 바뀜이 없다(지움 · 더함으로 편다) */
export type UnifiedRow = Exclude<CompareRow, { kind: "change" }>;

/** 나란히 행 → 한 칸 보기. 이어진 다른 행 묶음마다 왼쪽 줄들(`−`) 다음 오른쪽 줄들(`+`) */
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
