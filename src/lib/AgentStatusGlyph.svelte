<script lang="ts">
  // 겉 클래스 `agentdot {state}` 는 하네스 · 부모의 자리 규칙이 찾는 손잡이다 — 바꾸지 않는다.
  // `state` 가 `null` 이어도 같은 크기의 빈 자리를 둔다 · 10px 아래로 내리면 판 위 기호가 뭉개진다.
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
    <!-- 둘레 2π·9 ≈ 56.55 -->
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

  .plate-accent {
    fill: var(--accent);
  }
  .on-accent {
    fill: var(--on-accent);
  }
  .plate-ok {
    fill: var(--ok);
  }
  /* 성공의 on 토큰이 따로 없어 바탕 면을 쓴다 */
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
