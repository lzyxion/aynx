import { describe, expect, it } from "vitest";
import {
  connOfRow,
  connRowOf,
  connTargetText,
  directTlsWarning,
  emptyConnRow,
  isAbsolutePath,
  isLoopback,
  upsertConn,
  withConnEngine,
  withConnVia,
  type ConnRow,
} from "./conn-form";

const ID = "AbCdEf123456";
const row = (patch: Partial<ConnRow>): ConnRow => ({ ...emptyConnRow(ID), name: "app", ...patch });

describe("DB 연결 폼 — SQLite", () => {
  it("절대 경로만 받고 호스트 · 포트 · TLS · 경유 칸은 버린다", () => {
    expect(connOfRow(row({ path: "C:\\data\\app.db", host: "x", port: 5432 }))).toEqual({
      ok: true,
      conn: { id: ID, name: "app", engine: "sqlite", path: "C:\\data\\app.db" },
    });
    expect(connOfRow(row({ path: "/a.db", via: "web-01" }))).toEqual({
      ok: true,
      conn: { id: ID, name: "app", engine: "sqlite", path: "/a.db" },
    });
    expect(connOfRow(row({ path: "" }))).toEqual({ ok: false, problem: "path" });
    expect(connOfRow(row({ path: "app.db" }))).toEqual({ ok: false, problem: "path-relative" });
  });

  it("절대 경로 판정 — 드라이브 · UNC · POSIX", () => {
    expect(isAbsolutePath("C:/x.db")).toBe(true);
    expect(isAbsolutePath("\\\\srv\\share\\x.db")).toBe(true);
    expect(isAbsolutePath("/home/me/x.db")).toBe(true);
    expect(isAbsolutePath("C:x.db")).toBe(false);
    expect(isAbsolutePath("./x.db")).toBe(false);
  });

  it("이름 · id 검증", () => {
    expect(connOfRow(row({ name: "  ", path: "/a.db" }))).toEqual({ ok: false, problem: "name" });
    expect(connOfRow(row({ name: "x".repeat(65), path: "/a.db" }))).toEqual({ ok: false, problem: "name-long" });
    expect(connOfRow({ ...row({ path: "/a.db" }), id: "short" })).toEqual({ ok: false, problem: "id" });
  });

  it("SQLite 로 바꾸면 경유가 지워지고 · SQLite 에는 경유를 고를 수 없다", () => {
    const viaPg = withConnVia(withConnEngine(row({}), "postgres"), "web-01");
    expect(viaPg.via).toBe("web-01");
    expect(withConnEngine(viaPg, "sqlite").via).toBeNull();
    expect(withConnVia(row({}), "web-01").via).toBeNull();
  });
});

