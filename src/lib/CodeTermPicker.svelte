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

  /**
   * **문서 코드 블록을 셸 타일에 넣기 — 고르기 상자** (`app/code-to-term.svelte.ts`).
   *
   * [AI에게 묻기] 의 고르기 상자(`AskAiPicker.svelte`)와 **같은 결의 형제**다 — 키 · 닫힘 · 포커스 복귀 · 자리 잡기 · 모양을 그대로
   * 따르되 줄이 셸 타일이다. 받을 셸 타일이 곧장 정해지지 않을 때(이 탭에 여럿 · 다른 탭에만 있음 · 없음) 뜬다. 상태는
   * `app/code-to-term.svelte.ts` 에 있고 이 컴포넌트는 `+page` 에 늘 마운트돼 그 상태가 있을 때만 그린다.
   *
   * - 줄 순서: **이 탭** → **다른 탭** → 새 터미널 열기. 마지막에 포커스했던 셸 타일이 골라진 채 뜬다.
   * - 원격(SSH) 셸은 줄에 **호스트 이름**을 보인다 — 어느 서버에 넣는지 보고 고른다. 로컬은 셸 이름.
   * - "명령 도는 중" 은 표시만 한다(막지 않는다).
   * - 키: ↑↓ · Home/End 로 고르고 Enter 로 넣는다. **Esc 는 여기서 끊는다**(뒤 화면의 Escape 사슬로 새지 않게) — 닫고 포커스를
   *   원래 문서 타일(누른 단추)로 돌려준다.
   * - 줄을 고르면 메뉴 통로(`runOnMenu`)로 **값을 스냅샷하고 닫은 뒤** 실행한다(docs/conventions.md).
   * - 바깥을 누르면 닫는다(포커스는 누른 자리의 것). 가림막이 내려와도 닫는다.
   */

  const picker = $derived(codeTermPicker());

  let el = $state<HTMLElement | null>(null);
  let sel = $state(0);
  let pos = $state<{ left: number; top: number } | null>(null);

  /** 상자가 새로 뜨면 골라진 줄 · 자리를 처음부터 */
  $effect(() => {
    const p = picker;
    if (!p) return;
    sel = p.selected;
    pos = null;
  });

  /** 자리 — 기준점 아래, 화면 밖이면 기준점 위로 뒤집고 좌우는 안쪽으로 민다(`AskAiPicker` 와 같은 규칙) */
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
   * 자리를 잡은 뒤 포커스 — 숨은(측정 전) 상자는 포커스를 받지 않는다.
   *
   * `tick` 이 아니라 **rAF** 인 까닭: 활성이 아닌 문서 타일의 단추를 누르면 pointerdown 이 그 타일을 활성으로 바꾸고, `PaneHost` 의
   * `routeTileFocus` 가 rAF 안에서 문서 타일 뿌리(`div.doc` — `[data-tile-focus]`)에 포커스를 준다. 그 rAF 가 click 보다 늦게 돌면(빠른
   * 클릭 · 바쁜 프레임) 상자는 이미 포커스를 받았고 상자는 그 타일 밖이라 그대로 빼앗긴다. 이 rAF 는 click 뒤에 걸리므로 같은 프레임이면
   * 그 뒤에 돌고, 저쪽이 먼저 돌았으면(포커스가 단추 — 타일 안이라 비켜났다) 그대로 상자가 받는다.
   */
  $effect(() => {
    const node = el;
    if (!node || pos === null) return;
    const raf = requestAnimationFrame(() => node.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  });

  /** 바깥 클릭으로 닫는다 */
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

  /** 가림막이 내려오면 닫는다 */
  $effect(() => {
    if (picker && veilVisible()) closeCodeTermPicker("none");
  });

  /** 줄 하나를 고른다 — 스냅샷 → 닫기 → 실행 */
  function choose(i: number): void {
    runOnMenu(
      () => {
        const p = codeTermPicker();
        const row = p?.rows[i];
        return p && row ? { row, sourcePaneId: p.sourcePaneId, code: p.code } : null;
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

  /** 줄 앞 무리 머리 — 무리가 바뀌는 자리에서만 */
  function groupLabel(rows: readonly TermRow[], i: number, hasTiles: boolean): string | null {
    const row = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;
    if (row.kind === "tile") {
      if (prev && prev.kind === "tile" && prev.group === row.group) return null;
      return row.group === "here" ? t("files.doc.codeterm.picker.here") : t("files.doc.codeterm.picker.other");
    }
    return hasTiles ? null : t("files.doc.codeterm.picker.none");
  }

  /** 줄 이름 — 원격은 호스트 이름이 이름과 다르면 덧붙이고, 다른 탭 줄은 탭 이름을 붙인다 */
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
          <span class="name">{t("files.doc.codeterm.picker.new")}</span>
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
  /* 상자 — 모양은 전역 메뉴 한 벌(`.menu-surface`) · `AskAiPicker` 와 같은 층(121) · 같은 치수 */
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
  /* 글래스 — 메뉴의 `opacity` 대신 판 색 · 그림자와 내용만 페이드(theme.css `glass-surface-in`) */
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
  /* 강조색이 서는 자리 — 골라진 줄 하나 */
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
