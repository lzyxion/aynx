// 툴팁 층 하나 — 창 전체의 `title` 을 위임 리스너로 가로채 앱 테마로 그린다.
// 네이티브 말풍선은 CSS 로 못 끈다 — 얹힌 요소의 조상 줄 전부에서 `title` 을 `data-tip` 으로 옮기고 나갈 때 되돌린다
// (크로미엄은 `title` 이 없으면 부모로 거슬러 올라가 가장 가까운 것을 띄우므로 요소 하나만 비우면 조상의 말풍선이 겹친다).
// 클릭으로 말풍선만 닫혀도 포인터가 남아 있으면 되돌리지 않는다 — 그 자리에서 되돌리면 네이티브가 대신 뜬다.
// 키보드 포커스 경로에서도 옮긴다 — WebView2 는 Tab 포커스에도 네이티브 말풍선을 띄운다. 그동안 이름이 비지 않게
// `aria-label`(이미 있으면 `aria-description`)을 잠시 얹는다([`suppressForFocus`]).
// 빠져나가는 문: `[data-native-tooltip]` 안쪽은 건드리지 않는다(조상 줄 걷기도 그 경계에서 멈춘다) · `.xterm` 안쪽도 건드리지 않되
// 앱이 심은 데코(`shell-integration/decorations.ts`)는 `[data-app-tooltip]` 로 받는다 · `[data-tip-hover-only]` 안쪽은 키보드 포커스로는
// 띄우지 않는다(네이티브는 그대로 끈다).
import { TOOLTIP_DELAY_MS, type TooltipRect } from "$lib/tooltip";

export interface TooltipShown {
  text: string;
  rect: TooltipRect;
  /** 요소의 `data-tip-place="above"` — 아래 손잡이를 가리면 안 되는 자리 */
  above?: boolean;
  /** 요소의 `data-tip-sub` — 이름 뒤 흐린 곁말. 띄우는 순간의 값이다 */
  sub?: string;
}

let shown = $state<TooltipShown | null>(null);

export function tooltipShown(): TooltipShown | null {
  return shown;
}

// ── 시계와 대상 ────────────────────────────────────────────────────────────

let armed: HTMLElement | null = null;
/** 말풍선이 클릭으로 닫힌 뒤에도 네이티브 title을 막아 둘 포인터 대상 */
let hovered: HTMLElement | null = null;
let titleObserver: MutationObserver | null = null;
/** `title` 을 옮겨 둔 요소들(안쪽 → 바깥쪽) — 되돌릴 책임은 이 목록 하나다 */
let swapped: HTMLElement[] = [];
/** 키보드 포커스 경로의 바꿔치기(`swapped` 와 따로) — 둘이 같은 요소를 비웠으면 나중에 끝나는 쪽이 되돌린다 */
let focusSwapped: { el: HTMLElement; added: string | null }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  // 이미 바꿔치기한 요소도 찾아야 한다 — 그러지 않으면 자식 위로 커서가 지날 때마다
  // "다른 대상" 으로 보여 시계가 처음부터 다시 돈다.
  const el = node.closest<HTMLElement>("[title],[data-tip]");
  if (!el) return null;
  if (el.closest(".xterm") && !el.hasAttribute("data-app-tooltip")) return null;
  if (el.closest("[data-native-tooltip]")) return null;
  return el;
}

function tipText(el: HTMLElement): string {
  return (el.getAttribute("title") ?? el.getAttribute("data-tip") ?? "").trim();
}

/** 크로미엄이 말풍선을 찾는 길과 같은 줄 — 이 줄을 비우면 네이티브가 띄울 것이 남지 않는다 */
function ancestorChain(from: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (let el: HTMLElement | null = from; el !== null; el = el.parentElement) {
    if (el.hasAttribute("data-native-tooltip")) break;
    chain.push(el);
    if (el === document.body) break;
  }
  return chain;
}

/** 같은 호버 중 컴포넌트가 다시 쓴 title도 최신 값으로 보관한다. */
function suppressNative(chain: HTMLElement[]): void {
  for (const el of chain) {
    const raw = el.getAttribute("title");
    if (raw === null) continue;
    el.setAttribute("data-tip", raw);
    el.removeAttribute("title");
    if (!swapped.includes(el)) swapped.push(el);
  }
}

function putBack(el: HTMLElement): void {
  const saved = el.getAttribute("data-tip");
  if (saved === null) return;
  el.removeAttribute("data-tip");
  // 그 사이 컴포넌트가 새 `title` 을 넣었으면 그쪽이 최신이다 — 옛 값으로 덮지 않는다.
  if (!el.hasAttribute("title")) el.setAttribute("title", saved);
}

function suppressForFocus(focused: HTMLElement, chain: HTMLElement[]): void {
  for (const el of chain) {
    const raw = el.getAttribute("title");
    if (raw === null) continue;
    let added: string | null = null;
    if (el === focused && raw.trim() !== "") {
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) added = "aria-label";
      else if (!el.hasAttribute("aria-description") && el.getAttribute("aria-label") !== raw) added = "aria-description";
      if (added) el.setAttribute(added, raw);
    }
    el.setAttribute("data-tip", raw);
    el.removeAttribute("title");
    focusSwapped.push({ el, added });
  }
}

function restoreFocus(): void {
  const list = focusSwapped;
  focusSwapped = [];
  for (const { el, added } of list) {
    if (added) el.removeAttribute(added);
    if (!swapped.includes(el)) putBack(el);
  }
}

