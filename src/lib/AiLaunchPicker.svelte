<script lang="ts">
  import { tick } from "svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { placeFlyout, type RectLike } from "$lib/menu-flyout";
  import { aiIconName } from "$lib/pane-icons";
  import { aiAvatarSrc } from "$lib/avatars.svelte.js";
  import { comboFromEvent, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { carouselOffset, digitRowIndex, launchFormFor, otherLaunchForm, type AiLaunchForm } from "$lib/ai-launch-pick";
  import { aiLaunchPicker, closeAiLaunchPicker, runAiLaunch } from "$lib/app/ai-launch.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";

  /**
   * AI CLI 고르기 돌림판 — 판 · 뒤 효과 없이 캐릭터만 띄운다(어두운 막 · 빛 무리 · 유리 판은 사용자가 걷었다).
   * Esc 는 여기서 끊는다 — 뒤 화면의 Escape 사슬로 새지 않게.
   * 채팅 모양을 받는 줄: 누르기 · Enter = 설정의 기본 모양(`[ai] launch_form`) · Alt+Enter = 다른 모양 · 우클릭 · 메뉴 키 = 두 모양 메뉴.
   */

  const picker = $derived(aiLaunchPicker());
  const FORMS: readonly AiLaunchForm[] = ["terminal", "chat"];

  let el = $state<HTMLElement | null>(null);
  let sel = $state(0);
  /** 한 번에 두 칸 넘게 뛴 줄(둘러 가기)은 화면을 가로지르지 않게 미끄럼 없이 옮긴다 */
  let prevOffsets: number[] = [];

  /** 모양 메뉴 — `i` 는 연 줄 */
  let menu = $state<{ i: number; x: number; y: number } | null>(null);
  let menuPos = $state<{ left: number; top: number } | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  const menuRow = $derived(menu ? (picker?.rows[menu.i] ?? null) : null);
  const menuDefault = $derived<AiLaunchForm>(launchFormFor(menuRow?.chat === true, settings.aiLaunchForm));

  $effect(() => {
    const p = picker;
    if (!p) return;
    sel = p.selected;
    menu = null;
    prevOffsets = [];
  });

  $effect(() => {
    const node = el;
    if (!node) return;
    void tick().then(() => node.focus({ preventScroll: true }));
  });

  $effect(() => {
    if (picker && veilVisible()) closeAiLaunchPicker(false);
  });

  $effect(() => {
    const node = menuEl;
    const m = menu;
    if (!node || !m) return;
    const at: RectLike = { left: m.x, right: m.x, top: m.y };
    menuPos = placeFlyout(at, at, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
  });

  const slots = $derived.by(() => {
    const p = picker;
    if (!p) return [];
    const n = p.rows.length;
    const out = p.rows.map((row, i) => {
      const d = carouselOffset(i, sel, n);
      const prev = prevOffsets[i];
      return { row, i, d, jump: prev !== undefined && Math.abs(prev - d) > 1 };
    });
    prevOffsets = out.map((s) => s.d);
    return out;
  });

  /** `as` 를 주지 않으면 그 줄의 기본 모양 — 채팅을 못 받는 줄은 무엇을 주든 터미널 */
  function choose(i: number, as?: AiLaunchForm): void {
    runOnMenu(
      () => {
        const p = aiLaunchPicker();
        const row = p?.rows[i];
        if (!p || !row) return null;
        const form = as ?? launchFormFor(row.chat, settings.aiLaunchForm);
        return { cli: row.cli, here: p.here, chat: row.chat && form === "chat" };
      },
      () => closeAiLaunchPicker(false),
      runAiLaunch,
    );
  }

  /** 메뉴 항목 — 줄은 메뉴 상태에서 스냅샷한다(docs/conventions.md 의 메뉴 통로) */
  function chooseFromMenu(form: AiLaunchForm): void {
    runOnMenu(
      () => {
        const p = aiLaunchPicker();
        const row = menu ? p?.rows[menu.i] : undefined;
        return p && row ? { cli: row.cli, here: p.here, chat: row.chat && form === "chat" } : null;
      },
      () => {
        menu = null;
        closeAiLaunchPicker(false);
      },
      runAiLaunch,
    );
  }

  function openMenu(i: number, x: number, y: number): void {
    if (picker?.rows[i]?.chat !== true) return;
    sel = i;
    menu = { i, x, y };
    menuPos = null;
    void tick().then(() => menuEl?.querySelector<HTMLElement>("button[role='menuitem']")?.focus({ preventScroll: true }));
  }

  function closeMenu(): void {
    menu = null;
    el?.focus({ preventScroll: true });
  }

  /** 채팅을 받지 않는 줄은 손대지 않는다 — 창 전역 차단이 기본 메뉴를 막는다 */
  function onCardContext(ev: MouseEvent, i: number): void {
    if (picker?.rows[i]?.chat !== true) return;
    ev.preventDefault();
    openMenu(i, ev.clientX, ev.clientY);
  }

  function openMenuAtSel(): void {
    const r = el?.querySelector<HTMLElement>(`#ailaunch-row-${sel}`)?.getBoundingClientRect();
    if (r) openMenu(sel, r.left + r.width / 2, r.top + r.height / 2);
  }

  /** 메뉴가 열려 있으면 키는 메뉴 것 — Enter 는 포커스 선 항목의 기본 누르기에 맡긴다 */
  function onMenuKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    const buttons = Array.from(menuEl?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']") ?? []);
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const down = ev.key === "ArrowDown";
    const next = ev.key === "Home" ? 0 : ev.key === "End" ? buttons.length - 1 : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }

  function step(by: number): void {
    const n = picker?.rows.length ?? 0;
    if (n > 0) sel = (sel + by + n) % n;
  }

  function onKey(ev: KeyboardEvent): void {
    const p = picker;
    if (!p) return;
    if (menu) {
      onMenuKey(ev);
      return;
    }
    const n = p.rows.length;
    const stop = () => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    if (ev.key === "Escape") {
      stop();
      closeAiLaunchPicker(true);
      return;
    }
    if (ev.key === "Enter" && ev.altKey && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey) {
      stop();
      if (p.rows[sel]?.chat) choose(sel, otherLaunchForm(launchFormFor(true, settings.aiLaunchForm)));
      return;
    }
    if (ev.key === "Enter") {
      stop();
      choose(sel);
      return;
    }
    if (ev.key === "ContextMenu" || (ev.key === "F10" && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey)) {
      stop();
      openMenuAtSel();
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault(); // 포커스가 상자 밖으로 새지 않게 — 고르는 것은 화살표다
      return;
    }
    const combo = comboFromEvent(ev);
    if (combo !== null && combo === effectiveCombo("ai-panel", settings.keybindings)) {
      stop();
      choose(sel);
      return;
    }
    if (!ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      const d = digitRowIndex(ev.code, n);
      if (d !== null) {
        stop();
        choose(d);
        return;
      }
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") {
      stop();
      step(1);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") {
      stop();
      step(-1);
    } else if (ev.key === "Home") {
      stop();
      sel = 0;
    } else if (ev.key === "End") {
      stop();
      sel = n - 1;
    }
  }

  /** 트랙패드의 잔 사건은 모아서 한 칸 */
  let wheelAcc = 0;
  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    if (menu) return;
    wheelAcc += Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    step(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0;
  }

  /** 메뉴가 열려 있으면 바깥 누르기는 메뉴만 닫는다 */
  function onDown(ev: PointerEvent): void {
    const target = ev.target;
    if (menu) {
      if (!(target instanceof Element && target.closest("[data-ai-launch-menu]"))) {
        ev.preventDefault();
        closeMenu();
      }
      return;
    }
    if (target instanceof Element && target.closest("[data-ai-launch-card]")) return;
    closeAiLaunchPicker(true);
  }

  function onPick(i: number): void {
    if (i === sel) choose(i);
    else sel = i;
  }
</script>

{#if picker}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="ailaunch"
    role="listbox"
    aria-label={t("app.ai.launch.aria")}
    aria-activedescendant="ailaunch-row-{sel}"
    tabindex="-1"
    data-ai-launch-picker
    bind:this={el}
    onkeydown={onKey}
    onwheel={onWheel}
    onpointerdown={onDown}
  >
    <div class="card" data-ai-launch-card>
    <div class="stage">
      {#each slots as s (s.row.cli.id)}
        {@const ai = aiIconName(s.row.cli.id)}
        {@const avatar = ai ? aiAvatarSrc(ai, true) : null}
        {@const far = Math.abs(s.d)}
        <button
          type="button"
          id="ailaunch-row-{s.i}"
          class="opt"
          class:sel={s.d === 0}
          class:jump={s.jump}
          class:missing={!s.row.installed}
          role="option"
          aria-selected={s.d === 0}
          tabindex="-1"
          data-ai-launch-row={s.row.cli.id}
          style:--d={s.d}
          style:--scale={far === 0 ? 1 : far === 1 ? 0.55 : 0.35}
          style:--op={far === 0 ? 1 : far === 1 ? 0.5 : 0}
          style:--z={10 - far}
          style:--i={s.i}
          style:pointer-events={far > 1 ? "none" : null}
          onclick={() => onPick(s.i)}
          oncontextmenu={(ev) => onCardContext(ev, s.i)}
        >
          <span class="face" class:logo={!avatar}>
            {#if ai}<AiGlyph name={ai} size={avatar ? 116 : 64} />{/if}
          </span>
        </button>
      {/each}
    </div>

    {#key sel}
      {@const row = picker.rows[sel]}
      <div class="caption" aria-hidden="true">
        <b>{row?.cli.name ?? ""}</b>
        {#if row && !row.installed}<span class="meta" data-not-installed>{t("app.ai.launch.notInstalled")}</span>{/if}
      </div>
    {/key}

    <div class="dots" aria-hidden="true">
      {#each picker.rows as row, i (row.cli.id)}<span class:on={i === sel}></span>{/each}
    </div>

    </div>

    {#if menu && menuRow}
      <div class="form-menu menu-surface menu-keyed" role="menu" tabindex="-1" aria-label={menuRow.cli.name} data-ai-launch-menu
        bind:this={menuEl} style:left={(menuPos?.left ?? 0) + "px"} style:top={(menuPos?.top ?? 0) + "px"}>
        <p class="menu-title">{menuRow.cli.name}</p>
        {#each FORMS as form (form)}
          <button type="button" class="menu-row form-row" role="menuitem" data-ai-launch-form={form}
            data-default={form === menuDefault ? "" : undefined} onclick={() => chooseFromMenu(form)}>
            <span class="form-name">{t(form === "chat" ? "app.ai.launch.chat" : "app.ai.launch.terminal")}</span>
            <span class="menu-kbd">{form === menuDefault ? t("app.shellmenu.default") : "Alt+Enter"}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* 창 전체를 받는 투명한 층 — 바깥 누르기 · 휠을 받는다. 층은 블록 넘기기 상자 · 셸 메뉴와 같은 121 */
  .ailaunch {
    --ease: cubic-bezier(0.2, 0, 0, 1);
    --spring: cubic-bezier(0.34, 1.4, 0.64, 1);
    position: fixed;
    inset: 0;
    z-index: 121;
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--fg-1);
    font-family: var(--font-ui);
    outline: none;
  }
  /* 모양 없음 — 누른 자리가 안인지 가리는 경계일 뿐 */
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    width: min(440px, calc(100vw - 16px));
    overflow: hidden;
    animation: ailaunch-in 160ms var(--ease);
  }
  @keyframes ailaunch-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  .stage {
    position: relative;
    width: 100%;
    height: 136px;
  }
  .opt {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 124px;
    height: 124px;
    margin: -62px 0 0 -62px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    cursor: pointer;
    z-index: var(--z);
    opacity: var(--op);
    transform: translateX(calc(var(--d) * 128px)) scale(var(--scale));
    filter: saturate(0.5) brightness(0.85);
    transition:
      transform 360ms var(--ease),
      opacity 280ms var(--ease),
      filter 280ms var(--ease);
  }
  .opt.sel {
    filter: none;
  }
  .opt.jump {
    transition: none;
  }
  .opt.jump .face {
    animation: ailaunch-swap 260ms var(--ease);
  }
  @keyframes ailaunch-swap {
    from {
      opacity: 0;
      scale: 0.8;
    }
  }
  .opt:focus-visible {
    outline: none;
  }

  .face {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    transition: box-shadow 280ms var(--ease);
  }
  .face.logo {
    background: var(--control-tile-bg);
  }
  .opt.sel .face {
    box-shadow:
      0 0 0 3px var(--bg-base),
      0 0 0 5px var(--accent),
      0 8px 28px color-mix(in srgb, var(--accent) 35%, transparent);
    animation: ailaunch-pop 420ms var(--spring);
  }
  @keyframes ailaunch-pop {
    0% {
      transform: scale(0.92);
    }
    100% {
      transform: scale(1);
    }
  }
  .opt.missing .face {
    opacity: 0.5;
  }

  /* 자리 transform 과 겹치지 않게 안쪽 .face 에 */
  .opt .face {
    animation: ailaunch-rise 420ms var(--ease) backwards;
    animation-delay: calc(var(--i) * 40ms);
  }
  .opt.sel .face {
    animation:
      ailaunch-rise 420ms var(--ease) backwards,
      ailaunch-pop 420ms var(--spring);
  }
  @keyframes ailaunch-rise {
    from {
      opacity: 0;
      translate: 0 14px;
    }
  }

  .caption {
    display: grid;
    justify-items: center;
    gap: 2px;
    min-height: 44px;
    animation: ailaunch-caption 260ms var(--ease);
  }
  .caption b {
    font-size: 17px;
    font-weight: 700;
  }
  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  @keyframes ailaunch-caption {
    from {
      opacity: 0;
      translate: 0 8px;
    }
  }

  /* 층(121) 안이라 z-index 는 돌림판 위로만 */
  .form-menu {
    position: fixed;
    z-index: 20;
    min-width: 200px;
    max-width: min(320px, calc(100vw - 16px));
  }
  .form-row {
    display: flex;
    align-items: center;
  }
  .form-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .dots {
    display: flex;
    gap: 6px;
  }
  .dots span {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--fg-1) 22%, transparent);
    transition:
      width 260ms var(--ease),
      background 260ms var(--ease);
  }
  .dots span.on {
    width: 18px;
    background: var(--accent);
  }


  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }
    .opt,
    .face,
    .dots span {
      transition: none;
    }
    .opt .face,
    .opt.sel .face,
    .opt.jump .face,
    .caption {
      animation: none;
    }
  }
</style>
