// 이미지 타일이 그리던 그림을 언제까지 쓸지 — 순수.
// - 다른 경로의 direct 길은 새 그림이 풀릴 때까지 이전 그림을 두고 한 번에 바꾼다(`ImageView` 의 `swapIn`) — 느린 원격이면 그동안 새 이름 밑에 옛 그림이 남는다(알고 받은 것).
// - 다른 경로의 진행 · 묻기 길과 실패 · 취소 · 파일 없음은 그 순간 이전 그림을 버린다 — 새 이름 밑에 옛 그림 · 옛 배율이 보이지 않게.

import type { ImageReadPlan } from "$lib/image/read-plan";

export type ImagePhase = "loading" | "progress" | "confirm" | "ready" | "broken" | "missing" | "error" | "cancelled" | "toolarge";

export function keepsPicture(drawn: string, next: string): boolean {
  return drawn !== "" && drawn === next;
}

export function keepsWhileReading(drawn: string, next: string, plan: ImageReadPlan): boolean {
  return keepsPicture(drawn, next) || (drawn !== "" && plan === "direct");
}

export function keepsOnFailure(drawn: string, next: string): boolean {
  return keepsPicture(drawn, next);
}

export function pictureVisible(phase: ImagePhase, hasUrl: boolean): boolean {
  return hasUrl && phase !== "missing" && phase !== "broken";
}
