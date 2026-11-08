import { beforeEach, describe, expect, it } from "vitest";
import {
  BLOCK_CAPS,
  beginBlock,
  blocksOf,
  dropHistory,
  endBlock,
  exportHistory,
  importHistory,
  blockAtRow,
  lastBlock,
  lastFinishedBlock,
  makeExcerpt,
  remapHistory,
  resetHistories,
  type BlockCaps,
  type BlockLine,
} from "$lib/block-history";

/**
 * 블록 이력 저장소 (docs/log/2026-09-08-block-history-store.md).
 *
 * 저장소는 **모듈 전역 맵**이라 테스트끼리 이력을 물려받는다 — 매번 비우고 시작한다.
 */
beforeEach(() => resetHistories());

/** 작은 상한 — 축출·발췌 규칙을 몇 줄로 시험하려고 값만 줄인 같은 모양이다 */
const SMALL: BlockCaps = {
  headLines: 2,
  tailLines: 3,
  lineUnits: 10,
  headUnits: 100,
  tailUnits: 100,
  paneBlocks: 3,
  paneUnits: 200,
};

const lines = (n: number, prefix = "L") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("makeExcerpt — 머리와 꼬리만 남긴다", () => {
  it("짧은 출력은 한 줄도 버리지 않는다 (머리+꼬리 안에 다 들어간다)", () => {
    const e = makeExcerpt(["a", "b", "c"], SMALL);
    expect(e.head).toEqual(["a", "b"]);
    expect(e.tail).toEqual(["c"]);
    expect(e.truncated).toBe(false);
    // 머리와 꼬리는 **겹치지 않는다** — 이어 붙이면 원래 출력이다.
    expect([...e.head, ...e.tail]).toEqual(["a", "b", "c"]);
  });

  it("빈 출력도 발췌가 된다 (블록은 남아야 한다)", () => {
    const e = makeExcerpt([], SMALL);
    expect(e.head).toEqual([]);
    expect(e.tail).toEqual([]);
    expect(e.truncated).toBe(false);
    expect(e.units).toBe(0);
    // 진짜 무출력을 읽은 경우다 — "못 읽음"(unavailable)이 아니라 complete.
    expect(e.capture).toBe("complete");
  });

  it("가운데를 버리면 truncated 가 선다 — 꼬리(끝)가 살아남는다", () => {
    const e = makeExcerpt(lines(10), SMALL); // 머리 2 + 꼬리 3, 가운데 5줄이 사라진다
    expect(e.head).toEqual(["L0", "L1"]);
    expect(e.tail).toEqual(["L7", "L8", "L9"]);
    expect(e.truncated).toBe(true);
    // 읽긴 했으나 가운데가 잘렸다 = partial (unavailable 이 아니다).
    expect(e.capture).toBe("partial");
  });

  it("오류는 끝에 나온다 — 꼬리는 언제나 마지막 줄을 들고 있다", () => {
    const e = makeExcerpt([...lines(50), "E: boom"], SMALL);
    expect(e.tail.at(-1)).toBe("E: boom");
  });

  it("긴 한 줄은 클램프하고 truncated 를 세운다", () => {
    const e = makeExcerpt(["x".repeat(50)], SMALL);
    expect(e.head[0]).toHaveLength(SMALL.lineUnits);
    expect(e.truncated).toBe(true);
  });

  it("총량 상한 — 머리는 앞이, 꼬리는 뒤가 살아남는다", () => {
    // 줄당 4 유닛(3글자+개행) · 머리 상한 10 유닛 → 머리는 두 줄까지만.
    const caps: BlockCaps = { ...SMALL, headLines: 5, tailLines: 5, headUnits: 10, tailUnits: 10 };
    const e = makeExcerpt(["aaa", "bbb", "ccc", "ddd", "eee", "fff", "ggg", "hhh"], caps);
    expect(e.head).toEqual(["aaa", "bbb"]); // 뒤에서부터 버렸다
    expect(e.tail).toEqual(["ggg", "hhh"]); // 앞에서부터 버렸다
    expect(e.truncated).toBe(true);
  });

  it("한 줄도 못 들어가는 상한이어도 그 한 줄은 남긴다 (빈 발췌보다 낫다)", () => {
    const caps: BlockCaps = { ...SMALL, headUnits: 1, tailUnits: 1 };
    const e = makeExcerpt(["hello"], caps);
    expect(e.head).toEqual(["hello"]);
  });

  it("units 는 실제로 들고 있는 양이다 (버린 줄은 세지 않는다)", () => {
    const e = makeExcerpt(lines(100), SMALL);
    const kept = [...e.head, ...e.tail].reduce((n, l) => n + l.length + 1, 0);
    expect(e.units).toBe(kept);
  });

  it("기본 상한은 설계 문서의 값이다 (머리 20 + 꼬리 500 · 블록 64KB)", () => {
    expect(BLOCK_CAPS.headLines).toBe(20);
    expect(BLOCK_CAPS.tailLines).toBe(500);
    expect(BLOCK_CAPS.headUnits + BLOCK_CAPS.tailUnits).toBe(64 * 1024);
    expect(BLOCK_CAPS.paneBlocks).toBe(200);
    expect(BLOCK_CAPS.paneUnits).toBe(4 * 1024 * 1024);
  });
});

