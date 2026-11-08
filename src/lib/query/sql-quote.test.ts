import { describe, expect, it } from "vitest";
import { qualifiedName, quoteIdent, selectStarSql } from "./sql-quote";

describe("식별자 인용 — 사투리별", () => {
  it("PG · SQLite 는 큰따옴표(안의 \" 는 겹친다), MySQL 은 백틱(안의 ` 는 겹친다)", () => {
    expect(quoteIdent("users", "postgres")).toBe('"users"');
    expect(quoteIdent('we"ird', "sqlite")).toBe('"we""ird"');
    expect(quoteIdent("order", "mysql")).toBe("`order`");
    expect(quoteIdent("a`b", "mysql")).toBe("`a``b`");
    expect(quoteIdent("사용자 목록", "postgres")).toBe('"사용자 목록"');
  });

  it("스키마.표 — SQLite 의 main 은 생략, 붙인 DB 는 앞에", () => {
    expect(qualifiedName("sqlite", "main", "t")).toBe('"t"');
    expect(qualifiedName("sqlite", "aux", "t")).toBe('"aux"."t"');
    expect(qualifiedName("postgres", "public", "t")).toBe('"public"."t"');
    expect(qualifiedName("mysql", null, "t")).toBe("`t`");
  });

  it("SELECT * … LIMIT 100;", () => {
    expect(selectStarSql("sqlite", "main", "items")).toBe('SELECT * FROM "items" LIMIT 100;');
    expect(selectStarSql("mysql", "shop", "orders")).toBe("SELECT * FROM `shop`.`orders` LIMIT 100;");
  });
});
