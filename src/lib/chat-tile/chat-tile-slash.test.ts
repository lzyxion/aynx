import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ChatTileCommands } from "./chat-tile-api";
import type { SlashCommandView } from "$lib/side-chat-api";
import {
  CLAUDE_SLASH,
  CODEX_SLASH,
  exactSlash,
  filterSlash,
  slashMatches,
  skillsInText,
  slashEnterSends,
  slashEntries,
  slashIntent,
  slashPending,
  slashTrigger,
  type SlashEntry,
} from "./chat-tile-slash";

const cmd = (name: string, over: Partial<SlashCommandView> = {}): SlashCommandView => ({ name, description: "", hint: "", kind: "builtin", aliases: [], ...over });

/** 실측 꼴을 줄인 Claude 목록 */
const CLAUDE: ChatTileCommands = {
  commands: [
    cmd("compact", { description: "Free up context by summarizing the conversation so far", hint: "<optional custom summarization instructions>" }),
    cmd("context", { description: "Visualize current context usage" }),
    cmd("clear", { aliases: ["reset", "new"], description: "Clear conversation history" }),
    cmd("model", { description: "Set the AI model" }),
    cmd("config", { aliases: ["settings"] }),
    cmd("code-review", { aliases: ["review"], description: "Review a pull request" }),
    cmd("docs", { kind: "skill", aliases: ["anthropic-skills:docs"], description: "(anthropic-skills) docs" }),
    cmd("my-cmd", { kind: "command", description: "(user) mine" }),
    cmd("doctor", { kind: "skill", description: "Diagnose the install" }),
    cmd("__remote-workflow"),
    cmd("workflow-launch-exec"),
    cmd("color", { aliases: ["colour"] }),
  ],
  terminal: ["doctor", "send-to-project", "colour", "focus", "reload-plugins"],
};

const CODEX: ChatTileCommands = {
  commands: [cmd("docx", { kind: "skill", description: "Word files" }), cmd("pdf", { kind: "skill", description: "PDF tools" })],
  terminal: [],
};

const by = (es: readonly SlashEntry[], name: string) => es.find((e) => e.name === name);

describe("slashTrigger", () => {
  it.each([
    ["/", 1, ""],
    ["/co", 3, "co"],
    ["/anthropic-skills:docx", 22, "anthropic-skills:docx"],
  ])("%s 커서 %d → %s", (v, c, q) => {
    expect(slashTrigger(v, c)).toBe(q);
  });

  it.each([
    ["/co ", 4],
    ["/co", 1],
    [" /x", 3],
    ["$x", 2],
    ["글 /x", 4],
    ["", 0],
  ])("%s 커서 %d → null", (v, c) => {
    expect(slashTrigger(v, c)).toBeNull();
  });
});

