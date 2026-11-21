import { tick } from "svelte";

/**
 * 테마 전환의 원 퍼짐(View Transitions API). 기본 크로스페이드는 `theme.css` 의 `::view-transition-*` 가 끈다.
 * 효과는 모델 함수에 넣지 않는다 — 사람의 선택을 받는 UI 쪽이 감싼다(부팅 · 다른 창 방송 · [취소] 에는 효과가 없게).
 * 연속 값(슬라이더)에는 쓰지 않는다 — 미는 동안 화면이 얼어붙는다.
 */

export interface RevealPoint {
  x: number;
  y: number;
}

export interface RevealBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RevealOptions {
  /** 전환 전에 디코딩할 그림 URL(월페이퍼) — 원 안에 빈 바탕이 비치지 않게 */
  preload?: string | Promise<string>;
}

export type Reveal = (apply: () => unknown, opts?: RevealOptions) => Promise<void>;

/** 덮는 넓이는 반지름의 제곱이라 천천히 출발해야 고르게 퍼져 보인다 */
const DURATION_MS = 850;
const EASING = "cubic-bezier(0.45, 0, 0.25, 1)";

/** 누른 것으로 볼 요소 — 이벤트가 그 안의 글자 · 아이콘에서 났어도 이것의 가운데를 쓴다 */
const PICKED = "button, a, label, input, select, [role='button'], [role='option'], [role='menuitem'], [role='radio']";

// ── 순수 계산 ─────────────────────────────────────────

export function originOf(box: RevealBox | null, vw: number, vh: number): RevealPoint {
  if (!box || box.width <= 0 || box.height <= 0) return { x: vw / 2, y: vh / 2 };
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

export function revealRadius(p: RevealPoint, vw: number, vh: number): number {
  return Math.hypot(Math.max(p.x, vw - p.x), Math.max(p.y, vh - p.y));
}

export function randomOrigin(vw: number, vh: number, rand: () => number = Math.random): RevealPoint {
  return { x: vw * (0.1 + 0.8 * rand()), y: vh * (0.1 + 0.8 * rand()) };
}

// ── 시작점 규칙 ─────────────────────────────────────────────────────────────

export function revealOriginRandom(): RevealPoint {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return randomOrigin(window.innerWidth, window.innerHeight);
}

/** 처리기 안에서 곧바로 부른다 — `await` 뒤에는 `currentTarget` 이 비고 닫히는 화면은 자리가 사라진다 */
export function revealOriginFrom(source?: Event | Element | null): RevealPoint {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  let el: Element | null = null;
  if (typeof Event !== "undefined" && source instanceof Event) {
    const at =
      source.currentTarget instanceof Element
        ? source.currentTarget
        : source.target instanceof Element
          ? source.target
          : null;
    el = at?.closest(PICKED) ?? null;
  } else if (typeof Element !== "undefined" && source instanceof Element) {
    el = source.closest(PICKED) ?? source;
  }
  return originOf(el ? el.getBoundingClientRect() : null, window.innerWidth, window.innerHeight);
}

// ── 효과 ────────────────────────────────────────────────────────────────────

let running: ViewTransition | null = null;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 배경 층(CSS `background-image`)이 같은 URL 을 캐시에서 곧바로 그리게 미리 디코딩한다 */
async function decoded(url: string): Promise<boolean> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return true;
  } catch {
    return false;
  }
}

/** 돌려주는 Promise 는 적용이 끝나면 풀린다(퍼짐을 기다리지 않는다) — `apply` 의 오류는 그대로 던진다 */
export async function revealTheme(origin: RevealPoint, apply: () => unknown, opts: RevealOptions = {}): Promise<void> {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || typeof doc.startViewTransition !== "function" || reducedMotion()) {
    await apply();
    return;
  }
  if (running) {
    running.skipTransition();
    running = null;
    await apply();
    return;
  }
  if (opts.preload !== undefined) {
    const url = await opts.preload;
    if (url && !(await decoded(url))) {
      await apply();
      return;
    }
  }
  if (running) {
    // 그림을 읽는 사이 다른 전환이 섰다 — 겹치지 않게 효과 없이
    await apply();
    return;
  }
  const vt = doc.startViewTransition(async () => {
    await apply();
    await tick(); // 상태 → DOM 반영을 마친 뒤 새 화면을 찍게
  });
  running = vt;
  const clear = () => {
    if (running === vt) running = null;
  };
  vt.finished.then(clear, clear);
  const { x, y } = origin;
  const r = revealRadius(origin, window.innerWidth, window.innerHeight);
  vt.ready
    .then(() => {
      doc.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: DURATION_MS, easing: EASING, pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {
      // 건너뛴 전환(겹침 · 적용 실패) — 그릴 것이 없다
    });
  await vt.updateCallbackDone;
}

export function revealAt(origin: RevealPoint): Reveal {
  return (apply, opts) => revealTheme(origin, apply, opts);
}
