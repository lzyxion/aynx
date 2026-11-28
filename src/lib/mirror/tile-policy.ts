// 메인 PC 화면 거울에서 타일 종류마다 원격이 그리는 법 — `viewer` = 같은 세션에 시청자로 붙는다 · `render` = 원격 창이 따로 읽어 그린다 ·
// `own` = 자리 표시 + [원격에서 따로 열기]. 쿼리는 `own` 이다 — DB 연결 · 트랜잭션이 `tileKey` 에 묶여 서버에 살아, 같은 열쇠로 붙으면
// 메인 PC 의 트랜잭션을 함께 쥔다. 모르는 종류도 `own`(닫히는 쪽).

import type { PaneKind } from "$lib/session/spec";

export type MirrorTileMode = "viewer" | "render" | "own";

export function mirrorTileMode(kind: PaneKind | string): MirrorTileMode {
  switch (kind) {
    case "local":
    case "ssh":
      return "viewer";
    case "start":
    case "localfs":
    case "sftp":
    case "doc":
    case "image":
    case "branches":
    case "diff":
    case "run":
    case "producer":
    case "chat":
      return "render";
    default:
      return "own";
  }
}
