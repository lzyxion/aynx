/**
 * **타일 테두리 한 번 빛나기** — 에이전트 배너의 [보기] · 그 타일로 가서 풀린 알림이 "여기다" 를
 * 가리키는 손끝 피드백 (docs/log/2026-09-27-agent-banners.md).
 *
 * 벨 번쩍임(`app/bell.svelte.ts`)과 같은 모양이다: 표식은 **타일 id** 로 들고, 그리는 쪽은
 * `PaneHost` 의 `.pane-box.glow-ok` / `.glow-accent`. 탭 구조를 모르므로 의존이 한 방향이다.
 *
 * 길이는 움직임에 따라 다르다 — 보통은 1.4초 빛이 번졌다 걷히고, 움직임을 줄여 달라고 했으면 1초
 * 동안 가만히 선 테두리 한 줄이다(CSS 가 애니메이션을 끄고 이 시간만큼 클래스가 붙어 있다).
 */

/** 빛의 결 — 끝남은 `--ok`, 권한 물음은 `--accent` */
export type GlowTone = "ok" | "accent";

export const GLOW_MS = 1400;
export const GLOW_STATIC_MS = 1000;

const glowing = $state<Record<string, GlowTone>>({});
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** 그 타일을 한 번 빛낸다 — 빛나는 중이면 처음부터 다시 */
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

/** `PaneHost` 가 읽는다 — 빛나는 중이 아니면 `null` */
export function tileGlowOf(paneId: string): GlowTone | null {
  return glowing[paneId] ?? null;
}