describe("slashEntries — Claude", () => {
  it("목록이 없으면 aynx 줄 + compact · context 고정 줄 · pending", () => {
    const es = slashEntries("claude", null);
    expect(slashPending(null)).toBe(true);
    expect(es.filter((e) => e.group === "aynx").map((e) => e.name)).toEqual(CLAUDE_SLASH.aynx.map((r) => r.name));
    expect(es.filter((e) => e.cls === "pass").map((e) => [e.name, e.insert])).toEqual([
      ["compact", "/compact "],
      ["context", "/context "],
    ]);
    // 고정 터미널 전용 이름은 친 글이 있을 때만 보이는 흐린 줄
    expect(es.filter((e) => e.cls === "terminal").every((e) => e.typed && e.insert === "")).toBe(true);
    expect(by(es, "compact")?.word).toBe("compact");
    expect(by(es, "context")?.word).toBe("context");
  });

  it("목록 — 갈래 · 무리 · 넣을 글 · 숨김 · 터미널 전용(별칭으로 알린 것 포함)", () => {
    const es = slashEntries("claude", CLAUDE);
    expect(slashPending(CLAUDE)).toBe(false);
    expect(by(es, "compact")).toMatchObject({ cls: "pass", group: "builtin", insert: "/compact ", hint: "<optional custom summarization instructions>" });
    expect(by(es, "docs")).toMatchObject({ cls: "pass", group: "skill", insert: "/docs ", aliases: ["anthropic-skills:docs"] });
    expect(by(es, "my-cmd")).toMatchObject({ cls: "pass", group: "command" });
    expect(by(es, "doctor")).toMatchObject({ cls: "terminal", group: "terminal", insert: "" });
    expect(by(es, "color")).toMatchObject({ cls: "terminal", group: "terminal" });
    expect(by(es, "config")).toMatchObject({ cls: "terminal", group: "terminal" });
    // CLI 가 알린 터미널 전용 이름은 명령 목록에 없어도 흐린 줄로
    expect(by(es, "send-to-project")).toMatchObject({ cls: "terminal" });
    // 목록에 없는 고정 (c) 이름은 친 글이 맞을 때만 보인다
    expect(by(es, "permissions")).toMatchObject({ cls: "terminal", typed: true, insert: "" });
    expect(by(es, "config")?.typed).toBe(false);
    expect(by(es, "__remote-workflow")).toBeUndefined();
    expect(by(es, "workflow-launch-exec")).toBeUndefined();
    // aynx 이름은 CLI 줄로 다시 서지 않는다 · 설명은 CLI 글이 아니라 Aynx 문구(이름마다)
    expect(es.filter((e) => e.name === "clear" || e.name === "model").map((e) => e.cls)).toEqual(["aynx", "aynx"]);
    expect(es.filter((e) => e.cls === "aynx").every((e) => e.description === "")).toBe(true);
    expect(["model", "effort", "clear", "resume", "rename", "usage"].map((n) => by(es, n)?.word)).toEqual(["model", "effort", "newChat", "conversations", "rename", "usage"]);
    expect(es.filter((e) => e.cls === "aynx").every((e) => e.insert === "" && e.action !== null)).toBe(true);
    expect(es.some((e) => e.skill)).toBe(false);
  });
});

describe("slashEntries — Codex", () => {
  it("aynx 줄 + 스킬(`$name ` · skill) · compact 는 aynx", () => {
    const es = slashEntries("codex", CODEX);
    expect(es.filter((e) => e.cls === "aynx").map((e) => [e.name, e.action])).toEqual(CODEX_SLASH.aynx.map((r) => [r.name, r.action]));
    expect(by(es, "compact")).toMatchObject({ cls: "aynx", action: "compact" });
    expect(by(es, "docx")).toMatchObject({ insert: "$docx ", skill: true, group: "skill", cls: "pass", description: "Word files" });
    // 고정 터미널 전용 이름은 친 글이 있을 때만(목록에 없으니 늘 typed)
    expect(es.filter((e) => e.cls === "terminal").map((e) => [e.name, e.typed])).toEqual(CODEX_SLASH.terminal.map((r) => [r.name, true]));
    expect(slashEntries("codex", null).every((e) => e.cls === "aynx" || e.typed)).toBe(true);
  });
});

