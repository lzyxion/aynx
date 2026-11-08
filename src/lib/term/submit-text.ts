/**
 * **대화 면 입력 칸의 보내기 계획**(2026-10-17 — `pane/FlipComposer.svelte` → `TermActions.submitText`). 사람이 그 타일 터미널에
 * 친 것과 같은 길로 보낸다: 한 줄은 **키보드**(출처 `keyboard` — 글자를 친 것과 같다), 여러 줄은 **붙여넣기**(출처 `paste` —
 * `term.paste` 가 괄호 붙여넣기 모드면 `ESC[200~ … ESC[201~` 로 감싸고 줄바꿈을 `\r` 로 바꾼다), 그 뒤 Enter 키 하나(`\r`).
 * 새 쓰기 길이 아니다 — 모바일 입력 칸(`sendText`)과 같은 문이다.
 *
 * 줄바꿈은 `\n` 으로 고르고 끝의 빈 줄 · 공백은 걷는다(끝의 줄바꿈이 붙여넣기 안에서 빈 줄로 들어가지 않게). 글이 비면 `null`.
 */

/**
 * 글과 Enter 사이의 틈(ms) — 10-20 실측: Codex 는 글 바로 뒤의 Enter 를 **보내기가 아니라 줄바꿈**으로 받는다. Codex 의 입력 칸은
 * 짧은 사이에 몰려 온 글자를 붙여넣기로 보고(paste burst) 그 끝 바로 뒤(약 120ms 안)의 Enter 를 줄바꿈으로 바꾼다 — 사람이 친
 * 속도로는 일어나지 않는다. 그 창보다 길게 쉬고 Enter 를 보낸다(Claude Code 는 틈과 상관없이 보낸다).
 */
export const SUBMIT_ENTER_DELAY_MS = 200;

/**
 * 첨부 붙여넣기 하나 뒤의 틈(ms) — 2026-10-24 실기: Codex(Windows)는 붙여넣기를 빠른 키 묶음으로 알아보고 묶음이 쉬어야 그 글을 경로로
 * 보고 그림으로 바꾼다. 다음 경로 · 글을 곧바로 이어 넣으면 한 덩어리 글이 된다 — Enter 틈보다 넉넉히 쉰다.
 */
export const SUBMIT_ATTACH_GAP_MS = 400;

export interface SubmitPlan {
  mode: "keyboard" | "paste";
  text: string;
}

export function submitPlan(raw: string): SubmitPlan | null {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\s+$/u, "");
  if (text.trim() === "") return null;
  return { mode: text.includes("\n") ? "paste" : "keyboard", text };
}
