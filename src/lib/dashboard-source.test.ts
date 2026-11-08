import { describe, expect, it } from "vitest";
import type { AgentConversation } from "$lib/agent-sessions";
import { emptyRemoteHost, type RemoteConversation, type RemoteHostState } from "$lib/remote-conversations";
import {
  ALL,
  coverageLine,
  formatBytes,
  hostKey,
  hostsToRefresh,
  LOCAL,
  readMinutes,
  resolveSource,
  rowKey,
  sourceChips,
  sourceScope,
  type RemoteUsageRead,
} from "$lib/dashboard-source";

/**
 * 대시보드의 "어디서" — 칩 · 고른 출처 · 합치기 · 사용량 덮개 한 줄
 * (docs/log/2026-09-27-remote-conversations.md "2단계").
 */

const U = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`;

function local(n: number, updatedAt: number): AgentConversation {
  return {
    agent: "claude",
    id: U(n),
    cwd: "C:\\src\\app",
    branch: null,
    title: `로컬 ${n}`,
    titleSource: "ai",
    startedAt: null,
    updatedAt,
    model: null,
    forkedFrom: null,
    cwdExists: true,
  };
}

function remote(host: string, n: number, updatedAt: number): RemoteConversation {
  return { ...local(n, updatedAt), title: `${host} ${n}`, cwd: "/srv/api", host, tokens: null };
}

function hostState(rows: RemoteConversation[] | null, extra: Partial<RemoteHostState> = {}): RemoteHostState {
  return { ...emptyRemoteHost(), rows, readAt: rows ? 1_000 : null, complete: rows !== null, ...extra };
}

describe("sourceChips", () => {
  it("stands only when some host has been read — otherwise the dashboard stays local-only", () => {
    expect(sourceChips(38, [])).toEqual([]);
    expect(sourceChips(38, [{ alias: "dev-01", state: hostState(null), live: true }])).toEqual([]);
  });

  it("orders this PC → hosts by name → all, counts rows and sums them for all", () => {
    const chips = sourceChips(38, [
      { alias: "lab-02", state: hostState([remote("lab-02", 1, 1)]), live: false },
      { alias: "dev-01", state: hostState([remote("dev-01", 1, 1), remote("dev-01", 2, 2)]), live: true },
    ]);
    expect(chips.map((c) => [c.key, c.count, c.live])).toEqual([
      [LOCAL, 38, true],
      ["host:dev-01", 2, true],
      ["host:lab-02", 1, false],
      [ALL, 41, true],
    ]);
    expect(chips[2].readAt).toBe(1_000);
    // 이 PC 목록을 아직 못 읽었으면 수 없이
    expect(sourceChips(null, [{ alias: "dev-01", state: hostState([]), live: true }])[0].count).toBeNull();
  });

  it("falls back to this PC when the picked host is gone", () => {
    const chips = sourceChips(1, [{ alias: "dev-01", state: hostState([]), live: true }]);
    expect(resolveSource(hostKey("DEV-01"), chips)).toBe("host:dev-01");
    expect(resolveSource(hostKey("gone"), chips)).toBe(LOCAL);
    expect(resolveSource(ALL, [])).toBe(LOCAL);
  });
});

describe("sourceScope · hostsToRefresh", () => {
  const chips = sourceChips(5, [
    { alias: "dev-01", state: hostState([]), live: true },
    { alias: "lab-02", state: hostState([]), live: false },
  ]);

  it("maps the chip to what the Rust summary adds up", () => {
    expect(sourceScope(LOCAL, chips)).toEqual({ local: true, hosts: [] });
    expect(sourceScope(hostKey("dev-01"), chips)).toEqual({ local: false, hosts: ["dev-01"] });
    expect(sourceScope(ALL, chips)).toEqual({ local: true, hosts: ["dev-01", "lab-02"] });
  });

  it("re-reads only hosts with an attached session — a disconnected host keeps its last values (no auto-connect)", () => {
    expect(hostsToRefresh(hostKey("dev-01"), chips)).toEqual(["dev-01"]);
    expect(hostsToRefresh(hostKey("lab-02"), chips)).toEqual([]);
    expect(hostsToRefresh(ALL, chips)).toEqual(["dev-01"]);
    expect(hostsToRefresh(LOCAL, chips)).toEqual([]);
  });
});

describe("rowKey · readMinutes", () => {
  it("keys remote rows by host so the same id on two servers does not collide", () => {
    expect(rowKey(local(1, 0))).toBe(`claude:${U(1)}`);
    expect(rowKey(remote("Dev-01", 1, 0))).toBe(`dev-01|claude:${U(1)}`);
    expect(rowKey(remote("lab-02", 1, 0))).not.toBe(rowKey(remote("dev-01", 1, 0)));
  });

  it("reads minutes since the last read", () => {
    expect(readMinutes(null, 10)).toBeNull();
    expect(readMinutes(0, 59_000)).toBe(0);
    expect(readMinutes(0, 12 * 60_000 + 1)).toBe(12);
  });
});

describe("coverageLine", () => {
  const cov = (pendingClaude: number, pendingCodex: number) => ({
    host: "dev-01",
    counted: 20,
    pendingClaude,
    pendingCodex,
    pendingBytes: 34 * 1024 * 1024,
  });
  const read = (extra: Partial<RemoteUsageRead>): RemoteUsageRead => ({
    running: false,
    doneBytes: 0,
    totalBytes: 0,
    pending: 0,
    complete: false,
    error: null,
    ...extra,
  });

  it("offers the full read only with an attached session", () => {
    expect(coverageLine(cov(3, 0), null, true)).toMatchObject({ kind: "pendingClaude", n: 3, canRead: true });
    expect(coverageLine(cov(3, 1), null, true)).toMatchObject({ kind: "pending", n: 4, canRead: true });
    expect(coverageLine(cov(3, 0), null, false)).toMatchObject({ kind: "offline", canRead: false });
  });

  it("shows progress while running, the error after a stop and nothing once all is counted", () => {
    expect(coverageLine(cov(3, 0), read({ running: true }), true)).toMatchObject({ kind: "running", canRead: false });
    expect(coverageLine(cov(3, 0), read({ error: "boom" }), true)).toMatchObject({ kind: "error", canRead: true });
    expect(coverageLine(cov(0, 0), null, true)).toBeNull();
    expect(coverageLine(cov(0, 0), read({ complete: true }), true)).toMatchObject({ kind: "done", n: 20 });
  });

  it("formats bytes briefly", () => {
    expect(formatBytes(980)).toBe("980 B");
    expect(formatBytes(12 * 1024)).toBe("12 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatBytes(340 * 1024 * 1024)).toBe("340 MB");
    expect(formatBytes(-1)).toBe("0 B");
  });
});
