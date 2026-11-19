<script lang="ts">
  import type { Snippet } from "svelte";

  /**
   * 설정 섹션의 **요약 ↔ 하위 화면** 자리 — 자동 승인(`AutomationSection`) · 트리거(`TriggersSection`) · 스니펫(`SnippetsSection`) · 외부 MCP 서버(`ExternalMcpServers`) · 보안(`CredentialsSection`) · 테마의 아바타(`AppThemeSection` — Escape 는 `AvatarsSection` 이 받는다)가 함께 쓴다
   * (docs/log/2026-10-05-trigger-examples.md "하위 화면으로").
   *
   * - **움직임** — `view` 가 바뀌면 들어오는 화면만 미끄러진다(`dir` = `"fwd"` 오른쪽에서 · `"back"` 왼쪽에서,
   *   200ms · `null` 이면 움직이지 않는다 · reduced-motion 이면 즉시). 나가는 화면은 그 자리에서 사라진다.
   * - **Escape** — `onescape` 가 있는 동안(= 하위 화면에 있는 동안)만 창에 **캡처**로 받아 거기서 끊는다: 설정 모달
   *   (독 뿌리의 keydown)보다 먼저 받아 모달이 닫히지 않게 하고, 요약으로만 돌아간다. 한 번 더 Escape 면 늘 그렇듯
   *   모달이 닫힌다. 이 화면이 든 모달 **밖**(위에 뜬 다른 대화상자)의 Escape 는 그쪽 것이다.
   *
   * 어느 화면을 그릴지 · 돌아온 뒤 포커스 · 섹션이 안 보이게 되면 요약으로 가는 일은 부르는 쪽이 맡는다.
   */
  let {
    view,
    dir,
    onescape = null,
    root = $bindable(null),
    children,
  }: {
    /** 지금 화면의 이름 — 바뀌면 본문을 새로 그리며 미끄러진다(`data-view` 로도 남는다) */
    view: string;
    dir: "fwd" | "back" | null;
    /** 하위 화면에서 Escape 를 받았을 때 — 요약에서는 `null`(Escape 는 모달 몫이다) */
    onescape?: (() => void) | null;
    /** 바깥 상자 — 부르는 쪽이 `.settings-panel` 을 찾아 맨 위로 굴리는 데 쓴다 */
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
  /* 가로로 밀려 나오는 동안 설정 본문에 가로 스크롤이 생기지 않게 자른다.
     자르는 선은 본문 밖 왼쪽 12px · 오른쪽 4px — 폭을 다 쓰는 칸 · 양 끝의 단추에 **포커스 링**(상자 밖 3~4px)이 설 자리다
     (2026-11-19 — 보안 찾기 칸 · 사이드 채팅 지침 입력 상자의 링이 좌우로 잘렸다). 왼쪽 12 = [‹ 돌아가기](본문보다 8px 왼쪽) + 링 4.
     padding 으로 넓히고 같은 음수 margin 으로 되돌려 내용 자리는 그대로다. 왼쪽은 `.settings-panel` 의 왼쪽 여백(12) 안, 오른쪽은
     그 오른쪽 여백(스크롤 막대 몫 8) 안이라 미끄러지는 동안에도 가로 스크롤이 생기지 않는다.
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
