// 작업안 실행 목록의 순수 판정 — 상태 알약의 종류 · 줄 순서.
// 알약에 꽉 찬 면(primary) · secondaryContainer 는 쓰지 않는다 — 주 단추 · 걸린 거르기 칩의 면과 겹친다.
import type { OperationState, TargetState } from "$lib/operations";

export type StateKind = "run" | "ok" | "warn" | "err" | "neutral" | "cancelled" | "unknown";

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

/** 설정 `[plans] exec_sort` 의 값 — 설정 파일에 글자 그대로 남는다 */
export type ExecSort = "newest" | "oldest";

/** 도는 · 승인된 실행(`active`)은 정렬과 상관없이 늘 위 · 시각을 모르는 줄은 제 묶음의 끝 */
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
