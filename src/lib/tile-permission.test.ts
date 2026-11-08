import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyTilePermEvent,
  applyTilePermSnapshot,
  cardBody,
  cardTarget,
  commandVerdict,
  dropTilePermCard,
  lineDiff,
  mcpNames,
  parseTilePermBody,
  parseTilePermCard,
  parseTilePermSnapshot,
  patchFiles,
  patchRows,
  secondsLeft,
  type TilePermCard,
  type TilePermState,
} from "./tile-permission";
import type { PlanAnalysis } from "./operations";

function card(over: Partial<TilePermCard> & { input?: unknown } = {}): TilePermCard {
  return {
    requestId: "r1",
    stream: "s1",
    sessionEpoch: 1,
    cli: "claude",
    tool: "Bash",
    kind: "command",
    toolUseId: null,
    conversation: "c1",
    input: { command: "ls", description: "List" },
    truncated: false,
    suggestions: [],
    mcpServer: null,
    cwd: null,
    permissionMode: null,
    canAllowSession: true,
    createdAt: 0,
    deadlineAt: 60_000,
    auto: false,
    ...over,
  };
}

const body = (ev: unknown, stream = "s1", sessionEpoch = 1) => parseTilePermBody({ windows: ["main"], stream, sessionEpoch, ev })!;

