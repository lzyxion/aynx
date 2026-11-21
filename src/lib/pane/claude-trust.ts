/**
 * Claude Code 의 폴더 신뢰 질문을 화면 글자로 알아본다 — 답할 때까지 훅이 하나도 오지 않아 화면 말고는 알 길이 없다
 * (docs/log/2026-11-04-trust-bubble.md). 세 줄이 줄 전체로 맞아야 질문이다 — 본문의 인용은 줄 전체가 되지 않는다.
 * 2.1.318 실측 화면: `Quick safety check: …` · `❯ No, exit` · `Yes, I trust this folder` · `Enter to confirm · Esc to cancel`.
 * 알고 받은 한계: CLI 가 문구를 바꾸거나 칸이 좁아 줄이 접히면(약 34열 아래) 알아보지 못한다.
 */

const MARK = /^[❯›>]\s*/;
const YES = /^yes, (i trust this folder|proceed)$/i;
const NO = /^no, exit$/i;
const CONFIRM = /^enter to confirm\b/i;

function bare(line: string): string {
  return line.trim().replace(MARK, "");
}

export function isClaudeTrustPrompt(lines: readonly string[]): boolean {
  const rows = lines.map(bare).filter((l) => l !== "");
  for (let i = 0; i + 2 < rows.length; i++) {
    const pair = (YES.test(rows[i]) && NO.test(rows[i + 1])) || (NO.test(rows[i]) && YES.test(rows[i + 1]));
    if (pair && CONFIRM.test(rows[i + 2])) return true;
  }
  return false;
}
