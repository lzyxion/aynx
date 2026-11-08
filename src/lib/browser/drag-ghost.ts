/**
 * **개수 배지 드래그 고스트** — 여러 개를 끌 때 손에 들린 그림.
 *
 * 하나면 손대지 않는다: 브라우저 기본 고스트가 이미 그 줄의 그림이라 더 나은 그림이 없다.
 * 여럿이면 기본 고스트가 **처음 잡은 한 줄만** 보여 주므로 몇 개를 들고 있는지가 화면
 * 어디에도 없다.
 *
 * ## WebView2 규칙 두 가지가 이 파일의 모양을 정한다
 *
 * 1. Chromium 은 **문서에 실제로 그려진 요소만** 고스트로 받는다 → `document.body` 에
 *    잠깐 붙였다 뗀다.
 * 2. `dragstart` 가 도는 중에 소스 요소가 조금이라도 움직이면 드래그가 **통째로 취소**된다
 *    → `position:fixed` 로 화면 밖(-1000px)에 두어 레이아웃을 건드리지 않는다. 정리
 *    ([`dropGhost`])도 같은 이유로 **한 틱 뒤**에 부른다 (호출부의 `setTimeout(…, 0)`).
 *
 * 스타일이 인라인인 것은 컴포넌트의 scoped CSS 가 `body` 에 직접 붙인 요소에 닿지 않기
 * 때문이다.
 *
 * ## 모듈 상태 하나
 *
 * 요소를 모듈 수준에서 들고 있다. 드래그 세션은 창에 하나뿐이므로(포인터가 하나다) 파일
 * 타일과 세션 타일이 각자 들고 있을 이유가 없었고, 오히려 **한쪽에서 시작한 드래그를
 * 다른 쪽이 정리하지 못하는** 구멍이 있었다.
 */
let ghostEl: HTMLElement | null = null;

/**
 * 배지 고스트를 만들어 `dt` 에 건다 — **2개 이상일 때만**.
 *
 * 글자는 **부르는 쪽이 만들어 넘긴다** (`t("files.drag.count", …)`) — 이 파일은 DOM 만 알고
 * 사전을 모른다 (네이티브 그림의 배지 `nativeDragIcon` 도 같은 모양이다).
 */
export function setCountGhost(dt: DataTransfer, count: number, label: string): void {
  if (count < 2) return;
  const el = document.createElement("div");
  el.textContent = label;
  el.style.cssText = [
    "position:fixed",
    "top:-1000px",
    "left:-1000px",
    "padding:4px 10px",
    "font-family:var(--font-ui)",
    "font-size:12px",
    "font-weight:600",
    "color:#fff",
    "background:var(--accent)",
    "border-radius:6px",
    "box-shadow:0 2px 8px rgba(0,0,0,0.35)",
    "pointer-events:none",
  ].join(";");
  document.body.appendChild(el);
  ghostEl = el;
  dt.setDragImage(el, 14, 14);
}

/** 고스트를 치운다 (드래그 시작 직후 · 끝났을 때 — 여러 번 불려도 무해하다) */
export function dropGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
}
