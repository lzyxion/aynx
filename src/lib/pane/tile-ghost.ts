/**
 * **닫히는 타일의 유령** — 새 타일 등장(`PaneHost` 의 `tileIn`: 0.85 → 1 · 투명 → 불투명)의 거울
 * (배치 애니메이션 전반은 docs/log/2026-09-04-tile-layout-anim.md).
 *
 * 진짜 상자는 붙잡지 않는다 — 상자가 살아 있는 동안 `<Terminal>` 도 살고, 그 언마운트가 곧 세션 종료라서다.
 * 그래서 닫기 직전(DOM 이 아직 그대로인 순간) 상자를 **복제**해 같은 자리에 얹고, 진짜 상자는 평소처럼 곧바로
 * 사라진다. 유령이 먼저 줄며 사라지고(`TILE_EXIT_MS`), 옆 타일은 뒤이어(`CLOSE_SLIDE_DELAY_MS`) 그 아래로 미끄러져
 * 빈자리를 채운다 — 차례 닫기(`layout-anim.svelte.ts`).
 *
 * 복제는 **그림일 뿐**이다: 선택자(`id` · `data-*`)를 걷어 하네스 · `tabLayers` 가 진짜로 착각하지 않게 하고,
 * `inert` · `aria-hidden` · `pointer-events:none` 이라 포커스도 커서도 받지 않는다. 다시 읽어 들이는 요소
 * (iframe · 미디어)는 뺀다. 캔버스는 복제하면 빈 판이라 2D 로 옮겨 그리기를 **시도**한다 — xterm WebGL 은
 * 그리기 버퍼를 지키지 않아(`preserveDrawingBuffer` 끔) 투명으로 올 수 있는데, 그래도 판(`.tile-frame` 의
 * `--term-bg-fill`)이 그대로라 빈 터미널 바탕으로 보일 뿐 어색한 구멍은 없다.
 */

// 유령 길이 — 차례 닫기의 앞 토막(옆 타일은 `CLOSE_SLIDE_DELAY_MS` 뒤에 미끄러진다)
import { TILE_EXIT_MS } from "$lib/layout-anim.svelte.js";

/** 복제에서 빼는 요소 — 다시 읽어 들이거나(네트워크 · 재생) 그림이 아닌 것 */
const DROP = "iframe, webview, object, embed, video, audio, script";

/**
 * `box` 의 지금 모양을 `layer` 에 유령으로 얹고, 줄며 사라진 뒤 지운다. 만든 유령을 돌려준다
 * (보이지 않는 상자 — `display:none` · 크기 0 — 면 만들지 않고 `null`).
 */
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
  // 레이아웃 값(transform 무시)으로 지금 자리를 그대로 — 트랜지션 도중이어도 보이는 그 자리다
  ghost.style.cssText = `left:${box.offsetLeft}px;top:${box.offsetTop}px;width:${w}px;height:${h}px;pointer-events:none;transition:none`;
  layer.appendChild(ghost);
  const fade = glassFade(ghost) ? "--tile-in" : "opacity";
  const anim = ghost.animate(
    [
      { [fade]: 1, transform: "scale(1)" },
      { [fade]: 0, transform: "scale(0.85)" },
    ],
    // 등장(cubicOut)의 거울 쪽이되 가벼운 ease-in — cubicIn 은 짧은 길이에서 앞부분이 서 있는 것처럼 굼떴다
    { duration: TILE_EXIT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  );
  anim.onfinish = () => ghost.remove();
  anim.oncancel = () => ghost.remove();
  return ghost;
}

/**
 * 이 타일 상자는 `opacity` 대신 `--tile-in` 으로 페이드하는가 — 글래스 재질의 크롬 타일(`.glass-tile`)이면 그렇다. 상자의 `opacity` 는
 * 배경 뿌리라 그동안 흐림 판이 뒤를 못 보고 비었다(10-29). `--tile-in` 은 `PaneHost` 의 `.glass-tile` 규칙이 겹마다 곱한다 —
 * 등장(`tileIn`)과 이 유령이 같이 쓴다.
 */
export function glassFade(box: Element): boolean {
  return box.classList.contains("glass-tile") && document.documentElement.dataset.material === "glass";
}

/** 진짜로 착각하게 하는 표지 — `id` · `data-*` · 포커스 · 이름 */
function stripSelectors(el: Element): void {
  for (const name of [...el.getAttributeNames()]) {
    if (name === "id" || name === "tabindex" || name === "autofocus" || name === "name" || name.startsWith("data-")) {
      el.removeAttribute(name);
    }
  }
}

/** 복제된 캔버스는 비어 있다 — 원본을 2D 로 옮겨 그린다(못 하면 투명 그대로, 아래 판이 보인다) */
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
