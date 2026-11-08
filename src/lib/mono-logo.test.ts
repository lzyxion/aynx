import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOST_ICONS } from "$lib/host-icons";
import { colorKind, monoKind, monoLogo, MONO_INVERSE_VAR, MONO_VAR } from "$lib/mono-logo.js";

describe("colorKind — 색 값 하나의 갈래", () => {
  it("검정·거의 검정", () => {
    for (const c of ["#000", "#000000", "black", "#161614", "#181717", "#231F20", "#1a1a1a", "rgb(20, 20, 20)"]) {
      expect(colorKind(c), c).toBe("black");
    }
  });
  it("흰색", () => {
    for (const c of ["#fff", "#FFFFFF", "white", "#fafafa"]) expect(colorKind(c), c).toBe("white");
  });
  it("그 밖 — 짙어도 빛깔이 있으면 검정이 아니다", () => {
    for (const c of ["#d97757", "#003366", "#666", "hsl(0 0% 0%)"]) expect(colorKind(c), c).toBe("other");
  });
  it("색이 아닌 값은 건너뛴다", () => {
    for (const c of ["none", "url(#a)", "currentColor", "inherit"]) expect(colorKind(c), c).toBe("skip");
  });
});

describe("monoKind · monoLogo — 검정 단색 로고만 토큰으로", () => {
  it("칠 없는 도형(기본값 검정)만 → 감싸는 g 가 토큰을 준다", () => {
    const body = '<path d="M0 0h1v1z"/>';
    expect(monoKind(body)).toBe("mono");
    expect(monoLogo(body)).toBe(`<g fill="${MONO_VAR}"><path d="M0 0h1v1z"/></g>`);
  });

  it("적힌 검정 칠·획·style 도 토큰으로", () => {
    const body =
      '<path fill="#161614" d="M0"/><path stroke="#000" fill="none" d="M1"/><rect style="fill:#1a1a1a;opacity:.5"/>';
    const out = monoLogo(body);
    expect(out).toContain(`fill="${MONO_VAR}" d="M0"`);
    expect(out).toContain(`stroke="${MONO_VAR}" fill="none"`);
    expect(out).toContain(`style="fill:${MONO_VAR};opacity:.5"`);
    expect(out).not.toMatch(/#161614|#000"|#1a1a1a/);
  });

  it("검정 조각이 섞인 컬러 로고는 받은 그대로", () => {
    const body = '<path fill="#000" d="M0"/><path fill="#d97757" d="M1"/>';
    expect(monoKind(body)).toBeNull();
    expect(monoLogo(body)).toBe(body);
    // 칠 없는 도형 + 그라디언트의 빛깔도 "그 밖"
    const grad = '<defs><linearGradient id="a"><stop stop-color="#ff0"/></linearGradient></defs><path d="M0"/>';
    expect(monoLogo(grad)).toBe(grad);
  });

  it("검정 없는 로고(흰색만·빛깔만)는 그대로", () => {
    const white = '<path fill="#fff" d="M0"/>';
    expect(monoKind(white)).toBeNull();
    expect(monoLogo(white)).toBe(white);
  });

  it("검정 + 흰색(오려낸 자리)은 통째 반전 — 흰색은 inverse 토큰", () => {
    const body = '<rect width="10" height="10"/><path fill="#fff" d="M1"/>';
    expect(monoKind(body)).toBe("negative");
    const out = monoLogo(body);
    expect(out.startsWith(`<g fill="${MONO_VAR}">`)).toBe(true);
    expect(out).toContain(`fill="${MONO_INVERSE_VAR}" d="M1"`);
  });

  it("마스크·<style> 이 있으면 손대지 않는다 (흑백이 투명도이거나 읽지 않는 색)", () => {
    const mask = '<mask id="m" fill="#fff"><circle r="1"/></mask><path mask="url(#m)" d="M0"/>';
    expect(monoLogo(mask)).toBe(mask);
    const style = "<style>.a{fill:#f00}</style><path class=\"a\" d=\"M0\"/>";
    expect(monoLogo(style)).toBe(style);
  });
});

describe("생성 산출물 — 검정 단색 로고가 토큰을 쓴다", () => {
  it("큐레이션: codex·github·macos 는 --logo-mono, terminal 은 원본(반전 예외), claude 는 원본 주황", () => {
    expect(HOST_ICONS.codex.body).toContain(MONO_VAR);
    expect(HOST_ICONS.github.body).toContain(MONO_VAR);
    expect(HOST_ICONS.macos.body).toContain(MONO_VAR);
    // terminal 은 생성기의 `MONO_KEEP` — 검정 판 + 흰 프롬프트 원본 그대로(2026-10-18 사용자)
    expect(HOST_ICONS.terminal.body).not.toContain("--logo-mono");
    expect(HOST_ICONS.terminal.body).toContain('fill="#fff"');
    expect(HOST_ICONS.claude.body).not.toContain("--logo-mono");
    expect(HOST_ICONS.claude.body).toContain("#d97757");
    // 큐레이션에서 바뀐 것은 이 셋뿐이다 — 늘면 의도한 것인지 본다
    const changed = Object.entries(HOST_ICONS)
      .filter(([, g]) => g.body.includes("--logo-mono"))
      .map(([n]) => n)
      .sort();
    expect(changed).toEqual(["codex", "github", "macos"]);
  });

  it("logos 전체: openai-icon·apple·vercel 은 토큰, 컬러 로고는 원본", () => {
    const set = JSON.parse(
      readFileSync(fileURLToPath(new URL("./host-icons-logos.generated.json", import.meta.url)), "utf8"),
    ) as { icons: Record<string, { b: string }> };
    for (const n of ["openai-icon", "apple", "vercel-icon", "github-icon"]) {
      expect(set.icons[n].b, n).toContain(MONO_VAR);
    }
    for (const n of ["claude-icon", "ubuntu", "docker-icon"]) {
      expect(set.icons[n].b, n).not.toContain("--logo-mono");
    }
  });
});
