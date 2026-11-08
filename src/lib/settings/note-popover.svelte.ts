// ---------------------------------------------------------------------------
// 설정·호스트 폼의 ⓘ 설명 **팝오버 한 칸** — 앱 전체에 하나만 열린다
// (docs/log/2026-09-28-settings-note-popover.md · docs/log/2026-09-28-hostform-note-popover.md).
//
// `InfoNote` 가 ⓘ 를 누르면 여기에 "무엇을(스니펫) · 어디에(ⓘ 단추)" 를 적고, 그리는 것은
// 설정 화면 뿌리에 한 벌 있는 `NotePopover` 다. 칸이 하나라 **다른 ⓘ 를 열면 앞의 것이
// 저절로 닫힌다** — 닫기 규칙을 InfoNote 마다 따로 둘 필요가 없다.
//
// 팝오버를 ⓘ 옆(=`<label>` 안)에 그리지 않는 이유는 둘이다: (1) 라벨 안의 클릭은 짝지어진
// 컨트롤로 넘어가 팝오버 글자를 누르기만 해도 스위치가 켜지고, (2) 라벨의 글자가 곧 컨트롤의
// 접근성 이름이라 열린 설명 전문이 그 이름에 섞인다.
// ---------------------------------------------------------------------------

import type { Snippet } from "svelte";

/** 열린 설명 하나 */
export interface OpenNote {
  /** 팝오버 요소의 id — ⓘ 의 `aria-controls` 와 같은 값 (`{id}-note`) */
  id: string;
  /** 연 ⓘ 단추 — 자리의 기준이자 닫을 때 포커스가 돌아갈 곳 */
  anchor: HTMLElement;
  /** 팝오버의 접근성 이름 (ⓘ 의 `aria-label` 과 같다) */
  label: string;
  /** 보여 줄 설명 — `InfoNote` 의 `note` 스니펫 그대로 (굵게·코드가 산다) */
  note: Snippet;
}

const slot = $state<{ cur: OpenNote | null }>({ cur: null });

/** 지금 열린 설명 (없으면 `null`) */
export function openNote(): OpenNote | null {
  return slot.cur;
}

/** 이 ⓘ 가 연 설명이 지금 떠 있는가 */
export function isNoteOpenFor(anchor: HTMLElement | null | undefined): boolean {
  return anchor != null && slot.cur?.anchor === anchor;
}

/** 설명을 연다 — 이미 다른 것이 열려 있으면 그것을 **갈아 끼운다** */
export function showNote(note: OpenNote): void {
  slot.cur = note;
}

/**
 * 닫는다. `focusBack` 이면 연 ⓘ 로 포커스를 돌려준다(Esc·토글) — 바깥 클릭·스크롤로
 * 닫힐 때는 돌려주지 않는다(누른 곳이 곧 갈 곳이고, 스크롤 중 포커스가 화면을 끌어당긴다).
 */
export function closeNote(focusBack = false): void {
  const cur = slot.cur;
  if (!cur) return;
  slot.cur = null;
  if (focusBack && cur.anchor.isConnected) cur.anchor.focus({ preventScroll: true });
}
