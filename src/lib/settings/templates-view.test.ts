import { describe, expect, it } from "vitest";
import { templateEditPlan, templateProjectPill, templateRowSub } from "$lib/settings/templates-view";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/finish-notify";

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

describe("프로젝트 알약", () => {
  const names: Record<string, string> = { p1: "aynx" };
  const nameOf = (id: string) => names[id] ?? null;

  it("프로젝트 템플릿은 그 이름", () => {
    expect(templateProjectPill("p1", nameOf)).toEqual({ kind: "project", name: "aynx" });
  });

  it("프로젝트가 없으면 없음 · 목록에 없는 id 는 찾지 못함", () => {
    expect(templateProjectPill(undefined, nameOf)).toEqual({ kind: "none" });
    expect(templateProjectPill("", nameOf)).toEqual({ kind: "none" });
    expect(templateProjectPill("gone-1", nameOf)).toEqual({ kind: "gone" });
  });
});

describe("보조 줄", () => {
  const now = Date.UTC(2026, 10, 17, 12, 0, 0);
  const day = 24 * 60 * 60_000;

  it("요약 · 저장한 날", () => {
    expect(templateRowSub("AI 2 · SSH", now - 3 * day, now, ko)).toBe("AI 2 · SSH · 3일 전 저장");
    expect(templateRowSub("AI 2 · SSH", now - 3 * day, now, en)).toBe("AI 2 · SSH · saved 3d ago");
  });

  it("일주일이 넘으면 날짜", () => {
    expect(templateRowSub("셸", now - 30 * day, now, ko)).toMatch(/^셸 · \d{4}-\d{2}-\d{2} 저장$/);
  });

  it("저장한 날을 모르면 요약만 · 요약이 비면 날만", () => {
    expect(templateRowSub("DB", 0, now, ko)).toBe("DB");
    expect(templateRowSub("", now - 5_000, now, ko)).toBe("방금 저장");
    expect(templateRowSub("", 0, now, ko)).toBe("");
  });
});

describe("편집 계획", () => {
  const cur = { name: "작업", projectId: "p1" };

  it("그대로면 빈 계획", () => {
    expect(templateEditPlan(cur, { name: "작업", projectId: "p1" })).toEqual({});
    expect(templateEditPlan(cur, { name: "  작업 ", projectId: "p1" })).toEqual({});
    expect(templateEditPlan({ name: "작업" }, { name: "작업", projectId: "" })).toEqual({});
  });

  it("이름만 · 프로젝트만 · 둘 다", () => {
    expect(templateEditPlan(cur, { name: "새 이름", projectId: "p1" })).toEqual({ name: "새 이름" });
    expect(templateEditPlan(cur, { name: "작업", projectId: "" })).toEqual({ projectId: null });
    expect(templateEditPlan({ name: "작업" }, { name: "작업", projectId: "p2" })).toEqual({ projectId: "p2" });
    expect(templateEditPlan(cur, { name: "b", projectId: "p2" })).toEqual({ name: "b", projectId: "p2" });
  });

  it("대소문자만 달라도 이름은 바뀐 것 · 빈 이름은 싣지 않는다", () => {
    expect(templateEditPlan({ name: "Work" }, { name: "work", projectId: "" })).toEqual({ name: "work" });
    expect(templateEditPlan(cur, { name: "   ", projectId: "p1" })).toEqual({});
  });
});
