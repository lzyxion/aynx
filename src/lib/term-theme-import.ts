/**
 * 다른 터미널(Windows Terminal · iTerm2 · Ghostty · Alacritty)의 색 구성 글자 → 21칸. 저장은 Rust `term_themes.rs` 가 21색을 다시 검증한다.
 * iTerm2 의 `Color Space` 는 무시하고 sRGB 로 본다.
 */
import { TERM_COLOR_KEYS, isLightBackground, type TermColorKey, type TermColors } from "$lib/theme";

/** 이름 글자 수 상한 — Rust `term_themes::MAX_NAME` 과 같다 */
export const MAX_THEME_NAME = 64;
export const MAX_IMPORT_CHARS = 1024 * 1024;

export type ImportFormat = "windows-terminal" | "iterm2" | "ghostty" | "alacritty";

/** i18n 키 `settings.terminal.import.error.<code>` 의 꼬리다 — 바꾸면 문구가 끊긴다 */
export type ImportErrorCode =
  | "empty"
  | "tooBig"
  | "unknown"
  | "yaml"
  | "json"
  | "plist"
  | "noSchemes"
  | "missing";

export interface ImportedTheme {
  name: string;
  colors: TermColors;
}

export type ImportResult =
  | { ok: true; format: ImportFormat; themes: ImportedTheme[] }
  | { ok: false; error: ImportErrorCode; missing?: TermColorKey[] };

type Partial21 = Partial<Record<TermColorKey, string>>;

const NORMAL = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
const BRIGHT: Record<(typeof NORMAL)[number], TermColorKey> = {
  black: "brightBlack",
  red: "brightRed",
  green: "brightGreen",
  yellow: "brightYellow",
  blue: "brightBlue",
  magenta: "brightMagenta",
  cyan: "brightCyan",
  white: "brightWhite",
};
const ANSI_INDEX: readonly TermColorKey[] = [...NORMAL, ...NORMAL.map((k) => BRIGHT[k])];

// ---------------------------------------------------------------------------
// 색 글자
// ---------------------------------------------------------------------------

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

export function normalizeColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  let m = /^(?:#|0x)?([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  // 맨 16진수(`#` · `0x` 없이)는 6자리만 받는다 — 8자리 맨 숫자는 알파인지 무엇인지 알 수 없다.
  if (m && (s.startsWith("#") || s.startsWith("0x") || s.length === 6)) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(s);
  if (m) {
    const parts = [m[1], m[2], m[3]].map(Number);
    if (parts.every((n) => n <= 255)) return `#${parts.map(hex2).join("")}`;
  }
  return null;
}

