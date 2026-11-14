// 집 PC 화면 거울에서 **타일 종류마다 원격이 어떻게 그리나**(원격 웹 R2-B). 순수 · 잎 모듈.
//
// | 종류 | 원격에서 | 까닭 |
// | --- | --- | --- |
// | `local` · `ssh` | **시청자**(`viewer`) — 같은 세션에 붙어 같은 출력 · 입력 · 크기 주인(마지막으로 친 쪽) | 세션은 서버에 하나 — 함께 본다 |
// | `start` | 그대로(`render`) — 시작 화면 · 프로젝트 시작 화면. 고르면 집 PC 에 요청(R3 — 집 PC 가 그 자리를 갈아 끼운다) | 상태 없음 |
// | `localfs` · `sftp` | 그대로 — 같은 폴더에서 시작해 원격에서 따로 돌아다닌다(집 PC 가 그 타일을 바꾸면 다시 맞춘다) | 읽기는 invoke 한 번씩(상태 없음) · SFTP 는 원본 터미널 세션을 빌린다(원격의 시청자 타일이 알린 세션 id) |
// | `doc` | 그대로 — 디스크의 파일을 읽는다(집 PC 편집기의 저장 안 한 글은 보이지 않는다). 원격에서 고쳐 저장하면 판 검사가 덮어쓰기를 막는다 | 읽기 상태 없음 |
// | `image` | 그대로 — 같은 그림을 원격 창이 따로 읽어 맞춤으로 연다(배율 · 이동은 창마다 · 전용 폰 화면은 없다) | 읽기 상태 없음 |
// | `branches` · `diff` | 그대로 — 그때그때 읽는다(줄 코멘트는 창 메모리) | 상태 없음 |
// | `run` | 그대로 — 상태는 서버 표 · 창마다 같은 이벤트를 받는다(Run 시작은 관문의 재확인) | 서버가 권위 |
// | `producer` | 그대로 — 원격 창이 제 구독(`producer_chat_subscribe` — 그 창의 Channel 하나)으로 같은 채팅을 본다(2단계 단계 3 · 원격 실기는 단계 5) | 프로세스는 서버에 하나 |
//
// 작업안은 2026-10-25 에 타일이 아니게 됐다(집 PC 주 창의 채팅 독 갈래) — 원격 창은 거울이 아니라 제 덮개로 본다(`app/plans.svelte.ts`).
// | `query` | **자리 표시**(`own`) + [원격에서 따로 열기] — 원격 창에 새 id · 새 `tileKey` 로 제 쿼리 타일을 연다 | DB 연결 · 트랜잭션 · 쓰기 모드가 `tileKey` 에 묶여 서버에 산다 — 같은 열쇠로 붙으면 집 PC 의 트랜잭션을 함께 쥔다 |

import type { PaneKind } from "$lib/session/spec";

export type MirrorTileMode = "viewer" | "render" | "own";

/** 이 종류의 타일을 원격 거울에서 어떻게 그리나(머리말 표). 모르는 종류는 자리 표시(닫히는 쪽). */
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
      return "render";
    default:
      return "own";
  }
}
