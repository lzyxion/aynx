export function isMermaidLang(lang: string | null | undefined): boolean {
  return (lang ?? "").trim().toLowerCase() === "mermaid";
}

export const ERROR_LINE_MAX = 160;

/** 첫 비지 않은 줄만 — 원문 조각은 바로 아래 코드 블록에 있다 */
export function errorFirstLine(e: unknown): string {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
          ? (e as { message: string }).message
          : "";
  const line = msg.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length > ERROR_LINE_MAX ? `${line.slice(0, ERROR_LINE_MAX - 1)}…` : line;
}