describe("filterSlash", () => {
  const es = slashEntries("claude", CLAUDE);

  it("무리는 붙어 있고 무리 안은 이름 앞 → 별칭 앞 → 이름 안 → 설명(두 글자 이상)", () => {
    // aynx 줄의 설명은 보지 않는다(Aynx 문구) · 고정 터미널 이름(autocompact · design-consent)은 친 글이 맞을 때 흐린 줄로
    expect(filterSlash(es, "co").map((e) => e.name)).toEqual(["copy", "usage", "code-review", "compact", "context", "color", "config", "autocompact", "design-consent"]);
    expect(filterSlash(es, "rev").map((e) => e.name)).toEqual(["code-review", "design-revoke", "ultrareview"]);
    expect(filterSlash(es, "review").map((e) => e.name)).toEqual(["code-review", "ultrareview"]);
    expect(filterSlash(es, "reset").map((e) => e.name)).toEqual(["clear"]);
    expect(filterSlash(es, "summariz").map((e) => e.name)).toEqual(["compact"]);
    // 한 글자는 설명을 보지 않는다
    expect(filterSlash(es, "z").map((e) => e.name)).toEqual([]);
    expect(filterSlash(es, "CO").length).toBe(9);
    // 빈 질의는 typed 줄을 내지 않는다
    expect(filterSlash(es, "").some((e) => e.typed)).toBe(false);
  });

  it("무리 머리가 되풀이되지 않는다 — 어떤 질의든 무리가 붙어 있다", () => {
    const list: ChatTileCommands = {
      commands: [cmd("doctor", { kind: "skill" }), cmd("skill-doctor", { kind: "skill" }), cmd("docs", { kind: "skill" }), cmd("do-thing", { kind: "command" }), cmd("todo")],
      terminal: ["doctor"],
    };
    const all = slashEntries("claude", list);
    for (const q of ["", "d", "do", "doc", "doctor", "o", "co", "re"]) {
      const groups = filterSlash(all, q).map((e) => e.group);
      const runs = groups.filter((g, i) => i === 0 || groups[i - 1] !== g);
      expect([q, runs.length]).toEqual([q, new Set(runs).size]);
    }
  });

  it("빈 질의는 모두 · 무리 순(aynx → builtin → skill → command → terminal) · 최대 50", () => {
    const all = filterSlash(es, "");
    const order = ["aynx", "builtin", "skill", "command", "terminal"];
    const groups = all.map((e) => order.indexOf(e.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    const many: ChatTileCommands = { commands: Array.from({ length: 120 }, (_, i) => cmd(`s${i}`, { kind: "skill" })), terminal: [] };
    expect(filterSlash(slashEntries("codex", many), "s").length).toBe(50);
    expect(filterSlash(slashEntries("codex", many), "s", 10).length).toBe(10);
    // 상한 밖 개수는 `slashMatches` 로 센다(메뉴의 "N개 더" 줄)
    expect(slashMatches(slashEntries("codex", many), "s").length).toBe(125);
  });
});

describe("정확히 친 이름 — 다른 명령을 고르지 않는다", () => {
  const claude: ChatTileCommands = {
    commands: [
      cmd("doctor", { kind: "skill", description: "Diagnose" }),
      cmd("skill-doctor", { kind: "skill", description: "Check skills" }),
      cmd("config", { aliases: ["settings"] }),
      cmd("update-config", { kind: "skill", description: "Edit settings.json" }),
      cmd("code-review", { aliases: ["review"] }),
    ],
    terminal: ["doctor"],
  };
  const codex: ChatTileCommands = { commands: [cmd("review-agent", { kind: "skill" }), cmd("undo-helper", { kind: "skill" })], terminal: [] };

  it.each([
    ["claude", claude, "doctor", "doctor", "terminal"],
    ["claude", claude, "DOCTOR", "doctor", "terminal"],
    ["claude", claude, "config", "config", "terminal"],
    ["claude", claude, "settings", "config", "terminal"],
    ["claude", null, "config", "config", "terminal"],
    ["claude", claude, "review", "code-review", "pass"],
    ["claude", claude, "skill-doctor", "skill-doctor", "pass"],
    ["claude", claude, "new", "clear", "aynx"],
    ["codex", codex, "review", "review", "aynx"],
    ["codex", codex, "mcp", "mcp", "aynx"],
    ["codex", null, "review", "review", "aynx"],
    ["codex", codex, "init", "init", "terminal"],
  ] as const)("%s /%s → 맨 위 · 고른 줄 %s(%s)", (cli, cmds, q, name, cls) => {
    const rows = filterSlash(slashEntries(cli, cmds), q);
    const i = exactSlash(rows, q);
    expect(i).toBe(0);
    expect([rows[i].name, rows[i].cls]).toEqual([name, cls]);
    // 보내기 판정과 같은 갈래 — 흐린 줄이면 보내기도 막힌다
    if (cls === "terminal") expect(slashIntent(cli, `/${q}`, slashEntries(cli, cmds)).kind).toBe("terminal");
  });

  it.each([
    ["claude", claude, "code-review", true],
    ["claude", claude, "review", true],
    ["claude", claude, "skill-doctor", true],
    ["claude", claude, "code-rev", false],
    ["claude", claude, "doctor", false],
    ["claude", claude, "new", false],
    ["claude", claude, "mcp", false],
    ["codex", codex, "review-agent", false],
    ["codex", codex, "review", false],
  ] as const)("Enter 로 보냄 %s /%s → %s(그대로 보내는 명령을 인자 없이 정확히 친 때만)", (cli, cmds, q, want) => {
    const rows = filterSlash(slashEntries(cli, cmds), q);
    const at = Math.max(exactSlash(rows, q), 0);
    expect(slashEnterSends(rows, at, q)).toBe(want);
  });

  it("Enter 로 보냄 — 화살표로 다른 줄을 골랐으면 그 줄을 넣는다(보내지 않는다)", () => {
    const rows = filterSlash(slashEntries("claude", claude), "doctor");
    const other = rows.findIndex((e) => e.name === "skill-doctor");
    expect(other).toBeGreaterThan(0);
    expect(slashEnterSends(rows, other, "doctor")).toBe(false);
    expect(slashEnterSends([], 0, "x")).toBe(false);
  });

  it("정확히 같은 이름이 없으면 -1(부르는 쪽이 첫 고를 수 있는 줄을 고른다)", () => {
    expect(exactSlash(filterSlash(slashEntries("claude", claude), "doc"), "doc")).toBe(-1);
    expect(exactSlash(filterSlash(slashEntries("claude", claude), ""), "")).toBe(-1);
  });
});

describe("slashIntent — Claude /code-review ultra(과금 클라우드 리뷰)는 터미널 전용", () => {
  const withAlias = slashEntries("claude", { commands: [cmd("code-review", { aliases: ["cr"] })], terminal: [] });
  const none = slashEntries("claude", null);
  it.each([
    ["/code-review ultra", "terminal"],
    ["/code-review ULTRA", "terminal"],
    ["/Code-Review ultra 123 --x", "terminal"],
    ["  /code-review   ultra", "terminal"],
    ["/review ultra", "terminal"],
    ["/cr ultra", "terminal"],
    ["/ultrareview", "terminal"],
    ["/code-review", "send"],
    ["/code-review low", "send"],
    ["/code-review 123", "send"],
    ["/code-review ultrafoo", "send"],
    ["/code-review low ultra", "send"],
    ["/cr low", "send"],
  ] as const)("%s → %s", (text, kind) => {
    expect(slashIntent("claude", text, withAlias).kind).toBe(kind);
    if (kind === "terminal" && !text.includes("ultrareview")) expect(slashIntent("claude", text, withAlias)).toEqual({ kind: "terminal", name: "code-review ultra" });
  });
  it("목록이 없어도 고정 별칭 review 는 막고 · 알리지 않은 별칭은 보낸다 · Codex 는 이 규칙 밖", () => {
    expect(slashIntent("claude", "/review ultra", none)).toEqual({ kind: "terminal", name: "code-review ultra" });
    expect(slashIntent("claude", "/cr ultra", none).kind).toBe("send");
    expect(slashIntent("codex", "/code-review ultra", slashEntries("codex", null)).kind).toBe("send");
  });
});

describe("slashIntent — 갈래 표", () => {
  const claude = slashEntries("claude", CLAUDE);
  const claudeNone = slashEntries("claude", null);
  const codex = slashEntries("codex", CODEX);

  const claudeAynx: [string, string][] = CLAUDE_SLASH.aynx.flatMap((r) => [r.name, ...r.aliases].map((n): [string, string] => [n, r.action]));
  it.each(claudeAynx)("Claude (b) /%s → aynx %s(목록 없어도)", (name, action) => {
    for (const es of [claude, claudeNone]) {
      expect(slashIntent("claude", `/${name}`, es)).toMatchObject({ kind: "aynx", action, args: "" });
      // `argsTerminal` 의 이름은 인자가 있으면 (c)
      if (CLAUDE_SLASH.argsTerminal.includes(name)) expect(slashIntent("claude", `/${name.toUpperCase()} x`, es)).toEqual({ kind: "terminal", name: name.toUpperCase() });
      else expect(slashIntent("claude", `/${name.toUpperCase()} x`, es)).toMatchObject({ kind: "aynx", action, args: "x" });
    }
  });

  const claudeTerminal = CLAUDE_SLASH.terminal.flatMap((r) => [r.name, ...r.aliases]);
  it.each(claudeTerminal)("Claude (c) 고정 /%s → terminal(목록 없어도)", (name) => {
    expect(slashIntent("claude", `/${name}`, claudeNone)).toEqual({ kind: "terminal", name });
    expect(slashIntent("claude", `/${name} 인자`, claude)).toEqual({ kind: "terminal", name });
  });

  it.each(["doctor", "send-to-project", "colour", "color", "focus", "reload-plugins"])("Claude CLI 가 알린 터미널 전용 /%s → terminal(별칭 포함)", (name) => {
    expect(slashIntent("claude", `/${name}`, claude)).toEqual({ kind: "terminal", name });
  });

  const codexAynx: [string, string][] = CODEX_SLASH.aynx.filter((r) => r.action !== "compact").map((r): [string, string] => [r.name, r.action]);
  it.each(codexAynx)("Codex (b) /%s → aynx %s", (name, action) => {
    expect(slashIntent("codex", `/${name}`, codex)).toMatchObject({ kind: "aynx", action });
  });

  it.each(CODEX_SLASH.terminal.map((r) => r.name))("Codex (c) /%s → terminal", (name) => {
    expect(slashIntent("codex", `/${name}`, codex)).toEqual({ kind: "terminal", name });
  });

  it("되감기 — Claude /rewind · /checkpoint 는 Aynx 동작(인자 있어도 · 목록에 있어도) · Codex /undo · /rewind 는 글로 간다", () => {
    const listed = slashEntries("claude", { commands: [...CLAUDE.commands, cmd("rewind", { aliases: ["checkpoint"] })], terminal: [] });
    for (const es of [claude, claudeNone, listed]) {
      expect(slashIntent("claude", "/rewind", es)).toEqual({ kind: "aynx", action: "rewind", name: "rewind", args: "" });
      expect(slashIntent("claude", "/checkpoint", es)).toEqual({ kind: "aynx", action: "rewind", name: "rewind", args: "" });
      expect(slashIntent("claude", "/rewind 3", es)).toEqual({ kind: "aynx", action: "rewind", name: "rewind", args: "3" });
    }
    expect(listed.filter((e) => e.name === "rewind")).toEqual([expect.objectContaining({ cls: "aynx", action: "rewind", insert: "" })]);
    expect(CODEX_SLASH.terminal.some((r) => r.name === "undo")).toBe(false);
    expect(slashIntent("codex", "/undo", codex)).toEqual({ kind: "send" });
    expect(slashIntent("codex", "/rewind", codex)).toEqual({ kind: "send" });
    expect(slashEntries("codex", CODEX).some((e) => e.name === "undo" || e.name === "rewind")).toBe(false);
  });

  it("모델 · 강도는 인자가 있어도 보내지 않는다", () => {
    expect(slashIntent("claude", "/model sonnet", claude)).toEqual({ kind: "aynx", action: "model", name: "model", args: "sonnet" });
    expect(slashIntent("claude", "/effort high", claudeNone)).toEqual({ kind: "aynx", action: "model", name: "effort", args: "high" });
    expect(slashIntent("codex", "/model gpt-5", codex)).toEqual({ kind: "aynx", action: "model", name: "model", args: "gpt-5" });
  });

  it("MCP 상태 — Claude /mcp 는 Aynx 동작 · 하위 명령은 터미널 · Codex 는 인자를 버린다", () => {
    const listed = slashEntries("claude", { commands: [...CLAUDE.commands, cmd("mcp", { hint: "[reconnect|enable|disable [<server>|all]]" })], terminal: [] });
    for (const es of [claude, claudeNone, listed]) {
      expect(slashIntent("claude", "/mcp", es)).toEqual({ kind: "aynx", action: "mcpStatus", name: "mcp", args: "" });
      expect(slashIntent("claude", "/mcp   ", es)).toEqual({ kind: "aynx", action: "mcpStatus", name: "mcp", args: "" });
      expect(slashIntent("claude", "/mcp enable x", es)).toEqual({ kind: "terminal", name: "mcp" });
      expect(slashIntent("claude", "/mcp reconnect", es)).toEqual({ kind: "terminal", name: "mcp" });
    }
    expect(listed.filter((e) => e.name === "mcp")).toEqual([expect.objectContaining({ cls: "aynx", action: "mcpStatus", insert: "" })]);
    expect(slashIntent("codex", "/mcp", codex)).toEqual({ kind: "aynx", action: "mcpStatus", name: "mcp", args: "" });
    expect(slashIntent("codex", "/mcp list x", codex)).toMatchObject({ kind: "aynx", action: "mcpStatus" });
  });

  it("목표 — Claude /goal 은 글로 간다(CLI 목록의 내장 줄) · Codex /goal 은 카드 · 글은 미리 채움", () => {
    const listed = slashEntries("claude", { commands: [...CLAUDE.commands, cmd("goal", { description: "Set a goal" })], terminal: [] });
    for (const es of [claude, claudeNone, listed]) {
      expect(slashIntent("claude", "/goal 시험 통과", es)).toEqual({ kind: "send" });
      expect(slashIntent("claude", "/goal", es)).toEqual({ kind: "send" });
      expect(slashIntent("claude", "/goal clear", es)).toEqual({ kind: "send" });
    }
    expect(listed.filter((e) => e.name === "goal")).toEqual([expect.objectContaining({ cls: "pass", insert: "/goal " })]);
    expect(CLAUDE_SLASH.terminal.some((r) => r.name === "goal" || r.name === "mcp")).toBe(false);
    expect(slashIntent("codex", "/goal 모든 시험이 지날 때까지", codex)).toEqual({ kind: "aynx", action: "goal", name: "goal", args: "모든 시험이 지날 때까지" });
    expect(slashIntent("codex", "/goal", codex)).toEqual({ kind: "aynx", action: "goal", name: "goal", args: "" });
  });

  it("검토 — Codex /review 는 카드(글은 직접 지시에) · Claude /review · /code-review · /security-review 는 글로", () => {
    expect(slashIntent("codex", "/review 인증만", codex)).toEqual({ kind: "aynx", action: "review", name: "review", args: "인증만" });
    expect(slashIntent("codex", "/review", slashEntries("codex", null))).toEqual({ kind: "aynx", action: "review", name: "review", args: "" });
    for (const text of ["/review", "/review low", "/code-review", "/security-review"]) expect(slashIntent("claude", text, claude)).toEqual({ kind: "send" });
    expect(slashIntent("codex", "/code-review", codex)).toEqual({ kind: "send" });
  });

  it("속도 — Codex /fast 는 모델 메뉴 · Claude /fast 는 터미널(SDK 에서 안 된다)", () => {
    expect(slashIntent("codex", "/fast", codex)).toEqual({ kind: "aynx", action: "fast", name: "fast", args: "" });
    expect(slashIntent("codex", "/fast on", codex)).toMatchObject({ kind: "aynx", action: "fast" });
    for (const es of [claude, claudeNone]) {
      expect(slashIntent("claude", "/fast", es)).toEqual({ kind: "terminal", name: "fast" });
      expect(slashIntent("claude", "/fast on", es)).toEqual({ kind: "terminal", name: "fast" });
    }
  });

  it("Codex 에 Claude 이름 · Claude 에 Codex 카드를 짓지 않는다", () => {
    expect(CODEX_SLASH.aynx.map((r) => r.name)).toEqual(expect.arrayContaining(["review", "goal", "mcp", "fast"]));
    expect(CODEX_SLASH.aynx.some((r) => r.name === "code-review")).toBe(false);
    expect(CLAUDE_SLASH.aynx.some((r) => r.action === "review" || r.action === "goal" || r.action === "fast")).toBe(false);
    for (const n of ["review", "mcp", "fast", "goal"]) expect(CODEX_SLASH.terminal.some((r) => r.name === n)).toBe(false);
  });

  it("압축 — Codex 는 compact · Claude 는 글로 보낸다", () => {
    expect(slashIntent("codex", "/COMPACT", codex)).toEqual({ kind: "compact" });
    expect(slashIntent("codex", "/compact", codex)).toEqual({ kind: "compact" });
    expect(slashIntent("claude", "/compact x", claude)).toEqual({ kind: "send" });
    expect(slashIntent("claude", "/compact", claudeNone)).toEqual({ kind: "send" });
  });

  it("보내는 것 — (a) · 숨김 · 목록에 없는 /x · 경로 · 보통 글 · 글 중간의 /", () => {
    for (const text of [
      "/context",
      "/code-review",
      "/review 12",
      "/docs",
      "/anthropic-skills:docs",
      "/my-cmd",
      "/__remote-workflow",
      "/workflow-launch-exec x",
      "/nope",
      "/x",
      "/etc/hosts x",
      "/usr/bin",
      "/usr/bin/env",
      "/c:/work",
      "안녕 /doctor",
      "doctor",
      "$docx 표",
      "",
    ]) {
      expect([text, slashIntent("claude", text, claude)]).toEqual([text, { kind: "send" }]);
    }
    expect(slashIntent("codex", "/nope", codex)).toEqual({ kind: "send" });
    expect(slashIntent("codex", "/etc/hosts", codex)).toEqual({ kind: "send" });
  });

  it("앞 빈칸 · 줄바꿈 인자도 같은 판정", () => {
    expect(slashIntent("claude", "  /doctor", claude)).toEqual({ kind: "terminal", name: "doctor" });
    expect(slashIntent("claude", "/model\nsonnet", claude)).toMatchObject({ kind: "aynx", action: "model" });
  });
});

describe("skillsInText", () => {
  it("글에 `$name` 낱말이 남은 고른 스킬만 · 순서 · 겹침 없음", () => {
    expect(skillsInText("$docx 표 만들어 줘", ["docx"])).toEqual(["docx"]);
    expect(skillsInText("표 만들어 줘", ["docx"])).toEqual([]);
    expect(skillsInText("$docxx 표", ["docx"])).toEqual([]);
    expect(skillsInText("a$docx", ["docx"])).toEqual([]);
    expect(skillsInText("$pdf 와 $docx", ["docx", "pdf", "docx"])).toEqual(["docx", "pdf"]);
    expect(skillsInText("$a:b 해 줘", ["a:b"])).toEqual(["a:b"]);
    expect(skillsInText("$a.b", ["a"])).toEqual([]);
  });
});

describe("모듈", () => {
  it("값 import 가 없다 · 표는 얼린 상수", () => {
    const src = readFileSync(new URL("./chat-tile-slash.ts", import.meta.url), "utf8");
    for (const m of src.matchAll(/^import\s+(.+?)\s+from/gm)) expect(m[1].startsWith("type ")).toBe(true);
    expect(Object.isFrozen(CLAUDE_SLASH)).toBe(true);
    expect(Object.isFrozen(CLAUDE_SLASH.terminal)).toBe(true);
    expect(Object.isFrozen(CODEX_SLASH.aynx[0])).toBe(true);
  });

  it("스킬 경로를 싣지 않는다 — 넣는 글은 이름뿐", () => {
    const es = slashEntries("codex", { commands: [cmd("docx", { kind: "skill", description: "C:/x/SKILL.md 아님" })], terminal: [] });
    for (const e of es) expect(Object.keys(e).sort()).toEqual(["action", "aliases", "cls", "description", "group", "hint", "insert", "name", "skill", "typed", "word"]);
  });
});
