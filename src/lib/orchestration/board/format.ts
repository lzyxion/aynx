/**
 * 보드 조각들이 함께 쓰는 **표시 글자 도우미**(순수 — 룬 · DOM 없음). `RunBoard.svelte` 에서 그대로 옮겼다.
 */

/** 경로의 끝 두 마디(`a/b`) — 칸이 좁아 전체 경로는 title 로 */
export function shortPath(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

/** 시각 → `HH:MM:SS`(로컬) */
export function clock(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
