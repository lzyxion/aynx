<script lang="ts">
  /**
   * 고른 뒤에도 열려 있다(모델과 Effort 를 한 번에) — 고르기의 몸은 `SideChatControls`(메뉴 통로)이고 이 상자는 누름만 넘긴다.
   * CLI 는 ←→ 로 옮기기만으로 고르지 않는다 — 바꾸면 프로세스를 다시 연다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import ChatEffortGauge from "$lib/chat/ChatEffortGauge.svelte";
  import { aiIconName } from "$lib/pane-icons";
  import { effortName, type SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ctl,
    trigger,
    touch = false,
  }: {
    ctl: SideChatControls;
    trigger: HTMLElement;
    touch?: boolean;
  } = $props();

  const EDGE = 8;
  const labelId = `models-${Math.random().toString(36).slice(2, 8)}`;

  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  const chat = $derived(ctl.chat);

  function place(): void {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    left = Math.max(EDGE, Math.min(r.right - w, window.innerWidth - EDGE - w));
    const below = r.bottom + 4;
    top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, r.top - 4 - h) : below;
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    // 붙을 때 한 번만 — 자리 재기가 읽는 것(연 단추 등)에 매이면 고를 때마다 다시 돌아 포커스를 모델 줄로 빼앗는다
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      const cur = node.querySelector<HTMLElement>('[data-chat-model][aria-checked="true"]');
      (cur ?? node.querySelector<HTMLElement>("[data-chat-model]") ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

  /** 연 단추만 비켜 간다 — 그 단추의 click 이 닫기를 맡는다 */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || trigger.contains(target)) return;
      ctl.closeModel(false);
    };
    const onResize = () => ctl.closeModel(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  });

  $effect(() => {
    if (ctl.customOpen && inputEl) {
      inputEl.focus({ preventScroll: true });
      inputEl.select();
    }
  });

  function onKey(ev: KeyboardEvent): void {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      ctl.closeModel(true);
      return;
    }
    if (ev.key === "Tab") {
      const stops = Array.from(node.querySelectorAll<HTMLElement>('button[tabindex="0"], input')).filter((x) => !x.hasAttribute("disabled"));
      if (stops.length === 0) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      const next = ev.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : i < 0 || i >= stops.length - 1 ? 0 : i + 1;
      ev.preventDefault();
      ev.stopPropagation();
      stops[next].focus({ preventScroll: true });
      return;
    }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
  }

  function rove(ev: KeyboardEvent, sel: string, keys: readonly [string, string]): void {
    if (ev.key !== keys[0] && ev.key !== keys[1] && ev.key !== "Home" && ev.key !== "End") return;
    const list = Array.from(el?.querySelectorAll<HTMLElement>(sel) ?? []);
    if (list.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = list.length - 1;
    else if (ev.key === keys[1]) next = i < 0 || i >= list.length - 1 ? 0 : i + 1;
    else next = i <= 0 ? list.length - 1 : i - 1;
    list[next].focus({ preventScroll: true });
  }

  function onCustomKey(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      ctl.commitCustom();
      requestAnimationFrame(() => {
        const node = el;
        const cur = node?.querySelector<HTMLElement>('[data-chat-model][aria-checked="true"]');
        (cur ?? node?.querySelector<HTMLElement>("[data-chat-model-custom]"))?.focus({ preventScroll: true });
      });
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 메뉴를 닫지 않는다 — 입력만 그만둔다
      ctl.cancelCustom();
      requestAnimationFrame(() => el?.querySelector<HTMLElement>("[data-chat-model-custom]")?.focus({ preventScroll: true }));
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mp menu-surface"
  class:touch
  role="dialog"
  aria-label={t("app.chatDock.chip.menu")}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px"
  onkeydown={onKey}
  data-chat-model-menu
>
  {#if ctl.untested}
    <p class="warn" role="note" data-chat-untested><UiIcon name="warning" size={14} /><span>{t("app.chatDock.chip.untested", { v: ctl.untested })}</span></p>
  {/if}

  {#if chat}
    <div class="seg-group" role="radiogroup" aria-label={t("app.chatDock.cli.aria")} style:--seg-n={Math.max(1, ctl.offered.length)}>
      {#each ctl.offered as x (x.id)}
        {@const on = x.id === chat.cli}
        {@const name = aiIconName(x.id)}
        <button
          type="button"
          role="radio"
          class="seg"
          class:on
          aria-checked={on}
          tabindex={on ? 0 : -1}
          data-chat-cli={x.id}
          onkeydown={(ev) => rove(ev, "[data-chat-cli]", ["ArrowLeft", "ArrowRight"])}
          onclick={() => ctl.pickCli(x.id)}
        >
          {#if name}<AiGlyph {name} size={14} mono />{:else}<UiIcon name="ai" size={14} />{/if}
          <span class="seg-name">{x.name}</span>
        </button>
      {/each}
    </div>

    <div class="label" id={labelId}>{t("app.chatDock.model.label")}</div>
    <div class="models" role="radiogroup" aria-labelledby={labelId}>
      {#each ctl.models as m (m.value)}
        <button
          type="button"
          role="radio"
          class="row menu-row"
          aria-checked={m.checked}
          tabindex={m.checked ? 0 : -1}
          data-chat-model={m.value}
          onkeydown={(ev) => rove(ev, "[data-chat-model], [data-chat-model-custom]", ["ArrowUp", "ArrowDown"])}
          onclick={() => ctl.pickModel(m.value)}
        >
          <span class="row-label">{m.label}</span>
          <span class="check" aria-hidden="true">{#if m.checked}<UiIcon name="check" size={14} />{/if}</span>
        </button>
      {/each}
      {#if ctl.customOpen}
        <input
          class="custom menu-input"
          bind:this={inputEl}
          bind:value={ctl.customText}
          aria-label={t("app.chatDock.chip.custom.aria")}
          aria-invalid={!ctl.customOk}
          title={ctl.customOk ? t("app.chatDock.chip.custom.aria") : t("app.chatDock.chip.custom.bad")}
          placeholder={t("app.chatDock.cliDefault")}
          spellcheck="false"
          autocomplete="off"
          data-chat-model-input
          onkeydown={onCustomKey}
          onblur={() => ctl.cancelCustom()}
        />
      {:else}
        <button
          type="button"
          class="row menu-row dim"
          tabindex={ctl.models.some((m) => m.checked) ? -1 : 0}
          data-chat-model-custom
          onkeydown={(ev) => rove(ev, "[data-chat-model], [data-chat-model-custom]", ["ArrowUp", "ArrowDown"])}
          onclick={() => ctl.startCustom()}><span class="row-label">{t("app.chatDock.chip.custom")}</span></button
        >
      {/if}
    </div>

    {#if ctl.effortShown}
      <hr class="menu-sep" />
      <ChatEffortGauge levels={ctl.efforts} value={chat.effort} nameOf={effortName} {touch} onpick={(e) => ctl.pickEffort(e)} />
    {/if}
  {/if}
</div>

<style>
  .mp {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    width: min(288px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2);
    overflow: hidden;
  }

  .warn {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .warn :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--warn);
  }

  .seg-group {
    flex: none;
    display: grid;
    grid-template-columns: repeat(var(--seg-n), minmax(0, 1fr));
    gap: 2px;
    padding: 3px;
    background: var(--m3-surface-container-low);
    border-radius: 999px;
  }

  .seg {
    min-width: 0;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .seg:not(.on):hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .seg.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .seg:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .seg-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label {
    flex: none;
    padding: 2px var(--space-3) 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 넘치면 이 칸만 굴린다 — 상자를 굴리면 글래스 흐림 층이 밀린다 */
  .models {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .row {
    display: flex;
    align-items: center;
    height: 32px;
  }

  .mp.touch .row,
  .mp.touch .seg {
    height: 44px;
  }

  .row-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row.dim {
    color: var(--fg-2);
  }

  .check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-left: var(--space-2);
    color: var(--control-sel-fg);
  }

  .row[aria-checked="true"] {
    font-weight: var(--fw-semibold);
  }

  .custom {
    box-sizing: border-box;
    width: 100%;
    height: 32px;
    margin: 0;
  }

  .mp.touch .custom {
    height: 44px;
  }

  .custom[aria-invalid="true"] {
    border-color: var(--err);
  }
</style>
