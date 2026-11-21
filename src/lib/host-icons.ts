/**
 * 아이콘 세트 — 색 규칙이 둘로 갈린다: 호스트에 골라 붙이는 로고(`HOST_ICONS` · logos 전체)는 원본 색 그대로,
 * 앱 글리프(`SERVER_D`)와 lucide "기본" 칸은 `currentColor` 다. 로고에 테마 색을 입히면 서로 구분되지 않는다.
 * 저장 형식은 `sessions.toml` 의 `icon = "svg:<이름>"` 이고, 접두사가 아닌 값은 이모지로 그린다.
 * 런타임에 Iconify API 를 부르지 않는다 — 오프라인에서 화면이 비고 Tauri CSP 를 열어야 한다.
 */

import { GENERATED_ICONS, type GeneratedIcon } from "$lib/host-icons.generated";

export type { GeneratedIcon };

export const HOST_ICONS: Readonly<Record<string, GeneratedIcon>> = GENERATED_ICONS;

export const HOST_ICON_NAMES: readonly string[] = Object.keys(GENERATED_ICONS);

export const ICON_PREFIX = "svg:";

export function iconRef(name: string): string {
  return `${ICON_PREFIX}${name}`;
}

/** 모르는 이름도 `null` — 이모지 자리로 떨어져 글자 그대로 보이는 편이 빈칸보다 고치기 쉽다 */
export function iconNameOf(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  if (!raw || !raw.startsWith(ICON_PREFIX)) return null;
  const name = raw.slice(ICON_PREFIX.length);
  return name in GENERATED_ICONS ? name : null;
}

export function glyphFor(name: string): GeneratedIcon | null {
  return GENERATED_ICONS[name] ?? null;
}

/**
 * 접두사 일치가 포함보다 앞이고, 같은 등급 안은 표의 차례 그대로다 — 재배열하면 사람이 외운 격자 자리가 흔들린다.
 * 걸리는 것이 없으면 빈 배열 — 부르는 쪽이 친 글자를 이모지 값으로 쓴다.
 */
export function matchIcons(
  query: string,
  table: Readonly<Record<string, GeneratedIcon>> = GENERATED_ICONS,
): string[] {
  let q = query.trim().toLowerCase();
  if (q.startsWith(ICON_PREFIX)) q = q.slice(ICON_PREFIX.length);
  if (q === "") return Object.keys(table);

  const starts: string[] = [];
  const contains: string[] = [];
  for (const [name, icon] of Object.entries(table)) {
    const hay = [name, icon.label, ...icon.keywords].map((s) => s.toLowerCase());
    if (hay.some((h) => h.startsWith(q))) starts.push(name);
    else if (hay.some((h) => h.includes(q))) contains.push(name);
  }
  return [...starts, ...contains];
}

// ── logos 전체 ── (docs/log/2026-09-29-logos-full-icons.md)
// 7MB 남짓이라 본 번들이 아니라 `host-icons-logos.generated.json` 을 늦게 받는다. 저장 형식 `svg:logos:<logos 이름>` —
// 큐레이션 이름에는 `:` 가 없어 겹치지 않는다.

/** 생성기가 줄여 적은 모양 그대로 */
export interface LogosEntry {
  b: string;
  /** 표의 기본 viewBox 와 다를 때만 */
  v?: string;
  /** Iconify `hidden` — 옛 이름 풀이에만 싣고 검색에는 안 뜬다 */
  x?: 1;
}

/** `host-icons-logos.generated.json` · `host-icons-lucide.generated.json` 의 모양 — `scripts/gen-host-icons.mjs` 의 `writeFullSet` 이 만든다 */
export interface IconSetData {
  source: string;
  version: string;
  license: string;
  viewBox: string;
  icons: Readonly<Record<string, LogosEntry>>;
  aliases: Readonly<Record<string, string>>;
}

export type LogosSet = IconSetData;

export const LOGOS_PREFIX = "logos:";

export function logosRef(name: string): string {
  return `${ICON_PREFIX}${LOGOS_PREFIX}${name}`;
}

