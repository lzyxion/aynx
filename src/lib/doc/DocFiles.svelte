<script lang="ts" module>
  /** 목록 id — 한 화면에 문서 타일이 여럿이어도 겹치지 않게 */
  let seq = 0;
</script>

<script lang="ts">
  /**
   * **문서 타일의 파일 칸** — 찾기 칸 + 지금 폴더 줄 + 목록(`..` · 폴더 · 파일, 찾는 중이면 하위 폴더까지 찾은 결과) +
   * 작은 꼬리 줄. 넓은 타일의 왼쪽 곁 패널과 좁은 타일의 드롭다운이 이 한 벌을 쓴다(`variant` — `DocOutline.svelte` 의 짝).
   * 상태 · 동작은 `doc/files-controller.svelte.ts` 하나를 프롭으로 받고, 놓는 자리 · 여닫기 · 다시 읽기는 `DocView` 몫이다.
   *
   * 키보드는 칸 하나에서 한다(콤보박스 모양): ↑↓ 로 고를 줄을 옮기고 Enter 로 폴더는 들어가고 파일은 고른다. Esc 는
   * 질의가 있으면 비우고, 없으면 패널은 본문으로 · 드롭다운은 닫고 단추로 돌아간다. 폴더 줄을 누르면 그 자리에서 들어간다
   * (드롭다운도 닫지 않는다). 파일 줄은 컨트롤러의 `pick` 이 `onpick` 으로 올린다(드롭다운의 닫기 통로는 `DocView` 가 감싼다).
   *
   * 목록 상자는 **제 상자만** 민다(`revealScrollTop`) — `scrollIntoView` 는 조상의 넘침 숨김 상자까지 민다(`DocOutline` 과 같은 까닭).
   * 스크롤은 컨트롤러가 기억한다(`fc.listScroll`) — 이 칸은 설 때마다 그 값으로 서고 스크롤마다 적는다. 그래서 드롭다운을 닫았다 열어도,
   * 이 타일에서 문서를 바꿔 새 칸이 서도 그 자리다(컨트롤러 머리말). 고른 줄 드러내기는 ↑↓ 를 눌렀을 때만 민다.
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
    /** 상태 · 동작 — `createDocFiles` */
    fc: DocFilesController;
    /** 곁 패널 · 드롭다운 */
    variant: "panel" | "drop";
  } = $props();

  const listId = `doc-files-${++seq}`;

  /** 칸에 포커스가 있다 — 그때만 고른 줄을 칠한다 */
  let typing = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const status = $derived(fc.status);
  const scan = $derived(fc.scan);
  /** 막힌 까닭 — 끊김 · 원본 없음 */
  const offlineText = $derived(
    status.state === "offline"
      ? t(status.reason === "gone" ? "files.doc.files.gone" : "files.doc.files.offline")
      : "",
  );
  /** 목록 자리에 서는 한 줄(줄이 없을 때) */
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
  /**
   * `..` 하나뿐인 폴더 — 빈 폴더 문구를 목록 안 `..` 줄 바로 아래에(줄이 아예 없을 때의 `emptyText` 와 같은 흐린 줄). 꼬리 줄에 두면
   * 목록과 멀어 눈에 들지 않았다(2026-11-19 사용자)
   */
  const onlyUp = $derived(
    !fc.searching && status.state === "ready" && fc.items.length === 1 && fc.items[0].kind === "up",
  );

  /** 꼬리 줄 — 막힌 까닭 · 상한 · 잘림 · 원격 두 층 */
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

  // 드롭다운은 열리자마자 칸에 포커스 — 바로 쳐서 찾는다
  $effect(() => {
    if (variant === "drop" && inputEl) void tick().then(() => inputEl?.focus({ preventScroll: true }));
  });

  // 목록 상자는 설 때마다 컨트롤러가 기억하는 스크롤로 선다 — 곁 패널 · 드롭다운 · 새 타일의 첫 그리기 · 드롭다운을 다시 열 때 모두.
  // 폴더 · 질의가 바뀌면 컨트롤러가 그 값을 0 으로 돌려 두므로 같은 효과가 맨 위로 민다
  $effect(() => {
    void fc.dir;
    void fc.query;
    const el = listEl;
    if (!el) return;
    el.scrollTop = untrack(() => fc.listScroll);
  });

  /**
   * ↑↓ 로 고른 줄까지 목록 상자를 민다 — 키를 눌렀을 때만(효과로 두면 다시 읽기가 `items` 를 새 배열로 바꿀 때도 깨어, 넘겨받은 스크롤로 막
   * 선 드롭다운을 첫 줄로 밀었다 — 열리자마자 칸에 포커스가 가 "치는 중" 이므로)
   */
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
      <!-- 줄 클릭은 마우스의 길 — 키보드는 위 칸의 ↑↓ · Enter 가 같은 일을 한다(콤보박스) -->
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

  /* 드롭다운 — 상자(`DocView` 의 드롭다운 상자)가 높이 상한을 쥐고, 목록이 그 안에서 민다 */
  .files.drop {
    flex: 1 1 auto;
    height: auto;
    padding: 0;
  }

  .filter {
    flex: 0 0 auto;
    margin-top: 0;
  }

  /* 지금 폴더 — 넘치면 끝을 자른다(전체 경로는 툴팁) */
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

  /* 목록 상자 — 길면 이것만 민다. `position: relative` 라 줄의 `offsetTop` 이 이 상자 기준이다 */
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

  /* 그림은 흐리게 — 이름이 먼저 눈에 든다 */
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

  /* 찾기 결과의 상대 폴더 — 팔레트 "파일 열기…" 의 줄과 같은 흐린 꼬리 */
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

  /* 지금 문서 — 앱 목록의 고른 줄(`.item.selected`)과 같은 강조 면 하나 */
  .row.current {
    color: var(--fg-1);
    background: var(--accent-soft);
  }

  .row.active {
    outline: 1px solid var(--line);
    outline-offset: -1px;
  }

  /* 끊김 · 원본 없음 — 마지막 목록은 남기되 누르지 못한다 */
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
