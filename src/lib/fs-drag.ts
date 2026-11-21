/**
 * 파일 타일이 끌고 다니는 짐 — 출처(`backendKey`)가 함께 실린다: 그것이 드래그의 뜻(이동 · 업로드 · 다운로드 · 거절)을 정한다.
 * 경로만 실으면 받는 쪽이 `C:\a` 를 원격 경로로 읽는 사고가 난다.
 */

/** 앱 안에서만 뜻이 있다 (밖에는 `text/plain` 을 함께 싣는다) */
export const FS_DRAG_TYPE = "application/x-aynx-files";

export interface FsDrag {
  /** [`FsBackend.key`] — `"local"` · `"ssh:12"` */
  backendKey: string;
  paths: string[];
}

export function encodeFsDrag(drag: FsDrag): string {
  return JSON.stringify(drag);
}

/** 모양이 어긋나면 빈 짐이다 — 던지면 드롭 핸들러 한가운데서 드래그가 반쯤 처리된 채로 멈춘다 */
export function decodeFsDrag(raw: string): FsDrag {
  const empty: FsDrag = { backendKey: "", paths: [] };
  if (raw === "") return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const record = value as Record<string, unknown>;
    const key = record.backendKey;
    const paths = record.paths;
    if (typeof key !== "string" || !Array.isArray(paths)) return empty;
    return { backendKey: key, paths: paths.filter((p): p is string => typeof p === "string") };
  } catch {
    return empty;
  }
}

export function fsDragEmpty(drag: FsDrag): boolean {
  return drag.backendKey === "" || drag.paths.length === 0;
}

/**
 * 이 창에서 시작한 드래그의 짐 — 남의 창에서 온 드래그에서는 언제나 `null`.
 * 세션 번호는 창 안의 카운터라 창 A 의 `ssh:2` 가 창 B 에서는 다른 서버다 — 받는 쪽은 이 값 없이 온 원격 짐을 거절한다. 로컬은 창을 넘어도 같은 뜻이다.
 */
let activeDrag: FsDrag | null = null;

export function setFsDragActive(drag: FsDrag | null): void {
  activeDrag = drag;
}

export function fsDragActive(): FsDrag | null {
  return activeDrag;
}

/**
 * 놓는 터미널의 셸을 묻지 않는다(알 수 없다) — 경로 자신의 문법을 따른다.
 * 윈도우 경로(`\` 포함)는 `"…"` — `"` 는 윈도우 파일명에 못 쓰는 글자라 cmd · PowerShell · bash 셋 다 리터럴로 읽는다.
 */
export function shellQuote(path: string): string {
  if (path === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path;
  if (path.includes("\\")) return `"${path}"`;
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

export function shellQuoteAll(paths: readonly string[]): string {
  return paths.map(shellQuote).join(" ");
}
