// 머리줄 "+N" 칩의 메뉴(2026-10-23 — 칩 접기 2차: 넘쳐서 숨은 칩들) — 공용 칩 메뉴(`chip-menu.svelte.ts`) 위의 얇은 설정.
// `PaneHost` 가 하나 만들고 마크업(`ChipMoreMenu`)과 머리줄 "+N" 칩(`HeaderChips` — `data-chip-more`)이 부른다. `$effect` 없음.
//
// 줄 하나 = 숨은 칩 하나(사용자 순서 · 제 폭 글자). 누르면 **그 칩을 누른 것과 같은 일**을 한다 — 폴더 → 파일 타일 · 브랜치 → 브랜치 타일 ·
// tmux → 세션 목록 · 포워딩 → 목록 메뉴(둘은 이 메뉴가 서 있던 자리에 — ⋯ 메뉴의 "tmux 세션…" 과 같은 몸짓) · 자원 → 자원 화면.
// 누를 데가 없는 칩(경유 — 상태 하나뿐)은 보기만 하는 줄이다. 줄의 값은 여는 순간 칩이 지어 올린 사본이다(열려 있는 동안 숫자는 그대로).
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import type { HostBox } from "$lib/pane/boxes";
import type { HeaderChipId } from "$lib/header-chips";

/** 줄을 누르면 하는 일 — `null` 은 보기만 하는 줄(경유) */
export type ChipMoreAction = "files" | "branch" | "tmux" | "forward" | "resource" | null;

export interface ChipMoreItem {
  id: HeaderChipId;
  /** `UiIcon` 이름 — 칩과 같은 그림 */
  icon: string;
  /** 칩의 제 폭 글자 */
  label: string;
  /** 줄 말풍선(폴더를 모를 때의 까닭) — 없으면 없음 */
  title?: string;
  /** 글자를 흐리게(폴더를 모를 때의 `folder`) */
  muted?: boolean;
  action: ChipMoreAction;
  /** 브랜치 줄 — 브랜치 타일에서 고를 이름(detached 면 `null`) */
  branch?: string | null;
}

/** 메뉴 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡는 데 쓴다 */
const CHIP_MORE_MENU_WIDTH = 300;

export interface ChipMoreMenuHost {
  readonly boxes: HostBox[];
}

export class ChipMoreMenuController {
  #m;

  /** 열린 메뉴의 줄 — 여는 순간 칩이 지어 올린 사본 */
  items = $state<ChipMoreItem[]>([]);

  constructor(h: ChipMoreMenuHost) {
    this.#m = createChipMenu({ boxes: () => h.boxes, width: CHIP_MORE_MENU_WIDTH });
  }

  /** 열려 있으면 자리와 대상 타일 id */
  get at() {
    return this.#m.at;
  }

  /** 메뉴가 가리키는 타일 */
  get box() {
    return this.#m.box;
  }

  /** "+N" 칩 — 이미 이 타일의 메뉴가 열려 있으면 닫는다(`data-chip-more` 덕에 바깥 누름 닫기가 칩만 비켜 간다) */
  toggle = (ev: MouseEvent, box: HostBox, items: ChipMoreItem[]) => {
    this.items = items;
    this.#m.toggle(ev, box);
  };

  close = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /** 줄 하나 — 대상 타일을 스냅샷하고 닫은 뒤 실행한다(`runOnMenu` 통로, docs/conventions.md "메뉴를 닫는 코드") */
  run = (fn: (box: HostBox) => void) => this.#m.run(fn);
}
