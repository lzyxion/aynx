<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { TermRow } from "$lib/code-to-term";
  import { closeCodeTermPicker, codeTermPicker, runCodeTermRow } from "$lib/app/code-to-term.svelte.js";
  import { findPaneAnywhere } from "$lib/app/tabs.svelte.js";
  import { veilVisible } from "$lib/app/veil.svelte.js";

  /** [터미널에 넣기]의 고르기 상자 — `AskAiPicker.svelte` 와 같은 결. Esc 는 여기서 끊는다(뒤 화면의 Escape 사슬로 새지 않게) */

  const picker = $derived(codeTermPicker());

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
   * 숨은(측정 전) 상자는 포커스를 받지 않아 자리를 잡은 뒤 준다. `tick` 이 아니라 rAF 다 — `PaneHost` 의 `routeTileFocus` 가
   * rAF 안에서 문서 타일 뿌리에 포커스를 주므로, 그보다 먼저 주면 상자가 포커스를 빼앗긴다.
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
      closeCodeTermPicker("none");
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });

  $effect(() => {
    if (picker && veilVisible()) closeCodeTermPicker("none");
  });

  function choose(i: number): void {
    runOnMenu(
      () => {
        const p = codeTermPicker();
        const row = p?.rows[i];
        return p && row ? { row, sourcePaneId: p.sourcePaneId, code: p.code, ondone: p.ondone } : null;
      },
      () => closeCodeTermPicker("none"),
      runCodeTermRow,
    );
  }

  function onKey(ev: KeyboardEvent): void {
    const p = picker;
    if (!p) return;
    const n = p.rows.length;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeCodeTermPicker("source");
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

  function groupLabel(rows: readonly TermRow[], i: number, hasTiles: boolean): string | null {
    const row = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;
    if (row.kind === "tile") {
      if (prev && prev.kind === "tile" && prev.group === row.group) return null;
      return row.group === "here" ? t("files.doc.codeterm.picker.here") : t("files.doc.codeterm.picker.other");
    }
    return hasTiles ? null : t("files.doc.codeterm.picker.none");
  }

  function rowName(row: Extract<TermRow, { kind: "tile" }>): string {
    const tile = row.tile;
    const base = tile.host && tile.host !== tile.name ? `${tile.name} · ${tile.host}` : tile.name;
    return row.group === "other" ? `${base} · ${tile.tabTitle}` : base;
  }
</script>

{#if picker}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="codeterm menu-surface"
    role="listbox"
    aria-label={t("files.doc.codeterm.picker.aria")}
    aria-activedescendant="codeterm-row-{sel}"
    tabindex="-1"
    data-code-term-picker
    bind:this={el}
    style:left="{pos?.left ?? 0}px"
    style:top="{pos?.top ?? 0}px"
    style:visibility={pos ? "visible" : "hidden"}
    onkeydown={onKey}
  >
    <div class="head">
      <b>{t("files.doc.codeterm.picker.head")}</b>
    </div>
    {#each picker.rows as row, i (row.kind === "tile" ? row.tile.paneId : "new")}
      {@const group = groupLabel(picker.rows, i, picker.hasTiles)}
      {#if row.kind === "new" && picker.hasTiles}
        <hr class="menu-sep" />
      {/if}
      {#if group}
        <p class="grp">{group}</p>
      {/if}
      {#if row.kind === "tile"}
        {@const pane = findPaneAnywhere(row.tile.paneId)}
        <button
          type="button"
          id="codeterm-row-{i}"
          class="opt"
          class:sel={i === sel}
          role="option"
          aria-selected={i === sel}
          tabindex="-1"
          data-code-term-row={row.tile.paneId}
          data-group={row.group}
          onpointermove={() => (sel = i)}
          onclick={() => choose(i)}
        >
          <span class="logo">{#if pane}<PaneIcon {pane} size={14} />{/if}</span>
          <span class="code">{row.tile.code}</span>
          <span class="name" title={rowName(row)}>{rowName(row)}</span>
          <span class="tail">
            {#if row.tile.busy}
              <span class="busy" data-busy><span class="dot"></span>{t("files.doc.codeterm.picker.busy")}</span>
            {/if}
            {#if row.last}
              <span class="meta" data-last>{t("files.doc.codeterm.picker.last")}</span>
            {:else if row.group === "other"}
              <span class="meta">{t("files.doc.codeterm.picker.tab", { n: row.tile.tabIndex })}</span>
            {/if}
          </span>
        </button>
      {:else}
        <button
          type="button"
          id="codeterm-row-{i}"
          class="opt new"
          class:sel={i === sel}
          role="option"
          aria-selected={i === sel}
          tabindex="-1"
          data-code-term-new
          onpointermove={() => (sel = i)}
          onclick={() => choose(i)}
        >
          <span class="logo">
            <UiIcon name="terminal" size={14} />
            <span class="plus"><UiIcon name="plus" size={9} /></span>
          </span>
          <span class="name"
            >{picker.sourcePaneId === null ? t("files.doc.codeterm.picker.newTab") : t("files.doc.codeterm.picker.new")}</span
          >
        </button>
      {/if}
    {/each}
    <div class="keys">
      {#if picker.rows.length > 1}
        <span><Keys combo="↑↓" /> {t("files.doc.codeterm.picker.keys.move")}</span>
      {/if}
      <span
        ><Keys combo="Enter" />
        {picker.hasTiles ? t("files.doc.codeterm.picker.keys.insert") : t("files.doc.codeterm.picker.keys.open")}</span
      >
      <span><Keys combo="Esc" /> {t("files.doc.codeterm.picker.keys.close")}</span>
    </div>
  </div>
{/if}

<style>
  /* `AskAiPicker` 와 같은 층(121) */
  .codeterm {
    position: fixed;
    z-index: 121;
    width: min(380px, calc(100vw - 16px));
    max-height: min(70vh, 520px);
    overflow-y: auto;
    box-sizing: border-box;
    display: grid;
    gap: 2px;
    animation: codeterm-in 140ms ease-out;
  }
  @keyframes codeterm-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  /* 글래스 — `opacity` 대신 판 색 · 그림자와 내용만 페이드(theme.css `glass-surface-in`) */
  @media (prefers-reduced-motion: no-preference) {
    :global(:root[data-material="glass"]) .codeterm {
      --glass-in-from: translateY(-4px);
      animation-name: glass-surface-in;
    }
    :global(:root[data-material="glass"]) .codeterm > :global(*) {
      animation: glass-content-in 140ms ease-out;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .codeterm {
      animation: none;
    }
  }

  .head {
    padding: 6px var(--space-3) 4px;
    min-width: 0;
  }
  .head b {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }
  .grp {
    margin: 0;
    padding: var(--space-2) var(--space-3) 2px;
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
    grid-template-columns: 16px minmax(0, 1fr);
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
