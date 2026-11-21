/** 문서 보기의 자동 새로고침 규칙 — 순수 함수만 (docs/log/2026-09-27-doc-tile.md "B — 자동 새로고침 · 다듬기"). */

import { LOCAL_KEY } from "$lib/fs-backend";

export const DOC_POLL_LOCAL_MS = 1500;
/** 원격은 `stat` 이 SFTP 왕복이다 — 느린 링크 · 붙어 있는 다른 채널을 생각해 드물게 */
export const DOC_POLL_REMOTE_MS = 4000;

export function pollIntervalOf(backendKey: string): number {
  return backendKey === LOCAL_KEY ? DOC_POLL_LOCAL_MS : DOC_POLL_REMOTE_MS;
}

export interface PollGate {
  visible: boolean;
  online: boolean;
  sourceGone: boolean;
  /** 처음 읽기가 실패한 채면 자동으로 되풀이하지 않는다 — 다시 시도는 사람 몫 */
  hasFile: boolean;
  error: boolean;
  busy: boolean;
}

export function shouldPoll(g: PollGate): boolean {
  return g.visible && g.online && !g.sourceGone && g.hasFile && !g.error && !g.busy;
}

/** 박자 하나의 사정(`visible` · `busy`)은 빼고 본다 — 읽는 중은 잠깐이라 "멈춤" 으로 깜빡일 까닭이 없다 */
export function autoRefreshOn(g: Omit<PollGate, "visible" | "busy">): boolean {
  return g.online && !g.sourceGone && g.hasFile && !g.error;
}

export function readAgo(ms: number): { unit: "now" | "secs" | "mins" | "hours"; n: number } {
  const s = Math.floor(ms / 1000);
  if (s < 5) return { unit: "now", n: 0 };
  if (s < 60) return { unit: "secs", n: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: "mins", n: m };
  return { unit: "hours", n: Math.floor(m / 60) };
}

export interface Stamp {
  size: number;
  mtime: number | null;
}

/** 지난번이 없으면 달라진 것으로 본다 — 첫 박자가 기준을 잡으며 한 번 읽어 틈을 남기지 않는다 */
export function stampChanged(prev: Stamp | null, next: Stamp): boolean {
  if (prev === null) return true;
  return prev.size !== next.size || prev.mtime !== next.mtime;
}

export interface Readout {
  text: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  lossy: boolean;
  version: string;
}

/** `none` 은 그린 블록 · 선택 · 스크롤을 그대로 둔다. `meta` 는 잘린 파일이 뒤에서 자랄 때 — 보이는 앞부분을 다시 그리지 않는다 */
export function replacePlan(prev: Readout | null, next: Readout): "none" | "meta" | "all" {
  if (prev === null) return "all";
  if (prev.version === next.version) return "none";
  if (prev.binary === next.binary && prev.lossy === next.lossy && prev.text === next.text) return "meta";
  return "all";
}

export const STICK_SLACK_PX = 4;

/** 한 화면에 다 들어가는 글은 붙어 있지 않은 것으로 본다 — 짧은 문서가 자라났다고 맨 위를 읽던 사람을 끝으로 끌고 가지 않는다 */
export function stuckToBottom(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  if (scrollHeight <= clientHeight + STICK_SLACK_PX) return false;
  return scrollTop + clientHeight >= scrollHeight - STICK_SLACK_PX;
}
