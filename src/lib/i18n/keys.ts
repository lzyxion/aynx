import type { ko } from "$lib/i18n/ko/index";

/**
 * **문구 키의 타입**. 한국어 사전 한 벌에서 유도하므로, 사전에 없는 키를 `t()` 에 넣으면
 * 컴파일이 멈춘다 (`t("settings.nope")` → 오류).
 *
 * 값이 아니라 타입만 가져온다(`import type`) — 컴파일에서 지워지므로 런타임 모듈 그래프에
 * 남지 않는다 (`npm run check:cycles` 가 세는 간선이 늘지 않는다).
 */
export type Dict = typeof ko;

/** 네임스페이스(= 화면 영역) 이름 — 단계마다 하나씩 는다 */
export type Namespace = keyof Dict;

/**
 * `"<네임스페이스>.<키>"` 전부의 합집합.
 *
 * 한국어 사전이 **유일한 기준**이다: 영어 사전은 `Record<keyof typeof koSettings, string>`
 * 로 선언되므로 칸이 하나 비거나 남으면 `npm run check` 가 잡는다.
 */
export type Key = {
  [N in Namespace]: `${N & string}.${keyof Dict[N] & string}`;
}[Namespace];
