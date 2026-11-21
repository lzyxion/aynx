// 타일의 포워딩 목록 메뉴 — 공용 칩 메뉴(`chip-menu.svelte.ts`) 위의 얇은 설정(열 때 목록 새로 읽기).
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import { reloadPaneForwards } from "$lib/app/forwards.svelte.js";
import type { HostBox } from "$lib/pane/boxes";
import type { ForwardInfo } from "$lib/forward";

export interface ForwardsCardView {
  forwards: ForwardInfo[];
  /** 뷰포트 좌표 */
  anchor: { left: number; top: number; width: number; height: number };
}

export interface ForwardMenuHost {
  readonly boxes: HostBox[];
}

const FORWARD_MENU_WIDTH = 400;

export class ForwardMenuController {
  #m;

  constructor(h: ForwardMenuHost) {
    this.#m = createChipMenu({
      boxes: () => h.boxes,
      width: FORWARD_MENU_WIDTH,
      // 칩 표는 5초 주기라 연결 수가 낡았을 수 있다
      onOpen: (box) => void reloadPaneForwards(box.pane.id),
    });
  }

  get forwardMenu() {
    return this.#m.at;
  }

  get forwardBox() {
    return this.#m.box;
  }

  openForwardMenu = (box: HostBox, at: { left: number; top: number } | null) => this.#m.open(box, at);

  /** 칩의 `data-forward-chip` 덕에 `ForwardMenu` 의 "바깥 누름으로 닫기" 가 이 칩만 비켜 간다 */
  toggleForwardMenu = (ev: MouseEvent, box: HostBox) => this.#m.toggle(ev, box);

  closeForwardMenu = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  /**
   * menu-runner 통로(스냅샷 → 닫기 → 실행) — 순서를 뒤집으면 항목이 조용히 죽는다.
   * 고른 포워드는 마크업이 인자로 넘긴다 — 닫히면 사라지는 목록에서 왔다.
   */
  runForwardMenu = (fn: (box: HostBox) => void) => this.#m.run(fn);
}
