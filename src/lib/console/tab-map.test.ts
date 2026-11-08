import { describe, expect, it } from "vitest";
import type { PaneNode, PaneSpec } from "$lib/session";
import type { SessionBoard, SessionCard } from "$lib/console/session-cards";
import { sheetBuckets, sheetCounts } from "$lib/console/session-sheet";
import { albumCell, auxTabDotInput, cellFace, cellMark, mapSummary, miniLayout, tabMap, type MapCell, type MapTabInput } from "$lib/console/tab-map";
import { tabDot } from "$lib/tab-dot";

// ---------------------------------------------------------------------------
// 세션 목록 판의 탭 지도 — 축소판 칸 · 칸의 면 · 줄 가르기 · 요약 수 · 보조 창 탭의 표식 (2026-11-02).
// ---------------------------------------------------------------------------

function leaf(id: string, kind: PaneSpec["kind"] = "local"): PaneNode {
  return { type: "leaf", pane: { id, kind } as PaneSpec };
}

function split(dir: "row" | "col", ratio: number, a: PaneNode, b: PaneNode): PaneNode {
  return { type: "split", dir, ratio, a, b };
}

function card(over: Partial<SessionCard> & Pick<SessionCard, "key">): SessionCard {
  return {
    kind: "local",
    tabId: "t1",
    paneId: over.key,
    state: "idle",
    agentStatus: null,
    subagents: 0,
    unseen: null,
    title: over.key,
    sub: null,
    code: over.key,
    ai: null,
    since: null,
    agentTime: null,
    command: "",
    commandShort: "",
    exit: null,
    running: false,
    ...over,
  };
}

function tab(id: string, root: PaneNode, workspaceId: string | null = "w1"): MapTabInput {
  return { id, title: `탭 ${id}`, workspaceId, root };
}

const WS = [
  { id: "w1", name: "개발" },
  { id: "w2", name: "서버" },
];

describe("miniLayout — 트리 그대로의 축소판", () => {
  it("좌우 분할 안의 상하 분할 — 비율 · 방향 · 잎 순서", () => {
    const boxes = miniLayout(split("row", 0.6, leaf("a"), split("col", 0.5, leaf("b"), leaf("c"))));
    expect(boxes.map((b) => b.paneId)).toEqual(["a", "b", "c"]);
    expect(boxes[0]).toMatchObject({ x: 0, y: 0, h: 1 });
    expect(boxes[0].w).toBeCloseTo(0.6);
    expect(boxes[1].x).toBeCloseTo(0.6);
    expect(boxes[1].w).toBeCloseTo(0.4);
    expect(boxes[1].h).toBeCloseTo(0.5);
    expect(boxes[2].y).toBeCloseTo(0.5);
  });

  it("비율은 화면과 같이 클램프한다", () => {
    const [a] = miniLayout(split("col", 0.01, leaf("a"), leaf("b")));
    expect(a.h).toBeCloseTo(0.15);
  });

  it("잎 하나는 전체", () => {
    expect(miniLayout(leaf("a"))).toEqual([{ paneId: "a", x: 0, y: 0, w: 1, h: 1 }]);
  });
});

describe("cellMark — 칸의 표식 하나 · 순서는 탭과 같다", () => {
  const ai = (over: Partial<SessionCard>) => card({ key: "a", kind: "ai", ...over });

  it("권한 대기 · 완료 · 실패는 벨을 이긴다", () => {
    expect(cellMark(ai({ state: "input", agentStatus: "permission" }), true)).toBe("permission");
    expect(cellMark(ai({ state: "input", agentStatus: "finished" }), true)).toBe("finished");
    expect(cellMark(card({ key: "s", state: "fail" }), true)).toBe("fail");
  });

  it("벨은 실행 중을 이긴다 · 조용함 · 끊김에도 선다", () => {
    expect(cellMark(ai({ state: "running", agentStatus: "running" }), true)).toBe("bell");
    expect(cellMark(card({ key: "s", state: "running" }), true)).toBe("bell");
    expect(cellMark(card({ key: "s" }), true)).toBe("bell");
    expect(cellMark(card({ key: "s", state: "off" }), true)).toBe("bell");
  });

  it("벨이 없으면 에이전트 실행 · 명령 실행으로 가르고 조용함 · 끊김 · 카드 없는 칸은 표식이 없다", () => {
    expect(cellMark(ai({ state: "running", agentStatus: "running" }), false)).toBe("running");
    expect(cellMark(card({ key: "s", state: "running" }), false)).toBe("command");
    expect(cellMark(card({ key: "s" }), false)).toBeNull();
    expect(cellMark(card({ key: "s", state: "off" }), false)).toBeNull();
    expect(cellMark(null, false)).toBeNull();
  });
});

