<script lang="ts">
  // **오케스트레이션 로고 · 앨범 상태 그림 하나**(오케스트레이션 탭 — 노트 5-2 · 2026-10-31 사용자 결정 "로고 = 헤드폰 · 상태는 플레이어 기호" ·
  // 목업 V3TabStates A안 · V3DockLogo). 상태는 `model/pulse.ts` 의 `Pulse` 낱말 그대로:
  //
  // | state | 모양 | 색 |
  // | --- | --- | --- |
  // | `playing` | 움직이는 이퀄라이저 막대 넷 | 강조색(파랑) |
  // | `reviewing` | 움직이는 이퀄라이저 막대 넷 | 3차 색(보라) |
  // | `attention` | ⏸ 일시정지(세로 둥근 막대 둘 · 움직임 없음) | 경고색(호박) |
  // | `paused` | `attention` 과 **같은** ⏸(조율 멈춤 — 사용자 "통일") | 경고색(호박) |
  // | `idle` | 헤드폰 로고 | 흐린 글자색(회색) |
  // | `done` | 원 테두리 안의 ✓ | 성공색(초록) |
  // | `logo` | 헤드폰 로고 | 그 자리의 글자색(`currentColor`) |
  //
  // 움직임 줄이기(`prefers-reduced-motion`)면 `playing` · `reviewing` 도 멈춘 막대(색으로만 가른다). 보이지 않는 탭의 막대는 `display:none` 이라
  // 돌지 않는다. 그림 칸의 폭은 상태와 무관하게 막대 넷의 폭(크기보다 좁으면 크기)이라 상태가 바뀌어도 옆 글자가 밀리지 않는다.
  // 정적 로고만 필요한 자리(설정 메뉴 · 팔레트 · 알림 줄 · 런처 독 칸)는 같은 헤드폰의 `UiIcon name="orchestra"` 를 쓴다.
  import { UI_ICONS } from "$lib/ui-icons.generated";
  import type { Pulse } from "./model/pulse";

  let {
    state = "playing",
    size = 14,
    label,
  }: { state?: Pulse; size?: number; label?: string } = $props();

  const bars = $derived(state === "playing" || state === "reviewing");
  const barW = $derived(Math.max(2, Math.round(size / 4.6)));
  /** 막대 넷의 정지 높이(비율) · 움직임 위상 */
  const HEIGHTS = [0.55, 1, 0.35, 0.8];
  const DELAYS = ["0s", "-0.35s", "-0.7s", "-0.2s"];
</script>

<span
  class="eq"
  data-eq={state}
  style:height="{size}px"
  style:width="{Math.max(size, barW * 4 + 6)}px"
  style:--eq-w="{barW}px"
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
  title={label}
>
  {#if bars}
    {#each HEIGHTS as h, i (i)}
      <span class="eq-bar" style:--h={h} style:--d={DELAYS[i]}></span>
    {/each}
  {:else}
    <svg width={size} height={size} viewBox="0 0 24 24" data-eq-shape={state === "attention" || state === "paused" ? "pause" : state === "done" ? "check" : "headphones"}>
      {#if state === "attention" || state === "paused"}
        <rect x="6.5" y="5" width="3.8" height="14" rx="1.3" fill="currentColor" />
        <rect x="13.7" y="5" width="3.8" height="14" rx="1.3" fill="currentColor" />
      {:else if state === "done"}
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M8 12.4l2.8 2.8 5.3-5.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      {:else}
        <!-- 헤드폰 — 정적 로고 `orchestra` 와 같은 생성 마크업(빌드 시점 · 사용자 입력 아님) -->
        {@html UI_ICONS.orchestra.body}
      {/if}
    </svg>
  {/if}
</span>

<style>
  .eq {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: flex-end;
    justify-content: center;
    gap: 2px;
    color: currentColor;
  }
  .eq > svg {
    display: block;
    align-self: center;
  }
  .eq > .eq-bar {
    width: var(--eq-w);
    height: 100%;
    border-radius: 1px;
    background: currentColor;
    transform-origin: bottom;
    transform: scaleY(var(--h));
    animation: eq-bounce 1.1s ease-in-out infinite;
    animation-delay: var(--d);
  }
  .eq[data-eq="playing"] {
    color: var(--accent);
  }
  .eq[data-eq="reviewing"] {
    color: var(--tertiary, var(--accent));
  }
  .eq[data-eq="attention"],
  .eq[data-eq="paused"] {
    color: var(--warn);
  }
  .eq[data-eq="idle"] {
    color: var(--fg-muted, currentColor);
  }
  .eq[data-eq="done"] {
    color: var(--ok);
  }
  @keyframes eq-bounce {
    0%,
    100% {
      transform: scaleY(var(--h));
    }
    50% {
      transform: scaleY(calc(1.15 - var(--h) * 0.8));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .eq > .eq-bar {
      animation: none !important;
    }
  }
</style>