describe("타일의 선택 면 보고", () => {
  it("숨긴 탭도 대화 면이면 카드 · 터미널 면이면 TUI", () => {
    const source = readFileSync(new URL("./pane/AiFlip.svelte", import.meta.url), "utf8");
    const expression = source.match(/const faceConvo = \$derived\(([^;]+)\);/)?.[1];
    expect(expression).toBeDefined();
    const face = new Function("view", "shown", `return (${expression});`) as (view: string, shown: boolean) => boolean;
    expect([face("convo", true), face("convo", false)]).toEqual([true, true]);
    expect([face("term", true), face("term", false)]).toEqual([false, false]);
    expect(source).toMatch(/onDestroy\(\(\) => \{\s*if \(permTile\) reportTileFace\(stream, false\);/);
  });
});

describe("parse", () => {
  it("카드 · 몸 · 스냅숏을 믿을 만한 꼴로", () => {
    expect(parseTilePermCard({ requestId: "a" })).toBeNull();
    const c = parseTilePermCard({ ...card(), kind: "weird" });
    expect(c?.kind).toBe("other");
    expect(parseTilePermBody({ stream: "s", sessionEpoch: 1, ev: { t: "nope" } })).toBeNull();
    expect(body({ t: "gone", requestId: "r1", reason: "denied" }).ev).toEqual({ t: "gone", requestId: "r1", reason: "denied" });
    expect(parseTilePermSnapshot(null)).toEqual({ sessionEpoch: null, cards: [], tuiAsking: false });
    expect(parseTilePermSnapshot({ sessionEpoch: 2, cards: [card(), { bad: 1 }] }).cards.length).toBe(1);
  });
});

describe("사건 → 카드 목록", () => {
  it("request 가 세우고 gone 이 치운다(흔적 없음) · terminal 이면 흔적", () => {
    let s: TilePermState = {};
    s = applyTilePermEvent(s, body({ t: "request", card: card() })).state;
    s = applyTilePermEvent(s, body({ t: "request", card: card({ requestId: "r2" }) })).state;
    expect(s.s1.cards.map((c) => c.requestId)).toEqual(["r1", "r2"]);
    const g = applyTilePermEvent(s, body({ t: "gone", requestId: "r1", reason: "allowed" }));
    expect(g.trace).toBeNull();
    expect(g.state.s1.cards.map((c) => c.requestId)).toEqual(["r2"]);
    const tr = applyTilePermEvent(g.state, body({ t: "gone", requestId: "r2", reason: "terminal" }));
    expect(tr.trace?.kind).toBe("terminal");
    expect(tr.trace?.card.requestId).toBe("r2");
    expect(tr.state.s1.cards).toEqual([]);
    // 모르는 id 의 gone 은 그대로
    expect(applyTilePermEvent(tr.state, body({ t: "gone", requestId: "zz", reason: "denied" })).state).toBe(tr.state);
  });

  it("같은 id 는 갈음 · 새 회차면 옛 카드를 버리고 옛 회차의 request 는 무시", () => {
    let s: TilePermState = {};
    s = applyTilePermEvent(s, body({ t: "request", card: card() })).state;
    s = applyTilePermEvent(s, body({ t: "request", card: card({ input: { command: "pwd" } }) })).state;
    expect(s.s1.cards.length).toBe(1);
    s = applyTilePermEvent(s, body({ t: "request", card: card({ requestId: "n", sessionEpoch: 2 }) }, "s1", 2)).state;
    expect(s.s1).toEqual({ epoch: 2, cards: [expect.objectContaining({ requestId: "n" })] });
    const old = applyTilePermEvent(s, body({ t: "request", card: card({ requestId: "o", sessionEpoch: 1 }) }));
    expect(old.state).toBe(s);
  });

  it("auto 는 카드 없이 흔적만", () => {
    const r = applyTilePermEvent({}, body({ t: "auto", card: card({ auto: true }) }));
    expect(r.state).toEqual({});
    expect(r.trace?.kind).toBe("auto");
  });

  it("스냅숏이 다시 그린다 — 보지 않는 창(null)이면 비운다 · auto 카드는 빼고", () => {
    let s: TilePermState = applyTilePermEvent({}, body({ t: "request", card: card() })).state;
    s = applyTilePermSnapshot(s, "s1", { sessionEpoch: 3, cards: [card({ requestId: "x", sessionEpoch: 3 }), card({ requestId: "a", sessionEpoch: 3, auto: true })] });
    expect(s.s1.cards.map((c) => c.requestId)).toEqual(["x"]);
    s = applyTilePermSnapshot(s, "s1", { sessionEpoch: null, cards: [] });
    expect(s).toEqual({});
  });

  it("내 결정 뒤 카드를 걷는다", () => {
    const s = applyTilePermEvent({}, body({ t: "request", card: card() })).state;
    expect(dropTilePermCard(s, "s1", "r1").s1.cards).toEqual([]);
    expect(dropTilePermCard(s, "s1", "nope")).toBe(s);
  });
});

describe("도구별 본문", () => {
  it("command — 설명 줄 + 명령", () => {
    expect(cardBody(card())).toEqual({ kind: "command", description: "List", command: "ls" });
    expect(cardBody(card({ input: { command: "x" } }))).toEqual({ kind: "command", description: null, command: "x" });
  });

  it("edit — old → new 줄 diff · MultiEdit 는 조각 사이 gap", () => {
    const b = cardBody(card({ tool: "Edit", kind: "edit", input: { file_path: "C:/a.ts", old_string: "a\nb\nc", new_string: "a\nB\nc" } }));
    expect(b).toEqual({
      kind: "diff",
      path: "C:/a.ts",
      files: ["C:/a.ts"],
      rows: [
        { op: " ", text: "a" },
        { op: "-", text: "b" },
        { op: "+", text: "B" },
        { op: " ", text: "c" },
      ],
    });
    const m = cardBody(card({ tool: "MultiEdit", kind: "edit", input: { file_path: "f", edits: [{ old_string: "x", new_string: "y" }, { old_string: "p", new_string: "q" }] } }));
    expect(m.kind === "diff" && m.rows.map((r) => r.op)).toEqual(["-", "+", "gap", "-", "+"]);
  });

  it("write · notebook — 경로 + 새 내용 · 줄 수", () => {
    expect(cardBody(card({ tool: "Write", kind: "write", input: { file_path: "a.txt", content: "1\n2\n" } }))).toEqual({
      kind: "text",
      path: "a.txt",
      text: "1\n2\n",
      lines: 2,
      meta: null,
    });
    const nb = cardBody(card({ tool: "NotebookEdit", kind: "notebook", input: { notebook_path: "n.ipynb", cell_id: "c3", new_source: "x=1", edit_mode: "replace" } }));
    expect(nb).toEqual({ kind: "text", path: "n.ipynb", text: "x=1", lines: 1, meta: "cell c3 · replace" });
  });

  it("patch — 파일 목록 · 줄 갈래", () => {
    const raw = "*** Begin Patch\n*** Update File: b.txt\n@@\n-old\n+new\n ctx\n*** Add File: a.txt\n+hi\n*** End Patch";
    expect(patchFiles(raw)).toEqual(["a.txt", "b.txt"]);
    expect(patchRows(raw).map((r) => r.op)).toEqual(["hunk", "hunk", "-", "+", " ", "hunk", "+"]);
    const b = cardBody(card({ cli: "codex", tool: "apply_patch", kind: "patch", input: { command: raw } }));
    expect(b.kind === "diff" && [b.path, b.files]).toEqual([null, ["a.txt", "b.txt"]]);
  });

  it("fetch · search · read · mcp · other", () => {
    expect(cardBody(card({ tool: "WebFetch", kind: "fetch", input: { url: "https://x", prompt: "sum" } }))).toEqual({ kind: "fetch", url: "https://x", prompt: "sum" });
    expect(cardBody(card({ tool: "WebSearch", kind: "search", input: { query: "rust" } }))).toEqual({ kind: "search", query: "rust" });
    expect(cardBody(card({ tool: "web_search", kind: "search", input: { search_query: [{ q: "codex" }] } }))).toEqual({ kind: "search", query: "codex" });
    expect(cardBody(card({ tool: "Read", kind: "read", input: { file_path: "/a" } }))).toEqual({ kind: "read", path: "/a" });
    expect(cardBody(card({ tool: "Grep", kind: "read", input: { pattern: "foo" } }))).toEqual({ kind: "read", path: "foo" });
    expect(cardBody(card({ tool: "mcp__probe__echo", kind: "mcp", input: { text: "p1" } }))).toEqual({
      kind: "mcp",
      server: "probe",
      tool: "echo",
      args: '{\n  "text": "p1"\n}',
    });
    expect(mcpNames("mcp__my_srv__do_it", { name: "My Srv" })).toEqual({ server: "My Srv", tool: "do_it" });
    expect(cardBody(card({ tool: "Task", kind: "other", input: {} }))).toEqual({ kind: "other", tool: "Task", args: "" });
  });

  it("흔적의 대상 한 줄 · 남은 초", () => {
    expect(cardTarget(card({ input: { command: "npm test\nnpm run build" } }))).toBe("npm test");
    expect(cardTarget(card({ input: { command: "x".repeat(200) } })).length).toBe(80);
    expect(secondsLeft({ deadlineAt: 10_500 }, 0)).toBe(11);
    expect(secondsLeft({ deadlineAt: 0 }, 5000)).toBe(0);
  });
});

describe("lineDiff", () => {
  it("같으면 문맥만 · 비면 넣기만 · 크면 통째로", () => {
    expect(lineDiff("a\nb", "a\nb").every((r) => r.op === " ")).toBe(true);
    expect(lineDiff("", "x\ny")).toEqual([
      { op: "+", text: "x" },
      { op: "+", text: "y" },
    ]);
    expect(lineDiff("a\r\nb\r\n", "a\nc\n")).toEqual([
      { op: " ", text: "a" },
      { op: "-", text: "b" },
      { op: "+", text: "c" },
    ]);
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join("\n");
    const rows = lineDiff(big, "z");
    expect(rows.filter((r) => r.op === "-").length).toBe(500);
    expect(rows[rows.length - 1]).toEqual({ op: "+", text: "z" });
  });

  it("가운데 넣기 · 지우기를 최소로", () => {
    expect(lineDiff("1\n2\n3\n4", "1\n3\nX\n4").map((r) => `${r.op}${r.text}`)).toEqual([" 1", "-2", " 3", "+X", " 4"]);
  });
});

describe("명령 판결 띠", () => {
  const a = (effect: PlanAnalysis["effect"], extra: Partial<PlanAnalysis> = {}) => ({ effect, programs: [], tokens: [], sudo: false, ...extra }) as unknown as PlanAnalysis;
  it("작업안 카드와 같은 판정 — 읽기는 초록 · 삭제는 위험 · 선언 없음", () => {
    expect(commandVerdict("ls -la", a("read"))).toEqual({ tone: "ok", key: "effect", args: { found: "read" } });
    expect(commandVerdict("rm -rf /tmp/x", a("delete")).tone).toBe("err");
    expect(commandVerdict("foo", a("unknown")).tone).toBe("warn");
  });
});
