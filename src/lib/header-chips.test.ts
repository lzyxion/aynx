import { describe, expect, it } from "vitest";
import {
  HEADER_CHIP_IDS,
  isDefaultChipOrder,
  migrateLegacyChips,
  moveChip,
  moveChipTo,
  normalizeChipHidden,
  normalizeChipOrder,
} from "./header-chips";

describe("normalizeChipOrder", () => {
  it("배열이 아니거나 비면 기본 순서", () => {
    expect(normalizeChipOrder(undefined)).toEqual([...HEADER_CHIP_IDS]);
    expect(normalizeChipOrder("folder")).toEqual([...HEADER_CHIP_IDS]);
    expect(normalizeChipOrder([])).toEqual([...HEADER_CHIP_IDS]);
  });

  it("모르는 id · 중복 · 문자열 아닌 값을 버리고 공백을 뗀다", () => {
    const all = ["resource", "ai", "forward", "jump", "tmux", "branch", "folder"];
    expect(normalizeChipOrder([...all, "nope", "folder", 3, " tmux "])).toEqual(all);
    expect(normalizeChipOrder([" resource ", "x", ...all])).toEqual(all);
  });

  it("기본 순서 — 폴더 → 브랜치 → 경유 → tmux → 포워딩 → 자원 → AI 권한(10-23)", () => {
    expect([...HEADER_CHIP_IDS]).toEqual(["folder", "branch", "jump", "tmux", "forward", "resource", "ai"]);
  });

  it("빠진 id 는 기본 순서상 앞 이웃 바로 뒤에 끼운다", () => {
    // resource 가 빠졌다 — 앞 이웃 forward 뒤
    expect(normalizeChipOrder(["ai", "forward", "jump", "tmux", "branch", "folder"])).toEqual([
      "ai",
      "forward",
      "resource",
      "jump",
      "tmux",
      "branch",
      "folder",
    ]);
    // folder(맨 앞 칩)가 빠졌다 — 앞 이웃이 없으니 맨 앞
    expect(normalizeChipOrder(["branch", "jump", "tmux", "forward", "resource", "ai"])[0]).toBe("folder");
    // 여럿이 빠졌다 — 앞에서부터 차례로 끼운다(resource 는 forward 뒤 · ai 는 그 resource 뒤)
    expect(normalizeChipOrder(["forward", "folder"])).toEqual([
      "forward",
      "resource",
      "ai",
      "folder",
      "branch",
      "jump",
      "tmux",
    ]);
  });

  it("옛 id `ai_read` 는 이 함수가 모른다(옮기기는 `migrateLegacyChips`)", () => {
    expect(normalizeChipOrder(["ai_read"])).toEqual([...HEADER_CHIP_IDS]);
    expect(HEADER_CHIP_IDS as readonly string[]).not.toContain("ai_read");
  });

  it("결과에는 모든 칩이 꼭 한 번씩 든다", () => {
    const out = normalizeChipOrder(["ai", "ai", "zzz", "jump"]);
    expect([...out].sort()).toEqual([...HEADER_CHIP_IDS].sort());
  });
});

describe("normalizeChipHidden", () => {
  it("아는 id 만 · 중복 없이 · 기본 순서대로", () => {
    expect(normalizeChipHidden(["resource", "nope", "jump", "resource", 1])).toEqual(["jump", "resource"]);
    expect(normalizeChipHidden(undefined)).toEqual([]);
    expect(normalizeChipHidden("jump")).toEqual([]);
  });
});

