import { describe, expect, it } from "vitest";
import { DB_ID_LENGTH, DB_NAME_MAX, connsVia, dbIdOk, dbVaultLabels, duplicateConnIn, newDbId, nextDbCopyName, sameAlias, tlsNeedsCa, tlsUnverified, type DbConn, type DbTlsMode } from "$lib/db-conn";

/** DB 연결의 바닥 규칙 (쿼리 타일 — docs/log/2026-10-12-query-tile.md, 10-13 저장 하나로) */

describe("newDbId", () => {
  it("12자 [A-Za-z0-9] — 백엔드의 id 규칙(8~32자 [A-Za-z0-9_-])도 지난다", () => {
    for (let i = 0; i < 200; i++) {
      const id = newDbId();
      expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(id.length).toBe(DB_ID_LENGTH);
      expect(dbIdOk(id)).toBe(true);
    }
  });

  it("치우침을 막으려고 248 이상의 바이트는 버린다", () => {
    // 첫 채우기는 전부 255(버림), 둘째는 0..61 을 돈다 — 버린 바이트가 글자가 되지 않는다.
    let call = 0;
    const id = newDbId((buf) => {
      call += 1;
      for (let i = 0; i < buf.length; i++) buf[i] = call === 1 ? 255 : i;
    });
    expect(call).toBe(2);
    expect(id).toBe("ABCDEFGHIJKL");
  });

  it("247 은 62 로 나눈 나머지(61 = '9')가 된다", () => {
    expect(newDbId((buf) => buf.fill(247))).toBe("999999999999");
  });

  it("뽑을 때마다 다르다", () => {
    const seen = new Set(Array.from({ length: 100 }, () => newDbId()));
    expect(seen.size).toBe(100);
  });
});

describe("dbIdOk", () => {
  it("모양 규칙", () => {
    expect(dbIdOk("abcdefgh")).toBe(true);
    expect(dbIdOk("a_b-c123")).toBe(true);
    expect(dbIdOk("abcdefg")).toBe(false);
    expect(dbIdOk("x".repeat(33))).toBe(false);
    expect(dbIdOk("abcd efgh")).toBe(false);
    expect(dbIdOk("abcdefgé")).toBe(false);
  });
});

describe("TLS 모드", () => {
  const modes: DbTlsMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];
  it("CA 칸은 검증 모드 둘에서만 · 검증하지 않는 암호화 모드 둘은 곁말", () => {
    expect(modes.filter(tlsNeedsCa)).toEqual(["verify-ca", "verify-full"]);
    expect(modes.filter(tlsUnverified)).toEqual(["prefer", "require"]);
  });
});

const conn = (id: string, name: string, via?: string): DbConn => ({
  id,
  name,
  engine: "postgres",
  host: "localhost",
  port: 5432,
  ...(via ? { via } : {}),
});

describe("경유 · 표시", () => {
  it("connsVia — 그 호스트를 경유하는 연결만(대소문자 무시 · 직접은 빠진다)", () => {
    const list = [
      conn("Aaaaaaaa0001", "prod", "web-01"),
      conn("Aaaaaaaa0002", "stg", "WEB-01"),
      conn("Aaaaaaaa0003", "dev"),
      conn("Aaaaaaaa0004", "x", "api"),
    ];
    expect(connsVia(list, "web-01").map((d) => d.id)).toEqual(["Aaaaaaaa0001", "Aaaaaaaa0002"]);
    expect(connsVia(list, " ")).toEqual([]);
    expect(sameAlias(" Web ", "web")).toBe(true);
  });

  it("dbVaultLabels — id → 경유 호스트 · 이름 / 직접 · 이름", () => {
    const labels = dbVaultLabels([conn("Aaaaaaaa0001", "prod", "web-01"), conn("Aaaaaaaa0003", "dev")], "직접");
    expect(labels.get("Aaaaaaaa0001")).toBe("web-01 · prod");
    expect(labels.get("Aaaaaaaa0003")).toBe("직접 · dev");
    expect(labels.has("nope")).toBe(false);
  });
});

describe("nextDbCopyName — 복제본 이름(호스트 복제와 같은 -copy 규칙)", () => {
  const c = (name: string, via?: string): DbConn => ({ id: `Aaaaaaaa${name.length}`, name, engine: "postgres", ...(via ? { via } : {}) });

  it("비어 있으면 `-copy`", () => {
    expect(nextDbCopyName([c("prod", "web")], "prod", "web")).toBe("prod-copy");
  });

  it("같은 경유에 있으면 -copy-2, -copy-3 … (대소문자 무시)", () => {
    const list = [c("prod", "web"), c("PROD-COPY", "web"), c("prod-copy-2", "WEB")];
    expect(nextDbCopyName(list, "prod", "web")).toBe("prod-copy-3");
  });

  it("다른 경유 · 직접의 같은 이름은 겹침이 아니다(폼의 중복 검사와 같은 눈)", () => {
    const list = [c("prod", "web"), c("prod-copy", "db-01"), c("prod-copy")];
    expect(nextDbCopyName(list, "prod", "web")).toBe("prod-copy");
    expect(nextDbCopyName([c("prod-copy", "web")], "prod", undefined)).toBe("prod-copy");
  });

  it("이름 상한을 넘으면 원래 이름의 끝을 깎고 꼬리는 지킨다", () => {
    const long = "가".repeat(DB_NAME_MAX);
    const out = nextDbCopyName([], long, undefined);
    expect([...out].length).toBe(DB_NAME_MAX);
    expect(out.endsWith("-copy")).toBe(true);
    const out2 = nextDbCopyName([c(out)], long, undefined);
    expect([...out2].length).toBe(DB_NAME_MAX);
    expect(out2.endsWith("-copy-2")).toBe(true);
  });
});

describe("duplicateConnIn — 연결 복제", () => {
  const src: DbConn = {
    id: "Aaaaaaaa0001",
    name: "prod",
    engine: "postgres",
    via: "web-01",
    host: "localhost",
    port: 5432,
    database: "app",
    user: "ro",
    tls_mode: "verify-full",
    tls_ca: "C:/ca.pem",
  };

  it("비밀 아닌 칸은 모두 옮기고 새 id · 새 이름으로 끝에 덧붙인다", () => {
    const r = duplicateConnIn([src], src.id, "Bbbbbbbb0002");
    expect(r).not.toBeNull();
    expect(r!.copy).toEqual({ ...src, id: "Bbbbbbbb0002", name: "prod-copy" });
    expect(r!.list).toEqual([src, r!.copy]);
  });

  it("SQLite 경로도 옮긴다", () => {
    const lite: DbConn = { id: "Aaaaaaaa0003", name: "local", engine: "sqlite", path: "C:/data/a.db" };
    expect(duplicateConnIn([lite], lite.id, "Bbbbbbbb0004")!.copy).toEqual({ ...lite, id: "Bbbbbbbb0004", name: "local-copy" });
  });

  it("원본이 없으면 null · 원본 목록은 건드리지 않는다", () => {
    const list = [src];
    expect(duplicateConnIn(list, "nope", "Bbbbbbbb0002")).toBeNull();
    duplicateConnIn(list, src.id, "Bbbbbbbb0002");
    expect(list).toEqual([src]);
  });
});
