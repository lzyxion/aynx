<script lang="ts">
  // ---------------------------------------------------------------------------
  // **탭 우클릭 메뉴** — `Tabs.svelte` 에서 뗀 표시 조각. 메뉴가 걸린 탭(`ctxTab`) · 자리 · 바깥 누르기 · Esc · 항목 통로
  // `runTabMenu`(menu-runner — 스냅샷 → 닫기 → 실행)는 부모 탭 줄이 쥐고, 여기는 줄을 그리고 그 통로로 넘긴다.
  // ---------------------------------------------------------------------------
  import UiIcon from "$lib/UiIcon.svelte";
  import { tabsToClose, type TabSpec } from "$lib/session";
  import { displayTabTitle } from "$lib/app/titles.svelte.js";
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
</script>

<!--
  탭 우클릭 메뉴 = **탭 메뉴**. 그 탭에 직접 거는 것들만 있다
  (이름 변경 · 배치로 저장 · 동시 입력 · 닫기 · 다른 탭 닫기 · 오른쪽 탭 닫기). 순서 바꾸기·창 분리·병합은 전부 드래그가
  맡으므로 메뉴에 넣지 않는다.
  `position: fixed` 다 (스트립의 overflow 가 절대배치를 잘라낸다).
-->
<div
  class="menu ctx menu-surface"
  role="menu"
  aria-label={t("app.tabs.menu.aria")}
  bind:this={el}
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

<style>
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
