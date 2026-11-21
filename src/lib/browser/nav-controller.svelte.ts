import {
  back as backStep,
  canBack,
  canForward,
  dropAt,
  emptyHistory,
  forward as forwardStep,
  navButtonOf,
  navKeyOf,
  push as pushHistory,
  type NavHistory,
} from "$lib/nav-history";

/** 못 간 자리는 이력에서 떨어내고 멈춘다 — 다음 항목까지 더듬어 가면 한 번 누른 것이 두 칸을 움직여 어디로 갈지 모른다 */
export interface NavOptions {
  /** 시작 자리를 미리 쌓는다 — 없으면 첫 이동 뒤 [뒤로] 로 시작 자리에 못 돌아간다 */
  initial?: string;
  ready?: () => boolean;
  /** 성공했으면 `true` — 그때만 커서를 옮긴다 */
  go: (path: string) => boolean | Promise<boolean>;
  onDropped?: (path: string) => void;
}

export class NavController {
  #opts: NavOptions;
  #history = $state<NavHistory>(emptyHistory());
  /** 없으면 뒤로 간 자리가 다시 이력에 쌓여 [뒤로] 가 제자리를 맴돈다 */
  #moving = false;

  constructor(opts: NavOptions) {
    this.#opts = opts;
    if (opts.initial !== undefined) this.#history = pushHistory(emptyHistory(), opts.initial);
  }

  get canBack(): boolean {
    return canBack(this.#history);
  }

  get canForward(): boolean {
    return canForward(this.#history);
  }

  push(path: string): void {
    if (!this.#moving) this.#history = pushHistory(this.#history, path);
  }

  async go(dir: "back" | "forward"): Promise<void> {
    if (this.#opts.ready && !this.#opts.ready()) return;
    const move = (dir === "back" ? backStep : forwardStep)(this.#history);
    if (!move) return;
    this.#moving = true;
    let ok = false;
    try {
      ok = await this.#opts.go(move.path);
    } finally {
      this.#moving = false;
    }
    if (ok) {
      this.#history = move.h;
      return;
    }
    this.#history = dropAt(this.#history, move.h.index);
    this.#opts.onDropped?.(move.path);
  }

  /**
   * `mouseup` 에서만 움직이고 `auxclick` 은 막기만 한다 — 둘 다 오므로 양쪽에서 움직이면 두 칸을 간다.
   * `preventDefault` 를 빼면 WebView2 가 이 버튼을 세션 이력의 뒤로가기로 읽어 앱이 빈 화면이 된다.
   */
  mouseUp = (ev: MouseEvent): void => {
    const dir = navButtonOf(ev.button);
    if (!dir) return;
    ev.preventDefault();
    ev.stopPropagation();
    void this.go(dir);
  };

  auxClick = (ev: MouseEvent): void => {
    if (!navButtonOf(ev.button)) return;
    ev.preventDefault();
    ev.stopPropagation();
  };

  tryKey = (ev: KeyboardEvent): boolean => {
    const dir = navKeyOf(ev);
    if (!dir) return false;
    ev.preventDefault();
    ev.stopPropagation();
    void this.go(dir);
    return true;
  };
}

export function createNav(opts: NavOptions): NavController {
  return new NavController(opts);
}
