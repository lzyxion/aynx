/**
 * 긴 명령문의 발췌 — 줄 수와 글자 수 두 상한 중 먼저 걸리는 쪽이 이긴다(개행 없는 13 KB 한 줄 · 짧은 30줄 둘 다 막으려고).
 * `chars` · `lines` 는 잘린 것이 아니라 원본 전체의 크기다 — 화면이 무엇을 펴는지 먼저 말한다.
 */

export const CMD_PREVIEW_MAX_LINES = 3;
export const CMD_PREVIEW_MAX_CHARS = 240;

const ELLIPSIS = "…";

export interface CommandPreviewOptions {
  maxLines?: number;
  maxChars?: number;
}

export interface CommandPreview {
  text: string;
  truncated: boolean;
  lines: number;
  /** 앞뒤 공백을 턴 뒤 */
  chars: number;
}

export function commandPreview(
  command: string,
  options: CommandPreviewOptions = {},
): CommandPreview {
  const maxLines = Math.max(1, Math.floor(options.maxLines ?? CMD_PREVIEW_MAX_LINES));
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? CMD_PREVIEW_MAX_CHARS));

  const full = command.trim();
  if (full === "") return { text: "", truncated: false, lines: 0, chars: 0 };

  const allLines = full.split("\n");
  let truncated = allLines.length > maxLines;
  let text = allLines.slice(0, maxLines).join("\n");
  if (text.length > maxChars) {
    truncated = true;
    text = text.slice(0, maxChars);
  }
  if (truncated) text = text.replace(/\s+$/, "") + ELLIPSIS;

  return { text, truncated, lines: allLines.length, chars: full.length };
}
