import { describe, expect, it } from "vitest";
import type { DbConn } from "$lib/db-conn";
import type { QueryLive } from "$lib/app/query-live.svelte.js";
import { queryAddress, queryCardIcon, queryEngine, queryInfoCard } from "./info-card";

// 사전 대신 키를 그대로 돌려준다 — 줄 모양만 본다
const tr = ((k: string) => k) as Parameters<typeof queryInfoCard>[1];

const pg: DbConn = {
  id: "abcdefgh1234",
  name: "운영 DB",
  engine: "postgres",
  via: "bastion",
  host: "db.internal",
  port: 5433,
  database: "shop",
  user: "app",
  tls_mode: "verify-ca",
};
const lite: DbConn = { id: "sqlite000001", name: "로컬", engine: "sqlite", path: "C:/data/app.db" };
const open = (over: Partial<QueryLive> = {}): QueryLive => ({
  state: "open",
  serverVersion: "PostgreSQL 16.2",
  dialect: "postgres",
  writable: false,
  autoCommit: true,
  ...over,
});
const keys = (c: ReturnType<typeof queryInfoCard>) => c.rows.map((r) => r.key);
const val = (c: ReturnType<typeof queryInfoCard>, k: string) => c.rows.find((r) => r.key === k)?.value;

describe("queryAddress — 머리 주소 줄", () => {
  it("사용자@주소:포트 · 기본값 · SQLite 파일 · 모름", () => {
    expect(queryAddress(pg)).toBe("app@db.internal:5433");
    expect(queryAddress({ id: "x", name: "m", engine: "mysql" })).toBe("localhost:3306");
    expect(queryAddress(lite)).toBe("C:/data/app.db");
    expect(queryAddress(null)).toBe("");
  });
});

describe("queryEngine · 아이콘", () => {
  it("MariaDB 는 서버 버전 글자로 가른다", () => {
    const my: DbConn = { id: "x", name: "m", engine: "mysql" };
    expect(queryEngine(my, open({ dialect: "mysql", serverVersion: "MariaDB 11.8.9" }))).toBe("mariadb");
    expect(queryEngine(my, open({ dialect: "mysql", serverVersion: "8.0.36" }))).toBe("mysql");
    expect(queryEngine(my, null)).toBe("mysql");
    expect(queryEngine(null, null)).toBeNull();
    expect(queryCardIcon(pg, null)).toBe("svg:postgres");
    expect(queryCardIcon(null, null)).toBeNull();
  });
});

describe("queryInfoCard — 줄", () => {
  it("연결됨: 엔진 · 서버 · 연결 · 경유 · DB · TLS · 모드 · AI(끔이 아니면) — 상태 줄 없음", () => {
    const c = queryInfoCard({ name: "운영 DB@bastion", conn: pg, live: open(), ai: "schema" }, tr);
    expect(keys(c)).toEqual(["engine", "server", "conn", "jump", "database", "tls", "mode", "ai"]);
    expect(val(c, "server")).toBe("PostgreSQL 16.2");
    expect(val(c, "tls")).toBe("app.query.form.tls.verify-ca");
    expect(val(c, "mode")).toBe("pane.query.readOnly");
    expect(val(c, "ai")).toBe("pane.query.ask.level.schema");
  });

  it("비밀번호 · 비밀 칸은 어디에도 없다", () => {
    const c = queryInfoCard({ name: "x", conn: { ...pg, password: "hunter2" } as DbConn, live: open(), ai: "read" }, tr);
    expect(JSON.stringify(c)).not.toContain("hunter2");
  });

  it("이름이 같으면 연결 줄이 없다 · AI 끔이면 AI 줄이 없다 · SQLite 는 TLS 줄이 없다", () => {
    const c = queryInfoCard({ name: "로컬", conn: lite, live: open({ dialect: "sqlite", serverVersion: "3.46.0" }), ai: "off" }, tr);
    expect(keys(c)).toEqual(["engine", "server", "mode"]);
  });

  it("쓰기 모드 — 자동 · 수동 커밋 · 판 12 서버(모름)", () => {
    const m = (autoCommit: boolean | undefined) => val(queryInfoCard({ name: "x", conn: pg, live: open({ writable: true, autoCommit }), ai: "off" }, tr), "mode");
    expect(m(true)).toBe("pane.header.info.card.mode.write.auto");
    expect(m(false)).toBe("pane.header.info.card.mode.write.manual");
    expect(m(undefined)).toBe("pane.header.info.card.mode.write");
  });

  it("연결 중 · 끊김 — 상태 줄이 맨 위(끊김은 경고색), 서버 버전 · 모드는 없다", () => {
    const closed = queryInfoCard({ name: "x", conn: pg, live: open({ state: "closed" }), ai: "off" }, tr);
    expect(closed.rows[0]).toMatchObject({ key: "state", value: "pane.query.state.closed", tone: "warn" });
    expect(keys(closed)).not.toContain("server");
    expect(keys(closed)).not.toContain("mode");
    const connecting = queryInfoCard({ name: "x", conn: pg, live: null, ai: "off" }, tr);
    expect(connecting.rows[0]).toMatchObject({ key: "state", value: "pane.query.state.connecting", tone: "normal" });
  });
});
