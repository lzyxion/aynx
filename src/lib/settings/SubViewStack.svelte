<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * Escape 는 하위 화면에 있는 동안만 창에 캡처로 받아 끊는다 — 설정 모달(독 뿌리의 keydown)보다 먼저 받아야 모달이 닫히지 않는다.
   * 이 화면이 든 모달 밖(위에 뜬 다른 대화상자)의 Escape 는 그쪽 것이다.
   */
  let {
    view,
    dir,
    onescape = null,
    root = $bindable(null),
    children,
  }: {
    view: string;
    dir: "fwd" | "back" | null;
    /** 요약에서는 `null` — Escape 는 모달 몫이다 */
    onescape?: (() => void) | null;
    root?: HTMLElement | null;
    children: Snippet;
  } = $props();

  $effect(() => {
    const fn = onescape;
    if (!fn) return;
    const scope = root?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.isComposing) return;
      if (!(ev.target instanceof Node) || !scope.contains(ev.target)) return;
      ev.preventDefault();
      ev.stopPropagation();
      fn();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

<div class="sub-views" bind:this={root}>
  {#key view}
    <div class="view" class:enter-fwd={dir === "fwd"} class:enter-back={dir === "back"} data-view={view}>
      {@render children()}
    </div>
  {/key}
</div>

<style>
  /* 자르는 선을 padding/음수 margin 으로 왼쪽 12 · 오른쪽 4px 넓힌다 — 좁히면 양 끝 포커스 링이 잘린다. `.settings-panel` 여백보다 넓히면 가로 스크롤이 생긴다.
     `overflow-clip-margin` 은 쓰지 않는다 — 한 축만 clip 이면 Chromium(WebView2)이 무시한다(focus-ring-clip-harness 의 픽셀 확인). */
  .sub-views {
    overflow-x: clip;
    margin: 0 -4px 0 -12px;
    padding: 0 4px 0 12px;
  }

  .view.enter-fwd {
    animation: sub-view-in-fwd 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .view.enter-back {
    animation: sub-view-in-back 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @keyframes sub-view-in-fwd {
    from {
      transform: translateX(32px);
      opacity: 0;
    }
  }

  @keyframes sub-view-in-back {
    from {
      transform: translateX(-32px);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .view.enter-fwd,
    .view.enter-back {
      animation: none;
    }
  }
</style>