/** 표는 늦게 오므로 모양만 본다 */
export function logosNameOf(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  const head = `${ICON_PREFIX}${LOGOS_PREFIX}`;
  if (!raw || !raw.startsWith(head)) return null;
  const name = raw.slice(head.length);
  return name === "" ? null : name;
}

export interface IconGlyph {
  viewBox: string;
  body: string;
}

export function setGlyph(set: IconSetData, name: string): IconGlyph | null {
  const entry = Object.hasOwn(set.icons, name)
    ? set.icons[name]
    : Object.hasOwn(set.aliases, name)
      ? set.icons[set.aliases[name]]
      : undefined;
  return entry ? { viewBox: entry.v ?? set.viewBox, body: entry.b } : null;
}

export const logosGlyph = setGlyph;

export interface IconHit {
  ref: string;
  label: string;
}

/** 가로 글씨 로고는 14px 정사각 칸에서 실오라기가 되어, 검색이 같은 등급 안에서 뒤로 보낸다 */
export function isWordmark(viewBox: string): boolean {
  const [, , w, h] = viewBox.split(/\s+/).map(Number);
  return w > 0 && h > 0 && w / h > 1.6;
}

export const ICON_SEARCH_CAP = 200;

function setQuery(query: string, setPrefix: string): string {
  let q = query.trim().toLowerCase();
  if (q.startsWith(ICON_PREFIX)) q = q.slice(ICON_PREFIX.length);
  if (q.startsWith(setPrefix)) q = q.slice(setPrefix.length);
  return q.replace(/\s+/g, "-");
}

function matchSetNames(q: string, set: IconSetData, skip: ReadonlySet<string> = new Set()): string[] {
  // [접두사·정사각, 접두사·가로 글씨, 포함·정사각, 포함·가로 글씨]
  const tiers: string[][] = [[], [], [], []];
  for (const [name, entry] of Object.entries(set.icons)) {
    if (entry.x || skip.has(name)) continue;
    const wide = isWordmark(entry.v ?? set.viewBox) ? 1 : 0;
    if (name.startsWith(q) || name.split("-").some((part) => part.startsWith(q))) tiers[wide].push(name);
    else if (name.includes(q)) tiers[2 + wide].push(name);
  }
  return tiers.flat();
}

/**
 * 큐레이션 먼저, 그 뒤 logos. 큐레이션이 이미 가진 로고는 logos 쪽에서 뺀다 — 같은 그림이 두 칸에 뜬다.
 * `total` 은 상한 전 개수다.
 */
export function searchIcons(
  query: string,
  logos: LogosSet | null,
  cap: number = ICON_SEARCH_CAP,
  table: Readonly<Record<string, GeneratedIcon>> = GENERATED_ICONS,
): { hits: IconHit[]; total: number } {
  const curated: IconHit[] = matchIcons(query, table).map((name) => ({
    ref: iconRef(name),
    label: table[name].label,
  }));

  const q = setQuery(query, LOGOS_PREFIX);
  const full: IconHit[] = [];
  if (q !== "" && logos) {
    const taken = new Set(
      Object.values(table)
        .map((i) => i.source)
        .filter((s) => s.startsWith(LOGOS_PREFIX))
        .map((s) => s.slice(LOGOS_PREFIX.length)),
    );
    for (const name of matchSetNames(q, logos, taken)) full.push({ ref: logosRef(name), label: name });
  }

  const all = [...curated, ...full];
  return { hits: all.slice(0, Math.max(0, cap)), total: all.length };
}

// ── lucide 전체 ── 고르개의 "기본" 칸. 저장 형식 `svg:lucide:<이름>` · 획이 `currentColor` 라 `HostIcon` 이 호스트 색을 입힌다.

export const LUCIDE_PREFIX = "lucide:";

export function lucideRef(name: string): string {
  return `${ICON_PREFIX}${LUCIDE_PREFIX}${name}`;
}

export function lucideNameOf(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  const head = `${ICON_PREFIX}${LUCIDE_PREFIX}`;
  if (!raw || !raw.startsWith(head)) return null;
  const name = raw.slice(head.length);
  return name === "" ? null : name;
}

