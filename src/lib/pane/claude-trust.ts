/**
 * **Claude Code 의 폴더 신뢰 질문을 화면에서 알아보는 판정**(2026-11-04 · 순수 — docs/log/2026-11-04-trust-bubble.md).
 *
 * 새 폴더에서 `claude` 를 띄우면 CLI 가 터미널에 묻고, 답할 때까지 훅이 **하나도** 오지 않는다(`SessionStart` 도 — 2.1.318 실측). 그래서 대화 면은 빈 채로 멈춰 있고,
 * 앱이 알 길은 화면 글자뿐이다. 실측한 화면(2.1.318 · 100열):
 *
 * ```text
 * Quick safety check: Is this a project you created or one you trust? …
 * ❯ No, exit
 *   Yes, I trust this folder
 * Enter to confirm · Esc to cancel
 * ```
 *
 * **세 줄이 줄 전체로 맞아야** 질문이다 — 대화 본문이 이 글자를 문장 안에서 인용해도 줄 전체가 되지 않고, 이 판정은 그 CLI 의 훅을 받기 전에만 돈다(`AiFlip`).
 * 고른 표시(`❯`)는 어느 줄에든 올 수 있다. 예전 판의 "Yes, proceed" 도 받는다.
 *
 * **한계**: CLI 가 문구를 바꾸거나 칸이 아주 좁아 줄이 접히면(약 34열 아래) 알아보지 못한다 — 그때는 예전처럼 빈 대화 면이다.
 */

const MARK = /^[❯›>]\s*/;
const YES = /^yes, (i trust this folder|proceed)$/i;
const NO = /^no, exit$/i;
const CONFIRM = /^enter to confirm\b/i;

function bare(line: string): string {
  return line.trim().replace(MARK, "");
}

/** 지금 화면 줄들이 폴더 신뢰 질문인가 — 위 → 아래. "예" · "아니요" 는 이웃 줄이고 그 아래에 확인 안내가 있어야 한다 */
export function isClaudeTrustPrompt(lines: readonly string[]): boolean {
  const rows = lines.map(bare).filter((l) => l !== "");
  for (let i = 0; i + 2 < rows.length; i++) {
    const pair = (YES.test(rows[i]) && NO.test(rows[i + 1])) || (NO.test(rows[i]) && YES.test(rows[i + 1]));
    if (pair && CONFIRM.test(rows[i + 2])) return true;
  }
  return false;
}
