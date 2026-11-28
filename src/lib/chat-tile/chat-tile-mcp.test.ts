import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mcpAskKey,
  mcpAuthKey,
  mcpNeedsLogin,
  mcpRowIdle,
  mcpRowOf,
  mcpRowsInherit,
  mcpRowsOf,
  mcpRowsSorted,
  mcpScopeKey,
  mcpStateKey,
  mcpStatusOf,
  mcpSummary,
} from "./chat-tile-mcp";
import type { McpRowView } from "$lib/side-chat-api";
import { ko } from "$lib/i18n/ko/index";
import { en } from "$lib/i18n/en/index";

const lookup = (dict: Record<string, Record<string, string>>, key: string) => dict[key.slice(0, key.indexOf("."))]?.[key.slice(key.indexOf(".") + 1)];
const row = (name: string, over: Partial<McpRowView> = {}): McpRowView => ({ name, state: "connected", auth: null, tools: null, scope: "user", ...over });

describe("허용 목록 — 다섯 칸(+ Aynx 표 둘) 밖은 버린다", () => {
  it("설정 몸 · URL · 머리글 · 오류 글이 붙어 와도 남지 않는다", () => {
    const raw = {
      name: "github",
      state: "failed",
      auth: "oauth",
      tools: 3,
      scope: "user",
      config: { command: "npx", args: ["--ticket", "SECRET-ticket"], env: { K: "SECRET-env" }, url: "https://u:SECRET-pw@h", headers: { Authorization: "SECRET-h" } },
      error: "SECRET-err",
      serverInfo: { name: "SECRET-info" },
      url: "https://SECRET",
    };
    const out = mcpRowOf(raw);
    expect(out).toEqual({ name: "github", state: "failed", auth: "oauth", tools: 3, scope: "user" });
    expect(JSON.stringify(mcpRowsOf([raw, raw]))).not.toContain("SECRET");
  });

  it("낱말은 고정 표로만 — 모르는 상태 unknown · 인증 null · 출처 other", () => {
    expect(mcpRowOf({ name: "x", state: "needs-auth", auth: "bearerToken", tools: 1.5, scope: "claudeai" })).toEqual({ name: "x", state: "unknown", auth: null, tools: null, scope: "other" });
    expect(mcpRowOf({ name: "x", state: "needsAuth", auth: "notLoggedIn", tools: 0, scope: "cloud", aynx: true, picked: "yes" })).toEqual({
      name: "x",
      state: "needsAuth",
      auth: "notLoggedIn",
      tools: 0,
      scope: "cloud",
      aynx: true,
    });
  });

  it("이름 — 없거나 비면 줄째 버림 · 제어 문자는 빈칸 · 96 자에서 자름 · 64 줄까지", () => {
    expect(mcpRowOf({ state: "connected" })).toBeNull();
    expect(mcpRowOf({ name: "  " })).toBeNull();
    expect(mcpRowOf({ name: "a\u0000b" })?.name).toBe("a b");
    expect(mcpRowOf({ name: "n".repeat(120) })?.name).toHaveLength(96);
    expect(mcpRowsOf(Array.from({ length: 70 }, (_, i) => ({ name: `s${i}` })))).toHaveLength(64);
    expect(mcpRowsOf("x")).toEqual([]);
  });

  it("스냅숏 칸 — 모양이 틀리면 null · stale 표", () => {
    expect(mcpStatusOf(null)).toBeNull();
    expect(mcpStatusOf({ source: "init", stale: true, servers: [{ name: "a", state: "connected", secret: "SECRET" }] })).toEqual({
      source: "init",
      stale: true,
      servers: [{ name: "a", state: "connected", auth: null, tools: null, scope: "other" }],
    });
    expect(mcpStatusOf({ source: "weird", servers: [] })).toEqual({ source: "list", stale: false, servers: [] });
  });

  it("사건 줄은 aynx · picked 를 앞 값의 같은 이름에서 물려받는다", () => {
    const prev = [row("aynx-sessions", { aynx: true }), row("github", { picked: true }), row("gone", { picked: true })];
    const next = mcpRowsInherit([row("aynx-sessions"), row("github", { state: "failed" }), row("new")], prev);
    expect(next).toEqual([row("aynx-sessions", { aynx: true }), row("github", { state: "failed", picked: true }), row("new")]);
    expect(mcpRowsInherit([row("a")], null)).toEqual([row("a")]);
  });
});

