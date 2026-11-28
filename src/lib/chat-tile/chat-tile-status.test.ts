import { describe, expect, it } from "vitest";
import { chatTileDot, chatTileResolvedBy, chatTileTurnNotifyKind } from "./chat-tile-status";

const base = { status: "ready" as const, sending: false, pending: 0, unseen: false };

describe("chatTileDot — 권한 > 실행 > 끝남", () => {
  it("대기 카드가 있으면 실행 · 안 봄보다 권한", () => {
    expect(chatTileDot({ ...base, status: "running", sending: true, pending: 1, unseen: true })).toBe("permission");
  });

  it("running · starting · 보내는 중은 실행", () => {
    expect(chatTileDot({ ...base, status: "running", unseen: true })).toBe("running");
    expect(chatTileDot({ ...base, status: "starting" })).toBe("running");
    expect(chatTileDot({ ...base, status: "stopped", sending: true })).toBe("running");
  });

  it("쉼 + 안 봄 → finished · 쉼 → null", () => {
    expect(chatTileDot({ ...base, unseen: true })).toBe("finished");
    expect(chatTileDot({ ...base, status: "stopped", unseen: true })).toBe("finished");
    expect(chatTileDot(base)).toBeNull();
    expect(chatTileDot({ ...base, status: "stopped" })).toBeNull();
  });
});

describe("chatTileTurnNotifyKind", () => {
  it("ok → stop · error → failed · interrupted → null", () => {
    expect(chatTileTurnNotifyKind("ok")).toBe("stop");
    expect(chatTileTurnNotifyKind("error")).toBe("failed");
    expect(chatTileTurnNotifyKind("interrupted")).toBeNull();
  });
});

describe("chatTileResolvedBy", () => {
  it("턴이 서면 셋 다", () => {
    expect(chatTileResolvedBy({ turnStarted: true, permissionsCleared: false })).toEqual(["stop", "failed", "permission"]);
    expect(chatTileResolvedBy({ turnStarted: true, permissionsCleared: true })).toEqual(["stop", "failed", "permission"]);
  });

  it("대기 카드가 0 이 되면 권한만 · 그 밖은 없음", () => {
    expect(chatTileResolvedBy({ turnStarted: false, permissionsCleared: true })).toEqual(["permission"]);
    expect(chatTileResolvedBy({ turnStarted: false, permissionsCleared: false })).toEqual([]);
  });
});
