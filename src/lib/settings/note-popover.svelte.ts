// 설정 · 호스트 폼의 ⓘ 설명 팝오버 한 칸 — 앱 전체에 하나만 열려 다른 ⓘ 를 열면 앞의 것이 저절로 닫힌다.
// ⓘ 옆(`<label>` 안)에 그리지 않는다 — 라벨 안 클릭이 짝 컨트롤로 넘어가 스위치가 켜지고, 설명 전문이 컨트롤의 접근성 이름에 섞인다.

import type { Snippet } from "svelte";

export interface OpenNote {
  /** ⓘ 의 `aria-controls` 와 같은 값 (`{id}-note`) */
  id: string;
  /** 자리의 기준이자 닫을 때 포커스가 돌아갈 곳 */
  anchor: HTMLElement;
  label: string;
  note: Snippet;
}

const slot = $state<{ cur: OpenNote | null }>({ cur: null });

export function openNote(): OpenNote | null {
  return slot.cur;
}

export function isNoteOpenFor(anchor: HTMLElement | null | undefined): boolean {
  return anchor != null && slot.cur?.anchor === anchor;
}

export function showNote(note: OpenNote): void {
  slot.cur = note;
}

/** 바깥 클릭 · 스크롤로 닫힐 때는 포커스를 돌려주지 않는다 — 스크롤 중 포커스가 화면을 끌어당긴다. */
export function closeNote(focusBack = false): void {
  const cur = slot.cur;
  if (!cur) return;
  slot.cur = null;
  if (focusBack && cur.anchor.isConnected) cur.anchor.focus({ preventScroll: true });
}
