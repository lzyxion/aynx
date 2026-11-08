/**
 * **타일 머리줄 칩 접기 — 재기와 입히기(DOM)** (2026-10-23). 판정은 순수한 짝 `chip-fit.ts`, 그리기는 `HeaderChips.svelte`.
 *
 * ## 무엇을 어디서 재나 — 표식(속성)으로만 안다
 *
 * - 묶음(`PaneHeader` 의 `.pane-ident`) = `data-chip-fit`. 그 **직계** 자식 중
 *   - 칩 = `data-fit-chip="<id>"` · 꼴 수 `data-fit-forms` · 숨기지 않음 `data-fit-pin`(AI 권한),
 *   - 이름 = `data-fit-name`, "+N" 칩 = `data-chip-more`, 그 밖(● · Run 칩) = 칩이 아닌 칸.
 * - 재는 동안 묶음에 `data-chip-measure="full|compact|icon"` 를 잠깐 단다 — `HeaderChips` 의 CSS 가 그동안 **모든 칩을 그 꼴로**
 *   (숨은 칩도 · "+N" 도 세워) 그린다. 그래서 칩마다의 꼴 폭을 지금 입은 꼴과 상관없이 잰다. 판정이 바뀌어 칩이 줄어도 잰 값은
 *   그대로라 다시 재도 같은 답이 나온다 — 접기가 제 결과로 다시 접히는 고리가 없다.
 *
 * ## 언제 재나 — 머리줄마다 관찰자 하나씩, 그림은 창 전체가 한 rAF 에
 *
 * - **내용이 바뀌면 다시 잰다**: 칩이 서거나 빠짐 · 글자(폴더 · 브랜치 · 자원 숫자 · 언어)가 바뀜(`MutationObserver` —
 *   자식 · 글자만, 속성은 안 본다) · 칩 상자의 크기가 바뀜(`ResizeObserver` — 글꼴 크기 설정 등) · 웹 글꼴이 다 실림.
 * - **폭만 바뀌면 재지 않고 판정만** 다시 한다(묶음 `ResizeObserver`).
 * - 모든 머리줄의 일은 한 rAF 에 모아 **읽기 → (재는 꼴마다) 쓰기 한 번 · 읽기 한 번 → 표식 걷기 → 판정** 순서로 한다 — 타일이
 *   몇 개든 강제 배치는 한 프레임에 꼴 수(2~3) + 1 번이다.
 * - 화면에 없는 머리줄(숨은 탭 — 상자 0)은 건너뛰고 "다시 재야 함" 을 쥔 채 둔다(보이면 크기 관찰이 깨운다).
 *
 * ## 몫(폭) — 버튼이 **드러났을 때**의 폭
 *
 * 포커스 밖 타일은 `⋯ ⤢ ×` 가 자리까지 접힌다(`PaneHeader` 의 "드러냄" — 호버하면 120ms 에 펴진다). 그 폭으로 판정하면 타일 위를
 * 지날 때마다 칩이 접혔다 펴진다. 그래서 묶음 폭에 **접힌 단추가 펴지면 먹을 폭**을 빼고 판정한다(단추마다 `높이 − 폭 − 앞 여백` —
 * 단추는 24×24 정사각이고 접히면 폭 0 · 앞 간격을 음수 여백으로 지운다). 칩은 호버와 상관없이 같은 꼴이다.
 *
 * 도구줄이 선 머리줄(`.has-tools` — 쿼리 타일)은 묶음 폭이 **내용을 따른다**(`flex: 0 1 auto` · 상한 40%). 그때는 제 폭 꼴로 잰
 * 순간의 묶음 폭이 곧 상한이고, 그 폭에 내용이 다 들어갔으면 몫은 무한이다. 단추는 도구줄이 받아 내므로 빼지 않는다.
 */
import { chipBudget, fitChips, type ChipFitMode, type FitChip, type FitResult, type FitState } from "$lib/pane/chip-fit";

/** 재는 꼴 — 칩의 `widths` 자리와 같은 차례 */
const MEASURE_MODES: readonly ChipFitMode[] = ["full", "compact", "icon"];

/** "+N" 칩을 못 잰 때(그릴 데가 없다)의 폭 */
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

  // 잰 값 — 내용이 바뀔 때만 새로
  #chips: MeasuredChip[] = [];
  #nameNatural = 0;
  #nameMargin = 0;
  #fixed: number[] = [];
  #overflowW = OVERFLOW_FALLBACK_PX;
  #gap = 0;
  /** 제 폭 꼴의 내용 전체 폭(도구줄 머리줄의 "다 들어갔나") */
  #contentFull = 0;

  // 폭 — 프레임마다 새로
  #width = 0;
  #reserve = 0;
  #capped = false;
  /** 이번 프레임에 잴 수 없었다(화면에 없다) */
  skip = false;

  #ro: ResizeObserver;
  #mo: MutationObserver;

  constructor(box: HTMLElement, apply: (r: FitResult) => void) {
    this.box = box;
    this.#apply = apply;
    this.#ro = new ResizeObserver((entries) => {
      // 묶음만 바뀌었으면 판정만, 칩 상자가 바뀌었으면 다시 잰다
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

  /** 읽기 1 — 쓰기 전에, 머리줄의 모양(도구줄인가)과 버튼 몫 */
  readSize(): void {
    this.skip = !this.box.isConnected || this.box.getClientRects().length === 0;
    if (this.skip) return;
    const head = this.box.closest("[data-pane-head]");
    this.#capped = head?.classList.contains("has-tools") ?? false;
    if (this.#capped) {
      // 내용을 따르는 폭 — 늘 제 폭 꼴로 다시 잰다(지금 폭은 지금 꼴의 폭일 뿐이다)
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

  /** 지금 서 있는 꼴 수 중 가장 많은 것(재는 횟수) */
  forms(): number {
    let n = 1;
    for (const el of this.box.querySelectorAll<HTMLElement>(":scope > [data-fit-chip]")) {
      n = Math.max(n, Number(el.dataset.fitForms) || 1);
    }
    return n;
  }

  /** 읽기 2 — `data-chip-measure` 가 `level` 꼴로 서 있는 동안 */
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
  // 1) 읽기만 — 아직 아무것도 쓰지 않았다
  for (const f of list) f.readSize();
  const live = list.filter((f) => !f.skip);
  const dirty = live.filter((f) => f.dirty);
  // 2) 꼴마다: 모두 쓰고 → 모두 읽는다(강제 배치는 꼴마다 한 번)
  const forms = dirty.reduce((n, f) => Math.max(n, f.forms()), 1);
  for (let level = 0; level < forms; level++) {
    for (const f of dirty) f.box.setAttribute("data-chip-measure", MEASURE_MODES[level]);
    for (const f of dirty) f.readLevel(level);
  }
  for (const f of dirty) {
    f.box.removeAttribute("data-chip-measure");
    f.dirty = false;
  }
  // 3) 판정 → 칩에 입힘(그리기는 Svelte 가 이 뒤에)
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

/**
 * 머리줄 하나의 칩 묶음을 지켜보며 접는다 — 판정이 바뀔 때만 `apply` 를 부른다. 돌려받은 함수로 그만둔다.
 * `box` 는 `data-chip-fit` 를 단 묶음(`PaneHeader` 의 `.pane-ident`).
 */
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
