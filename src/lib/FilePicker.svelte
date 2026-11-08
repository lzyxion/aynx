<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import Keys from "$lib/Keys.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { placeDefaultPalette, type CanvasRect } from "$lib/launcher";
  import { comboFromEvent, effectiveCombo, type Overrides } from "$lib/keybindings";
  import { filterFiles, type PickerFile } from "$lib/file-picker";
  import { moveStartSelection } from "$lib/project-start";
  import {
    closeFilePicker,
    filePickerLoad,
    filePickerWhere,
    pickFile,
  } from "$lib/app/file-picker.svelte.js";

  /**
   * **팔레트 "파일 열기…" — 고르는 목록** (docs/log/2026-09-27-doc-tile.md "A — 여는 길").
   *
   * 팔레트와 **같은 자리 · 같은 모양**으로 뜬다(`placeDefaultPalette` · 불투명한 뜬 면) — "이 폴더의 지난 대화"
   * (`FolderConversations.svelte`)와 같은 까닭으로 팔레트 안의 한 모드가 아니다: 팔레트는 아무것도 읽지 않는 화면이고
   * 이쪽은 디스크를 훑고(`list_text_files` · SFTP) 연 타일이라는 자리를 쥔다. 거르기는 팔레트와 같은 부분수열
   * (`filterFiles` — `fuzzyMatch`).
   *
   * 키: ↑↓ 고르기 · Enter 열기(미리 보기 규칙 — 연 타일 곁) · Esc 닫기 · 같은 단축키로 닫기.
   */
  let {
    measureCanvas,
    keybindings = {},
  }: {
    measureCanvas?: () => CanvasRect | null;
    keybindings?: Overrides;
  } = $props();

  let query = $state("");
  let sel = $state(0);

  const load = $derived(filePickerLoad());
  const where = $derived(filePickerWhere());
  const rows = $derived(load.state === "ready" ? filterFiles(load.files, query) : []);
  const selIndex = $derived(rows.length === 0 ? -1 : Math.min(Math.max(0, sel), rows.length - 1));
  const shownRoot = $derived(where ? (where.remote ? `${where.alias}:${where.root}` : where.root) : "");

  let vw = $state(0);
  let vh = $state(0);
  const placed = $derived.by(() => {
    if (vw <= 0 || vh <= 0) return null;
    const canvas = measureCanvas?.() ?? null;
    return canvas ? placeDefaultPalette(canvas, vw, vh) : null;
  });

  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  $effect(() => {
    inputEl?.focus();
  });

  $effect(() => {
    const i = selIndex;
    const el = listEl;
    if (!el || i < 0) return;
    void tick().then(() => el.querySelector<HTMLElement>(`[data-fp-row][data-sel="true"]`)?.scrollIntoView({ block: "nearest" }));
  });

  /** 상대 경로 → (폴더 부분, 이름) — 이름을 앞세워 그린다 */
  function split(rel: string): { dir: string; name: string } {
    const i = rel.lastIndexOf("/");
    return i < 0 ? { dir: "", name: rel } : { dir: rel.slice(0, i), name: rel.slice(i + 1) };
  }

  function onKeydown(ev: KeyboardEvent): void {
    const combo = comboFromEvent(ev);
    if (combo !== null && combo === effectiveCombo("open-file", keybindings)) {
      ev.preventDefault();
      ev.stopPropagation();
      closeFilePicker();
      return;
    }
    if (ev.isComposing) return;
    const plain = !ev.ctrlKey && !ev.altKey && !ev.metaKey;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeFilePicker();
    } else if (plain && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault();
      ev.stopPropagation();
      sel = moveStartSelection(rows.length, selIndex, ev.key === "ArrowUp" ? "up" : "down");
    } else if (plain && !ev.shiftKey && ev.key === "Enter") {
      ev.preventDefault();
      ev.stopPropagation();
      const f = selIndex >= 0 ? rows[selIndex] : null;
      if (f) pickFile(f);
    }
  }

  function onRowClick(f: PickerFile, i: number): void {
    sel = i;
    pickFile(f);
  }
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  class="overlay"
  class:anchored={placed !== null}
  role="presentation"
  onmousedown={(ev) => {
    if (ev.target === ev.currentTarget) closeFilePicker();
  }}
