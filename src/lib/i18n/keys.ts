import type { ko } from "$lib/i18n/ko/index";

/** 문구 키의 타입 — 값이 아니라 타입만 가져온다(`import type`): 런타임 모듈 그래프에 간선을 늘리지 않는다. */
export type Dict = typeof ko;

export type Namespace = keyof Dict;

/** `"<네임스페이스>.<키>"` 전부의 합집합 — 한국어 사전이 유일한 기준이다. */
export type Key = {
  [N in Namespace]: `${N & string}.${keyof Dict[N] & string}`;
}[Namespace];
