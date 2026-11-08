import { describe, expect, it } from "vitest";
import { tileCode } from "$lib/context";

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
