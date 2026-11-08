import { describe, expect, it } from "vitest";
import { dbLastOkAt, dbTooltipLines, parseDbHistory } from "./db-history";

describe("DB 접속 기록(10-20)", () => {
  it("parseDbHistory — 모양이 어긋난 줄은 버리고 나머지는 살린다 · throw 없음", () => {
    expect(parseDbHistory(null)).toEqual({});
    expect(parseDbHistory([1, 2])).toEqual({});
    expect(parseDbHistory("x")).toEqual({});
    expect(
      parseDbHistory({
        Xk3_local01: { last_ok_at: 5, count: 2 },
        "Qp9-pg-dev01": { last_ok_at: "어제", count: Number.NaN },
        bad: 3,
        list: [1],
        " ": { last_ok_at: 1, count: 1 },
      }),
    ).toEqual({
      Xk3_local01: { last_ok_at: 5, count: 2 },
      "Qp9-pg-dev01": { last_ok_at: null, count: 0 },
    });
  });

  it("dbLastOkAt — 연결 id 는 대소문자를 가린다 · 없으면 null · 원형 글자를 읽지 않는다", () => {
    const h = parseDbHistory({ Xk3_local01: { last_ok_at: 7, count: 1 } });
    expect(dbLastOkAt(h, "Xk3_local01")).toBe(7);
    expect(dbLastOkAt(h, "xk3_local01")).toBeNull();
    expect(dbLastOkAt(h, "Nope_nope01")).toBeNull();
    expect(dbLastOkAt(h, "__proto__")).toBeNull();
    expect(dbLastOkAt(h, "toString")).toBeNull();
  });

  it("dbTooltipLines — 주소 → (경유) → 마지막 접속 · 기록 없으면 접속 줄 없음", () => {
    const tr = (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k);
    const h = parseDbHistory({ Xk3_local01: { last_ok_at: 1_000, count: 3 } });
    const lines = dbTooltipLines("PostgreSQL · localhost:5432/app", "web-01", h, "Xk3_local01", 61_000, tr as never);
    expect(lines[0]).toBe("PostgreSQL · localhost:5432/app");
    expect(lines[1]).toContain("app.db.dock.ssh.title");
    expect(lines[1]).toContain("web-01");
    expect(lines[2]).toContain("files.host.history.ok");
    expect(lines[2]).toContain('"count":3');
    expect(dbTooltipLines("SQLite · C:/a.db", null, h, "Nope_nope01", 61_000, tr as never)).toEqual(["SQLite · C:/a.db"]);
  });
});