describe("albumCell — 플레이어 칸의 면은 앨범의 맥박으로 정한다", () => {
  it("재생 · 검토 = 옅은 면 · 사람 필요와 조율 멈춤 = 권한 대기와 같은 면", () => {
    expect(albumCell("playing")).toEqual({ face: "album-playing", vivid: true });
    expect(albumCell("reviewing")).toEqual({ face: "album-reviewing", vivid: true });
    expect(albumCell("attention")).toEqual({ face: "permission", vivid: true });
    expect(albumCell("paused")).toEqual({ face: "permission", vivid: true });
  });

  it("끝남은 면 없이 선명 · 쉼과 로고는 조용한 칸 그대로", () => {
    expect(albumCell("done")).toEqual({ face: null, vivid: true });
    expect(albumCell("idle")).toEqual({ face: null, vivid: false });
    expect(albumCell("logo")).toEqual({ face: null, vivid: false });
  });
});

describe("cellFace — 입력 대기를 권한 대기 · 완료로 가른다", () => {
  it("권한 대기 · 완료 · 나머지는 카드 상태 그대로", () => {
    expect(cellFace(card({ key: "a", kind: "ai", state: "input", agentStatus: "permission" }))).toBe("permission");
    expect(cellFace(card({ key: "a", kind: "ai", state: "input", agentStatus: "finished" }))).toBe("finished");
    expect(cellFace(card({ key: "a", kind: "ai", state: "running", agentStatus: "running" }))).toBe("running");
    expect(cellFace(card({ key: "a", state: "fail" }))).toBe("fail");
    expect(cellFace(card({ key: "a", state: "off" }))).toBe("off");
  });
});

