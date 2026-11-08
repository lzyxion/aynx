// ---------------------------------------------------------------------------
// **툴팁 층 하나** — 창 전체의 `title` 을 위임 리스너로 가로채 앱 테마로 그린다
// (docs/log/2026-09-16-themed-tooltips.md).
//
// 여기는 배선만 있다: 언제 뜨고 언제 지는가, 그리고 **네이티브 말풍선을 어떻게 끄는가**.
// 순수 규칙(글자 쪼개기·자리 잡기)은 `tooltip.ts`, 그리기는 `Tooltip.svelte` 다.
//
// ## 왜 컴포넌트마다 고치지 않았나
//
// `title` 이 붙은 자리가 130곳이 넘는다. 그 전부에 프롭·컴포넌트를 심으면 다음에 버튼 하나
// 늘 때마다 같은 선택(툴팁을 다나 마나)을 다시 해야 하고, 빠뜨린 자리만 회색 네이티브
// 말풍선으로 남아 화면이 두 결로 갈린다. 위임 리스너 하나면 **이미 적혀 있는 문구가 전부
// 그대로** 테마를 입는다 — 기존 `title` 문자열은 한 글자도 건드리지 않았다.
//
// ## 네이티브 말풍선을 끄는 법 — `title` → `data-tip` 바꿔치기 (조상 줄까지)
//
// CSS 로는 못 끈다(웹뷰가 OS 층에서 그린다). 속성을 빼는 수밖에 없는데, 전부 빼 두면
// 접근성 이름이 사라진다. 그래서 **지금 포인터가 얹힌 자리 위로 뻗은 줄만** `title` 을
// `data-tip` 으로 옮기고, 포인터가 나갈 때 **되돌린다**. 클릭으로 말풍선만 닫아도 포인터가
// 남아 있으면 복원하지 않는다 — 그 자리에서 복원하면 네이티브 말풍선이 대신 뜬다.
//
// **왜 요소 하나가 아니라 줄 전체인가.** 크로미엄은 포인터 아래 요소에 `title` 이 없으면
// **부모로 거슬러 올라가 가장 가까운 `title` 을 띄운다.** 그래서 얹힌 요소 하나만 비우면
// 조상의 말풍선이 대신 뜬다 — 타일 머리줄(`.pane-head`, 드래그 안내)의 `title` 이 그 안의
// `.tile-code` 위에서 네이티브로 뜨고, 앱 말풍선(`main:pane-1`)과 **둘이 겹쳐 보였다**.
// `[title]` 이 중첩된 자리는 전부 같은 결이다(머리줄 안의 칩, 설명 달린 상자 안의 버튼).
//
// 값은 여전히 싸다: **DOM 을 훑지 않는다.** 포인터 위로 뻗은 조상 줄(`parentElement` 를
// `document.body` 까지, 보통 열댓 칸)만 따라가고, 되돌릴 요소는 목록 하나에 모아 둔다.
// 호버 중 이 줄의 `title` 변경만 관찰해, 클릭·상태 갱신으로 새로 생긴 값도 바로 옮긴다.
// 아래로는 볼 것이 없다 — 대상(`tipTarget`)은 얹힌 요소에서 가장 **안쪽** `[title]` 이라
// 그 아래에는 `title` 이 없다.
//
// 접근성 메모:
// - `aria-label` 이 함께 붙은 요소는 **아무 영향이 없다** — 이름은 그쪽에서 나온다.
//   (이 앱의 아이콘 버튼은 대부분 `title` + `aria-label` 짝이다.)
// - `title` 만 있는 요소는 **포인터가 얹혀 있는 동안에만** 이름을 잃는다. 스크린 리더는
//   포커스·가상 커서로 읽고 그 경로에서는 바꿔치기를 하지 않으므로(아래) 실제로 겹치지 않는다.
// - **키보드 포커스 경로에서도 `title` 을 옮긴다**(2026-10-08 수정). 처음엔 "웹뷰는 포커스에 네이티브 말풍선을
//   띄우지 않는다" 고 보고 옮기지 않았는데, WebView2 는 Tab 포커스에도 띄워 우리 말풍선과 **둘이 겹쳤다**(사용자 실기).
//   대신 포커스가 머무는 동안 이름이 비지 않게, 그 요소에 `aria-label`(이미 있으면 `aria-description`)이 없으면
//   같은 글을 잠시 얹고 포커스가 빠지면 걷는다([`suppressForFocus`]).
//
// ## 빠져나가는 문
//
// `[data-tip-hover-only]` 안쪽은 키보드 포커스로는 앱 말풍선을 띄우지 않는다(네이티브는 그대로 끈다 · 호버는 뜬다) —
// 화살표로 판을 옮겨 고르는 자리(끝내기 모달)에서 고를 때마다 말풍선이 따라다니지 않게(10-29).
//
// `[data-native-tooltip]` 안쪽은 건드리지 않는다 (네이티브 말풍선이 그대로 뜬다).
// 바꿔치기가 **그 경계를 넘지 않는 것**도 같은 규칙이다 — 조상 줄을 따라가다 그 속성을
// 만나면 거기서 멈춘다. (그런 조상은 사실 설계 모순이라 지금은 닿지 않는다: `tipTarget` 의
// `closest` 가 조상까지 보고 그 안쪽을 통째로 거르기 때문이다. 멈춤 한 줄이 그 불변을
// 걷기 쪽에도 적어 둔다.)
// `.xterm` 안쪽도 마찬가지다 — 터미널 화면은 xterm.js 의 영역이고, 링크 미리보기처럼
// 그쪽이 스스로 붙이는 `title` 을 우리가 가로챌 이유가 없다. 단 **앱이 심은 데코**(실패 띠·줄 배경·[AI에게 묻기]·
// 시간 표식 — `shell-integration/decorations.ts`)는 `[data-app-tooltip]` 를 달아 앱 말풍선을 받는다.
// ---------------------------------------------------------------------------
import { TOOLTIP_DELAY_MS, type TooltipRect } from "$lib/tooltip";

