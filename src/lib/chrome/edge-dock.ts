// **창 끝 독의 가장자리 호버로 열기** — 런처 독(`Dock.svelte`)과 채팅 독(`ChatDock.svelte`)에 똑같이 있던 몸을 하나로 뗀
// 일반 TS 부착 컨트롤러(2026-10-27 분할 5차). 규칙(띠 · 머무름 · 다시 세기)은 순수 `$lib/dock` 의 `sideEdgeStrip` · `edgeHoverMove` ·
// `inEdgeStrip` · `edgeHoverDue` 이고, 여기는 그 규칙을 창 리스너 · 시계에 잇는 것뿐이다.
//
// 독이 놓인 쪽 **창 바깥 끝의 16px 고정 띠**(제목줄 아래 ~ 창 아래 끝)에 커서가 250ms 머물면 연다. 16px 인 까닭(창 끝 4~6px 을
// OS 크기 조절 띠가 가린다)은 `$lib/dock` 의 절 머리말. 마우스 단추를 누른 채로는 세지 않는다(글자 고르기 · 끌기). **닫기는 여기
// 없다** — 호버로 열었어도 각 독의 Esc · 바깥 누르기로만 닫힌다. 메뉴 · 모달 · 가림막 · 모바일 배치 동안은 열지 않는다
// (앱 상태 쪽 판정은 독이 `blocked` 로 넘기고, 떠 있는 메뉴 · 호버 카드의 DOM 판정은 여기서 한다).
//
// 시계 상태는 룬이 아니다 — 아무도 그리지 않고 리스너와 타이머만 읽는다. `$effect` 는 없다: 쪽이 바뀔 때 · 제목줄 높이가 바뀔 때
// 띠 버리기(`forgetStrip`)와 독이 열리고 닫힐 때 다시 세기(`afterClose`)는 각 독의 효과가 원래 자리에서 부른다.
// 창 리스너 다섯은 `attach()` 가 옮기기 전 순서대로 걸고, 돌려준 함수가 같은 순서로 걷은 뒤 시계를 멈춘다(각 독의 `onMount` 정리에서).
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
  /** 독이 놓인 쪽 — 띠를 다시 잴 때마다 묻는다 */
  side(): "left" | "right";
  /**
   * 지금 열면 안 되는 앱 상태인가 — 이 독이 이미 열렸거나 모달 · 가림막 · 모바일 배치다. 띠 안일 때만 묻는다(이것을 먼저 묻고,
   * 아니면 떠 있는 메뉴 · 호버 카드를 DOM 에서 훑는다)
   */
  blocked(): boolean;
  /** 머문 시간이 찼다 — 연다 */
  open(): void;
}

/** 가장자리 호버 하나를 만든다 */
export function createEdgeHover(h: EdgeDockHost) {
  /** 계산해 둔 띠 — 움직임마다 레이아웃을 묻지 않으려고 둔다. 창 크기 · 제목줄 높이 · 독 쪽이 바뀌면 버린다 */
  let strip: EdgeRect | null = null;
  let edge: EdgeHover = EDGE_IDLE;
  let edgeTimer: ReturnType<typeof setTimeout> | null = null;

  function forgetStrip(): void {
    strip = null;
  }

  /** 제목줄(탭 줄)의 아래 끝 — 띠의 위 끝. 없으면(모바일 배치 등) 0 */
  function chromeTop(): number {
    return document.querySelector(".titlebar")?.getBoundingClientRect().bottom ?? 0;
  }

  /** 지금의 띠 — 창 좌표 고정 사각형(`sideEdgeStrip`) */
  function stripNow(): EdgeRect {
    strip ??= sideEdgeStrip(h.side(), { width: window.innerWidth, height: window.innerHeight }, chromeTop());
    return strip;
  }

  /**
   * 지금 열어도 되는가 — 독이 닫혀 있고, 모달 · 팔레트 · 가림막 · 떠 있는 메뉴(우클릭 메뉴의 백드롭 · `role=menu`)가 없고,
   * 모바일 배치가 아니다. 띠 안일 때만 묻는다(DOM 을 훑는 몫이 있다).
   */
  function edgeAllowed(): boolean {
    if (h.blocked()) return false;
    // 호버 카드(상태바 고리 · 칩)가 떠 있는 동안도 열지 않는다 — 카드를 보러 온 손이다(2026-10-19)
    return document.querySelector(".menu-backdrop, [role='menu'], .hcard") === null;
  }

  /**
   * 커서가 띠 안의 **상태바 컨트롤** 위인가 — 왼쪽 기둥 · 하단 상태바 왼쪽 끝의 자원 · 사용량 고리가 16px 띠에 겹쳐, 고리에
   * 얹은 손이 독까지 불렀다(2026-10-19 사용자). 그 위에서는 띠가 아닌 것으로 친다 — 컨트롤 밖 빈 띠로 옮기면 처음부터 센다.
   */
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

  /** 커서가 창 밖으로 나갔다(창 끝을 넘어 다른 모니터로) — 세던 시계를 멈춘다 */
  function onEdgeLeaveWindow(ev: PointerEvent): void {
    if (ev.relatedTarget === null) resetEdge();
  }

  function resetEdge(): void {
    setEdge(EDGE_IDLE);
  }

  /** 독이 열리거나 닫힐 때마다 — 띠를 한 번 벗어나야 다시 센다(커서 아래에서 닫힌 독이 도로 열리지 않게) */
  function afterClose(): void {
    setEdge(EDGE_AFTER_CLOSE);
  }

  /**
   * 창 리스너를 건다 — 창 좌표로 판정한다(띠는 누르기를 가로채지 않는 측정용 상자다). 수동(passive) 리스너다: 움직임마다 도는
   * 일은 사각형 비교 하나뿐이다(띠의 사각형은 재어 둔 것을 쓴다). **캡처 단계**다 — 아래 화면(타일 · 끌기 손잡이)이 움직임의
   * 전파를 끊어도 판정은 받는다. 돌려준 함수가 걷고 시계를 멈춘다.
   */
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
