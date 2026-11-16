<script lang="ts">
  // ---------------------------------------------------------------------------
  // **탭 우클릭 메뉴** — `Tabs.svelte` 에서 뗀 표시 조각. 메뉴가 걸린 탭(`ctxTab`) · 자리 · 바깥 누르기 · Esc · 항목 통로
  // `runTabMenu`(menu-runner — 스냅샷 → 닫기 → 실행)는 부모 탭 줄이 쥐고, 여기는 줄을 그리고 그 통로로 넘긴다.
  // ---------------------------------------------------------------------------
  import UiIcon from "$lib/UiIcon.svelte";
  import { tabsToClose, type TabSpec } from "$lib/session";
  import { displayTabTitle } from "$lib/app/titles.svelte.js";
  import { tick } from "svelte";
  import {
    openTabTemplateSave,
    overwritableTemplates,
    overwriteTabTemplate,
    tabTemplateSavable,
  } from "$lib/app/tab-templates.svelte.js";
  import { isOrchTab } from "$lib/orchestration/orch-tab";
  import {
    FLYOUT_CLOSE_MS,
    FLYOUT_EST_ROW,
    FLYOUT_EST_WIDTH,
    FLYOUT_OPEN_MS,
    flyoutKeyAction,
    placeFlyout,
  } from "$lib/menu-flyout";
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

  // ── 탭 템플릿(2026-11-16) — [템플릿으로 저장…] · [템플릿 덮어쓰기 ▸] 는 넣을 타일이 있는 탭에서만(같은 규칙 · 오케스트레이션 탭은 꺼짐) ──
  const savable = $derived(!isOrchTab(ctxTarget) && tabTemplateSavable(ctxTarget));
  /** 이 탭에서 덮어쓸 수 있는 것만 — 탭의 프로젝트 템플릿 + 프로젝트 없는 템플릿(`templatesForTab`) */
  const templates = $derived(overwritableTemplates(ctxTarget));

  /**
   * [템플릿 덮어쓰기 ▸] 옆목록 — 자리 · 뜸 · 키는 시작 화면 판 메뉴(`StartBoardMenu` 의 `위젯 추가 ▸`)와 같은 `$lib/menu-flyout`.
   * 옆목록은 메뉴 상자의 **형제**로 그린다(상자의 `overflow` 가 자르지 않게) — 둘을 감싼 `display: contents` 뿌리가 부모의 `el` 이라
   * 바깥 누르기 판정(`ctxEl.contains`)이 옆목록 안의 누르기를 바깥으로 보지 않는다.
   */
  let menuEl = $state<HTMLElement | null>(null);
  let flyoutEl = $state<HTMLElement | null>(null);
  let flyout = $state(false);
  let flyoutLeft = $state(0);
  let flyoutTop = $state(0);
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (hoverTimer) clearTimeout(hoverTimer);
    if (closeTimer) clearTimeout(closeTimer);
    hoverTimer = closeTimer = null;
  }
  $effect(() => () => clearTimers());

  function placeFlyoutNow() {
    const row = menuEl?.querySelector<HTMLElement>("[data-tab-ctx='overwrite-template']");
    if (!row || !menuEl) return;
    const size = flyoutEl
      ? { width: flyoutEl.offsetWidth, height: flyoutEl.offsetHeight }
      : { width: FLYOUT_EST_WIDTH, height: FLYOUT_EST_ROW * Math.max(1, templates.length) + 8 };
    const at = placeFlyout(row.getBoundingClientRect(), menuEl.getBoundingClientRect(), size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    flyoutLeft = at.left;
    flyoutTop = at.top;
  }

  $effect(() => {
    if (flyout && flyoutEl) placeFlyoutNow();
  });

  function openFlyout(focusFirst = false) {
    if (!savable || templates.length === 0) return;
    clearTimers();
    flyout = true;
    placeFlyoutNow();
    if (focusFirst) void tick().then(() => flyoutEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  function closeFlyout(refocusRow = false) {
    clearTimers();
    flyout = false;
    if (refocusRow) menuEl?.querySelector<HTMLElement>("[data-tab-ctx='overwrite-template']")?.focus();
  }

  function hoverRow() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    if (flyout || hoverTimer) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      openFlyout();
    }, FLYOUT_OPEN_MS);
  }

  function leaveRow() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
    if (!flyout) return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      closeTimer = null;
      flyout = false;
    }, FLYOUT_CLOSE_MS);
  }

  /** → 로 옆목록 열기 (메뉴 자체의 Escape 는 부모 탭 줄이 다룬다) */
  function onRowKeydown(ev: KeyboardEvent) {
    if (flyoutKeyAction(ev.key, "row") === "open") {
      ev.preventDefault();
      ev.stopPropagation();
      openFlyout(true);
    }
  }

  /** 옆목록 안 — ← / Escape 로 한 켜 나오고 ↑↓ 로 줄 사이를 돈다 */
  function onFlyoutKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape" || flyoutKeyAction(ev.key, "flyout") === "close") {
      ev.preventDefault();
      ev.stopPropagation();
      closeFlyout(true);
      return;
    }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && flyoutEl) {
      ev.preventDefault();
      ev.stopPropagation();
      const items = [...flyoutEl.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }

  /** 고른 템플릿을 이 탭의 배치로 — 템플릿 id 는 누른 순간 떠 두고, 탭 id 는 통로(`runTabMenu`)가 스냅샷한다 */
  function pickOverwrite(templateId: string) {
    runTabMenu((tabId) => void overwriteTabTemplate(templateId, tabId));
  }
</script>

<!--
  탭 우클릭 메뉴 = **탭 메뉴**. 그 탭에 직접 거는 것들만 있다
  (이름 변경 · 배치로 저장 · 동시 입력 · 닫기 · 다른 탭 닫기 · 오른쪽 탭 닫기). 순서 바꾸기·창 분리·병합은 전부 드래그가
  맡으므로 메뉴에 넣지 않는다.
  `position: fixed` 다 (스트립의 overflow 가 절대배치를 잘라낸다).
-->
<div class="ctx-root" bind:this={el}>
<div
  class="menu ctx menu-surface"
  role="menu"
  aria-label={t("app.tabs.menu.aria")}
  bind:this={menuEl}
  style="left:{ctxLeft}px;top:{ctxTop}px"
>
  <p class="group menu-title">{displayTabTitle(ctxTarget)}</p>
  <!--
    `.mark` 는 **비어 있어도 폭을 차지한다** — 아래 "동시 입력"
    한 줄에만 ✓ 가 붙으므로, 나머지 줄에도 같은 빈칸을 둬야 글자가 한 x 에서 시작한다.
    (그 ✓ 도 2026-09-15 에 Lucide `check` 가 됐다 — 나머지 세 줄은 여전히 그림이 없다.
    아이콘을 붙일 일이 생기면 `.mark` 칸이 그대로 받는다.)
  -->
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    onclick={() => ctxTarget && startRename(ctxTarget)}
  >
    <span class="mark menu-mark"></span>{t("app.tabs.ctx.rename")}
  </button>
  <!-- 탭 템플릿(2026-11-16) — 이 탭을 여는 법을 이름 붙여 남긴다. 오케스트레이션 탭은 넣을 타일이 없어 끈다(배치는 앱이 쥔다). -->
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    data-tab-ctx="save-template"
    disabled={!savable}
    onpointerenter={() => flyout && leaveRow()}
    onclick={() => runTabMenu((id) => openTabTemplateSave(id))}
  >
    <span class="mark menu-mark"></span>{t("app.tabs.ctx.saveTemplate")}
  </button>
  <!-- 그 탭의 배치로 고른 템플릿을 덮어쓴다(확인 상자) — 템플릿이 없으면 흐리다 -->
  <button
    type="button"
    class="item menu-row tpl-row"
    role="menuitem"
    aria-haspopup="menu"
    aria-expanded={flyout}
    data-tab-ctx="overwrite-template"
    disabled={!savable || templates.length === 0}
    onclick={() => (flyout ? closeFlyout() : openFlyout(true))}
    onpointerenter={hoverRow}
    onpointerleave={leaveRow}
    onkeydown={onRowKeydown}
  >
    <span class="mark menu-mark"></span><span class="tpl-label">{t("app.tabs.ctx.overwriteTemplate")}</span><span
      class="chev menu-kbd"
      aria-hidden="true"><UiIcon name="chevron" size={12} /></span
    >
  </button>

  <hr class="menu-sep" />
  <!--
    **동시 입력** (4단계) — 예전에는 타이틀바의 ⇶ 토글이었다
    (docs/log/2026-09-05-titlebar-cleanup.md).

    여기로 온 이유는 대상이 **탭**이기 때문이다: 켜면 그 탭의 전
    타일이 포함으로 시작하고(패널별 제외는 타일 헤더의 ⋯ 메뉴와 Ctrl+클릭), 상태도
    탭마다 따로 산다. 타이틀바의 버튼은 늘 "활성 탭" 을 뜻했지만 이 메뉴는
    **가리킨 탭**을 뜻하므로, 보고 있지 않은 탭도 여기서 끌 수 있다.

    되돌리기 어려운 모드라 켜져 있다는 사실은 메뉴 밖에서도 보여야 한다 — 그 몫은
    탭의 ⇶ 표식과 본문 배너가 나눠 진다. 단축키(Ctrl+Shift+I)는 그대로다.
  -->
  <button
    type="button"
    class="item menu-row"
    role="menuitemcheckbox"
    aria-checked={syncing(ctxTarget.id)}
    title={t("app.tabs.ctx.sync.title")}
    onclick={() => runTabMenu((id) => onsynctoggle?.(id))}
  >
    <span class="mark menu-mark"
      >{#if syncing(ctxTarget.id)}<UiIcon
          name="check"
          size={14}
        />{/if}</span
    >{t("app.tabs.ctx.sync")}
  </button>

  <hr class="menu-sep" />
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    onclick={() => runTabMenu((id) => onclose(id))}
  >
    <span class="mark menu-mark"></span>{t("app.tabs.ctx.close")}
  </button>
  <!-- 닫을 것이 없으면(탭 하나 · 맨 오른쪽 탭) 숨기지 않고 끈다 — 자리가 흔들리지 않게. -->
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    disabled={tabsToClose(tabs, ctxTarget.id, "others").length === 0}
    onclick={() => runTabMenu((id) => oncloseothers?.(id))}
  >
    <span class="mark menu-mark"></span>{t("app.tabs.ctx.closeOthers")}
  </button>
  <button
    type="button"
    class="item menu-row"
    role="menuitem"
    disabled={tabsToClose(tabs, ctxTarget.id, "right").length === 0}
    onclick={() => runTabMenu((id) => oncloseright?.(id))}
  >
    <span class="mark menu-mark"></span>{t("app.tabs.ctx.closeRight")}
  </button>
</div>
{#if flyout}
  <div
    class="tpl-flyout menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t("app.tabs.ctx.overwriteTemplate")}
    data-tab-ctx-flyout="overwrite-template"
    style:left="{flyoutLeft}px"
    style:top="{flyoutTop}px"
    bind:this={flyoutEl}
    onkeydown={onFlyoutKeydown}
    onpointerenter={() => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    }}
    onpointerleave={leaveRow}
  >
    {#each templates as tpl (tpl.id)}
      <button
        type="button"
        class="item menu-row tpl-row"
        role="menuitem"
        data-tab-ctx-template={tpl.id}
        onclick={() => pickOverwrite(tpl.id)}
      >
        <span class="tpl-label">{tpl.name}</span>{#if !tpl.projectId}<span class="menu-kbd tpl-project"
            >{t("app.tabTemplates.flyout.noProject")}</span
          >{/if}
      </button>
    {/each}
  </div>
{/if}
</div>

<style>
  /* 메뉴 상자와 옆목록을 함께 감싸는 뿌리 — 부모의 바깥 누르기 판정용 노드일 뿐 상자를 만들지 않는다 */
  .ctx-root {
    display: contents;
  }

  /* 템플릿 덮어쓰기 옆목록 — 메뉴(40) 바로 위 */
  .tpl-flyout {
    position: fixed;
    z-index: 41;
    min-width: 180px;
    max-width: 300px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .tpl-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .tpl-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 옆목록 표시 — 타일 메뉴(`PaneMenu`)와 같은 chevron 아이콘(글자 `▸` 는 작아 잘 안 보였다) */
  .chev {
    display: inline-flex;
  }

  .tpl-project {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /*
    탭 우클릭 메뉴 — 모양은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface`·`.menu-row`·
    `.menu-title`·`.menu-mark`·`.menu-sep`). 여기 남는 것은 자리뿐이다.
    `fixed` 인 이유: 탭은 `overflow-x: auto` 인 스트립 안에 있어 절대배치로는 잘린다.
    좌표는 스크립트가 커서 자리에서 넣는다 (`openTabMenu`). 커서 자리에 뜨므로 좁아도 되고,
    층은 다른 떠 있는 메뉴와 같은 40 — 상태바 감싸기(hug)의 캔버스 모서리 조각(30)보다 위.
  */
  .menu.ctx {
    position: fixed;
    z-index: 40;
    min-width: 140px;
    max-width: 220px;
    max-height: 60vh;
    overflow-y: auto;
  }

  /* 키보드 포커스 — 중성 링(`--focus-ring`). 강조색이면 "골라진 것" 과 헷갈린다 */
  button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
