/**
 * 짐이 지나는 길 — 파일 전송의 방향 판정(순수).
 * 길과 뜻은 다른 축이다 — 길([`FsRoute`]) = 원본 × 대상 백엔드, 뜻([`FsMoveMode`]) = 복사인가 이동인가. 뜻의 최종 판정은 [`dragMode`] 하나.
 */

import type { Key } from "$lib/i18n/keys";

/** `$lib/fs-backend` 의 `LOCAL_KEY` 와 같은 값이어야 한다 */
export const LOCAL_BACKEND_KEY = "local";

export type FsMoveMode = "copy" | "cut";

export type FsRoute = "same" | "upload" | "download" | "between";

export function isRemoteKey(key: string): boolean {
  return key !== LOCAL_BACKEND_KEY;
}

export function routeBetween(srcKey: string, destKey: string): FsRoute {
  if (srcKey === destKey) return "same";
  if (!isRemoteKey(srcKey) && isRemoteKey(destKey)) return "upload";
  if (isRemoteKey(srcKey) && !isRemoteKey(destKey)) return "download";
  return "between";
}

const ROUTE_LABEL: Record<FsRoute, Key> = {
  same: "files.transfer.route.copy",
  upload: "files.transfer.route.upload",
  download: "files.transfer.route.download",
  between: "files.transfer.route.copy",
};

/** 잘라내기는 어느 길로 가든 "이동" 이다 */
export function routeLabel(route: FsRoute, mode: FsMoveMode): Key {
  return mode === "cut" ? "files.transfer.route.move" : ROUTE_LABEL[route];
}

const ROUTE_DONE: Record<FsRoute, Key> = {
  same: "files.transfer.done.copy",
  upload: "files.transfer.done.upload",
  download: "files.transfer.done.download",
  between: "files.transfer.done.copy",
};

export function routeDoneLabel(route: FsRoute, mode: FsMoveMode): Key {
  return mode === "cut" ? "files.transfer.done.move" : ROUTE_DONE[route];
}

/**
 * 같은 계층(서버끼리 · 내 디스크 안)이면 기본 뜻이 이동이다 — 내 디스크 ↔ 서버는 복사(원본이 사라지면 되돌릴 길이 없다).
 * 부르는 곳은 [`dragMode`] 하나여야 한다 — 판정이 둘로 갈리면 커서와 결과가 어긋난다.
 */
export function sameTier(fromKey: string, destKey: string): boolean {
  return isRemoteKey(fromKey) === isRemoteKey(destKey);
}

export interface DragMods {
  ctrl: boolean;
  shift: boolean;
}

/**
 * `fromKey` 가 `null` = 출발지를 모른다(남의 창에서 시작한 드래그 — `fsDragActive` 가 비어 있다).
 *
 * | 끄는 곳 → 놓는 곳 | 수정키 없음 | `Ctrl` | `Shift` | `Ctrl+Shift` |
 * | --- | --- | --- | --- | --- |
 * | 같은 계층 | **이동** | 복사 | 이동 | 복사 |
 * | 내 디스크 ↔ 서버 | 복사 | 복사 | **이동** | 복사 |
 * | 출발지를 모름 | 복사 | 복사 | 이동 | 복사 |
 *
 * `Ctrl+Shift` 는 복사다 — 탐색기의 "바로 가기 만들기" 인데 우리에게 링크는 없어 가장 안전한 쪽으로 떨어뜨린다.
 * `Shift` 는 계층을 넘어서도 이동이다 — 백엔드의 이동은 항목 단위로 원자적이고, 실수로 눌리는 키가 아니다.
 */
export function dragMode(fromKey: string | null, destKey: string, mods: DragMods): FsMoveMode {
  if (mods.ctrl) return "copy";
  if (mods.shift) return "cut";
  if (fromKey === null) return "copy";
  return sameTier(fromKey, destKey) ? "cut" : "copy";
}

/** 커서 예고(`dragover`)와 놓는 뜻(`drop`)이 한 함수에서 나오게 한다 */
export function dropEffectOf(mode: FsMoveMode): "move" | "copy" {
  return mode === "cut" ? "move" : "copy";
}
