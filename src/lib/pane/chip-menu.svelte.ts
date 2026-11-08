// 머리줄 칩이 여는 메뉴(tmux 세션 · 포워딩 목록 · AI 권한)의 공용 몸 — 2026-10-11 셋이 각자 적던 같은 몸짓을 한 곳으로.
//
// 컨트롤러 쪽(`ChipMenu` — `PaneHost` 가 메뉴마다 하나): 여닫기 · 자리(칩 왼쪽 변 바로 아래, 가로 넘침은 폭 상한으로) ·
// 토글(이미 이 타일의 메뉴면 닫기) · 포커스 되돌리기(여는 순간의 포커스 — `"none"` 이면 되돌리지 않는다) · 줄 실행 통로
// (`runOnMenu` — 스냅샷 → 닫기 → 실행, docs/conventions.md "메뉴를 닫는 코드").
// 그림 쪽(`TmuxMenu` · `ForwardMenu` · `AiPermMenu` 가 부른다): 바깥 누름 · 창 크기 변경으로 닫기(칩만 비켜 간다) ·
// ↑↓ Home End 로 돌기 · Escape 로 닫기. `$effect` 는 여기 없다 — 그림 쪽이 제 `$effect` 안에서 부른다.
import { runOnMenu } from "$lib/browser/menu-runner";
import type { HostBox } from "$lib/pane/boxes";

/** 메뉴가 서 있는 자리와 대상 타일 */
export interface ChipMenuAt {
  paneId: string;
  left: number;
  top: number;
}

/** 닫는 길 — `"none"`(바깥 클릭 · 창 크기 변경)은 포커스를 되돌리지 않는다 (⋯ 메뉴와 같은 규칙) */
export type ChipMenuBack = "none" | "back" | "trigger";

export interface ChipMenuOptions {
  /** 지금 이 창의 타일 상자들 — 게터라 그때그때의 값이다 */
  boxes: () => HostBox[];
  /** 폭 상한 — 화면 오른쪽으로 넘치지 않게 잡는 데 쓴다 (세로 넘침은 그림이 붙은 뒤 잰다) */
  width: number;
  /** 열기 전 문지기 — `false` 면 열지 않는다(AI 권한: 별칭 없는 타일) */
  canOpen?: (box: HostBox) => boolean;
  /** 연 뒤 한 번(포워딩: 목록 새로 읽기) */
  onOpen?: (box: HostBox) => void;
}

export class ChipMenu {
  #o: ChipMenuOptions;

  /** 열려 있으면 자리와 대상 타일 id */
  at = $state<ChipMenuAt | null>(null);

  /**
   * 메뉴를 열기 **직전에** 포커스를 갖고 있던 것 — 대개 그 타일의 터미널이다. ⋯ 메뉴의 `tileMenuReturn` 은 빌려 쓸 수
   * 없다: ⋯ 메뉴가 이미 닫히며 그 값을 쓰고 비웠다(`closeTileMenu("back")` 이 통로 안에서 먼저 돈다). 여기서 다시
   * 잡아 두지 않으면 목록을 닫는 순간 포커스가 `body` 로 떨어진다.
   */
  #returnTo: HTMLElement | null = null;

  /** 메뉴가 가리키는 타일 (닫혔거나 다른 창으로 갔으면 `null` — 메뉴도 함께 닫힌다) */
  // (`$derived.by` 인 까닭은 TS 하나다 — `$derived(식)` 이면 필드 초기화에서 생성자보다 먼저 `#o` 를 읽는 것으로 본다)
  box = $derived.by(() => (this.at === null ? null : (this.#o.boxes().find((b) => b.pane.id === this.at?.paneId) ?? null)));

  constructor(o: ChipMenuOptions) {
    this.#o = o;
  }

  /** 연다. `at` 은 부른 쪽이 준 자리(칩 아래 · ⋯ 메뉴가 서 있던 자리). 없으면 왼쪽 위 */
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
   * 머리줄 칩 — 이미 이 타일의 메뉴가 열려 있으면 닫는다(토글). 칩의 `data-*` 표식 덕에 그림의 "바깥 누름으로 닫기" 가
   * 이 칩만 비켜 간다 — 그러지 않으면 pointerdown 이 먼저 닫고 뒤따르는 click 이 다시 열어 토글이 성립하지 않는다.
   * 자리는 칩의 왼쪽 변을 맞춘 바로 아래다.
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

  /** 닫는다. `"none"` 이면 포커스를 되돌리지 않는다 — 그쪽은 이미 다른 곳으로 포커스가 가고 있다 */
  close = (back: ChipMenuBack = "none") => {
    const to = back === "none" ? null : this.#returnTo;
    this.at = null;
    this.#returnTo = null;
    if (to?.isConnected) to.focus({ preventScroll: true });
  };

  /**
   * 줄 하나 — **대상 타일을 스냅샷하고** 닫은 뒤 실행한다(`runOnMenu`). 줄의 값(세션 이름 · 포워드)은 마크업이
   * **인자로** 넘긴다: 그 값은 닫히면 사라지는 목록에서 왔다. `back` 은 닫는 길(기본 `"back"` — 포커스를 되돌린다).
   */
  run = <T = HostBox>(fn: (target: T) => void, target?: () => T | null, back: ChipMenuBack = "back") => {
    runOnMenu(target ?? (() => this.box as T | null), () => this.close(back), fn);
  };
}

/** 공용 메뉴 하나를 만든다 */
export function createChipMenu(o: ChipMenuOptions): ChipMenu {
  return new ChipMenu(o);
}

// ── 그림 쪽 몸짓 ─────────────────────────────────────────────────────────────

/**
 * 바깥을 누르거나 창 크기가 바뀌면 닫는다 — 단 **그 메뉴를 연 칩**(`skip` 표식)만 비켜 간다(위 `toggle` 의 이유).
 * 그림의 `$effect` 안에서 부르고 돌려받은 정리 함수를 돌려준다.
 */
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

/**
 * 메뉴 상자의 키 — ↑↓ · Home/End 로 `items`(문서 순서) 사이를 돌고 Escape 로 닫는다(`"trigger"` — 칩으로 포커스).
 * Escape 는 여기서 끊는다(뒤 화면까지 닫지 않게).
 */
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
