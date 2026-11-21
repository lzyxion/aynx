// 설정 옮기기 — 프런트는 경로와 사람의 선택만 넘기고, 가져오기 적용은 Rust 가 파일을 다시 읽어 다시 판정한다.
// 원격 창에서는 네 명령이 막혀 있다(`remote/deny.rs` HOME_ONLY).
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { invoke, isRemote } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { toast } from "$lib/toast.svelte.js";
import { emitSettingsSaved } from "$lib/settings.svelte.js";
import { adoptExternalSettings } from "$lib/settings-sync.svelte.js";
import { refreshHosts } from "$lib/app/hosts/list.svelte.js";
import { refreshProjects } from "$lib/app/project-list.svelte.js";
import { reloadTabTemplates } from "$lib/app/tab-templates.svelte.js";
import { loadSnippets } from "$lib/snippets.svelte.js";
import { reloadDbConns } from "$lib/app/db-conns.svelte.js";
import { reloadDbFolders } from "$lib/app/db-folders.svelte.js";
import { refreshDbAi } from "$lib/app/db-ai.svelte.js";
import {
  EXPORT_DEFAULT_OFF,
  TRANSFER_CATEGORIES,
  buildChoices,
  defaultExportName,
  initialPicks,
  type AiMode,
  type CategoryPick,
  type ExportCategory,
  type ImportPreview,
} from "$lib/settings-transfer";

interface ExportDone {
  path: string;
  bytes: number;
  files: number;
}

interface ImportDone {
  changed: number;
  backup: string;
  touched: string[];
}

export const transferDialog = $state<{
  mode: "export" | "import" | null;
  busy: boolean;
  error: string | null;
  // 내보내기
  summary: ExportCategory[];
  picked: string[];
  // 가져오기
  path: string;
  preview: ImportPreview | null;
  picks: Record<string, CategoryPick>;
  aiMode: AiMode;
  remap: Record<string, string>;
}>({
  mode: null,
  busy: false,
  error: null,
  summary: [],
  picked: [],
  path: "",
  preview: null,
  picks: {},
  aiMode: "asIs",
  remap: {},
});

export function transferDialogVisible(): boolean {
  return transferDialog.mode !== null;
}

export function closeTransferDialog(): void {
  if (transferDialog.busy) return;
  transferDialog.mode = null;
  transferDialog.error = null;
  transferDialog.preview = null;
}

function message(e: unknown): string {
  return stripReason(e instanceof Error ? e.message : String(e));
}

export async function openSettingsExport(): Promise<void> {
  if (isRemote) return;
  transferDialog.mode = "export";
  transferDialog.error = null;
  transferDialog.busy = true;
  transferDialog.summary = [];
  try {
    transferDialog.summary = await invoke<ExportCategory[]>("settings_export_summary");
    transferDialog.picked = TRANSFER_CATEGORIES.filter(
      (c) => !EXPORT_DEFAULT_OFF.includes(c) && transferDialog.summary.some((s) => s.id === c && s.count > 0),
    );
  } catch (e) {
    transferDialog.error = message(e);
  } finally {
    transferDialog.busy = false;
  }
}

export function toggleExportCategory(id: string, on: boolean): void {
  const rest = transferDialog.picked.filter((c) => c !== id);
  transferDialog.picked = on ? TRANSFER_CATEGORIES.filter((c) => c === id || rest.includes(c)) : rest;
}

export async function runSettingsExport(): Promise<void> {
  if (transferDialog.busy || transferDialog.picked.length === 0) return;
  let path: string | null = null;
  try {
    path = await saveDialog({ defaultPath: defaultExportName(), filters: [{ name: "Zip", extensions: ["zip"] }] });
  } catch (e) {
    console.error("[aynx] 저장 대화상자를 열지 못했습니다", e);
  }
  if (!path) return;
  if (!/\.zip$/i.test(path)) path = `${path}.zip`;
  transferDialog.busy = true;
  transferDialog.error = null;
  try {
    const done = await invoke<ExportDone>("settings_export", { path, categories: [...transferDialog.picked] });
    transferDialog.busy = false;
    closeTransferDialog();
    toast.success(t("settings.transfer.export.done", { path: done.path }), { ms: 8000 });
  } catch (e) {
    transferDialog.error = message(e);
    transferDialog.busy = false;
  }
}

/** 미리 보기까지 — 아직 아무것도 바꾸지 않는다 */
export async function openSettingsImport(): Promise<void> {
  if (isRemote) return;
  let picked: string | string[] | null = null;
  try {
    picked = await openDialog({ multiple: false, directory: false, filters: [{ name: "Zip", extensions: ["zip"] }] });
  } catch (e) {
    console.error("[aynx] 열기 대화상자를 열지 못했습니다", e);
  }
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return;
  transferDialog.mode = "import";
  transferDialog.path = path;
  transferDialog.preview = null;
  transferDialog.error = null;
  transferDialog.aiMode = "asIs";
  transferDialog.remap = {};
  transferDialog.busy = true;
  try {
    const preview = await invoke<ImportPreview>("settings_import_preview", { path });
    transferDialog.preview = preview;
    transferDialog.picks = initialPicks(preview);
  } catch (e) {
    transferDialog.error = message(e);
  } finally {
    transferDialog.busy = false;
  }
}

export async function repickProjectFolder(id: string): Promise<void> {
  let picked: string | string[] | null = null;
  try {
    picked = await openDialog({ directory: true, multiple: false });
  } catch (e) {
    console.error("[aynx] 폴더 대화상자를 열지 못했습니다", e);
  }
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (path) transferDialog.remap = { ...transferDialog.remap, [id]: path };
}

/** 이 창만 다시 읽는다 — 다른 창은 각자의 바뀜 이벤트로 따라온다 */
async function reloadAfterImport(touched: readonly string[]): Promise<void> {
  const has = (prefix: string) => touched.some((p) => p.startsWith(prefix));
  const jobs: Promise<unknown>[] = [];
  if (has("config/settings.toml") || has("config/wp-") || has("config/app-icons/") || has("config/terminal-themes/")) {
    jobs.push(adoptExternalSettings());
    emitSettingsSaved();
  }
  if (has("ssh/")) refreshHosts();
  if (has("config/projects.json")) jobs.push(refreshProjects());
  if (has("config/tab-templates.json")) jobs.push(reloadTabTemplates());
  if (has("config/snippets.json")) jobs.push(loadSnippets());
  if (has("config/db-connections.json")) jobs.push(reloadDbConns());
  if (has("config/db-folders.json")) jobs.push(reloadDbFolders());
  if (has("home/delegation.toml") || has("config/db-connections.json")) jobs.push(refreshDbAi());
  await Promise.allSettled(jobs);
}

export async function applySettingsImport(): Promise<void> {
  const preview = transferDialog.preview;
  if (!preview || transferDialog.busy) return;
  transferDialog.busy = true;
  transferDialog.error = null;
  try {
    const choices = buildChoices(transferDialog.picks, transferDialog.aiMode, transferDialog.remap);
    const done = await invoke<ImportDone>("settings_import_apply", { path: transferDialog.path, choices });
    await reloadAfterImport(done.touched);
    transferDialog.busy = false;
    closeTransferDialog();
    toast.success(t("settings.transfer.import.done", { n: String(done.changed), path: done.backup }), { ms: 10000 });
  } catch (e) {
    transferDialog.error = message(e);
    transferDialog.busy = false;
  }
}
