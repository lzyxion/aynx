import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hct, SchemeTonalSpot, argbFromHex, argbFromRgb, hexFromArgb } from "@material/material-color-utilities";
import { describe, expect, it } from "vitest";
import {
  BEFORE_KEY,
  CHROME_KEYS,
  DERIVED_TOKENS,
  DYNAMIC_MODES,
  CHIP_HUES,
  CHIP_TOKENS,
  M3_ROLES,
  M3_TOKENS,
  legacySurfaces,
  m3RoleTokens,
  TINT_OWNER,
  TINT_TOKENS,
  contrastRatio,
  normalizeDynamicMode,
  oklabFromArgb,
  resolveDynamicMode,
  subtleTint,
  tintSourceFromPixels,
  MAX_SAMPLE,
  TERM_KEYS,
  derivedChromeTokens,
  dynamicTermTheme,
  paletteFromImageData,
  paletteFromPixels,
  paletteFromSource,
  paletteSwatches,
  pixelsFromImageData,
  sourceColorFromPixels,
  NO_PIXELS_ERROR,
  SOURCE_KEY,
  cachedPaletteFromSource,
  chromeFromSource,
  chromeIsSourcePalette,
  sourceArgbFromHex,
} from "$lib/dynamic-color";
import type { DynamicPalette, TintToken } from "$lib/dynamic-color";
import { translate } from "$lib/i18n/dict";

/**
 * `dynamic-color.ts` 의 순수 층 — docs/log/2026-09-04-dynamic-color.md §10 "확인" 이
 * 임시 tsc+node 로 한 번 돌리고 지워 버린 케이스들을 러너 위로 옮겨 온 것이다.
 *
 * 여기서 붙드는 것은 **색의 관계**지 색 자체가 아니다. 팔레트는 사진마다 달라지므로
 * "빨강이 #ff0000 이다" 같은 단정은 아무 뜻이 없고, "빨강은 어떤 사진에서도 여전히
 * 빨강이다"·"배경은 글자보다 어둡다" 가 이 모듈이 지키기로 한 약속이다.
 */

// ---------------------------------------------------------------------------
// 색을 재는 작은 도구들 (테스트 안에서만 쓴다)
// ---------------------------------------------------------------------------

/** 6자리 hex (`#rrggbb`) — 크롬 토큰과 ANSI 색이 전부 이 모양이어야 한다 */
const HEX6 = /^#[0-9a-f]{6}$/i;
/** 6자리 또는 8자리(`#rrggbbaa`) — 선택 배경만 알파가 붙는다 */
const HEX6_OR_8 = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

