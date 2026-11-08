import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DB_AI_LEVELS,
  dbAiAtLeast,
  dbAiChipOf,
  dbAiNeedsConfirm,
  dbAiSendsRows,
  dbAiToWrite,
  effectiveDbAi,
  formAiLevel,
  sameDbTarget,
} from "./db-ai";
import type { DbConn } from "./db-conn";

const pg: DbConn = {
  id: "Qp9-pg-dev01",
  name: "앱 DB",
  engine: "postgres",
  via: "web-01",
  host: "localhost",
  port: 5432,
  database: "app",
  user: "readonly",
  tls_mode: "prefer",
};

describe("DB AI 권한 단계", () => {
  it("누적 다섯 · 허용 목록 자동 승인 없음 · 행이 나가는 단계는 읽기 전용부터", () => {
    expect(DB_AI_LEVELS).toEqual(["off", "schema", "read", "approve", "all"]);
    expect(DB_AI_LEVELS).not.toContain("auto");
    expect(dbAiAtLeast("approve", "read")).toBe(true);
    expect(dbAiAtLeast("all", "approve")).toBe(true);
    expect(dbAiAtLeast("schema", "read")).toBe(false);
    expect(DB_AI_LEVELS.filter(dbAiSendsRows)).toEqual(["read", "approve", "all"]);
  });

  it("모두 승인(10-23)으로 새로 올릴 때만 확인 상자", () => {
    expect(dbAiNeedsConfirm("approve", "all")).toBe(true);
    expect(dbAiNeedsConfirm("off", "all")).toBe(true);
    expect(dbAiNeedsConfirm("all", "all")).toBe(false);
    expect(dbAiNeedsConfirm("all", "approve")).toBe(false);
    expect(dbAiNeedsConfirm("read", "approve")).toBe(false);
  });

  it("실제로 걸린 단계 — 블록이 없거나 스냅샷이 어긋나거나 연결이 없으면 끔", () => {
    expect(effectiveDbAi(null)).toBe("off");
    expect(effectiveDbAi({ id: "a", level: "read", identityOk: true, connKnown: true })).toBe("read");
    expect(effectiveDbAi({ id: "a", level: "read", identityOk: false, connKnown: true })).toBe("off");
    expect(effectiveDbAi({ id: "a", level: "read", identityOk: true, connKnown: false })).toBe("off");
  });
});

describe("대상 비교 · 폼의 AI 칸", () => {
  it("이름 · TLS 는 대상이 아니고 주소 · 포트 · DB · 사용자 · 경유 · 엔진 · 파일은 대상", () => {
    expect(sameDbTarget(pg, { ...pg, name: "운영", tls_mode: "verify-full" })).toBe(true);
    expect(sameDbTarget(pg, { ...pg, via: "WEB-01" })).toBe(true);
    expect(sameDbTarget(pg, { ...pg, host: " localhost " })).toBe(true);
    for (const edit of [
      { host: "prod" },
      { port: 6432 },
      { database: "prod" },
      { user: "admin" },
      { via: "web-02" },
      { via: undefined },
      { engine: "mysql" as const },
    ]) {
      expect(sameDbTarget(pg, { ...pg, ...edit })).toBe(false);
    }
    const lite: DbConn = { id: "Xk3_local-01", name: "a", engine: "sqlite", path: "C:\\a.db" };
    expect(sameDbTarget(lite, { ...lite, path: "C:\\b.db" })).toBe(false);
  });

  it("대상이 바뀌었고 만지지 않았으면 끔으로 보인다", () => {
    expect(formAiLevel("read", false, false)).toBe("read");
    expect(formAiLevel("read", false, true)).toBe("off");
    expect(formAiLevel("read", true, true)).toBe("read");
  });

  it("저장할 단계 — 바뀐 것 · 새 대상 · 풀린 블록만 적고, 없는 블록을 끄지 않는다", () => {
    const base = { blockExists: true, broken: false, targetChanged: false };
    expect(dbAiToWrite({ ...base, level: "read", stored: "read" })).toBeNull();
    expect(dbAiToWrite({ ...base, level: "schema", stored: "read" })).toBe("schema");
    expect(dbAiToWrite({ ...base, level: "read", stored: "read", targetChanged: true })).toBe("read");
    expect(dbAiToWrite({ ...base, level: "off", stored: "off", broken: true })).toBe("off");
    expect(dbAiToWrite({ level: "off", stored: "off", blockExists: false, broken: false, targetChanged: false })).toBeNull();
    expect(dbAiToWrite({ level: "read", stored: "off", blockExists: false, broken: false, targetChanged: false })).toBe("read");
    expect(dbAiToWrite({ ...base, level: "off", stored: "read" })).toBe("off");
  });
});

