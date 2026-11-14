/**
 * **화면 행 → 글 줄**(`TermActions.screenLines` 의 순수 몸 — 2026-11-14).
 *
 * 행마다 한 줄이다 — xterm 의 `isWrapped`(이 행이 앞 행의 이어짐)로 **잇지 않는다**. 실측(Claude Code 2.1.325 · 앱과 같은 ConPTY 길 · `windowsPty`):
 * Claude 는 되울림 행(`❯ /effort high` + 칸 끝까지 빈칸)과 구분선(`▔▔▔` · `───`)을 칸 끝까지 채워 그리고, 그 다음 행(`⎿ Set effort level …` ·
 * 입력 줄 `❯`)에 `isWrapped` 가 선다. 그것을 이으면 되울림 · 확인 · "Switch model?" 머리가 한 줄로 붙어 대화 면의 판정(`pane/flip-model-ack.ts`)이
 * 모두 깨졌다(0f17d616 — 접힌 Codex 확인 문구를 잡으려고 이었던 것). Codex 의 접힘은 판정 쪽에서 그 문구만 잇는다(`latestAck`).
 */
export interface ScreenRow {
  /** 행 글(`translateToString(true)`) */
  text: string;
  /** 앞 행의 이어짐(xterm `isWrapped`) — 쓰지 않는다(위 머리말) */
  wrapped: boolean;
}

export function screenRowsText(rows: readonly ScreenRow[]): string[] {
  return rows.map((r) => r.text);
}
