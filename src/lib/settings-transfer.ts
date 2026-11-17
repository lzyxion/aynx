/**
 * **설정 옮기기 — 순수 모델** (docs/log/2026-11-17-settings-transfer.md). 백엔드 `settings_transfer` 가 내는 꼴과
 * 화면이 고른 것을 다루는 함수들 — 개수 · 크기 글자 · 기본 파일 이름 · 가져오기 선택 짓기. 상태와 명령 호출은
 * `app/settings-transfer.svelte.ts`, 모달은 `dialogs/SettingsTransferDialog.svelte`.
 */

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

/** 내보내기에서 처음에 꺼 두는 범주 — 알림(메신저 켬끔)은 PC 마다 다르게 두는 일이 흔하다 */
export const EXPORT_DEFAULT_OFF: readonly TransferCategory[] = ["notifications"];

/** "제외 항목" 칩 줄 — 문구 키 꼬리(`settings.transfer.never.<id>`) */
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

/** 화면이 범주마다 쥐는 선택 */
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

/** 상태별 개수 */
export function statusCounts(items: readonly PreviewItem[]): Record<ItemStatus, number> {
  const out: Record<ItemStatus, number> = { new: 0, changed: 0, same: 0 };
  for (const it of items) out[it.status] += 1;
  return out;
}

/** 이 줄을 실제로 쓰는가 — 백엔드 `Ctx::item` 과 같은 규칙 */
export function itemWrites(item: PreviewItem, pick: CategoryPick, aiMode: AiMode): boolean {
  if (!pick.on) return false;
  if (item.aiGrant && aiMode === "off") return false;
  if (item.status === "new") return true;
  if (item.status === "changed") return pick.conflict !== "skip";
  return false;
}

/** 미리 보기에서 실제로 바뀌는 항목 수 — 0 이면 [가져오기] 가 비활성 */
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

/** 미리 보기의 첫 선택 — 바뀌는 줄이 있는 범주만 켜고, 다른 값은 덮기 */
export function initialPicks(preview: ImportPreview): Record<string, CategoryPick> {
  const out: Record<string, CategoryPick> = {};
  for (const cat of preview.categories) {
    const c = statusCounts(cat.items);
    out[cat.id] = { on: c.new + c.changed > 0, conflict: "overwrite" };
  }
  return out;
}

/** 백엔드에 보낼 선택 */
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

/** 고른 범주의 크기 합 */
export function exportBytes(summary: readonly ExportCategory[], picked: ReadonlySet<string>): number {
  return summary.filter((c) => picked.has(c.id)).reduce((sum, c) => sum + c.bytes, 0);
}

/** 사람이 읽는 크기(`812 KB` · `4.2 MB`) — 단위 글자는 언어를 타지 않는다 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 저장 대화상자의 기본 이름 — `aynx-settings-YYYY-MM-DD.zip`(그 PC 의 날짜) */
export function defaultExportName(now: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `aynx-settings-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.zip`;
}

/** 아직 다시 고르지 않은 없는 폴더 수 */
export function unresolvedFolders(cat: PreviewCategory | undefined, remap: Readonly<Record<string, string>>): number {
  if (!cat) return 0;
  return cat.missingFolders.filter((m) => !remap[m.id]?.trim()).length;
}

/** 바뀌는 줄이 하나도 없는가(전부 같음 — 화면은 흐리게 · 맨 뒤로) */
export function unchanged(cat: PreviewCategory): boolean {
  const c = statusCounts(cat.items);
  return c.new + c.changed === 0;
}

/** 순서는 그대로 두고 `last` 인 것만 맨 뒤로(안정 정렬) */
function sinkLast<T>(list: readonly T[], last: (x: T) => boolean): T[] {
  return [...list.filter((x) => !last(x)), ...list.filter(last)];
}

/** 내보내기 카드 순서 — 표 순서 그대로, 개수 0 인 범주만 맨 뒤로 */
export function exportOrder(summary: readonly ExportCategory[]): ExportCategory[] {
  return sinkLast(summary, (c) => c.count === 0);
}

/** 가져오기 행 순서 — 받은 순서 그대로, 바뀌는 것이 없는 범주만 맨 뒤로 */
export function importOrder(categories: readonly PreviewCategory[]): PreviewCategory[] {
  return sinkLast(categories, unchanged);
}

/**
 * `settings.toml` 의 맨 위 칸 — 백엔드 `catalog::SETTINGS_SECTIONS` 와 같은 목록. 미리 보기 항목 이름(`[app]` 같은 절 이름)을
 * 사람 말로 바꾸는 데만 쓴다(`settings.transfer.section.<칸>`). 목록에 없는 칸은 원래 이름 그대로 보인다.
 */
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

/**
 * 미리 보기 항목의 **보이는 이름**(2026-11-17 사용자 — 설정 파일의 절 이름 · 파일 이름이 그대로 보였다). `key` 가 있으면 그 문구 키,
 * `detail` 은 덧붙는 이름(그대로 보인다). 둘 다 없을 일은 없다 — 모르는 모양은 원래 `label` 이 `detail` 로 남는다. 순수.
 */
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

/**
 * 같은 보이는 이름이 둘 이상이면 나온 순서대로 ` 1` · ` 2` 를 붙인다(2026-11-17 사용자 — 월페이퍼 그림이 두 줄 똑같이 보였다).
 * 하나뿐인 이름은 그대로. 순수.
 */
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

/** '할 일' 칸 — 다른 값이 있으면 고르기(세그먼트), 아니면 글자: 호스트는 끝에 추가 · 나머지는 새 항목 추가 · 바뀌는 것 없음은 그대로 */
export type TodoKind = "segment" | "append" | "add" | "keep";

export function todoKind(cat: PreviewCategory): TodoKind {
  const c = statusCounts(cat.items);
  if (c.new + c.changed === 0) return "keep";
  if (c.changed > 0 && cat.choices.length > 0) return "segment";
  return cat.id === "hosts" ? "append" : "add";
}