/** 지금 떠 있는 말풍선 — 글자와, 그것을 설명하는 요소의 상자 */
export interface TooltipShown {
  text: string;
  rect: TooltipRect;
  /** 위를 먼저 고를지 — 요소의 `data-tip-place="above"` (설정 라벨처럼 아래 손잡이를 가리면 안 되는 자리) */
  above?: boolean;
  /**
   * 이름 뒤에 **흐리게** 붙는 곁말 — 요소의 `data-tip-sub`(예: 새로고침 단추의 "3초 전 읽음"). 이름(`title`)은 접근성
   * 이름 그대로 두고, 상태처럼 바뀌는 덧붙임만 따로 든다. 띄우는 순간의 값이다.
   */
  sub?: string;
}

let shown = $state<TooltipShown | null>(null);

/** 지금 떠 있는 말풍선 (없으면 `null`) — `Tooltip.svelte` 만 읽는다 */
export function tooltipShown(): TooltipShown | null {
  return shown;
}

// ── 시계와 대상 ────────────────────────────────────────────────────────────

/** 시계가 도는(또는 이미 뜬) 대상 */
let armed: HTMLElement | null = null;
/** 말풍선이 클릭으로 닫힌 뒤에도 네이티브 title을 막아 둘 포인터 대상 */
let hovered: HTMLElement | null = null;
let titleObserver: MutationObserver | null = null;
/**
 * `title` 을 `data-tip` 으로 옮겨 둔 요소들 (안쪽 → 바깥쪽) — 되돌릴 책임이 있는 자리는
 * 이 목록 하나다. 조상 줄까지 비우는 이유는 파일 머리말에.
 */
let swapped: HTMLElement[] = [];
/**
 * 키보드 포커스 동안 `title` 을 옮겨 둔 요소들과 그때 잠시 얹은 접근성 속성 — 포인터 경로(`swapped`)와 따로 든다.
 * 둘이 같은 요소를 비웠으면 나중에 끝나는 쪽이 되돌린다.
 */
let focusSwapped: { el: HTMLElement; added: string | null }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** 툴팁을 가진 조상 요소를 찾는다 (제외 구역이면 없는 셈 친다) */
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