describe("migrateLegacyChips — 옛 `ai_read` → `ai` (10-23)", () => {
  it("옛 id 가 없으면 받은 값을 그대로", () => {
    const order = ["ai", "folder"];
    const hidden = ["ai"];
    const out = migrateLegacyChips(order, hidden);
    expect(out.order).toBe(order);
    expect(out.hidden).toBe(hidden);
    expect(migrateLegacyChips(undefined, "x")).toEqual({ order: undefined, hidden: "x" });
  });

  it("순서 — `ai` 의 자리가 이기고, 없으면 `ai_read` 의 자리", () => {
    expect(migrateLegacyChips(["ai_read", "folder", "ai"], undefined).order).toEqual(["folder", "ai"]);
    expect(migrateLegacyChips(["tmux", " ai_read ", "folder"], undefined).order).toEqual(["tmux", "ai", "folder"]);
  });

  it("켬끔 — 하나라도 켜져 있었으면 켬, 둘 다 껐으면 끔", () => {
    expect(migrateLegacyChips(undefined, ["ai_read"]).hidden).toEqual([]);
    expect(migrateLegacyChips(undefined, ["ai", "ai_read", "jump"]).hidden).toEqual(["jump", "ai"]);
    // 순서에 `ai_read` 가 있으면 옛 파일 — `ai` 만 끈 것은 로컬 칩이 켜져 있었다는 뜻
    expect(migrateLegacyChips(["ai", "ai_read"], ["ai", "tmux"]).hidden).toEqual(["tmux"]);
  });

  it("옮긴 순서가 10-23 전의 기본과 같으면 `undefined`(= 지금의 기본)로 접는다 — `ai_read` 하나만 옮겨 둔 파일", () => {
    const prev = ["folder", "branch", "tmux", "jump", "forward", "ai", "resource"];
    expect(migrateLegacyChips(["ai_read", ...prev], undefined).order).toBeUndefined();
    expect(migrateLegacyChips(["folder", "branch", "tmux", "jump", "forward", "ai", "ai_read", "resource"], undefined).order).toBeUndefined();
    // `ai_read` 가 `ai` 의 자리를 정했고 그것이 옛 기본과 같아도 접는다
    expect(migrateLegacyChips(["folder", "branch", "tmux", "jump", "forward", "ai_read", "resource"], undefined).order).toBeUndefined();
    // 다른 칩도 옮겨 두었으면 그대로
    expect(migrateLegacyChips(["ai_read", "jump", "folder", "branch", "tmux", "forward", "ai", "resource"], undefined).order).toEqual([
      "jump",
      "folder",
      "branch",
      "tmux",
      "forward",
      "ai",
      "resource",
    ]);
    // 옛 id 가 없는 파일의 옛 기본 순서는 손대지 않는다(지금 일부러 고른 순서일 수 있다)
    expect(migrateLegacyChips(prev, undefined).order).toBe(prev);
  });

  it("배열이 아닌 값에도 죽지 않는다", () => {
    expect(() => migrateLegacyChips("ai_read", 5)).not.toThrow();
    expect(migrateLegacyChips(["ai_read"], null)).toEqual({ order: ["ai"], hidden: null });
  });
});

describe("isDefaultChipOrder", () => {
  it("기본 순서일 때만 참", () => {
    expect(isDefaultChipOrder([...HEADER_CHIP_IDS])).toBe(true);
    expect(isDefaultChipOrder(moveChip([...HEADER_CHIP_IDS], "folder", 1))).toBe(false);
    expect(isDefaultChipOrder(HEADER_CHIP_IDS.slice(1))).toBe(false);
  });
});

describe("moveChip", () => {
  const base = ["a", "b", "c"] as const;
  it("이웃과 맞바꾼다", () => {
    expect(moveChip(base, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveChip(base, "b", 1)).toEqual(["a", "c", "b"]);
  });
  it("끝을 넘거나 없는 id 면 같은 배열", () => {
    expect(moveChip(base, "a", -1)).toBe(base);
    expect(moveChip(base, "c", 1)).toBe(base);
    expect(moveChip(base as readonly string[], "z", 1)).toBe(base);
  });
});

describe("moveChipTo", () => {
  const base = ["a", "b", "c", "d"];
  it("나머지 사이의 자리에 끼운다", () => {
    expect(moveChipTo(base, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveChipTo(base, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveChipTo(base, "b", 1)).toEqual(base);
  });
  it("자리를 자르고, 없는 id 면 복사본 그대로", () => {
    expect(moveChipTo(base, "a", 99)).toEqual(["b", "c", "d", "a"]);
    expect(moveChipTo(base, "a", -5)).toEqual(base);
    expect(moveChipTo(base, "z", 1)).toEqual(base);
  });
});
