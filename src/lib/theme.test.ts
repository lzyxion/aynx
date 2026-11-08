import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERM_PRESET,
  DYNAMIC_DARK_TERM_KEY,
  DYNAMIC_LIGHT_TERM_KEY,
  DYNAMIC_TERM_KEY,
  LIGHT_OF,
  TERM_PRESETS,
  canonicalPreset,
  pairedPreset,
  presetSwatches,
  termPresetGroups,
  termTheme,
  termThemeOf,
  withScrollbarSlider,
  withTransparentCanvas,
} from "$lib/theme";
import type { ITheme } from "@xterm/xterm";

/** 터미널 프리셋 표와 팔레트 가공 (docs/log/2026-09-04-light-theme.md · 2026-09-04-dynamic-color.md) */

describe("TERM_PRESETS", () => {
  it("기본 프리셋 키가 표 안에 있다", () => {
    expect(TERM_PRESETS[DEFAULT_TERM_PRESET]).toBeDefined();
    expect(termTheme).toBe(TERM_PRESETS[DEFAULT_TERM_PRESET].theme);
  });

  it("모든 프리셋이 배경·글자색을 갖는다", () => {
    for (const [key, preset] of Object.entries(TERM_PRESETS)) {
      expect(preset.theme.background, key).toBeTruthy();
      expect(preset.theme.foreground, key).toBeTruthy();
    }
  });

  it("LIGHT_OF 의 양쪽 키가 전부 실재하는 프리셋이다 — 표가 갈리면 짝짓기가 죽는다", () => {
    for (const [dark, light] of Object.entries(LIGHT_OF)) {
      expect(TERM_PRESETS[dark], dark).toBeDefined();
      expect(TERM_PRESETS[light], light).toBeDefined();
    }
  });

  it("한 라이트 프리셋이 두 다크 프리셋의 짝이 되지는 않는다 (뒤집은 표가 성립한다)", () => {
    const lights = Object.values(LIGHT_OF);
    expect(new Set(lights).size).toBe(lights.length);
  });
});

/** 걷은 Luna 프리셋(2026-10-13) · Cyberpunk · 짝 없는 `light` 프리셋(2026-10-24) */
const LEGACY_PRESET_KEYS = [
  "light",
  "luna-dark",
  "luna-light",
  "cyber-2077-dark",
  "cyber-2077-light",
  "cyber-neon-dark",
  "cyber-neon-light",
];

describe("termPresetGroups", () => {
  it("다크 묶음 → 라이트 묶음, n번째 다크의 짝이 n번째 라이트다", () => {
    const { dark, light } = termPresetGroups();
    expect(dark).toEqual(["aynx-dark", "graphite-dark", "tokyo-night", "gruvbox-dark"]);
    expect(light).toEqual(["aynx-light", "graphite-light", "solarized-light", "gruvbox-light"]);
    dark.forEach((k, i) => expect(LIGHT_OF[k]).toBe(light[i]));
  });

  it("모든 프리셋이 정확히 한 번 나온다 — 짝 표 밖 프리셋을 들이면 여기서 걸린다", () => {
    const { dark, light } = termPresetGroups();
    expect([...dark, ...light].sort()).toEqual(Object.keys(TERM_PRESETS).sort());
  });
});

describe("canonicalPreset", () => {
  it("옛 키를 지금 키로 옮긴다", () => {
    expect(canonicalPreset("luna-dark")).toBe("aynx-dark");
    expect(canonicalPreset("luna-light")).toBe("aynx-light");
  });

  it("걷은 Cyberpunk 프리셋은 모드를 지켜 AYNX 로 접힌다", () => {
    expect(canonicalPreset("cyber-2077-dark")).toBe("aynx-dark");
    expect(canonicalPreset("cyber-neon-dark")).toBe("aynx-dark");
    expect(canonicalPreset("cyber-2077-light")).toBe("aynx-light");
    expect(canonicalPreset("cyber-neon-light")).toBe("aynx-light");
  });

  it("걷은 짝 없는 light 프리셋은 밝은 쪽 기본(AYNX Light)으로 접힌다", () => {
    expect(canonicalPreset("light")).toBe("aynx-light");
  });

  it("옛 키는 지금 표에 없다 — 표에 다시 생기면 별칭이 그 프리셋을 가린다", () => {
    for (const key of LEGACY_PRESET_KEYS) expect(TERM_PRESETS[key], key).toBeUndefined();
  });

  it("옮긴 결과가 실재하는 프리셋이다 — 표가 갈리면 옛 설정이 기본값으로 떨어진다", () => {
    for (const key of LEGACY_PRESET_KEYS) expect(TERM_PRESETS[canonicalPreset(key)]).toBeDefined();
  });

  it("지금 키는 그대로다", () => {
    for (const key of Object.keys(TERM_PRESETS)) expect(canonicalPreset(key)).toBe(key);
  });

  it("dynamic·모르는 키는 그대로 통과한다 (여기서 판정하지 않는다)", () => {
    expect(canonicalPreset(DYNAMIC_TERM_KEY)).toBe(DYNAMIC_TERM_KEY);
    expect(canonicalPreset("없는프리셋")).toBe("없는프리셋");
  });

  it("빈 값은 빈 값 그대로다", () => {
    expect(canonicalPreset(null)).toBeNull();
    expect(canonicalPreset(undefined)).toBeUndefined();
    expect(canonicalPreset("")).toBe("");
  });
});

