<script lang="ts" module>
  /** 목록 id — 한 화면에 문서 타일이 여럿이어도 겹치지 않게 */
  let seq = 0;
</script>

<script lang="ts">
  /**
   * 문서 타일의 파일 칸 — 곁 패널과 드롭다운이 함께 쓴다(`DocOutline.svelte` 의 짝).
   * 목록은 제 상자만 민다(`revealScrollTop`) — `scrollIntoView` 는 조상의 넘침 숨김 상자까지 민다.
   */
  import { tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { revealScrollTop } from "$lib/doc-outline";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { DocFilesController, DocFilesItem } from "$lib/doc/files-controller.svelte";

  let {
    fc,
    variant,
  }: {
    fc: DocFilesController;
    variant: "panel" | "drop";
  } = $props();

  const listId = `doc-files-${++seq}`;

  let typing = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const status = $derived(fc.status);
  const scan = $derived(fc.scan);
  const offlineText = $derived(
    status.state === "offline"
      ? t(status.reason === "gone" ? "files.doc.files.gone" : "files.doc.files.offline")
      : "",
  );
  const emptyText = $derived.by(() => {
    if (fc.items.length > 0) return "";
    if (fc.searching) {
      if (scan.state === "scanning") return t("files.doc.files.scanning");
      if (scan.state === "error") return t("files.doc.files.error", { message: scan.message });
      if (scan.state === "ready") return t("files.doc.files.nomatch");
      return "";
    }
    if (status.state === "offline") return "";
    if (status.state === "loading") return t("files.doc.files.loading");
    if (status.state === "error") return t("files.doc.files.error", { message: status.message });
    return t("files.doc.files.empty");
  });
  /** 빈 폴더 문구는 꼬리 줄이 아니라 `..` 줄 바로 아래에 — 꼬리 줄은 목록과 멀어 눈에 들지 않는다 */
  const onlyUp = $derived(
    !fc.searching && status.state === "ready" && fc.items.length === 1 && fc.items[0].kind === "up",
  );

  const notes = $derived(
    [
      offlineText,
      !fc.searching && fc.more > 0 ? t("files.doc.files.more", { n: String(fc.more) }) : "",
      fc.searching && scan.state === "ready" && scan.truncated ? t("files.doc.files.truncated") : "",
      fc.searching && scan.state === "ready" && scan.shallow ? t("files.doc.files.shallow") : "",
    ].filter((s) => s !== ""),
  );
  const errText = $derived(
    (fc.searching ? scan.state === "error" : status.state === "error") && fc.items.length === 0,
  );

  $effect(() => {
    if (variant === "drop" && inputEl) void tick().then(() => inputEl?.focus({ preventScroll: true }));
  });

  // 폴더 · 질의가 바뀌면 컨트롤러가 `listScroll` 을 0 으로 돌려 두므로 이 효과가 맨 위로 민다
  $effect(() => {
    void fc.dir;
    void fc.query;
    const el = listEl;
    if (!el) return;
    el.scrollTop = untrack(() => fc.listScroll);
  });

  /** 키를 눌렀을 때만 부른다 — 효과로 두면 다시 읽기마다 깨어 기억한 스크롤로 선 드롭다운을 첫 줄로 민다 */
  function reveal() {
    const i = fc.active;
    if (!listEl || i < 0) return;
    const row = listEl.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!row) return;
    listEl.scrollTop = revealScrollTop(listEl.scrollTop, listEl.clientHeight, row.offsetTop, row.offsetHeight);
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
    switch (ev.key) {
      case "ArrowDown":
        fc.move(1);
        void tick().then(reveal);
        break;
      case "ArrowUp":
        fc.move(-1);
        void tick().then(reveal);
        break;
      case "Enter":
        fc.enter();
        break;
      case "Escape":
        if (!fc.escape()) {
          if (variant === "drop") fc.escapeDrop();
          else fc.focusBody();
        }
        break;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }

  const optionId = (i: number) => `${listId}-${i}`;
  const iconOf = (row: DocFilesItem) => (row.kind === "up" ? "up" : row.kind === "dir" ? "folder" : "file-text");
</script>

{#snippet body()}
  <input
    bind:this={inputEl}
    value={fc.query}
    oninput={(ev) => fc.setQuery(ev.currentTarget.value)}
    class="menu-input filter"
    type="text"
    spellcheck="false"
    autocomplete="off"
    role="combobox"
    aria-expanded="true"
    aria-controls={listId}
    aria-activedescendant={typing && fc.active >= 0 ? optionId(fc.active) : undefined}
    aria-label={t("files.doc.files.find")}
    aria-disabled={fc.findBlocked ? "true" : undefined}
    readonly={fc.findBlocked}
    placeholder={t(fc.findBlocked ? "files.doc.files.find.root" : "files.doc.files.find")}
    title={fc.findBlocked ? t("files.doc.files.find.root") : undefined}
    {onkeydown}
    onfocus={() => (typing = true)}
    onblur={() => (typing = false)}
  />
  <div class="where" title={fc.dir || fc.dirName}>
    <UiIcon name="folder" size={12} filled />
    <span class="where-name">{fc.dirName}</span>
  </div>
  <ul
    class="list"
    class:blocked={fc.blocked}
    id={listId}
    role="listbox"
    aria-label={t("files.doc.files")}
    aria-disabled={fc.blocked ? "true" : undefined}
    bind:this={listEl}
    onscroll={(ev) => (fc.listScroll = ev.currentTarget.scrollTop)}
  >
    {#each fc.items as row, i (row.kind + "\n" + row.path)}
      {@const current = fc.isCurrent(row)}
      <li
        id={optionId(i)}
        class="row"
        class:up={row.kind === "up"}
        class:dir={row.kind === "dir"}
        class:current
        class:active={typing && i === fc.active}
        role="option"
        tabindex="-1"
        aria-selected={typing && i === fc.active}
        aria-current={current ? "page" : undefined}
        aria-disabled={fc.blocked ? "true" : undefined}
        aria-label={row.kind === "up" ? t("files.doc.files.up") : undefined}
        data-i={i}
        title={row.kind === "up" ? t("files.doc.files.up") : row.path}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={() => fc.pick(row)}
        onkeydown={(ev) => {
          if (ev.key === "Enter") fc.pick(row);
        }}
      >
        <UiIcon name={iconOf(row)} size={14} filled={row.kind === "dir"} />
        <span class="name">{row.name}</span>
        {#if row.sub}<span class="sub">{row.sub}</span>{/if}
      </li>
    {:else}
      {#if emptyText}
        <li class="none" class:err={errText} role="presentation">
          {emptyText}
        </li>
      {/if}
    {/each}
    {#if onlyUp}
      <!-- 고를 줄이 아니다 — ↑↓ 는 `fc.items` 만 돈다 -->
      <li class="none" role="presentation">{t("files.doc.files.empty")}</li>
    {/if}
  </ul>
  {#if notes.length > 0}
    <div class="foot">
      {#each notes as note (note)}
        <p class:warn={note === offlineText}>{note}</p>
      {/each}
    </div>
  {/if}
{/snippet}

{#if variant === "panel"}
  <nav class="files" aria-label={t("files.doc.files")}>{@render body()}</nav>
{:else}
  <div class="files drop">{@render body()}</div>
{/if}

<style>
  .files {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    padding: var(--space-2) var(--space-2) 0;
    box-sizing: border-box;
  }

  /* 높이 상한은 `DocView` 의 드롭다운 상자가 쥔다 */
  .files.drop {
    flex: 1 1 auto;
    height: auto;
    padding: 0;
  }

  .filter {
    flex: 0 0 auto;
    margin-top: 0;
  }

  .where {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--fg-2);
  }

  .where-name {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* `position: relative` 를 빼면 줄의 `offsetTop` 기준이 바뀌어 `reveal` 이 어긋난다 */
  .list {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 3px var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    white-space: nowrap;
    border-radius: var(--radius-sm);
    cursor: pointer;
    user-select: none;
  }

  .row :global(.ui-icon) {
    color: var(--fg-3);
  }

  .row.up {
    color: var(--fg-2);
  }

  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono);
    color: var(--fg-3);
  }

  .row:hover,
  .row.active {
    background: var(--surface-hover);
  }

  .row.current {
    color: var(--fg-1);
    background: var(--accent-soft);
  }

  .row.active {
    outline: 1px solid var(--line);
    outline-offset: -1px;
  }

  .list.blocked .row {
    cursor: default;
    opacity: 0.5;
  }

  .list.blocked .row:hover {
    background: none;
  }

  .none {
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
    word-break: break-word;
  }

  .none.err {
    color: var(--err);
  }

  .foot {
    flex: 0 0 auto;
    padding: var(--space-1) var(--space-2);
    font-size: 11px;
    color: var(--fg-3);
    border-top: 1px solid var(--line);
  }

  .foot p {
    margin: 0;
  }

  .foot p.warn {
    color: var(--warn);
  }
</style>
