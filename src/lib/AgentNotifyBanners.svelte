<script lang="ts">
  /**
   * **에이전트 알림 배너** — 창 위 가운데에 쌓이는 카드 (docs/log/2026-09-27-agent-banners.md).
   *
   * 에이전트의 턴 끝 · 권한 물음만 여기 선다. 복사됨·저장됨 같은 일반 알림은 오른쪽 위 토스트
   * 그대로다(`Toasts.svelte`). 상태·규칙은 밖에 있다 — 규칙은 순수 `$lib/agent-banners`, 상태와
   * 타이머는 `app/agent-banners.svelte.ts`. 이 컴포넌트가 하는 일은 넷뿐이다: **그리기 · 누름 받기 ·
   * 호버 멈춤 · "그 타일로 갔다" 감지**.
   *
   * `+page` 의 `.body`(탭 바·위 상태바 **아래**의 기준 상자) 안에 **한 번만** 마운트한다 — 그 상자의
   * 위 가운데에 붙으므로 탭 바 높이를 숫자로 적을 자리가 없고, 창 제어 단추와도 겹치지 않는다.
   *
   * ## "그 타일로 갔다" — 어떤 길로든
   *
   * 창이 앞에 있고(`focus`/`blur`/`visibilitychange` 로 따라가는 `$state`) 그 타일이 **활성 탭의
   * 포커스된 타일**(`focusedPane()`)이 되는 순간 해결한다. 탭 클릭 · `Alt+화살표` · 마우스 · 탭 점 ·
   * 대시보드 행 — 길이 무엇이든 끝은 이 두 값이라 길마다 손댈 것이 없다. 창이 뒤에 있는 동안 선 항목
   * (OS 알림 갈래)은 돌아와 창이 앞에 서는 순간 그 타일이 포커스돼 있으면 곧바로 풀린다.
   *
   * 예외 하나 — **보고 있는 타일에서 선 항목**(긴 턴 · `bornFocused`)은 이미 그 타일에 있으니 이 길로 풀지
   * 않는다. 그 타일 안의 키·누름(`PaneHost` → `touchAgentBanner`)이 푼다(docs/log/2026-09-27-agent-banners.md
   * "보고 있는 타일도").
   *
   * ## 층
   *
   * z-index 105 — 독(100) 위, 팔레트(110)·가림막(115)·토스트(120) 아래. 가림막 아래인 것이 요점이다:
   * 카드에 탭 이름이 적혀 있다(가림막이 내려오면 덮인다).
   */
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { relativeTime } from "$lib/notifications";
  import { bannerTitle, bannerView, type BannerItem } from "$lib/agent-banners";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import {
    agentBannerItems,
    agentBannerState,
    expandAgentBanner,
    hideAgentBanner,
    hideAllAgentBanners,
    holdAgentBanners,
    openAgentBanner,
    focusMovedTo,
    releaseAgentBanners,
    resolveVisited,
  } from "$lib/app/agent-banners.svelte.js";
  import { focusedPane } from "$lib/app/tabs.svelte.js";
  import { windowFocused } from "$lib/app/os-notify";
  import { cubicIn, cubicOut } from "svelte/easing";
  import { flip } from "svelte/animate";
  import { untrack } from "svelte";
  import type { TransitionConfig } from "svelte/transition";

  /** "+N개 더" 를 눌러 전부 펼쳐 보는 중 */
  let showAll = $state(false);
  const view = $derived(bannerView(agentBannerState(), showAll));

  // 넘침이 없어지면 "전부 보기" 도 저절로 접는다 — 다음에 넘칠 때 처음부터 셋만.
  $effect(() => {
    if (showAll && view.more === 0 && !view.canFold) showAll = false;
  });

  // 마지막 카드가 손 밑에서 사라지면(보기 · 해결) `mouseleave` 가 오지 않는다 — 멈춤을 풀어 둔다.
  $effect(() => {
    if (view.shown.length === 0) untrack(releaseAgentBanners);
  });

  // ---------------------------------------------------------------------------
  // 창이 앞에 있나 — `windowFocused()` 는 반응형이 아니라 사건으로 따라간다
  // ---------------------------------------------------------------------------
  let winFocused = $state(windowFocused());
  $effect(() => {
    const sync = () => (winFocused = windowFocused());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  });

  /**
   * 그 타일로 갔다 → 해결 (머리말). 항목이 늘 때도 다시 본다(창이 뒤에 있던 동안 선 것).
   * 보고 있는 타일에서 선 항목(`bornFocused`)은 여기서 풀리지 않는다 — 포커스가 다른 타일로 옮겨 가면
   * 표식을 벗고(`focusMovedTo`), 그 뒤 돌아오면 풀린다. 그 자리에서는 타일을 만지면 풀린다(`PaneHost`).
   */
  $effect(() => {
    const pane = focusedPane()?.id ?? null;
    void agentBannerItems().length;
    if (pane !== null) untrack(() => focusMovedTo(pane));
    if (!winFocused || pane === null) return;
    untrack(() => resolveVisited(pane));
  });

  // ---------------------------------------------------------------------------
  // "방금" 이 저 혼자 흐르게 — 보이는 카드가 있을 때만 도는 시계
  // ---------------------------------------------------------------------------
  let now = $state(Date.now());
  $effect(() => {
    if (view.shown.length === 0) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  // ---------------------------------------------------------------------------
  // 몸짓 — 새 카드는 위에서 내려앉고(살짝 커지며) 있던 것들은 `flip` 으로 한 칸 밀려 내려간다
  // ---------------------------------------------------------------------------
  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** `translate`·`scale` 속성으로 민다 — `transform` 칸은 `flip` 과 떠나는 항목의 보정이 쓴다(`Toasts` 머리말).
   *  투명도는 칸(`.slot`)이 아니라 **카드 자신**이 받는다(`--banner-fade` → `.slot > *`) — 칸의 `opacity` 가 1 아래면 칸이 배경 뿌리가
   *  되어 카드의 `backdrop-filter` 가 창 뒤를 못 보고 움직이는 동안 흐림이 꺼진다(theme.css 모달 등장 절 · 10-28) */
  function bannerIn(_node: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    return {
      duration: 320,
      easing: cubicOut,
      css: (tt, u) => `--banner-fade:${tt};translate:0 ${-14 * u}px;scale:${0.96 + 0.04 * tt}`,
    };
  }

  function bannerOut(_node: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    return { duration: 180, easing: cubicIn, css: (tt) => `--banner-fade:${tt};scale:${0.97 + 0.03 * tt}` };
  }

  const flipMs = () => (reducedMotion() ? 0 : 240);

  // ---------------------------------------------------------------------------
  // 호버·포커스 멈춤 — 머무는 동안 접지 않는다
  // ---------------------------------------------------------------------------
  let stack = $state<HTMLElement | null>(null);

  function onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget;
    if (next instanceof Node && stack?.contains(next)) return;
    if (!stack?.matches(":hover")) releaseAgentBanners();
  }

  function onLeave(): void {
    if (!stack?.contains(document.activeElement)) releaseAgentBanners();
  }

  /** Escape = × (포커스가 그 카드·알약 안에 있을 때) */
  function onKey(ev: KeyboardEvent, item: BannerItem): void {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    hide(item.id);
  }

  /** × — 누른 단추가 사라지므로 포커스를 다음 카드로 넘긴다(없으면 놓아 준다) */
  function hide(id: number): void {
    hideAgentBanner(id);
    requestAnimationFrame(() => {
      const next = stack?.querySelector<HTMLElement>("[data-banner-open], [data-banner-pill]");
      if (next) next.focus({ preventScroll: true });
      else releaseAgentBanners();
    });
  }

  const message = (item: BannerItem) => t(item.kind === "permission" ? "app.agent.banner.permission" : "app.agent.banner.stop");
  const pillText = (item: BannerItem) =>
    t(item.kind === "permission" ? "app.agent.banner.pill.permission" : "app.agent.banner.pill.stop", { name: item.label });

  /** [보기]·[확인하러 가기] 툴팁 — 같은 일을 하는 단축키(`go-to-alert`). 안 걸었으면 툴팁 없음 */
  const goKeyTip = $derived.by(() => {
    const combo = effectiveCombo("go-to-alert", settings.keybindings);
    return combo ? t("app.agent.banner.key", { key: displayCombo(combo) }) : undefined;
  });
</script>

{#if view.shown.length > 0}
  <div
    class="agent-banners"
    role="region"
    aria-label={t("app.agent.banner.aria")}
    aria-live="polite"
    data-agent-banners
    bind:this={stack}
    onmouseenter={holdAgentBanners}
    onmouseleave={onLeave}
    onfocusin={holdAgentBanners}
    onfocusout={onFocusOut}
  >
    {#each view.shown as item (item.id)}
      <div
        class="slot"
        data-agent-banner={item.id}
        data-pane={item.paneId}
        data-kind={item.kind}
        data-collapsed={item.collapsed}
        in:bannerIn|global
        out:bannerOut|global
        animate:flip={{ duration: flipMs() }}
      >
        {#if item.collapsed}
          <!-- 알약 — 누르면(Enter 도) 다시 펼친다. Escape 는 × 와 같다. -->
          <button
            type="button"
            class="pill"
            class:permission={item.kind === "permission"}
            data-banner-pill
            title={t("app.agent.banner.expand")}
            onclick={() => expandAgentBanner(item.id)}
            onkeydown={(ev) => onKey(ev, item)}
          >
            <span class="logo small" aria-hidden="true">
              {#if item.logo}<AiGlyph name={item.logo} size={22} />{:else}<UiIcon
                  name="ai"
                  size={18}
                />{/if}
              <span class="status {item.kind}"></span>
            </span>
            <span class="pill-text">{pillText(item)}</span>
          </button>
        {:else}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="card"
            class:permission={item.kind === "permission"}
            role="group"
            aria-label={bannerTitle(item, t("app.agent.name.generic"))}
            onkeydown={(ev) => onKey(ev, item)}
          >
            <span class="logo" aria-hidden="true">
              {#if item.logo}<AiGlyph name={item.logo} size={32} />{:else}<UiIcon
                  name="ai"
                  size={24}
                />{/if}
              <span class="status {item.kind}"></span>
            </span>
            <span class="body">
              <span class="line1">
                <strong class="title">{bannerTitle(item, t("app.agent.name.generic"))}</strong>
                <span class="when">{relativeTime(item.at, now, t)}</span>
              </span>
              <span class="line2">{message(item)}</span>
            </span>
            <button
              type="button"
              class="act btn btn-sm"
              class:btn-primary={item.kind === "permission"}
              class:btn-secondary={item.kind !== "permission"}
              data-banner-open
              title={goKeyTip}
              onclick={() => openAgentBanner(item.id)}
            >
              {t(item.kind === "permission" ? "app.agent.banner.go" : "app.agent.banner.view")}
            </button>
            <button
              type="button"
              class="x"
              data-banner-hide
              title={t("app.agent.banner.later")}
              aria-label={t("app.agent.banner.later")}
              onclick={() => hide(item.id)}
            >
              <UiIcon name="close" size={13} />
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if view.more > 0 || view.canFold || view.clearAll}
      <div class="chips">
        {#if view.more > 0 || view.canFold}
          <button type="button" class="chip" data-banner-more onclick={() => (showAll = !showAll)}>
            {view.canFold ? t("app.agent.banner.fold") : t("app.agent.banner.more", { n: view.more })}
          </button>
        {/if}
        {#if view.clearAll}
          <button
            type="button"
            class="chip"
            data-banner-clear
            onclick={() => {
              hideAllAgentBanners();
              showAll = false;
              releaseAgentBanners();
            }}
          >
            {t("app.agent.banner.clear")}
          </button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* 기둥 — `.body` 의 위 가운데. 폭은 한 장 430 (좁은 창이면 양옆 16px 을 남기고 줄어든다).
     기둥 자신은 클릭을 받지 않는다 — 카드 사이·옆의 빈 곳은 뒤 타일로 지나간다. */
  .agent-banners {
    position: absolute;
    top: var(--space-2);
    left: 50%;
    z-index: 105;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: min(430px, calc(100% - 32px));
    translate: -50% 0;
    font-family: var(--font-ui);
    pointer-events: none;
  }

  .slot {
    display: flex;
    justify-content: center;
    width: 100%;
    pointer-events: none;
  }

  .slot > :global(*) {
    opacity: var(--banner-fade, 1);
  }

  /* 카드 — 떠 있는 반투명 면 + 흐림 + 강한 그림자. 모서리 16px 은 승인된 목업의 값이다(작업면의 두 단
     `--radius-sm/md` 보다 크다 — 창 위에 뜨는 알림 한 장만의 예외). */
  .card,
  .pill {
    pointer-events: auto;
    box-sizing: border-box;
    color: var(--fg-1);
    /* 재질 글래스면 중 층 유리(가장자리 · 그림자 — theme.css 재질 절). 평면은 원래의 86% + 16px 흐림 그대로.
       이 면은 `.glass-*` 를 달지 않고 상자 자신이 흐린다 */
    background: var(--glass-float, color-mix(in srgb, var(--surface-raised-solid) 86%, transparent));
    backdrop-filter: var(--glass-filter-raised, blur(16px) saturate(1.2));
    border: 1px solid var(--line-strong);
    box-shadow: var(--glass-shadow, var(--shadow-raised));
  }

  .card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
    border-radius: var(--radius-surface);
  }

  /* 권한 물음 — 테두리에 강조색을 옅게. 강조색은 "입력 대기" 의 부름이라 허락된다 */
  .card.permission,
  .pill.permission {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
  }
  /* 재질 글래스 — 가장자리 선(`--glass-rim`)과 테두리 안쪽만 칠하는 판(theme.css 재질 절의 뜬 면 규칙과 같은 수). 권한 물음의
     강조색 선은 뜻이 있어 그대로 둔다 */
  :global(:root[data-material="glass"]) :is(.card, .pill, .chip):not(.permission) {
    border-color: var(--glass-rim);
    background-clip: padding-box;
  }

  .logo {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: var(--fg-2);
  }

  .logo.small {
    width: 22px;
    height: 22px;
  }

  /* 상태 표식 — 로고 오른쪽 아래의 점. 끝남 = `--ok`, 권한 = `--accent` */
  .status {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 2px solid var(--surface-raised-solid);
    border-radius: 50%;
  }
  .logo.small .status {
    width: 8px;
    height: 8px;
    border-width: 1.5px;
  }
  .status.stop {
    background: var(--ok);
  }
  .status.permission {
    background: var(--accent);
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .line1 {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .when {
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .line2 {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .act {
    flex: none;
  }

  .x {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .x:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /* 알약 — 한 줄, 끝까지 둥글게. 폭은 내용만큼(기둥 폭을 넘으면 말줄임) */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    height: 34px;
    padding: 0 var(--space-3) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    border-radius: 999px;
    cursor: pointer;
  }
  .pill:hover {
    background: color-mix(in srgb, var(--surface-hover) 92%, transparent);
  }
  .pill-text {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .x:focus-visible,
  .pill:focus-visible,
  .chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 칩 둘 — "+N개 더"/"접기" · "모두 지우기" */
  .chips {
    display: flex;
    gap: var(--space-2);
    pointer-events: none;
  }
  .chip {
    pointer-events: auto;
    height: 24px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--glass-float, color-mix(in srgb, var(--surface-raised-solid) 86%, transparent));
    backdrop-filter: var(--glass-filter-raised, blur(16px));
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    box-shadow: var(--glass-shadow, var(--shadow-raised));
    cursor: pointer;
  }
  .chip:hover {
    color: var(--fg-1);
  }
</style>
