// 터미널 터치 몸짓 둘뿐 — 세로 끌기 = 스크롤, 길게 누르기 = 타일 메뉴. 과한 몸짓은 넣지 않는다.
// 가로로 먼저 움직이면 손대지 않는다 — 다른 창 크기로 그리는 상자(`.term-screen.foreign`)의 가로 스크롤은 브라우저가 한다.
// alt 화면 · 마우스 추적 프로그램은 스크롤백을 밀어도 안 보이므로 부르는 쪽이 `wheelLines` 로 휠 사건을 만든다.
// iOS 는 길게 눌러도 `contextmenu` 를 내지 않아 직접 잰다. Android 는 그 뒤 `contextmenu` 도 내므로 `justLongPressed` 로 한 번 거른다.

export interface TouchHooks {
  /** 0 이하면 스크롤하지 않는다 */
  rowHeight(): number;
  /** 음수 = 위(지난 출력) · `x` · `y` 는 끌기를 시작한 화면 좌표(휠 사건의 자리) */
  scrollLines(n: number, x: number, y: number): void;
  longPress(x: number, y: number): void;
}

export interface TouchClock {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

export const LONG_PRESS_MS = 500;
/** 이만큼(px) 움직이면 누르기가 아니라 끌기 */
export const TOUCH_SLOP = 8;

const realClock: TouchClock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class TouchGestures {
  #h: TouchHooks;
  #clock: TouchClock;
  #x0 = 0;
  #y0 = 0;
  #lastY = 0;
  #carry = 0;
  /** `v` 세로(우리가 스크롤) · `h` 가로(브라우저) · `null` 아직 */
  #axis: "v" | "h" | null = null;
  #timer: unknown = null;
  #active = false;
  #longAt = -Infinity;
  #fired = false;

  constructor(hooks: TouchHooks, clock: TouchClock = realClock) {
    this.#h = hooks;
    this.#clock = clock;
  }

  /** 둘 이상이면 부르는 쪽이 `cancel` */
  start(x: number, y: number): void {
    this.cancel();
    this.#active = true;
    this.#x0 = x;
    this.#y0 = y;
    this.#lastY = y;
    this.#carry = 0;
    this.#axis = null;
    this.#fired = false;
    this.#timer = this.#clock.set(() => {
      this.#timer = null;
      if (!this.#active || this.#axis !== null) return;
      this.#active = false;
      this.#fired = true;
      this.#longAt = this.#clock.now();
      this.#h.longPress(this.#x0, this.#y0);
    }, LONG_PRESS_MS);
  }

  /** `true` 면 부르는 쪽이 `preventDefault` — 브라우저가 화면을 끌지 않게 */
  move(x: number, y: number): boolean {
    if (!this.#active) return false;
    if (this.#axis === null) {
      const dx = Math.abs(x - this.#x0);
      const dy = Math.abs(y - this.#y0);
      if (dx < TOUCH_SLOP && dy < TOUCH_SLOP) return false;
      this.#stopTimer();
      this.#axis = dy >= dx ? "v" : "h";
    }
    if (this.#axis !== "v") return false;
    const row = this.#h.rowHeight();
    if (row <= 0) return true;
    this.#carry += y - this.#lastY;
    this.#lastY = y;
    const lines = Math.trunc(this.#carry / row);
    if (lines !== 0) {
      this.#carry -= lines * row;
      this.#h.scrollLines(-lines, this.#x0, this.#y0);
    }
    return true;
  }

  /** `true`(길게 누르기를 냈다)면 부르는 쪽이 `preventDefault` — 안 막으면 손가락 밑에 막 뜬 메뉴 줄이 탭으로 눌린다. */
  end(): boolean {
    this.cancel();
    const fired = this.#fired;
    this.#fired = false;
    return fired;
  }

  cancel(): void {
    this.#active = false;
    this.#stopTimer();
  }

  justLongPressed(): boolean {
    return this.#clock.now() - this.#longAt < 1_000;
  }

  #stopTimer(): void {
    if (this.#timer !== null) this.#clock.clear(this.#timer);
    this.#timer = null;
  }
}

/** xterm 은 휠 사건 하나에 마우스 보고 · 화살표 키 하나를 내므로 한 줄에 사건 하나(`DOM_DELTA_LINE` · ±1)다. */
export function wheelLines(el: Element, n: number, x: number, y: number): void {
  const deltaY = n < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(n); i++) {
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
}

export function attachTouchGestures(el: HTMLElement, g: TouchGestures): () => void {
  const onStart = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) {
      g.cancel();
      return;
    }
    const p = ev.touches[0];
    g.start(p.clientX, p.clientY);
  };
  const onMove = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) {
      g.cancel();
      return;
    }
    const p = ev.touches[0];
    if (g.move(p.clientX, p.clientY) && ev.cancelable) ev.preventDefault();
  };
  const onEnd = (ev: TouchEvent) => {
    if (g.end() && ev.cancelable) ev.preventDefault();
  };
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd, { passive: false });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  return () => {
    g.cancel();
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
  };
}
