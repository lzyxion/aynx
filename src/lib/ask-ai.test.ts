import { describe, expect, it } from "vitest";
import {
  askOutputTail,
  askSummary,
  buildAskText,
  defaultCliId,
  pasteBytes,
  planAskTarget,
  readyForPaste,
  ASK_QUIET_MS,
  sanitizeForPaste,
  withSideChatRow,
  type AskCli,
  type AskInput,
  type AskTile,
} from "$lib/ask-ai";
import type { Tr } from "$lib/session";
import { translate } from "$lib/i18n/dict";

/**
 * 명령 블록을 AI 타일에 넘기기 — 순수 규칙 (docs/log/2026-09-28-ask-ai-block.md).
 *
 * 글(부탁 한 문장 · 호스트·폴더 · 명령·종료 코드·시간 · 출력 끝부분) · 받을 타일(곧장 · 고르기 · 새로 열기) ·
 * 새 타일의 준비 · 붙여 넣는 바이트(괄호 붙여넣기)를 표로 본다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

const base: AskInput = {
  commandLine: "npm run build",
  exit: 2,
  durationMs: 3100,
  host: "dev-01",
  cwd: "~/app",
  output: {
    lines: [
      "> app@1.8.3 build",
      "> tsc -p . && vite build",
      "",
      "src/routes/api.ts:41:18 - error TS2339:",
      "  Property 'userId' does not exist on type 'Session'.",
    ],
    droppedBefore: 0,
  },
};

describe("buildAskText — 목업의 글 그대로", () => {
  it("실패한 블록 — 부탁 한 문장 · 호스트·폴더 · 명령 → 종료 코드 · 시간 · 출력 끝", () => {
    expect(buildAskText(base, ko)).toBe(
      [
        "이 명령이 실패했어. 원인을 봐 줘.",
        "호스트 dev-01 · 폴더 ~/app",
        "$ npm run build  → 종료 코드 2 · 3.1초",
        "출력 끝 5줄:",
        "> app@1.8.3 build",
        "> tsc -p . && vite build",
        "",
        "src/routes/api.ts:41:18 - error TS2339:",
        "  Property 'userId' does not exist on type 'Session'.",
        "",
      ].join("\n"),
    );
  });

  it("성공한 블록은 중립 문장, 종료 코드를 모르는 블록도 중립", () => {
    expect(buildAskText({ ...base, exit: 0 }, ko).split("\n")[0]).toBe("이 명령의 결과를 봐 줘.");
    const unknown = buildAskText({ ...base, exit: null }, ko).split("\n");
    expect(unknown[0]).toBe("이 명령의 결과를 봐 줘.");
    expect(unknown[2]).toBe("$ npm run build  → 종료 코드 모름 · 3.1초");
  });

  it("폴더를 모르면 호스트만 · 시간을 모르면 시간 토막이 없다", () => {
    const lines = buildAskText({ ...base, cwd: null, durationMs: null }, ko).split("\n");
    expect(lines[1]).toBe("호스트 dev-01");
    expect(lines[2]).toBe("$ npm run build  → 종료 코드 2");
  });

  it("출력이 없으면 '출력 없음', 못 읽었으면 그렇다고 말한다(없던 것처럼 적지 않는다)", () => {
    expect(buildAskText({ ...base, output: { lines: [], droppedBefore: 0 } }, ko)).toContain("\n출력 없음\n");
    expect(buildAskText({ ...base, output: null }, ko)).toContain("(출력은 화면에서 밀려나 담지 못했어)");
  });

  it("40줄을 넘으면 앞을 버리고 '(앞 N줄 생략)' 한 줄을 남긴다", () => {
    const lines = Array.from({ length: 352 }, (_, i) => `line ${i + 1}`);
    const text = buildAskText({ ...base, output: { lines, droppedBefore: 0 } }, ko).split("\n");
    expect(text[3]).toBe("출력 끝 40줄:");
    expect(text[4]).toBe("(앞 312줄 생략)");
    expect(text[5]).toBe("line 313");
    expect(text.at(-2)).toBe("line 352");
  });

  it("발췌가 가운데를 버렸으면(몇 줄인지 모른다) '(앞부분 생략)'", () => {
    const text = buildAskText({ ...base, output: { lines: ["a", "b"], droppedBefore: "some" } }, ko);
    expect(text).toContain("출력 끝 2줄:\n(앞부분 생략)\na\nb\n");
  });

  it("끝은 줄바꿈 하나 — 커서가 다음 줄 첫 칸에 선다(보내지 않는다)", () => {
    const text = buildAskText(base, ko);
    expect(text.endsWith("Session'.\n")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("제어 문자는 걷는다 — ESC 가 괄호 붙여넣기를 스스로 닫지 못하게", () => {
    const text = buildAskText({ ...base, commandLine: "echo \x1b[201~rm -rf /", output: { lines: ["a\x07b"], droppedBefore: 0 } }, ko);
    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\x07");
    expect(text).toContain("$ echo [201~rm -rf /");
  });

  it("영어 사전을 지난다", () => {
    const text = buildAskText(base, en).split("\n");
    expect(text[0]).toBe("This command failed. Please look into why.");
    expect(text[1]).toBe("Host dev-01 · folder ~/app");
    expect(text[2]).toBe("$ npm run build  → exit code 2 · 3.1s");
    expect(text[3]).toBe("Last 5 lines of output:");
  });
});

describe("askOutputTail — 40줄 · 8 KB, 넘치면 앞을 버린다", () => {
  it("끝의 빈 줄은 버린다", () => {
    expect(askOutputTail({ lines: ["a", "b", "", "  "], droppedBefore: 0 })).toEqual({ lines: ["a", "b"], omitted: 0 });
  });

  it("바이트 상한은 뒤에서부터 채운다", () => {
    const big = "x".repeat(3000);
    const r = askOutputTail({ lines: [big, big, big, "tail"], droppedBefore: 0 });
    expect(r.lines).toEqual([big, big, "tail"]);
    expect(r.omitted).toBe(1);
  });

  it("한 줄이 이미 상한보다 길면 그 줄의 끝만 남긴다", () => {
    const r = askOutputTail({ lines: ["a", "y".repeat(10_000) + "END"], droppedBefore: 0 }, { tailLines: 40, tailBytes: 100 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].endsWith("END")).toBe(true);
    expect(r.lines[0].length).toBe(100);
    expect(r.omitted).toBe(1);
  });

  it("한글은 UTF-8 바이트로 잰다", () => {
    const r = askOutputTail({ lines: ["가나다", "라마바"], droppedBefore: 0 }, { tailLines: 40, tailBytes: 12 });
    expect(r.lines).toEqual(["라마바"]); // 9바이트 + 줄바꿈 = 10, 둘이면 20
    expect(r.omitted).toBe(1);
  });

  it("앞에서 이미 버린 줄 수를 더한다 · 모르면 모른다", () => {
    expect(askOutputTail({ lines: ["a"], droppedBefore: 5 }).omitted).toBe(5);
    expect(askOutputTail({ lines: ["a"], droppedBefore: "some" }).omitted).toBe("some");
  });
});

describe("askSummary — 상자 머리", () => {
  it("첫 줄 · 종료 코드", () => {
    expect(askSummary("npm run build", 2, ko)).toBe("npm run build · 종료 2");
    expect(askSummary("make\n  all", 0, ko)).toBe("make · 종료 0");
    expect(askSummary("ls", null, ko)).toBe("ls");
  });
  it("길면 말줄임", () => {
    expect(askSummary("a".repeat(50), 1, ko, 10)).toBe(`${"a".repeat(9)}… · 종료 1`);
  });
});

const tile = (over: Partial<AskTile>): AskTile => ({
  paneId: "pane-2",
  tabId: "t1",
  ai: "claude",
  name: "Claude Code",
  code: "p2",
  tabTitle: "api 배포",
  tabIndex: 1,
  status: null,
  lastFocusedAt: null,
  ...over,
});
const CLIS: AskCli[] = [
  { id: "claude", name: "Claude Code", command: "claude" },
  { id: "codex", name: "Codex", command: "codex" },
];

describe("planAskTarget — 받을 타일", () => {
  it("이 탭에 AI 타일이 하나면 묻지 않고 그 타일 (다른 탭에 더 있어도)", () => {
    const plan = planAskTarget({
      tiles: [tile({}), tile({ paneId: "pane-7", tabId: "t2", tabIndex: 2 })],
      currentTabId: "t1",
      sourcePaneId: "pane-1",
      clis: CLIS,
      defaultCli: null,
    });
    expect(plan).toEqual({ mode: "direct", tile: tile({}) });
  });

  it("여럿이면 상자 — 이 탭 먼저(최근 쓴 것 위) · 다른 탭 · 새로 열기, 마지막에 쓴 것이 골라진 채", () => {
    const plan = planAskTarget({
      tiles: [
        tile({ paneId: "pane-3", ai: "codex", name: "Codex", code: "p3", status: "running", lastFocusedAt: 100 }),
        tile({ paneId: "pane-2", lastFocusedAt: 200 }),
        tile({ paneId: "pane-7", tabId: "t2", tabIndex: 2, code: "p7", tabTitle: "리뷰" }),
      ],
      currentTabId: "t1",
      sourcePaneId: "pane-1",
      clis: CLIS,
      defaultCli: null,
    });
    if (plan.mode !== "pick") throw new Error("pick");
    const shape = plan.rows.map((r) =>
      r.kind === "tile"
        ? `${r.group}:${r.tile.code}${r.busy ? ":busy" : ""}${r.last ? ":last" : ""}`
        : r.kind === "new"
          ? `new:${r.cli.id}${r.isDefault ? ":default" : ""}`
          : `side:${r.title}`,
    );
    expect(shape).toEqual(["here:p2:last", "here:p3:busy", "other:p7", "new:claude", "new:codex"]);
    expect(plan.selected).toBe(0);
    expect(plan.hasTiles).toBe(true);
  });

  it("다른 탭에만 있으면 상자 — 마지막에 쓴 것이 다른 탭이어도 그것이 골라진다", () => {
    const plan = planAskTarget({
      tiles: [tile({ paneId: "pane-7", tabId: "t2", lastFocusedAt: 5 }), tile({ paneId: "pane-8", tabId: "t3" })],
      currentTabId: "t1",
      sourcePaneId: "pane-1",
      clis: CLIS,
      defaultCli: null,
    });
    if (plan.mode !== "pick") throw new Error("pick");
    expect(plan.rows[plan.selected]).toMatchObject({ kind: "tile", tile: { paneId: "pane-7" }, last: true });
  });

  it("아무도 포커스한 적 없으면 첫 타일 줄", () => {
    const plan = planAskTarget({
      tiles: [tile({ paneId: "pane-2" }), tile({ paneId: "pane-3" })],
      currentTabId: "t1",
      sourcePaneId: "pane-1",
      clis: CLIS,
      defaultCli: null,
    });
    if (plan.mode !== "pick") throw new Error("pick");
    expect(plan.selected).toBe(0);
    expect(plan.rows.some((r) => r.kind === "tile" && r.last)).toBe(false);
  });

  it("없으면 새로 열기 줄만 — 기본(마지막에 쓴 CLI)이 위에, 골라진 채, '기본' 부연", () => {
    const plan = planAskTarget({ tiles: [], currentTabId: "t1", sourcePaneId: "pane-1", clis: CLIS, defaultCli: "codex" });
    if (plan.mode !== "pick") throw new Error("pick");
    expect(plan.hasTiles).toBe(false);
    expect(plan.rows.map((r) => (r.kind === "new" ? `${r.cli.id}${r.isDefault ? "*" : ""}` : "tile"))).toEqual(["codex*", "claude"]);
    expect(plan.selected).toBe(0);
  });

  it("원본 타일 자신은 받는 쪽이 아니다", () => {
    const plan = planAskTarget({ tiles: [tile({ paneId: "pane-1" })], currentTabId: "t1", sourcePaneId: "pane-1", clis: CLIS, defaultCli: null });
    expect(plan.mode).toBe("pick");
  });

  it("기본 CLI — 마지막에 쓴 것 → claude → 첫 줄", () => {
    expect(defaultCliId(CLIS, "codex")).toBe("codex");
    expect(defaultCliId(CLIS, "gemini")).toBe("claude");
    expect(defaultCliId(CLIS, null)).toBe("claude");
    expect(defaultCliId([{ id: "codex", name: "Codex", command: "codex" }], null)).toBe("codex");
    expect(defaultCliId([], null)).toBe(null);
  });
});

describe("readyForPaste — 새 AI 타일", () => {
  const ok = { now: 1500 + ASK_QUIET_MS, commandStartedAt: 1000, lastOutputAt: 1500, bracketedPaste: true };
  it("CLI 가 시작됐고 괄호 붙여넣기 모드이고 그린 뒤 조용해졌으면 준비됨", () => {
    expect(readyForPaste(ok)).toBe(true);
  });
  it("CLI 를 아직 안 띄웠으면(셸 프롬프트뿐) 아니다", () => {
    expect(readyForPaste({ ...ok, commandStartedAt: null })).toBe(false);
  });
  it("괄호 붙여넣기 모드가 아니면 아니다(여러 줄이 줄마다 보내진다)", () => {
    expect(readyForPaste({ ...ok, bracketedPaste: false })).toBe(false);
  });
  it("그리는 중이면 아니다 · 시작 뒤 출력이 없으면 아니다", () => {
    expect(readyForPaste({ ...ok, now: 1500 + ASK_QUIET_MS - 1 })).toBe(false);
    expect(readyForPaste({ ...ok, lastOutputAt: 900 })).toBe(false);
    expect(readyForPaste({ ...ok, lastOutputAt: null })).toBe(false);
  });
});

describe("pasteBytes — xterm paste() 와 같은 변환", () => {
  it("괄호로 감싸고 줄바꿈은 CR", () => {
    expect(pasteBytes("a\nb\n", true)).toBe("\x1b[200~a\rb\r\x1b[201~");
  });
  it("모드가 꺼져 있으면 넣지 않는다", () => {
    expect(pasteBytes("a\nb", false)).toBe(null);
  });
  it("안쪽의 ESC 는 걷는다", () => {
    expect(pasteBytes("x\x1b[201~y", true)).toBe("\x1b[200~x[201~y\x1b[201~");
    expect(sanitizeForPaste("a\tb\r\nc\u009bd")).toBe("a\tb\ncd");
  });
});

describe("withSideChatRow — [AI에게 묻기] → 사이드 채팅 줄(v2 5단계 · 결정 11)", () => {
  const pick = () =>
    planAskTarget({
      tiles: [tile({ paneId: "pane-2", lastFocusedAt: 200 }), tile({ paneId: "pane-3", code: "p3" })],
      currentTabId: "t1",
      sourcePaneId: "pane-1",
      clis: CLIS,
      defaultCli: null,
    });
  const shape = (rows: readonly { kind: string }[]) => rows.map((r) => r.kind);

  it("타일 줄 뒤 · 새로 열기 줄 앞에 하나 — 골라진 줄은 그대로(밀린 만큼 번호만)", () => {
    const base = pick();
    if (base.mode !== "pick") throw new Error("pick");
    const plan = withSideChatRow(base, "빌드 실패 원인");
    if (plan.mode !== "pick") throw new Error("pick");
    expect(shape(plan.rows)).toEqual(["tile", "tile", "sideChat", "new", "new"]);
    expect(plan.rows[2]).toEqual({ kind: "sideChat", title: "빌드 실패 원인" });
    expect(plan.rows[plan.selected]).toEqual(base.rows[base.selected]);
  });

  it("타일이 없으면 맨 위 · 기본 CLI 줄이 골라진 채 그대로", () => {
    const base = planAskTarget({ tiles: [], currentTabId: "t1", sourcePaneId: "pane-1", clis: CLIS, defaultCli: "codex" });
    if (base.mode !== "pick") throw new Error("pick");
    const plan = withSideChatRow(base, "새 채팅");
    if (plan.mode !== "pick") throw new Error("pick");
    expect(shape(plan.rows)).toEqual(["sideChat", "new", "new"]);
    const sel = plan.rows[plan.selected];
    expect(sel.kind === "new" && sel.cli.id).toBe("codex");
  });

  it("주 창이 아니면(null) · 곧장 넘기는 답이면 건드리지 않는다", () => {
    const base = pick();
    expect(withSideChatRow(base, null)).toBe(base);
    const direct = planAskTarget({ tiles: [tile({})], currentTabId: "t1", sourcePaneId: "pane-1", clis: CLIS, defaultCli: null });
    expect(withSideChatRow(direct, "x")).toBe(direct);
  });
});