describe("DB 연결 폼 — 경유 · 직접 · TLS 경고", () => {
  it("새 연결 — 경유를 미리 고르면 PostgreSQL · localhost:5432 로 시작한다", () => {
    const r = emptyConnRow(ID, " web-01 ");
    expect([r.engine, r.via, r.host, r.port]).toEqual(["postgres", "web-01", "localhost", 5432]);
    expect(emptyConnRow(ID).engine).toBe("sqlite");
  });

  it("루프백 판정", () => {
    for (const h of ["127.0.0.1", "localhost", "LocalHost", "::1", "[::1]", " localhost "]) expect(isLoopback(h)).toBe(true);
    for (const h of ["10.0.0.5", "db.example.com", "127.0.0.2"]) expect(isLoopback(h)).toBe(false);
  });

  it("원격 주소도 받는다 · 포트 범위 · TLS 와 CA · 경유는 다듬어 싣는다", () => {
    const pg = withConnEngine(row({}), "postgres");
    expect(pg.port).toBe(5432);
    const remote = connOfRow({ ...pg, host: " db.example.com ", tlsMode: "verify-ca", tlsCa: "C:/ca.pem" });
    expect(remote.ok && remote.conn.host).toBe("db.example.com");
    expect(remote.ok && remote.conn.tls_ca).toBe("C:/ca.pem");
    expect(connOfRow({ ...pg, port: 0 })).toEqual({ ok: false, problem: "port" });
    expect(connOfRow({ ...pg, host: "local host" })).toEqual({ ok: false, problem: "host" });
    // verify-ca 는 CA 파일만 믿는다 — CA 칸 필수(verify-full 은 비어도 된다). 경유도 같다.
    expect(connOfRow({ ...pg, tlsMode: "verify-ca", tlsCa: " " })).toEqual({ ok: false, problem: "ca-required" });
    expect(connOfRow({ ...pg, via: "web-01", tlsMode: "verify-ca", tlsCa: "" })).toEqual({ ok: false, problem: "ca-required" });
    expect(connOfRow({ ...pg, tlsMode: "verify-full", tlsCa: "" }).ok).toBe(true);
    expect(connOfRow({ ...pg, via: " web-01 ", database: " shop ", user: "ro", tlsMode: "verify-full", tlsCa: "C:/ca.pem" })).toEqual({
      ok: true,
      conn: {
        id: ID,
        name: "app",
        engine: "postgres",
        via: "web-01",
        host: "localhost",
        port: 5432,
        database: "shop",
        user: "ro",
        tls_mode: "verify-full",
        tls_ca: "C:/ca.pem",
      },
    });
    // 검증 모드가 아니면 CA 는 버린다
    const r = connOfRow({ ...pg, tlsMode: "require", tlsCa: "C:/ca.pem" });
    expect(r.ok && r.conn.tls_ca).toBeFalsy();
  });

  it("직접 원격 + 인증서를 확인하지 않는 모드면 경고 — 경유면 경고 없음(SSH 가 감싼다)", () => {
    const pg = { ...withConnEngine(row({}), "postgres"), host: "db.example.com" };
    expect(directTlsWarning({ ...pg, tlsMode: "disable" })).toBe("plain");
    expect(directTlsWarning({ ...pg, tlsMode: "prefer" })).toBe("unverified");
    expect(directTlsWarning({ ...pg, tlsMode: "require" })).toBe("unverified");
    expect(directTlsWarning({ ...pg, tlsMode: "verify-ca" })).toBeNull();
    expect(directTlsWarning({ ...pg, tlsMode: "verify-full" })).toBeNull();
    for (const mode of ["disable", "prefer", "require"] as const) {
      expect(directTlsWarning({ ...pg, via: "web-01", tlsMode: mode })).toBeNull();
    }
    // 이 PC · 빈 칸 · SQLite 는 경고 없음
    for (const host of ["localhost", "127.0.0.1", "::1", " "]) expect(directTlsWarning({ ...pg, host, tlsMode: "disable" })).toBeNull();
    expect(directTlsWarning({ ...pg, engine: "sqlite", tlsMode: "disable" })).toBeNull();
    expect(directTlsWarning({ ...pg, engine: "mariadb", host: "10.0.0.5", tlsMode: "require" })).toBe("unverified");
  });

  it("손댄 포트는 엔진을 바꿔도 남는다", () => {
    const touched = { ...withConnEngine(row({}), "postgres"), port: 6543, portTouched: true };
    expect(withConnEngine(touched, "mysql").port).toBe(6543);
    expect(withConnEngine(withConnEngine(row({}), "postgres"), "mysql").port).toBe(3306);
  });
});

describe("목록 다루기", () => {
  it("같은 id 는 바꾸고 새 id 는 뒤에 · 같은 경유 안의 이름 겹침은 duplicate", () => {
    const list = [
      { id: "OtherId00001", name: "Main", engine: "sqlite" as const, path: "/m.db" },
      { id: "OtherId00002", name: "prod", engine: "postgres" as const, via: "web-01", host: "localhost", port: 5432 },
    ];
    const added = upsertConn(list, row({ path: "/a.db" }));
    expect(added.ok && added.list.map((d) => d.id)).toEqual(["OtherId00001", "OtherId00002", ID]);
    expect(upsertConn(list, row({ name: "main", path: "/a.db" }))).toEqual({ ok: false, problem: "duplicate" });
    const same = upsertConn(list, { ...row({ name: "Main", path: "/n.db" }), id: "OtherId00001" });
    expect(same.ok && same.list[0]).toEqual({ id: "OtherId00001", name: "Main", engine: "sqlite", path: "/n.db" });
    // 다른 호스트(또는 직접)를 거치는 같은 이름은 받는다 · 같은 호스트(대소문자 무시)면 겹침.
    const pg = withConnEngine(row({ name: "prod" }), "postgres");
    expect(upsertConn(list, { ...pg, via: "web-02" }).ok).toBe(true);
    expect(upsertConn(list, pg).ok).toBe(true);
    expect(upsertConn(list, { ...pg, via: "WEB-01" })).toEqual({ ok: false, problem: "duplicate" });
  });

  it("왕복 · 둘째 글자", () => {
    const d = { id: ID, name: "app", engine: "sqlite" as const, path: "C:\\data\\app.db" };
    expect(connOfRow(connRowOf(d))).toEqual({ ok: true, conn: d });
    const v = { id: ID, name: "prod", engine: "mysql" as const, via: "web-01", host: "localhost", port: 3306, tls_mode: "prefer" as const };
    expect(connOfRow(connRowOf(v))).toEqual({ ok: true, conn: v });
    expect(connTargetText(d)).toBe("app.db");
    expect(connTargetText({ id: ID, name: "p", engine: "postgres", host: "localhost", port: 5432, database: "shop" })).toBe(
      "localhost:5432/shop",
    );
  });
});
