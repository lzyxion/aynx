import { readFileSync } from "node:fs";
import { argbFromHex, Hct, hexFromArgb, SchemeTonalSpot } from "@material/material-color-utilities";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_COLOR_FAMILIES, MONO_CHROMA, appColorFamily, appColorPalette, appM3Spec, appM3Tokens, customPalette, defaultAppPalette,
  defaultM3Tokens, familyOf, legacyAppColorPalette, m3Chrome, m3Scheme, m3Tokens, nextInFamily, oppositeDynamicTerm, fixedDynamicTerms,
  cachedOppositeDynamicTerm, selectedAppColorTheme, selectedCustomSource, upgradeLegacyAppColors,
} from "./app-color-themes";
import {
  BEFORE_KEY, CHIP_TOKENS, CHROME_KEYS, M3_TOKENS, SOURCE_KEY, TERM_KEYS, cachedPaletteFromSource,
  contrastRatio, derivedChromeTokens, dynamicTermTheme, legacySurfaces, m3RoleTokens, paletteFromSource, type DynamicPalette,
} from "./dynamic-color";
import { emptySettings, normalizeSettings } from "./settings/model/normalize";
import { toPayload } from "./settings/model/payload";
import {
  adoptDynamicPalette, clearDynamicTheme, currentDynamicSource, setAppColorTheme, setCustomAppColor, syncAppColorTheme,
} from "./settings/model/actions-appearance";
import { setTermPreset } from "./settings/model/actions-terminal";
import { settings } from "./settings/model/store.svelte.js";
import {
  DYNAMIC_DARK_TERM_KEY, DYNAMIC_LIGHT_TERM_KEY, TERM_PRESETS, isLightBackground, pairedPreset, termThemeOf,
} from "./theme";

vi.mock("./settings/model/store.svelte.js", async () => {
  const { emptySettings } = await import("./settings/model/normalize");
  return { settings: { current: emptySettings() }, applySettings: vi.fn(), saveSettings: vi.fn() };
});
beforeEach(() => { settings.current = emptySettings(); });

const variants = APP_COLOR_FAMILIES.flatMap((family) => [...family.variants]);
/** 모두 승인 게이지 색(theme.css `--ai-lv4` — 다크 · 라이트) */
const AI_ALL = { dark: "#f5a05a", light: "#803800" } as const;
const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
const classicBefore = JSON.parse(readFileSync(new URL("./app-color-classic.fixture.json", import.meta.url), "utf8"));
// a8915e4^의 paletteFromSource로 생성한 고정 결과. Classic의 바이트 호환 회귀를 잡는다.
const cssBlocks = [css.match(/:root \{([\s\S]*?)\n\}/)![1], css.match(/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/)![1]];
const cssChromeNames = ["--accent", "--bg-base", "--bg-panel-base", "--fg", "--border", "--err", "--ok", "--warn"];
function cssValue(block: string, name: string): string {
  return block.match(new RegExp(name + ": ([^;]+);"))![1].trim();
}
const hct = (hex: string) => Hct.fromInt(argbFromHex(hex));
/** 크롬 — 의미색 둘(ok · warn)을 뺀 여섯 칸은 MD3 역할(2026-10-18), 의미색은 그 전 생성값 */
function expectM3Chrome(p: DynamicPalette, tokens: Record<string, string>, legacyChrome: DynamicPalette["chrome"]): void {
  expect(p.chrome).toEqual({ ...m3Chrome(tokens as never), ok: legacyChrome.ok, warn: legacyChrome.warn });
}
/**
 * 터미널 21색은 그 전 그대로(이번 범위 밖) — 생성 팔레트의 바탕(터미널 배경)만 원천 hue 로 물들였다(2026-10-13).
 * tone 은 생성값 그대로이고 chroma 는 생성값 이상이다.
 */
function expectTintedTerm(p: DynamicPalette, generated: DynamicPalette): void {
  const { background: back, cursorAccent: _ca, ...rest } = p.term;
  const { background: genBack, cursorAccent: _gca, ...genRest } = generated.term;
  expect(rest).toEqual(genRest);
  expect(Math.abs(hct(back).tone - hct(genBack).tone)).toBeLessThanOrEqual(0.6);
  expect(hct(back).chroma).toBeGreaterThanOrEqual(hct(genBack).chroma - 0.5);
  expect(p.term.cursorAccent).toBe(p.term.background);
}