function rgbOf(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** HSL 색상환의 각도(0~360). "빨강이 아직 빨강인가" 를 사람 눈의 이름으로 묻는 자다 */
function hueOf(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return Number.NaN; // 무채색 — hue 가 없다
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** 0~255 밝기. 층 순서와 대비를 재는 데만 쓴다 */
function brightness(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** HCT 톤(= L*) — 면 계단의 간격을 사람 눈의 밝기 단위로 잰다 */
function tone(hex: string): number {
  return Hct.fromInt(0xff000000 | Number.parseInt(hex.slice(1), 16)).tone;
}

/** 색상환은 원이라 0° 근처(빨강)는 `|a-b|` 로 잴 수 없다 */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(d, 360 - d);
}

/**
 * 소스색 6종 — 세 원색 + 회색(채도 0) + 아주 밝은 색 + 아주 어두운 색.
 *
 * 뒤의 셋이 요점이다: 회색 사진은 chroma 하한([`ANSI_MIN_CHROMA`])을, 극단 밝기는
 * "톤은 스킴이 정한다" 를 시험한다 — 세 경우 모두 팔레트가 무채색으로 죽거나
 * 배경과 글자가 붙으면 안 된다.
 */
const SOURCES: readonly (readonly [string, number])[] = [
  ["빨강", argbFromRgb(255, 0, 0)],
  ["초록", argbFromRgb(0, 255, 0)],
  ["파랑", argbFromRgb(0, 0, 255)],
  ["회색", argbFromRgb(128, 128, 128)],
  ["아주 밝은 색", argbFromRgb(250, 248, 240)],
  ["아주 어두운 색", argbFromRgb(8, 6, 10)],
] as const;

// ---------------------------------------------------------------------------
// 1. 팔레트 한 벌의 모양 — 21칸 · 8칸
// ---------------------------------------------------------------------------

describe("paletteFromSource — 21칸·8칸이 모두 유효한 hex", () => {
  for (const [name, argb] of SOURCES) {
    for (const isDark of [true, false]) {
      const mode = isDark ? "다크" : "라이트";

      it(`${name}(${mode}) — 터미널 21칸이 다 차고 hex 다`, () => {
        const p = paletteFromSource(argb, isDark);
        expect(Object.keys(p.term).sort()).toEqual([...TERM_KEYS].sort());
        for (const key of TERM_KEYS) {
          expect(p.term[key], `${key}`).toMatch(HEX6_OR_8);
        }
        // 알파가 붙는 칸은 선택 배경 하나뿐이다.
        expect(p.term.selectionBackground).toMatch(/^#[0-9a-f]{8}$/i);
        expect(p.term.background).toMatch(HEX6);
      });

      it(`${name}(${mode}) — 크롬 8칸이 다 차고 hex 다`, () => {
        const p = paletteFromSource(argb, isDark);
        expect(Object.keys(p.chrome).sort()).toEqual([...CHROME_KEYS].sort());
        for (const key of CHROME_KEYS) {
          expect(p.chrome[key], `${key}`).toMatch(HEX6);
        }
        expect(p.source).toMatch(HEX6);
      });
    }
  }

  it("소스색은 넣은 색 그대로 돌아온다", () => {
    expect(paletteFromSource(argbFromRgb(0x12, 0x34, 0x56)).source).toBe("#123456");
  });
});

// ---------------------------------------------------------------------------
// 2. 의미 hue 보존 — 빨강은 어떤 사진에서도 빨강이다
// ---------------------------------------------------------------------------

describe("ANSI 의미 hue — red/green/blue 는 HSL 각도로도 여전히 빨강·초록·파랑", () => {
  // harmonize 가 소스색 쪽으로 최대 15° 기울이고, HCT→sRGB 변환에서도 각도가 조금
  // 움직인다. 그래서 "정확히 몇 도" 가 아니라 **사람이 그 이름으로 부를 범위**를 잰다.
  for (const [name, argb] of SOURCES) {
    for (const isDark of [true, false]) {
      const mode = isDark ? "다크" : "라이트";

      it(`${name}(${mode}) — red 는 0° 근처(±30)`, () => {
        const p = paletteFromSource(argb, isDark);
        expect(hueDistance(hueOf(p.term.red), 0)).toBeLessThanOrEqual(30);
        expect(hueDistance(hueOf(p.term.brightRed), 0)).toBeLessThanOrEqual(30);
      });

      it(`${name}(${mode}) — green 은 노랑과 청록 사이(60°~180°)`, () => {
        const p = paletteFromSource(argb, isDark);
        for (const hex of [p.term.green, p.term.brightGreen]) {
          expect(hueOf(hex)).toBeGreaterThanOrEqual(60);
          expect(hueOf(hex)).toBeLessThanOrEqual(180);
        }
      });

      it(`${name}(${mode}) — blue 는 청록과 보라 사이(190°~260°)`, () => {
        const p = paletteFromSource(argb, isDark);
        for (const hex of [p.term.blue, p.term.brightBlue]) {
          expect(hueOf(hex)).toBeGreaterThanOrEqual(190);
          expect(hueOf(hex)).toBeLessThanOrEqual(260);
        }
      });
    }
  }

  it("회색 사진에서도 빨강과 초록이 서로 다른 색이다 (chroma 하한)", () => {
    const p = paletteFromSource(argbFromRgb(128, 128, 128));
    // 무채색이면 hueOf 가 NaN 이다 — 그 자체로 실패다.
    expect(Number.isNaN(hueOf(p.term.red))).toBe(false);
    expect(Number.isNaN(hueOf(p.term.green))).toBe(false);
    expect(hueDistance(hueOf(p.term.red), hueOf(p.term.green))).toBeGreaterThan(60);
  });
});

// ---------------------------------------------------------------------------
// 3. 밝기 — 대비 · 층 순서 · black
// ---------------------------------------------------------------------------

describe("밝기 관계", () => {
  for (const [name, argb] of SOURCES) {
    // 대비는 WCAG 로 잰다 — 예전의 "밝기 차 210" 은 타일이 톤 4 였을 때의 여유였고, 타일을
    // 톤 6 으로 올린 뒤(2026-09-28 면 계단)에도 WCAG 는 14:1 대라 AAA(7:1)의 두 배다.
    // 크롬(창·뜬 면 위 본문)도 같은 선을 넘는다.
    it(`${name}(다크) — 배경은 어둡고 글자는 밝다 (WCAG 12:1 이상)`, () => {
      const p = paletteFromSource(argb, true);
      expect(brightness(p.term.background)).toBeLessThan(60);
      expect(brightness(p.term.foreground)).toBeGreaterThan(180);
      expect(contrastRatio(p.term.foreground, p.term.background)).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(p.chrome.fg, p.chrome.bg)).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(p.chrome.fg, p.chrome.bg_panel)).toBeGreaterThanOrEqual(12);
    });

    it(`${name}(라이트) — 방향만 뒤집히고 대비는 그대로 (WCAG 12:1 이상)`, () => {
      const p = paletteFromSource(argb, false);
      expect(brightness(p.term.background)).toBeGreaterThan(180);
      expect(brightness(p.term.foreground)).toBeLessThan(60);
      expect(contrastRatio(p.term.foreground, p.term.background)).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(p.chrome.fg, p.chrome.bg)).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(p.chrome.fg, p.chrome.bg_panel)).toBeGreaterThanOrEqual(12);
    });

    // 크롬의 창 · 뜬 면은 MD3 역할(2026-10-18) — 터미널 배경은 그 전 면 계단(중성 톤 6 · 98) 그대로
    for (const [mode, isDark] of [["다크", true], ["라이트", false]] as const) {
      it(`${name}(${mode}) — 창 = surface · 뜬 면 = surfaceContainer, 터미널 배경은 중성 톤 그대로`, () => {
        const p = paletteFromSource(argb, isDark);
        const scheme = new SchemeTonalSpot(Hct.fromInt(argb), isDark, 0);
        expect(p.chrome.bg).toBe(hexFromArgb(scheme.surface));
        expect(p.chrome.bg_panel).toBe(hexFromArgb(scheme.surfaceContainer));
        expect(p.term.background).toBe(hexFromArgb(scheme.neutralPalette.tone(isDark ? 6 : 98)));
        // 옛 파일 판정용 옛 바탕 두 칸 — 그 전 면 계단(창 4 · 뜬 면 10 / 96 · 100)
        const legacy = legacySurfaces(argb, isDark);
        expect(legacy.bg).toBe(hexFromArgb(scheme.neutralPalette.tone(isDark ? 4 : 96)));
        expect(legacy.bg_panel).toBe(hexFromArgb(scheme.neutralPalette.tone(isDark ? 10 : 100)));
      });
    }

    it(`${name} — 커서 글자는 터미널 배경과 같다 (두 모드)`, () => {
      for (const isDark of [true, false]) {
        const p = paletteFromSource(argb, isDark);
        expect(p.term.cursorAccent).toBe(p.term.background);
      }
    });

    it(`${name}(다크) — black 은 터미널 배경보다 밝다`, () => {
      // ANSI black 은 "배경" 이 아니라 색 이름이다 — 배경과 같아지면 검은 글자가 사라진다.
      const p = paletteFromSource(argb, true);
      expect(brightness(p.term.black)).toBeGreaterThan(brightness(p.term.background));
    });
  }

  it("흑백 4칸은 black < brightBlack < white < brightWhite 순이다", () => {
    const p = paletteFromSource(argbFromRgb(255, 0, 0));
    expect(brightness(p.term.black)).toBeLessThan(brightness(p.term.brightBlack));
    expect(brightness(p.term.brightBlack)).toBeLessThan(brightness(p.term.white));
    expect(brightness(p.term.white)).toBeLessThan(brightness(p.term.brightWhite));
  });

  it("흑백 4칸의 톤은 두 모드가 같다 (라이트에서도 black 은 검정이다)", () => {
    const argb = argbFromRgb(0, 0, 255);
    const dark = paletteFromSource(argb, true);
    const light = paletteFromSource(argb, false);
    for (const key of ["black", "brightBlack", "white", "brightWhite"] as const) {
      expect(brightness(light.term[key])).toBeCloseTo(brightness(dark.term[key]), 0);
    }
  });
});

