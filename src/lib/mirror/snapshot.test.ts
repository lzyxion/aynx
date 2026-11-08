import { describe, expect, it } from "vitest";
import type { PaneSpec, TabSpec } from "$lib/session/spec";
import { MAX_WORKSPACES, MIRROR_VERSION, buildSnapshot, parseSnapshot, sanitizePane, sanitizeView } from "./snapshot";

// 원격 웹 R2-B — 집 PC 화면 거울의 스냅숏은 허용 칸만 싣는다(실행 재료 · 토큰 표식 · 화면 버퍼는 원격으로 가지 않는다).

const aiLocal: PaneSpec = {
  id: "pane-3",
  kind: "local",
  tileKey: "t-3",
  shell: "pwsh",
  historyStreamId: "s-abc",
  autorun: "claude --dangerously-skip-permissions",
  cwd: "C:/work",
  injectMcpToken: true,
  openDelay: 300,
  setup: { projectId: "p", repo: "C:/r", agent: "claude", agentName: "Claude" },
  restart: { autorun: "claude", cwd: "C:/work", injectMcpToken: true },
  restore: { sessionId: 4, buffer: "secret-ish screen", consumed: 10 },
};

describe("sanitizePane", () => {
  it("drops one-shot run material, token markers and screen buffers", () => {
    const out = sanitizePane(aiLocal);
    expect(out).toEqual({ id: "pane-3", kind: "local", tileKey: "t-3", shell: "pwsh", historyStreamId: "s-abc" });
    for (const k of ["autorun", "cwd", "injectMcpToken", "openDelay", "setup", "restart", "restore", "worktree"]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("keeps the tile ↔ conversation link (the remote convo face needs it before any hook signal)", () => {
    const link = { agent: "codex", id: "01a15df4-bbbe-7391-98a6-4cc21f8c4880" };
    const out = sanitizePane({ ...aiLocal, agentLink: link });
    expect(out.agentLink).toEqual(link);
    expect(out.agentLink).not.toBe(link);
  });

  it("keeps the screen addresses of non-terminal tiles and copies objects", () => {
    const sftp: PaneSpec = { id: "pane-5", kind: "sftp", alias: "web-01", sourcePaneId: "pane-4", path: "/var/log", fileView: "icons" };
    expect(sanitizePane(sftp)).toEqual(sftp);
    const diff: PaneSpec = { id: "pane-6", kind: "diff", diff: { projectId: "p1", scope: "branch", branch: "main", name: "x" } };
    const out = sanitizePane(diff);
    expect(out.diff).toEqual(diff.diff);
    expect(out.diff).not.toBe(diff.diff); // 원본 객체를 매달지 않는다
    const ssh: PaneSpec = { id: "pane-7", kind: "ssh", alias: "dev", tmux: "aynx-1", deferred: true, adhoc: { host: "h", user: "u" } };
    expect(sanitizePane(ssh)).toEqual(ssh);
  });

  it("keeps only the address of a query tile", () => {
    const q: PaneSpec = { id: "pane-8", kind: "query", tileKey: "k8", query: { connId: "c1", sql: "select 1", name: "app.db" } };
    expect(sanitizePane(q)).toEqual(q);
    const broken = { id: "pane-9", kind: "query", query: { sql: "x" } } as unknown as PaneSpec;
    expect(sanitizePane(broken)).toEqual({ id: "pane-9", kind: "query" });
  });
});

function tab(id: string, root: TabSpec["root"], extra: Partial<TabSpec> = {}): TabSpec {
  return { id, title: id, root, ...extra };
}

describe("buildSnapshot · parseSnapshot", () => {
  const tabs: TabSpec[] = [
    tab("tab-1", { type: "leaf", pane: aiLocal }, { tabKey: "tk1", name: "배포", zoomedPaneId: null }),
    tab(
      "tab-2",
      {
        type: "split",
        dir: "row",
        ratio: 0.4,
        a: { type: "leaf", pane: { id: "pane-10", kind: "local", historyStreamId: "s-10" } },
        b: { type: "leaf", pane: { id: "pane-11", kind: "local", historyStreamId: "s-11", cwd: "D:/" } },
      },
      { tabKey: "tk2", zoomedPaneId: "pane-11" },
    ),
  ];
  const snap = buildSnapshot({
    source: "home",
    workspace: { id: "w1", name: "Home" },
    tabs,
    activeTabId: "tab-2",
    focusOf: (t) => (t.id === "tab-2" ? "pane-11" : "pane-3"),
  });

  it("walks every tab in order with focus and zoom", () => {
    expect(snap.v).toBe(MIRROR_VERSION);
    expect(snap.activeTabId).toBe("tab-2");
    expect(snap.tabs.map((t) => [t.id, t.tabKey, t.focus])).toEqual([
      ["tab-1", "tk1", "pane-3"],
      ["tab-2", "tk2", "pane-11"],
    ]);
    expect(snap.tabs[0].name).toBe("배포");
    expect(snap.tabs[1].zoomedPaneId).toBe("pane-11");
    expect(JSON.stringify(snap)).not.toContain("claude");
    expect(JSON.stringify(snap)).not.toContain("D:/");
  });

  it("round-trips through JSON", () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("rejects other versions and broken shapes, keeps good tabs", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ ...snap, v: 99 })).toBeNull();
    const mixed = JSON.parse(JSON.stringify(snap));
    mixed.tabs.push({ id: "bad", root: { type: "split", dir: "diag", a: null, b: null } });
    expect(parseSnapshot(mixed)?.tabs.length).toBe(2);
  });

  it("re-sanitizes what it receives", () => {
    const evil = JSON.parse(JSON.stringify(snap));
    evil.tabs[0].root.pane.autorun = "rm -rf ~";
    evil.tabs[0].root.pane.injectMcpToken = true;
    const parsed = parseSnapshot(evil)!;
    const leaf = parsed.tabs[0].root;
    expect(leaf.type === "leaf" && leaf.pane.autorun).toBeFalsy();
    expect(leaf.type === "leaf" && leaf.pane.injectMcpToken).toBeFalsy();
  });
});

