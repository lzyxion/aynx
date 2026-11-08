/**
 * **오케스트레이션 — 프런트의 순수 층**(2026-10-15 · 2b, docs/log/2026-10-14-orchestration-design.md D · E-1).
 *
 * 세션 서버의 Run 표(`src-tauri/src/orchestration/`)를 사람이 감독하는 화면(보드 타일)이 쓰는 자료형과 판정이다.
 * 룬이 없는 평범한 `.ts` 라 vitest 가 그대로 돈다 — 문구는 `tr` 를 인자로 받는다.
 *
 * - 자료형은 서버 `view()` · `summary()` 의 JSON 모양(camelCase) 그대로다. **토큰 칸은 없다**(서버가 싣지 않는다).
 * - (3차 6단계) 사람의 Run 시작 대화의 검증(`validateStart`)은 걷었다 — Run 은 AI 타일의 `start_run` 으로만 열린다.
 * - 보드의 상태 말([`runStatePhrase`] — 설계 D 문구) · 이벤트 seq 비교([`changeAction`] — 쓸데없는 다시 읽기를 막는다) ·
 *   이유 코드 표([`ORCH_REASONS`] · [`orchReasonText`]).
 * - 서버 낱말 → 문구는 **[`keyText`] 하나**로 — 표에 없는 값은 날 낱말로 보인다(예외 없음 · 3b). 표가 서버 enum 전부를 덮는지는
 *   `model.test.ts` 가 Rust serde 이름 목록으로 지킨다.
 * - (3b) 헤드리스 작업자 보기 — Attempt 술어([`turnMayLive`] · [`attemptClosed`] · [`attemptOpen`]) · 작업자 줄([`workerLine`] ·
 *   [`turnRows`]) · 경고 띠([`attemptBand`]) · 맡기기 띠([`delegationBand`]) · 거친 역할([`roleSteps`]) · 판정 이력([`judgmentRows`]) ·
 *   수락 규칙 충족([`readinessLine`]) · 면제([`waiverNoteNeeded`] · [`waiverTexts`]) · 되돌림([`reworkText`]).
 * - (2026-10-26) 몸은 `model/` 폴더로 나뉘었다 — `types`(서버 JSON 모양) · `text`(`Tr` · `keyText` · 시간) · `run` · `worker` ·
 *   `review` · `integration` · `cleanup` · `events` · `reasons`. 이 파일은 재수출만 하는 배럴이다(자식은 형제를 직접 부른다).
 */

export * from "./model/text";
export * from "./model/types";
export * from "./model/cleanup";
export * from "./model/worker";
export * from "./model/run";
export * from "./model/review";
export * from "./model/integration";
export * from "./model/merge";
export * from "./model/events";
export * from "./model/reasons";
export * from "./model/album";
export * from "./model/lyrics";
export * from "./model/library";
export * from "./model/pulse";
export * from "./model/producer";
export * from "./model/status-icon";
export * from "./model/track-player";
