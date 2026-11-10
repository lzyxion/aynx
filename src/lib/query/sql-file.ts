/**
 * **쿼리 타일의 `.sql` 파일 열기 · 저장 규칙**(2026-11-10) — 순수. 읽기 · 쓰기 · 알림은 `query/sql-file-io.ts`.
 *
 * - 여는 길은 셋(끌어 놓기 — OS 파일 · 파일 타일 짐 / 타일 ⋯ [SQL 파일 열기…] · `Ctrl+O`)이고 모두 **새 스크립트 탭**이다. 실행하지 않는다.
 * - 받는 파일: 확장자 `.sql` · `.txt`(대소문자 무관) · 크기 `SQL_FILE_MAX_BYTES`(1 MiB) 이하 · 이진 · 잘린 읽기는 거절.
 * - 탭 이름 = 확장자 뺀 파일 이름(탭 제목 상한에서 자른다 · 비면 기본 이름).
 * - 저장은 늘 "다른 이름으로" — 탭은 파일을 붙잡지 않는다(경로를 탭 · 명세에 두지 않는다).
 */
import { QUERY_SCRIPT_TITLE_MAX } from "$lib/session";
import { FS_DRAG_TYPE } from "$lib/fs-drag";

/** 열 수 있는 파일 크기 상한(바이트) */
export const SQL_FILE_MAX_BYTES = 1024 * 1024;

/** 받는 확장자(점 없이 · 소문자) — 열기 대화상자의 필터도 이것 */
export const SQL_FILE_EXTENSIONS = ["sql", "txt"] as const;

/** 경로의 마지막 조각(`/` · `\` 둘 다) */
export function fileBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at < 0 ? trimmed : trimmed.slice(at + 1);
}

/** 받는 확장자인가(이름 또는 경로) */
export function isSqlFileName(name: string): boolean {
  const base = fileBaseName(name).toLowerCase();
  return SQL_FILE_EXTENSIONS.some((ext) => base.endsWith("." + ext) && base.length > ext.length + 1);
}

/** 탭 이름 — 확장자 뺀 파일 이름, 상한에서 자른다. 비면 `undefined`(기본 이름 "쿼리 {n}") */
export function scriptTitleOf(name: string): string | undefined {
  const base = fileBaseName(name);
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim().slice(0, QUERY_SCRIPT_TITLE_MAX).trim();
  return stem === "" ? undefined : stem;
}

/** 읽기 전/후 판정 — `ok` 가 아니면 그 파일만 거절(알림 문구가 갈린다) */
export type SqlFileVerdict = "ok" | "type" | "large" | "binary";

export function sqlFileVerdict(f: { name: string; size: number; binary?: boolean; truncated?: boolean }): SqlFileVerdict {
  if (!isSqlFileName(f.name)) return "type";
  if (f.size > SQL_FILE_MAX_BYTES || f.truncated === true) return "large";
  if (f.binary === true) return "binary";
  return "ok";
}

/**
 * 이 끌기를 쿼리 타일이 받는가 — `dragover` 에서는 종류만 보인다. OS 파일(`Files`) · 파일 타일 짐(`FS_DRAG_TYPE`)만 받고,
 * 앱의 다른 끌기(타일 · 탭 · 호스트 · 창 넘기기 · 스크립트 탭 순서 — 모두 `application/x-aynx-*`)가 하나라도 실려 있으면 받지 않는다
 * (내부 끌기에도 브라우저가 `Files` 를 끼워 넣는 경우가 있다 — `pane/drop-rules` 의 `dragKind` 머리말).
 */
export function sqlDropAccepts(types: readonly string[] | null | undefined): boolean {
  if (!types) return false;
  if (types.includes(FS_DRAG_TYPE)) return !types.some((x) => x.startsWith("application/x-aynx-") && x !== FS_DRAG_TYPE);
  if (types.some((x) => x.startsWith("application/x-aynx-"))) return false;
  return types.includes("Files");
}

/** 저장 대화상자의 기본 이름 — `<탭 이름>.sql`(Windows 가 받지 않는 글자는 `_`) */
export function sqlSaveName(title: string): string {
  const clean = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
  return (clean === "" ? "query" : clean) + ".sql";
}
