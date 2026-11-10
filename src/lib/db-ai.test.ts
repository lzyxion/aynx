import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DB_AI_LEVELS,
  dbAiAtLeast,
  dbAiChipOf,
  dbAiNeedsConfirm,
  dbAiSendsRows,
  dbAiFormWrite,
  dbHeadlessBox,
  dbAiSummary,
  dbAiToWrite,
  effectiveDbAi,
  effectiveDbHeadless,
  formAiLevel,
  formDbHeadless,
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
    expect(effectiveDbAi({ id: "a", level: "read", identityOk: true, connKnown: true, headless: false })).toBe("read");
    expect(effectiveDbAi({ id: "a", level: "read", identityOk: false, connKnown: true, headless: false })).toBe("off");
    expect(effectiveDbAi({ id: "a", level: "read", identityOk: true, connKnown: false, headless: false })).toBe("off");
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

describe("헤드리스(타일 없이 AI 접속 — 2026-11-09)", () => {
  const view = { id: "a", level: "read" as const, identityOk: true, connKnown: true, headless: true };
  it("걸린 값은 단계가 걸렸을 때만(스냅샷 어긋남 · 고아 · 블록 없음 = 끔)", () => {
    expect(effectiveDbHeadless(view)).toBe(true);
    expect(effectiveDbHeadless({ ...view, headless: false })).toBe(false);
    expect(effectiveDbHeadless({ ...view, identityOk: false })).toBe(false);
    expect(effectiveDbHeadless({ ...view, connKnown: false })).toBe(false);
    expect(effectiveDbHeadless(null)).toBe(false);
  });

  it("폼은 대상이 바뀌었고 안 만졌으면 끔으로 보인다", () => {
    expect(formDbHeadless(true, false, false)).toBe(true);
    expect(formDbHeadless(true, false, true)).toBe(false);
    expect(formDbHeadless(true, true, true)).toBe(true);
  });

  it("저장 — 단계와 함께 싣고 · 칸만 바뀌어도 적고 · 끔은 블록째", () => {
    const base = { stored: "read" as const, blockExists: true, broken: false, targetChanged: false, storedHeadless: false };
    expect(dbAiFormWrite({ ...base, level: "read", headless: false })).toBeNull();
    expect(dbAiFormWrite({ ...base, level: "read", headless: true })).toEqual({ level: "read", headless: true });
    expect(dbAiFormWrite({ ...base, level: "approve", headless: false })).toEqual({ level: "approve", headless: false });
    expect(dbAiFormWrite({ ...base, level: "read", headless: false, storedHeadless: true })).toEqual({ level: "read", headless: false });
    expect(dbAiFormWrite({ ...base, level: "off", headless: true })).toEqual({ level: "off" });
    // 새 연결(블록 없음)에서 처음 권한을 주면 폼의 값(기본 끔)을 명시한다.
    expect(dbAiFormWrite({ ...base, stored: "off", blockExists: false, level: "schema", headless: false })).toEqual({ level: "schema", headless: false });
    expect(dbAiFormWrite({ ...base, stored: "off", blockExists: false, level: "off", headless: false })).toBeNull();
    // 대상이 바뀐 다시 적기는 폼이 보인 값(기본 끔).
    expect(dbAiFormWrite({ ...base, level: "read", targetChanged: true, headless: false, storedHeadless: true })).toEqual({ level: "read", headless: false });
  });

  it("저장 통로는 같은 Tauri 명령(`db_ai_set` 의 `headless`) · 폼은 헤드리스 상자를 AI 권한 아래에 둔다", () => {
    const lib = readFileSync(fileURLToPath(new URL("./db-ai.ts", import.meta.url)), "utf8");
    expect(lib).toContain('invoke<void>("db_ai_set", { id, level, headless: headless ?? null })');
    const q = readFileSync(fileURLToPath(new URL("./app/query.svelte.ts", import.meta.url)), "utf8");
    expect(q).toContain("await setDbAi(id, aiWrite.level, aiWrite.headless)");
    const form = readFileSync(fileURLToPath(new URL("./dialogs/DbPickerDialog.svelte", import.meta.url)), "utf8");
    expect(form.indexOf("data-db-headless")).toBeGreaterThan(form.indexOf("data-db-ai={aiShown}"));
    expect(form).toContain("t(headlessBox.label)");
  });

  it("AI 권한 탭의 할 수 있는 일 — 단계 누적(2026-11-10 · 호스트 폼 요약과 같은 모양)", () => {
    const on = (l: Parameters<typeof dbAiSummary>[0]) => dbAiSummary(l).map((r) => r.on);
    expect(dbAiSummary("off").map((r) => r.key)).toEqual(["app.dbai.sum.schema", "app.dbai.sum.read", "app.dbai.sum.plans", "app.dbai.sum.all"]);
    expect(on("off")).toEqual([false, false, false, false]);
    expect(on("schema")).toEqual([true, false, false, false]);
    expect(on("read")).toEqual([true, true, false, false]);
    expect(on("approve")).toEqual([true, true, true, false]);
    expect(on("all")).toEqual([true, true, true, true]);
  });

  it("SQLite 도 상자가 있다(2026-11-09) — 엔진에 맞춘 문구 · 볼트 없이도 켤 수 있다 · 저장은 폼의 값", () => {
    // 이름은 호스트 폼과 같은 "헤드리스 접속" · 설명 한 줄 · 나머지는 ⓘ 안(2026-11-10)
    expect(dbHeadlessBox("sqlite", true, false)).toEqual({
      label: "app.ai.headless",
      desc: "app.dbai.headless.desc.sqlite",
      note: ["app.dbai.headless.tile.sqlite"],
      blocked: false,
    });
    expect(dbHeadlessBox("postgres", false, false)).toEqual({
      label: "app.ai.headless",
      desc: "app.dbai.headless.desc",
      note: ["app.dbai.headless.locked", "app.dbai.headless.tile"],
      blocked: false,
    });
    expect(dbHeadlessBox("mysql", true, false)).toEqual({
      label: "app.ai.headless",
      desc: "app.hostform.delegation.vault.absent",
      note: ["app.dbai.headless.locked", "app.dbai.headless.tile"],
      blocked: true,
    });
    // 켜진 것은 볼트가 없어도 끌 수 있다.
    expect(dbHeadlessBox("postgres", true, true).blocked).toBe(false);
    const form = readFileSync(fileURLToPath(new URL("./dialogs/DbPickerDialog.svelte", import.meta.url)), "utf8");
    expect(form).toContain('{#if aiShown !== "off"}');
    expect(form).not.toContain('dbPicker.form.engine !== "sqlite"');
    expect(form).toContain("disabled={headlessBox.blocked}");
    const q = readFileSync(fileURLToPath(new URL("./app/query.svelte.ts", import.meta.url)), "utf8");
    expect(q).toContain("headless: connHeadlessShown(),");
    const table = readFileSync(fileURLToPath(new URL("./settings/DbAiTargetsView.svelte", import.meta.url)), "utf8");
    expect(table).not.toContain("hasHeadless");
    expect(table).toContain("data-db-ai-headless={on}");
  });
});

describe("DB AI 권한 바꾸기(쿼리 타일 3b)", () => {
  it("머리줄 칩 — 단계 · 풀림(대상이 바뀜). 끔이어도 칩은 선다(10-23 — 서는지는 머리줄이 정한다)", () => {
    expect(dbAiChipOf(null)).toEqual({ level: "off", broken: false });
    expect(dbAiChipOf({ id: "a", level: "schema", identityOk: true, connKnown: true, headless: false })).toEqual({
      level: "schema",
      broken: false,
    });
    expect(dbAiChipOf({ id: "a", level: "read", identityOk: false, connKnown: true, headless: false })).toEqual({
      level: "off",
      broken: true,
    });
    // 고아 블록(연결이 목록에 없음)은 풀림이 아니다 — 끔
    expect(dbAiChipOf({ id: "a", level: "read", identityOk: false, connKnown: false, headless: false })).toEqual({
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
