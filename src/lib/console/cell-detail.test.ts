import { describe, expect, it } from "vitest";
import type { DbConn } from "$lib/db-conn";
import type { PaneSpec, Tr } from "$lib/session";
import { cellDetail, cellLink, clipStart, DETAIL_MAX, type LinkSources } from "$lib/console/cell-detail";

// ---------------------------------------------------------------------------
// 세션 판 칸 말풍선 둘째 줄 — 세션 없는 타일의 위치 (2026-11-03).
// ---------------------------------------------------------------------------

/** 키와 인자를 그대로 비추는 가짜 번역 — 어느 문구를 골랐는지 본다 */
const tr: Tr = (key, params) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")})` : key;

const none = () => null;

function pane(over: Partial<PaneSpec>): PaneSpec {
  return { id: "p1", kind: "local", ...over } as PaneSpec;
}

describe("clipStart — 긴 경로는 앞을 줄인다", () => {
  it("짧으면 그대로, 길면 끝을 남기고 앞에 …", () => {
    expect(clipStart("C:/a/b")).toBe("C:/a/b");
    const long = `C:/${"x".repeat(80)}/README.md`;
    const out = clipStart(long);
    expect(out).toHaveLength(DETAIL_MAX);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("/README.md")).toBe(true);
  });
});

describe("cellDetail — 타일 종류마다", () => {
  it("로컬 파일은 전체 경로, 내 PC(빈 경로)는 없음", () => {
    expect(cellDetail(pane({ kind: "localfs", path: "C:/Users/me/src" }), tr, none)).toBe("C:/Users/me/src");
    expect(cellDetail(pane({ kind: "localfs", path: "" }), tr, none)).toBeNull();
  });

  it("SFTP 는 원격 경로", () => {
    expect(cellDetail(pane({ kind: "sftp", alias: "web-01", path: "/var/log" }), tr, none)).toBe("/var/log");
  });

  it("문서는 경로 — 원격이면 별칭:경로", () => {
    expect(cellDetail(pane({ kind: "doc", path: "C:/n/a.md" }), tr, none)).toBe("C:/n/a.md");
    expect(cellDetail(pane({ kind: "doc", alias: "dev", path: "/h/a.md" }), tr, none)).toBe("dev:/h/a.md");
  });

  it("diff 는 범위 + 고른 파일", () => {
    const base = { projectId: "p" };
    expect(cellDetail(pane({ kind: "diff", diff: { ...base, scope: "branch" } }), tr, none)).toBe(
      "app.sheet.detail.diff.branch",
    );
    expect(cellDetail(pane({ kind: "diff", diff: { ...base, scope: "wip", file: "src/a.ts" } }), tr, none)).toBe(
      "app.sheet.detail.diff.wip · src/a.ts",
    );
    expect(cellDetail(pane({ kind: "diff", diff: { ...base, scope: "commit", commit: "abcdef1234" } }), tr, none)).toBe(
      "app.sheet.detail.diff.commit(hash=abcdef1)",
    );
    expect(
      cellDetail(pane({ kind: "diff", diff: { ...base, scope: "range", base: "1111111aa", tip: "2222222bb" } }), tr, none),
    ).toBe("app.sheet.detail.diff.range(base=1111111,tip=2222222)");
  });

  it("DB 는 엔진 · 데이터베이스 · 경유, 연결을 못 찾으면 없음", () => {
    const conn: DbConn = { id: "c1", name: "운영", engine: "postgres", database: "app", via: "dev-01" };
    const q = pane({ kind: "query", query: { connId: "c1" } });
    expect(cellDetail(q, tr, (id) => (id === "c1" ? conn : null))).toBe(
      "app.query.engine.postgres · app · app.sheet.detail.db.via(host=dev-01)",
    );
    expect(cellDetail(q, tr, none)).toBeNull();
  });

  it("브랜치 · 시작 · 세션 타일은 없음", () => {
    for (const kind of ["branches", "start", "local", "ssh", "run"] as const) {
      expect(cellDetail(pane({ kind }), tr, none)).toBeNull();
    }
  });
});

describe("cellLink — DB · 원격 파일의 연결 상태", () => {
  const src = (over: Partial<LinkSources> = {}): LinkSources => ({
    queryLive: () => null,
    sourceState: () => null,
    ...over,
  });

  it("쿼리 타일은 사본의 상태 · 쓰기 켬(연결됐을 때만), 사본이 없으면 모름", () => {
    const q = pane({ kind: "query", query: { connId: "c1" } });
    expect(cellLink(q, src())).toBeNull();
    expect(cellLink(q, src({ queryLive: () => ({ state: "open", writable: true }) }))).toEqual({ state: "open", writable: true });
    expect(cellLink(q, src({ queryLive: () => ({ state: "connecting", writable: false }) }))).toEqual({
      state: "connecting",
      writable: false,
    });
    expect(cellLink(q, src({ queryLive: () => ({ state: "closed", writable: true }) }))).toEqual({
      state: "closed",
      writable: false,
    });
  });

  it("SFTP · 원격 문서는 원본 터미널 — 없거나 끊김이면 끊김", () => {
    const sftp = pane({ kind: "sftp", alias: "web", sourcePaneId: "s1" });
    expect(cellLink(sftp, src({ sourceState: (id) => (id === "s1" ? "idle" : null) }))?.state).toBe("open");
    expect(cellLink(sftp, src({ sourceState: () => "off" }))?.state).toBe("closed");
    expect(cellLink(sftp, src())?.state).toBe("closed");
    const doc = pane({ kind: "doc", alias: "web", path: "/a.md", sourcePaneId: "s1" });
    expect(cellLink(doc, src({ sourceState: () => "running" }))?.state).toBe("open");
  });

  it("로컬 파일 · 로컬 문서 · diff 는 연결이 없다", () => {
    expect(cellLink(pane({ kind: "localfs", path: "C:/" }), src())).toBeNull();
    expect(cellLink(pane({ kind: "doc", path: "C:/a.md" }), src())).toBeNull();
    expect(cellLink(pane({ kind: "diff" }), src())).toBeNull();
  });
});