describe("MD3 용기 계단 — 어떤 원천이든 surface 에서 용기가 한 칸씩 멀어진다", () => {
  // 12 hue × 두 chroma + 회색. 다크는 surface(6) < low(10) < (12) < high(17) < highest(22) 로 밝아지고,
  // 라이트는 surface(98) > low(96) > (94) > high(92) > highest(90) 로 어두워진다 — 호버(high) · 칩(highest)이 뜬 면(용기) 너머다.
  const spread: [string, number][] = [["회색", argbFromRgb(128, 128, 128)]];
  for (let h = 0; h < 360; h += 30) {
    for (const c of [16, 60]) spread.push([`h${h}/c${c}`, Hct.from(h, c, 50).toInt()]);
  }
  const order = [
    "--m3-surface", "--m3-surface-container-low", "--m3-surface-container",
    "--m3-surface-container-high", "--m3-surface-container-highest",
  ] as const;
  for (const [mode, isDark] of [["다크", true], ["라이트", false]] as const) {
    it(`${mode} — ${spread.length}개 원천 모두 순서와 최소 간격(1.5 톤)을 지킨다`, () => {
      for (const [label, argb] of spread) {
        const t = m3RoleTokens(new SchemeTonalSpot(Hct.fromInt(argb), isDark, 0));
        for (let i = 1; i < order.length; i++) {
          const step = (tone(t[order[i]]) - tone(t[order[i - 1]])) * (isDark ? 1 : -1);
          expect(step, `${label} ${order[i - 1]}→${order[i]}`).toBeGreaterThanOrEqual(1.5);
        }
      }
    });
  }

  it("M3_TOKENS 는 M3_ROLES 의 열쇠 + 머리줄 종류 칩이고 m3RoleTokens 는 그 전부를 hex 로 낸다", () => {
    expect(M3_TOKENS).toEqual([...Object.keys(M3_ROLES), ...CHIP_TOKENS]);
    const t = m3RoleTokens(new SchemeTonalSpot(Hct.fromInt(argbFromRgb(200, 60, 40)), true, 0));
    expect(Object.keys(t)).toEqual(M3_TOKENS);
    for (const value of Object.values(t)) expect(value).toMatch(HEX6);
  });
});

// ---------------------------------------------------------------------------
// 4. 픽셀 → 소스색
// ---------------------------------------------------------------------------

describe("pixelsFromImageData — 투명 픽셀을 버린다", () => {
  it("알파가 255 가 아닌 픽셀은 담지 않는다", () => {
    const pixels = pixelsFromImageData({
      data: [
        255, 0, 0, 255, // 불투명 빨강 — 담는다
        0, 255, 0, 128, // 반투명 — 버린다
        0, 0, 255, 0, // 완전 투명 — 버린다
        255, 255, 255, 255, // 불투명 흰색 — 담는다
      ],
    });
    expect(pixels).toEqual([argbFromRgb(255, 0, 0), argbFromRgb(255, 255, 255)]);
  });

  it("모두 투명하면 빈 배열이다", () => {
    expect(pixelsFromImageData({ data: [1, 2, 3, 0, 4, 5, 6, 254] })).toEqual([]);
  });

  it("4의 배수가 아닌 꼬리는 조용히 무시한다", () => {
    // 마지막 세 칸은 픽셀 하나를 이루지 못한다 (`i + 3 < d.length`).
    expect(pixelsFromImageData({ data: [9, 9, 9, 255, 1, 2, 3] })).toEqual([argbFromRgb(9, 9, 9)]);
  });

  it("Uint8ClampedArray 도 그대로 받는다", () => {
    const data = Uint8ClampedArray.from([10, 20, 30, 255]);
    expect(pixelsFromImageData({ data })).toEqual([argbFromRgb(10, 20, 30)]);
  });
});

