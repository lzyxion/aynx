import { describe, expect, it } from "vitest";
import {
  COMPARE_MAX_EDITS,
  COMPARE_MAX_LINES,
  compareTexts,
  diffLines,
  unifiedRows,
  type CompareRow,
} from "$lib/doc-compare";

/** 걸음들을 다시 적용해 오른쪽을 만든다 — diff 가 옳은지(같음 줄이 정말 같은지)까지 본다 */
function apply(a: string[], b: string[], ops: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === "=") {
      expect(a[i]).toBe(b[j]);
      out.push(a[i]);
      i++;
      j++;
    } else if (op === "-") i++;
    else {
      out.push(b[j]);
      j++;
    }
  }
  expect(i).toBe(a.length);
  return out;
}

const edits = (ops: string[]) => ops.filter((o) => o !== "=").length;

/** 펼친 행(접힘 안까지) */
function flat(rows: CompareRow[]): CompareRow[] {
  return rows.flatMap((r) => (r.kind === "fold" ? r.rows : [r]));
}

describe("diffLines", () => {
  it("최소 편집 거리로 왼쪽을 오른쪽으로 바꾼다", () => {
    const cases: [string, string][] = [
      ["abcabba", "cbabac"],
      ["", "abc"],
      ["abc", ""],
      ["abc", "abc"],
      ["axbxc", "abc"],
      ["abcdef", "azcdyf"],
    ];
    const want = [5, 3, 3, 0, 2, 4];
    cases.forEach(([sa, sb], idx) => {
      const a = [...sa];
      const b = [...sb];
      const ops = diffLines(a, b, 100)!;
      expect(apply(a, b, ops)).toEqual(b);
      expect(edits(ops)).toBe(want[idx]);
    });
  });

  it("무작위 글에서도 오른쪽을 정확히 만든다", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let r = 0; r < 200; r++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => String.fromCharCode(97 + Math.floor(rnd() * 4)));
      const b = Array.from({ length: Math.floor(rnd() * 30) }, () => String.fromCharCode(97 + Math.floor(rnd() * 4)));
      const ops = diffLines(a, b, 1000)!;
      expect(apply(a, b, ops)).toEqual(b);
    }
  });

  it("편집 거리가 한도를 넘으면 null", () => {
    expect(diffLines(["a", "b", "c"], ["x", "y", "z"], 5)).toBeNull();
    expect(diffLines(["a", "b", "c"], ["x", "y", "z"], 6)).not.toBeNull();
    expect(diffLines([], ["a", "b"], 1)).toBeNull();
  });
});

describe("compareTexts", () => {
  it("완전히 같으면 same", () => {
    expect(compareTexts("a\r\nb", "a\r\nb")).toEqual({ kind: "same" });
  });

  it("줄 끝만 다르면 eol-only", () => {
    expect(compareTexts("a\r\nb\r\n", "a\nb\n")).toEqual({ kind: "eol-only" });
  });

  it("바뀐 줄은 같은 행에 짝짓고 남는 쪽은 홀로 · 줄 번호는 1 기준", () => {
    const r = compareTexts("a\nb\nc\n", "a\nB\nX\nc\n");
    expect(r.kind).toBe("diff");
    if (r.kind !== "diff") return;
    expect(r.hunks).toBe(1);
    expect(r.rows).toEqual([
      { kind: "same", left: { no: 1, text: "a" }, right: { no: 1, text: "a" } },
      { kind: "change", left: { no: 2, text: "b" }, right: { no: 2, text: "B" } },
      { kind: "add", right: { no: 3, text: "X" } },
      { kind: "same", left: { no: 3, text: "c" }, right: { no: 4, text: "c" } },
      { kind: "same", left: { no: 4, text: "" }, right: { no: 5, text: "" } },
    ]);
  });

  it("CRLF 디스크와 LF 로 맞춘 글을 줄 끝을 맞춘 뒤 견준다", () => {
    const r = compareTexts("a\r\nb\r\n", "a\r\nc\r\n");
    expect(r.kind).toBe("diff");
    if (r.kind !== "diff") return;
    expect(r.rows[1]).toEqual({ kind: "change", left: { no: 2, text: "b" }, right: { no: 2, text: "c" } });
  });

  it("다른 곳 앞뒤 3줄만 두고 사이의 같은 줄은 접는다 · 다른 곳 수를 센다", () => {
    const base = Array.from({ length: 30 }, (_, i) => `L${i}`);
    const mine = [...base];
    mine[2] = "X";
    mine[25] = "Y";
    const r = compareTexts(base.join("\n"), mine.join("\n"));
    expect(r.kind).toBe("diff");
    if (r.kind !== "diff") return;
    expect(r.hunks).toBe(2);
    const kinds = r.rows.map((x) => x.kind);
    // 0,1 · change(2) · 3,4,5 · fold(6..21) · 22,23,24 · change(25) · 26,27,28 · fold? (29 하나 — 접지 않음)
    expect(kinds).toEqual([
      "same", "same", "change", "same", "same", "same", "fold", "same", "same", "same", "change", "same", "same", "same", "same",
    ]);
    const fold = r.rows[6];
    expect(fold.kind === "fold" && fold.rows.length).toBe(16);
    expect(flat(r.rows)).toHaveLength(30);
  });

  it("줄 수 합이 한도를 넘으면 too-large", () => {
    const big = "x\n".repeat(COMPARE_MAX_LINES / 2);
    expect(compareTexts(big, big + "y")).toEqual({ kind: "too-large" });
  });

  it("편집 거리가 한도를 넘으면 too-large — 오래 잡지 않는다", () => {
    const a = Array.from({ length: COMPARE_MAX_EDITS }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: COMPARE_MAX_EDITS }, (_, i) => `b${i}`).join("\n");
    const t0 = performance.now();
    expect(compareTexts(a, b)).toEqual({ kind: "too-large" });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("unifiedRows", () => {
  it("바뀜 묶음을 지움들 다음 더함들로 편다", () => {
    const r = compareTexts("a\nb\nc\nd", "a\nB\nC\nd");
    expect(r.kind).toBe("diff");
    if (r.kind !== "diff") return;
    expect(unifiedRows(r.rows).map((x) => (x.kind === "del" ? `-${x.left.text}` : x.kind === "add" ? `+${x.right.text}` : x.kind))).toEqual([
      "same",
      "-b",
      "-c",
      "+B",
      "+C",
      "same",
    ]);
  });
});
