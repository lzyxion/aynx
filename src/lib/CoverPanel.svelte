<script lang="ts">
  import { tick, untrack, type Snippet } from "svelte";
  import { isEditableTarget } from "$lib/keybindings";
  import UiIcon from "$lib/UiIcon.svelte";
  import { currentOpacity, playClose, playOpen, prefersReducedMotion } from "$lib/console/dashboard-motion";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // ---------------------------------------------------------------------------
  // **캔버스를 덮는 판의 껍데기** (2026-10-17 — 사용량 화면 `UsageView.svelte` 에서 뗐다. 자원 화면 `ResourceView.svelte` 가 같은 급의
  // 둘째 판이 되면서 같은 껍데기를 나눠 쓴다). 어느 판이 떠 있는지는 `app/usage-view.svelte.ts` 하나가 쥔다(둘이 동시에 서지 않는다).
  //
  // 껍데기는 전체 화면 대시보드(2026-10-07 에 세션 시트 · 작업안 타일로 나뉘어 없어졌다)와 같은 말이었다:
  // `.pane` 을 `inset: 0` 으로 덮는 불투명 판 · 늘 마운트 ·
  // `hidden` 으로 숨음 · 열리면 키보드를 가져옴 · Escape 로 닫힘 · 닫히는 동안 `inert` 로 흐려짐. 다른 것은
  // 움직임의 방향뿐이다 — 상태바의 고리에서 나오는 판이라 **아래에서 떠오르고 아래로 내려가며** 걷힌다
  // (`dashboard-motion.ts` 의 `slide` 갈래).
  //
  // `data-cover-view` 는 `tabs.svelte.ts` 가 "포커스가 이 판 안에 있었나" 를 볼 때 쓰는 표식이다. 판마다의 손잡이
  // (`data-usage-view` · `data-resource-view` — 하네스가 잡는다)는 부르는 쪽이 `data-*` 로 얹는다.
  // ---------------------------------------------------------------------------

  let {
    open,
    title,
    subtitle,
    onclose,
    children,
    ...attrs
  }: {
    /** 이 판이 지금 떠 있는가 */
    open: boolean;
    title: string;
    subtitle: string;
    /** × · Escape — 포커스를 열기 전 자리로 돌려주며 닫는다 */
    onclose: () => void;
    children: Snippet;
    [key: `data-${string}`]: unknown;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);

  /** 열리면 키보드를 판으로 — 캔버스를 덮었는데 포커스가 밑의 터미널에 남으면 글자가 보이지 않는 셸로 간다 */
  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      if (panelEl && !panelEl.contains(document.activeElement)) panelEl.focus({ preventScroll: true });
    });
  });

  // 여닫기 움직임 — 닫힘은 즉시, 흔적만 `lingering` 동안(옛 대시보드 판과 같은 모형).
  /** 닫혔지만 내려가는 중 — `hidden` 을 미룬다 */
  let lingering = $state(false);
  let exitAnim: Animation | null = null;
  let wasOpen = false;

  function cancelExit(): number {
    if (exitAnim === null || panelEl === null) return 0;
    const from = currentOpacity(panelEl);
    const a = exitAnim;
    exitAnim = null;
    a.cancel();
    lingering = false;
    return from;
  }

  $effect.pre(() => {
    const now = open;
    untrack(() => {
      if (now === wasOpen) return;
      wasOpen = now;
      if (now || panelEl === null || prefersReducedMotion()) return;
      lingering = true;
      const a = playClose(panelEl, "slide");
      exitAnim = a;
      a.finished.then(
        () => {
          if (exitAnim !== a) return;
          exitAnim = null;
          lingering = false;
          void tick().then(() => a.cancel());
        },
        () => {},
      );
    });
  });

  $effect(() => {
    if (!open) return;
    untrack(() => {
      const from = cancelExit();
      if (panelEl && !prefersReducedMotion()) playOpen(panelEl, from, "slide");
    });
  });

  /** Escape — 입력칸이 아닐 때만 닫고 전파를 끊는다(창 층위 Escape 사슬이 한 번 더 먹지 않게) */
  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    if (isEditableTarget(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    onclose();
  }
</script>

<!--
  `role="presentation"` · `tabindex="-1"` · `hidden`/`inert`/`data-closing` 은 옛 대시보드 판과 같은 규칙이다.
-->
<div
  {...attrs}
  class="cover-view"
  role="presentation"
  bind:this={panelEl}
  hidden={!open && !lingering}
  inert={!open}
  data-closing={!open && lingering ? "" : undefined}
  tabindex="-1"
  data-cover-view
  onkeydown={onKeydown}
>
  <div class="head">
    <span class="title">{title}</span>
    <span class="sub">{subtitle}</span>
    <span class="head-fill"></span>
    <button
      type="button"
      class="btn btn-ghost head-close"
      title={t("board.close.title")}
      aria-label={t("board.close")}
      onclick={() => onclose()}><UiIcon name="close" size={14} /></button
    >
  </div>
  <div class="body">
    {@render children()}
  </div>
</div>

<style>
  /*
   * 캔버스 위의 판(z-index 90 — 타일(캔버스 안 최고 21)보다 위, 독(100)보다 아래). **타일 한 장처럼 보인다**(10-27 사용자 —
   * 직각 · 꽉 채움이 이 판들만 달랐다): 타일 캔버스와 같은 틈(`--gap`) 안쪽 · 타일 모서리(`--radius-surface`) · 타일 테두리
   * (글래스면 `--tile-rim`). 면은 프로젝트 시작 화면과 같은 **크롬의 우물**(`--surface-field` — 크롬 투명도 슬라이더를 탄다):
   * 크롬 글자를 얹는 판이라 터미널 판이 아니다. 판이 비치므로 그 밑의 타일은 판이 떠 있는 동안 감춘다(+page `.pane` — 마운트 ·
   * 출력은 그대로).
   */
  .cover-view {
    position: absolute;
    inset: var(--gap);
    z-index: 90;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface-field);
    background-clip: padding-box;
    border: 1px solid var(--tile-rim, var(--line-faint));
    border-radius: var(--radius-surface);
    overflow: hidden;
  }

  .cover-view[hidden] {
    display: none;
  }

  .cover-view:focus {
    outline: none;
  }

  .cover-view[data-closing] {
    pointer-events: none;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 48px;
    box-sizing: border-box;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--line-faint);
  }

  .title {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    flex: 0 1 auto;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-fill {
    flex: 1;
  }

  .head-close {
    flex: 0 0 auto;
    width: 28px;
    padding: 0;
    color: var(--fg-2);
  }

  /* 본문 — 대시보드와 같은 1080px 가운데 열 */
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-4) var(--space-4);
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  .body > :global(*) {
    max-width: 1080px;
    margin-inline: auto;
  }
</style>