function restore(): void {
  titleObserver?.disconnect();
  titleObserver = null;
  hovered = null;
  const list = swapped;
  swapped = [];
  for (const el of list) {
    if (focusSwapped.some((f) => f.el === el)) continue; // 키보드 포커스가 아직 비워 둔다
    putBack(el);
  }
}

/** 시계·말풍선만 접는다. title은 실제 포인터 이탈 또는 설치 해제 때 복원한다. */
function hide(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  armed = null;
  // `shown` 쓰기는 미룬다 — Svelte 가 DOM 을 걷는 도중 `focusout` 이 동기로 나서 그때 상태를 쓰면 `state_unsafe_mutation` 이 난다
  if (shown !== null) {
    queueMicrotask(() => {
      shown = null;
    });
  }
}

function show(el: HTMLElement, text: string): void {
  timer = null;
  // 시계가 도는 동안 메뉴가 닫혔을 수 있다 — 사라진 요소를 설명하지 않는다.
  if (!el.isConnected || text === "") {
    if (!el.isConnected && hovered === el) restore();
    hide();
    return;
  }
  const r = el.getBoundingClientRect();
  shown = {
    text,
    rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    above: el.dataset.tipPlace === "above",
    sub: el.dataset.tipSub?.trim() || undefined,
  };
}

// ── 포인터 경로 ────────────────────────────────────────────────────────────

function onPointerOver(ev: PointerEvent): void {
  const el = tipTarget(ev.target);
  if (el === hovered) return; // 클릭으로 닫힌 뒤에도 같은 대상 안에서는 다시 띄우지 않는다
  restore();
  hide();
  if (!el) return;

  const text = tipText(el);
  if (text === "") return;
  hovered = el;
  armed = el;

  const chain = ancestorChain(el);
  suppressNative(chain);
  // 속성을 제거한 알림은 다음번에 raw === null 로 끝나므로 관찰 루프를 만들지 않는다
  titleObserver = new MutationObserver(() => {
    suppressNative(chain);
    if (armed === el && shown !== null) show(el, tipText(el));
  });
  for (const node of chain) {
    titleObserver.observe(node, { attributes: true, attributeFilter: ["title"] });
  }

  timer = setTimeout(() => show(el, tipText(el)), TOOLTIP_DELAY_MS);
}

function onPointerOut(ev: PointerEvent): void {
  if (hovered === null) return;
  const to = ev.relatedTarget;
  if (to instanceof Node && hovered.contains(to)) return; // 자식으로 들어간 것뿐이다
  restore();
  hide();
}

// ── 키보드 경로 ────────────────────────────────────────────────────────────

function onFocusIn(ev: FocusEvent): void {
  const focused = ev.target;
  // `:focus-visible` 일 때만 — 클릭으로 들어온 포커스에까지 말풍선을 띄우면 누를 때마다 뜬다.
  if (!(focused instanceof Element) || !focused.matches(":focus-visible")) return;
  const el = tipTarget(focused);
  if (!el || el === armed) return;
  hide();
  const text = tipText(el);
  if (text === "") return;
  armed = el;
  // 네이티브 말풍선도 끈다 — 이름은 aria 로 지킨다
  restoreFocus();
  if (focused instanceof HTMLElement) suppressForFocus(focused, ancestorChain(focused));
  // `[data-tip-hover-only]` 안쪽은 포커스로 띄우지 않는다(화살표로 판을 고르는 자리 — 호버로는 뜬다)
  if (el.closest("[data-tip-hover-only]")) return;
  timer = setTimeout(() => show(el, tipText(el)), TOOLTIP_DELAY_MS);
}

function onFocusOut(): void {
  restoreFocus();
  // 호버로 포커스를 옮기는 자리(`[data-tip-hover-only]`)에서는 앞 판의 포커스가 빠지는 순간이 곧 호버 시계가 막 돈 순간이다
  // — 여기서 지우면 호버 말풍선이 영영 안 뜬다
  if (hovered?.isConnected && hovered === armed && hovered.closest("[data-tip-hover-only]")) return;
  hide();
}

// ── 설치 ───────────────────────────────────────────────────────────────────

type Bound = [EventTarget, string, EventListener, AddEventListenerOptions];

/**
 * 이벤트는 캡처 단계로 받는다 — 중간에서 `stopPropagation` 하는 자리가 여럿이라 버블이면 그 아래 요소들만 조용히 툴팁을 잃는다.
 * 스크롤 · 휠 · 리사이즈에서는 다시 재지 않고 지운다.
 */
export function installTooltips(): () => void {
  const passiveCapture: AddEventListenerOptions = { capture: true, passive: true };
  const capture: AddEventListenerOptions = { capture: true };

  const bound: Bound[] = [
    [document, "pointerover", onPointerOver as EventListener, passiveCapture],
    [document, "pointerout", onPointerOut as EventListener, passiveCapture],
    [document, "pointerdown", hide, capture],
    [document, "keydown", hide, capture],
    [document, "wheel", hide, passiveCapture],
    [document, "scroll", hide, passiveCapture],
    [document, "focusin", onFocusIn as EventListener, capture],
    [document, "focusout", onFocusOut, capture],
    [document, "visibilitychange", hide, {}],
    [window, "resize", hide, {}],
    [window, "blur", hide, {}],
  ];

  for (const [target, type, fn, opts] of bound) target.addEventListener(type, fn, opts);

  return () => {
    for (const [target, type, fn, opts] of bound) target.removeEventListener(type, fn, opts);
    restoreFocus();
    restore();
    hide();
  };
}
