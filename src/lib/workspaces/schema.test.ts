import { describe, expect, it, vi } from "vitest";
import { assignTileKeys, collectTileKeys, newTabKey, newTileKey, type SavedNodeV2 } from "./schema";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("workspace 영속 키", () => {
  it("UUID를 만들며 탭/타일 키는 공유 카운터에 기대지 않는다", () => {
    const keys = Array.from({ length: 100 }, () => [newTabKey(), newTileKey()]).flat();
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(uuidPattern);
  });

  it("키가 없는 잎만 채우고 트리·기존 키·이력·추가 필드를 보존한다", () => {
    const root = Object.freeze({
      dir: "row" as const, ratio: 0.3, futureSplit: { x: 1 },
      a: Object.freeze({ kind: "local" as const, historyStreamId: "original", futureLeaf: true }),
      b: Object.freeze({ kind: "start" as const, tileKey: "kept", futureLeaf: [1, 2] }),
    });
    const assigned = assignTileKeys(root);
    expect(collectTileKeys(root)).toEqual(["kept"]);
    expect(collectTileKeys(assigned)).toEqual([expect.stringMatching(uuidPattern), "kept"]);
    expect(assigned).toMatchObject({ futureSplit: { x: 1 }, a: { historyStreamId: "original", futureLeaf: true }, b: root.b });
    expect(assignTileKeys(assigned)).toEqual(assigned);
  });

  it("중첩 분할과 중복 키를 순서대로 모은다", () => {
    const root: SavedNodeV2 = {
      dir: "col", ratio: 0.5, a: { kind: "local", tileKey: "same" },
      b: { dir: "row", ratio: 0.5, a: { kind: "start", tileKey: "last" }, b: { kind: "doc", tileKey: "same" } },
    };
    expect(collectTileKeys(root)).toEqual(["same", "last", "same"]);
  });

  it("crypto 없는 SSR 폴백도 UUID v4 형식이다", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(newTabKey()).toMatch(uuidPattern);
      expect(newTileKey()).toMatch(uuidPattern);
    } finally { vi.unstubAllGlobals(); }
  });

  it("randomUUID가 없는 환경에서는 getRandomValues를 쓴다", () => {
    const random = vi.fn((bytes: Uint8Array) => { bytes.fill(0xab); return bytes; });
    vi.stubGlobal("crypto", { getRandomValues: random });
    try {
      expect(newTileKey()).toMatch(uuidPattern);
      expect(random).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
