import {
  defaultStartWidgets,
  parseStartWidgets,
  boardChangedForUndo,
  plainStartBoard,
  popUndo,
  pushUndo,
  serializeStartWidgets,
  type StartBoardSnapshot,
  type StartWidget,
} from "$lib/start-widgets";
import { parseClockOptions, serializeClockOptions, type ClockOptions } from "$lib/start-clock";
import { isRemote } from "$lib/ipc";

/**
 * **시작 화면 위젯 배치의 상태와 저장** (docs/log/2026-10-28-start-widgets.md).
 *
 * 규칙(격자 · 부딪힘 · 처음 배치 · 되돌리기 기록 · 검증 · 해석)은 전부 순수 모듈 `start-widgets.ts` 에 있고, 여기 남은 것은 둘뿐이다 —
 * **창에 하나뿐인 반응형 배치**와 **localStorage 왕복**. 시작 화면이 여러 자리(탭마다의 시작 타일 · 탭 없는 본문)에
 * 동시에 떠도 모두 같은 배치를 본다.
 *
 * ## 왜 localStorage 인가
 *
 * 즐겨찾기(`favorites.svelte.ts` 머리말)와 같은 까닭이다 — **이 컴퓨터에서 이 사람이 시작 화면을 어떻게 놓았는가** 라는 화면
 * 편의값이라 설정 파일에 끼울 것도, 백엔드 명령을 새로 팔 것도 아니다. 웹뷰의 localStorage 는 창이 아니라 앱(오리진) 단위라 새 창도
 * 같은 배치로 뜬다. 즐겨찾기처럼 다른 창과 실시간으로 맞추지는 않는다(`storage` 사건을 듣지 않는다 — 새 창 · 새로고침 때 읽는다).
 *
 * 읽기 · 쓰기를 **전부 try/catch 로 감싼다** — 프라이빗 모드 · 할당량 초과 · 정책으로 막힌 환경에서는 접근 자체가 throw 한다.
 * 깨진 글자는 조용히 처음 배치로 물러선다(`parseStartWidgets` 가 `null`).
 *
 * 저장은 **놓는 순간 한 번**이다 — 끄는 동안 · 크기를 바꾸는 동안에는 쓰지 않는다(`StartPage` 가 놓을 때만 [`setStartWidgets`]).
 *
 * ## 원격 창은 집 PC 한 벌을 따른다 (2026-11-04 — docs/log/2026-11-04-start-board-mirror.md)
 *
 * 원격 창(폰 · 넓은 원격 창)의 localStorage 는 집 PC 와 따로라, 예전에는 집 PC 에서 고친 위젯이 폰에 닿지 않았다. 이제 집 PC 주 창이 거울 스냅숏에 한 벌을 싣고
 * (`app/mirror-publish`), 원격이 [`followHomeStartBoard`] 로 받아 쓴다. localStorage 는 원격에서 **마지막으로 받은 값**의 자리다(집 PC 창이 닫혀 있을 때 · 첫 거울 전).
 * 원격에서는 위젯을 편집하지 않는다([`startBoardEditable`] 한 곳 — `StartPage` 의 판 메뉴가 편집의 유일한 입구다).
 */

/** localStorage 키 — 앱 접두사(`aynx:favorites` 와 같은 꼴) */
const STORAGE_KEY = "aynx:start-widgets";

function load(): StartWidget[] {
  try {
    if (typeof localStorage === "undefined") return defaultStartWidgets();
    return parseStartWidgets(localStorage.getItem(STORAGE_KEY)) ?? defaultStartWidgets();
  } catch {
    return defaultStartWidgets();
  }
}

function persist(list: readonly StartWidget[] | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (list === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, serializeStartWidgets(list));
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}

let list = $state<StartWidget[]>(load());

/** 지금 배치 — 반응형이라 놓는 즉시 모든 시작 화면이 따라온다 */
export function startWidgets(): readonly StartWidget[] {
  return list;
}

/** 배치를 갈아 끼우고 저장한다 — 끌어 놓기 · 크기 바꾸기 · 더하기 · 빼기가 모두 여기로 온다(규칙은 부르는 쪽이 순수 함수로 셈했다) */
export function setStartWidgets(next: readonly StartWidget[]): void {
  list = next.map((w) => ({ ...w }));
  persist(list);
  changed();
}

/** **처음 배치로** — 저장을 지운다(다음에 처음 배치의 값이 바뀌면 그것을 따라가게) */
export function resetStartWidgets(): void {
  list = defaultStartWidgets();
  persist(null);
  changed();
}

// ---------------------------------------------------------------------------
// 시계 위젯의 표시(12/24시간 · 초 · 날짜 · 글자 크기) — 위젯 우클릭 메뉴가 고른다 (2026-11-03)
//
// 배치와 **따로 키**를 둔다 — [처음 배치로]가 배치 키를 지워도(`resetStartWidgets`) 고른 표시는 남아야 하고, 배치 글자의
// 모양(`v: 1` · `widgets`)을 건드리지 않으니 옛 저장값도 그대로 읽힌다. 읽기 · 쓰기는 배치와 같이 try/catch 로 감싼다.
// ---------------------------------------------------------------------------

const CLOCK_KEY = "aynx:start-clock";

function loadClock(): ClockOptions {
  try {
    if (typeof localStorage === "undefined") return parseClockOptions(null);
    return parseClockOptions(localStorage.getItem(CLOCK_KEY));
  } catch {
    return parseClockOptions(null);
  }
}