describe("tabMap — 워크스페이스마다 한 줄 · 탭마다 카드", () => {
  it("카드가 없는 잎은 card null, 세션 타일이 없는 탭도 지도에 온다(점 없음)", () => {
    const rows = tabMap({
      tabs: [tab("t1", split("row", 0.5, leaf("a"), leaf("doc", "doc"))), tab("t2", leaf("doc2", "doc"))],
      workspaces: WS,
      cards: [card({ key: "a", state: "running" })],
      activeTabId: "t1",
      auxOwners: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "w1", name: "개발" });
    const [t1, t2] = rows[0].tabs;
    expect(t1).toMatchObject({ id: "t1", current: true });
    expect(t1.cells.map((c) => c.card?.key ?? null)).toEqual(["a", null]);
    expect(t2).toMatchObject({ id: "t2", current: false });
    expect(t2.cells.map((c) => c.card)).toEqual([null]);
  });

  it("줄은 워크스페이스 목록 순서, 탭은 탭 바 순서, 소속 없는 탭이 먼저", () => {
    const rows = tabMap({
      tabs: [tab("t1", leaf("a"), "w2"), tab("t2", leaf("b"), "w1"), tab("t3", leaf("c"), null), tab("t4", leaf("d"), "w2")],
      workspaces: WS,
      cards: ["a", "b", "c", "d"].map((key) => card({ key })),
      activeTabId: null,
      auxOwners: new Map(),
    });
    expect(rows.map((r) => r.id)).toEqual([null, "w1", "w2"]);
    expect(rows[0].name).toBeNull();
    expect(rows[2].tabs.map((t) => t.id)).toEqual(["t1", "t4"]);
  });

  it("헤드리스 카드는 지도에 없다", () => {
    const rows = tabMap({
      tabs: [tab("t1", leaf("a"))],
      workspaces: WS,
      cards: [card({ key: "a", kind: "headless", tabId: null, paneId: null })],
      activeTabId: null,
      auxOwners: new Map(),
    });
    // 탭은 오지만(세션 없는 탭도 지도에 온다) 헤드리스 카드는 어느 칸에도 붙지 않는다
    expect(rows.flatMap((r) => r.tabs.flatMap((t) => t.cells.map((c) => c.card)))).toEqual([null]);
  });

  it("보조 창의 타일은 그 창 탭 하나로 — 가로 같은 폭 · 보고된 워크스페이스", () => {
    const rows = tabMap({
      tabs: [],
      workspaces: WS,
      cards: [
        card({ key: "aux:p1", tabId: "aux:t9", state: "fail" }),
        card({ key: "aux:p2", tabId: "aux:t9" }),
      ],
      activeTabId: null,
      auxOwners: new Map([["aux:p1", "w2"]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("w2");
    const [t] = rows[0].tabs;
    expect(t).toMatchObject({ id: "aux:t9", title: null });
    expect(t.cells.map((c) => [c.x, c.w])).toEqual([
      [0, 0.5],
      [0.5, 0.5],
    ]);
  });
});

describe("mapSummary — 판의 묶음과 같은 수", () => {
  it("권한 대기 · 완료 · 실패가 따로 · 합은 독 요약 줄의 기다리는 수 · 실행 중 · 조용함 · 끊김", () => {
    const cards = [
      card({ key: "i", kind: "ai", state: "input", agentStatus: "permission" }),
      card({ key: "d", kind: "ai", state: "input", agentStatus: "finished" }),
      card({ key: "d2", kind: "ai", state: "input", agentStatus: "finished" }),
      card({ key: "f", state: "fail", exit: 1 }),
      card({ key: "r", state: "running", running: true }),
      card({ key: "q" }),
      card({ key: "o", state: "off" }),
    ];
    const board: SessionBoard = {
      groups: [{ key: "local:", name: "로컬", local: true, address: null, meta: null, delegated: false, grants: null, cards }],
      summary: { input: 0, fail: 0, running: 0, idle: 0, off: 0 },
      total: cards.length,
    };
    const buckets = sheetBuckets(board, 0);
    expect(mapSummary(buckets)).toEqual({ permission: 1, finished: 2, fail: 1, running: 1, idle: 1, off: 1 });
    expect(sheetCounts(buckets)).toEqual({ running: 1, waiting: 4 });
  });
});

describe("auxTabDotInput — 트리가 없는 보조 창 탭의 표식", () => {
  const cell = (c: SessionCard): MapCell => ({ paneId: c.key, x: 0, y: 0, w: 1, h: 1, card: c });
  const keyTr = (key: string) => key;

  it("에이전트 카드는 탭 줄과 같은 사실 — 권한 대기가 실패를 이기고 서브 에이전트 수가 붙는다", () => {
    const input = auxTabDotInput([
      cell(card({ key: "s", state: "fail", title: "web-01" })),
      cell(card({ key: "a", kind: "ai", ai: "claude", state: "input", agentStatus: "permission", subagents: 2 })),
    ]);
    expect(input.active).toBe(false);
    expect(tabDot(input, keyTr)?.winner).toMatchObject({ source: "agent", state: "permission", name: "Claude Code", subagents: 2, paneId: "a" });
    expect(input.command).toEqual({ state: "fail", name: "web-01", others: 0 });
  });

  it("셸 카드는 실행 중 > 실패로 접고(`foldStatus`) · 조용한 카드는 표식이 없다", () => {
    const input = auxTabDotInput([
      cell(card({ key: "s", state: "fail" })),
      cell(card({ key: "r", state: "running", title: "npm" })),
      cell(card({ key: "q" })),
    ]);
    expect(input.command).toEqual({ state: "running", name: "npm", others: 1 });
    expect(tabDot(auxTabDotInput([cell(card({ key: "q" }))]), keyTr)).toBeNull();
  });
});
