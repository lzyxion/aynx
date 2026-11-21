/**
 * - 앱 창은 `dragDropEnabled: false` 라 끌어 놓은 OS 파일에 경로가 없다 — 웹 표준 `File` 로 읽는다.
 * - 원격 창: 메인 PC 의 열기 · 저장 대화상자는 폴리필이 거절하므로 같은 입구가 이 기기(브라우저)의 고르기 창 · 내려받기로 간다.
 */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { saveBlobToDevice } from "$lib/browser/device-download";
import { pickDeviceFiles } from "$lib/browser/device-pick";
import { backendFromKey, localBackend, LOCAL_KEY, type TextFile } from "$lib/fs-backend";
import { isRemote } from "$lib/ipc";
import { decodeFsDrag, fsDragActive, fsDragEmpty, FS_DRAG_TYPE } from "$lib/fs-drag";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import { writeTextFile } from "$lib/scrollback";
import { toast } from "$lib/toast.svelte.js";
import { QUERY_SCRIPTS_MAX } from "$lib/session";
import { SQL_FILE_EXTENSIONS, SQL_FILE_MAX_BYTES, fileBaseName, scriptTitleOf, sqlFileVerdict, type SqlFileVerdict } from "./sql-file";

export interface SqlSource {
  name: string;
  size: number | null;
  read: () => Promise<Pick<TextFile, "text" | "size" | "binary" | "truncated">>;
}

export type OpenScript = (title: string | undefined, text: string) => boolean;

function reject(name: string, v: Exclude<SqlFileVerdict, "ok">): void {
  if (v === "type") toast.info(t("pane.query.file.type", { name }));
  else if (v === "large") toast.info(t("pane.query.file.large", { name, mb: SQL_FILE_MAX_BYTES / (1024 * 1024) }));
  else toast.info(t("pane.query.file.binary", { name }));
}

export async function openSqlSources(sources: readonly SqlSource[], open: OpenScript): Promise<void> {
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const pre = sqlFileVerdict({ name: s.name, size: s.size ?? 0 });
    if (pre !== "ok") {
      reject(s.name, pre);
      continue;
    }
    let file: Awaited<ReturnType<SqlSource["read"]>>;
    try {
      file = await s.read();
    } catch (e) {
      toast.error(t("pane.query.file.failed", { name: s.name, reason: e instanceof Error ? e.message : String(e) }));
      continue;
    }
    const v = sqlFileVerdict({ name: s.name, size: file.size, binary: file.binary, truncated: file.truncated });
    if (v !== "ok") {
      reject(s.name, v);
      continue;
    }
    if (!open(scriptTitleOf(s.name), file.text)) {
      toast.info(t("pane.query.file.full", { n: QUERY_SCRIPTS_MAX, count: sources.length - i }));
      return;
    }
  }
}

export function fromFile(f: File): SqlSource {
  return {
    name: f.name,
    size: f.size,
    read: async () => {
      const text = await f.text();
      // 경로 없는 OS 파일은 Rust 의 이진 판정(앞 8 KiB 의 NUL)을 지나지 않는다 — 같은 뜻으로 여기서 본다
      return { text, size: f.size, binary: text.slice(0, 8192).includes("\u0000"), truncated: false };
    },
  };
}

function fromPath(readText: (path: string) => Promise<TextFile>, path: string): SqlSource {
  return { name: fileBaseName(path), size: null, read: () => readText(path) };
}

/** 남의 창에서 온 원격 짐은 받지 않는다 — 원격 키의 세션 번호는 창마다 다르다(`fs-drag` 의 `fsDragActive`) */
export function dropSources(dt: DataTransfer | null): SqlSource[] {
  if (!dt) return [];
  if (dt.types.includes(FS_DRAG_TYPE)) {
    const drag = decodeFsDrag(dt.getData(FS_DRAG_TYPE));
    if (fsDragEmpty(drag)) return [];
    if (drag.backendKey !== LOCAL_KEY && fsDragActive() === null) {
      toast.info(t("pane.query.file.otherWindow"));
      return [];
    }
    const backend = backendFromKey(drag.backendKey);
    const readText = backend?.readText?.bind(backend);
    if (!readText) {
      toast.info(t("pane.query.file.otherWindow"));
      return [];
    }
    return drag.paths.map((p) => fromPath(readText, p));
  }
  return Array.from(dt.files ?? []).map(fromFile);
}

export const SQL_FILE_ACCEPT = SQL_FILE_EXTENSIONS.map((ext) => "." + ext).join(",");

/** 원격 갈래는 첫 `await` 앞에서 고르기 창을 연다 — 몸짓 사슬 */
export async function pickSqlSources(remoteWindow: boolean = isRemote): Promise<SqlSource[]> {
  if (remoteWindow) return (await pickDeviceFiles(SQL_FILE_ACCEPT, true)).map(fromFile);
  let picked: string | string[] | null = null;
  try {
    picked = await openDialog({ multiple: true, directory: false, filters: [{ name: "SQL", extensions: [...SQL_FILE_EXTENSIONS] }] });
  } catch (e) {
    console.error("[aynx] 열기 대화상자를 열지 못했습니다", e);
  }
  if (picked === null) return [];
  const paths = Array.isArray(picked) ? picked : [picked];
  const local = localBackend();
  const readText = local.readText!.bind(local);
  return paths.map((p) => fromPath(readText, p));
}

export interface SaveTextKind {
  filter: { name: string; ext: string };
  saved: Key;
  failed: Key;
}

export function deviceSaveMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case "csv":
      return "text/csv;charset=utf-8";
    case "json":
      return "application/json;charset=utf-8";
    case "sql":
      return "application/sql;charset=utf-8";
    default:
      return "text/plain;charset=utf-8";
  }
}

/**
 * 원격 창은 첫 `await` 앞에서 내려받기를 낸다 — 몸짓 사슬. 바이트는 메인 PC 창과 같다(둘 다 UTF-8 그대로 · 줄바꿈을 바꾸지 않는다 ·
 * CSV 의 BOM 은 `exportCsv` 가 글 맨 앞에 넣은 U+FEFF).
 */
export async function saveTextAs(defaultName: string, text: string, kind: SaveTextKind, remoteWindow: boolean = isRemote): Promise<void> {
  if (remoteWindow) {
    try {
      saveBlobToDevice(new Blob([text], { type: deviceSaveMime(kind.filter.ext) }), defaultName);
      toast.success(t("pane.query.file.savedDevice", { name: defaultName }));
    } catch (e) {
      toast.error(t(kind.failed, { reason: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }
  let path: string | null = null;
  try {
    path = await saveDialog({ defaultPath: defaultName, filters: [{ name: kind.filter.name, extensions: [kind.filter.ext] }] });
  } catch (e) {
    console.error("[aynx] 저장 대화상자를 열지 못했습니다", e);
  }
  if (path === null) return;
  try {
    await writeTextFile(path, text);
    toast.success(t(kind.saved, { path }));
  } catch (e) {
    toast.error(t(kind.failed, { reason: e instanceof Error ? e.message : String(e) }));
  }
}

export function saveSqlText(defaultName: string, text: string, remoteWindow: boolean = isRemote): Promise<void> {
  return saveTextAs(defaultName, text, { filter: { name: "SQL", ext: "sql" }, saved: "pane.query.file.saved", failed: "pane.query.file.saveFailed" }, remoteWindow);
}
