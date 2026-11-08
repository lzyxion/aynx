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

/**
 * **뒤로 / 앞으로 배선** — 순수 모델(`$lib/nav-history`) 위의 상태 한 칸과 손잡이
 * (docs/log/2026-09-04-nav-history.md · docs/log/2026-09-05-refactor-browsers.md).
 *
 * 두 타일이 같은 배선을 각자 갖고 있었다: 이력 한 칸, "지금 도는 이동이 뒤로/앞으로인가"
 * 표식, 실패하면 그 자리를 이력에서 떨어내는 규칙, 마우스 5버튼 두 핸들러, 전용 ⏴/⏵ 키.
 * 다른 것은 **"거기로 갈 수 있는가" 를 어떻게 확인하느냐** 하나뿐이라 그것만 콜백으로 받는다.
 *
 * ## 갈 수 있는지는 화면이 안다
 *
 * 파일 타일은 실제로 읽어 봐야 알고(권한·삭제된 폴더), 세션 타일은 지금 목록에 그 그룹이
 * 남아 있는지로 안다. 어느 쪽이든 **성공했을 때만 커서를 옮긴다** — 실패하면 그 항목을
 * 이력에서 떨어내고 **멈춘다**. 다음 항목까지 자동으로 더듬어 가지 않는 이유는 한 번 누른
 * 것이 두 칸을 움직이면 어디로 가는지 예측할 수 없기 때문이다.
 */
export interface NavOptions {
  /**
   * 시작 자리를 **미리 한 칸 쌓아 둔다** (세션 타일의 홈 `""`). 그러지 않으면 첫 이동 뒤에
   * 이력이 한 칸뿐이라 시작 자리로 돌아가는 [뒤로] 가 죽는다. 파일 타일은 첫 `load` 가
   * 스스로 쌓으므로 생략한다.
   */
  initial?: string;
  /** 지금 움직여도 되는가 (파일 타일: 끊겼거나 읽는 중이면 안 된다) */
  ready?: () => boolean;
  /** 그 자리로 실제로 간다 — **성공했으면 `true`** */
  go: (path: string) => boolean | Promise<boolean>;
  /** 못 갔다 — 그 자리는 이력에서 떨어졌다 (안내가 필요하면 여기서) */
  onDropped?: (path: string) => void;
}

export class NavController {
  #opts: NavOptions;
  #history = $state<NavHistory>(emptyHistory());
  /**
   * 지금 도는 이동이 뒤로/앞으로인가. `$state` 가 아니다 — 렌더에 쓰이지 않고 [`go`] 와
   * [`push`] 사이에서만 오가는 표식이다. 이 깃발이 없으면 뒤로 간 것이 다시 이력에 쌓여
   * [뒤로] 를 눌러도 제자리를 맴돈다.
   */
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

  /**
   * 새 자리에 도착했다 — **이력의 유일한 입구**다. 뒤로/앞으로가 도는 중이면 쌓지 않고,
   * 같은 자리를 연달아 밀면 모델이 알아서 무시한다.
   */
  push(path: string): void {
    if (!this.#moving) this.#history = pushHistory(this.#history, path);
  }

  /** 이력을 한 걸음 옮긴다 — 성공했을 때만 커서를 옮긴다 (위 머리말) */
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
   * 마우스 뒤로/앞으로 버튼. **`mouseup` 에서 움직이고 `auxclick` 에서는 막기만 한다** —
   * 둘 다 오므로 양쪽에서 움직이면 한 번 눌러 두 칸을 간다.
   *
   * `preventDefault` 는 WebView2 가 이 버튼을 **세션 이력의 뒤로가기**로 읽어 SPA 한 장짜리
   * 앱을 빈 화면으로 만드는 것을 막는다 (전역 차단이 `+page` 에 한 겹 더 있다 — 타일 밖에서
   * 눌렀을 때를 위해).
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

  /**
   * 멀티미디어 키보드의 전용 ⏴/⏵ — **수식 키와 무관하게** 언제나 뒤로/앞으로다 (이 키에는
   * 다른 뜻이 있을 수 없다). 가져갔으면 `true` 를 돌려주므로 호출부는 그 자리에서 물러난다.
   */
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
