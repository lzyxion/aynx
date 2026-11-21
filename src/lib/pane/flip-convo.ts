/**
 * AI 타일 대화 면의 작은 판정 셋.
 * [중지] = 그 타일 TUI 에 Esc 하나 — 사람이 누른 단추의 고정 키이고 사람 키와 같은 문(`TermActions.sendEscape` → `writeInput(…, "keyboard")`)으로만
 * 나간다. 그래서 "AI 문자열→PTY 길은 없다" 와 부딪치지 않는다.
 */

/** 이번 CLI 에서 한 번뿐이다 — 사람이 터미널로 돌리면 그대로 */
export function phoneOpensConvo(s: {
  layout: boolean;
  pref: "convo" | "term";
  flippable: boolean;
  shown: boolean;
  opened: boolean;
}): boolean {
  return s.layout && s.pref === "convo" && s.flippable && s.shown && !s.opened;
}

/** Claude 의 Esc 두 번은 다른 뜻(되감기 메뉴)이라 한 번만 보낸다 */
export const STOP_GAP_MS = 1000;

/** 권한 카드가 서 있으면 숨긴다 — Claude 의 권한 창에서 Esc 는 거절이라 같은 일을 두 단추가 하게 두지 않는다 */
export function stopShown(s: { status: string | null; cards: number }): boolean {
  return s.status === "running" && s.cards === 0;
}

export function stopReady(lastAt: number | null, now: number, gap: number = STOP_GAP_MS): boolean {
  return lastAt === null || now - lastAt >= gap;
}

/**
 * 대화 파일은 첫 사람 말이 들어갈 때 생겨 그 전의 기록 받기 실패는 정상이다. 명령이 이유 코드를 싣지 않아(문구 비교 금지)
 * 시점으로 가른다 — 한 번도 못 받았고 턴이 끝나지 않았으면 "아직 없음".
 */
export function convoNotYet(s: { loaded: boolean; turnEnded: boolean; gone?: boolean }): boolean {
  return !s.gone && !s.loaded && !s.turnEnded;
}

/** 아직 파일이 없는 동안 따라가기마다 SSH 로 목록을 읽지 않게 */
export const REMOTE_REFRESH_RETRY_MS = 15_000;

export function mayRefreshRemote(lastAt: number | undefined, loaded: boolean, now: number): boolean {
  if (lastAt === undefined) return true;
  return !loaded && now - lastAt >= REMOTE_REFRESH_RETRY_MS;
}