describe("테마 전체 — 계열", () => {
  it("모든 변형 × 두 모드가 저장·정규화 왕복 후 같은 id이며 8칸·21색을 저장한다", () => {
    for (const variant of variants) for (const isDark of [true, false]) {
      settings.current.terminal.theme = undefined; // 고정 밝기를 골라 둔 적 없는 자리에서 — 앱 밝기의 고정 키
      setAppColorTheme(variant.id, isDark);
      const stored = toPayload(normalizeSettings(settings.current));
      expect(selectedAppColorTheme(stored.app)).toBe(variant.id);
      const p = appColorPalette(variant.id, isDark);
      if (p) {
        for (const key of CHROME_KEYS) expect(stored.app[key]).toBe(p.chrome[key]);
        expect(Object.keys(p.term)).toEqual([...TERM_KEYS]);
        expect(stored.terminal.theme).toBe(isDark ? DYNAMIC_DARK_TERM_KEY : DYNAMIC_LIGHT_TERM_KEY);
        expect(stored.terminal.dynamic).toEqual({ ...p.term, [BEFORE_KEY]: isDark ? "aynx-dark" : "aynx-light" });
      } else {
        expect(CHROME_KEYS.every((key) => !stored.app[key])).toBe(true);
        expect(selectedAppColorTheme({})).toBe("aynx");
        expect(stored.terminal.dynamic).toBeUndefined();
        expect(stored.terminal.theme ?? "aynx-dark").toBe(isDark ? "aynx-dark" : "aynx-light");
      }
    }
  });

  it("내장 테마 × 두 모드의 8칸은 서로 겹치지 않고 기본(빈 8칸)과도 다르다", () => {
    const seen = new Map<string, string>();
    for (const v of variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark) ?? defaultAppPalette(dark);
      const key = CHROME_KEYS.map((k) => p.chrome[k]).join(",");
      expect(seen.get(key), v.id + ":" + dark).toBeUndefined();
      seen.set(key, v.id + ":" + dark);
    }
  });

  it("Classic id·원천색은 a8915e4^와 같고, 크롬은 TonalSpot MD3 역할 · 터미널은 그 전 그대로(바탕만 물들임)다", () => {
    expect(APP_COLOR_FAMILIES[1].variants.map((v) => [v.id, v.source])).toEqual([
      ["ocean", "#4285c5"], ["forest", "#398568"], ["sunset", "#df7654"],
      ["lavender", "#9074ce"], ["rose", "#c66187"], ["amber", "#bd9136"], ["slate", "#627d8c"],
    ]);
    for (const v of APP_COLOR_FAMILIES[1].variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark)!;
      const argb = argbFromHex(v.source);
      const generated = paletteFromSource(argb, dark);
      // 터미널 · 의미색 · 바탕 아닌 크롬 칸은 a8915e4^와 바이트까지 같고, 바탕 두 칸은 그 전 면 계단(legacySurfaces) 자리로 옮겼다
      const before = classicBefore[v.id + ":" + dark];
      expect(generated.term).toEqual(before.term);
      expect({ ...generated.chrome, ...legacySurfaces(argb, dark) }).toEqual(before.chrome);
      expectM3Chrome(p, m3Tokens({ source: v.source }, dark), generated.chrome);
      expect(p.chrome.bg).toBe(generated.chrome.bg); // 월페이퍼 full 과 같은 surface
      expectTintedTerm(p, generated);
    }
  });

  it("스킴 캐시는 같은 원천 · 밝기면 같은 한 벌을 돌려준다", () => {
    const source = argbFromHex("#d95a9e");
    for (const dark of [true, false]) {
      const tonal = cachedPaletteFromSource(source, dark);
      expect(tonal).toBe(cachedPaletteFromSource(source, dark));
      expect(tonal).toEqual(paletteFromSource(source, dark));
    }
  });

  it("Signal 계열은 기본 Azure + 다섯(2026-11-02) · Cyberpunk 계열은 없다 — Cyberpunk 터미널 프리셋도 걷었다(2026-10-24)", () => {
    expect(APP_COLOR_FAMILIES.map((f) => f.id)).toEqual(["prism", "classic", "mono"]);
    expect(appColorFamily("prism").variants.map((v) => v.id)).toEqual(["aynx", "tide", "phosphor", "volt", "ember", "iris"]);
    expect(nextInFamily("prism", "aynx")).toBe("tide");
    expect(nextInFamily("prism", "iris")).toBe("aynx");
    // 같은 계열의 나머지 변형도 기본과 같은 몸 — 강조색 커서 · graphite 21색 · 물든 터미널 배경
    for (const dark of [true, false]) {
      const p = appColorPalette("phosphor", dark)!;
      expect(p.term.cursor).toBe(dark ? "#9be37a" : "#3c7d1e");
      expect(p.term.red).toBe(TERM_PRESETS[dark ? "graphite-dark" : "graphite-light"].theme.red);
    }
    for (const id of ["cyber-2077", "cyber-neon"]) {
      expect(TERM_PRESETS[id + "-dark"]).toBeUndefined();
      expect(TERM_PRESETS[id + "-light"]).toBeUndefined();
    }
  });

  it("모든 내장 테마의 강조색·본문·터미널 글자 대비를 지킨다", () => {
    for (const v of variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark) ?? defaultAppPalette(dark);
      expect(contrastRatio(p.chrome.accent, p.chrome.bg), v.id + ":" + dark).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.chrome.accent, p.chrome.bg_panel), v.id + ":" + dark).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.chrome.fg, p.chrome.bg_panel)).toBeGreaterThanOrEqual(12);
      expect(contrastRatio(p.term.foreground, p.term.background)).toBeGreaterThanOrEqual(12);
    }
  });

  it("기본의 CSS 는 SchemeTonalSpot(#8ab4ff) 의 MD3 역할 · 그 별칭이고, 기본 터미널 21색은 그래파이트를 파랑으로 물들인 그 전 한 벌이다", () => {
    const aliases: Record<string, string> = {
      "--bg-base": "var(--m3-surface)", "--bg-panel-base": "var(--m3-surface-container)", "--fg": "var(--m3-on-surface)",
      "--fg-muted": "var(--m3-on-surface-variant)", "--accent": "var(--m3-primary)", "--accent-soft": "var(--m3-secondary-container)",
      "--on-accent-soft": "var(--m3-on-secondary-container)", "--secondary": "var(--m3-secondary)",
      "--secondary-soft": "var(--m3-secondary-container)", "--tertiary": "var(--m3-tertiary)",
      "--tertiary-soft": "var(--m3-tertiary-container)", "--bg-hover": "var(--m3-surface-container-high)",
      "--border": "var(--m3-outline-variant)", "--bg-chip": "var(--m3-surface-container-highest)",
      "--fg-chip": "var(--m3-on-surface-variant)", "--err": "var(--m3-error)", "--err-soft": "var(--m3-error-container)",
      "--folder": "var(--tertiary)",
    };
    for (const [token, value] of Object.entries(aliases)) expect(cssValue(cssBlocks[0], token), token).toBe(value);
    for (const [i, dark] of [true, false].entries()) {
      const p = defaultAppPalette(dark);
      expect(appColorPalette("aynx", dark)).toBeNull();
      const tokens = defaultM3Tokens(dark);
      expect(tokens).toEqual(m3RoleTokens(new SchemeTonalSpot(Hct.fromInt(argbFromHex("#8ab4ff")), dark, 0)));
      for (const token of M3_TOKENS) expect(cssValue(cssBlocks[i], token), token).toBe(tokens[token]);
      // 별칭은 다크 블록 하나 — 라이트 블록에 다시 적지 않는다(적으면 인라인 `--m3-*` 를 비껴간다)
      if (i === 1) for (const token of Object.keys(aliases)) expect(cssBlocks[1]).not.toMatch(new RegExp(`\\n\\s*${token}:`));
      expect(p.chrome.accent).toBe(tokens["--m3-primary"]);
      expect(p.chrome.bg).toBe(tokens["--m3-surface"]);
      expect(cssValue(cssBlocks[i], "--ok")).toBe(p.chrome.ok);
      expect(cssValue(cssBlocks[i], "--warn")).toBe(p.chrome.warn);
      for (const [token, value] of Object.entries(derivedChromeTokens(p.chrome, dark))) expect(cssValue(cssBlocks[i], token)).toBe(value);
      expect(cssValue(cssBlocks[i], "--term-bg")).toBe(p.term.background);
      expect(p.term).toEqual(TERM_PRESETS[dark ? "aynx-dark" : "aynx-light"].theme);
      expect(p.term.cursor).toBe(dark ? "#8ab4ff" : "#2f62c8");
    }
  });

  it("Monochrome은 크롬이 거의 회색인 MD3 역할(변형마다 온도만 다름)이고 터미널은 graphite 프리셋 그대로다", () => {
    for (const v of APP_COLOR_FAMILIES[2].variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark)!;
      const term = TERM_PRESETS[dark ? "graphite-dark" : "graphite-light"].theme;
      expect(p.term.selectionBackground).toBe(dark ? "#2c2c31" : "#dcdcd8");
      expect(p.term.cursor).toBe(dark ? v.dark : v.light);
      const { background: _b, cursorAccent: _c, cursor: _cu, ...rest } = p.term;
      const { background: _tb, cursorAccent: _tc, cursor: _tcu, ...termRest } = term;
      expect(rest).toEqual(termRest);
      expect(p.chrome.ok).toBe(dark ? "#6fb37c" : "#397c47");
      expect(p.chrome.warn).toBe(dark ? "#d9a441" : "#906816");
      const tokens = m3Tokens(appM3Spec({ app: p.chrome, terminal: {} } as never, dark)!, dark);
      // 무채색 정체성 — 강조 · 용기 · 면 모두 chroma 가 MONO_CHROMA 근처 아래(TonalSpot 이면 primary 36)
      for (const token of ["--m3-primary", "--m3-secondary-container", "--m3-surface", "--m3-surface-container-high"] as const) {
        expect(hct(tokens[token]).chroma, v.id + token).toBeLessThanOrEqual(MONO_CHROMA + 1);
      }
      if (v.id === "mono-white") {
        expect(hct(tokens["--m3-surface"]).chroma).toBeLessThanOrEqual(3); // 회색 hex 의 HCT chroma 잔차
        continue;
      }
      // Silver 는 푸른 쪽, Graphite 는 따뜻한 쪽
      const hue = hct(tokens["--m3-surface-container-highest"]).hue;
      const [low, high] = v.id === "mono-silver" ? [220, 280] : [40, 100];
      expect(hue).toBeGreaterThan(low);
      expect(hue).toBeLessThan(high);
    }
    for (const dark of [true, false]) {
      const bgs = APP_COLOR_FAMILIES[2].variants.map((v) => appColorPalette(v.id, dark)!.chrome.bg);
      expect(new Set(bgs).size).toBe(3);
    }
    expect(pairedPreset("graphite-dark", true)).toBe("graphite-light");
    expect(pairedPreset("graphite-light", false)).toBe("graphite-dark");
  });

  it("MD3 핵심 쌍 대비 — 모든 내장 테마 × 두 모드 4.5:1 이상(제3색 · 보조색은 바탕 · 뜬 면 위)", () => {
    const pairs = [
      ["--m3-on-surface", "--m3-surface"], ["--m3-on-surface", "--m3-surface-container"],
      ["--m3-on-surface", "--m3-surface-container-high"], ["--m3-on-surface", "--m3-surface-container-highest"],
      ["--m3-on-surface-variant", "--m3-surface-container-high"], ["--m3-on-surface-variant", "--m3-surface-container"],
      ["--m3-on-secondary-container", "--m3-secondary-container"], ["--m3-on-primary", "--m3-primary"],
      ["--m3-on-primary-container", "--m3-primary-container"], ["--m3-on-tertiary-container", "--m3-tertiary-container"],
      ["--m3-tertiary", "--m3-surface"], ["--m3-tertiary", "--m3-surface-container"],
      ["--m3-primary", "--m3-surface-container-high"], ["--m3-on-error-container", "--m3-error-container"],
    ] as const;
    const low: string[] = [];
    for (const v of variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark);
      const tokens = p ? appM3Tokens({ app: p.chrome, terminal: {} } as never, dark)! : defaultM3Tokens(dark);
      for (const [fg, bg] of pairs) {
        const ratio = contrastRatio(tokens[fg], tokens[bg]);
        if (ratio < 4.5) low.push(`${v.id}:${dark ? "dark" : "light"} ${fg}/${bg} ${ratio.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it("머리줄 칩 대비 — 모든 내장 테마 × 두 모드, 머리줄 판(뜬 면 · 활성) 위 칩 판(16% · 호버 20%)에서 글자 4.5:1 이상", () => {
    const hx = (h: string) => parseInt(h.slice(1), 16);
    const over = (under: string, top: string, a: number) => {
      const u = hx(under), tp = hx(top);
      const ch = (sh: number) => Math.round(((u >> sh) & 255) * (1 - a) + ((tp >> sh) & 255) * a);
      return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
    };
    const low: string[] = [];
    for (const v of variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark);
      const pal = p ?? defaultAppPalette(dark);
      const tokens = p ? appM3Tokens({ app: p.chrome, terminal: {} } as never, dark)! : defaultM3Tokens(dark);
      const fg = tokens["--m3-on-surface"], muted = tokens["--m3-on-surface-variant"];
      // theme.css 의 AI 권한 · 자원 칩 식(다크 · 라이트)
      const chips: Record<string, string> = {
        ...Object.fromEntries(CHIP_TOKENS.map((k) => [k, tokens[k]])),
        "ai-read": over(muted, fg, 0.4),
        // 승인 후 · 자동 · 모두 = 게이지 단계 색 2 · 3 · 4(10-23), 풀림(DB) = 예전 경고색 식
        "ai-approve": dark ? pal.chrome.accent : over("#000000", pal.chrome.accent, 0.75),
        "ai-auto": dark ? over("#ffffff", pal.chrome.accent, 0.55) : over("#000000", pal.chrome.accent, 0.55),
        "ai-all": dark ? AI_ALL.dark : AI_ALL.light,
        "ai-broken": dark ? over(fg, pal.chrome.warn, 0.75) : over("#000000", pal.chrome.warn, 0.7),
      };
      for (const plate of [tokens["--m3-surface-container"], tokens["--m3-surface-container-high"]]) {
        for (const [name, color] of Object.entries(chips)) for (const tint of [0.16, 0.2]) {
          const ratio = contrastRatio(color, over(plate, color, tint));
          if (ratio < 4.5) low.push(`${v.id}:${dark ? "dark" : "light"} ${name} ${tint} ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(low).toEqual([]);
  });

  it("AI 권한 게이지 단계 색(10-23) — 모든 내장 테마 × 두 모드, 뜬 면 · 호버 면 위 글자 4.5:1 이상 · 자리마다 밝기가 갈린다", () => {
    const hx = (h: string) => parseInt(h.slice(1), 16);
    const over = (under: string, top: string, a: number) => {
      const u = hx(under), tp = hx(top);
      const ch = (sh: number) => Math.round(((u >> sh) & 255) * (1 - a) + ((tp >> sh) & 255) * a);
      return "#" + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("");
    };
    // theme.css 의 식 그대로 — 바뀌면 둘을 같이 고친다
    expect(css).toContain(`--ai-lv4: ${AI_ALL.dark};`);
    expect(css).toContain(`--ai-lv4: ${AI_ALL.light};`);
    const low: string[] = [];
    const flat: string[] = [];
    for (const v of variants) for (const dark of [true, false]) {
      const p = appColorPalette(v.id, dark);
      const tokens = p ? appM3Tokens({ app: p.chrome, terminal: {} } as never, dark)! : defaultM3Tokens(dark);
      const accent = tokens["--m3-primary"], base = tokens["--m3-surface"], fg = tokens["--m3-on-surface"];
      const lv = dark
        ? [over(base, accent, 0.8), accent, over("#ffffff", accent, 0.55), AI_ALL.dark]
        : [accent, over("#000000", accent, 0.75), over("#000000", accent, 0.55), AI_ALL.light];
      const tag = `${v.id}:${dark ? "dark" : "light"}`;
      for (const plate of [tokens["--m3-surface-container"], tokens["--m3-surface-container-high"]]) {
        lv.forEach((c, i) => {
          const ratio = contrastRatio(c, plate);
          if (ratio < 4.5) low.push(`${tag} lv${i + 1} ${ratio.toFixed(2)}`);
        });
      }
      // 강조색 계열 셋은 밝기 계단 — 이웃끼리 대비 1.15 이상(눈으로 갈린다)
      for (let i = 0; i < 2; i++) {
        const r = contrastRatio(lv[i], lv[i + 1]);
        if (r < 1.15) flat.push(`${tag} lv${i + 1}/lv${i + 2} ${r.toFixed(2)}`);
      }
      // 좁은 꼴의 모두 승인 설명 글자(단계 색 60% + 본문) · 확인 단추(따뜻한 판 위 잉크) · YOLO 표지
      const container = tokens["--m3-surface-container"];
      const compactDesc = over(fg, lv[3], 0.6);
      if (contrastRatio(compactDesc, container) < 4.5) low.push(`${tag} compact-desc`);
      const soft = over(container, lv[3], 0.14);
      const ink = dark ? over("#ffffff", lv[3], 0.55) : over("#000000", lv[3], 0.85);
      if (contrastRatio(ink, soft) < 4.5) low.push(`${tag} yolo-button ${contrastRatio(ink, soft).toFixed(2)}`);
      if (contrastRatio(dark ? "#2a1400" : "#ffffff", lv[3]) < 4.5) low.push(`${tag} yolo-badge`);
    }
    expect(low).toEqual([]);
    expect(flat).toEqual([]);
  });

  it("계열 안 순환·끝에서 처음·다른 계열/null에서 첫 변형", () => {
    for (const family of APP_COLOR_FAMILIES) {
      expect(nextInFamily(family.id, null)).toBe(family.variants[0].id);
      for (const [i, v] of family.variants.entries()) {
        expect(familyOf(v.id)).toBe(family.id);
        expect(nextInFamily(family.id, v.id)).toBe(family.variants[(i + 1) % family.variants.length].id);
      }
      for (const other of APP_COLOR_FAMILIES.filter((f) => f.id !== family.id))
        expect(nextInFamily(family.id, other.variants[0].id)).toBe(family.variants[0].id);
    }
  });

  it("full과 부분 변경은 내장 테마가 아니며 모드 전환은 8칸 모두 바꾼다", () => {
    for (const v of variants.filter((v) => v.id !== "aynx")) {
      const p = appColorPalette(v.id, true)!;
      expect(selectedAppColorTheme({ ...p.chrome, dynamic: "full" })).toBeNull();
      for (const key of CHROME_KEYS) expect(selectedAppColorTheme({ ...p.chrome, [key]: "#123456" })).toBeNull();
      settings.current.app.app_icon = "grok";
      settings.current.app.opacity = 75;
      setAppColorTheme(v.id, true);
      syncAppColorTheme(false);
      for (const key of CHROME_KEYS) expect(settings.current.app[key]).toBe(appColorPalette(v.id, false)!.chrome[key]);
      expect(selectedAppColorTheme(settings.current.app)).toBe(v.id);
      expect(settings.current.app.app_icon).toBe("grok");
      expect(settings.current.app.opacity).toBe(75);
      expect(settings.current.terminal.dynamic).toEqual({
        ...appColorPalette(v.id, false)!.term, [BEFORE_KEY]: "aynx-light",
      });
    }
    expect(selectedAppColorTheme({ accent: "#123456" })).toBeNull();
  });

  it("별도로 고른 터미널은 모드 재적용에서 보존한다", () => {
    setAppColorTheme("forest", true);
    settings.current.terminal.theme = "tokyo-night";
    settings.current.terminal.dynamic = undefined;
    syncAppColorTheme(false);
    expect(settings.current.app).toMatchObject(appColorPalette("forest", false)!.chrome);
    expect(settings.current.terminal.theme).toBe("tokyo-night");
    expect(settings.current.terminal.dynamic).toBeUndefined();
  });
});

