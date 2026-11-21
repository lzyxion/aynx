<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ClockOptions } from "$lib/start-clock";

  /**
   * 위젯 위 우클릭 메뉴 — 되돌리기 · 레이아웃 리셋은 판 메뉴에만 둔다(사용자 결정).
   * 새 표시는 스냅샷 순간의 `clock` 으로 셈해 넘긴다 — 닫힌 뒤의 값을 읽지 않게(docs/conventions.md 의 "메뉴를 닫는 코드").
   */
  let {
    x,
    y,
    clock,
    editing,
    onclose,
    onpick,
    onedit,
  }: {
    x: number;
    y: number;
    /** 시계 위젯이 아니면 `null` */
    clock: Readonly<ClockOptions> | null;
    editing: boolean;
    onclose: () => void;
    onpick: (next: ClockOptions) => void;
    onedit: () => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  $effect(() => {
    if (!menuEl) return;
    const cur = menuEl.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    (cur ?? items(menuEl)[0])?.focus();
  });

  function items(box: HTMLElement): HTMLElement[] {
    return [...box.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((el) => !(el as HTMLButtonElement).disabled);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && menuEl) {
      ev.preventDefault();
      ev.stopPropagation();
      const list = items(menuEl);
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  }

  function pick(change: (cur: Readonly<ClockOptions>) => ClockOptions) {
    const cur = clock;
    if (!cur) return;
    runOnMenu(() => change(cur), onclose, (next) => onpick(next));
  }
</script>

{#snippet check(on: boolean)}
  <span class="check" aria-hidden="true">{#if on}<UiIcon name="check" size={14} />{/if}</span>
{/snippet}

<div class="portal" use:portal>
  <button
    type="button"
    class="menu-backdrop"
    tabindex="-1"
    aria-label={t("files.menu.close.aria")}
    onclick={onclose}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      onclose();
    }}
  ></button>
  <div
    class="widget-menu menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t(clock ? "app.start.clock.menu.aria" : "app.start.widget.menu.aria")}
    data-start-widget-menu={clock ? "clock" : "widget"}
    style:left="{x}px"
    style:top="{y}px"
    bind:this={menuEl}
    onkeydown={onKeydown}
  >
    {#if clock}
      <button
        type="button"
        class="menu-row row"
        role="menuitemradio"
        aria-checked={!clock.hour12}
        data-clock-menu="h24"
        onclick={() => pick((cur) => ({ ...cur, hour12: false }))}
      >
        <span class="label">{t("app.start.clock.menu.h24")}</span>
        {@render check(!clock.hour12)}
      </button>
      <button
        type="button"
        class="menu-row row"
        role="menuitemradio"
        aria-checked={clock.hour12}
        data-clock-menu="h12"
        onclick={() => pick((cur) => ({ ...cur, hour12: true }))}
      >
        <span class="label">{t("app.start.clock.menu.h12")}</span>
        {@render check(clock.hour12)}
      </button>
      <div class="menu-sep" role="separator"></div>
      <button
        type="button"
        class="menu-row row"
        role="menuitemcheckbox"
        aria-checked={clock.seconds}
        data-clock-menu="seconds"
        onclick={() => pick((cur) => ({ ...cur, seconds: !cur.seconds }))}
      >
        <span class="label">{t("app.start.clock.menu.seconds")}</span>
        {@render check(clock.seconds)}
      </button>
      <button
        type="button"
        class="menu-row row"
        role="menuitemcheckbox"
        aria-checked={clock.date}
        data-clock-menu="date"
        onclick={() => pick((cur) => ({ ...cur, date: !cur.date }))}
      >
        <span class="label">{t("app.start.clock.menu.date")}</span>
        {@render check(clock.date)}
      </button>
    {/if}
    {#if !editing}
      {#if clock}<div class="menu-sep" role="separator"></div>{/if}
      <button
        type="button"
        class="menu-row row"
        role="menuitem"
        data-widget-menu-edit
        onclick={() => runAfterClose(onclose, onedit)}
      >
        <span class="label">{t("app.start.board.edit.start")}</span>
        {#if clock}<span class="check" aria-hidden="true"></span>{/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .portal {
    display: contents;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .widget-menu {
    position: fixed;
    z-index: 106;
    min-width: 160px;
    max-width: 260px;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-left: var(--space-2);
    color: var(--fg-2);
  }
</style>