describe("views — 타일의 보이는 모습(10-16)", () => {
  it("AI 종류 · 상태 · 폴더 한 토막만 — 경로 원문 · 모르는 값은 버린다", () => {
    expect(sanitizeView({ ai: "claude", agent: "permission", folder: "C:\\Users\\me\\proj", cmd: "claude --x", token: "t" })).toEqual({
      ai: "claude",
      agent: "permission",
      folder: "proj",
    });
    expect(sanitizeView({ ai: "gemini", agent: "weird", folder: "C:\\" })).toBeNull();
    expect(sanitizeView({ folder: "~/src/api/" })).toEqual({ folder: "api" });
    expect(sanitizeView(null)).toBeNull();
  });

  it("집 PC 의 viewOf 로 싣고, 받을 때 한 번 더 거른다", () => {
    const pane: PaneSpec = { id: "pane-1", kind: "local", autorun: "claude", cwd: "C:/work/proj" };
    const snap = buildSnapshot({
      source: "home",
      workspace: null,
      tabs: [{ id: "tab-1", title: "t", root: { type: "leaf", pane } }],
      activeTabId: "tab-1",
      focusOf: () => "pane-1",
      viewOf: () => ({ ai: "claude", agent: "running", folder: "C:/work/proj" }),
    });
    expect(snap.views).toEqual({ "pane-1": { ai: "claude", agent: "running", folder: "proj" } });
    expect(JSON.stringify(snap)).not.toContain("C:/work");
    const evil = JSON.parse(JSON.stringify(snap));
    evil.views["pane-1"].folder = "/etc/passwd";
    evil.views["pane-1"].autorun = "rm -rf ~";
    expect(parseSnapshot(evil)?.views).toEqual({ "pane-1": { ai: "claude", agent: "running", folder: "passwd" } });
  });
});