let clock = $state<ClockOptions>(loadClock());

/** 지금 고른 시계 표시 — 반응형이라 모든 시작 화면의 시계가 함께 바뀐다 */
export function clockOptions(): Readonly<ClockOptions> {
  return clock;
}

/** 시계 표시를 바꾸고 저장한다 */
export function setClockOptions(next: ClockOptions): void {
  clock = { hour12: next.hour12, seconds: next.seconds, date: next.date, size: next.size };
  persistClock();
  changed();
}

function persistClock(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(CLOCK_KEY, serializeClockOptions(clock));
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}

// ---------------------------------------------------------------------------
// 시작 화면 한 벌 — 모양 프로필과 주고받는 문 (2026-11-03)
//
// 모양 프로필(`theme-profiles.svelte.ts`)이 프로필마다 배치 + 시계 표시를 담는다. 이 모듈은 프로필을 모른다 — 바뀜을 알릴
// 귀 하나([`onStartBoardChange`] — 프로필 모듈이 건다)와 한 벌을 꺼내고([`startBoardSnapshot`]) 갈아 끼우는([`applyStartBoard`])
// 함수만 둔다(의존은 프로필 → 여기 한 방향).
// ---------------------------------------------------------------------------

let listener: ((board: StartBoardSnapshot) => void) | null = null;

/** 사람이 배치 · 시계 표시를 바꿀 때마다 불릴 귀(하나 — 다시 걸면 갈아 끼운다). [`applyStartBoard`] 는 부르지 않는다 */
export function onStartBoardChange(fn: ((board: StartBoardSnapshot) => void) | null): void {
  listener = fn;
}

function changed(): void {
  listener?.(startBoardSnapshot());
}

/** 지금 시작 화면 한 벌(복사본) */
export function startBoardSnapshot(): StartBoardSnapshot {
  return plainStartBoard({ widgets: list, clock });
}

/**
 * 한 벌을 갈아 끼운다 — 프로필을 입힐 때(이 창 · 다른 창이 고른 프로필을 바꿨을 때). localStorage 도 함께 고쳐 다음 부팅도 같게 한다.
 * 귀는 부르지 않는다(입힌 것을 그 프로필에 다시 담을 까닭이 없다). **되돌리기 기록을 비운다** — 다른 프로필의 배치로 되돌아가지 않게.
 */
export function applyStartBoard(board: StartBoardSnapshot): void {
  const plain = plainStartBoard(board);
  list = plain.widgets;
  clock = plain.clock;
  persist(list);
  persistClock();
  undoStack = [];
}

/** 이 창에서 위젯을 편집할 수 있는가 — 집 PC 창만(원격 창은 집 PC 한 벌을 따른다 · 머리말) */
export function startBoardEditable(): boolean {
  return !isRemote;
}

/** 마지막으로 따른 한 벌(JSON) — 거울은 타일이 바뀔 때마다 오므로 한 벌이 그대로면 손대지 않는다 */
let followed = "";

/**
 * **원격 창이 집 PC 한 벌을 받았다**(`app/mirror`) — 메모리 + 이 브라우저 localStorage. [`applyStartBoard`] 를 지나므로 귀(프로필 자동 저장)를 부르지 않는다.
 * 받은 값과 견준다(지금 값이 아니다) — 시계 박스는 이 창의 언어로 다시 맞춰질 수 있어(`StartPage`) 지금 값과 견주면 거울마다 되덮는다.
 */
export function followHomeStartBoard(board: StartBoardSnapshot): void {
  const json = JSON.stringify(plainStartBoard(board));
  if (json === followed) return;
  followed = json;
  applyStartBoard(board);
}

// ---------------------------------------------------------------------------
// 되돌리기 (2026-11-03 — 규칙은 순수 `start-widgets.ts` 의 "되돌리기 기록") — 이 창 메모리에만, 저장하지 않는다
// ---------------------------------------------------------------------------

let undoStack = $state<StartBoardSnapshot[]>([]);

/**
 * **사람의 배치 조작 하나**를 기록과 함께 돈다 — `fn` 안에서 [`setStartWidgets`] · [`resetStartWidgets`] · [`setClockOptions`](글자 크기)
 * 를 부른다. 앞뒤가 다르면(제자리 놓기는 아니다) 바꾸기 전 한 벌을 쌓는다. 시작 화면이 스스로 하는 맞추기(시계 박스)와
 * 시계 옵션 고르기는 이 문을 지나지 않는다(기록하지 않는다).
 */
export function editStartBoard(fn: () => void): void {
  const before = startBoardSnapshot();
  fn();
  if (boardChangedForUndo(before, startBoardSnapshot())) undoStack = pushUndo(undoStack, before);
}

/** 되돌릴 것이 있는가 — 메뉴 줄이 흐려진다 */
export function canUndoStartBoard(): boolean {
  return undoStack.length > 0;
}

/** **되돌리기** — 바로 앞 상태로. 프로필 자동 저장 · localStorage 를 같은 길로 지난다 */
export function undoStartBoard(): void {
  const r = popUndo(undoStack, startBoardSnapshot());
  if (!r) return;
  undoStack = r.stack;
  list = r.board.widgets;
  clock = r.board.clock;
  persist(list);
  persistClock();
  changed();
}
