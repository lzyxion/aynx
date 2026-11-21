import { parseStatusOrder, serializeStatusOrder } from "$lib/status-items";

/**
 * 상태바 선두단의 순서 — 창에 하나뿐인 목록 + localStorage 왕복.
 * 모듈에 두는 것은 상태바가 자리를 바꾸면 통째로 다시 마운트되기 때문이다 — 지역 상태면 띠가 둘 뜰 때 순서가 갈린다.
 */

/** 저장 키 — 바꾸지 않는다 */
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

/** 비어 있으면 아직 손대지 않았다 = 기본 순서 */
let order = $state<string[]>(load());

export function statusOrder(): readonly string[] {
  return order;
}

export function setStatusOrder(ids: readonly string[]): void {
  order = [...ids];
  persist(order);
}