>
  <div
    class="picker"
    style={placed
      ? `left:${placed.left}px;top:${placed.top}px;width:${placed.width}px;max-height:${placed.maxHeight}px`
      : undefined}
    role="dialog"
    aria-modal="true"
    aria-label={t("app.filePicker.aria")}
    tabindex="-1"
    data-file-picker
    data-state={load.state}
    onkeydown={onKeydown}
  >
    <div class="search">
      <UiIcon name="file-text" size={16} />
      <input
        class="q"
        type="text"
        bind:this={inputEl}
        bind:value={query}
        oninput={() => (sel = 0)}
        placeholder={t("app.filePicker.placeholder")}
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        aria-label={t("app.filePicker.placeholder")}
        data-fp-filter
      />
      <Keys combo="Esc" />
    </div>

    {#if shownRoot}
      <div class="where" title={shownRoot} data-fp-root><span dir="ltr">{shownRoot}</span></div>
    {/if}

    <div class="rows" bind:this={listEl} role="listbox" aria-label={t("app.filePicker.aria")}>
      {#if load.state === "loading"}
        <p class="quiet" data-fp-loading>{t("app.filePicker.loading")}</p>
      {:else if load.state === "error"}
        <p class="quiet err" data-fp-error>{load.message}</p>
      {:else if rows.length === 0}
        <p class="quiet" data-fp-empty>
          {query.trim() === "" ? t("app.filePicker.empty") : t("app.filePicker.emptyFilter")}
        </p>
      {:else}
        {#each rows as f, i (f.path)}
          {@const parts = split(f.rel)}
          <button
            type="button"
            class="row"
            class:sel={i === selIndex}
            role="option"
            aria-selected={i === selIndex}
            tabindex="-1"
            title={f.path}
            data-fp-row={f.rel}
            data-sel={i === selIndex ? "true" : "false"}
            onmousedown={(ev) => ev.preventDefault()}
            onmouseenter={() => (sel = i)}
            onclick={() => onRowClick(f, i)}
          >
            <UiIcon name="file-text" size={14} />
            <span class="name">{parts.name}</span>
            {#if parts.dir}<span class="dir">{parts.dir}</span>{/if}
          </button>
        {/each}
      {/if}
    </div>

    <div class="foot" data-fp-keys>
      <span class="grp primary"><Keys combo="Enter" />{t("app.filePicker.keys.open")}</span>
      <span class="grp"><Keys combo="↑↓" />{t("app.filePicker.keys.move")}</span>
      {#if where?.remote}
        <span class="grp note" data-fp-shallow>{t("app.filePicker.remoteShallow")}</span>
      {/if}
      {#if load.state === "ready" && load.truncated}
        <span class="grp note warn" data-fp-truncated>{t("app.filePicker.truncated")}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  /* 팔레트 · 지난 대화 목록과 같은 덮개 · 같은 층 — 셋은 동시에 뜨지 않는다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 12vh var(--space-4) var(--space-4);
    background: var(--bg-overlay);
  }

  .overlay.anchored {
    display: block;
    padding: 0;
  }

  .overlay.anchored .picker {
    position: absolute;
    max-width: none;
  }

  .picker {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: var(--palette-w);
    max-height: 70vh;
    overflow: hidden;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
  }

  .search {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 48px;
    padding: 0 var(--space-4);
    color: var(--fg-3);
    border-bottom: 1px solid var(--line);
  }

  .q {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    outline: none;
  }

  .q::placeholder {
    color: var(--fg-3);
  }

  /* 뿌리 — 넘치면 앞을 자른다(이름 쪽 끝이 남는다 · 문서 툴바의 경로와 같은 모양) */
  .where {
    flex: 0 0 auto;
    padding: var(--space-2) var(--space-4) 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    direction: rtl;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .rows {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-1) var(--space-2) var(--space-2);
  }

  .quiet {
    margin: 0;
    padding: var(--space-6) var(--space-2);
    font-size: var(--t-sm);
    text-align: center;
    color: var(--fg-3);
    word-break: break-word;
  }

  .quiet.err {
    color: var(--err);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    padding: var(--space-2);
    font: inherit;
    font-size: var(--t-sm);
    color: var(--fg-2);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .row.sel {
    background: var(--accent-soft);
  }

  .name {
    flex: 0 0 auto;
    max-width: 60%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-1);
  }

  .dir {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .foot {
    box-sizing: border-box;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: 36px;
    padding: var(--space-1) var(--space-4);
    font-size: var(--t-xs);
    color: var(--fg-3);
    border-top: 1px solid var(--line);
    flex-wrap: wrap;
  }

  .foot .grp {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
  }

  .foot .primary {
    color: var(--fg-2);
  }

  .foot .warn {
    color: var(--warn);
  }
</style>
