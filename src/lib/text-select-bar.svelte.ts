// 글 화면(AI 타일 대화 면 · 사이드 채팅 · 문서 타일)의 고른 글 — 폰 · 태블릿에서 브라우저 띠 대신 세우는 앱 띠(`term/TouchSelection.svelte`)의 자리와,
// "이 `contextmenu` 가 손가락에서 왔는가" 의 판정. 고르기 · 손잡이는 브라우저 것이다 — 여기서는 띠만 다룬다.
// 컴포넌트 초기화 중에 부른다(`$effect` 를 건다).
import { selectionIn } from "$lib/doc/context-actions";
import { TOUCH_BAR_H } from "$lib/term/touch-select";

export interface TextSelectHost {
  /** 고를 수 있는 본문 — 선택이 이 밖에 걸치면 띠가 없다 */
  body(): HTMLElement | null;
  /** 띠를 그리는 상자(`position` 이 잡힌 조상) — 자리는 이 상자 기준이다 */
  box(): HTMLElement | null;
  /** 띠를 세울 때인가(폰 취급 · 이 면이 보이는 중) */
  on(): boolean;
}

const GAP = 8;
/** 브라우저의 손잡이가 선택 아래로 내려오는 높이 — 아래에 서는 띠가 이만큼 비킨다 */
const HANDLE_DROP = 28;
/** 손가락을 뗀 뒤 이 안에 온 `contextmenu` 는 그 손가락의 것이다 */
const TOUCH_MS = 800;
const MAX_TEXT = 64 * 1024;
/** 손가락 자리와 고른 글 사이에 봐주는 틈(px) */
const PICK_SLOP = 12;

export function createTextSelectBar(h: TextSelectHost) {
  /** 고른 글은 띠가 뜬 순간의 것을 쥔다 — 단추를 누르는 동안 선택이 풀려도 복사된다 */
  let bar = $state<{ text: string; top: number } | null>(null);
  let touchDown = false;
  let touchAt = -Infinity;

  function text(): string {
    const body = h.body();
    return body ? selectionIn(body).slice(0, MAX_TEXT) : "";
  }

  function place(): void {
    const box = h.box();
    const sel = window.getSelection();
    const picked = text();
    if (!box || !sel || picked === "" || sel.rangeCount === 0) {
      bar = null;
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const view = box.getBoundingClientRect();
    // 원격의 UI 크기는 루트 CSS zoom 이다 — 잰 값(화면 px)을 상자 안의 px 로 되돌린다.
    const zoom = box.offsetWidth > 0 && view.width > 0 ? view.width / box.offsetWidth : 1;
    const above = (r.top - view.top) / zoom - TOUCH_BAR_H - GAP;
    const below = (r.bottom - view.top) / zoom + HANDLE_DROP + GAP;
    const max = view.height / zoom - TOUCH_BAR_H - GAP;
    // 상자가 스스로 스크롤하면(문서 타일의 Markdown 본문) 안의 띠도 함께 밀린다 — 밀린 만큼 더한다.
    bar = { text: picked, top: (above >= GAP ? above : below <= max ? below : GAP) + box.scrollTop };
  }

  /**
   * 손잡이를 끌다 놓거나 길게 눌렀다 뗄 때 브라우저가 한 번 더 내는 `contextmenu` 는 누른 자리가 아니라 포커스 요소(없으면 문서)로 온다 —
   * 터치 이벤트도 없고 `pointerType` 도 `mouse` 라 손가락 것으로 못 가린다. 포커스 요소가 본문 밖이면(문서 타일의 타일 뿌리) 브라우저 띠가 서고,
   * 본문 안이면(대화 면의 말풍선) 본문의 처리기가 마우스 우클릭으로 알고 메뉴를 연다. 앱 띠가 서 있는 동안 그것을 여기서 끝낸다
   * (진짜 마우스 우클릭은 `button` 이 2 다).
   */
  function blockUnlocated(ev: MouseEvent): void {
    if (bar === null || ev.button === 2) return;
    const at = ev.target;
    if (at !== document && at !== document.body && at !== document.documentElement && at !== document.activeElement) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  $effect(() => {
    const box = h.box();
    if (!h.on() || !box) {
      bar = null;
      return;
    }
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    document.addEventListener("selectionchange", later);
    document.addEventListener("contextmenu", blockUnlocated, true);
    box.addEventListener("scroll", later, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", later);
      document.removeEventListener("contextmenu", blockUnlocated, true);
      box.removeEventListener("scroll", later, { capture: true });
    };
  });

  return {
    get bar() {
      return bar;
    },
    text,
    /** 상자의 `touchstart` · `touchend` · `touchcancel` 에 건다 */
    onTouch(ev: TouchEvent): void {
      touchDown = ev.touches.length > 0;
      if (!touchDown) touchAt = performance.now();
    },
    /** `pointerType` 만으로는 못 가른다 — Android 는 길게 누른 `contextmenu` 를 `mouse` 로 내기도 하고, 뗄 때 내기도 한다. */
    byTouch(ev: MouseEvent): boolean {
      return (ev as PointerEvent).pointerType === "touch" || touchDown || performance.now() - touchAt < TOUCH_MS;
    },
    /**
     * 길게 누른 그 자리의 글이 골라졌는가 — 브라우저는 `contextmenu` 를 내기 전에 낱말을 고른다. 거짓이면 빈 곳을 누른 것이다
     * (다른 데 남아 있던 선택은 치지 않는다).
     */
    pickedAt(x: number, y: number): boolean {
      const body = h.body();
      const sel = window.getSelection();
      if (!body || !sel || sel.isCollapsed || sel.rangeCount === 0) return false;
      const range = sel.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return false;
      return Array.from(range.getClientRects()).some(
        (r) => x >= r.left - PICK_SLOP && x <= r.right + PICK_SLOP && y >= r.top - PICK_SLOP && y <= r.bottom + PICK_SLOP,
      );
    },
    /** 띠의 [복사] 뒤 — 선택을 풀면 띠도 걷힌다 */
    clear(): void {
      window.getSelection()?.removeAllRanges();
    },
  };
}

export type TextSelectBar = ReturnType<typeof createTextSelectBar>;
