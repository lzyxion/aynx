<script lang="ts">
  // ---------------------------------------------------------------------------
  // **접힌 탭 목록**(`⌄N` 단추 아래) — `Tabs.svelte` 에서 뗀 표시 조각. 열림 · 자리(`menu`) · 단추 · 바깥 누르기 · 접힌 탭 계산은
  // 부모 탭 줄이 쥐고, 여기는 줄을 그리고 고르면 menu-runner 통로(스냅샷 → 닫기 → 실행)로 넘긴다.
  // ---------------------------------------------------------------------------
  import PaneIcon from "$lib/PaneIcon.svelte";
  import EqBars from "$lib/orchestration/EqBars.svelte";
  import { pulseOfRun } from "$lib/app/orch-pulse.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { TabSpec } from "$lib/session";
  import { displayTabTitle } from "$lib/app/titles.svelte.js";
  import type { TabDot } from "$lib/tab-dot";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { onListMenuKey } from "./tab-menu";
  import TabStatusGlyph, { tabIconPane } from "./TabStatusGlyph.svelte";

  let {
    menu,
    elidedTabs,
    dots,
    unsavedTabs,
    el = $bindable(),
    onclose,
    onselect,
  }: {
    menu: { right: number; top: number };
    elidedTabs: TabSpec[];
    dots: Record<string, TabDot | null>;
    unsavedTabs: Set<string>;
    el: HTMLElement | null;
    onclose: (back?: boolean) => void;
    onselect: (id: string) => void;
  } = $props();
</script>

<div
  class="menu more-menu menu-surface md3-list"
  role="menu"
  tabindex="-1"
  aria-label={t("app.tabs.more", { n: elidedTabs.length })}
  data-tabs-more-menu
  bind:this={el}
  style="right:{menu.right}px;top:{menu.top}px"
  onkeydown={(ev) => onListMenuKey(ev, el, onclose)}
>
  <div class="md3-scroll more-scroll">
  {#each elidedTabs as tab (tab.id)}
    {@const dot = dots[tab.id]}
    <button
      type="button"
      class="menu-row more-row"
      role="menuitem"
      data-tabs-more-option={tab.id}
      title={displayTabTitle(tab)}
      onclick={() => runOnMenu(() => tab.id, () => onclose(), onselect)}
    >
      <!-- 오케스트레이션 탭은 탭 줄과 같은 막대(⑤) --><span class="menu-mark more-row-icon">{#if tab.orch}<EqBars state={pulseOfRun(tab.orch.runId)} size={12} />{:else}<PaneIcon pane={tabIconPane(tab, dot)} size={13} />{/if}</span>
      <span class="more-row-name">{displayTabTitle(tab)}</span>
      {#if unsavedTabs.has(tab.id)}<span class="unsaved" aria-hidden="true">●</span>{/if}
      <!-- 탭 칸과 같은 표식 하나(벨도 그 우선순위 안 — docs/log/2026-11-03-tab-status-glyphs.md) -->
      {#if dot}<TabStatusGlyph {dot} />{/if}
    </button>
  {/each}
  </div>
</div>

<style>
  /* 아래 ● 규칙은 탭 칸(`Tabs.svelte`)과 같은 값이다 — scoped CSS 라 이 조각에도 같은 벌이 있어야 줄 안에서 같은 모양이 선다.
     상태 표식은 탭 칸과 같은 조각(`TabStatusGlyph.svelte`)이 제 모양을 들고 온다 */
  .more-scroll {
    max-height: 60vh;
  }

  /* 저장 안 한 변경 ● — 제목 뒤 작은 글자(오른쪽 끝의 동그란 상태 점과는 모양도 자리도 다르다) */
  .unsaved {
    flex: 0 0 auto;
    font-size: 9px;
    line-height: 1;
    color: var(--accent);
  }

  .menu.more-menu {
    position: fixed;
    z-index: 40; /* 다른 떠 있는 메뉴와 같은 층 — hug 캔버스 모서리 조각(30)보다 위 */
    min-width: 180px;
    max-width: 280px;
    overflow: hidden;
  }

  /* 공용 `.menu-row` 는 `display: block` 이라 줄 안의 점(빈 span)이 inline 으로 서서 폭 0 이 된다 —
     워크스페이스 목록 줄(`.menu-row.ws-row`)처럼 이 줄만 flex 로 세운다 */
  .menu-row.more-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .more-row-icon {
    display: inline-flex;
    align-items: center;
  }

  .more-row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 키보드 포커스 — 중성 링(`--focus-ring`). 강조색이면 "골라진 것" 과 헷갈린다 */
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
