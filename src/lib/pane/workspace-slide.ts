/**
 * **워크스페이스 전환 움직임** (2026-10-04) — 워크스페이스를 바꾸면 탭 줄과 타일 캔버스가 짧게 미끄러지며
 * 나타난다. 탭 전환 슬라이드(docs/log/2026-09-29-tab-slide.md · `tab-slide.svelte.ts`)와 같은 결이되 한 층
 * 위의 일이라 축이 **상태바의 방향**을 따른다: 세로 기둥(왼쪽·오른쪽)이면 위/아래, 가로 띠(위·아래)면
 * 좌/우. 방향은 상태바 목록의 순서 비교다 — 뒤쪽 워크스페이스로 가면 다음 칸 쪽(아래·오른쪽)에서 온다.
 *
 * 움직이는 것은 **`transform` 뿐**이다 — 투명도 페이드는 걷었다(2026-10-05 사용자 보고): 0 에서 시작하면 첫
 * 프레임에 탭 줄·캔버스가 통째로 비어 뒤의 창 바탕이 번쩍 보였다. 새 화면은 처음부터 보이는 채로 짧게만 민다.
 * Web Animations 에 채움(`fill`)이 없다 — 끝나면 transform
 * 이 남지 않는다(남으면 안쪽 `position: fixed` 메뉴의 기준 상자가 바뀐다). 기하를 건드리지 않으므로 xterm
 * 은 크기를 다시 재지 않고(`resize_session` 없음), 포커스도 건드리지 않는다(포커스는 `restoreSelection` ·
 * `revealPane` 의 몫).
 *
 * 걸지 않는 때: 움직임 줄이기 · 대시보드/사용량 화면이 캔버스를 덮고 있을 때(부르는 쪽이 본다 — 탭 슬라이드
 * 규칙과 같다).
 *
 * 이 모듈은 아무것도 import 하지 않는다.
 */

export const WORKSPACE_SLIDE = {
  ms: 200,
  px: 12,
  ease: "cubic-bezier(0.2, 0.8, 0.2, 1)",
} as const;

/**
 * 목록 순서 → 방향. 뒤로 가면 `1`(다음 칸 쪽에서 온다), 앞으로 가면 `-1`, 같거나 모르면 `0`(걸지 않는다).
 * 순수 함수.
 */
export function workspaceSlideDir(fromIndex: number, toIndex: number): 1 | -1 | 0 {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return 0;
  return toIndex > fromIndex ? 1 : -1;
}

/** 출발 `transform` — 세로 축이면 Y, 가로면 X. 순수 함수. */
export function workspaceSlideFrom(dir: 1 | -1, vertical: boolean): string {
  const d = WORKSPACE_SLIDE.px * dir;
  return vertical ? `translateY(${d}px)` : `translateX(${d}px)`;
}

/** 움직일 상자 — 탭 줄(`.titlebar .tabs` — 창 제어 단추는 빼고)과 타일 캔버스(`[data-tile-canvas]`) */
const TARGETS = ".titlebar > .tabs, [data-tile-canvas]";

/** 지금 상태바가 세로 기둥인가 — 설정을 읽지 않고 그려진 띠를 본다(이 모듈을 잎으로 두려고) */
function verticalBar(): boolean {
  return document.querySelector(".statusbar.vertical") !== null;
}

/** 탭 줄 · 캔버스를 그 방향에서 미끄러져 들어오게 한다 (움직임 줄이기면 아무것도 안 한다) */
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
