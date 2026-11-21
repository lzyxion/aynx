// 배럴 — 재수출만 둔다. 자식은 이 파일을 부르지 않고 형제를 직접 부른다. 머리말에 "내부 전용" 인 자식은 내보내지 않는다.
// 하니스는 경로 `lib/shell-integration.ts` 로 이 파일을 부른다 — 옮기지 않는다.
/**
 * OSC 133 명령 경계 — 스니펫을 심는 쪽은 Rust `shell_integration.rs` (docs/log/2026-09-02-osc133.md).
 *
 * ```text
 *   OSC 133 ; A   프롬프트 시작 — 새 레코드 · 명령 점프의 착지점
 *   OSC 133 ; B   프롬프트 끝 — 명령문은 여기부터(프롬프트 제외)
 *   OSC 133 ; C   명령 실행 시작 — 상태 "running"
 *   OSC 133 ; D;n 명령 종료 — n===0 ? "ok" : "fail"
 * ```
 *
 * 우리 마커는 출처 태그(`A;aynx=1` · `D;1;aynx=1`)를 단다 — 처음 본 `A` 의 태그로 출처를 고정하고 다른 태그를 버린다
 * (남의 셸 통합과 `A` 가 둘이 되는 것을 막는 마지막 관문 · docs/log/2026-09-08-block-history-design.md §5 ②).
 * 자가 회복은 없다 — 고정이 잘못 걸린 경우를 위한 카운터(`diagnostics`)만 둔다.
 * 레코드는 xterm 버퍼 좌표라 세션이 아니라 터미널에 붙는다 — 재연결해도 이어진다.
 * OSC 133 이 안 오는 세션은 상태가 늘 `null` 이다 — 없는 정보를 지어내지 않는다.
 */

export * from "./shell-integration/types";
export * from "./shell-integration/registry";
export * from "./shell-integration/cwd";
export * from "./shell-integration/marker";
export * from "./shell-integration/attach";
export * from "./shell-integration/badge";
