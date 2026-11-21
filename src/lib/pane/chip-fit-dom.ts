/**
 * 타일 머리줄 칩 접기의 재기 · 입히기(DOM) — 판정은 `chip-fit.ts`.
 * 표식 약속(`PaneHeader` · `HeaderChips`): 묶음 `data-chip-fit` 의 직계 자식 — 칩 `data-fit-chip="<id>"` · `data-fit-forms` · `data-fit-pin`,
 * 이름 `data-fit-name`, "+N" `data-chip-more`. 재는 동안의 `data-chip-measure` 는 모든 칩을 그 꼴로 세운다 — 접기가 제 결과로 다시 접히는 고리가 없다.
 * 몫은 포커스 밖에서 접힌 `⋯ ⤢ ×` 가 펴졌을 때의 폭이다 — 아니면 호버마다 칩이 접혔다 펴진다.
 */
import { chipBudget, fitChips, type ChipFitMode, type FitChip, type FitResult, type FitState } from "$lib/pane/chip-fit";

/** 칩의 `widths` 자리와 같은 차례 */
const MEASURE_MODES: readonly ChipFitMode[] = ["full", "compact", "icon"];

const OVERFLOW_FALLBACK_PX = 30;

interface MeasuredChip {
  id: string;
  el: HTMLElement;
  forms: number;
  pinned: boolean;
  widths: number[];
}

function widthOf(el: Element): number {
  const r = el.getBoundingClientRect().width;
  return Math.max(r, el instanceof HTMLElement ? el.scrollWidth : 0);
}

class Fitter {
  readonly box: HTMLElement;
  readonly #apply: (r: FitResult) => void;
  dirty = true;
  #prev: FitState | null = null;
  #applied = "";

  #chips: MeasuredChip[] = [];
  #nameNatural = 0;
  #nameMargin = 0;
  #fixed: number[] = [];
  #overflowW = OVERFLOW_FALLBACK_PX;
  #gap = 0;
  #contentFull = 0;

  #width = 0;
  #reserve = 0;
  #capped = false;
  skip = false;

  #ro: ResizeObserver;
  #mo: MutationObserver;