describe("sourceColorFromPixels — 빈 입력은 **문구 키**로 던진다", () => {
  it("픽셀이 하나도 없으면 예외다", () => {
    expect(() => sourceColorFromPixels([])).toThrow(NO_PIXELS_ERROR);
    // 키가 사전에 실제로 있어야 한다 — 없으면 화면에 키 글자가 그대로 뜬다
    expect(translate("ko", NO_PIXELS_ERROR)).not.toBe(NO_PIXELS_ERROR);
  });

  it("투명뿐인 이미지도 같은 예외로 간다 (paletteFromImageData)", () => {
    expect(() => paletteFromImageData({ data: [1, 2, 3, 0] })).toThrow(NO_PIXELS_ERROR);
  });

  it("픽셀이 있으면 대표색 하나를 고른다", () => {
    const pixels = [
      ...Array.from({ length: 40 }, () => argbFromRgb(200, 30, 40)),
      ...Array.from({ length: 4 }, () => argbFromRgb(30, 30, 30)),
    ];
    const source = sourceColorFromPixels(pixels);
    expect(typeof source).toBe("number");
    // 빨간 쪽이 압도적이므로 뽑힌 색도 빨간 계열이어야 한다.
    const p = paletteFromSource(source);
    expect(hueDistance(hueOf(p.source), 0)).toBeLessThan(40);
  });

  it("paletteFromPixels 는 고르기 + 스킴 생성을 이어 붙인 것뿐이다", () => {
    const pixels = Array.from({ length: 20 }, () => argbFromRgb(20, 120, 200));
    expect(paletteFromPixels(pixels, true)).toEqual(
      paletteFromSource(sourceColorFromPixels(pixels), true),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. 저장된 맵 → xterm 팔레트
// ---------------------------------------------------------------------------

/** 21칸이 다 있는 온전한 맵 (테스트용 더미 색) */
function fullTermMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const key of TERM_KEYS) map[key] = "#101010";
  map.background = "#0a0a0a";
  map.foreground = "#ededed";
  return map;
}

describe("dynamicTermTheme", () => {
  it("맵이 없으면 undefined (기본 프리셋으로 떨어진다)", () => {
    expect(dynamicTermTheme(null)).toBeUndefined();
    expect(dynamicTermTheme(undefined)).toBeUndefined();
    expect(dynamicTermTheme({})).toBeUndefined();
  });

  it("배경이나 글자가 빠진 반쪽 맵도 undefined", () => {
    const noFg = fullTermMap();
    delete noFg.foreground;
    expect(dynamicTermTheme(noFg)).toBeUndefined();

    const noBg = fullTermMap();
    delete noBg.background;
    expect(dynamicTermTheme(noBg)).toBeUndefined();
  });

  it("21칸이 다 차면 그대로 xterm 팔레트가 된다", () => {
    const theme = dynamicTermTheme(fullTermMap());
    expect(theme).toBeDefined();
    expect(Object.keys(theme ?? {}).sort()).toEqual([...TERM_KEYS].sort());
  });

  it("모르는 키는 xterm 팔레트로 새지 않는다", () => {
    const map = { ...fullTermMap(), [BEFORE_KEY]: "tokyo-night", "아직-모르는-칸": "뭐든" };
    const theme = dynamicTermTheme(map);
    const keys = Object.keys(theme ?? {});
    expect(keys).not.toContain(BEFORE_KEY);
    expect(keys).not.toContain("아직-모르는-칸");
    expect(keys.sort()).toEqual([...TERM_KEYS].sort());
  });

  it("값의 공백은 떼고, 빈 값인 칸은 빠진다", () => {
    const map = { ...fullTermMap(), red: "  #ff0000  ", cyan: "   " };
    const theme = dynamicTermTheme(map);
    expect(theme?.red).toBe("#ff0000");
    expect(Object.keys(theme ?? {})).not.toContain("cyan");
  });

  it("실제로 뽑은 팔레트는 그대로 통과한다", () => {
    const p = paletteFromSource(argbFromRgb(30, 120, 200));
    const theme = dynamicTermTheme({ ...p.term, [BEFORE_KEY]: "aynx-dark" });
    expect(theme?.background).toBe(p.term.background);
    expect(theme?.brightWhite).toBe(p.term.brightWhite);
  });
});

// ---------------------------------------------------------------------------
// 6. 파생 토큰
// ---------------------------------------------------------------------------

describe("머리줄 종류 칩 — MD3 custom color", () => {
  const hueOff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  it("hue 는 고정값에서 harmonize 한도(15°) 안 · 톤은 다크 80 이상 · 라이트 40 이하에서 시작한다", () => {
    for (const [name, argb] of SOURCES) for (const isDark of [true, false]) {
      const t = m3RoleTokens(new SchemeTonalSpot(Hct.fromInt(argb), isDark, 0));
      for (const token of CHIP_TOKENS) {
        const c = Hct.fromInt(argbFromHex(t[token]));
        expect(hueOff(c.hue, CHIP_HUES[token]), `${name} ${token}`).toBeLessThanOrEqual(16);
        if (isDark) expect(c.tone).toBeGreaterThanOrEqual(79);
        else expect(c.tone).toBeLessThanOrEqual(41);
      }
    }
  });
});

describe("derivedChromeTokens", () => {
  // 2026-10-18 부터 나머지 파생(흐린 글자 · 호버 · 칩 · 선택 줄 · 보조색 · 폴더 · 오류 판 · 스크림)은 MD3 역할의 별칭이다
  // (theme.css). MD3 에 없는 경고색의 옅은 판만 남는다.
  const chrome = paletteFromSource(argbFromRgb(200, 60, 40)).chrome;

  it("8칸이 다 있으면 DERIVED_TOKENS 를 전부 만든다", () => {
    const out = derivedChromeTokens(chrome, true);
    expect(Object.keys(out).sort()).toEqual([...DERIVED_TOKENS].sort());
  });

  it("만드는 이름은 언제나 DERIVED_TOKENS 안에 있다 (지울 때 놓치는 칸이 없게)", () => {
    for (const isDark of [true, false]) {
      for (const key of Object.keys(derivedChromeTokens(chrome, isDark))) {
        expect(DERIVED_TOKENS).toContain(key);
      }
    }
  });

  it("안 정한 칸은 아예 만들지 않는다 (theme.css 기본값이 이긴다)", () => {
    expect(derivedChromeTokens({ accent: chrome.accent })).toEqual({});
  });

  it("못 알아볼 hex 는 조용히 건너뛴다 — 던지지 않는다", () => {
    expect(derivedChromeTokens({ warn: "#12345" })).toEqual({});
    expect(derivedChromeTokens({ warn: null })).toEqual({});
  });

  it("앞뒤 공백이 붙은 hex 는 받는다", () => {
    expect(derivedChromeTokens({ warn: "  #f1b65f  " })["--warn-soft"]).toMatch(HEX6);
  });

  it("경고 판은 MD3 container 톤(다크 30 · 라이트 90)이고 경고 글자가 그 위에서 4.5:1 이상 읽힌다", () => {
    for (const isDark of [true, false]) {
      const p = paletteFromSource(argbFromRgb(200, 60, 40), isDark).chrome;
      const soft = derivedChromeTokens(p, isDark)["--warn-soft"];
      expect(tone(soft)).toBeCloseTo(isDark ? 30 : 90, 0);
      expect(contrastRatio(p.warn, soft)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("성공 · 경고 판 위 글자(on-*-soft)는 onContainer 톤(다크 90 · 라이트 10)이고 판 위에서 4.5:1 이상 읽힌다", () => {
    for (const isDark of [true, false]) {
      const p = paletteFromSource(argbFromRgb(200, 60, 40), isDark).chrome;
      const out = derivedChromeTokens(p, isDark);
      for (const [soft, on] of [
        ["--ok-soft", "--on-ok-soft"],
        ["--warn-soft", "--on-warn-soft"],
      ] as const) {
        expect(tone(out[soft])).toBeCloseTo(isDark ? 30 : 90, 0);
        expect(tone(out[on])).toBeCloseTo(isDark ? 90 : 10, 0);
        expect(contrastRatio(out[on], out[soft])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("성공 판은 --ok 의 빛깔을 따른다(월페이퍼 · 색 테마가 --ok 를 바꾸면 함께 바뀐다)", () => {
    const a = derivedChromeTokens({ ok: "#6fb37c" }, true)["--ok-soft"];
    const b = derivedChromeTokens({ ok: "#3fa0a0" }, true)["--ok-soft"];
    expect(a).toMatch(HEX6);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 7. 미리보기 견본
// ---------------------------------------------------------------------------

describe("paletteSwatches", () => {
  it("소스색 + 크롬 4칸 + ANSI 6칸 = 11칸이고 전부 hex 다", () => {
    const p: DynamicPalette = paletteFromSource(argbFromRgb(90, 140, 200));
    const swatches = paletteSwatches(p);
    expect(swatches).toHaveLength(11);
    for (const hex of swatches) expect(hex).toMatch(HEX6);
    expect(swatches[0]).toBe(p.source);
  });
});

// ---------------------------------------------------------------------------
// 8. 결정성 — 같은 사진이면 같은 팔레트
// ---------------------------------------------------------------------------

describe("결정성", () => {
  it("같은 소스색·같은 모드면 글자 하나까지 같다", () => {
    const argb = argbFromRgb(180, 90, 30);
    expect(paletteFromSource(argb, true)).toEqual(paletteFromSource(argb, true));
    expect(paletteFromSource(argb, false)).toEqual(paletteFromSource(argb, false));
  });

  it("같은 픽셀 배열이면 같은 팔레트다 (파일에 적어 둔 값이 낡지 않는 근거)", () => {
    const pixels = [
      ...Array.from({ length: 30 }, () => argbFromRgb(10, 40, 90)),
      ...Array.from({ length: 12 }, () => argbFromRgb(220, 180, 60)),
      ...Array.from({ length: 5 }, () => argbFromRgb(240, 240, 240)),
    ];
    expect(paletteFromPixels(pixels)).toEqual(paletteFromPixels(pixels));
  });

  it("모드가 다르면 팔레트도 다르다 (톤만 뒤집힌다)", () => {
    const argb = argbFromRgb(180, 90, 30);
    expect(paletteFromSource(argb, true)).not.toEqual(paletteFromSource(argb, false));
  });

  it("파생 토큰도 결정적이다", () => {
    const chrome = paletteFromSource(argbFromRgb(12, 200, 140)).chrome;
    expect(derivedChromeTokens(chrome, true)).toEqual(derivedChromeTokens(chrome, true));
  });
});

// ---------------------------------------------------------------------------
// 9. 상수 — 파일에 적히는 이름은 계약이다
// ---------------------------------------------------------------------------

describe("계약으로 굳은 이름과 값", () => {
  it("TERM_KEYS 는 21칸이고 BEFORE_KEY 와 겹치지 않는다", () => {
    expect(TERM_KEYS).toHaveLength(21);
    expect(new Set(TERM_KEYS).size).toBe(21);
    expect(TERM_KEYS).not.toContain(BEFORE_KEY);
    // 이름에 `-` 가 있어 xterm ITheme 의 어떤 필드와도 겹칠 수 없다.
    expect(BEFORE_KEY).toContain("-");
  });

  it("CHROME_KEYS 는 8칸이다", () => {
    expect(CHROME_KEYS).toHaveLength(8);
    expect(new Set(CHROME_KEYS).size).toBe(8);
  });

  it("MAX_SAMPLE 은 128px", () => {
    expect(MAX_SAMPLE).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// 10. TOML 필드 순서 계약 — 두 문자열의 **위치**를 비교한다
//
// docs/log/2026-09-04-dynamic-color.md §6: `[terminal.dynamic]` 은 `TermPrefs` 의
// **맨 마지막** 필드여야 한다. TOML 은 테이블 헤더 뒤의 스칼라를 그 테이블 소속으로
// 읽으므로, 이 필드가 `theme` 앞에 오면 `theme = "dynamic"` 이 하위 테이블로 빨려
// 들어가 다시 읽을 때 사라진다 — 즉 이 파일의 [`dynamicTermTheme`] 이 영영 빈 맵만
// 받게 된다. 프런트가 그 계약에 얹혀 있으므로 여기서도 한 번 붙든다.
// ---------------------------------------------------------------------------

describe("설정 파일의 필드 순서 계약", () => {
  // `TermPrefs` 는 2026-10-26 분할 2차에 `settings/appearance.rs` 로 옮겼다 — 선언이 사는 파일을 읽는다(못 찾으면 아래 첫 단언이 실패)
  const settingsRs = readFileSync(
    fileURLToPath(new URL("../../src-tauri/src/settings/appearance.rs", import.meta.url)),
    "utf8",
  );

  it("TermPrefs 안에서 팔레트 테이블이 스칼라들보다 뒤에 온다", () => {
    const struct = settingsRs.indexOf("pub struct TermPrefs");
    expect(struct).toBeGreaterThan(-1);
    const body = settingsRs.slice(struct);

    const theme = body.indexOf("pub theme:");
    const table = body.indexOf("pub dynamic: BTreeMap");
    expect(theme, "pub theme: 를 못 찾았다").toBeGreaterThan(-1);
    expect(table, "pub dynamic: BTreeMap 을 못 찾았다").toBeGreaterThan(-1);
    // **위치 비교가 전부다** — 테이블 필드가 앞서면 TOML 이 뒤엉킨다.
    expect(table).toBeGreaterThan(theme);
  });
});

// ---------------------------------------------------------------------------
// 11. 은은하게 — 중성 크롬만 사진의 hue 쪽으로 (docs/log/2026-09-25-wallpaper-tint.md)
// ---------------------------------------------------------------------------

/** theme.css 의 중성 크롬 기본값 — 다크·라이트 (시험이 붙드는 것은 관계라 값이 조금 바뀌어도 된다) */
const NEUTRAL_DARK: Record<TintToken, string> = {
  "--bg-base": "#0c0c0e",
  "--bg-panel-base": "#1b1b1e",
  "--border": "#2e2e33",
  "--bg-hover": "#232327",
  "--bg-chip": "#2a2a2f",
  "--fg-muted": "#a3a3ab",
  "--fg-chip": "#b4b4bb",
};
const NEUTRAL_LIGHT: Record<TintToken, string> = {
  "--bg-base": "#f4f4f2",
  "--bg-panel-base": "#ffffff",
  "--border": "#d9d9d5",
  "--bg-hover": "#ececea",
  "--bg-chip": "#e4e4e1",
  "--fg-muted": "#6e6e76",
  "--fg-chip": "#4d4d55",
};
const FG_DARK = "#ececef";
const FG_LIGHT = "#2a2a2e";

/** 짙은 청록 · 따뜻한 주황 — 서로 색상환 반대편 */
const TEAL = argbFromRgb(0x0f, 0x6e, 0x6a);
const ORANGE = argbFromRgb(0xe8, 0x7a, 0x2c);

/** `#rrggbb` → OKLCH (L 0~1 · C · h 도) — 틴트는 OKLab 에서 놓이므로 재는 것도 거기서 잰다 */
function lchOf(hex: string): { L: number; C: number; h: number } {
  const [L, a, b] = oklabFromArgb(0xff000000 | parseInt(hex.slice(1), 16));
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}
const lchOfArgb = (argb: number) => lchOf(`#${(argb & 0xffffff).toString(16).padStart(6, "0")}`);

describe("normalizeDynamicMode · resolveDynamicMode", () => {
  it("옛 불리언 true 는 전체, false·없음·모르는 값은 안 정함", () => {
    expect(normalizeDynamicMode(true)).toBe("full");
    expect(normalizeDynamicMode(false)).toBeUndefined();
    expect(normalizeDynamicMode(undefined)).toBeUndefined();
    expect(normalizeDynamicMode(null)).toBeUndefined();
    expect(normalizeDynamicMode("loud")).toBeUndefined();
    expect(normalizeDynamicMode(1)).toBeUndefined();
    for (const m of Object.keys(DYNAMIC_MODES)) expect(normalizeDynamicMode(` ${m} `)).toBe(m);
  });

  it("안 정했으면 월페이퍼가 있을 때 은은하게, 없으면 끔 — 고른 값은 그대로", () => {
    expect(resolveDynamicMode(undefined, true)).toBe("subtle");
    expect(resolveDynamicMode(null, false)).toBe("off");
    expect(resolveDynamicMode("off", true)).toBe("off");
    expect(resolveDynamicMode("full", true)).toBe("full");
  });
});

describe("subtleTint", () => {
  for (const [label, isDark, base, fg] of [
    ["다크", true, NEUTRAL_DARK, FG_DARK],
    ["라이트", false, NEUTRAL_LIGHT, FG_LIGHT],
  ] as const) {
    for (const [srcLabel, src] of [
      ["청록", TEAL],
      ["주황", ORANGE],
    ] as const) {
      it(`${label}·${srcLabel}: 칠한 자리는 사진의 hue 쪽으로 기울고 chroma 는 낮게 묶인다`, () => {
        const out = subtleTint(base, src, isDark);
        const srcHue = lchOfArgb(src).h;
        for (const name of TINT_TOKENS) {
          const hex = out[name];
          expect(hex, name).toMatch(/^#[0-9a-f]{6}$/);
          const c = lchOf(hex!);
          // 순백(라이트 패널)은 더 밝아질 자리가 없어 대비를 지키려면 칠할 수 없다 — 그대로 남는다.
          if (base[name] === "#ffffff") {
            expect(hex, name).toBe("#ffffff");
            continue;
          }
          // "색" 이 아니라 "기운" — 역할별 상한(최대 0.015)에 8비트 반올림 여유.
          expect(c.C, name).toBeLessThanOrEqual(0.018);
          expect(c.C, name).toBeGreaterThan(0.003);
          // 아주 옅은 판(C ≈ 0.005)에서는 반올림만으로 hue 가 몇십 도 흔들린다 — 방향만 본다.
          expect(hueDistance(c.h, srcHue), name).toBeLessThan(c.C < 0.007 ? 40 : 20);
          // 밝기는 사실상 그대로다.
          expect(Math.abs(c.L - lchOf(base[name]).L), name).toBeLessThan(0.02);
        }
      });

      it(`${label}·${srcLabel}: 본문·흐린 글자와 바탕의 대비가 원래 이상이다`, () => {
        const out = subtleTint(base, src, isDark) as Record<TintToken, string>;
        for (const surface of ["--bg-base", "--bg-panel-base", "--bg-hover", "--bg-chip"] as const) {
          // 본문 글자는 칠하지 않는다 — 바탕이 글자에서 멀어지기만 한다.
          expect(contrastRatio(fg, out[surface]), `fg/${surface}`).toBeGreaterThanOrEqual(
            contrastRatio(fg, base[surface]),
          );
          for (const text of ["--fg-muted", "--fg-chip"] as const) {
            expect(contrastRatio(out[text], out[surface]), `${text}/${surface}`).toBeGreaterThanOrEqual(
              contrastRatio(base[text], base[surface]),
            );
          }
        }
      });
    }
  }

  it("청록과 주황은 서로 반대쪽으로 기운다", () => {
    for (const [isDark, base] of [
      [true, NEUTRAL_DARK],
      [false, NEUTRAL_LIGHT],
    ] as const) {
      const teal = lchOf(subtleTint(base, TEAL, isDark)["--bg-base"]!);
      const orange = lchOf(subtleTint(base, ORANGE, isDark)["--bg-base"]!);
      expect(hueDistance(teal.h, orange.h)).toBeGreaterThan(90);
    }
    // 라이트 청록이 **차갑게** 기운다 — HCT 로 칠하던 첫 판에서 `#f5f3f2`(따뜻한 회색)가 나왔던 자리.
    const light = subtleTint(NEUTRAL_LIGHT, TEAL, false)["--bg-base"]!;
    const [r, , b] = [1, 3, 5].map((i) => parseInt(light.slice(i, i + 2), 16));
    expect(b, light).toBeGreaterThanOrEqual(r);
  });

  it("흐린 사진은 더 옅게 기운다 (소스 chroma 에 비례)", () => {
    const vivid = lchOf(subtleTint(NEUTRAL_DARK, ORANGE, true)["--border"]!);
    const dullSource = Hct.from(Hct.fromInt(ORANGE).hue, 10, 60).toInt();
    const dull = lchOf(subtleTint(NEUTRAL_DARK, dullSource, true)["--border"]!);
    expect(dull.C).toBeLessThan(vivid.C);
  });

  it("주어진 자리만 칠한다 — 강조·의미색·본문·터미널은 목록에 없고, 빠진 자리·못 읽는 값은 건너뛴다", () => {
    for (const never of ["--accent", "--err", "--ok", "--warn", "--fg", "--term-bg", "--accent-soft"]) {
      expect(TINT_TOKENS as readonly string[]).not.toContain(never);
    }
    const out = subtleTint({ "--bg-base": "#141416", "--border": "tomato" }, TEAL, true);
    expect(Object.keys(out)).toEqual(["--bg-base"]);
  });

  it("각 자리의 주인은 [app] 크롬 칸이다 (사용자가 정한 칸은 부르는 쪽이 뺀다)", () => {
    for (const name of TINT_TOKENS) expect(CHROME_KEYS).toContain(TINT_OWNER[name]);
    expect(TINT_OWNER["--fg-muted"]).toBe("fg");
    expect(TINT_OWNER["--bg-hover"]).toBe("bg");
  });

  it("결정적이다", () => {
    expect(subtleTint(NEUTRAL_DARK, TEAL, true)).toEqual(subtleTint(NEUTRAL_DARK, TEAL, true));
  });
});

describe("tintSourceFromPixels", () => {
  it("색이 있는 사진이면 그 소스색", () => {
    const px = Array.from({ length: 400 }, () => TEAL);
    const src = tintSourceFromPixels(px);
    expect(src).not.toBeNull();
    expect(hueDistance(Hct.fromInt(src!).hue, Hct.fromInt(TEAL).hue)).toBeLessThan(10);
  });

  it("흑백 사진이면 null — 구글 블루 폴백을 받지 않는다", () => {
    const grey = Array.from({ length: 400 }, (_, i) => argbFromRgb(i % 256, i % 256, i % 256));
    expect(tintSourceFromPixels(grey)).toBeNull();
    expect(tintSourceFromPixels([])).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("흑백은 21:1, 같은 색은 1:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("x", "#fff")).toBeNaN();
  });
});

describe("소스색으로 밝기 전환 — 사진 없이 동기로 같은 결과", () => {
  // 노을 + 회색 하늘 섞인 작은 "사진"
  const data: number[] = [];
  for (let i = 0; i < 300; i++) {
    const [r, g, b] = i % 3 === 0 ? [220, 90, 60] : i % 3 === 1 ? [120, 130, 140] : [40, 60, 120];
    data.push(r, g, b, 255);
  }
  const image = { data };

  it("이미지 경로와 소스색 경로가 두 밝기 모두 비트 단위로 같다", () => {
    for (const isDark of [true, false]) {
      const fromImage = paletteFromImageData(image, isDark);
      const argb = sourceArgbFromHex(fromImage.source);
      expect(argb).not.toBeNull();
      expect(cachedPaletteFromSource(argb!, isDark)).toEqual(fromImage);
      expect(paletteFromSource(sourceColorFromPixels(pixelsFromImageData(image)), isDark)).toEqual(fromImage);
    }
  });

  it("다크에서 뽑은 소스색만으로 라이트 팔레트가 이미지 경로와 같다", () => {
    const dark = paletteFromImageData(image, true);
    const light = paletteFromImageData(image, false);
    expect(cachedPaletteFromSource(sourceArgbFromHex(dark.source)!, false)).toEqual(light);
  });

  it("크롬이 그 소스에서 나왔는지 판정한다 (밝기 둘 다, 다른 소스·고친 값은 아니다)", () => {
    const dark = paletteFromImageData(image, true);
    const argb = sourceArgbFromHex(dark.source)!;
    expect(chromeFromSource(dark.chrome, argb)).toBe(true);
    expect(chromeFromSource(cachedPaletteFromSource(argb, false).chrome, argb)).toBe(true);
    expect(chromeIsSourcePalette(dark.chrome, argb, true)).toBe(true);
    expect(chromeIsSourcePalette(dark.chrome, argb, false)).toBe(false);
    expect(chromeFromSource({ ...dark.chrome, accent: "#123456" }, argb)).toBe(false);
    expect(chromeFromSource(dark.chrome, sourceArgbFromHex("#4285c5")!)).toBe(false);
    expect(chromeFromSource({}, argb)).toBe(false);
  });

  it("소스색 칸은 색 이름과 겹치지 않고 xterm 팔레트로 새지 않는다", () => {
    expect((TERM_KEYS as readonly string[]).includes(SOURCE_KEY)).toBe(false);
    const p = paletteFromSource(argbFromRgb(200, 30, 40));
    const theme = dynamicTermTheme({ ...p.term, [SOURCE_KEY]: p.source, [BEFORE_KEY]: "aynx" });
    expect(theme && SOURCE_KEY in theme).toBe(false);
  });

  it("못 알아볼 hex 는 null", () => {
    expect(sourceArgbFromHex(undefined)).toBeNull();
    expect(sourceArgbFromHex("red")).toBeNull();
    expect(sourceArgbFromHex("#fff")).toBeNull();
    expect(sourceArgbFromHex("#ff0000")).toBe(0xffff0000);
  });
});
