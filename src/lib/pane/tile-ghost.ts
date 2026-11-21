/**
 * 닫히는 타일의 유령 — 진짜 상자는 붙잡지 않는다: 상자가 살아 있으면 `<Terminal>` 도 살고, 그 언마운트가 곧 세션 종료다.
 * - 복제의 선택자(`id` · `data-*`)를 걷는다 — 하네스 · `tabLayers` 가 진짜로 착각하지 않게.
 * - xterm WebGL 은 `preserveDrawingBuffer` 끔이라 캔버스 복사가 투명으로 올 수 있다 — 판(`--term-bg-fill`)이 비쳐 빈 터미널 바탕으로 보인다.
 */

import { TILE_EXIT_MS } from "$lib/layout-anim.svelte.js";

/** 다시 읽어 들이거나(네트워크 · 재생) 그림이 아닌 것 */
const DROP = "iframe, webview, object, embed, video, audio, script";

export function spawnTileGhost(box: HTMLElement, layer: HTMLElement): HTMLElement | null {
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  if (w === 0 || h === 0) return null;
  const ghost = box.cloneNode(true) as HTMLElement;
  for (const el of ghost.querySelectorAll(DROP)) el.remove();
  copyCanvases(box, ghost);
  for (const el of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) stripSelectors(el);
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  ghost.style.cssText = `left:${box.offsetLeft}px;top:${box.offsetTop}px;width:${w}px;height:${h}px;pointer-events:none;transition:none`;
  layer.appendChild(ghost);
  const fade = glassFade(ghost) ? "--tile-in" : "opacity";
  const anim = ghost.animate(
    [
      { [fade]: 1, transform: "scale(1)" },
      { [fade]: 0, transform: "scale(0.85)" },
    ],
    // cubicIn 은 쓰지 않는다 — 짧은 길이에서 앞부분이 서 있는 것처럼 굼떴다
    { duration: TILE_EXIT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  );
  anim.onfinish = () => ghost.remove();
  anim.oncancel = () => ghost.remove();
  return ghost;
}

/**
 * 글래스 재질의 크롬 타일은 `opacity` 대신 `--tile-in` 으로 페이드한다 — 상자의 `opacity` 는 배경 뿌리라 그동안 흐림 판이 뒤를 못 보고 빈다.
 * `--tile-in` 은 `PaneHost` 의 `.glass-tile` 규칙이 겹마다 곱한다.
 */
export function glassFade(box: Element): boolean {
  return box.classList.contains("glass-tile") && document.documentElement.dataset.material === "glass";
}

function stripSelectors(el: Element): void {
  for (const name of [...el.getAttributeNames()]) {
    if (name === "id" || name === "tabindex" || name === "autofocus" || name === "name" || name.startsWith("data-")) {
      el.removeAttribute(name);
    }
  }
}

function copyCanvases(from: HTMLElement, to: HTMLElement): void {
  const src = from.querySelectorAll("canvas");
  const dst = to.querySelectorAll("canvas");
  src.forEach((c, i) => {
    const d = dst[i];
    if (!d || c.width === 0 || c.height === 0) return;
    try {
      d.getContext("2d")?.drawImage(c, 0, 0);
    } catch {
      // 오염된 캔버스 등 — 판만 남긴다
    }
  });
}