function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => hex2(ch(a, i) * t + ch(b, i) * (1 - t))).join("")}`;
}

export function fillColors(raw: Partial21): TermColors | { missing: TermColorKey[] } {
  const got: Partial21 = {};
  for (const k of TERM_COLOR_KEYS) {
    const c = normalizeColor(raw[k]);
    if (c) got[k] = c;
  }
  const required: TermColorKey[] = ["background", "foreground", ...NORMAL];
  const missing = required.filter((k) => !got[k]);
  if (missing.length) return { missing };
  const bg = got.background!;
  const fg = got.foreground!;
  const light = isLightBackground(bg);
  const out = { ...got } as TermColors;
  out.cursor ??= fg;
  out.cursorAccent ??= bg;
  out.selectionBackground ??= mix(fg, bg, 0.25);
  for (const k of NORMAL) out[BRIGHT[k]] ??= light ? got[k]! : mix("#ffffff", got[k]!, 0.2);
  return out;
}

// ---------------------------------------------------------------------------
// 이름
// ---------------------------------------------------------------------------

export function fileStem(fileName: string | null | undefined): string {
  const base = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/\.[^.]+$/, "").trim();
}

export function cleanThemeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return Array.from(raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()).slice(0, MAX_THEME_NAME).join("");
}

// ---------------------------------------------------------------------------
// 형식별 해석
// ---------------------------------------------------------------------------

export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] !== "}" && text[j] !== "]") out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const WT_KEYS: Record<string, TermColorKey> = {
  background: "background",
  foreground: "foreground",
  cursorColor: "cursor",
  selectionBackground: "selectionBackground",
  black: "black",
  red: "red",
  green: "green",
  yellow: "yellow",
  blue: "blue",
  purple: "magenta",
  magenta: "magenta",
  cyan: "cyan",
  white: "white",
  brightBlack: "brightBlack",
  brightRed: "brightRed",
  brightGreen: "brightGreen",
  brightYellow: "brightYellow",
  brightBlue: "brightBlue",
  brightPurple: "brightMagenta",
  brightMagenta: "brightMagenta",
  brightCyan: "brightCyan",
  brightWhite: "brightWhite",
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const looksLikeScheme = (v: unknown): v is Record<string, unknown> =>
  isObj(v) && ("background" in v || "black" in v || "foreground" in v);

function parseWindowsTerminal(text: string, fallback: string): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(stripJsonc(text));
  } catch {
    return { ok: false, error: "json" };
  }
  let schemes: unknown[];
  if (Array.isArray(doc)) schemes = doc;
  else if (isObj(doc) && Array.isArray(doc.schemes)) schemes = doc.schemes;
  else if (looksLikeScheme(doc)) schemes = [doc];
  else return { ok: false, error: "noSchemes" };
  const candidates = schemes.filter(looksLikeScheme);
  if (!candidates.length) return { ok: false, error: "noSchemes" };
  const themes: ImportedTheme[] = [];
  let firstMissing: TermColorKey[] | undefined;
  candidates.forEach((s, i) => {
    const raw: Partial21 = {};
    for (const [from, to] of Object.entries(WT_KEYS)) {
      if (typeof s[from] === "string" && raw[to] === undefined) raw[to] = s[from] as string;
    }
    const filled = fillColors(raw);
    if ("missing" in filled) {
      firstMissing ??= filled.missing;
      return;
    }
    const own = typeof s.name === "string" ? cleanThemeName(s.name) : "";
    const name = own || (candidates.length > 1 ? `${fallback} ${i + 1}` : fallback);
    themes.push({ name: cleanThemeName(name), colors: filled });
  });
  if (!themes.length) return { ok: false, error: "missing", missing: firstMissing };
  return { ok: true, format: "windows-terminal", themes };
}

function itermKey(name: string): TermColorKey | null {
  const m = /^Ansi (\d{1,2}) Color$/.exec(name);
  if (m) return ANSI_INDEX[Number(m[1])] ?? null;
  const fixed: Record<string, TermColorKey> = {
    "Background Color": "background",
    "Foreground Color": "foreground",
    "Cursor Color": "cursor",
    "Cursor Text Color": "cursorAccent",
    "Selection Color": "selectionBackground",
  };
  return fixed[name] ?? null;
}

function parseIterm(text: string, fallback: string): ImportResult {
  if (!/<dict>/i.test(text)) return { ok: false, error: "plist" };
  const raw: Partial21 = {};
  // 바깥 dict 의 `<key>이름</key><dict>…</dict>` — 안쪽 dict 는 겹치지 않으므로 가장 짧은 짝이면 된다.
  const entry = /<key>\s*([^<]+?)\s*<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  for (const m of text.matchAll(entry)) {
    const key = itermKey(m[1]);
    if (!key) continue;
    const comp = (c: string) => {
      const r = new RegExp(`<key>\\s*${c} Component\\s*</key>\\s*<(?:real|integer)>\\s*([^<]+?)\\s*</`, "i").exec(m[2]);
      const n = r ? Number(r[1]) : NaN;
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
    };
    const rgb = [comp("Red"), comp("Green"), comp("Blue")];
    if (rgb.some((v) => v === null)) continue;
    raw[key] = `#${rgb.map((v) => hex2(v! * 255)).join("")}`;
  }
  if (!Object.keys(raw).length) return { ok: false, error: "plist" };
  const filled = fillColors(raw);
  if ("missing" in filled) return { ok: false, error: "missing", missing: filled.missing };
  return { ok: true, format: "iterm2", themes: [{ name: cleanThemeName(fallback), colors: filled }] };
}

function parseGhostty(text: string, fallback: string): ImportResult {
  const raw: Partial21 = {};
  const fixed: Record<string, TermColorKey> = {
    background: "background",
    foreground: "foreground",
    "cursor-color": "cursor",
    "cursor-text": "cursorAccent",
    "selection-background": "selectionBackground",
  };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^([\w-]+)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "palette") {
      const p = /^(\d{1,2})\s*=\s*(.+)$/.exec(value.trim());
      const slot = p ? ANSI_INDEX[Number(p[1])] : undefined;
      if (p && slot) raw[slot] = p[2];
    } else if (fixed[key]) {
      raw[fixed[key]] = value;
    }
  }
  const filled = fillColors(raw);
  if ("missing" in filled) return { ok: false, error: "missing", missing: filled.missing };
  return { ok: true, format: "ghostty", themes: [{ name: cleanThemeName(fallback), colors: filled }] };
}

