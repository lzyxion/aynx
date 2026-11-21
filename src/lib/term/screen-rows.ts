/**
 * 화면 행 → 글 줄. `isWrapped` 로 **잇지 않는다** — Claude 는 칸 끝까지 채운 행(되울림 · 구분선) 다음 행에 `isWrapped` 가 서서,
 * 이으면 대화 면의 판정(`pane/flip-model-ack.ts`)이 깨진다. Codex 의 접힘은 판정 쪽에서 그 문구만 잇는다(`latestAck`).
 */
export interface ScreenRow {
  /** 행 글(`translateToString(true)`) */
  text: string;
  /** 쓰지 않는다(위 머리말) */
  wrapped: boolean;
}

export function screenRowsText(rows: readonly ScreenRow[]): string[] {
  return rows.map((r) => r.text);
}
