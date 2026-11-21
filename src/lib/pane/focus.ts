import { cancelLayoutAnim } from "$lib/layout-anim.svelte.js";

export interface TileFocusOptions {
  /** 이 탭의 동시 입력이 켜져 있을 때만 `Ctrl+클릭` 을 가로챈다 */
  syncOn: (tabId: string) => boolean;
  onfocus: (tabId: string, paneId: string) => void;
  onsync: (tabId: string, paneId: string) => void;
}

/**
 * 캡처 단계 위임이라 xterm 이 포커스를 가져가기 전에 먼저 안다.
 * 머리줄 단추 위의 Ctrl+클릭은 비켜 준다 — 함께 뒤집으면 두 가지가 한 번에 일어난다.
 */
export function delegateTileFocus(
  el: HTMLElement | null,
  opts: TileFocusOptions,
): (() => void) | undefined {
  if (!el) return;
  const onDown = (ev: PointerEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    // 배치 트랜지션 중 분할선을 잡으면 곧바로 끈다 — 남기면 타일이 커서 뒤에서 고무줄처럼 따라온다
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
 * 세션 없는 타일에도 진짜 키보드 포커스를 준다 — 안쪽 `[data-tile-focus]` 자손이 키를 들으면 그쪽에.
 * 이미 그 타일 안에 포커스가 있으면 건드리지 않는다 — 입력 칸에 치는 중 상자가 포커스를 뺏으면 글자가 사라진다.
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

/** 모달이 닫힌 뒤 포커스를 도로 가져온다 — 터미널 타일에는 `[data-tile-focus]` 가 없어 xterm 의 도우미 textarea 에 준다 */
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