function tomlValue(v: string): string {
  const t = v.trim();
  const q = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(t);
  if (q) return q[1] ?? q[2] ?? "";
  return t.replace(/\s+#.*$/, "");
}

function alacrittyKey(path: string): TermColorKey | null {
  const m = /^colors\.(primary|normal|bright|cursor|selection)\.(\w+)$/.exec(path);
  if (!m) return null;
  const [, group, name] = m;
  if (group === "primary") return name === "background" || name === "foreground" ? name : null;
  if (group === "normal" || group === "bright") {
    const n = (NORMAL as readonly string[]).includes(name) ? (name as (typeof NORMAL)[number]) : null;
    return n ? (group === "normal" ? n : BRIGHT[n]) : null;
  }
  if (group === "cursor") return name === "cursor" ? "cursor" : name === "text" ? "cursorAccent" : null;
  return name === "background" ? "selectionBackground" : null;
}

function parseAlacritty(text: string, fallback: string): ImportResult {
  const raw: Partial21 = {};
  let section = "";
  const put = (path: string, value: string) => {
    const key = alacrittyKey(path);
    if (key) raw[key] = tomlValue(value);
  };
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const h = /^\[\s*([\w.-]+)\s*\]$/.exec(t);
    if (h) {
      section = h[1];
      continue;
    }
    const m = /^([\w.-]+)\s*=\s*(.*)$/.exec(t);
    if (!m) continue;
    const path = section ? `${section}.${m[1]}` : m[1];
    const inline = /^\{(.*)\}\s*(?:#.*)?$/.exec(m[2].trim());
    if (inline) {
      for (const part of inline[1].matchAll(/([\w-]+)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|[^,]+)/g)) {
        put(`${path}.${part[1]}`, part[2]);
      }
    } else {
      put(path, m[2]);
    }
  }
  const filled = fillColors(raw);
  if ("missing" in filled) return { ok: false, error: "missing", missing: filled.missing };
  return { ok: true, format: "alacritty", themes: [{ name: cleanThemeName(fallback), colors: filled }] };
}

// ---------------------------------------------------------------------------
// 판별
// ---------------------------------------------------------------------------

/** 옛 Alacritty YAML 은 받지 않는다 — `"yaml"` 로 가려 오류로 낸다 */
export function detectFormat(text: string): ImportFormat | "yaml" | null {
  const t = text.replace(/^﻿/, "").trim();
  if (t.startsWith("<") || /<plist[\s>]/i.test(t)) return "iterm2";
  const firstLine = t.split(/\r?\n/, 1)[0].trim();
  const tomlHeader = /^\[\s*[A-Za-z_][\w.-]*\s*\]$/.test(firstLine);
  if (!tomlHeader) {
    const json = stripJsonc(t).trim();
    if (json.startsWith("{") || json.startsWith("[")) return "windows-terminal";
  }
  if (/^\s*colors\s*:\s*(?:#.*)?$/m.test(t) || /^\s*primary\s*:\s*(?:#.*)?$/m.test(t)) return "yaml";
  if (/^\s*\[\s*colors(?:\.[\w-]+)?\s*\]\s*$/m.test(t) || /^\s*colors\.[\w.-]+\s*=/m.test(t)) return "alacritty";
  if (/^\s*(?:palette|background|foreground)\s*=/m.test(t)) return "ghostty";
  return null;
}

export function parseTermTheme(text: string, fallbackName: string): ImportResult {
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: "tooBig" };
  const body = text.replace(/^﻿/, "");
  if (!body.trim()) return { ok: false, error: "empty" };
  const fallback = cleanThemeName(fallbackName) || "Theme";
  const format = detectFormat(body);
  switch (format) {
    case "iterm2":
      return parseIterm(body, fallback);
    case "windows-terminal":
      return parseWindowsTerminal(body, fallback);
    case "alacritty":
      return parseAlacritty(body, fallback);
    case "ghostty":
      return parseGhostty(body, fallback);
    case "yaml":
      return { ok: false, error: "yaml" };
    default:
      return { ok: false, error: "unknown" };
  }
}
