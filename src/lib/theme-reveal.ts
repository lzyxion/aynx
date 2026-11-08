import { tick } from "svelte";

/**
 * **테마 전환의 원 퍼짐** (2026-11-02) — 바뀌기 전 화면 한 장 위로 새 화면이 누른 자리에서 원으로 퍼지며 덮는다.
 *
 * View Transitions API(`document.startViewTransition`)를 쓴다: 옛 화면(`::view-transition-old(root)`)은 그대로 아래에 두고
 * 새 화면(`::view-transition-new(root)`)에 `clip-path: circle()` 을 시작점에서 가장 먼 창 모서리까지 넓힌다. 기본 크로스페이드는
 * `theme.css` 의 `::view-transition-*` 한 곳이 끈다.
 *
 * 자리는 둘이다 — 나중에 규칙을 싸게 바꾸려고:
 * - **시작점 규칙** = [`revealOriginFrom`] 하나. 한 자리만 바꾸려면 그 호출 한 줄을 고친다.
 * - **효과** = [`revealTheme`] 하나. 모델 함수에는 넣지 않는다 — 사람의 선택을 받는 UI 쪽이 감싼다(부팅 · 다른 창 방송 ·
 *   [취소] 가 같은 모델 함수를 불러도 효과가 없게).
 *
 * 연속 값(슬라이더)에는 쓰지 않는다 — 미는 동안 화면이 얼어붙는다.
 */

export interface RevealPoint {
  x: number;
  y: number;
}

/** 시작점을 잴 사각형 — `DOMRect` 의 부분 */
export interface RevealBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RevealOptions {
  /**
   * 전환 **전에** 읽고 디코딩할 그림 URL(월페이퍼) — 원 안에 빈 바탕이 비치지 않게. 빈 문자열이면 건너뛴다.
   * 디코딩에 실패하면 효과 없이 적용만 한다.
   */
  preload?: string | Promise<string>;
}

/** 시작점이 정해진 효과 — 적용이 깊은 곳에 있는 길(월페이퍼 파일 복사 뒤)에 넘긴다 */
export type Reveal = (apply: () => unknown, opts?: RevealOptions) => Promise<void>;

/**
 * 퍼지는 시간(ms) · 곡선 — 천천히 출발해 가운데서 빨라지고 끝에서 풀린다(2026-11-02 사용자 "빨리 퍼진다" —
 * 예전 500ms · (0.2,0,0,1) 은 처음 150ms 에 화면 대부분을 덮었다. 덮는 넓이는 반지름의 제곱이라 출발을 늦춰야 고르게 보인다)
 */
const DURATION_MS = 850;
const EASING = "cubic-bezier(0.45, 0, 0.25, 1)";

/** 누른 것으로 볼 요소 — 이벤트가 그 안의 글자 · 아이콘에서 났어도 이것의 가운데를 쓴다 */
const PICKED = "button, a, label, input, select, [role='button'], [role='option'], [role='menuitem'], [role='radio']";

// ── 순수 계산 (theme-reveal.test.ts) ─────────────────────────────────────────

/** 사각형의 가운데 — 없거나 크기가 0 이면(숨은 요소) 창 가운데 */
export function originOf(box: RevealBox | null, vw: number, vh: number): RevealPoint {
  if (!box || box.width <= 0 || box.height <= 0) return { x: vw / 2, y: vh / 2 };
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** 시작점에서 가장 먼 창 모서리까지의 거리 — 원이 이만큼 커지면 창 전체를 덮는다 */
export function revealRadius(p: RevealPoint, vw: number, vh: number): number {
  return Math.hypot(Math.max(p.x, vw - p.x), Math.max(p.y, vh - p.y));
}

/**
 * 창 안의 아무 점 — 가장자리 10% 는 빼고 고른다(모서리에 붙으면 원이 화면 밖에서 들어오는 것처럼 보인다).
 * `rand` 는 [0, 1) — 시험이 넣는다.
 */
export function randomOrigin(vw: number, vh: number, rand: () => number = Math.random): RevealPoint {
  return { x: vw * (0.1 + 0.8 * rand()), y: vh * (0.1 + 0.8 * rand()) };
}

// ── 시작점 규칙 ─────────────────────────────────────────────────────────────

/** 아무 자리에서 퍼진다 — 단축키 프로필 전환(`Ctrl+Shift+U`)이 쓴다(2026-11-02 사용자) */
export function revealOriginRandom(): RevealPoint {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return randomOrigin(window.innerWidth, window.innerHeight);
}

/**
 * **시작점 규칙 한 곳.** 이벤트면 처리기가 걸린 요소(`currentTarget`, 없으면 `target`)에서 가장 가까운 단추 · 항목의 가운데,
 * 요소면 그것(또는 그것을 감싼 단추)의 가운데, 둘 다 아니면 창 가운데.
 *
 * 키보드로 누른 단추(Enter · Space 의 click)도 그 단추 가운데다. 목록 전체가 키를 받는 자리(빠른 전환 줄의 listbox 처럼
 * `currentTarget` 이 단추가 아님)는 창 가운데가 된다. **처리기 안에서 곧바로** 부른다 — `await` 뒤에는 `currentTarget` 이 비고
 * 닫히는 화면은 자리가 사라진다.
 */
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

/** 지금 도는 전환 — 겹치면 앞 것을 끝내고 이번 것은 효과 없이 적용한다 */
let running: ViewTransition | null = null;

function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** 그림을 읽고 디코딩한다 — 배경 층(CSS `background-image`)이 같은 URL 을 캐시에서 곧바로 그리게 */
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

/**
 * **효과 한 곳.** `apply` 를 원 퍼짐 안에서 부른다(Promise 면 끝날 때까지 기다린 뒤 새 화면을 찍는다).
 *
 * 효과 없이 곧바로 적용하는 때: API 없음 · 움직임 줄이기 · 이미 전환 중(앞 전환은 `skipTransition`) · `preload` 디코딩 실패.
 * 돌려주는 Promise 는 적용이 끝나면 풀린다(퍼짐이 끝나기를 기다리지 않는다) — `apply` 의 오류는 그대로 던진다.
 */
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

/** 시작점을 묶은 [`Reveal`] — `pickWallpaper(revealAt(revealOriginFrom(ev)))` */
export function revealAt(origin: RevealPoint): Reveal {
  return (apply, opts) => revealTheme(origin, apply, opts);
}