/**
 * 포인터가 얹힌 요소에서 위로 뻗은 조상 줄 (안쪽 → 바깥쪽).
 *
 * 크로미엄이 말풍선을 찾는 길과 같은 길이다 — 그래서 이 줄을 비우면 네이티브가 띄울 것이
 * 남지 않는다. `document.body` 에서 멈추고, `[data-native-tooltip]` 경계도 넘지 않는다.
 */
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

/** `data-tip` 으로 옮겨 둔 값을 `title` 로 되돌린다 — 다른 경로가 아직 비워 두는 요소는 건너뛴다 */
function putBack(el: HTMLElement): void {
  const saved = el.getAttribute("data-tip");
  if (saved === null) return;
  el.removeAttribute("data-tip");
  // 그 사이 컴포넌트가 새 `title` 을 넣었으면 그쪽이 최신이다 — 옛 값으로 덮지 않는다.
  if (!el.hasAttribute("title")) el.setAttribute("title", saved);
}

/**
 * 키보드 포커스 경로의 바꿔치기 — 조상 줄의 `title` 을 비우고(네이티브 말풍선이 거슬러 올라가 찾는 길),
 * 포커스된 요소의 이름·설명은 잠시 aria 속성으로 지킨다.
 */
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

/** 옮겨 둔 `title` 을 전부 제자리로 */
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
  // `shown` 쓰기는 **미룬다** — 이 함수는 `focusout`·`pointerdown` 캡처 리스너로도 불리는데,
  // Svelte 가 DOM 을 걷어내는 도중(포커스된 요소가 빠질 때 `focusout` 이 동기로 난다) 상태를
  // 쓰면 `state_unsafe_mutation` 이 난다. 값이 없으면 쓸 것도 없다 (헤드리스 재현, 2026-09-16).
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
  // DOM 전체가 아니라 포인터 위 조상들의 title만 본다. 속성을 제거한 알림은 다음번에
  // raw === null로 끝나므로 관찰 루프를 만들지 않는다.
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
  // 네이티브 말풍선도 끈다 — 이름은 aria 로 지킨다 (파일 머리말의 접근성 메모).
  restoreFocus();
  if (focused instanceof HTMLElement) suppressForFocus(focused, ancestorChain(focused));
  // `[data-tip-hover-only]` 안쪽은 포커스로 띄우지 않는다 — 화살표로 판을 고르는 자리(끝내기 모달)는 고를 때마다 말풍선이
  // 따라다녔다(10-29 사용자). 네이티브 말풍선은 위에서 그대로 끈다 · 호버 경로는 그대로 뜬다
  if (el.closest("[data-tip-hover-only]")) return;
  timer = setTimeout(() => show(el, tipText(el)), TOOLTIP_DELAY_MS);
}

function onFocusOut(): void {
  restoreFocus();
  // 호버로 포커스를 옮기는 자리(`[data-tip-hover-only]` — 끝내기 모달은 손을 얹으면 그 판을 고른다)에서는 앞 판의 포커스가
  // 빠지는 순간이 곧 호버 말풍선의 시계가 막 돈 순간이다 — 여기서 지우면 호버 말풍선이 영영 안 뜬다. 포인터 길이 쥔 말풍선은
  // 포인터가 나갈 때(`onPointerOut`) 진다
  if (hovered?.isConnected && hovered === armed && hovered.closest("[data-tip-hover-only]")) return;
  hide();
}

// ── 설치 ───────────────────────────────────────────────────────────────────

type Bound = [EventTarget, string, EventListener, AddEventListenerOptions];

/**
 * 창 하나에 툴팁 층을 건다. 되돌리는 함수를 돌려준다.
 *
 * 포인터·키 이벤트는 **캡처 단계**로 받는다 — 타일·터미널·드래그 코드가 중간에서
 * `stopPropagation` 하는 자리가 여럿이라, 버블로 받으면 그 아래 요소들만 조용히
 * 툴팁을 잃는다 (찾기 어려운 결의 버그다).
 *
 * 스크롤·휠·리사이즈에서는 **다시 재지 않고 그냥 지운다.** 말풍선이 따라다녀야 할 만큼
 * 오래 떠 있는 물건이 아니고, 스크롤 중 좌표를 쫓으면 프레임마다 `getBoundingClientRect`
 * 를 부르게 된다.
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
