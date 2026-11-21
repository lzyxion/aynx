/** 저장은 늘 "다른 이름으로" — 탭은 파일을 붙잡지 않는다(경로를 탭 · 명세에 두지 않는다) */
import { QUERY_SCRIPT_TITLE_MAX } from "$lib/session";
import { FS_DRAG_TYPE } from "$lib/fs-drag";

export const SQL_FILE_MAX_BYTES = 1024 * 1024;

export const SQL_FILE_EXTENSIONS = ["sql", "txt"] as const;

export function fileBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}

export function isSqlFileName(name: string): boolean {
  const base = fileBaseName(name).toLowerCase();
  return SQL_FILE_EXTENSIONS.some((ext) => base.endsWith("." + ext) && base.length > ext.length + 1);
}

export function scriptTitleOf(name: string): string | undefined {
  const base = fileBaseName(name);
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim().slice(0, QUERY_SCRIPT_TITLE_MAX).trim();
  return stem === "" ? undefined : stem;
}

export type SqlFileVerdict = "ok" | "type" | "large" | "binary";

export function sqlFileVerdict(f: { name: string; size: number; binary?: boolean; truncated?: boolean }): SqlFileVerdict {
  if (!isSqlFileName(f.name)) return "type";
  if (f.size > SQL_FILE_MAX_BYTES || f.truncated === true) return "large";
  if (f.binary === true) return "binary";
  return "ok";
}

/**
 * `dragover` 에서는 종류만 보인다. 내부 끌기에도 브라우저가 `Files` 를 끼워 넣는 경우가 있어, 앱의 다른 끌기(`application/x-aynx-*`)가
 * 하나라도 실려 있으면 받지 않는다(`pane/drop-rules` 의 `dragKind` 머리말).
 */
export function sqlDropAccepts(types: readonly string[] | null | undefined): boolean {
  if (!types) return false;
  if (types.includes(FS_DRAG_TYPE)) return !types.some((x) => x.startsWith("application/x-aynx-") && x !== FS_DRAG_TYPE);
  if (types.some((x) => x.startsWith("application/x-aynx-"))) return false;
  return types.includes("Files");
}

export function sqlSaveName(title: string): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
  return (clean === "" ? "query" : clean) + ".sql";
}
