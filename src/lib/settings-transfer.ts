/** 설정 옮기기 — 순수 모델(docs/log/2026-11-17-settings-transfer.md) */

/** 범주 id — `src-tauri/src/settings_transfer/catalog.rs` 의 `CATEGORIES` 와 같은 글자 · 순서 */
export const TRANSFER_CATEGORIES = [
  "hosts",
  "ai",
  "db",
  "projects",
  "templates",
  "appearance",
  "keys",
  "instructions",
  "mcp",
  "artists",
  "general",
  "notifications",
] as const;

export type TransferCategory = (typeof TRANSFER_CATEGORIES)[number];

export const EXPORT_DEFAULT_OFF: readonly TransferCategory[] = ["notifications"];

/** 문구 키 꼬리(`settings.transfer.never.<id>`) */
export const NEVER_INCLUDED = ["vault", "tokens", "webhooks", "devices", "sessions", "conversations", "albums"] as const;

export interface ExportCategory {
  id: TransferCategory;
  count: number;
  bytes: number;
}

export type ItemStatus = "new" | "changed" | "same";
export type Conflict = "overwrite" | "skip" | "both";
export type AiMode = "asIs" | "off";

export interface PreviewItem {
  key: string;
  label: string;
  status: ItemStatus;
  aiGrant: boolean;
  note: "command" | null;
}

export interface MissingFolder {
  id: string;
  name: string;
  path: string;
}

export interface PreviewCategory {
  id: TransferCategory;
  items: PreviewItem[];
  choices: Conflict[];
  missingFolders: MissingFolder[];
}

export interface ImportPreview {
  appVersion: string;
  exportedAt: string;
  categories: PreviewCategory[];
}

export interface CategoryPick {
  on: boolean;
  conflict: Conflict;
}

/** 백엔드 `ImportChoices` 와 같은 꼴 */
export interface ImportChoices {
  categories: string[];
  conflict: Record<string, Conflict>;
  aiMode: AiMode;
  remap: Record<string, string>;
}

export function statusCounts(items: readonly PreviewItem[]): Record<ItemStatus, number> {
  const out: Record<ItemStatus, number> = { new: 0, changed: 0, same: 0 };
  for (const it of items) out[it.status] += 1;
  return out;
}

/** 백엔드 `Ctx::item` 과 같은 규칙 */
export function itemWrites(item: PreviewItem, pick: CategoryPick, aiMode: AiMode): boolean {
  if (!pick.on) return false;
  if (item.aiGrant && aiMode === "off") return false;
  if (item.status === "new") return true;
  if (item.status === "changed") return pick.conflict !== "skip";
  return false;
}

export function changeCount(
  preview: ImportPreview,
  picks: Readonly<Record<string, CategoryPick>>,
  aiMode: AiMode,
): number {
  let n = 0;
  for (const cat of preview.categories) {
    const pick = picks[cat.id];
    if (!pick) continue;
    for (const it of cat.items) if (itemWrites(it, pick, aiMode)) n += 1;
  }
  return n;
}

export function initialPicks(preview: ImportPreview): Record<string, CategoryPick> {
  const out: Record<string, CategoryPick> = {};
  for (const cat of preview.categories) {
    const c = statusCounts(cat.items);
    out[cat.id] = { on: c.new + c.changed > 0, conflict: "overwrite" };
  }
  return out;
}

export function buildChoices(
  picks: Readonly<Record<string, CategoryPick>>,
  aiMode: AiMode,
  remap: Readonly<Record<string, string>>,
): ImportChoices {
  const categories = TRANSFER_CATEGORIES.filter((c) => picks[c]?.on);
  const conflict: Record<string, Conflict> = {};
  for (const c of categories) conflict[c] = picks[c]!.conflict;
  const cleanRemap: Record<string, string> = {};
  for (const [id, path] of Object.entries(remap)) if (path.trim()) cleanRemap[id] = path.trim();
  return { categories, conflict, aiMode, remap: cleanRemap };
}

export function exportBytes(summary: readonly ExportCategory[], picked: ReadonlySet<string>): number {
  return summary.filter((c) => picked.has(c.id)).reduce((sum, c) => sum + c.bytes, 0);
}

/** 단위 글자는 언어를 타지 않는다 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function defaultExportName(now: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `aynx-settings-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`;
}

export function unresolvedFolders(cat: PreviewCategory | undefined, remap: Readonly<Record<string, string>>): number {
  if (!cat) return 0;
  return cat.missingFolders.filter((m) => !remap[m.id]?.trim()).length;
}

export function unchanged(cat: PreviewCategory): boolean {
  const c = statusCounts(cat.items);
  return c.new + c.changed === 0;
}

function sinkLast<T>(list: readonly T[], last: (x: T) => boolean): T[] {
  return [...list.filter((x) => !last(x)), ...list.filter(last)];
}

export function exportOrder(summary: readonly ExportCategory[]): ExportCategory[] {
  return sinkLast(summary, (c) => c.count === 0);
}

export function importOrder(categories: readonly PreviewCategory[]): PreviewCategory[] {
  return sinkLast(categories, unchanged);
}

/** 백엔드 `catalog::SETTINGS_SECTIONS` 와 같은 목록 — 표시 이름(`settings.transfer.section.<칸>`)에만 쓴다 */
export const SETTINGS_SECTION_NAMES = [
  "app",
  "terminal",
  "wallpaper",
  "dock",
  "keybindings",
  "triggers",
  "automation",
  "messenger",
  "shell",
  "files",
  "hosts",
  "projects",
  "plans",
  "updates",
  "ai",
] as const;

/** `key` 는 문구 키, `detail` 은 그대로 보이는 덧붙임 이름 */
export function itemDisplay(item: Pick<PreviewItem, "key" | "label">): { key: string | null; detail: string | null } {
  const k = item.key;
  if (k.startsWith("settings:")) {
    const sec = k.slice("settings:".length);
    return (SETTINGS_SECTION_NAMES as readonly string[]).includes(sec)
      ? { key: `settings.transfer.section.${sec}`, detail: null }
      : { key: null, detail: item.label };
  }
  if (k.startsWith("file:")) {
    const rel = k.slice("file:".length);
    const base = rel.split("/").pop() ?? rel;
    if (/^(wp-[0-9a-z]+|wallpaper)\.[a-z0-9]+$/i.test(rel)) return { key: "settings.transfer.file.wallpaper", detail: null };
    if (rel.startsWith("app-icons/")) return { key: "settings.transfer.file.avatar", detail: null };
    if (rel.startsWith("terminal-themes/")) return { key: "settings.transfer.file.termTheme", detail: base.replace(/\.json$/i, "") };
    if (rel.startsWith("instructions/")) return { key: null, detail: base.replace(/\.md$/i, "") };
  }
  return { key: null, detail: item.label };
}

export function numberDuplicates(names: readonly string[]): string[] {
  const total = new Map<string, number>();
  for (const n of names) total.set(n, (total.get(n) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((n) => {
    if ((total.get(n) ?? 0) < 2) return n;
    const i = (seen.get(n) ?? 0) + 1;
    seen.set(n, i);
    return `${n} ${i}`;
  });
}

export type TodoKind = "segment" | "append" | "add" | "keep";

export function todoKind(cat: PreviewCategory): TodoKind {
  const c = statusCounts(cat.items);
  if (c.new + c.changed === 0) return "keep";
  if (c.changed > 0 && cat.choices.length > 0) return "segment";
  return cat.id === "hosts" ? "append" : "add";
}
