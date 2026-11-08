import { describe, expect, it } from "vitest";
import { iconDisplayName, inheritPlaceholder, resetTitle, swatchHex } from "$lib/host-meta-hint";
import type { Tr } from "$lib/session";
import { translate } from "$lib/i18n/dict";

/** 호스트 폼 표시 탭의 상속 곁말 (docs/log/2026-09-29-hostform-display-tidy.md) */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

describe("iconDisplayName — 저장 형식을 읽히는 이름으로", () => {
  it("큐레이션 로고는 그 라벨", () => {
    expect(iconDisplayName("svg:ubuntu")).toBe("Ubuntu");
    expect(iconDisplayName("svg:postgres")).toBe("PostgreSQL");
  });

  it("logos · lucide 는 단어별 대문자, 끝의 -icon 은 뗀다", () => {
    expect(iconDisplayName("svg:logos:mongodb-icon")).toBe("Mongodb");
    expect(iconDisplayName("svg:logos:google-cloud")).toBe("Google Cloud");
    expect(iconDisplayName("svg:lucide:server-cog")).toBe("Server Cog");
    expect(iconDisplayName("svg:lucide:database")).toBe("Database");
  });

  it("모르는 svg: 이름도 접두사는 보이지 않는다", () => {
    expect(iconDisplayName("svg:gone-away")).toBe("Gone Away");
    expect(iconDisplayName("svg:other:thing")).toBe("Thing");
    expect(iconDisplayName("svg:")).toBe("");
  });

  it("이모지·글자는 그대로, 빈 값은 빈 글자", () => {
    expect(iconDisplayName("🐧")).toBe("🐧");
    expect(iconDisplayName("  ")).toBe("");
    expect(iconDisplayName(null)).toBe("");
  });
});

describe("inheritPlaceholder — 출처 · 값", () => {
  it("프리셋 출처는 그 이름을 말한다", () => {
    expect(inheritPlaceholder(ko, "icon", "svg:ubuntu", { kind: "preset", name: "prod" })).toBe(
      "프리셋 prod 의 아이콘 · Ubuntu",
    );
    expect(inheritPlaceholder(ko, "color", "#4a90d9", { kind: "preset", name: "prod" })).toBe(
      "프리셋 prod 의 색 · #4a90d9",
    );
    expect(inheritPlaceholder(en, "icon", "svg:ubuntu", { kind: "preset", name: "prod" })).toBe(
      "From preset prod · Ubuntu",
    );
  });

  it("[defaults] 출처", () => {
    expect(inheritPlaceholder(ko, "color", "#8a8a8a", { kind: "defaults" })).toBe("기본값의 색 · #8a8a8a");
    expect(inheritPlaceholder(en, "icon", "🐧", { kind: "defaults" })).toBe("From defaults · 🐧");
  });

  it("출처를 모르면 '상속된 …'", () => {
    expect(inheritPlaceholder(ko, "icon", "svg:ubuntu", null)).toBe("상속된 아이콘 · Ubuntu");
    expect(inheritPlaceholder(ko, "color", "#4a90d9", undefined)).toBe("상속된 색 · #4a90d9");
    expect(inheritPlaceholder(en, "color", "#4a90d9", null)).toBe("Inherited color · #4a90d9");
  });

  it("물려받은 값이 없으면 undefined (부르는 쪽의 평소 문구)", () => {
    expect(inheritPlaceholder(ko, "icon", null, null)).toBeUndefined();
    expect(inheritPlaceholder(ko, "color", " ", { kind: "defaults" })).toBeUndefined();
  });

  it("어느 언어에서도 저장 형식이 새지 않는다", () => {
    for (const tr of [ko, en]) {
      expect(inheritPlaceholder(tr, "icon", "svg:logos:mongodb-icon", null)).not.toContain("svg:");
    }
  });
});

describe("resetTitle — 지우면 무엇을 따르는가", () => {
  it("상속값이 없으면 그냥 지우기", () => {
    expect(resetTitle(ko, null, null)).toBe("지우기");
    expect(resetTitle(en, "", { kind: "defaults" })).toBe("Clear");
  });

  it("출처별 문구", () => {
    expect(resetTitle(ko, "#fff", { kind: "preset", name: "prod" })).toBe("지우기 — 프리셋 prod 설정을 따름");
    expect(resetTitle(ko, "#fff", { kind: "defaults" })).toBe("지우기 — 기본값을 따름");
    expect(resetTitle(ko, "#fff", null)).toBe("지우기 — 상속된 값을 따름");
  });
});

describe("swatchHex — 견본 칸이 받는 #rrggbb", () => {
  it("여섯 자리·세 자리 hex", () => {
    expect(swatchHex("#4A90D9")).toBe("#4a90d9");
    expect(swatchHex("#abc")).toBe("#aabbcc");
  });

  it("그 밖의 CSS 색·빈 값은 null", () => {
    expect(swatchHex("tomato")).toBeNull();
    expect(swatchHex("rgb(1,2,3)")).toBeNull();
    expect(swatchHex("")).toBeNull();
    expect(swatchHex(null)).toBeNull();
  });
});
