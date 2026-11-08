/**
 * **문서 보기의 자동 새로고침 규칙** — 순수 함수만 (docs/log/2026-09-27-doc-tile.md "B — 자동 새로고침 · 다듬기").
 *
 * `DocView` 는 타이머 · 가시성 · DOM 을 쥐고, "지금 물어볼까 · 다시 읽을까 · 바꿀까 · 어디로 스크롤할까" 는
 * 여기 판정을 본다. 흐름은:
 *
 * 1. 주기마다([`pollIntervalOf`] — 로컬 1.5 s · 원격 4 s) [`shouldPoll`] 이 참이면 `stat` 한 번.
 * 2. 크기·수정 시각이 지난번과 다르면([`stampChanged`]) `readText`.
 * 3. 읽은 것을 [`replacePlan`] 으로 가른다 — `version` 이 같으면 **아무것도 바꾸지 않는다**(그린 것 · 선택 ·
 *    스크롤이 그대로), 글이 같고 곁 값만 다르면(잘린 로그가 뒤에서 자란 것) 곁 값만, 글이 다르면 통째로.
 * 4. 통째로 바꿀 때 스크롤은 [`stuckToBottom`] — 맨 아래에 붙어 있었으면 맨 아래(로그 꼬리 보기), 아니면 그 자리.
 */

import { LOCAL_KEY } from "$lib/fs-backend";

/** 로컬은 `stat` 이 디스크 한 번이라 싸다 */
export const DOC_POLL_LOCAL_MS = 1500;
/** 원격은 `stat` 이 SFTP 왕복이다 — 느린 링크 · 붙어 있는 다른 채널을 생각해 드물게 */
export const DOC_POLL_REMOTE_MS = 4000;

/** 백엔드 키(`FsBackend.key`)로 주기를 고른다 — 로컬 키는 `LOCAL_KEY` 하나이고 나머지는 전부 원격이다 */
export function pollIntervalOf(backendKey: string): number {
  return backendKey === LOCAL_KEY ? DOC_POLL_LOCAL_MS : DOC_POLL_REMOTE_MS;
}

/** 물어볼지 말지를 가르는 사정들 — 하나라도 어긋나면 이번 박자는 건너뛴다 */
export interface PollGate {
  /** 타일이 화면에 보인다(탭 활성 · 확대된 다른 타일에 가리지 않음 · 창이 보임) */
  visible: boolean;
  /** 원본에 닿는다(원격은 세션이 있다) */
  online: boolean;
  /** 원본 터미널 타일이 아예 사라졌다 */
  sourceGone: boolean;
  /** 한 번이라도 읽었다 — 처음 읽기가 실패한 채면 자동으로 되풀이하지 않는다(다시 시도는 사람 몫) */
  hasFile: boolean;
  /** 오류 띠가 서 있다 — 그동안은 멈춘다(다시 시도 · 새로고침이 풀어 준다) */
  error: boolean;
  /** 읽기나 묻기가 이미 날아가 있다 — 겹쳐 보내지 않는다 */
  busy: boolean;
}

export function shouldPoll(g: PollGate): boolean {
  return g.visible && g.online && !g.sourceGone && g.hasFile && !g.error && !g.busy;
}

/**
 * 자동 새로고침이 **서 있는가**(새로고침 단추 툴팁의 정보) — 박자 하나의 사정(`visible` · `busy`)은 빼고 본다.
 * 보이지 않는 타일은 메뉴도 열 수 없고, 읽는 중은 잠깐이라 "멈춤" 으로 깜빡일 까닭이 없다.
 */
export function autoRefreshOn(g: Omit<PollGate, "visible" | "busy">): boolean {
  return g.online && !g.sourceGone && g.hasFile && !g.error;
}

/**
 * 마지막으로 읽은 때를 **상대 시각 한 칸**으로 — 새로고침 단추 툴팁의 흐린 뒤쪽. 5초 안은 "방금", 그다음 초 · 분 · 시간.
 * 시계가 거꾸로 가도(음수) "방금"이다.
 */
export function readAgo(ms: number): { unit: "now" | "secs" | "mins" | "hours"; n: number } {
  const s = Math.floor(ms / 1000);
  if (s < 5) return { unit: "now", n: 0 };
  if (s < 60) return { unit: "secs", n: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: "mins", n: m };
  return { unit: "hours", n: Math.floor(m / 60) };
}

/** `stat` 에서 보는 두 값 — 크기 · 수정 시각(초) */
export interface Stamp {
  size: number;
  mtime: number | null;
}

/**
 * 지난번과 달라졌는가 — 지난번이 없으면(처음 · 백엔드가 바뀐 직후) **달라진 것으로 본다**. 그래야 첫 박자가
 * 기준을 잡으며 한 번 읽고(`version` 이 같으면 바꾸지 않으니 헛읽기의 값은 그 한 번뿐이다) 틈을 남기지 않는다.
 * 수정 시각을 모르면(서버가 안 준다) 크기만 본다.
 */
export function stampChanged(prev: Stamp | null, next: Stamp): boolean {
  if (prev === null) return true;
  return prev.size !== next.size || prev.mtime !== next.mtime;
}

/** 읽은 것의 모양 — `TextFile` 에서 판정에 쓰는 칸만 */
export interface Readout {
  text: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  lossy: boolean;
  version: string;
}

/**
 * 새로 읽은 것을 어떻게 들일까.
 * - `"none"` — `version` 이 같다. 아무것도 바꾸지 않는다(그린 블록 · 강조 · 선택 · 스크롤이 그대로).
 * - `"meta"` — 글은 같고 곁 값(크기 · version)만 다르다. 잘린 파일(앞 2 MiB)이 뒤에서 자랄 때가 이것이다 —
 *   보이는 앞부분이 같으니 2 MiB 를 다시 그리지 않고 띠의 수만 고친다.
 * - `"all"` — 글이나 모양(이진 · 대체 문자)이 다르다. 통째로 바꾼다.
 */
export function replacePlan(prev: Readout | null, next: Readout): "none" | "meta" | "all" {
  if (prev === null) return "all";
  if (prev.version === next.version) return "none";
  if (prev.binary === next.binary && prev.lossy === next.lossy && prev.text === next.text) return "meta";
  return "all";
}

/** 맨 아래로 보는 여유(px) — 소수 픽셀 · 줄 높이 반올림 */
export const STICK_SLACK_PX = 4;

/**
 * 맨 아래에 **붙어 있는가** — 스크롤할 것이 있고 끝에 닿아 있을 때만. 한 화면에 다 들어가는 글은 붙어 있지
 * 않은 것으로 본다: 짧은 문서가 자라났다고 맨 위를 읽던 사람을 끝으로 끌고 가지 않는다(로그를 꼬리로 보려면
 * 한 번 끝으로 내리면 된다 — `End`).
 */
export function stuckToBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  if (scrollHeight <= clientHeight + STICK_SLACK_PX) return false;
  return scrollTop + clientHeight >= scrollHeight - STICK_SLACK_PX;
}