describe("워크스페이스 목록(10-20 — 판 2 · 원격의 워크스페이스 칩)", () => {
  const leaf = (id: string, key: string): TabSpec["root"] => ({ type: "leaf", pane: { id, kind: "local", tileKey: key } });
  const snap = buildSnapshot({
    source: "home",
    workspace: { id: "w1", name: "Home" },
    workspaces: [
      { id: "w1", name: "Home", icon: "svg:lucide:house", activeTabId: "tab-1" },
      { id: "w2", name: "회사", color: "#f80", activeTabId: "tab-3" },
      { id: "w3", name: "개인", cold: true, tabCount: 2, activeTabId: "nope" },
    ],
    tabs: [
      { id: "tab-1", title: "a", workspaceId: "w1", root: leaf("pane-1", "k1") },
      { id: "tab-2", title: "b", workspaceId: "w2", root: leaf("pane-2", "k2") },
      { id: "tab-3", title: "c", workspaceId: "w2", root: leaf("pane-3", "k3") },
    ],
    activeTabId: "tab-1",
    focusOf: () => null,
  });

  it("싣는다 — 탭마다 소속 · 워크스페이스마다 활성 탭 · cold 는 탭 수만", () => {
    expect(snap.workspaces).toEqual([
      { id: "w1", name: "Home", icon: "svg:lucide:house", activeTabId: "tab-1" },
      { id: "w2", name: "회사", color: "#f80", activeTabId: "tab-3" },
      { id: "w3", name: "개인", cold: true, tabCount: 2, activeTabId: null },
    ]);
    expect(snap.tabs.map((t) => [t.id, t.workspaceId])).toEqual([
      ["tab-1", "w1"],
      ["tab-2", "w2"],
      ["tab-3", "w2"],
    ]);
    expect(parseSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap);
  });

  it("목록이 없으면(저장된 배치) 지금 워크스페이스 하나 · 소속 없는 탭은 지금 것", () => {
    const one = buildSnapshot({
      source: "file",
      workspace: { id: "w9", name: "Saved" },
      tabs: [{ id: "tab-1", title: "a", root: leaf("pane-1", "k1") }],
      activeTabId: "tab-1",
      focusOf: () => null,
    });
    expect(one.workspaces).toEqual([{ id: "w9", name: "Saved", activeTabId: "tab-1" }]);
    expect(one.tabs[0].workspaceId).toBe("w9");
  });

  it("받을 때 거른다 — 겹친 id · 깨진 줄 · cold 의 탭 · 모르는 소속의 탭은 버리고 지금 것은 늘 산다", () => {
    const evil = JSON.parse(JSON.stringify(snap));
    evil.workspaces.push({ id: "w2", name: "dup" }, { name: "no id" }, "x", { id: "w4", name: "x", icon: "i".repeat(500), secret: "t" });
    evil.workspaces[0].cold = true; // 지금 것은 cold 일 수 없다
    evil.tabs.push({ id: "tab-9", workspaceId: "w3", title: "cold", root: leaf("pane-9", "k9") });
    evil.tabs.push({ id: "tab-8", workspaceId: "zz", title: "?", root: leaf("pane-8", "k8") });
    evil.tabs.push({ id: "tab-7", title: "소속 없음", root: leaf("pane-7", "k7") });
    const parsed = parseSnapshot(evil)!;
    expect(parsed.workspaces.map((w) => [w.id, !!w.cold])).toEqual([
      ["w1", false],
      ["w2", false],
      ["w3", true],
      ["w4", false],
    ]);
    expect(parsed.workspaces[3]).toEqual({ id: "w4", name: "x", activeTabId: null });
    expect(parsed.tabs.map((t) => [t.id, t.workspaceId])).toEqual([
      ["tab-1", "w1"],
      ["tab-2", "w2"],
      ["tab-3", "w2"],
      ["tab-7", "w1"],
    ]);
  });

  it("목록에 지금 것이 없으면 맨 앞에 세우고, 수는 상한에서 자른다", () => {
    const raw = JSON.parse(JSON.stringify(snap));
    raw.workspaces = Array.from({ length: MAX_WORKSPACES + 10 }, (_, i) => ({ id: `x${i}`, name: `${i}` }));
    const parsed = parseSnapshot(raw)!;
    expect(parsed.workspaces[0]).toEqual({ id: "w1", name: "Home", activeTabId: null });
    expect(parsed.workspaces.length).toBe(MAX_WORKSPACES + 1);
    expect(parsed.tabs.map((t) => t.id)).toEqual(["tab-1"]); // w2 는 이제 목록에 없다
  });
});

// 시작 화면 한 벌(2026-11-04) — 원격 창이 집 PC 위젯 배치 · 시계 표시를 따른다
describe("startBoard", () => {
  const board = {
    widgets: [
      { kind: "clock" as const, x: -100, y: -200, w: 300, h: 120 },
      { kind: "hosts" as const, x: -100, y: 0, w: 300, h: 200 },
    ],
    clock: { hour12: true, seconds: true, date: false, size: 96 },
  };
  const base = { source: "home" as const, workspace: { id: "w", name: "W" }, tabs: [], activeTabId: null, focusOf: () => null };

  it("round-trips only the board fields", () => {
    const dirty = {
      widgets: board.widgets.map((w) => ({ ...w, hosts: ["secret-host"] })),
      clock: { ...board.clock, extra: "x" },
    };
    const snap = buildSnapshot({ ...base, startBoard: dirty });
    expect(snap.startBoard).toEqual(board);
    expect(JSON.stringify(snap)).not.toContain("secret-host");
    expect(parseSnapshot(JSON.parse(JSON.stringify(snap)))?.startBoard).toEqual(board);
  });

  it("leaves the field out when there is none (saved layout)", () => {
    const snap = buildSnapshot(base);
    expect(snap).not.toHaveProperty("startBoard");
    expect(parseSnapshot(JSON.parse(JSON.stringify(snap)))).not.toHaveProperty("startBoard");
  });

  it("drops a broken board but keeps the snapshot", () => {
    const good = JSON.parse(JSON.stringify(buildSnapshot(base)));
    for (const bad of [
      "x",
      7,
      {},
      { widgets: "no" },
      { widgets: [{ kind: "nope", x: 0, y: 0, w: 1, h: 1 }] },
      { widgets: [{ kind: "clock", x: "a", y: 0, w: 1, h: 1 }] },
    ]) {
      const out = parseSnapshot({ ...good, startBoard: bad });
      expect(out).not.toBeNull();
      expect(out).not.toHaveProperty("startBoard");
    }
  });
});
