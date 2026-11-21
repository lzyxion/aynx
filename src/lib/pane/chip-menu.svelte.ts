// 머리줄 칩이 여는 메뉴(tmux 세션 · 포워딩 목록 · AI 권한)의 공용 몸.
// 줄 실행은 `runOnMenu` 통로(스냅샷 → 닫기 → 실행)를 지난다 — docs/conventions.md "메뉴를 닫는 코드".
import { runOnMenu } from "$lib/browser/menu-runner";
import type { HostBox } from "$lib/pane/boxes";

export interface ChipMenuAt {
  paneId: string;
  left: number;
  top: number;
}

/** `"none"`(바깥 클릭 · 창 크기 변경)은 포커스를 되돌리지 않는다 */
export type ChipMenuBack = "none" | "back" | "trigger";

export interface ChipMenuOptions {
  boxes: () => HostBox[];
  /** 폭 상한 — 화면 오른쪽으로 넘치지 않게 */
  width: number;
  canOpen?: (box: HostBox) => boolean;
  onOpen?: (box: HostBox) => void;
}

export class ChipMenu {
  #o: ChipMenuOptions;

  at = $state<ChipMenuAt | null>(null);

  /**
   * 열기 직전의 포커스를 여기서 따로 잡는다 — ⋯ 메뉴의 `tileMenuReturn` 은 그 메뉴가 닫히며 이미 쓰고 비웠다.
   * 잡지 않으면 목록을 닫는 순간 포커스가 `body` 로 떨어진다.
   */
  #returnTo: HTMLElement | null = null;

  // `$derived.by` 인 까닭은 TS 하나다 — `$derived(식)` 이면 필드 초기화에서 생성자보다 먼저 `#o` 를 읽는 것으로 본다
  box = $derived.by(() => (this.at === null ? null : (this.#o.boxes().find((b) => b.pane.id === this.at?.paneId) ?? null)));

  constructor(o: ChipMenuOptions) {
    this.#o = o;
  }

  open = (box: HostBox, at: { left: number; top: number } | null) => {
    if (this.#o.canOpen && !this.#o.canOpen(box)) return;
    const was = document.activeElement;
    this.#returnTo = was instanceof HTMLElement ? was : null;
    const x = at?.left ?? 24;
    this.at = {
      paneId: box.pane.id,
      left: Math.max(8, Math.min(x, window.innerWidth - this.#o.width - 8)),
      top: at?.top ?? 24,
    };
    this.#o.onOpen?.(box);
  };

  /**
   * 칩의 `data-*` 표식으로 그림의 "바깥 누름으로 닫기" 가 이 칩만 비켜 간다 — 아니면 pointerdown 이 먼저 닫고
   * 뒤따르는 click 이 다시 열어 토글이 성립하지 않는다.
   */
  toggle = (ev: MouseEvent, box: HostBox) => {
    if (this.at?.paneId === box.pane.id) {
      this.close();
      return;
    }
    const btn = ev.currentTarget;
    const r = btn instanceof HTMLElement ? btn.getBoundingClientRect() : null;
    this.open(box, r === null ? null : { left: r.left, top: r.bottom + 2 });
  };

  close = (back: ChipMenuBack = "none") => {
    const to = back === "none" ? null : this.#returnTo;
    this.at = null;
    this.#returnTo = null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  };

  /** 줄의 값(세션 이름 · 포워드)은 마크업이 인자로 넘긴다 — 닫히면 사라지는 목록에서 왔다 */
  run = <T = HostBox>(fn: (target: T) => void, target?: () => T | null, back: ChipMenuBack = "back") => {
    runOnMenu(target ?? (() => this.box as T | null), () => this.close(back), fn);
  };
}

export function createChipMenu(o: ChipMenuOptions): ChipMenu {
  return new ChipMenu(o);
}

// ── 그림 쪽 몸짓 ─────────────────────────────────────────────────────────────

/** 그 메뉴를 연 칩(`skip` 표식)만 비켜 간다 — 위 `toggle` 의 이유 */
export function closeOnOutside(
  el: () => HTMLElement | null,
  skip: string,
  onclose: (back: "none") => void,
): () => void {
  const onDown = (ev: PointerEvent) => {
    const t = ev.target;
    if (!(t instanceof Node)) return;
    if (el()?.contains(t)) return;
    if (t instanceof Element && t.closest(skip)) return;
    onclose("none");
  };
  const onResize = () => onclose("none");
  window.addEventListener("pointerdown", onDown);
  window.addEventListener("resize", onResize);
  return () => {
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("resize", onResize);
  };
}

/** Escape 는 여기서 끊는다 — 뒤 화면까지 닫지 않게 */
export function menuKeydown(
  ev: KeyboardEvent,
  node: HTMLElement | null,
  items: string,
  onclose: (back: "trigger") => void,
): void {
  if (!node) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    onclose("trigger");
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
  ev.preventDefault();
  const list = Array.from(node.querySelectorAll<HTMLElement>(items));
  if (list.length === 0) return;
  const at = list.indexOf(document.activeElement as HTMLElement);
  const down = ev.key === "ArrowDown";
  const next =
    ev.key === "Home"
      ? 0
      : ev.key === "End"
        ? list.length - 1
        : at < 0
          ? down
            ? 0
            : list.length - 1
          : (at + (down ? 1 : -1) + list.length) % list.length;
  list[next]?.focus();
}
