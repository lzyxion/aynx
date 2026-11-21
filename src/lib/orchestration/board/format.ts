/** 끝 두 마디(`a/b`) — 전체 경로는 title 로 */
export function shortPath(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

export function clock(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
