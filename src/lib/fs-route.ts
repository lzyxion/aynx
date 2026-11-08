/**
 * **짐이 지나는 길** — 파일 전송의 방향 판정 (docs/log/2026-09-04-fs-cross-place-move.md).
 *
 * 브라우저 타일 안에 있던 네 줄짜리 규칙을 밖으로 꺼낸 것이다. 아는 것은 **백엔드 키 문자열**
 * 뿐이라 DOM 도 룬도 백엔드 객체도 보지 않는다 — 그래서 표로 굳혀 둘 수 있다.
 *
 * ## 길과 뜻은 **다른 축**이다
 *
 * 예전에는 한 값(`Plan`)에 섞여 있었다 — `"copy" | "move" | "upload" | "download"`.
 * 서로 다른 곳 사이에서 잘라내기가 **진짜 이동**이 되면서 그 모양이 무너졌다: 업로드에도
 * 다운로드에도 서버 사이에도 각각 복사판과 이동판이 생겨, 한 축이던 값이 두 축이 됐다.
 *
 * - **길**([`FsRoute`]) = 원본 백엔드 × 대상 백엔드 (어느 명령을 부를 것인가)
 * - **뜻**([`FsMoveMode`]) = 사용자의 몸짓 (복사인가 이동인가)
 *
 * 그 둘을 곱한 여덟 칸이 배선표의 전부다. 뜻을 정하는 축은 다시 둘로 갈린다 — 계층
 * ([`sameTier`])이 정하는 **기본값**과 그것을 덮어쓰는 **수정키**(`Ctrl`·`Shift`)이고,
 * 그 둘을 합쳐 한 값으로 내놓는 자리가 [`dragMode`] 다.
 */

import type { Key } from "$lib/i18n/keys";

/** 로컬 디스크 백엔드의 키 — `$lib/fs-backend` 의 `LOCAL_KEY` 와 같은 값이어야 한다 */
export const LOCAL_BACKEND_KEY = "local";

/** 복사인가 이동인가 (`$lib/fs-clipboard.svelte` 의 `FsClipMode` 와 같은 모양) */
export type FsMoveMode = "copy" | "cut";

export type FsRoute = "same" | "upload" | "download" | "between";

/** 이 백엔드가 **원격**인가 — 방향 판정의 유일한 질문 (로컬 키는 창을 넘어도 하나다) */
export function isRemoteKey(key: string): boolean {
  return key !== LOCAL_BACKEND_KEY;
}

/**
 * 짐이 지나는 길 — **원본 × 대상 짝**이 정한다.
 *
 * `between`(원격 A → 원격 B)은 `sftp_*_between` 이 바이트를 우리를 통해 나르는 길이다.
 */
export function routeBetween(srcKey: string, destKey: string): FsRoute {
  if (srcKey === destKey) return "same";
  if (!isRemoteKey(srcKey) && isRemoteKey(destKey)) return "upload";
  if (isRemoteKey(srcKey) && !isRemoteKey(destKey)) return "download";
  return "between";
}

/**
 * 진행 막대에 적는 말 — 잘라내기는 **어느 길로 가든 "이동"** 이다.
 *
 * 값이 문장이 아니라 **문구 키**인 것이 요점이다: 이 파일은 룬을 들이지 않는 순수 모듈이라
 * (표 열두 칸을 그대로 테스트한다) 말을 만들 수 없고, 푸는 것은 화면의 몫이다
 * (설정 화면의 후보 표가 문구 키를 드는 것과 같은 규칙 — docs/log/2026-09-17-i18n.md).
 */
const ROUTE_LABEL: Record<FsRoute, Key> = {
  same: "files.transfer.route.copy",
  upload: "files.transfer.route.upload",
  download: "files.transfer.route.download",
  between: "files.transfer.route.copy",
};

export function routeLabel(route: FsRoute, mode: FsMoveMode): Key {
  return mode === "cut" ? "files.transfer.route.move" : ROUTE_LABEL[route];
}

/** 끝난 뒤 안내 한 줄의 키 — 진행 막대의 말과 **같은 축**이지만 문장이라 표가 따로다 */
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
 * 이 짐을 끌어다 놓았을 때 **기본 뜻이 이동**인가 — 출발지와 목적지가 **같은 계층**
 * (서버끼리 · 내 디스크 안)이면 그렇다.
 *
 * 계층에서 끊는 이유:
 *
 * - **서버 ↔ 서버**(같은 서버 안이든 다른 서버든)는 이동이 기본이다. 원격 타일을 둘 나란히
 *   놓는 이유가 대개 "이쪽에서 저쪽으로 옮긴다" 이고, 백엔드가 항목 단위로 원자성을 지켜
 *   주므로 중간에 끊겨도 잃는 것이 없다.
 * - **내 디스크 ↔ 서버**는 복사가 기본이다. 그 몸짓의 이름은 "가져오기/내보내기" 이지
 *   "옮기기" 가 아니다 — 손이 미끄러져 내 디스크의 원본이 사라지면 되돌릴 길이 없다.
 *
 * 이것은 **기본값만** 정한다 — 수정키가 얹히면 뜻이 바뀐다. 그 전부는 [`dragMode`] 에 있고,
 * 이 함수를 부르는 곳도 거기 하나여야 한다 (판정이 둘로 갈리면 커서와 결과가 어긋난다).
 */
