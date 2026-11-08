import { decodeHostsDrag, HOSTS_DRAG_TYPE } from "$lib/hosts";
import { PROJECT_DRAG_TYPE } from "$lib/projects";
import { DB_DOCK_DRAG_TYPE, decodeDbDockDrag } from "$lib/db-folders";
import type { Favorite } from "$lib/favorites";

/**
 * **즐겨찾기로 받는 짐** — 순수 규칙(2026-10-23 — 받는 곳은 하단 독 하나다).
 *
 * 받는 것은 사이드 독의 **호스트 줄**(`HOSTS_DRAG_TYPE`) · **프로젝트 줄**(`PROJECT_DRAG_TYPE`) · **DB 연결 줄**(`DB_DOCK_DRAG_TYPE`)
 * 셋뿐이다. 파일 · 탭 · 타일은
 * 우리 짐이 아니다 — 받는 쪽은 [`favoriteDropKind`] 가 `null` 이면 아무것도 하지 않는다(`preventDefault` 도 안 한다 — 본문
 * 전체의 호스트 드롭 · 타일 분할 드롭이 그대로 산다). `dragover` 에서는 값을 못 읽고 종류만 보이므로(`hosts.ts` 의
 * `HOSTS_DRAG_TYPE` 주석) 종류 판정과 값 풀기를 나눈다 — 무엇이 들었는지(이미 있는 칸인가)는 놓는 순간에야 안다.
 *
 * 상태(목록 · 저장 · 알림)를 만지는 쪽은 `app/favorite-drop.ts` 다.
 */

/** 짐의 종류 — 미리보기 칸이 어떤 자리 아이콘을 세울지도 이것으로 가른다 */
export type FavoriteDropKind = "host" | "project" | "db";

/** 끄는 짐이 즐겨찾기로 받을 것인가 — 종류(mime)만 본다. 프로젝트를 먼저 본다(옛 시작 화면 줄의 순서 그대로) */
export function favoriteDropKind(types: readonly string[] | null | undefined): FavoriteDropKind | null {
  if (!types) return null;
  if (types.includes(PROJECT_DRAG_TYPE)) return "project";
  if (types.includes(HOSTS_DRAG_TYPE)) return "host";
  if (types.includes(DB_DOCK_DRAG_TYPE)) return "db";
  return null;
}

/**
 * 놓인 짐 → 더할 칸들(짐의 순서). **폴더는 받지 않는다**(호스트 · DB 모두) — 칸은 "가리키는 말 하나" 이고 폴더는 그 아래
 * 전부를 뜻한다. 폴더와 항목이 섞여 있으면 항목만 받는다. `read` 는 `dataTransfer.getData` 다(시험은 가짜를 넘긴다).
 */
export function droppedFavorites(kind: FavoriteDropKind, read: (type: string) => string): Favorite[] {
  if (kind === "project") {
    const id = read(PROJECT_DRAG_TYPE).trim();
    return id === "" ? [] : [{ kind: "project", id }];
  }
  if (kind === "db") {
    return decodeDbDockDrag(read(DB_DOCK_DRAG_TYPE)).conns.map((id): Favorite => ({ kind: "db", id }));
  }
  return decodeHostsDrag(read(HOSTS_DRAG_TYPE)).hosts.map((alias): Favorite => ({ kind: "host", alias }));
}
