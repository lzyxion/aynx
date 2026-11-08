// 작업안 실행 목록의 순수 판정 — 상태 알약의 종류 · 줄 순서. 화면(`ExecList.svelte`)과 컨트롤러(`ops-controller.svelte.ts`)가 부른다.
//
// ## 상태 알약 = MD3 톤 면 (2026-11-01 사용자 확정 목업)
// 꽉 찬 면(primary)은 주 단추 전용이라 쓰지 않는다. secondaryContainer 도 쓰지 않는다 — 걸린 거르기 칩 · 고른 칸의 면이라 겹친다.
//   run       실행 중  primaryContainer 면 + 도는 고리(primary)
//   ok        성공     `--ok-soft` 면 + ✓
//   warn      일부 성공 `--warn-soft` 면 + !
//   err       실패 · 시간 초과  `--err-soft` 면 + ✕
//   neutral   승인됨 · 대기  중성 회색 면
//   cancelled 취소됨   면 없이 중성 테두리
//   unknown   불명     면 없이 경고색 테두리
import type { OperationState, TargetState } from "$lib/operations";

export type StateKind = "run" | "ok" | "warn" | "err" | "neutral" | "cancelled" | "unknown";

/** 작업안 집계 상태 → 알약 종류 */
export function opStateKind(state: OperationState): StateKind {
  switch (state) {
    case "running":
      return "run";
    case "succeeded":
      return "ok";
    case "partial":
      return "warn";
    case "failed":
      return "err";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

/** 대상 하나의 상태 → 알약 종류 */
export function targetKind(state: TargetState): StateKind {
  switch (state) {
    case "running":
      return "run";
    case "succeeded":
      return "ok";
    case "failed":
    case "timedOut":
      return "err";
    case "cancelled":
      return "cancelled";
    case "unknown":
      return "unknown";
    default:
      return "neutral";
  }
}

/** 실행 목록의 정렬 — 설정 `[plans] exec_sort` 의 값(후보 · 문구 키 표는 설정 모델 `options.ts` 의 `EXEC_SORTS`) */
export type ExecSort = "newest" | "oldest";

/**
 * 실행 목록의 순서 — **도는 · 승인된 실행(`active`)은 정렬과 상관없이 늘 위**이고, 그 안팎에서 각각 시각 순(`sort`).
 * 시각은 줄에 보이는 시각과 같은 값(`requestedAt ?? createdAt` — 부르는 쪽이 `at` 으로 준다). 시각을 모르는 줄(다른 창이 시작해
 * 작업안 상세가 없는 실행)은 제 묶음의 끝에, 그 안에서는 들어온 차례 그대로다(정렬은 안정).
 */
export function sortExecs<T>(
  rows: readonly T[],
  sort: ExecSort,
  at: (row: T) => number | null,
  active: (row: T) => boolean,
): T[] {
  const dir = sort === "oldest" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, a: active(row), t: at(row) }))
    .sort((x, y) => {
      if (x.a !== y.a) return x.a ? -1 : 1;
      if (x.t === null || y.t === null) {
        if (x.t === null && y.t === null) return x.i - y.i;
        return x.t === null ? 1 : -1;
      }
      return x.t !== y.t ? (x.t - y.t) * dir : x.i - y.i;
    })
    .map((x) => x.row);
}
