/** 타일 테두리 한 번 빛나기 — 그리는 쪽은 `PaneHost` 의 `.pane-box.glow-ok` / `.glow-accent`. */

export type GlowTone = "ok" | "accent";

/** `PaneHost` 의 `tile-glow` 애니메이션 길이(1.4s)와 같은 값 */
export const GLOW_MS = 1400;
export const GLOW_STATIC_MS = 1000;

const glowing = $state<Record<string, GlowTone>>({});
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export function glowTile(paneId: string, tone: GlowTone): void {
  const old = timers.get(paneId);
  if (old) clearTimeout(old);
  // 같은 결로 다시 빛나면 클래스가 붙은 채라 애니메이션이 다시 돌지 않는다 — 한 프레임 걷었다 붙인다.
  delete glowing[paneId];
  const start = () => {
    glowing[paneId] = tone;
    timers.set(
      paneId,
      setTimeout(
        () => {
          delete glowing[paneId];
          timers.delete(paneId);
        },
        reducedMotion() ? GLOW_STATIC_MS : GLOW_MS,
      ),
    );
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(start);
  else start();
}

export function tileGlowOf(paneId: string): GlowTone | null {
  return glowing[paneId] ?? null;
}
