/**
 * 워크스페이스 전환 움직임 — 축은 상태바의 방향을 따른다.
 * - `transform` 만 움직인다 — 투명도 페이드는 쓰지 않는다(0 에서 시작하면 첫 프레임에 뒤의 창 바탕이 번쩍 보인다).
 * - `fill` 을 두지 않는다 — 끝난 뒤 transform 이 남으면 안쪽 `position: fixed` 메뉴의 기준 상자가 바뀐다.
 */

export const WORKSPACE_SLIDE = {
  ms: 200,
  px: 12,
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

/** 뒤로 가면 `1`(다음 칸 쪽에서 온다) · 앞으로 가면 `-1` · 같거나 모르면 `0`(걸지 않는다) */
export function workspaceSlideDir(fromIndex: number, toIndex: number): 1 | -1 | 0 {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return 0;
  return toIndex > fromIndex ? 1 : -1;
}

export function workspaceSlideFrom(dir: 1 | -1, vertical: boolean): string {
  const d = WORKSPACE_SLIDE.px * dir;
  return vertical ? `translateY(${d}px)` : `translateX(${d}px)`;
}

const TARGETS = ".titlebar > .tabs, [data-tile-canvas]";

/** 설정을 읽지 않고 그려진 띠를 본다 — 이 모듈을 잎으로 두려고 */
function verticalBar(): boolean {
  return document.querySelector(".statusbar.vertical") !== null;
}

export function playWorkspaceSlide(dir: 1 | -1): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const from = workspaceSlideFrom(dir, verticalBar());
  for (const el of document.querySelectorAll<HTMLElement>(TARGETS)) {
    for (const a of el.getAnimations()) if (a.id === "workspace-slide") a.cancel();
    const anim = el.animate(
      [
        { transform: from },
        { transform: "none" },
      ],
      { duration: WORKSPACE_SLIDE.ms, easing: WORKSPACE_SLIDE.ease },
    );
    anim.id = "workspace-slide";
  }
}
