// **터미널 터치 몸짓**(원격 웹 R5 — 폰 · 태블릿의 원격 창). 둘뿐이다 — 과한 몸짓은 넣지 않는다.
//
// - **세로로 끌기 = 스크롤백 스크롤.** xterm 은 휠만 받고 손가락 끌기는 스크롤로 바꾸지 않는다. 한 줄 높이만큼 끌 때마다 한 줄. 가로로
//   먼저 움직이면 손대지 않는다 — 다른 창 크기로 그리는 상자(`.term-screen.foreign`)의 가로 스크롤은 브라우저가 한다.
//   스크롤백이 없는 화면(alt 화면 — Claude Code `tui: fullscreen` · tmux · vim)이나 마우스를 추적하는 프로그램은 xterm 스크롤백을 밀어도
//   아무것도 안 보인다(10-26 — 폰에서 앞 대화를 못 올려 봤다). 그때는 [`wheelLines`] 로 **휠 사건**을 만들어 xterm 의 휠 규칙(마우스 보고 ·
//   화살표 키)에 맡긴다 — 데스크톱에서 휠을 굴린 것과 같은 길이다. 가르는 것은 부르는 쪽(`Terminal.svelte`)이다.
// - **길게 누르기 = 타일 메뉴**(복사 · 붙여넣기 · 모두 선택). iOS 는 길게 눌러도 `contextmenu` 를 내지 않아 직접 잰다. Android 는 그 뒤
//   `contextmenu` 도 내므로 부르는 쪽이 곧이은 것을 한 번 거른다([`TouchGestures.justLongPressed`]).
//
// 상태 기계([`TouchGestures`])는 DOM 을 모른다 — 시험이 좌표 · 시계로 바로 몬다. [`attachTouchGestures`] 가 DOM 사건을 잇는다.

export interface TouchHooks {
  /** 한 줄 높이(px) — 0 이하면 스크롤하지 않는다 */
  rowHeight(): number;
  /** 줄 수만큼 스크롤(음수 = 위 · 지난 출력 쪽) — `x` · `y` 는 끌기를 시작한 화면 좌표(휠 사건의 자리) */
  scrollLines(n: number, x: number, y: number): void;
  /** 길게 눌렀다 — 화면 좌표 */
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
  /** 끌기 방향이 정해졌나 — `v` 세로(우리가 스크롤) · `h` 가로(브라우저) · `null` 아직 */
  #axis: "v" | "h" | null = null;
  #timer: unknown = null;
  #active = false;
  #longAt = -Infinity;
  /** 이 손가락이 길게 누르기를 냈다 — 뗄 때 브라우저의 탭(호환 마우스 사건 · click)을 막는다 */
  #fired = false;

  constructor(hooks: TouchHooks, clock: TouchClock = realClock) {
    this.#h = hooks;
    this.#clock = clock;
  }

  /** 손가락 하나가 닿았다(둘 이상이면 부르는 쪽이 `cancel`) */
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

  /** 움직였다 — `true` 면 이 사건은 우리가 썼다(부르는 쪽이 `preventDefault` — 브라우저가 화면을 끌지 않게) */
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
      // 손가락을 아래로 끌면(+) 지난 출력(위)을 본다 — 휴대폰 목록과 같은 방향
      this.#h.scrollLines(-lines, this.#x0, this.#y0);
    }
    return true;
  }

  /**
   * 뗐다 — `true` 면 이 손가락이 길게 누르기를 냈다: 부르는 쪽이 `preventDefault` 해 브라우저가 탭으로 치지 않게 한다(안 막으면 손가락
   * 밑에 막 뜬 메뉴 줄이 눌린다 — 실기에서 "붙여넣기" 가 눌렸다).
   */
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

  /** 방금(1초 안) 길게 누르기를 냈나 — 곧이어 오는 브라우저 `contextmenu` 를 거른다 */
  justLongPressed(): boolean {
    return this.#clock.now() - this.#longAt < 1_000;
  }

  #stopTimer(): void {
    if (this.#timer !== null) this.#clock.clear(this.#timer);
    this.#timer = null;
  }
}

/**
 * 줄 수만큼의 **휠 사건**을 xterm 요소(`term.element` — xterm 이 휠을 받는 곳)에 쏜다(음수 = 위). xterm 은 휠 사건 하나에 마우스 보고 ·
 * 화살표 키 하나를 내므로 한 줄에 사건 하나(`DOM_DELTA_LINE` · ±1)다. 좌표는 마우스 보고의 칸 자리다.
 */
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

/** DOM 에 잇는다 — 떼는 함수를 돌려준다 */
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
