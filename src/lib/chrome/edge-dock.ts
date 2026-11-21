// 창 끝 독(`Dock.svelte` · `ChatDock.svelte`)의 가장자리 호버로 열기.
// 닫기는 여기 없다 — 호버로 열었어도 각 독의 Esc · 바깥 누르기로만 닫힌다.
import {
  EDGE_AFTER_CLOSE,
  EDGE_DWELL_MS,
  EDGE_IDLE,
  edgeHoverDue,
  edgeHoverMove,
  inEdgeStrip,
  sideEdgeStrip,
  type EdgeHover,
  type EdgeRect,
} from "$lib/dock";

export interface EdgeDockHost {
  side(): "left" | "right";
  /** 이 독이 이미 열렸거나 모달 · 가림막 · 모바일 배치다 */
  blocked(): boolean;
  open(): void;
}

export function createEdgeHover(h: EdgeDockHost) {
  /** 창 크기 · 제목줄 높이 · 독 쪽이 바뀌면 버린다(`forgetStrip`) */
  let strip: EdgeRect | null = null;
  let edge: EdgeHover = EDGE_IDLE;
  let edgeTimer: ReturnType<typeof setTimeout> | null = null;

  function forgetStrip(): void {
    strip = null;
  }

  function chromeTop(): number {
    return document.querySelector(".titlebar")?.getBoundingClientRect().bottom ?? 0;
  }

  function stripNow(): EdgeRect {
    strip ??= sideEdgeStrip(h.side(), { width: window.innerWidth, height: window.innerHeight }, chromeTop());
    return strip;
  }

  /** DOM 을 훑으니 띠 안일 때만 부른다 */
  function edgeAllowed(): boolean {
    if (h.blocked()) return false;
    // 호버 카드가 떠 있는 동안도 열지 않는다 — 카드를 보러 온 손이다
    return document.querySelector(".menu-backdrop, [role='menu'], .hcard") === null;
  }

  /** 상태바 왼쪽 끝의 고리가 띠에 겹친다 — 그 위는 띠가 아닌 것으로 친다(고리에 얹은 손이 독까지 부르지 않게) */
  function onStatusControl(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".statusbar button, .statusbar [data-signal], .hcard") !== null;
  }

  function clearEdgeTimer(): void {
    if (edgeTimer !== null) clearTimeout(edgeTimer);
    edgeTimer = null;
  }

  function setEdge(next: EdgeHover): void {
    if (next === edge) return;
    edge = next;
    clearEdgeTimer();
    if (edge.since === null) return;
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      if (!edgeHoverDue(edge, performance.now()) || !edgeAllowed()) return;
      edge = EDGE_AFTER_CLOSE; // 연 순간부터 띠를 한 번 벗어나야 다시 센다(닫은 뒤 도로 열리지 않게)
      h.open();
    }, EDGE_DWELL_MS);
  }

  function onEdgePointer(ev: PointerEvent): void {
    if (ev.pointerType === "touch") return;
    const inStrip = inEdgeStrip(stripNow(), ev.clientX, ev.clientY) && !onStatusControl(ev.target);
    setEdge(edgeHoverMove(edge, { inStrip, allowed: inStrip && edgeAllowed(), buttons: ev.buttons }, performance.now()));
  }

  function onEdgeLeaveWindow(ev: PointerEvent): void {
    if (ev.relatedTarget === null) resetEdge();
  }

  function resetEdge(): void {
    setEdge(EDGE_IDLE);
  }

  /** 독이 열리거나 닫힐 때마다 부른다 — 커서 아래에서 닫힌 독이 도로 열리지 않게 */
  function afterClose(): void {
    setEdge(EDGE_AFTER_CLOSE);
  }

  /** 캡처 단계다 — 아래 화면(타일 · 끌기 손잡이)이 움직임의 전파를 끊어도 판정은 받는다 */
  function attach(): () => void {
    window.addEventListener("pointermove", onEdgePointer, { passive: true, capture: true });
    window.addEventListener("pointerup", onEdgePointer, { passive: true, capture: true });
    window.addEventListener("pointerout", onEdgeLeaveWindow, { passive: true });
    window.addEventListener("blur", resetEdge);
    window.addEventListener("resize", forgetStrip);
    return () => {
      window.removeEventListener("pointermove", onEdgePointer, true);
      window.removeEventListener("pointerup", onEdgePointer, true);
      window.removeEventListener("pointerout", onEdgeLeaveWindow);
      window.removeEventListener("blur", resetEdge);
      window.removeEventListener("resize", forgetStrip);
      clearEdgeTimer();
    };
  }

  return { attach, forgetStrip, afterClose };
}

export type EdgeHoverController = ReturnType<typeof createEdgeHover>;
