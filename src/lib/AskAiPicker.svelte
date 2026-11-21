<script lang="ts">
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { aiIconName } from "$lib/pane-icons";
  import type { AskRow } from "$lib/ask-ai";
  import { askPicker, closeAskPicker, runAskRow } from "$lib/app/ask-ai.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";

  /** 블록을 AI 타일에 넘기기 — 고르기 상자. Esc 는 여기서 끊는다 — 뒤 화면의 Escape 사슬로 새지 않게. */

  const picker = $derived(askPicker());

  let el = $state<HTMLElement | null>(null);
  let sel = $state(0);
  let pos = $state<{ left: number; top: number } | null>(null);

  $effect(() => {
    const p = picker;
    if (!p) return;
    sel = p.selected;
    pos = null;
  });

  $effect(() => {
    const node = el;
    const p = picker;
    if (!node || !p) return;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = p.anchor.align === "right" ? p.anchor.x - w : p.anchor.x;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = p.anchor.y;
    if (top + h > vh - 8) top = Math.max(8, p.anchor.y - h - 32);
    pos = { left, top };
  });

  /**
   * 자리를 잡은 뒤 포커스 — 숨은(측정 전) 상자는 포커스를 받지 않는다. `tick` 이 아니라 rAF 다: 활성이 아닌 타일의 단추를 누르면
   * 그 타일의 활성화가 rAF 안에서 포커스를 주므로, 이 rAF 가 그 뒤에 돌아야 상자의 포커스를 빼앗기지 않는다(`CodeTermPicker` 와 같다).
   */
  $effect(() => {
    const node = el;
    if (!node || pos === null) return;
    const raf = requestAnimationFrame(() => node.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  });

  $effect(() => {
    if (!picker) return;
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (target instanceof Node && el?.contains(target)) return;
      closeAskPicker("none");
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });

  $effect(() => {
    if (picker && veilVisible()) closeAskPicker("none");
  });

  function choose(i: number): void {
    runOnMenu(
      () => {
        const p = askPicker();
        const row = p?.rows[i];
        return p && row ? { row, sourcePaneId: p.sourcePaneId, text: p.text } : null;
      },
      () => closeAskPicker("none"),
      runAskRow,
    );
  }

  function onKey(ev: KeyboardEvent): void {
    const p = picker;
    if (!p) return;
    const n = p.rows.length;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeAskPicker("source");
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      choose(sel);
      return;
    }
    if (ev.key === "Tab") {
      ev.preventDefault(); // 상자 밖으로 포커스가 새지 않게 — 고르는 것은 화살표다
      return;
    }
    const next =
      ev.key === "ArrowDown"
        ? (sel + 1) % n
        : ev.key === "ArrowUp"
          ? (sel - 1 + n) % n
          : ev.key === "Home"
            ? 0
            : ev.key === "End"
              ? n - 1
              : null;
    if (next === null) return;
    ev.preventDefault();
    ev.stopPropagation();
    sel = next;
  }

  function groupLabel(rows: readonly AskRow[], i: number, hasTiles: boolean): string | null {
    const row = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;
    if (row.kind === "tile") {
      if (prev && prev.kind === "tile" && prev.group === row.group) return null;
      return row.group === "here" ? t("pane.askai.picker.here") : t("pane.askai.picker.other");
    }
    if (row.kind === "sideChat") return null;
    if (prev && prev.kind === "new") return null;
    if (prev && prev.kind === "sideChat") return hasTiles ? null : t("pane.askai.picker.none");
    return hasTiles ? null : t("pane.askai.picker.none");
  }
</script>

