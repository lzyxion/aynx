import { parseStatusOrder, serializeStatusOrder } from "$lib/status-items";

/**
 * **상태바 선두단의 순서**(사람이 끌어서 정한 것)의 상태와 저장.
 *
 * 규칙(모르는 id·빠진 id·옮기기)은 전부 순수 모듈 `status-items.ts` 에 있고, 여기 남은
 * 것은 둘뿐이다 — **창에 하나뿐인 반응형 목록**과 **localStorage 왕복**
 * (`favorites.svelte.ts` 와 같은 모양).
 *
 * ## 왜 localStorage 인가
 *
 * `favorites.svelte.ts` 의 판단을 그대로 따른다: 이 값은 **이 컴퓨터에서 이 사람이
 * 도구줄을 어떻게 늘어놓았는가** 라는 화면 편의값이라 설정 파일
 * (`settings.toml`)에 칸을 파고 마이그레이션을 달 무게가 아니다. localStorage 는 **창이
 * 아니라 앱(오리진) 단위**라 창을 새로 띄워도 같은 순서가 뜬다.
 *
 * 읽기·쓰기를 **전부 try/catch 로 감싼다** — 프라이빗 모드·할당량 초과·정책으로 막힌
 * 환경에서는 접근 자체가 throw 한다. 없어도 되는 편의값이므로 조용히 포기하고 기본 순서로
 * 선다.
 *
 * ## 왜 컴포넌트가 아니라 모듈에 두나
 *
 * 상태바는 **가장자리 넷 중 한 곳**에 서고(`+page` 가 위치마다 다른 자리에서 그린다), 위치를
 * 바꾸면 컴포넌트가 통째로 새로 마운트된다. 지역 상태였다면 그때마다 저장소를 다시 읽어야
 * 하고, 같은 창에 띠가 둘 뜨는 판이 나오면 둘의 순서가 갈린다.
 */

/** localStorage 키 — 앱 접두사를 붙여 다른 저장값과 섞이지 않게 한다 (`aynx:favorites` 와 같은 꼴) */
const STORAGE_KEY = "aynx:status-order";

function load(): string[] {
  try {
    if (typeof localStorage === "undefined") return [];
    return parseStatusOrder(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function persist(ids: readonly string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, serializeStatusOrder(ids));
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}

/** 저장된 id 순서. 비어 있으면 "아직 손대지 않았다" = 기본 순서 (`applyOrder` 가 판단한다) */
let order = $state<string[]>(load());

/** 지금 순서 (읽기는 반응형이라 놓는 즉시 띠가 다시 선다) */
export function statusOrder(): readonly string[] {
  return order;
}

/** 새 순서를 기억한다 — 끌어서 놓은 직후 한 번 부른다 */
export function setStatusOrder(ids: readonly string[]): void {
  order = [...ids];
  persist(order);
}
