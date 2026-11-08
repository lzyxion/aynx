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

  /**
   * **테마 프로필 빠른 전환** — 단축키(`switch-profile`, 기본 `Ctrl+Shift+U`)를 누르면 타일 캔버스 위 가장자리에서
   * 카드 줄이 내려오고, 키보드로 골라 Enter 로 갈아 끼운다 (docs/log/2026-09-28-profile-switcher.md).
   *
   * 카드의 얼굴은 설정 › 앱 테마의 카드와 **같은 그림**이다(`ProfileCardFace`) — ⋯ 메뉴 · 저장 카드는 없다(고치는
   * 자리는 설정이다). 적용도 같은 함수(`applyProfile`)라 미저장 편집이 있을 때 앞질러 저장하지 않는 규칙도 그대로다.
   * 움직이는 동안에는 **미리 입히지 않는다** — 입히는 것이 곧 설정 파일 쓰기다. Enter 만 입힌다.
   *
   * 키: ←/→ · Tab/Shift+Tab 고르기(끝에서 돌아 나온다) · Home/End · 1…9 그 번째 카드 · Enter 적용하고 닫기 ·
   * Esc · 바깥 클릭 · 같은 단축키 = 그냥 닫기. 카드를 누르면 적용하고 닫는다. 순수 판정은 `$lib/profile-switcher`.
   *
   * 포커스: 열리면 카드 줄(listbox)이 쥐고 — 그래서 키가 터미널로 새지 않는다 — 닫히면 연 자리로 돌아간다
   * (`app/profile-switcher` 의 포커스 복귀 이름표). 가림막이 내려오면 스스로 닫는다(알림 센터와 같은 규칙).
   */
  let {
    measureCanvas,
    keybindings = {},
  }: {
    /** 타일 캔버스의 지금 사각형 — 그 위 가장자리 가운데에 선다(탭 줄 아래) */
    measureCanvas?: () => CanvasRect | null;
    /** 단축키 오버라이드 — 같은 키(`switch-profile`)로 닫는다 */
    keybindings?: Overrides;
  } = $props();

  const profiles = $derived(themeProfiles());
  const activeId = $derived(activeProfileId());
  const modified = $derived(isModified());

  /** 고른 카드 — 열리는 순간 **지금 쓰는 프로필**(없으면 첫 카드). 닫히는 도중 다시 열리면 아래 효과가 다시 정한다 */
  let sel = $state(
    initialSelection(
      themeProfiles().map((p) => p.id),
      activeProfileId(),
    ),
  );
  /** 목록이 떠 있는 동안 줄어도 범위 안에 */
  const selIndex = $derived(profiles.length === 0 ? -1 : Math.min(Math.max(0, sel), profiles.length - 1));

  // ── 자리 ────────────────────────────────────────────────────────────────

  let vw = $state(0);
  let vh = $state(0);
  /** 캔버스 위 가장자리에서 한 칸 아래 · 캔버스 가운데. 캔버스를 못 재면 창 기준 */
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const c = measureCanvas?.() ?? null;
    const left = c ? c.left : 0;
    const width = c ? c.width : vw;
    const top = c ? c.top : 40;
    return { top: top + GAP, centerX: left + width / 2, maxWidth: Math.max(0, Math.min(vw, width) - 2 * GAP) };
  });
  const GAP = 12;

  // ── 포커스 · 보이기 ───────────────────────────────────────────────────────

  let listEl = $state<HTMLElement | null>(null);

  /**
   * 떠 있나 — 닫히면 곧장 `false` 지만 그림은 나가는 전이(아래 `slideOut`) 동안 남는다. 그동안 패널은 `inert`(Svelte 가
   * 건다) · 포커스는 닫는 순간 이미 연 자리로(`closeProfileSwitcher` 가 줄의 포커스를 먼저 놓는다). 닫히는 도중
   * 다시 열면 Svelte 가 **같은 인스턴스를 되살린다**(나가던 자리에서 다시 들어온다) — 그래서 여는 순간의 일(고른
   * 카드 · 포커스)을 마운트가 아니라 이 값에 건다.
   */
  const visible = $derived(profileSwitcherVisible());

  /** 열리는 순간 카드 줄이 키보드를 쥐고, 고른 카드는 지금 쓰는 프로필로 (다시 열림도 같다) */
  $effect(() => {
    const el = listEl;
    if (!visible || !el) return;
    // 목록 · 쓰는 벌이 떠 있는 동안 바뀌어도 고른 자리를 되돌리지 않는다 — 여는 순간에만 정한다
    sel = untrack(() =>
      initialSelection(
        themeProfiles().map((p) => p.id),
        activeProfileId(),
      ),
    );
    el.focus({ preventScroll: true });
  });

  // ── 몸짓 ────────────────────────────────────────────────────────────────
  //
  // 캔버스 위 가장자리 **밑에서** 미끄러져 나온다 — 출발점은 제 높이 + 한 칸만큼 위(첫 프레임엔 전부 가장자리 위)이고,
  // 가장자리 위는 감싸개(`.edge` — 가장자리부터 창 아래까지 · `overflow: hidden`)가 잘라 탭 줄 위를 쓸고 지나가지 않는다.
  // 들어올 때 300ms quintOut(= cubic-bezier(0.22, 1, 0.36, 1) 결의 감속), 나갈 때 180ms cubicIn 으로 가장자리 뒤로 끝까지 되올라간다.
  // 카드는 CSS 로 25ms 씩 늦게(다섯째까지) 살짝 내려앉는다. `transform` 을 쓴다 — 가운데 맞춤은 `translate` 속성이라 둘이 합성된다.
  // reduce 면 둘 다 즉시.
  // **패널의 `opacity` · `clip-path` 는 움직이지 않는다**(10-28) — 둘 다 패널을 배경 뿌리로 만들어 글래스 흐림(`::before`)이
  // 움직이는 동안 꺼진다(theme.css 모달 등장 절). 그래서 흐려지기 대신 가장자리 뒤로 숨고, 자르기는 감싸개의 `overflow` 가 한다.

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

  /** 고른 카드가 보이게 (넘치면 줄이 가로로 흐른다) */
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

  /** 가림막이 내려오면 닫는다 — 가림 아래에 고르는 줄을 남겨 두지 않는다 */
  $effect(() => {
    if (veilVisible()) closeProfileSwitcher();
  });

  // ── 동작 ────────────────────────────────────────────────────────────────

  /**
   * 입힌다 — 먼저 닫고(포커스는 연 자리로) 입힌다. 이미 쓰는 벌이고 **손대지 않았으면** 닫기만 한다(설정 카드와
   * 같은 규칙: 같은 값을 다시 쓰지 않는다). 고친 뒤라면 다시 입혀 저장된 벌로 되돌린다.
   * 원 퍼짐(`theme-reveal.ts`)은 클릭 · 키 어느 쪽이든 **창 안의 아무 자리**에서 시작한다(2026-11-02 사용자).
   */
  function pick(id: string, _ev: Event): void {
    const origin = revealOriginRandom();
    closeProfileSwitcher();
    if (id === activeId && !modified) return;
    void revealTheme(origin, () => applyProfile(id), { preload: profileWallpaperSrc(id) });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (!visible) return; // 나가는 중 — `inert` 가 이미 막지만 한 번 더
    // 같은 단축키로 닫는다(토글) — 포커스가 여기라 창의 전역 처리기는 쉬고 있다(`anyModalOpen`)
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
  <!-- 가장자리 감싸개 — 가장자리 위를 자르기만 한다(클릭은 바깥 막으로 흘린다) -->
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
          <!-- 키는 줄(listbox)이 받는다 — 카드는 누르기만 (aria-activedescendant 의 한 칸) -->
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
  /* 바깥 클릭을 받는 투명한 막 — 뒤를 어둡게 하지 않는다: 지금 모양을 보면서 다음 벌을 고르는 화면이다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110; /* 팔레트 · 검색과 같은 층(둘은 함께 뜨지 않는다) — 가림막(115) · 토스트(120) 아래 */
  }

  /* 캔버스 위 가장자리부터 창 아래까지 — 미끄러지는 패널의 가장자리 위를 자른다(`clip-path` 대신 — 위 몸짓 주석) */
  .edge {
    position: absolute;
    top: 40px;
    right: 0;
    bottom: 0;
    left: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* 부르는 면 — 불투명 · 둥근 모서리 · 뜬 그림자(그림자는 떠 있는 면만) */
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

  /* 나가는 동안 — Svelte 가 나가는 패널에 `inert` 를 건다. 바깥 막도 클릭을 아래로 흘려보낸다(그림만 남아 있다) */
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

  /* 이 고르개를 여는 단축키 — 안내 키보다 한 단 흐리게 */
  .combo {
    display: inline-flex;
    --keycap-fg: var(--fg-3);
  }

  /* 카드 줄 — 넘치면 가로로 흐른다(고른 카드가 보이게 옮긴다). 위아래 여백은 고른 카드의 링이 잘리지 않을 만큼 */
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

  /* 설정의 카드와 같은 틀 — 폭만 고정(줄이 가로로 흐른다) */
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
    /* 패널을 따라 한 박자씩 늦게 내려앉는다 — 60ms + 25ms × 순번(다섯째에서 멈춤 — 가장 늦어도 160ms) */
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

  /* 지금 쓰는 벌 — 설정 카드와 같은 강조 테두리 */
  .card.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }

  /* 고른 카드 — 키보드 포커스 링(중성). 줄이 포커스를 쥐고 있을 때만 링이고, 아니면 옅은 테두리로 남는다 */
  .card.sel {
    border-color: var(--line-strong);
  }

  .row:focus-visible .card.sel,
  .row:focus .card.sel {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* 번호 — 숫자 키로 그 카드에 간다. 사진 위라 배지와 같은 사진 쪽 대비 */
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
