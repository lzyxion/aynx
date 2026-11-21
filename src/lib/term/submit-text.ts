/**
 * 대화 면 입력 칸의 보내기 계획 — 새 쓰기 길이 아니다(모바일 `sendText` 와 같은 문). 한 줄은 `keyboard`, 여러 줄은 `paste`, 뒤에 Enter.
 */

/**
 * 글과 Enter 사이의 틈(ms) — Codex 는 몰려 온 글자를 붙여넣기로 보고 그 끝 약 120ms 안의 Enter 를 줄바꿈으로 바꾼다.
 * Rust `server/messenger_bridge.rs` 의 값과 같다.
 */
export const SUBMIT_ENTER_DELAY_MS = 200;

/** 첨부 붙여넣기 하나 뒤의 틈(ms) — Codex(Windows)는 묶음이 쉬어야 그 글을 경로로 보고 그림으로 바꾼다. 곧바로 이으면 한 덩어리 글이 된다. */
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
