import type { Box, SelectionState } from "$lib/selection";

/**
 * **러버밴드(마퀴)** — 빈 곳에서 그어 여러 개를 한 번에 고른다.
 *
 * 좌표는 전부 **스크롤 상자의 내용 좌표**다 (상자 기준 + 스크롤 오프셋). 화면 좌표로 두면
 * 목록이 스크롤될 때 그려 둔 사각형이 항목과 어긋난다. 사각형 요소도 같은 좌표계의
 * `position:absolute` 라 내용과 함께 움직인다.
 *
 * **항목 위에서 시작한 포인터는 마퀴가 아니다** — 그쪽은 HTML5 드래그(옮기기)의 자리다.
 * 무엇이 "항목" 인지는 타일마다 다르므로([`MarqueeOptions.isItem`]) 그 한 줄만 인자로 받는다.
 *
 * 파일 타일과 세션 타일이 이 기계장치를 **글자 그대로 같이** 갖고 있었다 (문턱 4px, 포인터
 * 캡처, 빈 곳 클릭 = 선택 해제까지). 다른 것은 좌표 원점이 될 요소와 항목 판정뿐이라,
 * 그 둘만 콜백으로 받고 나머지는 여기 한 벌만 남긴다.
 */
export interface MarqueeOptions {
  /** 좌표 원점이자 포인터를 잡아 둘 스크롤 상자 */
  root: () => HTMLElement | null;
  /** 지금 그려져 있는 항목들의 사각형 — **마퀴와 같은 내용 좌표계**로 (아래 [`boxesIn`]) */
  rects: () => { id: string; rect: Box }[];
  /** 지금 선택 — 그리기 시작할 때 한 번 떠서 `base` 로 삼는다 */
  selection: () => SelectionState;
  /** 매 프레임의 판정 결과 */
  apply: (rects: readonly { id: string; rect: Box }[], box: Box, additive: boolean, base: SelectionState) => void;
  /** 긋지 않고 그냥 눌렀다 뗐다 = 빈 곳 클릭 (Ctrl 이면 부르지 않는다) */
  onEmptyClick: () => void;
  /** 이 포인터가 **항목 위**에서 올라왔는가 — 참이면 마퀴는 시작하지 않는다 */
  isItem: (target: EventTarget | null) => boolean;
}

/** 이만큼 움직이기 전에는 마퀴로 치지 않는다 — 그 전에 손을 떼면 "빈 곳 클릭" 이다 */
const MARQUEE_MIN_PX = 4;

interface MarqueeState {
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** 그리기 시작할 때의 선택 — Ctrl 로 더할 때의 바탕이자, 되돌릴 때의 기준이다 */
  base: SelectionState;
  additive: boolean;
  /** 문턱을 넘었는가 (넘기 전에는 사각형도 그리지 않는다) */
  active: boolean;
  pointerId: number;
}

export class MarqueeController {
  #opts: MarqueeOptions;
  #drag = $state<MarqueeState | null>(null);

  constructor(opts: MarqueeOptions) {
    this.#opts = opts;
  }

  /** 지금 그릴 사각형 (문턱을 못 넘었으면 `null`) — 마크업이 그대로 읽는다 */
  get box(): Box | null {
    const m = this.#drag;
    if (!m || !m.active) return null;
    return {
      left: Math.min(m.x0, m.x),
      top: Math.min(m.y0, m.y),
      right: Math.max(m.x0, m.x),
      bottom: Math.max(m.y0, m.y),
    };
  }

  /** 화면 좌표 → 스크롤 상자의 내용 좌표 */
  #point(ev: PointerEvent): { x: number; y: number } {
    const el = this.#opts.root();
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left + el.scrollLeft, y: ev.clientY - r.top + el.scrollTop };
  }

  pointerdown = (ev: PointerEvent): void => {
    const el = this.#opts.root();
    if (ev.button !== 0 || !el) return;
    if (this.#opts.isItem(ev.target)) return; // 항목 위 = 드래그의 자리다
    const p = this.#point(ev);
    this.#drag = {
      x0: p.x,
      y0: p.y,
      x: p.x,
      y: p.y,
      base: this.#opts.selection(),
      additive: ev.ctrlKey || ev.metaKey,
      active: false,
      pointerId: ev.pointerId,
    };
    // 포인터를 잡아 두면 상자 밖으로 나가도 이동·놓기가 계속 여기로 온다
    el.setPointerCapture(ev.pointerId);
  };

  pointermove = (ev: PointerEvent): void => {
    const m = this.#drag;
    if (!m || ev.pointerId !== m.pointerId) return;
    const p = this.#point(ev);
    const active =
      m.active || Math.abs(p.x - m.x0) >= MARQUEE_MIN_PX || Math.abs(p.y - m.y0) >= MARQUEE_MIN_PX;
    this.#drag = { ...m, x: p.x, y: p.y, active };
    const box = this.box;
    if (box) this.#opts.apply(this.#opts.rects(), box, m.additive, m.base);
  };

  pointerup = (ev: PointerEvent): void => {
    const m = this.#drag;
    if (!m || ev.pointerId !== m.pointerId) return;
    this.#drag = null;
    const el = this.#opts.root();
    if (el?.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
    // 긋지 않고 그냥 눌렀다 뗐다 = **빈 곳 클릭** → 선택 해제 (Ctrl 이면 지킨다)
    if (!m.active && !m.additive) this.#opts.onEmptyClick();
  };
}

export function createMarquee(opts: MarqueeOptions): MarqueeController {
  return new MarqueeController(opts);
}

/**
 * `scope` 안의 `[data-…]` 요소들을 **`root` 의 내용 좌표계**로 옮겨 담는다 — 두 타일의
 * `rowBoxes`/`itemBoxes` 가 이 한 함수였다 (읽는 속성 이름과 상자만 달랐다).
 */
export function boxesIn(
  root: HTMLElement | null,
  scope: HTMLElement | null,
  attr: string,
): { id: string; rect: Box }[] {
  if (!root || !scope) return [];
  const r = root.getBoundingClientRect();
  const dx = root.scrollLeft - r.left;
  const dy = root.scrollTop - r.top;
  const out: { id: string; rect: Box }[] = [];
  for (const node of scope.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const id = node.getAttribute(attr);
    if (!id) continue;
    const b = node.getBoundingClientRect();
    out.push({
      id,
      rect: { left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy },
    });
  }
  return out;
}