{#if picker}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="askai menu-surface"
    role="listbox"
    aria-label={t("pane.askai.picker.aria")}
    aria-activedescendant="askai-row-{sel}"
    tabindex="-1"
    data-ask-picker
    bind:this={el}
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
    style:visibility={pos ? "visible" : "hidden"}
    onkeydown={onKey}
  >
    <div class="head">
      <b>{t("pane.askai.picker.head")}</b>
      <span class="sum" title={picker.summary}>{picker.summary}</span>
    </div>
    {#if picker.privateNote}
      <p class="note" data-ask-private>{t("pane.askai.private")}</p>
    {/if}
    {#each picker.rows as row, i (row.kind === "tile" ? row.tile.paneId : row.kind === "new" ? `new-${row.cli.id}` : "side-chat")}
      {@const group = groupLabel(picker.rows, i, picker.hasTiles)}
      {#if (row.kind === "new" || row.kind === "sideChat") && i > 0 && picker.rows[i - 1]?.kind !== row.kind && (picker.hasTiles || row.kind === "new")}
        <hr class="menu-sep" />
      {/if}
      {#if group}
        <p class="grp">{group}</p>
      {/if}
      {#if row.kind === "tile"}
        {@const ai = aiIconName(row.tile.ai)}
        <button
          type="button"
          id="askai-row-{i}"
          class="opt"
          class:sel={i === sel}
          role="option"
          aria-selected={i === sel}
          tabindex="-1"
          data-ask-row={row.tile.paneId}
          data-group={row.group}
          onpointermove={() => (sel = i)}
          onclick={() => choose(i)}
        >
          <span class="logo">{#if ai}<AiGlyph name={ai} size={16} />{/if}</span>
          <span class="code">{row.tile.code}</span>
          <span class="name">
            {row.group === "other" ? `${row.tile.name} · ${row.tile.tabTitle}` : row.tile.name}
          </span>
          <span class="tail">
            {#if row.busy}
              <span class="busy" data-busy><span class="dot"></span>{t("pane.askai.picker.busy")}</span>
            {/if}
            {#if row.last}
              <span class="meta" data-last>{t("pane.askai.picker.last")}</span>
            {:else if row.group === "other"}
              <span class="meta">{t("pane.askai.picker.tab", { n: row.tile.tabIndex })}</span>
            {/if}
          </span>
        </button>
      {:else if row.kind === "sideChat"}
        <button
          type="button"
          id="askai-row-{i}"
          class="opt"
          class:sel={i === sel}
          role="option"
          aria-selected={i === sel}
          tabindex="-1"
          data-ask-side-chat
          title={t("pane.askai.picker.sideChat.title")}
          onpointermove={() => (sel = i)}
          onclick={() => choose(i)}
        >
          <span class="logo"><UiIcon name="side-panel" size={16} /></span>
          <span class="name">{t("pane.askai.picker.sideChat", { title: row.title })}</span>
        </button>
      {:else}
        {@const ai = aiIconName(row.cli.id)}
        <button
          type="button"
          id="askai-row-{i}"
          class="opt new"
          class:sel={i === sel}
          role="option"
          aria-selected={i === sel}
          tabindex="-1"
          data-ask-new={row.cli.id}
          onpointermove={() => (sel = i)}
          onclick={() => choose(i)}
        >
          <span class="logo">
            {#if ai}<AiGlyph name={ai} size={16} />{/if}
            <span class="plus"><UiIcon name="plus" size={9} /></span>
          </span>
          <span class="name">{t("pane.askai.picker.new", { name: row.cli.name })}</span>
          <span class="tail">
            {#if row.isDefault}<span class="meta">{t("pane.askai.picker.default")}</span>{/if}
          </span>
        </button>
      {/if}
    {/each}
    <div class="keys">
      {#if picker.rows.length > 1}
        <span><Keys combo="↑↓" /> {t("pane.askai.picker.keys.move")}</span>
      {/if}
      <span
        ><Keys combo="Enter" />
        {picker.hasTiles ? t("pane.askai.picker.keys.send") : t("pane.askai.picker.keys.open")}</span
      >
      <span><Keys combo="Esc" /> {t("pane.askai.picker.keys.close")}</span>
    </div>
  </div>
{/if}

<style>
  /* 셸 메뉴 · 알림 상자와 같은 층(121)이다. */
  .askai {
    position: fixed;
    z-index: 121;
    width: min(380px, calc(100vw - 16px));
    max-height: min(70vh, 520px);
    overflow-y: auto;
    box-sizing: border-box;
    display: grid;
    gap: 2px;
    animation: askai-in 140ms ease-out;
  }
  @keyframes askai-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  /* 글래스는 `opacity` 대신 판 색 · 내용만 페이드한다 — 움직이는 동안에도 흐림이 선다(theme.css `glass-surface-in`). */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-material="glass"]) .askai {
      --glass-in-from: translateY(-4px);
      animation-name: glass-surface-in;
    }
    :global(:root[data-material="glass"]) .askai > :global(*) {
      animation: glass-content-in 140ms ease-out;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .askai {
      animation: none;
    }
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: 6px var(--space-3) 4px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    min-width: 0;
  }
  .head b {
    flex: none;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }
  .head .sum {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
  }

  .note {
    margin: 0 var(--space-3) 2px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .grp {
    margin: 0;
    padding: var(--space-2) var(--space-3) 2px; /* 좌우 = 줄 안쪽 여백 — 머리글이 줄 글자와 같은 x */
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .opt {
    display: grid;
    grid-template-columns: 16px auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 32px;
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-row);
    background: transparent;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    cursor: pointer;
  }
  .opt.new {
    grid-template-columns: 16px minmax(0, 1fr) auto;
    color: var(--fg-2);
  }
  .opt.sel {
    background: var(--accent-soft);
  }
  .opt:focus-visible {
    outline: none;
  }

  .logo {
    position: relative;
    display: inline-flex;
    width: 16px;
    height: 16px;
    align-items: center;
    justify-content: center;
  }
  .plus {
    position: absolute;
    right: -4px;
    bottom: -4px;
    display: inline-flex;
    width: 11px;
    height: 11px;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--surface-raised-solid);
    color: var(--fg-1);
  }
  .code {
    font: 500 11px/1 var(--font-mono, monospace);
    padding: 3px 5px;
    border-radius: 4px;
    background: var(--surface-hover);
    color: var(--fg-2);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tail {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }
  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  .busy {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: 6px var(--space-3) 4px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  .keys > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
</style>
