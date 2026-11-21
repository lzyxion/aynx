<script lang="ts">
  import { tick, untrack } from "svelte";
  import { cubicIn, quintOut } from "svelte/easing";
  import type { TransitionConfig } from "svelte/transition";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Keys from "$lib/Keys.svelte";
  import { comboFromEvent, displayCombo, effectiveCombo, type Overrides } from "$lib/keybindings";
  import type { CanvasRect } from "$lib/launcher";
  import { initialSelection, moveSelection, switcherKeyOf } from "$lib/profile-switcher";
  import { activeProfileId, applyProfile, isModified, profileWallpaperSrc, themeProfiles } from "$lib/theme-profiles.svelte.js";
  import { revealOriginRandom, revealTheme } from "$lib/theme-reveal";
  import { closeProfileSwitcher, profileSwitcherVisible } from "$lib/app/profile-switcher.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import ProfileCardFace from "$lib/ProfileCardFace.svelte";

  /** 고르는 동안 미리 입히지 않는다 — 입히는 것이 곧 설정 파일 쓰기다. Enter · 클릭만 입힌다 */
  let {
    measureCanvas,
    keybindings = {},
  }: {
    measureCanvas?: () => CanvasRect | null;
    keybindings?: Overrides;
  } = $props();

  const profiles = $derived(themeProfiles());
  const activeId = $derived(activeProfileId());
  const modified = $derived(isModified());

  let sel = $state(
    initialSelection(
      themeProfiles().map((p) => p.id),
      activeProfileId(),
    ),
  );
  const selIndex = $derived(profiles.length === 0 ? -1 : Math.min(Math.max(0, sel), profiles.length - 1));

  // ── 자리 ──

  let vw = $state(0);
  let vh = $state(0);
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const c = measureCanvas?.() ?? null;
    const left = c ? c.left : 0;
    const width = c ? c.width : vw;
    const top = c ? c.top : 40;
    return { top: top + GAP, centerX: left + width / 2, maxWidth: Math.max(0, Math.min(vw, width) - 2 * GAP) };
  });
  const GAP = 12;

  // ── 포커스 · 보이기 ──

  let listEl = $state<HTMLElement | null>(null);

  /** 닫히는 도중 다시 열면 Svelte 가 같은 인스턴스를 되살린다 — 여는 순간의 일(고른 카드 · 포커스)은 마운트가 아니라 이 값에 건다 */
  const visible = $derived(profileSwitcherVisible());

  $effect(() => {
    const el = listEl;
    if (!visible || !el) return;
    // 여는 순간에만 정한다 — 떠 있는 동안 목록이 바뀌어도 고른 자리를 되돌리지 않는다
    sel = untrack(() =>
      initialSelection(
        themeProfiles().map((p) => p.id),
        activeProfileId(),
      ),
    );
    el.focus({ preventScroll: true });
  });

  // ── 몸짓 ──
  // `transform` 을 쓴다 — 가운데 맞춤은 `translate` 속성이라 둘이 합성된다.
  // 패널의 `opacity` · `clip-path` 는 움직이지 않는다 — 패널을 배경 뿌리로 만들어 글래스 흐림(`::before`)이 움직이는 동안 꺼진다. 자르기는 `.edge` 의 `overflow` 가 한다.

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function slideIn(node: HTMLElement): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    const dist = node.offsetHeight + GAP;
    return {
      duration: 300,
      css: (t) => {
        const d = (1 - quintOut(t)) * dist;
        return `transform:translateY(${(-d).toFixed(1)}px)`;
      },
    };
  }

  function slideOut(node: HTMLElement): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    const dist = node.offsetHeight + GAP;
    return {
      duration: 180,
      easing: cubicIn,
      css: (t, u) => {
        const d = u * dist;
        return `transform:translateY(${(-d).toFixed(1)}px)`;
      },
    };
  }

  $effect(() => {
    const i = selIndex;
    const el = listEl;
    if (!el || i < 0) return;
    void tick().then(() =>
      el
        .querySelector<HTMLElement>(`[data-ps-card][data-sel="true"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
    );
  });

  /** 가림 아래에 고르는 줄을 남겨 두지 않는다 */
  $effect(() => {
    if (veilVisible()) closeProfileSwitcher();
  });

  // ── 동작 ──

  /** 이미 쓰는 벌이고 손대지 않았으면 닫기만 한다 — 같은 값을 다시 쓰지 않는다 */
  function pick(id: string, _ev: Event): void {
    const origin = revealOriginRandom();
    closeProfileSwitcher();
    if (id === activeId && !modified) return;
    void revealTheme(origin, () => applyProfile(id), { preload: profileWallpaperSrc(id) });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (!visible) return;
    // 같은 단축키로 닫는다 — 포커스가 여기라 창의 전역 처리기는 쉬고 있다(`anyModalOpen`)
    const combo = comboFromEvent(ev);
    if (combo !== null && combo === effectiveCombo("switch-profile", keybindings)) {
      ev.preventDefault();
      ev.stopPropagation();
      closeProfileSwitcher();
      return;
    }
    const k = switcherKeyOf(ev);
    if (k === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (k.kind === "close") {
      closeProfileSwitcher();
      return;
    }
    if (k.kind === "apply") {
      const p = selIndex >= 0 ? profiles[selIndex] : null;
      if (p) pick(p.id, ev);
      else closeProfileSwitcher();
      return;
    }
    sel = moveSelection(profiles.length, selIndex, k);
  }

  const shortcut = $derived(displayCombo(effectiveCombo("switch-profile", keybindings)));
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="overlay"
  role="presentation"
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) closeProfileSwitcher();
  }}
>
  <div class="edge" style={placed ? `top:${placed.top - GAP}px` : undefined}>
  <div
    class="panel glass-raised"
    style={placed
      ? `top:${GAP}px;left:${placed.centerX}px;max-width:${placed.maxWidth}px`
      : undefined}
    data-profile-switcher
    in:slideIn|global
    out:slideOut|global
  >
    <div class="head">
      <span class="title">{t("app.profileSwitcher.title")}</span>
      {#if shortcut}<span class="combo"><Keys combo={shortcut} /></span>{/if}
      <span class="keys">
        {#if profiles.length > 0}
          <span class="grp"><Keys combo="←→" />{t("app.profileSwitcher.keys.move")}</span>
          <span class="grp"><Keys combo="Enter" />{t("app.profileSwitcher.keys.apply")}</span>
        {/if}
        <span class="grp"><Keys combo="Esc" />{t("app.profileSwitcher.keys.close")}</span>
      </span>
    </div>

    <div
      class="row"
      bind:this={listEl}
      role="listbox"
      tabindex="0"
      aria-label={t("app.profileSwitcher.aria")}
      aria-orientation="horizontal"
      aria-activedescendant={selIndex >= 0 ? `ps-card-${profiles[selIndex].id}` : undefined}
      onkeydown={onKeydown}
    >
      {#if profiles.length === 0}
        <p class="empty" data-ps-empty>{t("app.profileSwitcher.empty")}</p>
      {:else}
        {#each profiles as p, i (p.id)}
          {@const on = p.id === activeId}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            id={`ps-card-${p.id}`}
            class="card"
            class:active={on}
            class:sel={i === selIndex}
            role="option"
            tabindex="-1"
            aria-selected={i === selIndex}
            title={t("settings.theme.profile.apply.title", { name: p.name })}
            data-ps-card={p.id}
            data-sel={i === selIndex ? "true" : "false"}
            style:--i={Math.min(i, 4)}
            onmousedown={(ev) => ev.preventDefault()}
            onclick={(ev) => pick(p.id, ev)}
          >
            <ProfileCardFace profile={p} active={on} {modified} />
            {#if i < 9}<span class="nth" aria-hidden="true">{i + 1}</span>{/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
  </div>
</div>

<style>
  /* 뒤를 어둡게 하지 않는다 — 지금 모양을 보면서 다음 벌을 고르는 화면이다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110; /* 팔레트 · 검색과 같은 층(둘은 함께 뜨지 않는다) — 가림막(115) · 토스트(120) 아래 */
  }

  /* 미끄러지는 패널의 가장자리 위를 자른다(`clip-path` 대신) */
  .edge {
    position: absolute;
    top: 40px;
    right: 0;
    bottom: 0;
    left: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .panel {
    position: absolute;
    top: 12px;
    pointer-events: auto;
    left: 50%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: max-content;
    max-width: calc(100vw - 2 * var(--space-4));
    translate: -50% 0;
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
  }

  /* 나가는 패널에는 Svelte 가 `inert` 를 건다 — 그동안 바깥 막도 클릭을 흘려보낸다 */
  .overlay:has(> .edge > :global([inert])) {
    pointer-events: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3) var(--space-4) 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .title {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
  }

  .keys {
    display: flex;
    gap: var(--space-3);
    margin-left: auto;
    padding-left: var(--space-4);
    overflow: hidden;
    white-space: nowrap;
  }

  .grp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .combo {
    display: inline-flex;
    --keycap-fg: var(--fg-3);
  }

  /* 위아래 여백은 고른 카드의 링이 잘리지 않을 만큼 */
  .row {
    display: flex;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3) var(--space-4) var(--space-4);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    outline: none;
    scroll-padding-inline: var(--space-4);
  }

  .empty {
    margin: 0;
    padding: var(--space-2) 0 0;
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .card {
    position: relative;
    flex: none;
    display: grid;
    width: 184px;
    overflow: hidden;
    color: inherit;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.12s;
    animation: card-in 280ms cubic-bezier(0.22, 1, 0.36, 1) calc(60ms + var(--i, 0) * 25ms) both;
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }

  .card:hover {
    border-color: var(--line-strong);
  }

  .card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .card.sel {
    border-color: var(--line-strong);
  }

  .row:focus-visible .card.sel,
  .row:focus .card.sel {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .nth {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 4px;
    box-sizing: border-box;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 1;
    color: #fff;
    background: rgb(0 0 0 / 0.45);
    border-radius: var(--radius-sm);
  }

  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
      animation: none;
    }
  }
</style>