describe("pairedPreset", () => {
  it("다크 → 라이트로 갈아 끼운다", () => {
    expect(pairedPreset("aynx-dark", true)).toBe("aynx-light");
  });

  it("라이트 → 다크로 되돌린다", () => {
    expect(pairedPreset("aynx-light", false)).toBe("aynx-dark");
  });

  it("이미 그쪽 모드면 null — 바꿀 것이 없다", () => {
    expect(pairedPreset("aynx-light", true)).toBeNull();
    expect(pairedPreset("aynx-dark", false)).toBeNull();
  });

  it("짝이 없는 키(dynamic·모르는 키)는 null", () => {
    expect(pairedPreset(DYNAMIC_TERM_KEY, true)).toBeNull();
    expect(pairedPreset("없는프리셋", true)).toBeNull();
  });

  it("빈 값은 기본 프리셋으로 읽는다", () => {
    expect(pairedPreset(null, true)).toBe(LIGHT_OF[DEFAULT_TERM_PRESET]);
    expect(pairedPreset(undefined, true)).toBe(LIGHT_OF[DEFAULT_TERM_PRESET]);
    expect(pairedPreset("", true)).toBe(LIGHT_OF[DEFAULT_TERM_PRESET]);
  });
});

describe("termThemeOf", () => {
  it("아는 키는 그 프리셋의 팔레트", () => {
    expect(termThemeOf("aynx-light")).toBe(TERM_PRESETS["aynx-light"].theme);
  });

  it("모르는 키·빈 값은 조용히 기본 프리셋으로 떨어진다", () => {
    expect(termThemeOf("없는프리셋")).toBe(termTheme);
    expect(termThemeOf(null)).toBe(termTheme);
    expect(termThemeOf(undefined)).toBe(termTheme);
    expect(termThemeOf("")).toBe(termTheme);
  });

  it("가상 키 `dynamic` 은 두 번째 인자를 끼워 넣는다", () => {
    const dyn: ITheme = { background: "#123456", foreground: "#abcdef" };
    expect(termThemeOf(DYNAMIC_TERM_KEY, dyn)).toBe(dyn);
  });

  it("`dynamic` 인데 팔레트가 없으면 기본 프리셋이다 (빈 화면이 되지 않는다)", () => {
    expect(termThemeOf(DYNAMIC_TERM_KEY)).toBe(termTheme);
  });

  it("`dynamic` 은 정적 프리셋 표에 들어 있지 않다", () => {
    expect(TERM_PRESETS[DYNAMIC_TERM_KEY]).toBeUndefined();
  });

  it("고정 밝기 키 둘은 넷째 인자에서 제 밝기를 끼워 넣고, 없으면 기본 프리셋 · 짝 표 밖이다", () => {
    const dyn: ITheme = { background: "#f4f4f2", foreground: "#2a2a2e" };
    const dark: ITheme = { background: "#123456", foreground: "#abcdef" };
    const fixed = { dark, light: dyn };
    expect(termThemeOf(DYNAMIC_DARK_TERM_KEY, dyn, undefined, fixed)).toBe(dark);
    expect(termThemeOf(DYNAMIC_LIGHT_TERM_KEY, dyn, undefined, fixed)).toBe(dyn);
    expect(termThemeOf(DYNAMIC_TERM_KEY, dyn, undefined, fixed)).toBe(dyn);
    expect(termThemeOf(DYNAMIC_DARK_TERM_KEY, dyn)).toBe(termTheme);
    expect(termThemeOf(DYNAMIC_LIGHT_TERM_KEY, dyn, undefined, { dark })).toBe(termTheme);
    for (const key of [DYNAMIC_DARK_TERM_KEY, DYNAMIC_LIGHT_TERM_KEY]) {
      expect(TERM_PRESETS[key]).toBeUndefined();
      expect(pairedPreset(key, true)).toBeNull();
      expect(pairedPreset(key, false)).toBeNull();
    }
  });
});

