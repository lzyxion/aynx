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
 * 시작 화면 위젯 배치(창에 하나)와 localStorage 왕복 — 이 컴퓨터의 화면 편의값이라 설정 파일에 두지 않고, 다른 창과 실시간으로 맞추지 않는다(`storage` 사건을 듣지 않는다).
 * 저장은 놓는 순간 한 번 — 끄는 동안 · 크기를 바꾸는 동안에는 쓰지 않는다.
 * 원격 창은 메인 PC 한 벌을 따른다([`followHomeStartBoard`]) — localStorage 는 마지막으로 받은 값의 자리이고, 원격에서는 편집하지 않는다([`startBoardEditable`] 한 곳).
 */

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

export function startWidgets(): readonly StartWidget[] {
  return list;
}

export function setStartWidgets(next: readonly StartWidget[]): void {
  list = next.map((w) => ({ ...w }));
  persist(list);
  changed();
}

/** 저장을 지운다 — 다음에 처음 배치의 값이 바뀌면 그것을 따라가게 */
export function resetStartWidgets(): void {
  list = defaultStartWidgets();
  persist(null);
  changed();
}

// ── 시계 위젯의 표시 ──
// 배치와 따로 키를 둔다 — [처음 배치로]가 배치 키를 지워도 고른 표시는 남아야 한다.

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

export function clockOptions(): Readonly<ClockOptions> {
  return clock;
}

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

// ── 시작 화면 한 벌 — 모양 프로필과 주고받는 문 ──
// 이 모듈은 프로필을 모른다 — 의존은 프로필 → 여기 한 방향이다.

let listener: ((board: StartBoardSnapshot) => void) | null = null;

/** 사람이 배치 · 시계 표시를 바꿀 때마다 불릴 귀(하나 — 다시 걸면 갈아 끼운다). [`applyStartBoard`] 는 부르지 않는다 */
export function onStartBoardChange(fn: ((board: StartBoardSnapshot) => void) | null): void {
  listener = fn;
}

function changed(): void {
  listener?.(startBoardSnapshot());
}

export function startBoardSnapshot(): StartBoardSnapshot {
  return plainStartBoard({ widgets: list, clock });
}

/** 귀는 부르지 않는다(입힌 것을 그 프로필에 다시 담지 않게). 되돌리기 기록을 비운다 — 다른 프로필의 배치로 되돌아가지 않게 */
export function applyStartBoard(board: StartBoardSnapshot): void {
  const plain = plainStartBoard(board);
  list = plain.widgets;
  clock = plain.clock;
  persist(list);
  persistClock();
  undoStack = [];
}

export function startBoardEditable(): boolean {
  return !isRemote;
}

/** 거울은 타일이 바뀔 때마다 오므로 한 벌이 그대로면 손대지 않는다 */
let followed = "";

/** 받은 값과 견준다(지금 값이 아니다) — 시계 박스가 이 창의 언어로 다시 맞춰질 수 있어 지금 값과 견주면 거울마다 되덮는다 */
export function followHomeStartBoard(board: StartBoardSnapshot): void {
  const json = JSON.stringify(plainStartBoard(board));
  if (json === followed) return;
  followed = json;
  applyStartBoard(board);
}

// ── 되돌리기 ── 이 창 메모리에만, 저장하지 않는다.

let undoStack = $state<StartBoardSnapshot[]>([]);

/** 시작 화면이 스스로 하는 맞추기(시계 박스)와 시계 옵션 고르기는 이 문을 지나지 않는다(기록하지 않는다) */
export function editStartBoard(fn: () => void): void {
  const before = startBoardSnapshot();
  fn();
  if (boardChangedForUndo(before, startBoardSnapshot())) undoStack = pushUndo(undoStack, before);
}

export function canUndoStartBoard(): boolean {
  return undoStack.length > 0;
}

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
