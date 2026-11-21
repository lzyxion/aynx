<script lang="ts">
  import { fade } from "svelte/transition";
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { AI_VEIL_TIMING } from "./ai-veil";
  import { aiAvatarSrc } from "$lib/avatars.svelte.js";

  let {
    shown,
    instant,
    logo,
    cwd,
    branch,
    onlift,
  }: {
    shown: boolean;
    instant: boolean;
    logo: string | null;
    cwd: string | null;
    branch: string | null;
    onlift: () => void;
  } = $props();

  const character = $derived(aiAvatarSrc(logo, true));

  /** 머리줄까지 타일 전체를 덮으려고 타일 틀 맨 끝으로 옮긴다 — 틀이 `overflow: hidden` · `isolation` 이라 층위가 밖으로 새지 않는다 */
  function toTileFrame(node: HTMLElement): void {
    node.closest(".tile-frame")?.appendChild(node);
  }
</script>

{#if shown}
  <!-- 덮개는 포커스를 가져가지 않는다 — 키는 xterm 이 받고 `Terminal` 의 keydown 이 걷는다 -->
  <div
    class="ai-veil"
    role="presentation"
    data-ai-veil={character ? "avatar" : "logo"}
    use:toTileFrame
    onpointerdown={(e) => {
      // 포커스를 덮개로 옮기지 않는다 — 걷고 나서 `Terminal` 이 xterm 에 포커스를 준다
      e.preventDefault();
      onlift();
    }}
    out:fade={{ duration: instant ? 0 : AI_VEIL_TIMING.fadeMs }}
  >
    {#if character}
      <img class="character" src={character} alt="" draggable="false" />
    {:else if logo}
      <span class="logo"><HostIcon icon={iconRef(logo)} size={48} /></span>
    {/if}
    <div class="veil-bar" aria-hidden="true"><span class="veil-fill"></span></div>
    {#if cwd}
      <div class="where">
        <UiIcon name={branch ? "git-branch" : "folder"} size={13} />
        <span class="path"><bdo dir="ltr">{cwd}</bdo></span>
        {#if branch}<span class="branch">· {branch}</span>{/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .ai-veil {
    position: absolute;
    inset: 0;
    z-index: 4; /* 틀 안 머리줄(3) 위 */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 16px;
    box-sizing: border-box;
    /* 불투명이어야 한다 — 비치면 밑의 명령 줄이 읽힌다 */
    background: var(--surface-raised-solid);
    cursor: default;
    user-select: none;
  }

  .logo {
    display: inline-flex;
    width: 48px;
    height: 48px;
    align-items: center;
    justify-content: center;
  }

  .character {
    width: 88px;
    height: 88px;
    border-radius: 50%;
    object-fit: cover;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  }

  /* 이름을 `.bar` 로 하지 않는다 — `BrowserToolbar` 의 전역 `.bar` 가 덮어쓴다 */
  .veil-bar {
    position: relative;
    width: 168px;
    max-width: 100%;
    height: 4px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }
  .veil-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 38%;
    border-radius: 999px;
    background: var(--accent);
    animation: ai-veil-sweep 1.3s ease-in-out infinite alternate;
  }
  @keyframes ai-veil-sweep {
    from {
      left: 0;
    }
    to {
      left: 62%;
    }
  }

  .where {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg-2);
  }
  .where :global(svg) {
    flex: 0 0 auto;
  }
  /* 길면 앞쪽을 줄임표로 — 상자는 rtl 로 넘치고 글자는 `bdo` 가 ltr 로 지킨다 */
  .path {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    direction: rtl;
  }
  .branch {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    .veil-fill {
      animation: none;
      left: 31%;
    }
  }
</style>