describe("beginBlock / endBlock", () => {
  it("C 가 블록을 열고 D 가 닫는다 — 발췌는 D 에서만 만들어진다", () => {
    const open = beginBlock("p1", { commandLine: "$ ls", cwd: "/srv", startedAt: 100 });
    expect(open.running).toBe(true);
    expect(open.endedAt).toBeNull();
    expect(open.excerpt.head).toEqual([]);

    const closed = endBlock("p1", {
      exit: 0,
      endedAt: 250,
      outputLines: ["a", "b"],
      outputCaptured: true,
    });
    expect(closed).not.toBeNull();
    expect(closed?.id).toBe(open.id);
    expect(closed?.running).toBe(false);
    expect(closed?.endedAt).toBe(250);
    expect(closed?.exit).toBe(0);
    expect(closed?.excerpt.head).toEqual(["a", "b"]);
    expect(blocksOf("p1")).toHaveLength(1);
  });

  it("id 는 타일별로 단조 증가하고 타일끼리 섞이지 않는다", () => {
    expect(beginBlock("p1", { commandLine: "a", cwd: null, startedAt: 1 }).id).toBe(1);
    expect(beginBlock("p2", { commandLine: "b", cwd: null, startedAt: 1 }).id).toBe(1);
    endBlock("p1", { exit: 0, endedAt: 2, outputLines: [], outputCaptured: true });
    expect(beginBlock("p1", { commandLine: "c", cwd: null, startedAt: 3 }).id).toBe(2);
    expect(blocksOf("p2")).toHaveLength(1);
  });

  it("cwd 를 그대로 들고 있는다 (셸이 말한 적 없으면 null)", () => {
    beginBlock("p1", { commandLine: "ls", cwd: "C:/work", startedAt: 1 });
    expect(lastBlock("p1")?.cwd).toBe("C:/work");
    beginBlock("p2", { commandLine: "ls", cwd: null, startedAt: 1 });
    expect(lastBlock("p2")?.cwd).toBeNull();
  });

  it("D 없이 새 C 가 오면 직전 블록을 그 자리에서 닫는다 (exit 는 null 로 — 지어내지 않는다)", () => {
    beginBlock("p1", { commandLine: "sleep", cwd: null, startedAt: 100 });
    beginBlock("p1", { commandLine: "ls", cwd: null, startedAt: 500 });
    const [first, second] = blocksOf("p1");
    expect(first.running).toBe(false);
    expect(first.endedAt).toBe(500);
    expect(first.exit).toBeNull();
    expect(second.running).toBe(true);
  });

  it("마커 유실(outputCaptured:false)은 unavailable·truncated 로 닫는다 (무출력과 구분)", () => {
    beginBlock("p1", { commandLine: "big", cwd: null, startedAt: 100 });
    const closed = endBlock("p1", { exit: 0, endedAt: 250, outputLines: [], outputCaptured: false });
    expect(closed?.excerpt.capture).toBe("unavailable");
    // "출력이 없었다" 가 아니라 "담지 못했다" — truncated 로 그 사실을 남긴다.
    expect(closed?.excerpt.truncated).toBe(true);
    expect(closed?.excerpt.head).toEqual([]);
  });

  it("출력을 읽어 닫으면 capture 는 complete 다 (잘린 것이 없다)", () => {
    beginBlock("p1", { commandLine: "ls", cwd: null, startedAt: 1 });
    const closed = endBlock("p1", {
      exit: 0,
      endedAt: 2,
      outputLines: ["a", "b"],
      outputCaptured: true,
    });
    expect(closed?.excerpt.capture).toBe("complete");
    expect(closed?.excerpt.truncated).toBe(false);
  });

  it("닫을 것이 없으면 null (C 없이 온 D · 이미 축출된 블록)", () => {
    expect(
      endBlock("ghost", { exit: 0, endedAt: 1, outputLines: [], outputCaptured: true }),
    ).toBeNull();
    beginBlock("p1", { commandLine: "ls", cwd: null, startedAt: 1 });
    endBlock("p1", { exit: 0, endedAt: 2, outputLines: [], outputCaptured: true });
    expect(
      endBlock("p1", { exit: 0, endedAt: 3, outputLines: [], outputCaptured: true }),
    ).toBeNull();
  });
});

