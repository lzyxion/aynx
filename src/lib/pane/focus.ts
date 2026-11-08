/**
 * **타일 포커스 라우팅** — 캔버스 한 곳에서 위임으로 받는 두 몸통
 * (docs/log/2026-09-03-hosts-toolbar-tile-focus.md).
 *
 * 둘 다 `PaneHost` 의 `$effect` 안에 있던 것을 그대로 옮긴 것이라, 호출부는 한 줄이다:
 *
 * ```svelte
 * $effect(() => delegateTileFocus(host, { … }));
 * $effect(() => routeTileFocus(host, focusTileId));
 * ```
 *
 * 정리 함수를 그대로 돌려주므로 호출부에 분기가 없다 (`app/` 모듈들과 같은 규칙 —
 * docs/log/2026-09-05-refactor-page-split.md §3). 룬을 쓰지 않아 `.svelte.ts` 가 아니다:
 * 여기 있는 것은 상태가 아니라 **DOM 이벤트 배선**뿐이다.
 */

import { cancelLayoutAnim } from "$lib/layout-anim.svelte.js";

export interface TileFocusOptions {
  /** 이 탭의 동시 입력이 켜져 있는가 (`Ctrl+클릭` 을 가로챌 조건) */
  syncOn: (tabId: string) => boolean;
  onfocus: (tabId: string, paneId: string) => void;
  onsync: (tabId: string, paneId: string) => void;
}

/**
 * 패널 포커스 전환은 컨테이너에서 **위임**으로 잡는다 — 패널 상자마다 마우스 핸들러를
 * 달면 정적 요소 상호작용이 되고, 캡처 단계라 xterm 이 포커스를 가져가기 전에 먼저 안다.
 *
 * 같은 자리에서 **Ctrl+클릭 = 동시 입력 포함/제외 토글**도 가로챈다. 단 조건이 좁다:
 * **그 탭의 동시 입력이 켜져 있을 때만.** 꺼져 있으면 Ctrl+클릭은 원래대로 xterm 에
 * 그대로 내려간다. 헤더의 버튼들(⋯ · 📂 · ⤢ · ×) 위에서는 비켜 준다 — 그쪽은 자기
 * click 이 할 일이 따로 있고, 여기서 함께 뒤집으면 두 가지가 한 번에 일어난다.
 */
export function delegateTileFocus(
  el: HTMLElement | null,
  opts: TileFocusOptions,
): (() => void) | undefined {
  if (!el) return;
  const onDown = (ev: PointerEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    // 배치 트랜지션이 도는 중에 **분할선을 잡으면 즉시 끈다** — 그 순간부터 타일은 손끝을
    // 그대로 따라와야 한다. 남겨 두면 선은 커서에 붙어 있는데 타일이 200ms 뒤에서 오는
    // 고무줄이 된다 (docs/log/2026-09-04-tile-layout-anim.md).
    if (t.closest(".lines")) cancelLayoutAnim();
    const owner = t.closest<HTMLElement>("[data-pane]");
    const id = owner?.dataset.pane;
    const tabId = owner?.dataset.tab;
    if (!id || !tabId) return;
    if (opts.syncOn(tabId) && ev.ctrlKey && ev.button === 0 && !t.closest("button")) {
      ev.preventDefault();
      ev.stopPropagation();
      opts.onsync(tabId, id);
      return;
    }
    opts.onfocus(tabId, id);
  };
  el.addEventListener("pointerdown", onDown, true);
  return () => el.removeEventListener("pointerdown", onDown, true);
}