  constructor(box: HTMLElement, apply: (r: FitResult) => void) {
    this.box = box;
    this.#apply = apply;
    this.#ro = new ResizeObserver((entries) => {
      if (entries.some((e) => e.target !== this.box)) this.dirty = true;
      schedule(this);
    });
    this.#mo = new MutationObserver((records) => {
      if (records.some((r) => r.type === "childList")) this.#observeChips();
      this.dirty = true;
      schedule(this);
    });
    this.#ro.observe(box);
    this.#observeChips();
    this.#mo.observe(box, { childList: true, characterData: true, subtree: true });
  }

  #observed = new Set<Element>();
  #observeChips(): void {
    const now = new Set<Element>(this.box.querySelectorAll(":scope > [data-fit-chip]"));
    for (const el of this.#observed) if (!now.has(el)) this.#ro.unobserve(el);
    for (const el of now) if (!this.#observed.has(el)) this.#ro.observe(el);
    this.#observed = now;
  }

  stop(): void {
    this.#ro.disconnect();
    this.#mo.disconnect();
    this.box.removeAttribute("data-chip-measure");
  }

  readSize(): void {
    this.skip = !this.box.isConnected || this.box.getClientRects().length === 0;
    if (this.skip) return;
    const head = this.box.closest("[data-pane-head]");
    this.#capped = head?.classList.contains("has-tools") ?? false;
    if (this.#capped) {
      // 도구줄 머리줄은 묶음 폭이 내용을 따른다 — 지금 폭은 지금 꼴의 폭일 뿐이라 늘 제 폭 꼴로 다시 잰다
      this.dirty = true;
      return;
    }
    this.#width = this.box.getBoundingClientRect().width;
    let reserve = 0;
    if (head) {
      for (const btn of head.querySelectorAll<HTMLElement>(":scope > .head-btn")) {
        const r = btn.getBoundingClientRect();
        const ml = parseFloat(getComputedStyle(btn).marginInlineStart) || 0;
        reserve += Math.max(0, r.height - r.width - ml);
      }
    }
    this.#reserve = reserve;
  }

  forms(): number {
    let n = 1;
    for (const el of this.box.querySelectorAll<HTMLElement>(":scope > [data-fit-chip]")) {
      n = Math.max(n, Number(el.dataset.fitForms) || 1);
    }
    return n;
  }

  readLevel(level: number): void {
    if (level === 0) {
      const style = getComputedStyle(this.box);
      this.#gap = parseFloat(style.columnGap) || 0;
      this.#chips = [];
      this.#fixed = [];
      this.#nameNatural = 0;
      this.#nameMargin = 0;
      this.#overflowW = OVERFLOW_FALLBACK_PX;
      let content = 0;
      let cells = 0;
      for (const el of this.box.children) {
        if (!(el instanceof HTMLElement)) continue;
        const w = widthOf(el);
        if (el.dataset.fitChip !== undefined) {
          this.#chips.push({
            id: el.dataset.fitChip,
            el,
            forms: Math.max(1, Math.min(MEASURE_MODES.length, Number(el.dataset.fitForms) || 1)),
            pinned: el.dataset.fitPin !== undefined,
            widths: [w],
          });
          content += w;
          cells++;
        } else if (el.dataset.chipMore !== undefined) {
          if (w > 0) this.#overflowW = w;
        } else if (el.dataset.fitName !== undefined) {
          this.#nameNatural = el.scrollWidth;
          this.#nameMargin = parseFloat(getComputedStyle(el).marginRight) || 0;
          content += this.#nameNatural + this.#nameMargin;
          cells++;
        } else if (el.getClientRects().length > 0 && w > 0) {
          const cs = getComputedStyle(el);
          const fw = w + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
          this.#fixed.push(fw);
          content += fw;
          cells++;
        }
      }
      this.#contentFull = content + Math.max(0, cells - 1) * this.#gap;
      if (this.#capped) this.#width = this.box.getBoundingClientRect().width;
      return;
    }
    for (const c of this.#chips) {
      if (c.forms > level) c.widths[level] = widthOf(c.el);
    }
  }

  decide(): void {
    if (this.skip) return;
    let boxWidth = this.#width;
    if (this.#capped) {
      if (boxWidth + 0.5 >= this.#contentFull) boxWidth = Number.POSITIVE_INFINITY;
    } else {
      boxWidth -= this.#reserve;
    }
    const chips: FitChip[] = this.#chips.map((c) => ({ id: c.id, widths: c.widths, pinned: c.pinned }));
    const available = chipBudget({
      boxWidth,
      nameNatural: this.#nameNatural,
      nameMargin: this.#nameMargin,
      fixed: this.#fixed,
      gap: this.#gap,
    });
    const r = fitChips({ chips, available, gap: this.#gap, overflowWidth: this.#overflowW, prev: this.#prev });
    this.#prev = { step: r.step, signature: r.signature };
    const key = `${r.signature}|${r.modes.join(",")}`;
    if (key === this.#applied) return;
    this.#applied = key;
    this.#apply(r);
  }
}

// ── 창 전체가 한 rAF 에 ──────────────────────────────────────────────────────

const all = new Set<Fitter>();
const pending = new Set<Fitter>();
let raf = 0;
let fontsHooked = false;

function schedule(f: Fitter): void {
  pending.add(f);
  if (raf === 0) raf = requestAnimationFrame(flush);
}

function flush(): void {
  raf = 0;
  const list = [...pending].filter((f) => all.has(f));
  pending.clear();
  // 읽기 → (꼴마다) 모두 쓰고 모두 읽기 → 판정 — 섞으면 타일 수만큼 강제 배치가 난다
  for (const f of list) f.readSize();
  const live = list.filter((f) => !f.skip);
  const dirty = live.filter((f) => f.dirty);
  const forms = dirty.reduce((n, f) => Math.max(n, f.forms()), 1);
  for (let level = 0; level < forms; level++) {
    for (const f of dirty) f.box.setAttribute("data-chip-measure", MEASURE_MODES[level]);
    for (const f of dirty) f.readLevel(level);
  }
  for (const f of dirty) {
    f.box.removeAttribute("data-chip-measure");
    f.dirty = false;
  }
  for (const f of live) f.decide();
}

function hookFonts(): void {
  if (fontsHooked || typeof document === "undefined" || !document.fonts) return;
  fontsHooked = true;
  const again = () => {
    for (const f of all) {
      f.dirty = true;
      schedule(f);
    }
  };
  document.fonts.addEventListener?.("loadingdone", again);
  void document.fonts.ready.then(again);
}

export function observeChipFit(box: HTMLElement, apply: (r: FitResult) => void): () => void {
  if (typeof ResizeObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};
  hookFonts();
  const f = new Fitter(box, apply);
  all.add(f);
  schedule(f);
  return () => {
    all.delete(f);
    pending.delete(f);
    f.stop();
  };
}
