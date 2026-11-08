/**
 * **mermaid 블록의 순수 규칙** — 그리기(`MermaidView.svelte`)와 떼어 시험한다. mermaid 자체는 여기서 부르지 않는다.
 */

/** 펜스 언어가 mermaid 인가 — 대소문자와 앞뒤 공백은 가리지 않는다 */
export function isMermaidLang(lang: string | null | undefined): boolean {
  return (lang ?? "").trim().toLowerCase() === "mermaid";
}

/** 오류 한 줄의 최대 글자 수 — 넘으면 `…` 로 자른다 */
export const ERROR_LINE_MAX = 160;

/**
 * 오류 → 한 줄. 메시지의 첫 비지 않은 줄(mermaid 문법 오류는 "Parse error on line 2:" 뒤에 원문 조각·화살표가
 * 여러 줄 붙는다 — 원문은 바로 아래 코드 블록에 있으니 첫 줄이면 된다). 메시지가 없으면 빈 글자.
 */
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