describe("정렬 · 요약 · 로그인", () => {
  it("aynx → 문제 → 연결 중 → 연결됨 → 그 밖 · 같은 무리는 이름", () => {
    const rows = [row("z-ok"), row("off", { state: "disabled" }), row("b-auth", { state: "needsAuth" }), row("aynx-sessions", { aynx: true }), row("a-fail", { state: "failed" }), row("conn", { state: "connecting" }), row("a-ok")];
    expect(mcpRowsSorted(rows).map((r) => r.name)).toEqual(["aynx-sessions", "a-fail", "b-auth", "conn", "a-ok", "z-ok", "off"]);
    expect(rows[0].name).toBe("z-ok");
  });

  it("꺼지고 도구가 없는 줄은 맨 뒤(흐림) — 도구가 있는 꺼진 줄 · 모르는 줄보다 뒤", () => {
    const rows = [row("a-idle", { state: "disabled", tools: 0 }), row("b-off", { state: "disabled", tools: 2 }), row("c-unk", { state: "unknown" }), row("d-ok")];
    expect(mcpRowsSorted(rows).map((r) => r.name)).toEqual(["d-ok", "b-off", "c-unk", "a-idle"]);
    expect([mcpRowIdle(rows[0]), mcpRowIdle(row("x", { state: "disabled" })), mcpRowIdle(rows[1]), mcpRowIdle(row("y", { tools: 0 }))]).toEqual([true, true, false, false]);
  });

  it("요약 — 줄이 없으면 null · 문제 = needsAuth · failed(연결된 줄은 인증 낱말과 무관)", () => {
    expect(mcpSummary([])).toBeNull();
    expect(mcpSummary([row("a"), row("b", { state: "needsAuth" }), row("c", { state: "failed" }), row("d", { auth: "notLoggedIn" }), row("e", { state: "connecting" })])).toEqual({ total: 5, trouble: 2, connecting: 1 });
  });

  it("로그인 안내 — needsAuth · 로그인이 없어 실패한 줄만 · 연결된 줄은 '로그인 안 됨' 이어도 아니다", () => {
    expect(mcpNeedsLogin(row("a", { state: "needsAuth" }))).toBe(true);
    expect(mcpNeedsLogin(row("a", { state: "failed", auth: "notLoggedIn" }))).toBe(true);
    expect(mcpNeedsLogin(row("a", { auth: "notLoggedIn" }))).toBe(false);
    expect(mcpNeedsLogin(row("a", { state: "failed" }))).toBe(false);
    expect(mcpNeedsLogin(row("a", { state: "disabled", auth: "notLoggedIn" }))).toBe(false);
  });

  it("낱말마다 문구가 두 사전에 있다", () => {
    const keys = [
      ...["connected", "connecting", "needsAuth", "failed", "disabled", "cancelled", "unknown", "nope"].map(mcpStateKey),
      ...["oauth", "bearer", "notLoggedIn", "none"].map((a) => mcpAuthKey(a)!),
      ...["user", "project", "local", "cloud", "plugin", "app", "config", "other", "nope"].map(mcpScopeKey),
      mcpAskKey("slow", false)!,
      mcpAskKey("timeout", false)!,
      mcpAskKey("lastTurn", false)!,
      mcpAskKey("failed", false)!,
      "pane.chatTile.mcp.notStarted",
      mcpAskKey(null, true)!,
      "pane.chatTile.mcp.loginTerminal",
      "pane.chatTile.mcp.asking",
    ];
    for (const k of keys) {
      expect(lookup(ko as never, k), k).toBeTruthy();
      expect(lookup(en as never, k), k).toBeTruthy();
    }
    expect(mcpStateKey("nope")).toBe("pane.chatTile.mcp.state.unknown");
    expect(mcpAuthKey(null)).toBeNull();
    expect(mcpAuthKey("bearerToken")).toBeNull();
    expect(mcpAskKey("asking", true)).toBeNull();
    expect(mcpAskKey(null, false)).toBeNull();
    expect(lookup(ko as never, "pane.chatTile.mcp.loginTerminal")).toContain("터미널 모양으로 열어 주세요");
  });
});

describe("모듈", () => {
  it("값 import 가 없다", () => {
    const src = readFileSync(new URL("./chat-tile-mcp.ts", import.meta.url), "utf8");
    for (const m of src.matchAll(/^import\s+(.+?)\s+from/gm)) expect(m[1].startsWith("type ")).toBe(true);
  });
});
