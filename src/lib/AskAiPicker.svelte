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

  /**
   * **블록을 AI 타일에 넘기기 — 고르기 상자** (docs/log/2026-09-28-ask-ai-block.md · 목업 경우 2·3).
   *
   * 받을 AI 타일이 곧장 정해지지 않을 때(이 탭에 여럿 · 다른 탭에만 있음 · 없음) 뜬다. 상태는
   * `app/ask-ai.svelte.ts` 에 있고 이 컴포넌트는 `+page` 에 늘 마운트돼 그 상태가 있을 때만 그린다.
   *
   * - 줄 순서: **이 탭** → **다른 탭** → 새로 열기(기본 CLI 가 위). 마지막에 포커스했던 AI 타일이 골라진 채 뜬다.
   * - "답 쓰는 중" 은 표시만 한다(막지 않는다).
   * - 키: ↑↓ · Home/End 로 고르고 Enter 로 넘긴다. **Esc 는 여기서 끊는다**(뒤 화면의 Escape 사슬로 새지
   *   않게 — 다른 떠 있는 상자들과 같은 규칙) — 닫고 포커스를 원본 셸 타일로 돌려준다.
   * - 줄을 고르면 메뉴 통로(`runOnMenu`)로 **값을 스냅샷하고 닫은 뒤** 실행한다(docs/conventions.md).
   * - 바깥을 누르면 닫는다(포커스는 누른 자리의 것). 가림막이 내려와도 닫는다.
   */

  const picker = $derived(askPicker());

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

  /** 자리 — 기준점 아래, 화면 밖이면 기준점 위로 뒤집고 좌우는 안쪽으로 민다 */
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
   * 자리를 잡은 뒤 포커스 — 숨은(측정 전) 상자는 포커스를 받지 않는다 (ShellMenu 와 같은 이유).
   *
   * `tick` 이 아니라 **rAF** 인 까닭(`CodeTermPicker` 와 같다): 활성이 아닌 타일의 단추(터미널의 블록 단추 · 쿼리 타일의 [AI에게 묻기])를
   * 누르면 pointerdown 이 그 타일을 활성으로 바꾸고, 그 활성화가 rAF 안에서 포커스를 준다(터미널 = `Terminal` 의 보임 효과의
   * `term.focus()` · 세션 없는 타일 = `routeTileFocus`). 그 rAF 가 click 보다 늦게 돌면 상자의 포커스를 빼앗는다 — 이 rAF 는 click 뒤에
   * 걸리므로 그 뒤에 돈다.
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
      closeAskPicker("none");
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });

  /** 가림막이 내려오면 닫는다 */
  $effect(() => {
    if (picker && veilVisible()) closeAskPicker("none");
  });

  /** 줄 하나를 고른다 — 스냅샷 → 닫기 → 실행 */
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

  /** 줄 앞 무리 머리 — 무리가 바뀌는 자리에서만 */
  function groupLabel(rows: readonly AskRow[], i: number, hasTiles: boolean): string | null {
    const row = rows[i];
    const prev = i > 0 ? rows[i - 1] : null;
    if (row.kind === "tile") {
      if (prev && prev.kind === "tile" && prev.group === row.group) return null;
      return row.group === "here" ? t("pane.askai.picker.here") : t("pane.askai.picker.other");
    }
    if (row.kind === "sideChat") return null;
    if (prev && prev.kind === "new") return null;
    // 사이드 채팅 줄 뒤의 새로 열기 줄 — 타일이 없을 때만 "열려 있는 AI 타일이 없습니다"
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
        <!-- 사이드 채팅(v2 5단계) — 입력 칸에 채우기만 · 그 타일을 연결 칩에 -->
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
  /* 상자 — 모양은 전역 메뉴 한 벌(`.menu-surface`). 셸 메뉴·알림 상자와 같은 층(121)이다. */
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
  /* 글래스 — 메뉴의 `opacity` 대신 판 색 · 그림자와 내용만 페이드(theme.css `glass-surface-in` — 움직이는 동안에도 흐림이 선다) */
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
    border-radius: var(--radius-row); /* 한 줄짜리 줄은 알약(theme.css `--radius-row`) */
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
