import { describe, expect, it } from "vitest";
import { droppedFavorites, favoriteDropKind } from "$lib/favorite-drop";
import { encodeHostsDrag, HOSTS_DRAG_TYPE } from "$lib/hosts";
import { PROJECT_DRAG_TYPE } from "$lib/projects";
import { DB_DOCK_DRAG_TYPE } from "$lib/db-folders";
import { inDockHover } from "$lib/floating-dock";

/** 즐겨찾기로 받는 짐(하단 독 — 2026-10-23)과 하단 독의 호버 띠 */

describe("favoriteDropKind", () => {
  it("호스트 줄 · 프로젝트 줄 · DB 연결 줄만 우리 짐이다", () => {
    expect(favoriteDropKind([HOSTS_DRAG_TYPE])).toBe("host");
    expect(favoriteDropKind(["text/plain", PROJECT_DRAG_TYPE])).toBe("project");
    expect(favoriteDropKind(["text/plain", DB_DOCK_DRAG_TYPE])).toBe("db");
  });
  it("파일 · 탭 · 타일 · 모르는 짐은 받지 않는다", () => {
    expect(favoriteDropKind(["Files"])).toBeNull();
    expect(favoriteDropKind(["application/x-aynx-tab"])).toBeNull();
    expect(favoriteDropKind([])).toBeNull();
    expect(favoriteDropKind(undefined)).toBeNull();
  });
});

describe("droppedFavorites", () => {
  const read = (map: Record<string, string>) => (type: string) => map[type] ?? "";

  it("호스트 폴더는 받지 않는다 — 섞이면 호스트만", () => {
    const raw = encodeHostsDrag({ hosts: ["web-01", "db"], groups: ["prod"] });
    expect(droppedFavorites("host", read({ [HOSTS_DRAG_TYPE]: raw }))).toEqual([
      { kind: "host", alias: "web-01" },
      { kind: "host", alias: "db" },
    ]);
    const onlyFolder = encodeHostsDrag({ hosts: [], groups: ["prod"] });
    expect(droppedFavorites("host", read({ [HOSTS_DRAG_TYPE]: onlyFolder }))).toEqual([]);
  });

  it("DB 짐은 연결만 받는다 — 폴더 키 · 모르는 키는 버리고 짐의 순서대로", () => {
    const raw = ["conn:D2", "f:운영", "conn:D1", "x:?", ""].join(String.fromCharCode(10));
    expect(droppedFavorites("db", read({ [DB_DOCK_DRAG_TYPE]: raw }))).toEqual([
      { kind: "db", id: "D2" },
      { kind: "db", id: "D1" },
    ]);
    expect(droppedFavorites("db", read({ [DB_DOCK_DRAG_TYPE]: "f:운영" }))).toEqual([]);
    expect(droppedFavorites("db", read({}))).toEqual([]);
  });

  it("프로젝트 id 하나 — 비면 아무것도", () => {
    expect(droppedFavorites("project", read({ [PROJECT_DRAG_TYPE]: " P1 " }))).toEqual([{ kind: "project", id: "P1" }]);
    expect(droppedFavorites("project", read({}))).toEqual([]);
  });
});

describe("inDockHover", () => {
  const zone = { left: 400, right: 600, top: 584, bottom: 600 };

  it("창 아래 가운데 ±90px · 뿌리 높이가 띠다", () => {
    expect(inDockHover(500, 590, 1000, zone, null)).toBe(true);
    expect(inDockHover(590, 590, 1000, zone, null)).toBe(true);
    expect(inDockHover(591, 590, 1000, zone, null)).toBe(false);
    expect(inDockHover(500, 580, 1000, zone, null)).toBe(false);
  });

  it("보이는 판의 가로 폭 안이면 판 위끝부터 뿌리 아래끝까지 독 위다", () => {
    const panel = { left: 300, right: 700, top: 520, bottom: 576 };
    expect(inDockHover(320, 530, 1000, zone, panel)).toBe(true);
    expect(inDockHover(320, 580, 1000, zone, panel)).toBe(true);
    expect(inDockHover(320, 510, 1000, zone, panel)).toBe(false);
    expect(inDockHover(320, 530, 1000, zone, null)).toBe(false);
  });

  it("뿌리를 모르면 언제나 거짓", () => {
    expect(inDockHover(500, 590, 1000, null, null)).toBe(false);
  });
});