/** "기본" 칸의 빈 격자 — 순서가 곧 격자 순서다 */
export const LUCIDE_FEATURED: readonly string[] = [
  "server",
  "database",
  "hard-drive",
  "cpu",
  "container",
  "box",
  "archive",
  "cloud",
  "router",
  "network",
  "wifi",
  "radio-tower",
  "globe",
  "monitor",
  "laptop",
  "house",
  "building",
  "flask-conical",
  "shield",
  "lock",
  "bug",
  "rocket",
  "terminal",
  "git-branch",
];

export function searchLucide(
  query: string,
  lucide: IconSetData | null,
  cap: number = ICON_SEARCH_CAP,
): { hits: IconHit[]; total: number } {
  const q = setQuery(query, LUCIDE_PREFIX);
  const names = q === "" ? [...LUCIDE_FEATURED] : lucide ? matchSetNames(q, lucide) : [];
  const all = names.map((name) => ({ ref: lucideRef(name), label: name }));
  return { hits: all.slice(0, Math.max(0, cap)), total: all.length };
}

/**
 * 같은 로고가 여럿 뜨면 그라디언트 `id` 가 문서에 겹치고, `url(#id)` 가 가리키던 첫 인스턴스가 지워지는 순간
 * 남은 것들이 검게 죽는다 — 그리는 쪽이 인스턴스마다 꼬리표를 붙인다.
 */
export function uniquifyIds(body: string, uid: string): string {
  if (!body.includes('id="')) return body;
  return body
    .replaceAll(/ id="([^"]+)"/g, (_m, id: string) => ` id="${id}-${uid}"`)
    .replaceAll(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${id}-${uid})`);
}

/** 기본 흰색 말고도 구멍으로 남길 칠 — 안 적으면 바탕 면과 같은 잉크로 합쳐져 모양이 사라진다 */
const MONO_CUT_EXTRA: Readonly<Record<string, readonly string[]>> = {
  powershell: ["#2c5591"],
  bash: ["#3ab14a"],
};

const MONO_CUT_DEFAULT = new Set(["#fff", "#ffffff", "white", "var(--logo-mono-inverse)"]);

/** 한 색 실루엣 — 그리는 SVG 는 `fill="currentColor"` 를 함께 달아야 칠 속성 없는 도형까지 잉크가 된다 */
export function monoBody(body: string, name: string | null = null): string {
  const extra = (name && MONO_CUT_EXTRA[name]) || [];
  return body.replaceAll(/\b(fill|stroke)="([^"]*)"/g, (m, attr: string, raw: string) => {
    const v = raw.trim().toLowerCase();
    if (v === "none") return m;
    const cut = MONO_CUT_DEFAULT.has(v) || extra.includes(v);
    return `${attr}="${cut ? "var(--mono-cut, transparent)" : "currentColor"}"`;
  });
}

// ── UI 글리프 ──

export const UI_VIEWBOX = "0 0 24 24";

/** `theme.css` 의 `--row-icon-size` 와 같은 값 — SVG `width`/`height` 속성에는 `var()` 를 못 쓴다 */
export const ROW_ICON_PX = 14;

/** `theme.css` 의 `--tile-icon-size` 와 같은 값 */
export const TILE_ICON_PX = 24;

/** 장식이 아니라 폴더가 존재하게 하는 값 — 그룹 메타는 아이콘이 있을 때만 파일에 남는다(`setGroupMeta`) */
export const DEFAULT_FOLDER_ICON = "📁";

/** 기본값 `📁` 은 고른 것으로 치지 않는다 — 치면 모든 폴더가 테마를 따르지 않는 이모지로 남는다 */
export function folderIcon(icon: string | null | undefined): string | null {
  const raw = icon?.trim();
  return raw && raw !== DEFAULT_FOLDER_ICON ? raw : null;
}

export const SERVER_D =
  "M3.5 3.5h17A1.5 1.5 0 0 1 22 5v4a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 9V5a1.5 1.5 0 0 1 1.5-1.5zm2 2.1a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zM3.5 13.5h17A1.5 1.5 0 0 1 22 15v4a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 19v-4a1.5 1.5 0 0 1 1.5-1.5zm2 2.1a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z";

/** 구멍(LED)이 있어 evenodd 로 칠해야 한다 */
export const SERVER_RULE = "evenodd" as const;