describe("presetSwatches", () => {
  it("배경·글자에 이어 대표 ANSI 6색 — 여덟 칸", () => {
    expect(presetSwatches(termTheme)).toHaveLength(8);
  });

  it("비어 있는 칸은 건너뛴다", () => {
    expect(presetSwatches({ background: "#000", red: "#f00" })).toEqual(["#000", "#f00"]);
    expect(presetSwatches({})).toEqual([]);
  });
});

describe("withTransparentCanvas", () => {
  const theme: ITheme = { background: "#102030", foreground: "#eeeeee" };

  it("100%(기본)면 원본을 **그대로** 돌려준다 — 참조까지", () => {
    expect(withTransparentCanvas(theme, 100)).toBe(theme);
    expect(withTransparentCanvas(theme, 120)).toBe(theme);
  });

  it("NaN 도 부정형 비교에 걸려 원본이다", () => {
    expect(withTransparentCanvas(theme, Number.NaN)).toBe(theme);
  });

  it("100 미만이면 배경만 알파 0 인 사본 — 색은 그대로다", () => {
    const next = withTransparentCanvas(theme, 80);
    expect(next).not.toBe(theme);
    expect(next.background).toBe("#10203000");
    expect(next.foreground).toBe("#eeeeee");
    expect(theme.background).toBe("#102030"); // 원본은 오염되지 않는다
  });

  it("`#rgb` 는 펴서 쓰고, `#rrggbbaa` 는 옛 알파를 버린다", () => {
    expect(withTransparentCanvas({ background: "#123" }, 50).background).toBe("#11223300");
    expect(withTransparentCanvas({ background: "#11223344" }, 50).background).toBe("#11223300");
  });

  it("모르는 형식은 손대지 않는다 (배경이 통째로 검어지는 것보다 낫다)", () => {
    const named: ITheme = { background: "rgb(1,2,3)" };
    expect(withTransparentCanvas(named, 50)).toBe(named);
    const empty: ITheme = { foreground: "#fff" };
    expect(withTransparentCanvas(empty, 50)).toBe(empty);
  });
});

describe("withScrollbarSlider", () => {
  it("글자색에서 세 칸을 파생시킨다 — 옅은 → 짙은 순서", () => {
    const next = withScrollbarSlider({ foreground: "#ffffff" });
    expect(next.scrollbarSliderBackground).toBe("#ffffff2e");
    expect(next.scrollbarSliderHoverBackground).toBe("#ffffff4d");
    expect(next.scrollbarSliderActiveBackground).toBe("#ffffff73");
  });

  it("이미 정해져 있으면 그대로 둔다 (참조까지)", () => {
    const theme: ITheme = {
      foreground: "#fff",
      scrollbarSliderBackground: "#abc",
      overviewRulerBorder: "#123",
    };
    expect(withScrollbarSlider(theme)).toBe(theme);
  });

  it("글자색을 못 읽으면 손잡이 색은 건너뛴다 — 눈금자 테두리만 지운다", () => {
    const next = withScrollbarSlider({ background: "#000" });
    expect(next.scrollbarSliderBackground).toBeUndefined();
    expect(next.overviewRulerBorder).toBe("#00000000");
  });

  it("개요 눈금자 테두리는 투명으로 지운다 — 손잡이 색이 이미 있어도", () => {
    expect(withScrollbarSlider({ foreground: "#fff" }).overviewRulerBorder).toBe("#00000000");
    const kept = withScrollbarSlider({ foreground: "#fff", scrollbarSliderBackground: "#abc" });
    expect(kept.scrollbarSliderBackground).toBe("#abc");
    expect(kept.overviewRulerBorder).toBe("#00000000");
  });

  it("모든 정적 프리셋이 이 함수를 지나면 손잡이 색을 갖는다", () => {
    for (const [key, preset] of Object.entries(TERM_PRESETS)) {
      expect(withScrollbarSlider(preset.theme).scrollbarSliderBackground, key).toBeTruthy();
    }
  });
});
