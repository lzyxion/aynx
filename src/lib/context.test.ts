import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldReportMirror, tileCode } from "$lib/context";

/**
 * `tileCode` — 저장소 키의 두 투영 중 하나(다른 하나는 `contextKey`). Rust `mcp::tile_code` 와
 * **같은 규칙**이라야 헤더와 MCP `code` 가 짝이 된다. 그 규칙을 여기서 못 박는다.
 */
describe("tileCode", () => {
  it("메인 창은 접두사 없이 p<n>", () => {
    expect(tileCode("main", "pane-2")).toBe("p2");
    expect(tileCode("main", "pane-17")).toBe("p17");
  });

  it("뜯어낸 창은 t<n>·p<n> (전역 유일 + 창 힌트)", () => {
    expect(tileCode("tear-7", "pane-2")).toBe("t7·p2");
    expect(tileCode("tear-12", "pane-3")).toBe("t12·p3");
  });

  it("낯선 창 레이블은 <label>·<tile> 로 유일성만 지킨다", () => {
    expect(tileCode("other", "pane-3")).toBe("other·p3");
  });

  it("낯선 타일 id 는 그대로 둔다 (pane- 접두사가 없으면)", () => {
    expect(tileCode("main", "weird")).toBe("weird");
    expect(tileCode("tear-4", "weird")).toBe("t4·weird");
  });

  it("빈 입력도 무너지지 않는다 (표시 전용)", () => {
    expect(tileCode("main", "")).toBe("");
    expect(tileCode("", "pane-1")).toBe("·p1");
  });
});

/**
 * 새 페이지(GUI 재시작 · 리로드 · 트레이에서 다시 연 창)의 첫 꺼짐 보고(2026-11-10 실기) — 붙기가 공유 토글을 되살리기 전의
 * `optedIn:false` 가 서버 거울(창이 없던 동안 서버가 쓴 명령 블록)을 지웠다.
 */
describe("shouldReportMirror", () => {
  it("아직 보고 안 했고 세션도 안 선 꺼짐은 보내지 않는다", () => {
    expect(shouldReportMirror(false, false, false)).toBe(false);
  });

  it("켜짐 · 세션이 선 뒤 · 한 번 보고한 뒤의 꺼짐은 보낸다(프라이버시)", () => {
    expect(shouldReportMirror(true, false, false)).toBe(true);
    expect(shouldReportMirror(false, false, true)).toBe(true);
    expect(shouldReportMirror(false, true, false)).toBe(true);
  });

  it("Terminal 은 그 판정으로 보고하고 · 재생이 다시 만든 블록은 올리지 않는다", () => {
    const term = readFileSync(fileURLToPath(new URL("./Terminal.svelte", import.meta.url)), "utf8");
    expect(term).toContain("if (!shouldReportMirror(on, mirrorAnnounced, live !== null && live !== undefined)) return;");
    // 붙기는 토글을 되살린 뒤 세션을 알린다 — 같은 틱이라 첫 보고가 켜진 채 나간다
    expect(term).toMatch(/plan\.aiRead && !localAiTile\(pane\)\) setShared\(pane\.id, true\);\s*onsession\?\.\(pane\.id, s\.id\);/);
    expect(term).toMatch(/if \(!aiOn\) return;\s*(\/\/.*\s*)*if \(replaying\) return;\s*void pushSessionBlock\(contextKeyOf, block\);/);
  });
});
