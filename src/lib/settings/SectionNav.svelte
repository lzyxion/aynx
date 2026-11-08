<script lang="ts">
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 설정 화면의 **좌측 사이드 내비** (VS Code 식) — 카테고리 버튼 세로 목록.
   *
   * 고르는 일만 한다: 어느 섹션이 보일지는 부르는 쪽(`SettingsModal`)이 `active` 로 정하고,
   * 여기서는 눌린 id 를 그대로 올려 보낸다.
   *
   * `marked` — **저장을 막는 칸이 있는 면**(2026-09-29 — 호스트 폼 · 프로젝트 폼). 이름 옆에 붉은 점 하나를
   * 찍는다. 어느 면인지는 부르는 쪽이 정한다(`tabOfField` · `projectFormTabOf`); 설정 화면은 주지 않는다.
   *
   * 항목의 `dividerBefore` — 그 칸 **위에 얇은 구분선**을 긋는다(2026-09-30 — 설정 화면의 네 묶음,
   * docs/log/2026-09-30-settings-nav-order.md). 머리글 없는 선 하나뿐이고 `role="separator"` 라 포커스를
   * 받지 않는다 — Tab 이동은 버튼만 밟는다. 호스트 폼·프로젝트 폼은 이 필드를 주지 않아 모양이 그대로다.
   *
   * 항목의 `icon` — 이름 앞에 `UiIcon` 하나(2026-10-03 — 설정 화면). 고정 폭 칸에 서서 이름의 시작선이
   * 칸마다 맞고, 획은 `currentColor` 라 선택된 칸(본문 글자)이 나머지(흐린 글자)보다 진하게 읽힌다.
   * 장식이라 `aria-hidden`(UiIcon 의 빈 label) — 버튼 이름은 글자 그대로다. 주지 않으면 칸이 없다.
   *
   * **선택 표시는 하나의 판**(2026-10-04) — 칸마다 배경을 칠하지 않고, 목록 뒤에 깔린 `.nav-indicator`
   * 하나가 선택된 칸의 `offsetTop`·`offsetHeight` 로 옮겨 앉는다. 메뉴를 바꾸면 `translateY`·`height`
   * 전이로 미끄러지고(독·셸 메뉴와 같은 곡선), 첫 그림과 크기 변화(창 폭·글꼴 적재·구분선)에는 전이 없이
   * 제자리에 놓는다 — 크기는 `ResizeObserver`(목록 + 칸마다)가 지켜본다. 판은 장식이라 `aria-hidden`,
   * 선택의 뜻은 여전히 버튼의 `aria-current`·`.active` 가 진다. 호스트 폼·프로젝트 폼도 같은 판을 쓴다.
   */
  let {
    tabs,
    active,
    onselect,
    marked = [],
  }: {
    tabs: readonly { id: string; labelKey: Key; icon?: string; dividerBefore?: boolean }[];
    active: string;
    onselect: (id: string) => void;
    marked?: readonly string[];
  } = $props();

  let navEl: HTMLElement | undefined = $state();
  let indicatorEl: HTMLElement | undefined = $state();
  /** 판이 마지막으로 앉은 칸 — 이것이 바뀔 때만 미끄러진다(크기 변화는 제자리) */
  let placedFor: string | null = null;

  /** 선택된 칸 위로 판을 옮긴다. `animate` 가 거짓이면 전이를 끄고 곧바로 놓는다. */
  function place(animate: boolean) {
    const nav = navEl;
    const ind = indicatorEl;
    if (!nav || !ind) return;
    const btn = nav.querySelector<HTMLElement>(`.nav-item[data-nav-tab="${CSS.escape(active)}"]`);
    if (!btn || btn.offsetHeight === 0) {
      // 선택된 칸이 없거나 아직 그려지지 않았다(숨은 면) — 판도 숨기고, 다음 첫 자리는 전이 없이
      ind.style.opacity = "0";
      placedFor = null;
      return;
    }
    const slide = animate && placedFor !== null;
    if (!slide) ind.style.transition = "none";
    ind.style.transform = `translateY(${btn.offsetTop}px)`;
    ind.style.height = `${btn.offsetHeight}px`;
    ind.style.opacity = "1";
    if (!slide) {
      void ind.offsetHeight; // 전이 없는 자리를 먼저 확정한 뒤 CSS 전이를 되돌린다
      ind.style.transition = "";
    }
    placedFor = active;
  }

  // 선택이 바뀌면 미끄러진다 (첫 실행은 placedFor 가 null 이라 제자리)
  $effect(() => {
    void active;
    void tabs;
    void navEl;
    void indicatorEl;
    place(placedFor !== active);
  });

  // 크기가 바뀌면(창 폭 · 글꼴 적재 · 구분선 · 숨었다 보임) 전이 없이 다시 잰다
  $effect(() => {
    const nav = navEl;
    if (!nav || typeof ResizeObserver === "undefined") return;
    void tabs;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(nav);
    for (const b of nav.querySelectorAll(".nav-item")) ro.observe(b);
    return () => ro.disconnect();
  });