describe("링 — 오래된 것부터 버린다", () => {
  it("블록 수 상한", () => {
    for (let i = 0; i < 10; i++) {
      beginBlock("p1", { commandLine: `cmd-${i}`, cwd: null, startedAt: i }, SMALL);
      endBlock("p1", { exit: 0, endedAt: i, outputLines: [], outputCaptured: true }, SMALL);
    }
    const blocks = blocksOf("p1");
    expect(blocks).toHaveLength(SMALL.paneBlocks);
    expect(blocks[0].commandLine).toBe("cmd-7"); // 앞의 일곱 건이 사라졌다
    expect(blocks.at(-1)?.commandLine).toBe("cmd-9");
    // 번호는 재사용하지 않는다 — 축출됐다고 다시 1 부터 매기지 않는다.
    expect(blocks.at(-1)?.id).toBe(10);
  });

  it("총량 상한 — 블록 수가 남아 있어도 바이트로 깎는다", () => {
    const caps: BlockCaps = { ...SMALL, paneBlocks: 100, paneUnits: 60 };
    for (let i = 0; i < 10; i++) {
      beginBlock("p1", { commandLine: `c${i}`, cwd: null, startedAt: i }, caps);
      endBlock("p1", { exit: 0, endedAt: i, outputLines: ["0123456789"], outputCaptured: true }, caps);
    }
    const blocks = blocksOf("p1");
    expect(blocks.length).toBeLessThan(10);
    expect(blocks.at(-1)?.commandLine).toBe("c9"); // 최신은 언제나 남는다
  });

  it("혼자서 상한을 넘는 블록 하나는 남는다", () => {
    const caps: BlockCaps = { ...SMALL, paneUnits: 5 };
    beginBlock("p1", { commandLine: "huge", cwd: null, startedAt: 1 }, caps);
    endBlock("p1", { exit: 0, endedAt: 2, outputLines: ["0123456789"], outputCaptured: true }, caps);
    expect(blocksOf("p1")).toHaveLength(1);
  });
});