/**
 * 세션 없는 타일도 **진짜 키보드 포커스**를 갖는다.
 *
 * 예전에는 `Alt+화살표`로 SFTP·파일 타일에 들어가면 **테두리만** 옮겨 오고 키보드는
 * 그대로 아까 그 터미널에 남아 있었다 — 링은 여기, 키는 저기라 다음에 누르는 키가 어디로
 * 갈지 알 수 없었다. 터미널이 `active` 가 되면 rAF 안에서 `term.focus()` 를 부르는 것과
 * **같은 자리·같은 타이밍**에, 여기서는 타일 상자(`[data-tile-focus]`)를 포커스한다.
 *
 * 딱 하나 예외: **이미 그 타일 안에 포커스가 있으면 건드리지 않는다.** 검색 칸·경로 칸에
 * 타이핑하는 중에 상자가 포커스를 도로 뺏으면 글자가 사라진다. 클릭으로 들어온 경우가
 * 정확히 그 모양이다 — pointerdown 위임이 포커스 패널을 먼저 바꾸고(캡처 단계), 브라우저는
 * 그 뒤에 입력칸을 포커스하며, rAF 시점에는 이미 안쪽에 포커스가 있으므로 그냥 비켜난다.
 *
 * ## 안쪽에 **자기 몸**이 있으면 그쪽에 준다
 *
 * 상자(`.pane-body`)에 포커스를 주면 링은 옮겨 오지만, 그 안의 화면이 키를 자기 뿌리에서
 * 듣고 있으면(호스트 트리·파일 브라우저) ↑↓·Enter 가 아무 데도 닿지 않는다 — 예전에
 * `Alt+화살표`로 브라우저 타일에 들어가면 탐색 키가 죽어 있던 것이 정확히 이 어긋남이었다
 * (docs/log/2026-09-03-local-fs-tile.md). 그래서 상자 **안**에 `[data-tile-focus]` 를 단
 * 자손이 있으면 그 자손을 포커스한다. 없으면 상자 자신이 그대로 몸이다.
 */
export function routeTileFocus(
  el: HTMLElement | null,
  paneId: string | null,
): (() => void) | undefined {
  if (!el || !paneId) return;
  const raf = requestAnimationFrame(() => {
    const box = el.querySelector<HTMLElement>(`[data-tile-focus="${CSS.escape(paneId)}"]`);
    if (!box || box.contains(document.activeElement)) return;
    const inner = box.querySelector<HTMLElement>("[data-tile-focus]");
    (inner ?? box).focus({ preventScroll: true });
  });
  return () => cancelAnimationFrame(raf);
}

/**
 * **그 타일의 키보드 몸에 지금 당장 포커스를 준다** (성공하면 `true`).
 *
 * [`routeTileFocus`] 와 무엇이 다른가: 저쪽은 "포커스가 **옮겨 왔을 때**" 링과 키를 맞추는
 * 효과라 rAF 로 미루고 **이미 안쪽에 포커스가 있으면 비켜난다**. 이쪽은 모달이 닫힌 뒤
 * (`app/focus-return`) 포커스를 **도로 가져오는** 한 번의 조작이라 미룰 것도, 비켜날 것도 없다 —
 * 그 순간 포커스는 `<body>` 에 떨어져 있다.
 *
 * 터미널 타일에는 `[data-tile-focus]` 가 없다 — 그쪽 포커스의 주인은 xterm 이고, 그 몸은 화면에
 * 안 보이는 도우미 textarea 다(`PaneHost.svelte` 의 `.pane-body` 주석). 그래서 두 자리를 차례로
 * 본다: 세션 없는 타일은 `[data-tile-focus]`(자손이 있으면 그 자손), 터미널은 xterm 의 textarea.
 */
export function focusPaneBody(paneId: string): boolean {
  if (typeof document === "undefined") return false;
  const box = document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(paneId)}"]`);
  if (!box) return false;
  const outer = box.querySelector<HTMLElement>("[data-tile-focus]");
  const body =
    outer === null
      ? box.querySelector<HTMLElement>("textarea.xterm-helper-textarea")
      : (outer.querySelector<HTMLElement>("[data-tile-focus]") ?? outer);
  if (!body) return false;
  body.focus({ preventScroll: true });
  return true;
}
