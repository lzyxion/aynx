import { describe, expect, it } from "vitest";
import { replayResize, replaySplitAt } from "./replay-split";

// 7단계 발견 ① — 다시 붙는 채널의 덩어리를 재생 끝에서 나눈다(재생분은 답하지 않고, 경계 뒤 실시간 질의는 xterm 이 답한다).

describe("replaySplitAt", () => {
  it("splits only a chunk that straddles the replay end", () => {
    // 재생 끝 100 — 90..110 덩어리는 10 바이트 뒤에서 나눈다(앞 10 = 재생, 뒤 10 = 실시간 — 그 안의 ESC[6n 은 답한다).
    expect(replaySplitAt(90, 20, 100, true)).toBe(10);
    // 끝이 정확히 경계 · 경계 뒤 · 경계 앞 덩어리는 통째로.
    expect(replaySplitAt(80, 20, 100, true)).toBeNull();
    expect(replaySplitAt(100, 20, 100, true)).toBeNull();
    expect(replaySplitAt(120, 5, 100, true)).toBeNull();
    expect(replaySplitAt(0, 50, 100, true)).toBeNull();
  });

  it("replays at the PTY size only without a checkpoint and when the sizes differ (10-15)", () => {
    const tile = { cols: 70, rows: 18 };
    // 서버가 120칸으로 띄운 작업자를 70칸 타일에 처음 붙인다 — 재생은 120칸으로.
    expect(replayResize({ cols: 120, rows: 30 }, tile, false, true)).toEqual({ cols: 120, rows: 30 });
    // 맡긴 화면이 있으면 · 크기가 같으면 · 크기를 모르면 · 숨은 탭이면 그대로(재부착 일반 경로).
    expect(replayResize({ cols: 120, rows: 30 }, tile, true, true)).toBeNull();
    expect(replayResize({ cols: 70, rows: 18 }, tile, false, true)).toBeNull();
    expect(replayResize(undefined, tile, false, true)).toBeNull();
    expect(replayResize({ cols: 0, rows: 0 }, tile, false, true)).toBeNull();
    expect(replayResize({ cols: 120, rows: 30 }, tile, false, false)).toBeNull();
  });

  it("does nothing outside a replay or without a known end", () => {
    expect(replaySplitAt(90, 20, 100, false)).toBeNull();
    expect(replaySplitAt(90, 20, null, true)).toBeNull();
    expect(replaySplitAt(90, 0, 100, true)).toBeNull();
  });
});
