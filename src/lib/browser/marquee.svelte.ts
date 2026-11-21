import type { Box, SelectionState } from "$lib/selection";

/** 좌표는 전부 스크롤 상자의 내용 좌표(상자 기준 + 스크롤 오프셋)다 — 화면 좌표로 두면 스크롤될 때 사각형이 항목과 어긋난다 */
export interface MarqueeOptions {
  root: () => HTMLElement | null;
  /** 마퀴와 같은 내용 좌표계로 — [`boxesIn`] */
  rects: () => { id: string; rect: Box }[];
  selection: () => SelectionState;
  apply: (rects: readonly { id: string; rect: Box }[], box: Box, additive: boolean, base: SelectionState) => void;
  onEmptyClick: () => void;
  isItem: (target: EventTarget | null) => boolean;
}

const MARQUEE_MIN_PX = 4;

interface MarqueeState {
  x0: number;
  y0: number;
  x: number;
  y: number;
  base: SelectionState;
  additive: boolean;
  active: boolean;
  pointerId: number;
}

export class MarqueeController {
  #opts: MarqueeOptions;
  #drag = $state<MarqueeState | null>(null);

  constructor(opts: MarqueeOptions) {
    this.#opts = opts;
  }

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

  #point(ev: PointerEvent): { x: number; y: number } {
    const el = this.#opts.root();
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: ev.clientX - r.left + el.scrollLeft, y: ev.clientY - r.top + el.scrollTop };
  }

  pointerdown = (ev: PointerEvent): void => {
    const el = this.#opts.root();
    if (ev.button !== 0 || !el) return;
    if (this.#opts.isItem(ev.target)) return;
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
    if (!m.active && !m.additive) this.#opts.onEmptyClick();
  };
}

export function createMarquee(opts: MarqueeOptions): MarqueeController {
  return new MarqueeController(opts);
}

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
