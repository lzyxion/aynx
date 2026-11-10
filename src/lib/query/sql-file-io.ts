/**
 * **쿼리 타일의 `.sql` 파일 열기 · 저장 — 읽기 · 쓰기 · 알림**(2026-11-10). 규칙은 순수 `query/sql-file.ts`.
 *
 * - 열기: 끌어 놓기(OS 파일 = 웹 표준 DnD 의 `File` — 앱 창은 `dragDropEnabled: false` 라 경로가 없다 · 파일 타일 짐 = 그 백엔드의 `readText`) ·
 *   열기 대화상자(로컬 `readText` = `local_read_text`). 파일마다 새 스크립트 탭 하나(`open` 이 `false` = 탭 상한 → 남은 파일은 알림 한 줄).
 *   실행하지 않는다.
 * - 저장: 늘 "다른 이름으로" — 저장 대화상자 → CSV 저장과 같은 `writeTextFile`. 탭은 그 경로를 기억하지 않는다.
 */
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { backendFromKey, localBackend, LOCAL_KEY, type TextFile } from "$lib/fs-backend";
import { decodeFsDrag, fsDragActive, fsDragEmpty, FS_DRAG_TYPE } from "$lib/fs-drag";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import { writeTextFile } from "$lib/scrollback";
import { toast } from "$lib/toast.svelte.js";
import { QUERY_SCRIPTS_MAX } from "$lib/session";
import { SQL_FILE_EXTENSIONS, SQL_FILE_MAX_BYTES, fileBaseName, scriptTitleOf, sqlFileVerdict, type SqlFileVerdict } from "./sql-file";

/** 열 파일 하나 — 이름 · (알면) 크기 · 읽기 */
export interface SqlSource {
  name: string;
  /** 읽기 전에 아는 크기(OS 파일) — 모르면 `null`(읽은 뒤 `TextFile.size` 로 판정) */
  size: number | null;
  read: () => Promise<Pick<TextFile, "text" | "size" | "binary" | "truncated">>;
}

/** 새 탭으로 연다 — `false` 면 탭 상한 */
export type OpenScript = (title: string | undefined, text: string) => boolean;

function reject(name: string, v: Exclude<SqlFileVerdict, "ok">): void {
  if (v === "type") toast.info(t("pane.query.file.type", { name }));
  else if (v === "large") toast.info(t("pane.query.file.large", { name, mb: SQL_FILE_MAX_BYTES / (1024 * 1024) }));
  else toast.info(t("pane.query.file.binary", { name }));
}

/** 파일들을 차례로 새 탭에 연다(마지막 연 탭이 고른 탭 — `open` 이 고른다) */
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

/** OS 파일(`File`) → 열 파일 */
function fromFile(f: File): SqlSource {
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

/** 경로 하나(그 백엔드) → 열 파일 */
function fromPath(readText: (path: string) => Promise<TextFile>, path: string): SqlSource {
  return { name: fileBaseName(path), size: null, read: () => readText(path) };
}

/**
 * 놓인 끌기 → 열 파일들. 파일 타일 짐이 먼저다(내부 종류가 진짜 — `pane/drop-rules` 의 `dragKind`). 남의 창에서 온 원격 짐은 받지 않는다
 * (원격 키의 세션 번호는 창마다 다르다 — `fs-drag` 의 `fsDragActive`).
 */
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

/** 열기 대화상자 → 열 파일들(취소 = 빈 목록) */
export async function pickSqlSources(): Promise<SqlSource[]> {
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

/** 저장 한 벌의 모양 — 대화상자 필터(이름 · 확장자 하나)와 알림 문구 둘(`{path}` · `{reason}`) */
export interface SaveTextKind {
  filter: { name: string; ext: string };
  saved: Key;
  failed: Key;
}

/**
 * 글 하나를 "다른 이름으로" 저장 — 저장 대화상자 → `writeTextFile` → 알림(취소면 조용히). `.sql` 저장과 결과 내보내기(CSV · JSON —
 * `ResultGrid`)가 함께 쓴다. 경로는 기억하지 않는다.
 */
export async function saveTextAs(defaultName: string, text: string, kind: SaveTextKind): Promise<void> {
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

/** 스크립트 탭의 글을 `.sql` 로 — 늘 다른 이름으로(경로는 기억하지 않는다) */
export function saveSqlText(defaultName: string, text: string): Promise<void> {
  return saveTextAs(defaultName, text, { filter: { name: "SQL", ext: "sql" }, saved: "pane.query.file.saved", failed: "pane.query.file.saveFailed" });
}
