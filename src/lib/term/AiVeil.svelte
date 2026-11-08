<script lang="ts">
  // **로컬 AI 타일의 로딩 덮개** — 그리기만 한다(언제 씌우고 걷는지는 순수 `term/ai-veil.ts`, 배선은 `Terminal.svelte`).
  // 머리줄까지 **타일 전체**를 덮는다(`toTileFrame` — 마운트에서 타일 틀로 옮긴다). 가운데 세로로 그림 → 진행 막대 → 열리는 위치.
  // 그림은 설정 "AI 아이콘 모양"(`[ai] icon_style` — 탭 · 머리줄과 같은 전역 한 칸, docs/log/2026-10-31-avatars.md): 로고면 그 CLI 의
  // 브랜드 로고(`iconRef` → `HostIcon`), 아바타면 그 CLI 에 매핑된 아바타의 256px 원본(`$lib/avatars.svelte` 의 `aiAvatarSrc` — 사용자
  // 그림은 처음 한 번 읽는 동안 썸네일). 옛 `[ai] loading_art = "character"` 는 아바타로 옮겨졌다(정규화).
  // 누르면 걷는다(`onlift`) — 키 입력은 xterm 포커스를 그대로 두어 `Terminal` 이 받는다.
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
    /** 덮여 있는가 — 거짓이 되면 페이드로 걷힌다 */
    shown: boolean;
    /** 걷힘을 즉시(움직임 줄이기 · 닫힘) */
    instant: boolean;
    /** 그 CLI 의 로고 이름(`claude` · `codex` — `aiIconName`). 모르면 `null` */
    logo: string | null;
    /** 열리는 폴더 — 모르면 줄째 없다 */
    cwd: string | null;
    /** 워크트리에서 연 타일의 브랜치 — 이미 읽어 둔 것만(없으면 폴더만) */
    branch: string | null;
    onlift: () => void;
  } = $props();

  /** 아바타 그림(모양이 아바타이고 아는 CLI 일 때만) — 없으면 로고 */
  const character = $derived(aiAvatarSrc(logo, true));

  /**
   * 덮개를 **타일 틀(`.tile-frame`) 맨 끝으로** 옮긴다 — 머리줄(`PaneHost` 의 것)까지 타일 전체를 덮으려고(10-24 사용자).
   * 틀이 `overflow: hidden` · 둥근 모서리 · `isolation` 이라 덮개도 그 모양으로 잘리고 층위가 틀 밖으로 새지 않는다.
   * 틀을 못 찾으면(시험 · 틀 밖 마운트) 제자리(`.term`)에 남는다. 지우는 것은 Svelte 가 노드를 직접 지워 옮긴 자리에서도 된다.
   */
  function toTileFrame(node: HTMLElement): void {
    node.closest(".tile-frame")?.appendChild(node);
  }
</script>

{#if shown}
  <!-- 키는 xterm 이 받는다(덮개는 포커스를 가져가지 않는다 — `Terminal` 의 keydown 이 걷는다) -->
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
    z-index: 4; /* 틀 안 머리줄(3) 위 — 틀 맨 끝에 붙어 같은 층의 배너보다도 위다 */
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    padding: 16px;
    box-sizing: border-box;
    /* 터미널 바탕보다 한 단 밝은 **불투명** 면 — 비치면 밑의 명령 줄이 읽힌다 */
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
    border-radius: 50%; /* 아바타는 동그라미(아티스트 얼굴과 같다) */
    object-fit: cover;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.18);
  }

  /* 불확정 진행 막대 — 168×4 알약(끝 둥글게), 채움 38% 가 좌우로 오간다.
     이름이 `.bar` 가 아닌 까닭: `BrowserToolbar` 의 전역 `.bar`(여백 5px · 아래 선)가 덮어써 막대가 굵어졌다(10-24) */
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
  /* 길면 **앞쪽**을 줄임표로 — 상자는 rtl 로 넘치고 글자는 `bdo` 가 ltr 로 지킨다 */
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
      left: 31%; /* 가운데 고정 */
    }
  }
</style>