describe("사용자 색 — 테마 전체", () => {
  it("극단 원천도 크롬은 TonalSpot MD3 역할이고, 터미널(커서는 대비 경계로 옮긴 원천)은 그 전 그대로다", () => {
    for (const source of ["#101010", "#f8f8f8", "#ffff00", "#ff0000", "#0000ff", "#00ff00", "#d95a9e"]) for (const dark of [true, false]) {
      const p = customPalette(source, dark);
      expect(contrastRatio(p.term.cursor!, dark ? "#141416" : "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.chrome.accent, p.chrome.bg)).toBeGreaterThanOrEqual(4.5);
      const generated = paletteFromSource(argbFromHex(source), dark);
      generated.term.cursor = p.term.cursor;
      expectM3Chrome(p, m3RoleTokens(new SchemeTonalSpot(Hct.fromInt(argbFromHex(source)), dark, 0)), generated.chrome);
      expectTintedTerm(p, generated);
    }
  });

  it("이미 읽히는 원천은 커서에 그대로 쓰고, 못 읽히면 톤을 옮긴다", () => {
    for (const [source, dark] of [["#d95a9e", true], ["#b03a7c", false]] as const) {
      expect(customPalette(source, dark).term.cursor).toBe(source);
    }
    // 못 읽히는 원천은 톤을 옮겨 대비 경계 안으로
    for (const [source, dark] of [["#101010", true], ["#f8f8f8", false], ["#ffff00", false]] as const) {
      const cursor = customPalette(source, dark).term.cursor!;
      expect(cursor).not.toBe(source);
      expect(contrastRatio(cursor, dark ? "#141416" : "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("저장 왕복·반대 모드 재적용 뒤에도 같은 원천을 판정하고 내장/full로 오인하지 않는다", () => {
    // #4285c5(Ocean 의 원천)는 2026-10-18 부터 크롬이 Ocean 과 같은 MD3 한 벌이라 내장 테마로 읽힌다 — 이웃 색을 쓴다
    for (const source of ["#101010", "#f8f8f8", "#ffff00", "#3a7bd5"]) for (const dark of [true, false]) {
      setCustomAppColor(source, dark);
      settings.current = normalizeSettings(toPayload(normalizeSettings(settings.current)));
      expect(selectedCustomSource(settings.current)).toBe(source);
      expect(selectedAppColorTheme(settings.current.app)).toBeNull();
      expect(currentDynamicSource()).toBeNull();
      expect(settings.current.app.dynamic).toBe("off");
      syncAppColorTheme(!dark);
      const p = customPalette(source, !dark);
      expect(settings.current.app).toMatchObject(p.chrome);
      expect(selectedCustomSource(toPayload(normalizeSettings(settings.current)))).toBe(source);
      expect(selectedAppColorTheme(settings.current.app)).toBeNull();
      expect(settings.current.terminal.dynamic).toEqual({
        ...p.term, [BEFORE_KEY]: dark ? "aynx-light" : "aynx-dark", [SOURCE_KEY]: source,
      });
      settings.current.app.fg = "#123456";
      expect(selectedCustomSource(settings.current)).toBeNull();
    }
  });

  it("내장 선택은 원천 칸을 걷고 기본은 모든 색을 비운다", () => {
    for (const v of variants) {
      setCustomAppColor("#101010", true);
      setAppColorTheme(v.id, false);
      expect(selectedCustomSource(settings.current)).toBeNull();
      expect(settings.current.terminal.dynamic?.[SOURCE_KEY]).toBeUndefined();
    }
    setAppColorTheme("aynx", false);
    expect(CHROME_KEYS.every((key) => settings.current.app[key] === undefined)).toBe(true);
    expect(settings.current.terminal.dynamic).toBeUndefined();
    expect(settings.current.terminal.theme).toBe("aynx-light");
  });

  it("full의 source-color는 사용자 색이 아니며 모드 전환은 원래 TonalSpot을 유지한다", () => {
    const p = paletteFromSource(argbFromHex("#4285c5"), true);
    adoptDynamicPalette(p);
    expect(selectedCustomSource(settings.current)).toBeNull();
    expect(selectedAppColorTheme(settings.current.app)).toBeNull();
    expect(currentDynamicSource()).toBe(argbFromHex("#4285c5") >>> 0);
    syncAppColorTheme(false);
    expect(settings.current.app).toMatchObject(paletteFromSource(argbFromHex("#4285c5"), false).chrome);
    expect(settings.current.app.dynamic).toBe("full");
    expect(selectedCustomSource(settings.current)).toBeNull();
  });

  it("full 에서 터미널 프리셋을 따로 골라도 모드 전환 때 앱 크롬이 새 밝기로 따라온다(10-17)", () => {
    adoptDynamicPalette(paletteFromSource(argbFromHex("#4285c5"), true));
    // setTermPreset 이 하는 일 — 앱 쪽을 off 로 내리고 터미널은 고른 프리셋
    settings.current.app.dynamic = "off";
    settings.current.terminal.theme = "dracula";
    syncAppColorTheme(false);
    expect(settings.current.app).toMatchObject(paletteFromSource(argbFromHex("#4285c5"), false).chrome);
    expect(settings.current.terminal.theme).toBe("dracula");
  });
});

describe("MD3 원천 고르기 · 옛 파일 올리기 (2026-10-18)", () => {
  it("지금 설정의 원천 — 기본은 null(CSS), 내장 테마는 변형의 원천, 사용자 색 · full 은 적어 둔 원천, 그 밖은 강조색", () => {
    expect(appM3Spec({ app: {}, terminal: {} } as never, true)).toBeNull();
    expect(appM3Spec({ app: appColorPalette("ocean", true)!.chrome, terminal: {} } as never, true)).toEqual({ source: "#4285c5" });
    expect(appM3Spec({ app: appColorPalette("mono-silver", false)!.chrome, terminal: {} } as never, false))
      .toEqual({ source: "#b4b4bb", mono: true, neutralHue: 250 });
    setCustomAppColor("#3a7bd5", true);
    expect(appM3Spec(settings.current, true)).toEqual({ source: "#3a7bd5" });
    adoptDynamicPalette(paletteFromSource(argbFromHex("#33aa55"), true));
    expect(appM3Spec(settings.current, true)).toEqual({ source: "#33aa55" });
    expect(appM3Spec({ app: { accent: "#123456" }, terminal: {} } as never, true)).toEqual({ source: "#123456" });
    // full 의 크롬도 같은 TonalSpot 의 역할이다
    expect(appM3Tokens(settings.current, true)!["--m3-surface"]).toBe(settings.current.app.bg);
  });

  it("스킴은 Mono 를 빼면 TonalSpot 그대로다", () => {
    const blue = argbFromHex("#8ab4ff");
    expect(m3RoleTokens(m3Scheme({ source: "#8ab4ff" }, true))).toEqual(m3RoleTokens(new SchemeTonalSpot(Hct.fromInt(blue), true, 0)));
  });

  it("걷은 변형(Luna · Cyberpunk)의 여덟 칸이 저장돼 있으면 어떤 칩도 안 켜지고 색은 그대로 · 역할은 강조색 원천이다", () => {
    // 2026-10-24 전 Luna 다크의 MD3 크롬(SchemeVibrant(#d95a9e) 역할 + 옛 의미색) · 2026-10-18 전 Cyberpunk 2077 다크(손 고른 값)
    const oldLuna = { accent: "#ffafd3", bg: "#1c1015", bg_panel: "#291c21", fg: "#f4dce4", border: "#554249", err: "#ffb4ab", ok: "#a2d100", warn: "#ffb22f" };
    const oldCyber = { accent: "#fcee0a", bg: "#020d0e", bg_panel: "#0c191a", fg: "#e6eef0", border: "#283536", err: "#ff003c", ok: "#00e5a0", warn: "#ff9f1c" };
    for (const old of [oldLuna, oldCyber]) {
      const s = { app: { ...old }, terminal: {} };
      expect(selectedAppColorTheme(s.app)).toBeNull();
      expect(selectedCustomSource(s as never)).toBeNull();
      expect(upgradeLegacyAppColors(s as never)).toBe(false);
      expect(s.app).toEqual(old);
      expect(appM3Spec(s as never, true)).toEqual({ source: old.accent });
      expect(appM3Tokens(s as never, true)!["--m3-primary"]).toMatch(/^#[0-9a-f]{6}$/);
      // 밝기 전환은 알아볼 테마가 없어 손대지 않는다(손 고친 칸과 같다)
      settings.current.app = { ...settings.current.app, ...old };
      syncAppColorTheme(false);
      expect(settings.current.app).toMatchObject(old);
    }
  });

  it("옛 파일의 내장 테마 · 사용자 색 · full 크롬은 같은 테마의 MD3 크롬으로 올라가고, 손 고친 칸은 그대로다", () => {
    // 옛 크롬 = 그 전 생성값(바탕 칸은 그 전 면 계단 + 물들임). 옛 Ocean 다크 8칸은 a8915e4^ 고정값 위에 물들인 것이라
    // 여기서는 옛 경로가 낸 값을 재현하는 대신 **고정값**으로 적는다
    const oldOceanDark = { ...classicBefore["ocean:true"].chrome };
    // full — 옛 크롬(옛 면 계단) + 원천
    const argb = argbFromHex("#33aa55");
    const legacyFull = { ...paletteFromSource(argb, false).chrome, ...legacySurfaces(argb, false) };
    const s2 = { app: { ...legacyFull, dynamic: "full" }, terminal: { dynamic: { [SOURCE_KEY]: "#33aa55" } } };
    expect(upgradeLegacyAppColors(s2 as never)).toBe(true);
    expect(s2.app).toMatchObject(cachedPaletteFromSource(argb, false).chrome);
    // 실제 옛 파일(월페이퍼 full — 2026-10-18 설치본 · 개발 앱 설정에서 옮겨 적은 값)
    for (const [source, old] of [
      ["#9dbce7", { accent: "#a2c9fe", bg: "#0b0e13", bg_panel: "#191c20", fg: "#e1e2e8", border: "#43474e", err: "#ffb4ab", ok: "#8bd09c", warn: "#cec363" }],
      ["#cae87a", { accent: "#bacf82", bg: "#0d0f08", bg_panel: "#1b1c15", fg: "#e3e3d7", border: "#46483c", err: "#ffb4ab", ok: "#a8cc7f", warn: "#cec363" }],
    ] as const) {
      const real = { app: { ...old, dynamic: "full" }, terminal: { dynamic: { [SOURCE_KEY]: source } } };
      expect(upgradeLegacyAppColors(real as never), source).toBe(true);
      expect(real.app).toMatchObject(cachedPaletteFromSource(argbFromHex(source), true).chrome);
    }
    // 모든 내장 테마 × 두 모드의 옛 크롬은 같은 테마 · 같은 모드의 새 크롬으로
    for (const v of variants.filter((entry) => entry.id !== "aynx")) for (const dark of [true, false]) {
      const legacy = { app: { ...legacyAppColorPalette(v.id, dark).chrome }, terminal: {} };
      expect(upgradeLegacyAppColors(legacy as never), v.id).toBe(true);
      expect(legacy.app).toEqual(appColorPalette(v.id, dark)!.chrome);
    }
    // 이미 새 크롬 · 손 고친 칸 · 기본은 그대로
    const fresh = { app: { ...appColorPalette("forest", true)!.chrome }, terminal: {} };
    expect(upgradeLegacyAppColors(fresh as never)).toBe(false);
    const hand = { app: { ...oldOceanDark, accent: "#123456" }, terminal: {} };
    expect(upgradeLegacyAppColors(hand as never)).toBe(false);
    expect(upgradeLegacyAppColors({ app: {}, terminal: {} } as never)).toBe(false);
  });
});

describe("고정 밝기 터미널 — `dynamic-dark` · `dynamic-light` (2026-11-03 → 11-08)", () => {
  it("내장 변형 × 두 모드 — 반대 밝기의 같은 변형 21색이고 밝기도 반대다", () => {
    for (const v of variants.filter((v) => v.id !== "aynx")) for (const isDark of [true, false]) {
      setAppColorTheme(v.id, isDark);
      const alt = oppositeDynamicTerm(settings.current)!;
      expect(alt).toEqual(dynamicTermTheme(appColorPalette(v.id, !isDark)!.term));
      expect(isLightBackground(alt.background)).toBe(isDark);
    }
  });

  it("사용자 색 — 반대 밝기의 사용자 색 21색", () => {
    for (const isDark of [true, false]) {
      setCustomAppColor("#3a7bd5", isDark);
      expect(oppositeDynamicTerm(settings.current)).toEqual(dynamicTermTheme(customPalette("#3a7bd5", !isDark).term));
    }
  });

  it("월페이퍼 full — 적어 둔 원천의 반대 밝기 · 원천을 모르면(옛 파일) undefined", () => {
    const argb = argbFromHex("#4285c5") >>> 0;
    adoptDynamicPalette(cachedPaletteFromSource(argb, false));
    expect(oppositeDynamicTerm(settings.current)).toEqual(dynamicTermTheme(cachedPaletteFromSource(argb, true).term));
    const { [SOURCE_KEY]: _gone, ...old } = settings.current.terminal.dynamic!;
    expect(oppositeDynamicTerm({ app: settings.current.app, terminal: { dynamic: old } })).toBeUndefined();
  });

  it("기본(aynx) · 맵 없음 · 손 고친 크롬이면 undefined", () => {
    setAppColorTheme("aynx", false);
    expect(oppositeDynamicTerm(settings.current)).toBeUndefined();
    setAppColorTheme("forest", true);
    settings.current.terminal.dynamic = undefined;
    expect(oppositeDynamicTerm(settings.current)).toBeUndefined();
    setAppColorTheme("forest", true);
    settings.current.app.fg = "#123456";
    expect(oppositeDynamicTerm(settings.current)).toBeUndefined();
  });

  it("기억판은 같은 입력이면 같은 결과, 크롬이 바뀌면 다시 푼다", () => {
    setAppColorTheme("ocean", false);
    const a = cachedOppositeDynamicTerm(settings.current);
    expect(cachedOppositeDynamicTerm(settings.current)).toBe(a);
    expect(a).toEqual(dynamicTermTheme(appColorPalette("ocean", true)!.term));
    setAppColorTheme("forest", false);
    expect(cachedOppositeDynamicTerm(settings.current)).toEqual(dynamicTermTheme(appColorPalette("forest", true)!.term));
  });

  it("두 벌 — 맵 밝기 쪽은 맵 그대로 · 다른 쪽은 반대 밝기 · 맵이 없으면 빈 것", () => {
    for (const isDark of [true, false]) {
      setAppColorTheme("ocean", isDark);
      const fixed = fixedDynamicTerms(settings.current);
      expect(fixed.dark).toEqual(dynamicTermTheme(appColorPalette("ocean", true)!.term));
      expect(fixed.light).toEqual(dynamicTermTheme(appColorPalette("ocean", false)!.term));
    }
    settings.current.terminal.dynamic = undefined;
    expect(fixedDynamicTerms(settings.current)).toEqual({});
  });

  it("앱 밝기를 바꿔도 고른 고정 밝기 그대로다 — 다크 · 라이트 둘 다", () => {
    for (const [key, want] of [[DYNAMIC_DARK_TERM_KEY, true], [DYNAMIC_LIGHT_TERM_KEY, false]] as const) {
      for (const start of [true, false]) {
        setAppColorTheme("ocean", start);
        setTermPreset(key);
        for (const isDark of [!start, start]) {
          syncAppColorTheme(isDark);
          expect(settings.current.terminal.theme).toBe(key);
          expect(settings.current.terminal.dynamic).toEqual({
            ...appColorPalette("ocean", isDark)!.term, [BEFORE_KEY]: isDark ? "aynx-dark" : "aynx-light",
          });
          const drawn = termThemeOf(key, dynamicTermTheme(settings.current.terminal.dynamic), undefined, fixedDynamicTerms(settings.current));
          expect(drawn).toEqual(dynamicTermTheme(appColorPalette("ocean", want)!.term));
        }
      }
    }
  });

  it("full 에서 고정 밝기를 골라도 full 을 내리지 않고, 재추출 · 밝기 전환은 그 고름 · 밝기를 지키며 되돌아갈 자리는 내장 프리셋이다", () => {
    settings.current.terminal.theme = "tokyo-night";
    const argb = argbFromHex("#4285c5") >>> 0;
    adoptDynamicPalette(cachedPaletteFromSource(argb, true));
    setTermPreset(DYNAMIC_LIGHT_TERM_KEY);
    expect(settings.current.app.dynamic).toBe("full");
    adoptDynamicPalette(cachedPaletteFromSource(argb, false));
    expect(settings.current.terminal.theme).toBe(DYNAMIC_LIGHT_TERM_KEY);
    expect(settings.current.terminal.dynamic?.[BEFORE_KEY]).toBe("tokyo-night");
    syncAppColorTheme(true);
    expect(settings.current.terminal.dynamic).toMatchObject(cachedPaletteFromSource(argb, true).term);
    expect(settings.current.terminal.theme).toBe(DYNAMIC_LIGHT_TERM_KEY);
    expect(fixedDynamicTerms(settings.current).light).toEqual(dynamicTermTheme(cachedPaletteFromSource(argb, false).term));
    clearDynamicTheme();
    expect(settings.current.terminal.theme).toBe("tokyo-night");
  });

  it("앱 색 테마를 새로 골라도 골라 둔 고정 밝기를 지키고, 내장 프리셋에서 오면 앱 밝기의 고정 키다", () => {
    setAppColorTheme("ocean", false);
    setTermPreset(DYNAMIC_DARK_TERM_KEY);
    setAppColorTheme("forest", false);
    expect(settings.current.terminal.theme).toBe(DYNAMIC_DARK_TERM_KEY);
    setCustomAppColor("#3a7bd5", false);
    expect(settings.current.terminal.theme).toBe(DYNAMIC_DARK_TERM_KEY);
    const argb = argbFromHex("#4285c5") >>> 0;
    adoptDynamicPalette(cachedPaletteFromSource(argb, false));
    expect(settings.current.terminal.theme).toBe(DYNAMIC_DARK_TERM_KEY);
    setTermPreset("tokyo-night");
    setAppColorTheme("forest", false);
    expect(settings.current.terminal.theme).toBe(DYNAMIC_LIGHT_TERM_KEY);
    setTermPreset("tokyo-night");
    setCustomAppColor("#3a7bd5", true);
    expect(settings.current.terminal.theme).toBe(DYNAMIC_DARK_TERM_KEY);
  });
});