describe("DB AI 권한 바꾸기(쿼리 타일 3b)", () => {
  it("머리줄 칩 — 단계 · 풀림(대상이 바뀜). 끔이어도 칩은 선다(10-23 — 서는지는 머리줄이 정한다)", () => {
    expect(dbAiChipOf(null)).toEqual({ level: "off", broken: false });
    expect(dbAiChipOf({ id: "a", level: "schema", identityOk: true, connKnown: true })).toEqual({
      level: "schema",
      broken: false,
    });
    expect(dbAiChipOf({ id: "a", level: "read", identityOk: false, connKnown: true })).toEqual({
      level: "off",
      broken: true,
    });
    // 고아 블록(연결이 목록에 없음)은 풀림이 아니다 — 끔
    expect(dbAiChipOf({ id: "a", level: "read", identityOk: false, connKnown: false })).toEqual({
      level: "off",
      broken: false,
    });
  });

  it("독 DB 우클릭에는 AI 권한 묶음이 없다(10-15 — 폼 · 머리줄 칩에서 바꾼다) · 저장은 3a 의 Tauri 명령(`setDbConnAi` → `db_ai_set`)", () => {
    const src = readFileSync(fileURLToPath(new URL("./browser/DbMenu.svelte", import.meta.url)), "utf8");
    expect(src).not.toContain("menuitemradio");
    expect(src).not.toContain("setDbConnAi");
    expect(src).not.toContain("data-db-ai-head");
    const app = readFileSync(fileURLToPath(new URL("./app/db-ai.svelte.ts", import.meta.url)), "utf8");
    const body = app.slice(app.indexOf("export async function setDbConnAi"));
    // 칩에서 고르면 확인 대화 없이 바로 저장한다(10-15) — 경고는 단계 줄 설명에 남는다
    expect(app).not.toContain("plugin-dialog");
    expect(body).not.toContain("ask(");
    expect(body).not.toContain("askConfirm(");
    expect(body).toContain("await setDbAi(conn.id, level)");
  });

  it("단계를 바꿔도 성공 토스트는 없다 · 실패는 원격 팝오버와 같은 통로 · 문구(10-15 — SSH 호스트 AI 권한과 같게)", () => {
    const app = readFileSync(fileURLToPath(new URL("./app/db-ai.svelte.ts", import.meta.url)), "utf8");
    const body = app.slice(app.indexOf("export async function setDbConnAi"), app.indexOf("export async function removeDbAiBlock"));
    expect(app).not.toContain("toast");
    expect(body).toContain('showNotice(t("pane.aiperm.failed", { error:');
    // 판 낮은 서버 안내는 그대로 남는다
    expect(body).toContain('showNotice(t("app.dbai.server.outdated"))');
    const ssh = readFileSync(fileURLToPath(new URL("./pane/ai-perm-menu.svelte.ts", import.meta.url)), "utf8");
    expect(ssh).toContain('showNotice(tr("pane.aiperm.failed", { error:');
    expect(ssh).not.toContain("toast");
  });
});

describe("쿼리 타일 머리줄 AI 권한 칩(10-14)", () => {
  it("원격과 같은 팝오버(`AiPermMenu`) · 저장은 독 우클릭과 같은 함수 · 연결 설정은 `runOnMenu` 통로", () => {
    const ctl = readFileSync(fileURLToPath(new URL("./pane/db-ai-menu.svelte.ts", import.meta.url)), "utf8");
    expect(ctl).toContain("pick = (conn: { id: string; name: string }, level: DbAiLevel) => setDbConnAi(conn, level)");
    expect(ctl).toContain("this.#m.run(");
    expect(ctl).not.toContain("invoke(");
    // 팝오버 그림 조립은 PanePopovers(2026-10-26 PaneHost 에서 뗌) — PaneHost 는 그것을 한 번 건다
    const host = readFileSync(fileURLToPath(new URL("./PaneHost.svelte", import.meta.url)), "utf8");
    expect(host).toContain("<PanePopovers");
    expect(host).not.toContain("<AiPermMenu");
    const pops = readFileSync(fileURLToPath(new URL("./pane/PanePopovers.svelte", import.meta.url)), "utf8");
    // 원격 · 쿼리 · 로컬(10-23) 셋이 같은 상자
    expect(pops.match(/<AiPermMenu\s/g)?.length).toBe(3);
    const chips = readFileSync(fileURLToPath(new URL("./pane/HeaderChips.svelte", import.meta.url)), "utf8");
    expect(chips).toContain("data-db-ai-chip");
  });
});