export function sameTier(fromKey: string, destKey: string): boolean {
  return isRemoteKey(fromKey) === isRemoteKey(destKey);
}

/**
 * 드래그 중에 눌린 수정키 — DOM 이벤트가 아니라 **값 둘만** 받는다.
 *
 * `DragEvent` 를 통째로 넘기면 이 규칙을 표로 테스트할 수 없다. 아래 [`dragMode`] 의 표가
 * 열두 칸인데, 그 열두 칸을 그대로 적어 볼 수 있는 것이 이 모양의 값어치 전부다.
 */
export interface DragMods {
  ctrl: boolean;
  shift: boolean;
}

/**
 * 이 드래그를 놓으면 **무슨 뜻인가** — 계층의 기본값에 수정키를 얹은 최종 판정.
 *
 * `fromKey` 가 `null` 이면 **출발지를 모른다**: `dragover` 시점에는 짐의 값을 읽을 수 없어
 * 이 창의 손안의 값(`fsDragActive`)으로 따지는데, 남의 창에서 시작한 드래그에서는 그 값이
 * 비어 있다.
 *
 * ## 표 (판정 순서: `Ctrl` → `Shift` → 출발지를 모름 → [`sameTier`])
 *
 * | 끄는 곳 → 놓는 곳 | 수정키 없음 | `Ctrl` | `Shift` | `Ctrl+Shift` |
 * | --- | --- | --- | --- | --- |
 * | 같은 서버 안 · 원격 A→원격 B · 내 디스크 안 (같은 계층) | **이동** | 복사 | 이동 | 복사 |
 * | 내 디스크 ↔ 서버 (계층을 넘음) | 복사 | 복사 | **이동** | 복사 |
 * | 출발지를 모름 (남의 창에서 온 드래그) | 복사 | 복사 | 이동 | 복사 |
 *
 * 세 칸에 근거를 적어 둔다.
 *
 * **`Ctrl+Shift` 는 복사다.** 탐색기에서 그 조합은 "바로 가기 만들기" 인데 **우리에게 링크는
 * 없다**. 없는 뜻을 흉내 내는 대신 가장 안전한 쪽으로 떨어뜨린다 — 두 손가락을 다 얹은 손이
 * 뜻하지 않게 원본을 지우는 일은 없어야 한다.
 *
 * **`Shift` 는 계층을 넘어서도 이동이다.** 백엔드의 이동 셋(`local_to_sftp_move` ·
 * `sftp_to_local_move` · `sftp_move_between`)은 **항목 단위로 원자적**이라 — 항목 하나가
 * 목적지에 완전히 놓인 뒤에만 그 원본을 지운다 — 중간에 끊겨도 잃는 것이 없다. 그래서
 * 기술적으로는 언제나 안전했다. 그런데도 [`sameTier`] 의 기본값을 복사로 둔 이유는 그대로다:
 * 내 디스크와 서버 사이의 몸짓 이름은 "가져오기 / 내보내기" 이지 "옮기기" 가 아니고, 손이
 * 미끄러져 내 디스크의 원본이 사라지면 되돌릴 길이 없다. `Shift` 는 그 **명시적 몸짓**이다 —
 * 실수로 눌리는 키가 아니므로, 눌렸다면 그렇게 하겠다는 뜻으로 읽는다.
 *
 * **출발지를 모르면 복사다.** 계층을 알 수 없으니 기본값을 고를 수 없고, 둘 중 하나를 골라야
 * 한다면 원본을 지우지 않는 쪽이다. (그 위에 `Shift` 는 그대로 얹힌다 — 명시적 몸짓은 출발지를
 * 몰라도 명시적이다.) 남의 창에서 온 **원격** 짐은 어차피 놓는 순간 거절되므로
 * (`applyDrop` — 세션 번호가 창마다 다르다) 이 칸이 실제로 도는 것은 로컬 짐뿐이다.
 */
export function dragMode(fromKey: string | null, destKey: string, mods: DragMods): FsMoveMode {
  if (mods.ctrl) return "copy";
  if (mods.shift) return "cut";
  if (fromKey === null) return "copy";
  return sameTier(fromKey, destKey) ? "cut" : "copy";
}

/**
 * 뜻 → `dataTransfer.dropEffect`.
 *
 * 커서 예고(`dragover`)와 놓는 뜻(`drop`)이 **한 함수에서** 나오게 하려고 둔 한 줄이다.
 * 예전에는 두 자리가 각자 `sameTier` 와 `ev.ctrlKey` 를 엮어 커서와 결과를 따로 계산했다.
 */
export function dropEffectOf(mode: FsMoveMode): "move" | "copy" {
  return mode === "cut" ? "move" : "copy";
}
