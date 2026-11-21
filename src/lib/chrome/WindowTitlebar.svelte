<script lang="ts">
  /**
   * 창 제목줄(decorations:false). 탭 바(`children`)는 이 상자의 직계 자식이어야 한다(`pane/workspace-slide.ts` 의 `.titlebar > .tabs`).
   * 상태바 · 캔버스 쪽 짝 규칙은 `+page.svelte` 에 있다.
   */
  import type { Snippet } from "svelte";
  import type { StatusBarPosition, StatusBarStyle } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote, winClose, winMaximized, winMinimize, winToggleMax } from "$lib/app/window.svelte.js";
  import { settings } from "$lib/settings.svelte.js";

  let {
    position,
    barStyle,
    height = $bindable(0),
    children,
    status,
  }: {
    /** 부모 `.app` 의 `data-statusbar` 와 같은 값 */
    position: StatusBarPosition;
    /** 부모 `.app` 의 `data-statusbar-style` 와 같은 값 */
    barStyle: StatusBarStyle;
    /** 부모가 `--titlebar-h` 로 쓴다 */
    height?: number;
    children: Snippet;
    status?: Snippet;
  } = $props();
</script>

<div
  class="titlebar"
  data-tauri-drag-region
  data-statusbar={position}
  data-statusbar-style={barStyle}
  bind:clientHeight={height}
>
  {@render children()}
  {@render status?.()}
  {#if !isRemote && settings.windowControls}<div class="winctl glass-band">
    <button
      type="button"
      class="winbtn"
      title={t("app.window.minimize")}
      aria-label={t("app.window.minimize")}
      onclick={winMinimize}
      >−</button
    >
    <button
      type="button"
      class="winbtn"
      title={winMaximized() ? t("app.window.restore") : t("app.window.maximize")}
      aria-label={winMaximized() ? t("app.window.restore") : t("app.window.maximize")}
      onclick={winToggleMax}>{winMaximized() ? "❐" : "□"}</button
    >
    <button
      type="button"
      class="winbtn close"
      title={t("app.window.close")}
      aria-label={t("app.window.close")}
      onclick={winClose}
      >✕</button
    >
  </div>{/if}
</div>

<style>
  .titlebar {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    min-width: 0;
  }

  .titlebar :global(.tabs) {
    flex: 1;
    min-width: 0;
    /* 상태바 띠 · 기둥과 같은 값으로 못 박아 화면 배율에서도 두께가 같다 */
    box-sizing: border-box;
    height: calc(var(--tab-row) + var(--tab-line));
  }

  .winctl {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    background: var(--glass-band, var(--bg-panel));
    border-bottom: 1px solid var(--border);
  }

  .winbtn {
    width: 46px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .winbtn:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }

  .winbtn.close:hover {
    background: var(--err);
    color: #fff;
  }

  /* 감싸기(hug) — 짝 규칙은 `+page.svelte` 의 감싸기 절. 글래스면 창 전체 판 한 장이 흐림을 들므로 자리마다의 판은 끈다 */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"]::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"] :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"] .winctl::before {
    display: none;
  }
  .titlebar[data-statusbar="left"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="left"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="right"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="right"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="bottom"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="bottom"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="top"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="top"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="top"][data-statusbar-style="hug"] :global(.statusbar) {
    border-bottom: none; /* 투명이 아니라 없앤다 — 흐림 판은 테두리 안쪽만 덮어 투명한 1px 칸으로 바탕이 비친다 */
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"] :global(.statusbar)::before {
    display: none;
  }
  /* 글래스 — 흐림 판은 한 장. 탭 줄 · 창 단추 · 상태바가 판을 따로 들면 맞닿은 곳마다 이음매가 비친다 */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] {
    position: relative;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"]::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    box-shadow: var(--glass-edge);
    backdrop-filter: var(--glass-filter-band);
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] .winctl::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] :global(.statusbar)::before {
    display: none;
  }

  /* 탭 줄 아래 변은 `.canvas-edge`(`+page.svelte`)가 긋는다 — 여기 테두리는 색만 투명(자리 1px 은 남아야 배치가 안 움직인다) */
  .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.tabs),
  .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .winctl,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] :global(.tabs),
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] .winctl {
    border-bottom-color: transparent;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] :global(.tabs),
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] .winctl {
    background-clip: padding-box;
  }
  /* 옆 기둥 + 글래스 — 판은 `+page` 의 `.app::before` 한 장이고, 그 판이 창 밖으로 4px 나가 있어 위 빛 선은 제목줄이 진다 */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) {
    box-shadow: var(--glass-edge);
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .winctl::before {
    display: none;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.tabs),
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .winctl {
    background: transparent;
  }

  /*
   * 둥근 패널 — 판은 제목줄의 `::before` 한 장이 진다(탭 줄 · 창 단추가 판을 따로 들면 이음매가 비친다).
   * 패널 둘레 여백은 제목줄 자신이라 그 `data-tauri-drag-region` 이 창 끌기를 받는다.
   */
  .titlebar[data-statusbar-style="panel"] {
    position: relative;
    padding: calc(var(--space-2) + 1px) calc(var(--space-2) + 1px) 1px;
  }
  .titlebar[data-statusbar-style="panel"]::before,
  .titlebar[data-statusbar-style="panel"]::after {
    content: "";
    position: absolute;
    z-index: -1;
    pointer-events: none;
  }
  .titlebar[data-statusbar-style="panel"]::before {
    inset: var(--space-2) var(--space-2) 0;
    border: 1px solid var(--glass-rim, var(--line));
    border-radius: var(--radius-surface);
    background: var(--glass-band, var(--surface-raised));
  }
  .titlebar[data-statusbar-style="panel"]::after {
    display: none;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="panel"]::before {
    background-clip: padding-box;
    backdrop-filter: var(--glass-filter-band);
  }
  .titlebar[data-statusbar-style="panel"] :global(.tabs),
  .titlebar[data-statusbar-style="panel"] .winctl,
  .titlebar[data-statusbar-style="panel"] :global(.statusbar) {
    background: transparent;
    border-bottom: none;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="panel"] :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="panel"] .winctl::before {
    display: none;
  }
  /* 테두리 안쪽 곡선 R−1 */
  .titlebar[data-statusbar-style="panel"] .winbtn.close {
    border-radius: 0 calc(var(--radius-surface) - 1px) calc(var(--radius-surface) - 1px) 0;
  }
</style>
