// ---------------------------------------------------------------------------
// **배럴** — `$lib/shell-integration` 의 공개 표면. 몸은 `shell-integration/` 자식들에 있다(docs/modules-frontend.md).
//
// 규칙: 자식은 이 파일(`../shell-integration` · `$lib/shell-integration`)을 **절대 부르지 않고** 형제를 직접 부른다.
// 여기에는 재수출만 둔다 — 코드를 쓰지 않는다. 머리말에 "내부 전용" 이라 적힌 자식은 내보내지 않는다
// (`state` · `records` · `buffer-read` · `decorations` · `band` · `erase` · `jump` · `record-text` · `block-lines` ·
// `osc133` · `cwd-handlers`). 하니스는 경로 `lib/shell-integration.ts` 로 이 파일을 부른다.
// ---------------------------------------------------------------------------
/**
 * OSC 133 명령 경계 — 마커·상태 기계와 그것을 먹고 사는 소비 기능들.
 * (스니펫을 서버에 심는 쪽은 `src-tauri/src/shell_integration.rs` · docs/log/2026-09-02-osc133.md)
 *
 * 원격 셸이 프롬프트·명령·종료 코드를 이스케이프로 알려 주면, 여기서 그 지점마다
 * xterm 마커를 하나씩 박아 **명령 레코드**를 만든다. 마커는 버퍼가 스크롤해도 자기 줄을
 * 따라가므로, 레코드만 들고 있으면 나중에 "그 명령의 출력" 을 정확히 되짚을 수 있다.
 *
 * ```text
 *   OSC 133 ; A   프롬프트 시작  → 새 레코드 (promptMarker)   ← 명령 점프의 착지점
 *   OSC 133 ; B   프롬프트 끝    → bMarker + 열  ← **명령문은 여기부터** (프롬프트 제외)
 *   OSC 133 ; C   명령 실행 시작 → cmdMarker  · 상태 "running" · 프롬프트 줄에 파란 상태 띠
 *   OSC 133 ; D;n 명령 종료      → outMarker  · 상태 n===0 ? "ok" : "fail"
 *                                  프롬프트 줄 띠를 회색(성공)/빨강(실패)으로 교체
 * ```
 *
 * ## payload 는 **필드**다 (`;` 분해) — 그리고 출처가 고정된다
 *
 * 우리 스니펫은 마커마다 태그를 붙인다 (`A;aynx=1` · `D;1;aynx=1`). 이 터미널은 **처음 본
 * `A` 의 태그로 소스를 고정**하고 다른 태그의 마커를 버린다 — 남의 셸 통합이 이미 서 있는
 * 셸에서 `A` 가 둘이 되어 블록이 갈라지는 것을 막는 마지막 관문이다
 * ([`parseMarker`] · docs/log/2026-09-08-block-history-design.md §5 ②).
 * **자가 회복은 없다** — 고정이 잘못 걸린 경우를 위한 카운터만 둔다
 * ([`ShellIntegration.diagnostics`]).
 *
 * ## 왜 세션이 아니라 터미널에 붙는가
 *
 * 레코드는 **xterm 버퍼의 좌표**다. 재연결로 백엔드 세션이 갈려도 터미널은 그대로 살아
 * 있으므로(docs/log/2026-09-01-reconnect.md) 레코드도 그대로 이어진다 — 새 셸의 첫 A 가
 * 그냥 다음 레코드가 될 뿐이다. 반대로 터미널이 dispose 되면 마커도 함께 죽는다.
 *
 * ## 마커 수명
 *
 * 스크롤백 한도 밖으로 밀린 줄의 마커는 xterm 이 스스로 dispose 한다(`isDisposed`).
 * 우리는 그 레코드를 목록에서 걷어 내기만 하면 된다 — 되살릴 방법도, 되살릴 이유도 없다
 * (화면에서 사라진 출력은 복사할 대상이 아니다).
 *
 * ## OSC 133 이 없는 세션
 *
 * 스니펫이 안 들어갔거나(tmux 안 · 주입 실패) 로컬 PowerShell 이면 이 핸들러는 한 번도
 * 불리지 않는다. 그 경우 상태는 계속 `null` 이고, 탭 표시는 2단계의 활동 점으로 폴백한다
 * (docs/log/2026-09-01-split-activity.md 5절). **없는 정보를 지어내지 않는다.**
 */

export * from "./shell-integration/types";
export * from "./shell-integration/registry";
export * from "./shell-integration/cwd";
export * from "./shell-integration/marker";
export * from "./shell-integration/attach";
export * from "./shell-integration/badge";
