// 머리줄 "+N" 칩의 메뉴 — 넘쳐서 숨은 칩들. 줄을 누르면 그 칩을 누른 것과 같은 일을 한다.
import { createChipMenu } from "$lib/pane/chip-menu.svelte.js";
import type { HostBox } from "$lib/pane/boxes";
import type { HeaderChipId } from "$lib/header-chips";

/** `null` 은 보기만 하는 줄(경유) */
export type ChipMoreAction = "files" | "branch" | "tmux" | "forward" | "resource" | null;

export interface ChipMoreItem {
  id: HeaderChipId;
  icon: string;
  label: string;
  title?: string;
  muted?: boolean;
  action: ChipMoreAction;
  /** detached 면 `null` */
  branch?: string | null;
}

const CHIP_MORE_MENU_WIDTH = 300;

export interface ChipMoreMenuHost {
  readonly boxes: HostBox[];
}

export class ChipMoreMenuController {
  #m;

  /** 여는 순간 칩이 지어 올린 사본 — 열려 있는 동안 숫자는 그대로다 */
  items = $state<ChipMoreItem[]>([]);

  constructor(h: ChipMoreMenuHost) {
    this.#m = createChipMenu({ boxes: () => h.boxes, width: CHIP_MORE_MENU_WIDTH });
  }

  get at() {
    return this.#m.at;
  }

  get box() {
    return this.#m.box;
  }

  toggle = (ev: MouseEvent, box: HostBox, items: ChipMoreItem[]) => {
    this.items = items;
    this.#m.toggle(ev, box);
  };

  close = (back: "none" | "back" | "trigger" = "none") => this.#m.close(back);

  run = (fn: (box: HostBox) => void) => this.#m.run(fn);
}
