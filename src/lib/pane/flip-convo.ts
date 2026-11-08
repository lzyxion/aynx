/**
 * **AI 타일 대화 면의 작은 판정 셋**(2026-11-02 사용자 실기 피드백 — 순수 층 · `pane/AiFlip.svelte` 가 부른다).
 *
 * ## 중지 단추
 *
 * 대화 면 입력 칸 옆의 [중지] = 그 타일 TUI 에 **Esc 키 하나**(Claude Code · Codex 모두 Esc 가 지금 턴을 끊는다 —
 * `docs/log/2026-11-01-tile-permission-hook-probe.md` 의 실측 표). 그 바이트는 **사람이 누른 단추가 만드는 고정 키**이고 AI 문자열이
 * 아니다 — 사람 키와 같은 문(`TermActions.sendEscape` → `Terminal` 의 `writeInput(…, "keyboard")`)으로만 나간다. 그래서
 * "AI 문자열→PTY 길은 없다" 불변식과 부딪치지 않는다.
 *
 * - 보일 때: 에이전트가 **일하는 중**(훅 신호 상태 `running`)일 때만. 권한을 묻는 중(`permission`)이거나 권한 카드가 서 있으면 숨긴다 —
 *   카드의 [거절] · [터미널에서 답하기], 칸 자리의 "터미널에서 답하기" 가 이미 그 자리의 답이다(Claude 의 권한 창에서 Esc 는 거절이다 —
 *   같은 일을 두 단추가 하게 두지 않는다).
 * - 연타 방지: Claude 는 Esc 두 번이 다른 뜻(되감기 메뉴)이 될 수 있어 **한 번만** 보내고 [`STOP_GAP_MS`] 안의 다시 누름은 버린다.
 *
 * ## "대화가 아직 없음"
 *
 * Claude 의 `SessionStart` 훅(10판)은 CLI 가 뜨자마자 대화 id 를 실어 타일에 잇지만, 그 대화 파일은 **첫 사람 말이 들어갈 때** 생긴다.
 * 그 사이 기록 받기는 "그 대화를 찾지 못했습니다" 로 실패한다 — 정상 상황이라 오류가 아니라 빈 면이어야 한다. 기록 쪽 명령은 이유
 * 코드를 싣지 않으므로(문구 비교 금지 — docs/conventions.md) **시점**으로 가른다: 그 대화의 쪽을 한 번도 받지 못했고 아직 턴 하나가
 * 끝나지 않았으면 "아직 없음"(빈 면 · 따라가기는 계속 다시 본다). 턴이 끝났는데도 못 받으면 그때는 진짜 오류로 보인다.
 *
 * ## 폰의 첫 화면
 *
 * 폰 배치(`mobileLayout` — 설정 화면이 닿는 범위와 같다)에서는 AI 타일을 **처음 볼 때** 대화 면으로 연다(2026-11-04 · 이 기기 값 `aiFacePref`).
 * CLI 한 번에 한 번뿐이라 사람이 터미널로 돌리면 그대로이고, 숨은 탭의 타일은 넘기지 않는다(면은 서버의 카드 판정에 들어간다 — `AiFlip` 의 면 규칙).
 */

/** 폰에서 이 타일을 지금 대화 면으로 열까 — 폰 배치 · 첫 화면이 대화 · 넘길 수 있고 · 보이고 · 이번 CLI 에서 아직 안 열었다 */
export function phoneOpensConvo(s: {
  layout: boolean;
  pref: "convo" | "term";
  flippable: boolean;
  shown: boolean;
  opened: boolean;
}): boolean {
  return s.layout && s.pref === "convo" && s.flippable && s.shown && !s.opened;
}

/** 중지 단추를 다시 받기까지의 틈 — Claude 의 Esc 두 번(되감기 메뉴)이 되지 않게 */
export const STOP_GAP_MS = 1000;

/** 대화 면에 중지 단추를 세우나 — 에이전트가 일하는 중이고 권한을 묻고 있지 않다 */
export function stopShown(s: { status: string | null; cards: number }): boolean {
  return s.status === "running" && s.cards === 0;
}

/** 지금 눌린 중지를 보낼까 — 마지막으로 보낸 뒤 [`STOP_GAP_MS`] 가 지났다(처음이면 참) */
export function stopReady(lastAt: number | null, now: number, gap: number = STOP_GAP_MS): boolean {
  return lastAt === null || now - lastAt >= gap;
}

/**
 * 기록 받기 실패를 "대화가 아직 없음"(빈 면)으로 볼까 — 그 대화의 쪽을 한 번도 받지 못했고(`loaded` 거짓) 턴 하나가 끝나지 않았다
 * (`turnEnded` 거짓). 원격 세션이 사라진 것(`gone`)은 늘 오류 쪽이다.
 */
export function convoNotYet(s: { loaded: boolean; turnEnded: boolean; gone?: boolean }): boolean {
  return !s.gone && !s.loaded && !s.turnEnded;
}

/** 원격의 새 대화 — 목록 캐시를 다시 읽을 틈(아직 파일이 없는 동안 따라가기마다 SSH 로 목록을 읽지 않게) */
export const REMOTE_REFRESH_RETRY_MS = 15_000;

/**
 * 원격 대화를 못 찾았을 때 목록 캐시를 다시 읽을까 — 처음이면 참. 그 뒤로는 쪽을 아직 한 번도 받지 못한 대화(파일이 곧 생길 수 있다)만
 * [`REMOTE_REFRESH_RETRY_MS`] 마다 한 번.
 */
export function mayRefreshRemote(lastAt: number | undefined, loaded: boolean, now: number): boolean {
  if (lastAt === undefined) return true;
  return !loaded && now - lastAt >= REMOTE_REFRESH_RETRY_MS;
}
