import { describe, expect, it } from "vitest";
import {
  detachedDbStatus,
  detachedName,
  detachedWindowName,
  iconPaneForDetached,
  paneForDetached,
  parseDetached,
  sortDetached,
  type DetachedSession,
} from "./detached";

const tr = (key: string, p?: Record<string, string | number>) => (p ? `${key}:${JSON.stringify(p)}` : key);

function row(over: Partial<DetachedSession> = {}): DetachedSession {
  return {
    stream: "s1",
    kind: "local",
    home: "main",
    homeOpen: true,
    detachedAt: 100,
    lastOutputAt: null,
    openedAt: 1,
    shell: "pwsh",
    alias: null,
    tmux: null,
    aiRead: false,
    unclaimed: true,
    conn: null,
    writable: false,
    inTx: false,
    ...over,
  };
}

describe("detached sessions model", () => {
  it("drops malformed rows and keeps known fields", () => {
    const list = parseDetached([
      { stream: "a", kind: "local", home: "main", detachedAt: 5, openedAt: 1, shell: "pwsh", unclaimed: true },
      { stream: "b", kind: "weird" },
      null,
      { kind: "ssh" },
      { stream: "c", kind: "ssh", alias: "web", tmux: "aynx-1", detachedAt: "x" },
    ]);
    expect(list.map((s) => s.stream)).toEqual(["a", "c"]);
    expect(list[1].detachedAt).toBeNull();
    expect(list[1].tmux).toBe("aynx-1");
    expect(parseDetached("nope")).toEqual([]);
  });

  it("sorts the most recently detached first, unknown times last", () => {
    const sorted = sortDetached([row({ stream: "old", detachedAt: 1 }), row({ stream: "none", detachedAt: null }), row({ stream: "new", detachedAt: 9 })]);
    expect(sorted.map((s) => s.stream)).toEqual(["new", "old", "none"]);
  });

  it("names a local row by its shell and an ssh row by alias and tmux", () => {
    expect(detachedName(row(), tr)).toBe("PowerShell 7");
    expect(detachedName(row({ shell: null }), tr)).toBe("pane.name.local");
    expect(detachedName(row({ kind: "ssh", alias: "web", tmux: "aynx-2" }), tr)).toBe("web · aynx-2");
    expect(detachedName(row({ kind: "ssh", alias: null }), tr)).toBe("app.detached.unknownHost");
  });

  it("names the last window", () => {
    expect(detachedWindowName("main", tr)).toBe("app.detached.window.main");
    expect(detachedWindowName("tear-3", tr)).toContain("tear-3");
    expect(detachedWindowName("ws-1", tr)).toBe("ws-1");
  });

  it("builds a tile that reuses the session's stream (attach, not a new shell)", () => {
    const local = paneForDetached(row({ stream: "keep-me", shell: "gitbash" }));
    expect(local).toMatchObject({ kind: "local", shell: "gitbash", historyStreamId: "keep-me" });
    const ssh = paneForDetached(row({ kind: "ssh", stream: "ssh-1", alias: "web", tmux: "aynx-4", shell: null }));
    expect(ssh).toMatchObject({ kind: "ssh", alias: "web", tmux: "aynx-4", historyStreamId: "ssh-1" });
    expect(ssh.autorun).toBeUndefined();
  });
});

describe("detached query tiles (2026-11-09 ② — DB 타일도 떨어진 세션으로)", () => {
  it("keeps a db row only with a connection id and a query key", () => {
    const list = parseDetached([
      { stream: "query:tk-1", kind: "db", home: "main", detachedAt: 7, openedAt: 1, conn: "Conn_0001", writable: true, inTx: true },
      { stream: "query:tk-2", kind: "db", home: "main" },
      { stream: "life-9", kind: "db", conn: "Conn_0001" },
    ]);
    expect(list.map((s) => s.stream)).toEqual(["query:tk-1"]);
    expect(list[0]).toMatchObject({ kind: "db", conn: "Conn_0001", writable: true, inTx: true, shell: null, alias: null });
    // 판 28 이하 서버의 세션 줄에는 DB 칸이 없다 — 꺼짐으로 읽는다.
    const [old] = parseDetached([{ stream: "a", kind: "local", home: "main", shell: "pwsh" }]);
    expect(old).toMatchObject({ conn: null, writable: false, inTx: false });
  });

  it("names a db row by its connection name (falls back to the id)", () => {
    const db = row({ kind: "db", stream: "query:tk-1", conn: "Conn_0001", shell: null });
    expect(detachedName(db, tr, (id) => (id === "Conn_0001" ? "docker-pg-test" : null))).toBe("docker-pg-test");
    expect(detachedName(db, tr, () => null)).toBe("Conn_0001");
    expect(detachedName(db, tr)).toBe("Conn_0001");
  });

  it("states mode, open transaction and AI permission", () => {
    expect(detachedDbStatus(row({ kind: "db" }), "Read", tr)).toBe("app.detached.db.readOnly · AI Read");
    expect(detachedDbStatus(row({ kind: "db", writable: true }), null, tr)).toBe("app.detached.db.write");
    expect(detachedDbStatus(row({ kind: "db", writable: true, inTx: true }), "Ask", tr)).toBe("app.detached.db.write · app.detached.db.tx · AI Ask");
  });

  it("reattaches through a query tile with the same tile key", () => {
    const pane = paneForDetached(row({ kind: "db", stream: "query:tk-77", conn: "Conn_0001", shell: null }));
    expect(pane).toMatchObject({ kind: "query", query: { connId: "Conn_0001" }, tileKey: "tk-77" });
    expect(pane.historyStreamId).toBeUndefined();
    // 연결 이름을 넘기면 탭 제목용 이름이 실린다(없으면 싣지 않는다)
    expect(paneForDetached(row({ kind: "db", stream: "query:tk-77", conn: "Conn_0001", shell: null }), "pg-main").query?.name).toBe("pg-main");
    expect(pane.query?.name).toBeUndefined();
    expect(iconPaneForDetached(row({ kind: "db", stream: "query:tk-77", conn: "Conn_0001" }))).toMatchObject({ kind: "query", query: { connId: "Conn_0001" } });
    expect(iconPaneForDetached(row({ kind: "ssh", alias: "web" }))).toMatchObject({ kind: "ssh", alias: "web" });
  });
});

describe("no orchestration worker tag (3차 3b — 작업자는 헤드리스)", () => {
  it("ignores an old server's worker tag and keeps the shell", () => {
    const [plain] = parseDetached([{ stream: "p", kind: "local", home: "main", shell: "pwsh", orchestration: { runId: "r" } }]);
    expect("orchestration" in plain).toBe(false);
    expect(paneForDetached(plain).shell).toBe("pwsh");
  });
});
