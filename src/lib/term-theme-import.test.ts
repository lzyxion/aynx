import { describe, expect, it } from "vitest";
import {
  MAX_THEME_NAME,
  cleanThemeName,
  detectFormat,
  fileStem,
  fillColors,
  normalizeColor,
  parseTermTheme,
  stripJsonc,
} from "./term-theme-import";
import { TERM_COLOR_KEYS, isUserTermKey, termThemeOf, userTermKey, TERM_PRESETS } from "./theme";

/** 성공한 결과의 테마들(실패면 시험 실패) */
function themesOf(text: string, fallback = "Fallback") {
  const r = parseTermTheme(text, fallback);
  if (!r.ok) throw new Error(`해석 실패: ${r.error} ${r.missing?.join(",") ?? ""}`);
  return r;
}

function expectAll21(colors: Record<string, string>) {
  for (const k of TERM_COLOR_KEYS) expect(colors[k], k).toMatch(/^#[0-9a-f]{6}$/);
}

// Windows Terminal 기본 구성 "Campbell" (docs: learn.microsoft.com/windows/terminal/customize-settings/color-schemes)
const CAMPBELL = `{
  "name": "Campbell",
  "cursorColor": "#FFFFFF",
  "selectionBackground": "#FFFFFF",
  "background": "#0C0C0C",
  "foreground": "#CCCCCC",
  "black": "#0C0C0C",
  "blue": "#0037DA",
  "cyan": "#3A96DD",
  "green": "#13A10E",
  "purple": "#881798",
  "red": "#C50F1F",
  "white": "#CCCCCC",
  "yellow": "#C19C00",
  "brightBlack": "#767676",
  "brightBlue": "#3B78FF",
  "brightCyan": "#61D6D6",
  "brightGreen": "#16C60C",
  "brightPurple": "#B4009E",
  "brightRed": "#E74856",
  "brightWhite": "#F2F2F2",
  "brightYellow": "#F9F1A5"
}`;

// Ghostty 내장 테마 "Dracula" (iTerm2-Color-Schemes 의 ghostty/Dracula)
const GHOSTTY_DRACULA = `palette = 0=#21222c
palette = 1=#ff5555
palette = 2=#50fa7b
palette = 3=#f1fa8c
palette = 4=#bd93f9
palette = 5=#ff79c6
palette = 6=#8be9fd
palette = 7=#f8f8f2
palette = 8=#6272a4
palette = 9=#ff6e6e
palette = 10=#69ff94
palette = 11=#ffffa5
palette = 12=#d6acff
palette = 13=#ff92df
palette = 14=#a4ffff
palette = 15=#ffffff
background = #282a36
foreground = #f8f8f2
cursor-color = #f8f8f2
cursor-text = #282a36
selection-background = #44475a
selection-foreground = #ffffff
`;

// alacritty-theme 저장소의 themes/dracula.toml
const ALACRITTY_DRACULA = `# Colors (Dracula)

[colors.primary]
background = '#282a36'
foreground = '#f8f8f2'
bright_foreground = '#ffffff'

[colors.cursor]
text = 'CellBackground'
cursor = 'CellForeground'

[colors.vi_mode_cursor]
text = 'CellBackground'
cursor = 'CellForeground'

[colors.selection]
text = 'CellForeground'
background = '#44475a'

[colors.normal]
black = '#21222c'
red = '#ff5555'
green = '#50fa7b'
yellow = '#f1fa8c'
blue = '#bd93f9'
magenta = '#ff79c6'
cyan = '#8be9fd'
white = '#f8f8f2'

[colors.bright]
black = '#6272a4'
red = '#ff6e6e'
green = '#69ff94'
yellow = '#ffffa5'
blue = '#d6acff'
magenta = '#ff92df'
cyan = '#a4ffff'
white = '#ffffff'
`;

/** iTerm2 한 칸 — 실제 파일처럼 Alpha · Color Space 키가 끼어 있다 */
function itermEntry(name: string, r: number, g: number, b: number): string {
  return `\t<key>${name}</key>
\t<dict>
\t\t<key>Alpha Component</key>
\t\t<real>1</real>
\t\t<key>Blue Component</key>
\t\t<real>${b}</real>
\t\t<key>Color Space</key>
\t\t<string>sRGB</string>
\t\t<key>Green Component</key>
\t\t<real>${g}</real>
\t\t<key>Red Component</key>
\t\t<real>${r}</real>
\t</dict>`;
}

// Solarized Dark(공식 값)의 .itermcolors — 성분은 0~1 실수
const SOLARIZED = [
  ["Ansi 0 Color", 0.027451, 0.211765, 0.258824], // #073642
  ["Ansi 1 Color", 0.862745, 0.196078, 0.184314], // #dc322f
  ["Ansi 2 Color", 0.521569, 0.6, 0], // #859900
  ["Ansi 3 Color", 0.709804, 0.537255, 0], // #b58900
  ["Ansi 4 Color", 0.14902, 0.545098, 0.823529], // #268bd2
  ["Ansi 5 Color", 0.827451, 0.211765, 0.509804], // #d33682
  ["Ansi 6 Color", 0.164706, 0.631373, 0.596078], // #2aa198
  ["Ansi 7 Color", 0.933333, 0.909804, 0.835294], // #eee8d5
  ["Ansi 8 Color", 0, 0.168627, 0.211765], // #002b36
  ["Ansi 9 Color", 0.796078, 0.294118, 0.086275], // #cb4b16
  ["Ansi 10 Color", 0.345098, 0.431373, 0.458824], // #586e75
  ["Ansi 11 Color", 0.396078, 0.482353, 0.513725], // #657b83
  ["Ansi 12 Color", 0.513725, 0.580392, 0.588235], // #839496
  ["Ansi 13 Color", 0.423529, 0.443137, 0.768627], // #6c71c4
  ["Ansi 14 Color", 0.576471, 0.631373, 0.631373], // #93a1a1
  ["Ansi 15 Color", 0.992157, 0.964706, 0.890196], // #fdf6e3
  ["Background Color", 0, 0.168627, 0.211765], // #002b36
  ["Foreground Color", 0.513725, 0.580392, 0.588235], // #839496
  ["Cursor Color", 0.576471, 0.631373, 0.631373], // #93a1a1
  ["Cursor Text Color", 0, 0.168627, 0.211765],
  ["Selection Color", 0.027451, 0.211765, 0.258824],
] as const;
const ITERM_SOLARIZED = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${SOLARIZED.map(([n, r, g, b]) => itermEntry(n, r, g, b)).join("\n")}
</dict>
</plist>
`;

describe("normalizeColor", () => {
  it("여러 표기를 #rrggbb 소문자로", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("#AbCdEf")).toBe("#abcdef");
    expect(normalizeColor("#11223344")).toBe("#112233");
    expect(normalizeColor("0x282A36")).toBe("#282a36");
    expect(normalizeColor("282a36")).toBe("#282a36");
    expect(normalizeColor("'#282a36'")).toBe("#282a36");
    expect(normalizeColor("rgb(40, 42, 54)")).toBe("#282a36");
    expect(normalizeColor("rgba(40,42,54,0.5)")).toBe("#282a36");
  });
  it("모르는 모양은 null", () => {
    for (const bad of ["", "red", "CellForeground", "#12", "rgb(300,0,0)", "11223344", "#ggg"]) {
      expect(normalizeColor(bad), bad).toBeNull();
    }
    expect(normalizeColor(undefined)).toBeNull();
  });
});

describe("fillColors", () => {
  const base = {
    background: "#101010",
    foreground: "#e0e0e0",
    black: "#000000",
    red: "#800000",
    green: "#008000",
    yellow: "#808000",
    blue: "#000080",
    magenta: "#800080",
    cyan: "#008080",
    white: "#c0c0c0",
  };
  it("빠진 칸을 규칙대로 채운다 — 어두우면 bright 를 조금 밝게", () => {
    const c = fillColors(base);
    if ("missing" in c) throw new Error("채우기 실패");
    expectAll21(c);
    expect(c.cursor).toBe("#e0e0e0");
    expect(c.cursorAccent).toBe("#101010");
    // 글자 25% + 배경 75%: 0xe0*0.25 + 0x10*0.75 = 56 + 12 = 68 = 0x44
    expect(c.selectionBackground).toBe("#444444");
    // 흰색 20% 섞기: 0x80*0.8 + 255*0.2 = 102.4 + 51 = 153.4 → 0x99
    expect(c.brightRed).toBe("#993333");
  });
  it("밝은 배경이면 bright 는 보통 색 그대로", () => {
    const c = fillColors({ ...base, background: "#fdf6e3", foreground: "#657b83" });
    if ("missing" in c) throw new Error("채우기 실패");
    expect(c.brightRed).toBe("#800000");
    expect(c.brightWhite).toBe("#c0c0c0");
  });
  it("배경 · 글자 · 보통 8색이 없으면 빠진 칸을 알린다", () => {
    const { red: _red, background: _bg, ...rest } = base;
    expect(fillColors(rest)).toEqual({ missing: ["background", "red"] });
  });
});

describe("Windows Terminal", () => {
  it("구성 하나 — purple 이 magenta · 이름은 name", () => {
    const r = themesOf(CAMPBELL);
    expect(r.format).toBe("windows-terminal");
    expect(r.themes).toHaveLength(1);
    const [t] = r.themes;
    expect(t.name).toBe("Campbell");
    expectAll21(t.colors);
    expect(t.colors.background).toBe("#0c0c0c");
    expect(t.colors.magenta).toBe("#881798");
    expect(t.colors.brightMagenta).toBe("#b4009e");
    expect(t.colors.cursor).toBe("#ffffff");
    expect(t.colors.cursorAccent).toBe("#0c0c0c");
  });

  it("settings.json 전체 — 주석 · 끝 쉼표 · 여러 구성(깨진 것은 빼고)", () => {
    const settings = `// 이 파일은 Windows Terminal 설정입니다
{
  "$schema": "https://aka.ms/terminal-profiles-schema",
  "profiles": { "list": [] },
  /* 색 구성 */
  "schemes": [
    ${CAMPBELL},
    { "name": "Half", "background": "#000000" },
    {
      "name": "One Half Light",
      "background": "#FAFAFA", "foreground": "#383A42",
      "black": "#383A42", "red": "#E45649", "green": "#50A14F", "yellow": "#C18301",
      "blue": "#0184BC", "purple": "#A626A4", "cyan": "#0997B3", "white": "#FAFAFA",
    },
  ],
}`;
    const r = themesOf(settings);
    expect(r.themes.map((t) => t.name)).toEqual(["Campbell", "One Half Light"]);
    const light = r.themes[1].colors;
    expect(light.brightRed).toBe("#e45649"); // 밝은 배경 — 그대로 복사
    expect(light.selectionBackground).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("배열 · 이름 없는 구성은 파일 이름에 번호", () => {
    const one = JSON.parse(CAMPBELL);
    delete one.name;
    const r = themesOf(JSON.stringify([one, one]), "schemes");
    expect(r.themes.map((t) => t.name)).toEqual(["schemes 1", "schemes 2"]);
    expect(themesOf(JSON.stringify(one), "campbell").themes[0].name).toBe("campbell");
  });

  it("구성이 없는 설정 · 깨진 JSON", () => {
    expect(parseTermTheme(`{ "profiles": {} }`, "x")).toEqual({ ok: false, error: "noSchemes" });
    expect(parseTermTheme(`{ "schemes": [ { "name": `, "x")).toEqual({ ok: false, error: "json" });
    const r = parseTermTheme(`{ "name": "a", "background": "#000000" }`, "x");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("missing");
      expect(r.missing).toContain("foreground");
    }
  });

  it("stripJsonc 는 문자열 안의 // 와 , 를 건드리지 않는다", () => {
    expect(JSON.parse(stripJsonc(`{"u":"http://x,}", // c\n "a":[1,2,],}`))).toEqual({ u: "http://x,}", a: [1, 2] });
  });
});

describe("iTerm2", () => {
  it("plist 실수 성분 → hex · 이름은 파일 이름", () => {
    const r = themesOf(ITERM_SOLARIZED, "Solarized Dark");
    expect(r.format).toBe("iterm2");
    const [t] = r.themes;
    expect(t.name).toBe("Solarized Dark");
    expectAll21(t.colors);
    expect(t.colors.background).toBe("#002b36");
    expect(t.colors.foreground).toBe("#839496");
    expect(t.colors.red).toBe("#dc322f");
    expect(t.colors.brightWhite).toBe("#fdf6e3");
    expect(t.colors.cursor).toBe("#93a1a1");
    expect(t.colors.cursorAccent).toBe("#002b36");
    expect(t.colors.selectionBackground).toBe("#073642");
  });
  it("색 칸이 없는 plist", () => {
    expect(parseTermTheme(`<?xml version="1.0"?><plist><dict><key>a</key><string>b</string></dict></plist>`, "x"))
      .toEqual({ ok: false, error: "plist" });
  });
});

describe("Ghostty", () => {
  it("palette = N=#hex 와 이름 칸", () => {
    const r = themesOf(GHOSTTY_DRACULA, "Dracula");
    expect(r.format).toBe("ghostty");
    const [t] = r.themes;
    expectAll21(t.colors);
    expect(t.colors.black).toBe("#21222c");
    expect(t.colors.brightWhite).toBe("#ffffff");
    expect(t.colors.cursorAccent).toBe("#282a36");
    expect(t.colors.selectionBackground).toBe("#44475a");
  });
  it("# 없는 값 · 주석 줄 · bright 없음", () => {
    const text = `# my theme\nbackground = 1d1f21\nforeground = c5c8c6\n${[0, 1, 2, 3, 4, 5, 6, 7]
      .map((n) => `palette = ${n}=#${String(n).repeat(6)}`)
      .join("\n")}\n`;
    const [t] = themesOf(text).themes;
    expect(t.colors.background).toBe("#1d1f21");
    expect(t.colors.brightBlack).toBe("#333333"); // #000000 에 흰색 20%
  });
});

describe("Alacritty", () => {
  it("섹션 TOML — CellForeground 같은 값은 채우기 규칙으로", () => {
    const r = themesOf(ALACRITTY_DRACULA, "dracula");
    expect(r.format).toBe("alacritty");
    const [t] = r.themes;
    expectAll21(t.colors);
    expect(t.colors.background).toBe("#282a36");
    expect(t.colors.cursor).toBe("#f8f8f2"); // CellForeground → 글자색
    expect(t.colors.cursorAccent).toBe("#282a36");
    expect(t.colors.selectionBackground).toBe("#44475a");
    expect(t.colors.brightBlue).toBe("#d6acff");
  });
  it("[colors] 아래 인라인 표 · 점 키", () => {
    const text = `[colors]
primary = { background = "#fbf1c7", foreground = "#3c3836" }
normal.black = "#fbf1c7"
normal.red = "#cc241d"
normal.green = "#98971a"
normal.yellow = "#d79921"
normal.blue = "#458588"
normal.magenta = "#b16286"
normal.cyan = "#689d6a"
normal.white = "#7c6f64"
`;
    const [t] = themesOf(text).themes;
    expect(t.colors.background).toBe("#fbf1c7");
    expect(t.colors.brightRed).toBe("#cc241d"); // 밝은 배경 — 그대로
  });
  it("옛 YAML 은 거절", () => {
    const yaml = `colors:\n  primary:\n    background: '#282a36'\n    foreground: '#f8f8f2'\n`;
    expect(detectFormat(yaml)).toBe("yaml");
    expect(parseTermTheme(yaml, "x")).toEqual({ ok: false, error: "yaml" });
  });
});

describe("판별 · 이름", () => {
  it("형식 판별", () => {
    expect(detectFormat(CAMPBELL)).toBe("windows-terminal");
    expect(detectFormat(`// c\n[ {"black":"#000000"} ]`)).toBe("windows-terminal");
    expect(detectFormat(ITERM_SOLARIZED)).toBe("iterm2");
    expect(detectFormat(GHOSTTY_DRACULA)).toBe("ghostty");
    expect(detectFormat(ALACRITTY_DRACULA)).toBe("alacritty");
    expect(detectFormat("hello world")).toBeNull();
  });
  it("빈 글자 · 모르는 형식 · 너무 큼", () => {
    expect(parseTermTheme("  \n", "x")).toEqual({ ok: false, error: "empty" });
    expect(parseTermTheme("hello", "x")).toEqual({ ok: false, error: "unknown" });
    expect(parseTermTheme("a".repeat(1024 * 1024 + 1), "x")).toEqual({ ok: false, error: "tooBig" });
  });
  it("파일 이름 · 이름 다듬기", () => {
    expect(fileStem("C:\\themes\\Tokyo Night.itermcolors")).toBe("Tokyo Night");
    expect(fileStem("dracula.toml")).toBe("dracula");
    expect(fileStem(undefined)).toBe("");
    expect(cleanThemeName("  a\tb\n c ")).toBe("a b c");
    expect(Array.from(cleanThemeName("가".repeat(100)))).toHaveLength(MAX_THEME_NAME);
  });
});

describe("사용자 테마 키 · termThemeOf", () => {
  it("키 모양", () => {
    expect(isUserTermKey(userTermKey("tokyo-night"))).toBe(true);
    for (const bad of ["user:", "user:A", "user:../x", "user:-a", "tokyo-night", "dynamic", undefined]) {
      expect(isUserTermKey(bad), String(bad)).toBe(false);
    }
  });
  it("있으면 그 팔레트 · 없으면 같은 모드의 AYNX", () => {
    const theme = { background: "#123456" };
    const user = { themes: { mine: { id: "mine", name: "Mine", theme } } };
    expect(termThemeOf("user:mine", undefined, user)).toBe(theme);
    expect(termThemeOf("user:gone", undefined, user)).toBe(TERM_PRESETS["aynx-dark"].theme);
    expect(termThemeOf("user:gone", undefined, { ...user, light: true })).toBe(TERM_PRESETS["aynx-light"].theme);
    expect(termThemeOf("user:mine")).toBe(TERM_PRESETS["aynx-dark"].theme);
  });
});
