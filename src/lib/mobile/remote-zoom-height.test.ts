import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// 원격의 UI 크기는 루트 CSS zoom 이라 `--app-h`(화면에서 잰 px)에도 곱해진다. 80% 면 폰 앱 높이가 화면의 80% 가 되어 아래가 빈다.
describe("원격 창의 높이는 UI 크기를 되돌린다", () => {
  it("폴리필이 zoom 과 같은 계수를 --css-zoom 으로 알린다", () => {
    const js = src("../../../src-tauri/src/remote/polyfill.js");
    expect(js).toContain("document.documentElement.style.zoom = factor;");
    expect(js).toContain('document.documentElement.style.setProperty("--css-zoom", factor);');
  });

  it(".app 높이를 그 계수로 나눈다(폰 · 데스크톱 원격)", () => {
    const page = src("../../../src/routes/+page.svelte");
    expect(page).toContain("height: calc(var(--app-h, 100dvh) / var(--css-zoom, 1));");
    expect(page).toContain("height: calc(100vh / var(--css-zoom, 1));");
  });
});