describe("이관 — export / import / remap", () => {
  it("exportHistory 는 사본이다 (실린 뒤에도 원본이 계속 돈다)", () => {
    beginBlock("p1", { commandLine: "ls", cwd: null, startedAt: 1 });
    endBlock("p1", { exit: 0, endedAt: 2, outputLines: ["a"], outputCaptured: true });
    const shipped = exportHistory("p1");
    // 원본 타일이 명령을 하나 더 돌려도 실린 짐은 그대로여야 한다.
    beginBlock("p1", { commandLine: "pwd", cwd: null, startedAt: 3 });
    expect(shipped).toHaveLength(1);
    expect(shipped[0].excerpt.head).toEqual(["a"]);
    expect(shipped[0].excerpt.head).not.toBe(blocksOf("p1")[0].excerpt.head);
  });

  it("importHistory 는 새 타일 id 로 심고 다음 번호를 이어 간다", () => {
    beginBlock("old", { commandLine: "ls", cwd: null, startedAt: 1 });
    endBlock("old", { exit: 0, endedAt: 2, outputLines: [], outputCaptured: true });
    const shipped = exportHistory("old");
    dropHistory("old");

    importHistory("pane-9", shipped);
    const blocks = blocksOf("pane-9");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].paneId).toBe("pane-9");
    // 블록 번호는 그대로 두고(MCP 가 지목한 번호가 흔들리면 안 된다) 다음 것만 이어 간다.
    expect(blocks[0].id).toBe(1);
    expect(beginBlock("pane-9", { commandLine: "next", cwd: null, startedAt: 3 }).id).toBe(2);
  });

  it("remapHistory 는 같은 창 안에서 이름표만 바꾼다", () => {
    beginBlock("a", { commandLine: "ls", cwd: null, startedAt: 1 });
    remapHistory("a", "b");
    expect(blocksOf("a")).toHaveLength(0);
    expect(blocksOf("b")).toHaveLength(1);
    expect(blocksOf("b")[0].paneId).toBe("b");
  });

  it("dropHistory 는 그 타일의 이력을 통째로 버린다", () => {
    beginBlock("p1", { commandLine: "ls", cwd: null, startedAt: 1 });
    dropHistory("p1");
    expect(blocksOf("p1")).toHaveLength(0);
    expect(lastBlock("p1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 우클릭한 줄 → 블록 (docs/log/2026-09-16-snippets.md)
// ---------------------------------------------------------------------------

describe("blockAtRow", () => {
  /** 프롬프트 줄이 10·40·80 인 블록 셋 (마커가 살아 있는 것만 온다) */
  const lines: BlockLine[] = [
    { id: 1, line: 10 },
    { id: 2, line: 40 },
    { id: 3, line: 80 },
  ];

  it("그 줄 이하의 **가장 큰** 프롬프트 줄이 답이다", () => {
    expect(blockAtRow(10, lines)).toBe(1);
    expect(blockAtRow(39, lines)).toBe(1);
    expect(blockAtRow(40, lines)).toBe(2);
    expect(blockAtRow(79, lines)).toBe(2);
  });

  it("마지막 블록보다 아래(살아 있는 프롬프트 자리)는 그 마지막 블록이다", () => {
    expect(blockAtRow(80, lines)).toBe(3);
    expect(blockAtRow(5000, lines)).toBe(3);
  });

  it("첫 블록보다 위면 답이 없다 — 지어내지 않는다", () => {
    expect(blockAtRow(9, lines)).toBeNull();
    expect(blockAtRow(0, lines)).toBeNull();
  });

  it("목록이 비었거나 줄 번호가 수가 아니면 `null`", () => {
    expect(blockAtRow(10, [])).toBeNull();
    expect(blockAtRow(Number.NaN, lines)).toBeNull();
  });

  it("정렬돼 있지 않아도 된다 — 마커가 죽어 빠진 자리가 있다", () => {
    const shuffled: BlockLine[] = [
      { id: 3, line: 80 },
      { id: 1, line: 10 },
      { id: 3, line: 80 },
      { id: 2, line: 40 },
    ];
    expect(blockAtRow(50, shuffled)).toBe(2);
  });
});

describe("lastFinishedBlock", () => {
  it("아직 도는 명령은 답이 아니다 — 결말을 모른다", () => {
    beginBlock("p1", { commandLine: "ls", cwd: null, startedAt: 1 });
    endBlock("p1", { exit: 0, endedAt: 2, outputLines: ["a"], outputCaptured: true });
    beginBlock("p1", { commandLine: "sleep 100", cwd: null, startedAt: 3 });
    expect(lastBlock("p1")?.commandLine).toBe("sleep 100");
    expect(lastFinishedBlock("p1")?.commandLine).toBe("ls");
  });

  it("명령문이 빈 블록은 건너뛴다 — 저장해 봐야 빈 글자다", () => {
    beginBlock("p1", { commandLine: "make all", cwd: null, startedAt: 1 });
    endBlock("p1", { exit: 0, endedAt: 2, outputLines: [], outputCaptured: true });
    beginBlock("p1", { commandLine: "   ", cwd: null, startedAt: 3 });
    endBlock("p1", { exit: 0, endedAt: 4, outputLines: [], outputCaptured: true });
    expect(lastFinishedBlock("p1")?.commandLine).toBe("make all");
  });

  it("그런 블록이 하나도 없으면 `null`", () => {
    expect(lastFinishedBlock("nope")).toBeNull();
    beginBlock("p2", { commandLine: "sleep 100", cwd: null, startedAt: 1 });
    expect(lastFinishedBlock("p2")).toBeNull();
  });
});
