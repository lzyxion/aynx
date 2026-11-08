<script lang="ts">
  // ---------------------------------------------------------------------------
  // **에이전트 상태 글리프**(M3 · Material Symbols 모양 — docs/log/2026-11-03-tab-status-glyphs.md) — 탭 줄 ·
  // 프로젝트/호스트 독 · 브랜치 그래프 · 시작 화면 · 모바일이 그리는 **한 벌**이다. 예전 6~8px 점(전역 `.agentdot` +
  // `data-sig` 후광 · 물결 · 숨 쉬기)을 대신한다:
  //   권한 대기 = pending(강조색 판 · 점 셋) · 완료 = check_circle(초록 판 · 체크) · 실행 중 = M3 원형 진행 표시(돈다 ·
  //   움직임 줄이기면 멈춘 호).
  // 겉 클래스 `agentdot {state}` 는 이름만 남긴 손잡이다(하네스 · 부모의 자리 규칙이 찾는다) — 모양은 전부 여기 있다.
  // `state` 가 `null` 이면 **같은 크기의 빈 자리**(시작 화면 줄이 점 없는 줄에도 칸을 맞춘다).
  // 크기는 부르는 쪽이 정하되 10px 아래로 내리지 않는다(판 위 기호가 뭉개진다).
  // ---------------------------------------------------------------------------
  import type { HTMLAttributes } from "svelte/elements";
  import type { AgentStatus } from "$lib/agent-status";

  let {
    state,
    size = 12,
    ...rest
  }: { state: AgentStatus | null; size?: number } & Omit<HTMLAttributes<HTMLSpanElement>, "class"> = $props();
</script>

<span class="agentdot {state ?? 'none'}" style:--glyph={`${size}px`} {...rest}>
  {#if state === "permission"}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" class="plate-accent" />
      <circle cx="7" cy="12" r="1.6" class="on-accent" />
      <circle cx="12" cy="12" r="1.6" class="on-accent" />
      <circle cx="17" cy="12" r="1.6" class="on-accent" />
    </svg>
  {:else if state === "finished"}
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" class="plate-ok" />
      <path d="M7.5 12.4l3 3 6-6.2" class="on-ok" />
    </svg>
  {:else if state === "running"}
    <!-- M3 원형 진행 표시(불확정) — 호와 트랙 사이에 틈을 두고 둘이 함께 돈다. 둘레 2π·9 ≈ 56.55 -->
    <svg viewBox="0 0 24 24" aria-hidden="true" class="spin">
      <circle cx="12" cy="12" r="9" class="track" stroke-dasharray="27.55 29" stroke-dashoffset="-23" />
      <circle cx="12" cy="12" r="9" class="arc" stroke-dasharray="17 39.55" />
    </svg>
  {/if}
</span>

<style>
  .agentdot {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--glyph);
    height: var(--glyph);
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  /* 판 · 판 위 기호는 테마 역할 색만 — 테마 프로필을 따라간다 */
  .plate-accent {
    fill: var(--accent);
  }
  .on-accent {
    fill: var(--on-accent);
  }
  .plate-ok {
    fill: var(--ok);
  }
  /* 초록 판 위 체크 — 성공의 on 토큰이 따로 없어 바탕 면(다크 = 어둡게 · 라이트 = 밝게)을 쓴다 */
  .on-ok {
    fill: none;
    stroke: var(--m3-surface);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .track,
  .arc {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
  }
  .track {
    stroke: var(--m3-outline-variant);
  }
  .arc {
    stroke: var(--accent);
  }
  .spin {
    transform-origin: 50% 50%;
    animation: agent-glyph-spin 1.2s linear infinite;
  }
  /* 움직임 줄이기면 돌지 않는다 — 멈춘 호도 "실행 중" 으로 읽힌다 */
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
  @keyframes agent-glyph-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
