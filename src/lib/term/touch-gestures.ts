// 터미널 터치 몸짓 — 세로 끌기 = 스크롤, 길게 누르기 = 낱말 선택(떼지 않고 끌면 늘어남 · 빈 자리면 타일 메뉴). 과한 몸짓은 넣지 않는다.
// 뗀 뒤의 손잡이 · 띠는 `Terminal` 과 `TouchSelection.svelte` 몫이다 — 손잡이를 잡으면 `startSelecting` 으로 같은 고르기에 들어온다.
// 가로로 먼저 움직이면 손대지 않는다 — 다른 창 크기로 그리는 상자(`.term-screen.foreign`)의 가로 스크롤은 브라우저가 한다.
// alt 화면 · 마우스 추적 프로그램은 스크롤백을 밀어도 안 보이므로 부르는 쪽이 `wheelLines` 로 휠 사건을 만든다.
// iOS 는 길게 눌러도 `contextmenu` 를 내지 않아 직접 잰다. Android 는 `contextmenu` 도 낸다(우리 시계보다 이를 수 있다) — `nativeLongPress` 가 받는다.

export interface TouchHooks {
  /** 0 이하면 스크롤하지 않는다 */
  rowHeight(): number;
  /** 음수 = 위(지난 출력) · `x` · `y` 는 끌기를 시작한 화면 좌표(휠 사건의 자리) */
  scrollLines(n: number, x: number, y: number): void;
  /** 길게 누른 자리의 낱말을 고른다 — `false`(고를 글이 없다)면 곧바로 `longPress` */
  selectStart(x: number, y: number): boolean;
  /** 돌려주는 값 = 가장자리 스크롤 방향(-1 위 · 1 아래 · 0 없음) — 0 이 아닌 동안 `SELECT_SCROLL_MS` 마다 `selectScroll` 뒤 같은 자리로 다시 부른다 */
  selectTo(x: number, y: number): number;
  selectScroll(dir: number): void;
  /** 고르기가 끝났다 — `lifted` = 손을 뗐다(취소 · 걷기가 아니다) */
  selectEnd(lifted: boolean): void;
  /** 고를 글이 없는 자리를 길게 눌렀다 — 메뉴 */
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
/** 고르다 가장자리에 머물 때 한 줄씩 넘기는 간격 */
export const SELECT_SCROLL_MS = 60;

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
  /** 길게 누르기가 낱말을 골랐다 — 뗄 때까지 끌기는 선택을 늘린다 */
  #selecting = false;
  #down = false;
  #x = 0;
  #y = 0;
  #drift = 0;
  #driftTimer: unknown = null;

  constructor(hooks: TouchHooks, clock: TouchClock = realClock) {
    this.#h = hooks;
    this.#clock = clock;
  }

  /** 둘 이상이면 부르는 쪽이 `cancel` */
  start(x: number, y: number): void {
    this.cancel();
    this.#active = true;
    this.#down = true;
    this.#x0 = x;
    this.#y0 = y;
    this.#x = x;
    this.#y = y;
    this.#lastY = y;
    this.#carry = 0;
    this.#axis = null;
    this.#fired = false;
    this.#timer = this.#clock.set(() => {
      this.#timer = null;
      if (!this.#active || this.#axis !== null) return;
      this.#fire();
    }, LONG_PRESS_MS);
  }

  #fire(): void {
    this.#stopTimer();
    this.#fired = true;
    this.#longAt = this.#clock.now();
    if (this.#h.selectStart(this.#x0, this.#y0)) {
      this.#selecting = true;
      return;
    }
    this.#active = false;
    this.#h.longPress(this.#x0, this.#y0);
  }

  /** `true` 면 부르는 쪽이 `preventDefault` — 브라우저가 화면을 끌지 않게 */
  move(x: number, y: number): boolean {
    if (!this.#active) return false;
    if (this.#selecting) {
      this.#x = x;
      this.#y = y;
      this.#setDrift(this.#h.selectTo(x, y));
      return true;
    }
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

  /** `true`(길게 누르기 · 고르기였다)면 부르는 쪽이 `preventDefault` — 안 막으면 뒤따르는 탭이 막 뜬 메뉴 줄을 누르거나 선택을 지운다. */
  end(): boolean {
    this.#stop(true);
    const fired = this.#fired;
    this.#fired = false;
    return fired;
  }

  cancel(): void {
    this.#stop(false);
  }

  #stop(lifted: boolean): void {
    this.#active = false;
    this.#down = false;
    this.#stopTimer();
    this.#setDrift(0);
    if (this.#selecting) {
      this.#selecting = false;
      this.#h.selectEnd(lifted);
    }
  }

  /** 선택 손잡이를 잡았다 — 길게 누르기 없이 곧바로 고르기(끌기 · 가장자리 넘기기 · 끝은 길게 눌러 고를 때와 같다) */
  startSelecting(x: number, y: number): void {
    this.cancel();
    this.#active = true;
    this.#down = true;
    this.#selecting = true;
    this.#fired = true;
    this.#axis = null;
    this.#x0 = x;
    this.#y0 = y;
    this.#x = x;
    this.#y = y;
  }

  /** 손가락 하나가 닿아 있다 — 메뉴를 이미 낸 뒤에도 뗄 때까지 참 */
  down(): boolean {
    return this.#down;
  }

  justLongPressed(): boolean {
    return this.#clock.now() - this.#longAt < 1_000;
  }

  /** `contextmenu` 가 왔다 — 손가락이 닿아 있으면 그것이 길게 누르기다. `true` 면 부르는 쪽은 메뉴를 열지 않는다(이쪽이 연다). */
  nativeLongPress(): boolean {
    if (this.#selecting || this.justLongPressed()) return true;
    if (!this.#active || this.#axis !== null) return false;
    this.#fire();
    return true;
  }

  /** 손가락이 가장자리에 멈춰 있어도(`touchmove` 가 오지 않는다) 계속 넘긴다 */
  #setDrift(dir: number): void {
    this.#drift = dir;
    if (dir === 0) {
      if (this.#driftTimer !== null) this.#clock.clear(this.#driftTimer);
      this.#driftTimer = null;
      return;
    }
    if (this.#driftTimer !== null) return;
    const step = () => {
      this.#driftTimer = null;
      if (!this.#selecting || this.#drift === 0) return;
      this.#h.selectScroll(this.#drift);
      this.#drift = this.#h.selectTo(this.#x, this.#y);
      if (this.#drift !== 0) this.#driftTimer = this.#clock.set(step, SELECT_SCROLL_MS);
    };
    this.#driftTimer = this.#clock.set(step, SELECT_SCROLL_MS);
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

/** 닿은 자리가 선택 손잡이면 `select`(곧바로 고르기), 띠 같은 제 단추면 `ignore`(몸짓 없음 — 탭이 그대로 간다) */
export type TouchGrab = (target: EventTarget | null, x: number, y: number) => "select" | "ignore" | null;

export function attachTouchGestures(el: HTMLElement, g: TouchGestures, grab?: TouchGrab): () => void {
  const onStart = (ev: TouchEvent) => {
    if (ev.touches.length !== 1) {
      g.cancel();
      return;
    }
    const p = ev.touches[0];
    const kind = grab?.(ev.target, p.clientX, p.clientY) ?? null;
    if (kind === "ignore") g.cancel();
    else if (kind === "select") g.startSelecting(p.clientX, p.clientY);
    else g.start(p.clientX, p.clientY);
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
