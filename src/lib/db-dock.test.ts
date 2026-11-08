import { describe, expect, it } from "vitest";
import {
  dbConnKey,
  dbConnLocations,
  dbDockRows,
  dbElsewhere,
  dbFocusTarget,
  queryPlace,
  type DbOpenLocation,
} from "$lib/db-dock";
import { DB_ENGINE_ICON, DB_ENGINES, type DbConn } from "$lib/db-conn";
import { iconNameOf, logosNameOf } from "$lib/host-icons";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fuzzyMatch } from "$lib/hosts";
import { openLocationMarkers } from "$lib/project-locations";

const pg = (id: string, name: string, via: string, over: Partial<DbConn> = {}): DbConn => ({
  id,
  name,
  engine: "postgres",
  via,
  host: "localhost",
  port: 5432,
  database: "app",
  user: "app",
  tls_mode: "prefer",
  ...over,
});

const conns: DbConn[] = [
  { id: "sqliteaaaaaa", name: "app.db", engine: "sqlite", path: "C:\\data\\app.db" },
  pg("pgweb2aaaaaa", "main", "web-02"),
  pg("pgdb01aaaaaa", "orders", "db-01", { port: 6432 }),
  { id: "pglocalaaaaa", name: "dev pg", engine: "postgres", host: "127.0.0.1", port: 5432, database: "dev" },
  pg("mydb01aaaaaa", "Legacy", "DB-01", { engine: "mysql", port: 3306, database: undefined }),
  pg("gonehostaaaa", "old", "gone-host", { host: "db.internal" }),
  { id: "pgmainaaaaaa", name: "main", engine: "postgres", host: "db.example.com", port: 5433, database: "x" },
];

describe("dbDockRows", () => {
  it("묶음 없이 한 목록 — 이름순(대소문자 무시) · 같은 이름이면 직접이 먼저", () => {
    expect(dbDockRows(conns, "", fuzzyMatch).map((r) => r.id)).toEqual([
      "sqliteaaaaaa",
      "pglocalaaaaa",
      "mydb01aaaaaa",
      "pgmainaaaaaa",
      "pgweb2aaaaaa",
      "gonehostaaaa",
      "pgdb01aaaaaa",
    ]);
  });

  it("표시 글자 — 엔진 · DB 이름 없이 주소만, 말풍선은 온전한 주소 · 타일 이름", () => {
    const list = dbDockRows(conns, "", fuzzyMatch);
    const by = (id: string) => list.find((c) => c.id === id)!;
    expect(by("pgdb01aaaaaa")).toMatchObject({ title: "localhost:6432/app", tabName: "orders · db-01", via: "db-01" });
    expect(by("mydb01aaaaaa")).toMatchObject({ title: "localhost:3306" });
    expect(by("sqliteaaaaaa")).toMatchObject({ title: "C:\\data\\app.db", tabName: "app.db", via: null });
    expect(by("pglocalaaaaa")).toMatchObject({ title: "127.0.0.1:5432/dev" });
    expect(by("pgmainaaaaaa")).not.toHaveProperty("hint");
  });

  it("비면 줄이 없다", () => {
    expect(dbDockRows([], "", fuzzyMatch)).toEqual([]);
  });

  it("검색 — 연결 이름 · 온전한 주소(DB 이름 포함) · 엔진, 별칭이 맞으면 그 호스트의 연결 전부", () => {
    const keys = (q: string) => dbDockRows(conns, q, fuzzyMatch).map((c) => c.id);
    expect(keys("orders")).toEqual(["pgdb01aaaaaa"]);
    expect(keys("db-01")).toEqual(["mydb01aaaaaa", "pgdb01aaaaaa"]);
    expect(keys("sqlite")).toEqual(["sqliteaaaaaa"]);
    expect(keys("/dev")).toEqual(["pglocalaaaaa"]);
    expect(keys("zzz")).toEqual([]);
    expect(dbConnKey("x")).toBe("conn:x");
  });
});

describe("엔진 아이콘", () => {
  it("모든 엔진이 큐레이션 로고를 가리킨다 — logos 전체(7MB)를 받지 않는다", () => {
    for (const e of DB_ENGINES) {
      const ref = DB_ENGINE_ICON[e];
      expect(iconNameOf(ref), `${e} → ${ref}`).not.toBeNull();
    }
  });

  it("옛 이름(호스트 아이콘으로 저장됐을 수 있는 `svg:logos:…`)은 logos 전체 표로 계속 그려진다", () => {
    const file = fileURLToPath(new URL("./host-icons-logos.generated.json", import.meta.url));
    const icons = (JSON.parse(readFileSync(file, "utf8")) as { icons: Record<string, unknown> }).icons;
    for (const ref of ["svg:logos:mariadb-icon", "svg:logos:sqlite"]) {
      const name = logosNameOf(ref);
      expect(name !== null && name in icons, ref).toBe(true);
    }
  });
});

describe("열린 곳", () => {
  const loc = (over: Partial<DbOpenLocation>): DbOpenLocation => ({
    workspaceId: "w1",
    host: null,
    folder: null,
    connId: "sqliteaaaaaa",
    focusedAt: 0,
    ...over,
  });

  it("queryPlace — 쿼리 타일만, 연결 id 가 있어야", () => {
    expect(queryPlace({ kind: "query", query: { connId: "abc" } })).toEqual({ host: null, folder: null, connId: "abc" });
    expect(queryPlace({ kind: "query", query: { connId: "" } })).toBeNull();
    expect(queryPlace({ kind: "local" })).toBeNull();
  });

  it("연결은 id 하나로 가린다 — 최근에 본 것이 앞", () => {
    const all = [loc({ connId: "x", paneId: "a", focusedAt: 1 }), loc({ connId: "x", paneId: "b", focusedAt: 5 }), loc({ connId: "y" })];
    expect(dbConnLocations(all, "x").map((l) => l.paneId)).toEqual(["b", "a"]);
  });

  it("갈 곳 = 지금 워크스페이스의 가장 최근 타일, 없으면 null(새로 연다)", () => {
    const all = [loc({ paneId: "old", focusedAt: 1 }), loc({ paneId: "new", focusedAt: 9 }), loc({ workspaceId: "w2", paneId: "far", focusedAt: 99 })];
    expect(dbFocusTarget(all, "w1")?.paneId).toBe("new");
    expect(dbFocusTarget(all, "w3")).toBeNull();
    expect(dbFocusTarget(all, null)).toBeNull();
  });

  it("표식은 프로젝트 칸과 같은 꼴 — 여기 · 다른 워크스페이스 ↗", () => {
    const ws = [{ id: "w1", name: "Home" }, { id: "w2", name: "Ops" }];
    const all = [loc({ workspaceId: "w2", paneId: "far" })];
    expect(openLocationMarkers(all, "w1", ws)).toMatchObject({ here: false, badge: "Ops ↗" });
    expect(openLocationMarkers([loc({})], "w1", ws)).toMatchObject({ here: true, badge: null });
    expect(dbElsewhere(all, "w1", ws).map((e) => e.name)).toEqual(["Ops"]);
    expect(dbElsewhere(all, "w2", ws)).toEqual([]);
  });
});
