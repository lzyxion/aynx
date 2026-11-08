import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TERM_PRESETS } from "$lib/theme";
import type { AppearanceSnapshot } from "$lib/theme-profiles";
import { PREVIEW_BLUR_SCALE, PREVIEW_DEFAULTS, previewWallpaperFx, profilePreview } from "$lib/profile-preview";

/**
 * 프로필 카드의 미리 보기 색 (docs/log/2026-09-28-profile-cards-wallpapers.md).
 */

function snap(over: {
  app?: AppearanceSnapshot["app"];
  terminal?: AppearanceSnapshot["terminal"];
  wallpaper?: AppearanceSnapshot["wallpaper"];
}): AppearanceSnapshot {
  return {
    app: over.app ?? {},
    terminal: over.terminal ?? {},
    wallpaper: over.wallpaper ?? {},
  } as AppearanceSnapshot;
}

describe("profilePreview", () => {
  it("안 정한 칸은 그 모드의 theme.css 기본값이다", () => {
    const dark = profilePreview(snap({}));
    expect(dark.mode).toBe("dark");
    expect(dark.light).toBe(false);
    expect([dark.accent, dark.bg, dark.fg]).toEqual(Object.values(PREVIEW_DEFAULTS.dark));

    const light = profilePreview(snap({ app: { mode: "light" } as AppearanceSnapshot["app"] }));
    expect(light.light).toBe(true);
    expect([light.accent, light.bg, light.fg]).toEqual(Object.values(PREVIEW_DEFAULTS.light));
  });

  it("정한 색이 기본값을 이기고, 빈 글자는 안 정한 것과 같다", () => {
    const p = profilePreview(
      snap({ app: { accent: "#123456", bg: "  ", fg: "" } as AppearanceSnapshot["app"] }),
    );
    expect(p.accent).toBe("#123456");
    expect(p.bg).toBe(PREVIEW_DEFAULTS.dark.bg);
    expect(p.fg).toBe(PREVIEW_DEFAULTS.dark.fg);
  });

  it("터미널 팔레트는 프리셋 → ANSI 여덟 칸", () => {
    const preset = TERM_PRESETS["aynx-light"].theme;
    const p = profilePreview(snap({ terminal: { theme: "aynx-light" } as AppearanceSnapshot["terminal"] }));
    expect(p.ansi).toHaveLength(8);
    expect(p.ansi[1]).toBe(preset.red);
    expect(p.ansi[4]).toBe(preset.blue);
  });

  it("dynamic 은 저장된 팔레트를, 모르는 키는 기본 프리셋을 쓴다", () => {
    const dyn = profilePreview(
      snap({
        terminal: {
          theme: "dynamic",
          dynamic: { background: "#010203", foreground: "#fafafa", red: "#ff0000" },
        } as AppearanceSnapshot["terminal"],
      }),
    );
    expect(dyn.ansi[1]).toBe("#ff0000");
    // 팔레트에 없는 칸은 터미널 글자색으로 채운다 (빈 막대를 그리지 않는다)
    expect(dyn.ansi[2]).toBe("#fafafa");

    const unknown = profilePreview(snap({ terminal: { theme: "없는-프리셋" } as AppearanceSnapshot["terminal"] }));
    expect(unknown.ansi[1]).toBe(TERM_PRESETS["aynx-dark"].theme.red);
  });

  it("걷은 옛 프리셋 키는 앱과 같은 별칭으로 푼다 — `light` → AYNX Light", () => {
    const p = profilePreview(snap({ terminal: { theme: "light" } as AppearanceSnapshot["terminal"] }));
    expect(p.ansi[1]).toBe(TERM_PRESETS["aynx-light"].theme.red);
  });

  it("theme.css 기본값과 어긋나지 않는다", () => {
    const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8");
    const block = (sel: RegExp) => {
      const m = sel.exec(css);
      expect(m, String(sel)).not.toBeNull();
      const start = m!.index;
      return css.slice(start, css.indexOf("}", start));
    };
    const token = (body: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(body)?.[1];
    const dark = block(/^:root \{/m);
    const light = block(/^:root\[data-theme="light"\] \{/m);
    for (const [body, want] of [
      [dark, PREVIEW_DEFAULTS.dark],
      [light, PREVIEW_DEFAULTS.light],
    ] as const) {
      // 2026-10-18 부터 원시 토큰은 MD3 역할의 별칭이다 — 값은 그 역할에 있다
      expect(token(body, "--m3-primary")).toBe(want.accent);
      expect(token(body, "--m3-surface")).toBe(want.bg);
      expect(token(body, "--m3-on-surface")).toBe(want.fg);
    }
  });
});

describe("previewWallpaperFx", () => {
  it("어둡게는 알파로, 블러는 카드 비율만큼 줄여서", () => {
    const fx = previewWallpaperFx(snap({ wallpaper: { dim: 40, blur: 20 } as AppearanceSnapshot["wallpaper"] }));
    expect(fx.dim).toBe("rgba(0, 0, 0, 0.400)");
    expect(fx.blur).toBe(`${(20 * PREVIEW_BLUR_SCALE).toFixed(1)}px`);
    expect(previewWallpaperFx(snap({}))).toEqual({ dim: "rgba(0, 0, 0, 0.000)", blur: "0.0px" });
  });
});
