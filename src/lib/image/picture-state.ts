// **이미지 타일이 그리던 그림을 언제까지 쓸지** — 읽는 동안 남길지 · 실패에 남길지 · 무대에 보일지(순수 · 잎에 가깝다).
//
// - **같은 경로**를 다시 읽으면(파일 바뀜 자동 다시 읽기 · [다시 읽기] · 재연결) 그림을 남긴 채 다 받으면 바꿔 끼운다 — 배율 · 이동도
//   그대로다. 원격이 끊긴 동안 마지막 그림을 흐리게 남기는 것도 이 길이다.
// - **다른 경로**의 direct 길(20 MB 이하 — 진행 화면 없이 한 번에)은 새 그림이 풀릴 때까지 이전 그림을 그대로 두고, 그림 · 맞춤 · 배율 글자를
//   한 번에 바꾼다(`ImageView` 의 `swapIn` — 짧은 사이에 무대가 비거나 배율이 `—` 로 깜빡이지 않게). 느린 원격이면 그동안 새 이름 밑에 옛 그림이
//   남는다 — 알고 받은 것이다.
// - **다른 경로**의 진행 · 묻기 길, 그리고 읽기가 실패 · 취소 · 파일 없음이 되면 **그 순간** 이전 그림을 버린다(Blob URL revoke · 원래 크기 ·
//   보기) — 새 이름 밑에 옛 그림 · 옛 배율이 보이지 않고 배율 글자는 그림 없음(`view-math` 의 `zoomLabel(null)`)이 된다.

import type { ImageReadPlan } from "$lib/image/read-plan";

/** 이미지 타일의 화면 상태 */
export type ImagePhase = "loading" | "progress" | "confirm" | "ready" | "broken" | "missing" | "error" | "cancelled" | "toolarge";

/** 지금 그린 그림(`drawn` — 없으면 `""`)이 `next` 와 같은 그림인가 — 같은 경로를 다시 읽는 중 */
export function keepsPicture(drawn: string, next: string): boolean {
  return drawn !== "" && drawn === next;
}

/**
 * 읽기 계획이 정해진 뒤 — `next` 를 받는 동안 그리던 그림을 남기는가. 같은 그림이면 늘, 다른 그림이면 direct 길일 때만(다 받아 풀리면 한 번에
 * 바꾼다). 진행 길은 진행 화면 밑에 옛 그림이 비치지 않게 버린다(묻기 · 너무 큼은 읽기 전에 따로 버린다).
 */
export function keepsWhileReading(drawn: string, next: string, plan: ImageReadPlan): boolean {
  return keepsPicture(drawn, next) || (drawn !== "" && plan === "direct");
}

/** 읽기가 실패 · 취소 · 끊김으로 끝났다 — 그리던 그림을 남기는가. 같은 그림일 때만(끊김 동안 흐리게 남기는 길) */
export function keepsOnFailure(drawn: string, next: string): boolean {
  return keepsPicture(drawn, next);
}

/**
 * 무대에 그림(`<img>`)을 세우는가 — 그릴 바이트가 있고, 파일 없음 · 그리지 못함이 아닐 때. 받는 중 · 취소 · 오류에 그림이 남는 것은
 * 같은 경로를 다시 읽는 중일 때뿐이다(다른 경로면 그때 이미 버렸다).
 */
export function pictureVisible(phase: ImagePhase, hasUrl: boolean): boolean {
  return hasUrl && phase !== "missing" && phase !== "broken";
}
