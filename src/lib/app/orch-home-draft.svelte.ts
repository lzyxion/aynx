/**
 * **오케스트레이션 홈 입력 칸의 초안**(2026-10-30 오케스트레이션 탭 ④) — 창 안 화면 상태(저장 · 로그 없음). 시작 흐름(`app/orch-start`)과 여는 길
 * (`app/orchestration` 의 "이 스튜디오로 새 앨범")이 함께 쓰려고 따로 둔 한 칸이다(두 모듈이 서로를 부르지 않게).
 *
 * - `text` 는 처음 보일 때 머리말로 채운다(`orch-start` `primeHomeDraft` — 0-3 Q2: 보이게 · 지울 수 있게).
 * - `studio` · `cliId` · `model` · `effort` = 고른 스튜디오(맡긴 저장소 경로) · 프로듀서 CLI id · 모델 · 강도(빈 값 = CLI 기본 — 2단계 단계 3 의
 *   프로듀서 채팅 잎 "새 앨범" 칸).
 * - `focusN` 이 `focusDone` 보다 앞서면 홈이 입력 칸에 포커스를 주고 `focusDone` 을 맞춘다(스튜디오 카드 ▶ · 프로젝트 메뉴 — 요청 하나는
 *   한 번만 · 새로 뜨는 홈도 받는다).
 */
export const homeDraft = $state({ text: "", primed: false, cliId: "", model: "", effort: "", studio: "", focusN: 0, focusDone: 0 });

/** 그 스튜디오를 고르고 홈 입력 칸에 포커스를 청한다(여는 것은 부르는 쪽) */
export function selectHomeStudio(path: string): void {
  homeDraft.studio = path;
  homeDraft.focusN += 1;
}