</script>

<nav class="settings-nav" aria-label={t("settings.nav.aria")} bind:this={navEl}>
  <div class="nav-indicator" aria-hidden="true" bind:this={indicatorEl}></div>
  {#each tabs as tab (tab.id)}
    {#if tab.dividerBefore}
      <div class="nav-sep" role="separator" data-nav-sep-before={tab.id}></div>
    {/if}
    <button
      type="button"
      class="nav-item"
      class:active={active === tab.id}
      aria-current={active === tab.id ? "page" : undefined}
      data-nav-tab={tab.id}
      data-nav-marked={marked.includes(tab.id) ? "" : undefined}
      onclick={() => onselect(tab.id)}
    >
      {#if tab.icon}
        <span class="nav-icon"><UiIcon name={tab.icon} size={15} /></span>
      {/if}
      <span class="nav-label">{t(tab.labelKey)}</span>
      {#if marked.includes(tab.id)}
        <span class="nav-dot" aria-hidden="true"></span>
        <span class="sr-only">{t("settings.nav.marked")}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  /* 좌측 카테고리 목록 — 고정 폭, 필요하면 자체 스크롤.
     호스트 폼(`HostForm.svelte`)도 이 컴포넌트를 쓰므로 모양은 두 화면이 함께 바뀐다. */
  .settings-nav {
    position: relative; /* 판(.nav-indicator)과 칸의 offsetTop 기준 — 스크롤하면 함께 움직인다 */
    flex: 0 0 150px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  /* 묶음 사이 구분선 — 머리글 없이 1px 선 하나. 위아래 여백은 칸 사이 간격(2px)에 얹혀
     묶음이 한눈에 갈리되, 칸 하나만큼 벌어지지는 않게 한다. 좌우는 칸 글자 들여쓰기에 맞춘다. */
  .nav-sep {
    flex: 0 0 auto;
    height: 1px;
    margin: var(--space-1) var(--space-3);
    background: var(--border);
  }

  /* 선택 표시 판 — 목록에 하나뿐, 칸들 뒤에 깔린다. 자리(`translateY`)·높이는 스크립트가 잰 값이다.
     색은 **선택된 행 = `--accent-soft` 판**(theme.css "강조색이 서는 자리는 셋뿐이다" 의 첫째) — 라이트 블록 ·
     앱 테마 색 · 월페이퍼 추출이 이 토큰을 덮으므로 따로 적을 것이 없다. 처음엔 숨어 있다가 첫 자리에서 보인다. */
  .nav-indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 28px;
    border-radius: 999px; /* MD3 내비게이션 서랍의 알약 지시자(2026-10-18) */
    background: var(--accent-soft);
    opacity: 0;
    pointer-events: none;
    will-change: transform;
    transition:
      transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
      height 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-indicator {
      transition: none;
    }
  }

  /* 한 칸 = 28px 줄 (독의 줄·팔레트의 줄과 같은 높이 결) */
  .nav-item {
    position: relative; /* 판 위에 선다 */
    z-index: 1;
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    width: 100%;
    min-height: 28px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    text-align: left;
    color: var(--fg-2);
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    /* 글자색 전환 없음 — 클릭하면 글자는 **즉시** 바뀐다(0.12s 페이드는 "약간의 텀" 으로 느껴졌다).
       움직이는 것은 뒤의 판 하나다. */
  }

  .nav-item:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 선택된 카테고리 — MD3 내비게이션 서랍: 판(`--accent-soft` = secondaryContainer) 위의 onSecondaryContainer 글자 · 아이콘
     (2026-10-18 — 그 전의 강조색 글자는 판이 secondaryContainer 로 바뀌며 MD3 짝 글자로). 판은 뒤에서 깔리므로 칸 자신은
     투명하다(호버해도 판 색이 그대로 보인다). */
  .nav-item.active {
    color: var(--on-accent-soft);
    font-weight: var(--fw-semibold);
    background: transparent;
  }

  .nav-item.active .nav-icon {
    color: var(--on-accent-soft);
  }

  /* 이름 앞 아이콘 칸 — 고정 폭이라 아이콘 폭이 달라도 이름의 시작선이 칸마다 같다 */
  .nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 16px;
    width: 16px;
    margin-right: var(--space-2);
  }

  .nav-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 막힌 칸이 있는 면 — 오류 글자와 같은 `--err` 점 하나 */
  .nav-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    margin-left: var(--space-2);
    border-radius: 50%;
    background: var(--err);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
</style>
