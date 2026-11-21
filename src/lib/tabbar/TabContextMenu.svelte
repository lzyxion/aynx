<script lang="ts">
  // 항목은 부모의 `runTabMenu`(menu-runner — 스냅샷 → 닫기 → 실행)로만 넘긴다
  import UiIcon from "$lib/UiIcon.svelte";
  import { tabsToClose, type TabSpec } from "$lib/session";
  import { displayTabTitle } from "$lib/app/titles.svelte.js";
  import { openTabTemplateSave, tabTemplateSavable } from "$lib/app/tab-templates.svelte.js";
  import { isOrchTab } from "$lib/orchestration/orch-tab";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ctxTarget,
    ctxLeft,
    ctxTop,
    tabs,
    el = $bindable(),
    syncing,
    startRename,
    runTabMenu,
    onsynctoggle,
    onclose,
    oncloseothers,
    oncloseright,
  }: {
    ctxTarget: TabSpec;
    ctxLeft: number;
    ctxTop: number;
    tabs: TabSpec[];
    el: HTMLElement | null;
    syncing: (tabId: string) => boolean;
    startRename: (tab: TabSpec) => void;
    runTabMenu: (fn: (tabId: string) => void) => void;
    onsynctoggle?: (tabId: string) => void;
    onclose: (id: string) => void;
    oncloseothers?: (id: string) => void;
    oncloseright?: (id: string) => void;
  } = $props();

  const savable = $derived(!isOrchTab(ctxTarget) && tabTemplateSavable(ctxTarget));
</script>

<!-- 순서 바꾸기 · 창 분리 · 병합은 드래그가 맡으므로 메뉴에 넣지 않는다 -->
<div class="ctx-root" bind:this={el}>
<div
  class="menu ctx menu-surface"
  role="menu"
  aria-label={t("app.tabs.menu.aria")}
  style="left:{ctxLeft}px;top:{ctxTop}px"
>
  <p class="group menu-title">{displayTabTitle(ctxTarget)}</p>
  <!-- 줄 앞 그림 칸(`.menu-mark`)은 두지 않는다 — 그림 있는 줄이 없어 빈칸만 남는다(사용자 결정) -->
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    onclick={() => ctxTarget && startRename(ctxTarget)}
  >
    {t("app.tabs.ctx.rename")}
  </button>
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    data-tab-ctx="save-template"
    disabled={!savable}
    onclick={() => runTabMenu((id) => openTabTemplateSave(id))}
  >
    {t("app.tabs.ctx.saveTemplate")}
  </button>

  <hr class="menu-sep" />
  <!-- 동시 입력은 켜져 있다는 사실이 메뉴 밖에서도 보여야 한다 — 탭의 ⇶ 표식과 본문 배너가 진다 -->
  <button
    type="button"
    class="item menu-row sync-row"
    role="menuitemcheckbox"
    aria-checked={syncing(ctxTarget.id)}
    title={t("app.tabs.ctx.sync.title")}
    onclick={() => runTabMenu((id) => onsynctoggle?.(id))}
  >
    {t("app.tabs.ctx.sync")}{#if syncing(ctxTarget.id)}<span class="menu-kbd sync-check"
        ><UiIcon name="check" size={14} /></span
      >{/if}
  </button>

  <hr class="menu-sep" />
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    onclick={() => runTabMenu((id) => onclose(id))}
  >
    {t("app.tabs.ctx.close")}
  </button>
  <!-- 닫을 것이 없으면 숨기지 않고 끈다 — 자리가 흔들리지 않게 -->
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    disabled={tabsToClose(tabs, ctxTarget.id, "others").length === 0}
    onclick={() => runTabMenu((id) => oncloseothers?.(id))}
  >
    {t("app.tabs.ctx.closeOthers")}
  </button>
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    disabled={tabsToClose(tabs, ctxTarget.id, "right").length === 0}
    onclick={() => runTabMenu((id) => oncloseright?.(id))}
  >
    {t("app.tabs.ctx.closeRight")}
  </button>
</div>
</div>

<style>
  /* 부모의 바깥 누르기 판정용 노드일 뿐 상자를 만들지 않는다 */
  .ctx-root {
    display: contents;
  }

  /* `fixed` — 스트립의 `overflow-x: auto` 가 절대배치를 자른다. 층 40 은 상태바 감싸기의 모서리 조각(30)보다 위 */
  .menu.ctx {
    position: fixed;
    z-index: 40;
    min-width: 140px;
    max-width: 220px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .sync-row {
    display: flex;
    align-items: center;
  }

  .sync-check {
    display: inline-flex;
    color: var(--fg-2);
  }

  /* 강조색이면 "골라진 것" 과 헷갈린다 */
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
