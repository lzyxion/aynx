/**
 * 여러 개를 끌 때의 개수 배지 고스트.
 * Chromium 은 문서에 실제로 그려진 요소만 고스트로 받는다 → `body` 에 잠깐 붙인다. `dragstart` 중 소스가 움직이면 드래그가
 * 취소되므로 화면 밖 `fixed` 에 두고, 정리([`dropGhost`])는 호출부가 한 틱 뒤에 부른다.
 * 요소는 모듈에 하나 — 타일마다 들면 한쪽에서 시작한 드래그를 다른 쪽이 정리하지 못한다.
 */
let ghostEl: HTMLElement | null = null;

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

export function dropGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
}
