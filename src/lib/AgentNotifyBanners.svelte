<script lang="ts">
  /**
   * 에이전트 알림 배너 — `+page` 의 `.body` 안에 한 번만 마운트한다(그 상자 위 가운데에 붙어 탭 바 높이를 숫자로 적지 않는다).
   * z-index 105 는 가림막(115) 아래여야 한다 — 카드에 탭 이름이 적혀 있다.
   */
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { relativeTime } from "$lib/notifications";
  import { bannerAria, bannerTitle, bannerView, type BannerItem } from "$lib/agent-banners";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import {
    agentBannerItems,
    agentBannerState,
    dropSideChatBanner,
    expandAgentBanner,
    hideAgentBanner,
    hideAllAgentBanners,
    holdAgentBanners,
    openAgentBanner,
    focusMovedTo,
    releaseAgentBanners,
    resolveVisited,
    resolveVisitedSideChat,
  } from "$lib/app/agent-banners.svelte.js";
  import { shownSideChat } from "$lib/app/side-chat-live.svelte.js";
  import { sideChats } from "$lib/app/side-chats.svelte.js";
  import { focusedPane } from "$lib/app/tabs.svelte.js";
  import { windowFocused } from "$lib/app/os-notify";
  import { cubicIn, cubicOut } from "svelte/easing";
  import { flip } from "svelte/animate";
  import { untrack } from "svelte";
  import type { TransitionConfig } from "svelte/transition";

  let showAll = $state(false);
  const view = $derived(bannerView(agentBannerState(), showAll));

  $effect(() => {
    if (showAll && view.more === 0 && !view.canFold) showAll = false;
  });

  // 마지막 카드가 손 밑에서 사라지면(보기 · 해결) `mouseleave` 가 오지 않는다 — 멈춤을 풀어 둔다.
  $effect(() => {
    if (view.shown.length === 0) untrack(releaseAgentBanners);
  });

  // `windowFocused()` 는 반응형이 아니라 사건으로 따라간다
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

  /** 보고 있는 타일에서 선 항목(`bornFocused`)은 여기서 풀리지 않는다 — 그 타일을 만지면(`PaneHost`) 풀린다 */
  $effect(() => {
    const pane = focusedPane()?.id ?? null;
    void agentBannerItems().length;
    if (pane !== null) untrack(() => focusMovedTo(pane));
    if (!winFocused || pane === null) return;
    untrack(() => resolveVisited(pane));
  });

  $effect(() => {
    const chat = shownSideChat();
    void agentBannerItems().length;
    if (!winFocused || chat === null) return;
    untrack(() => resolveVisitedSideChat(chat));
  });

  $effect(() => {
    const ids = new Set(sideChats().map((c) => c.id));
    const gone = agentBannerItems().flatMap((b) => (b.sideChatId !== undefined && !ids.has(b.sideChatId) ? [b.sideChatId] : []));
    if (gone.length > 0) untrack(() => gone.forEach(dropSideChatBanner));
  });

  let now = $state(Date.now());
  $effect(() => {
    if (view.shown.length === 0) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** `transform` 칸은 `flip` 이 쓴다 — `translate`·`scale` 로 민다. 투명도를 칸(`.slot`)에 주면 카드의 `backdrop-filter` 가 움직이는 동안 꺼진다 */
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

  // ── 호버·포커스 멈춤 ──
  let stack = $state<HTMLElement | null>(null);

  function onFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget;
    if (next instanceof Node && stack?.contains(next)) return;
    if (!stack?.matches(":hover")) releaseAgentBanners();
  }

  function onLeave(): void {
    if (!stack?.contains(document.activeElement)) releaseAgentBanners();
  }

  function onKey(ev: KeyboardEvent, item: BannerItem): void {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    hide(item.id);
  }

  /** 누른 단추가 사라지므로 포커스를 다음 카드로 넘긴다 */
  function hide(id: number): void {
    hideAgentBanner(id);
    requestAnimationFrame(() => {
      const next = stack?.querySelector<HTMLElement>("[data-banner-open], [data-banner-pill]");
      if (next) next.focus({ preventScroll: true });
      else releaseAgentBanners();
    });
  }

  const message = (item: BannerItem) =>
    t(
      item.kind === "permission"
        ? "app.agent.banner.permission"
        : item.kind === "failed"
          ? "app.agent.banner.failed"
          : item.sideChatId !== undefined
            ? "app.agent.banner.chat.stop"
            : "app.agent.banner.stop",
    );
  const pillText = (item: BannerItem) =>
    t(
      item.kind === "permission"
        ? "app.agent.banner.pill.permission"
        : item.kind === "failed"
          ? "app.agent.banner.pill.failed"
          : "app.agent.banner.pill.stop",
      { name: item.label },
    );

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
        data-side-chat={item.sideChatId}
        data-kind={item.kind}
        data-collapsed={item.collapsed}
        in:bannerIn|global
        out:bannerOut|global
        animate:flip={{ duration: flipMs() }}
      >
        {#if item.collapsed}
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
            aria-label={bannerAria(item, t("app.agent.name.generic"))}
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
                <strong class="title">{bannerTitle(item)}</strong>
                {#if item.sideChatId !== undefined}
                  <span
                    class="where"
                    data-banner-chat-chip
                    role="img"
                    title={t("app.agent.banner.chat")}
                    aria-label={t("app.agent.banner.chat")}
                    ><UiIcon name="chat" size={11} /><span class="where-txt"
                      >{t("app.agent.banner.chat")}</span
                    ></span
                  >
                {/if}
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
  /* 기둥 자신은 클릭을 받지 않는다 — 카드 사이·옆의 빈 곳은 뒤 타일로 지나간다 */
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
    container: agent-banners / inline-size;
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

  .card,
  .pill {
    pointer-events: auto;
    box-sizing: border-box;
    color: var(--fg-1);
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

  .card.permission,
  .pill.permission {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong));
  }
  /* 권한 물음의 강조색 선은 뜻이 있어 글래스에서도 그대로 둔다 */
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
  .status.failed {
    background: var(--err);
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
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .where {
    display: inline-flex;
    flex: none;
    gap: 3px;
    align-items: center;
    align-self: center;
    height: 18px;
    padding: 0 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--surface-hover);
    border-radius: 999px;
  }

  @container agent-banners (max-width: 400px) {
    .where-txt {
      display: none;
    }

    .where {
      justify-content: center;
      width: 18px;
      padding: 0;
    }
  }

  .when {
    flex: none;
    margin-left: auto;
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
