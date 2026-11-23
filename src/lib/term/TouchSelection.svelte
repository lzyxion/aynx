<!--
  손가락으로 고른 터미널 선택의 손잡이 둘 · 작은 띠(원격 창의 터치). 자리는 `Terminal` 이 `touch-select.ts` 로 재서 준다.
  손잡이 끌기는 여기서 받지 않는다 — `.term` 의 터치 몸짓이 `data-term-handle` 을 보고 고르기로 들어간다(`data-term-touch-ui` 안의 나머지는 몸짓 없음).
  AI 타일의 대화 면(`pane/AiFlip.svelte`)은 띠만 쓴다 — 고르기 · 손잡이는 브라우저 것이다.
-->
<script lang="ts">
  import type { Pt } from "$lib/term/touch-select";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    start,
    end,
    barTop,
    oncopy,
    onpaste,
    onselectall,
    onmore,
  }: {
    start: Pt | null;
    end: Pt | null;
    /** `null` = 띠 없음(손잡이를 끄는 중 · 선택이 화면 밖) */
    barTop: number | null;
    oncopy: () => void;
    /** 없으면 [붙여넣기] 단추가 없다(대화 면) */
    onpaste?: () => void;
    onselectall: () => void;
    /** ⋯ 단추의 화면 좌표 — 타일 메뉴가 거기서 열린다. 없으면 ⋯ 단추가 없다(사이드 채팅 — 더 열 메뉴가 없다) */
    onmore?: (x: number, y: number) => void;
  } = $props();

  /** 단추가 포커스를 훔치지 않게 — 화면 키보드가 오르내리면 선택 자리가 밀린다 */
  function keep(ev: PointerEvent) {
    ev.preventDefault();
  }

  function more(ev: MouseEvent) {
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    onmore?.(box.left, box.bottom + 4);
  }
</script>

<div class="touch-sel" data-term-touch-ui>
  <!-- 화면 밖으로 나간 손잡이도 DOM 에 둔다(가리기만) — 끄는 중에 요소가 사라지면 그 터치의 남은 사건이 `.term` 까지 올라오지 않는다 -->
  <span class="handle start" class:off={!start} data-term-handle="start" style:left="{start?.x ?? 0}px" style:top="{start?.y ?? 0}px" aria-hidden="true"></span>
  <span class="handle end" class:off={!end} data-term-handle="end" style:left="{end?.x ?? 0}px" style:top="{end?.y ?? 0}px" aria-hidden="true"></span>
  {#if barTop !== null}
    <div class="bar glass-raised" role="toolbar" aria-label={t("pane.term.touchsel.bar")} style:top="{barTop}px">
      <button type="button" class="main" onpointerdown={keep} onclick={oncopy}>{t("pane.menu.copy")}</button>
      {#if onpaste}<button type="button" onpointerdown={keep} onclick={onpaste}>{t("pane.menu.paste")}</button>{/if}
      <button type="button" onpointerdown={keep} onclick={onselectall}>{t("pane.menu.select_all")}</button>
      {#if onmore}<button type="button" aria-label={t("app.convoActs.more")} title={t("app.convoActs.more")} onpointerdown={keep} onclick={more}>⋯</button>{/if}
    </div>
  {/if}
</div>

<style>
  .touch-sel {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }

  /* 누르는 자리는 44px, 보이는 물방울은 18px — 선택 끝을 가리키는 모서리만 각지다 */
  .handle {
    position: absolute;
    width: 44px;
    height: 44px;
    pointer-events: auto;
    touch-action: none;
  }
  .handle::after {
    content: "";
    position: absolute;
    top: 0;
    width: 18px;
    height: 18px;
    background: var(--accent);
  }
  .handle.off {
    visibility: hidden;
  }
  .handle.start {
    transform: translateX(-100%);
  }
  .handle.start::after {
    right: 0;
    border-radius: 50% 0 50% 50%;
  }
  .handle.end::after {
    left: 0;
    border-radius: 0 50% 50% 50%;
  }

  .bar {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    max-width: calc(100% - 16px);
    height: 40px;
    overflow: hidden;
    pointer-events: auto;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg);
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: var(--shadow-modal);
    white-space: nowrap;
  }
  .bar button {
    min-width: 44px;
    padding: 0 12px;
    font: inherit;
    color: inherit;
    background: none;
    border: 0;
    cursor: pointer;
  }
  .bar button + button {
    border-left: 1px solid var(--border);
  }
  .bar button.main {
    font-weight: var(--fw-semibold);
  }
  .bar button:active {
    background: var(--surface-hover);
  }
  .bar button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
