<script lang="ts">
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { DbDockConn, DbOpenLocation } from "$lib/db-dock";
  import { revealProjectLocation } from "$lib/app/project-locations.svelte.js";
  import {
    duplicateDbConn,
    editDbConn,
    forgetDbConnPassword,
    newDbConn,
    newDbConnIn,
    openDbConn,
    openDbConnNew,
  } from "$lib/app/db-dock.svelte.js";
  import { createDbFolder, dbNewFolderProblem, dissolveDbFolder } from "$lib/app/db-folders.svelte.js";
  import { lastSegment } from "$lib/host-folders";

  /**
   * 독 DB 칸의 우클릭 메뉴. `.menu-backdrop` · `role="menu"` 라야 독의 바깥 클릭 판정이 산다.
   * 항목은 전부 통로 하나(`menu-runner` — 스냅샷 → 닫기 → 실행)를 지난다 — 백드롭이 남아 있으면 폼 · 모달의 클릭을 가로챈다(docs/conventions.md "메뉴를 닫는 코드").
   * AI 권한 항목은 두지 않는다 — 바꾸는 곳은 연결 편집 폼 · 쿼리 타일 머리줄 칩, 보고 지우는 곳은 설정 › 보안.
   */
  let {
    conn,
    saved = false,
    elsewhere = [],
    folder = null,
    x,
    y,
    onclose,
    onreload,
    onaskdelete,
    oneditfolder,
    selCount = 0,
    hasClip = false,
    pasteTarget = "",
    oncut = () => {},
    oncopy = () => {},
    onpaste = () => {},
    onremoveselection = () => {},
  }: {
    /** `null` 이면 빈 배경(또는 폴더) 메뉴 */
    conn: DbDockConn | null;
    folder?: string | null;
    saved?: boolean;
    elsewhere?: { name: string; location: DbOpenLocation }[];
    x: number;
    y: number;
    onclose: () => void;
    onreload: () => void;
    onaskdelete: (c: DbDockConn) => void;
    oneditfolder: (path: string) => void;
    selCount?: number;
    hasClip?: boolean;
    pasteTarget?: string;
    oncut?: () => void;
    oncopy?: () => void;
    /** `""` = 최상위 */
    onpaste?: (dest: string) => void;
    onremoveselection?: () => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let mode = $state<"menu" | "newfolder" | "dissolve">("menu");
  let folderName = $state("");
  let folderError = $state<string | null>(null);
  const newFolderParent = $derived(folder ?? "");

  const onConn = (fn: (c: DbDockConn) => void | Promise<void>) => runOnMenu(() => conn, onclose, fn);
  const onFolder = (fn: (path: string) => void | Promise<void>) => runOnMenu(() => folder, onclose, fn);

  $effect(() => {
    if (mode === "newfolder") {
      inputEl?.focus();
      inputEl?.select();
    } else menuEl?.focus();
  });

  function startNewFolder() {
    folderName = "";
    folderError = null;
    mode = "newfolder";
  }

  function submitNewFolder() {
    const parent = newFolderParent;
    const name = folderName;
    const problem = dbNewFolderProblem(parent, name);
    if (problem) {
      folderError = problem;
      return;
    }
    onclose();
    void createDbFolder(parent, name);
  }

  function submitDissolve() {
    const path = folder;
    if (path === null) return;
    onclose();
    void dissolveDbFolder(path);
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

  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    if (mode !== "menu") return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      const items = menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }
</script>

<button
  type="button"
  class="menu-backdrop"
  tabindex="-1"
  aria-label={t("files.hostmenu.close.aria")}
  onclick={onclose}
  oncontextmenu={(ev) => {
    ev.preventDefault();
    onclose();
  }}
></button>
<div
  class="ctx-menu menu-surface"
  role="menu"
  tabindex="-1"
  aria-label={t("app.db.dock.menu.aria")}
  data-db-menu={conn ? conn.key : folder !== null ? `f:${folder}` : "bg"}
  bind:this={menuEl}
  onkeydown={menuKeydown}
>
  {#if mode === "newfolder"}
    <div class="ctx-title menu-title" title={newFolderParent || t("files.host.top")}>
      {t("files.hostmenu.newfolder.title", { path: newFolderParent === "" ? t("files.host.top") : newFolderParent })}
    </div>
    <input
      class="ctx-input menu-input"
      data-inline-edit
      data-db-newfolder
      bind:value={folderName}
      bind:this={inputEl}
      spellcheck="false"
      autocomplete="off"
      placeholder={t("files.hostmenu.newfolder.placeholder")}
      oninput={() => (folderError = null)}
      onkeydown={(ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitNewFolder();
        }
      }}
    />
    {#if folderError}
      <div class="ctx-error">{folderError}</div>
    {/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" onclick={submitNewFolder}>
        {t("files.hostmenu.newfolder.submit")}
      </button>
    </div>
  {:else if mode === "dissolve"}
    <div class="ctx-confirm">{t("app.db.dock.folder.dissolve.confirm")}</div>
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
      <button type="button" class="ctx-btn danger btn btn-sm" data-db-dissolve-submit onclick={submitDissolve}>
        {t("files.hostmenu.dissolve.submit")}
      </button>
    </div>
  {:else if selCount >= 2 && (conn !== null || folder !== null)}
    <div class="ctx-title menu-title">{t("files.hostmenu.selected", { count: selCount })}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="cut" onclick={() => runAfterClose(onclose, oncut)}>
      {t("files.hostmenu.cut")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="copy" onclick={() => runAfterClose(onclose, oncopy)}>
      {t("files.hostmenu.copy")}
    </button>
    {#if hasClip}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-db-action="paste"
        onclick={() => runOnMenu(() => pasteTarget, onclose, onpaste)}
      >
        {t("files.hostmenu.paste")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row danger"
      role="menuitem"
      data-db-action="remove-selection"
      onclick={() => runAfterClose(onclose, onremoveselection)}
    >
      {t("files.hostmenu.removeselection")}
    </button>
  {:else if folder !== null}
    <div class="ctx-title menu-title" title={folder}>{lastSegment(folder)}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="folder-new" onclick={() => onFolder(newDbConnIn)}>
      {t("app.query.picker.new")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="folder-sub" onclick={startNewFolder}>
      {t("files.hostmenu.addsubfolder")}
    </button>
    {#if hasClip}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="folder-paste" onclick={() => onFolder(onpaste)}>
        {t("files.hostmenu.paste")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="folder-edit" onclick={() => onFolder(oneditfolder)}>
      {t("files.hostmenu.edit")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row danger"
      role="menuitem"
      data-db-action="folder-dissolve"
      onclick={() => (mode = "dissolve")}
    >
      {t("files.hostmenu.dissolve")}
    </button>
  {:else if conn === null}
    <div class="ctx-title menu-title">{t("app.dock.title.db")}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="new" onclick={() => runAfterClose(onclose, newDbConn)}>
      {t("app.query.picker.new")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="folder-add" onclick={startNewFolder}>
      {t("files.hostmenu.addfolder")}
    </button>
    {#if hasClip}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="paste" onclick={() => runAfterClose(onclose, () => onpaste(""))}>
        {t("files.hostmenu.paste")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="refresh" onclick={() => runAfterClose(onclose, onreload)}>
      {t("files.hostmenu.refresh")}
    </button>
  {:else}
    <div class="ctx-title menu-title" title={conn.title}>{conn.name}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="open" onclick={() => onConn(openDbConn)}>
      {t("app.db.dock.menu.open")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="openNew" onclick={() => onConn(openDbConnNew)}>
      {t("app.db.dock.menu.openNew")}
    </button>
    {#each elsewhere as target (target.location.workspaceId)}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-db-action="revealOpen"
        onclick={() => runOnMenu(() => target.location, onclose, revealProjectLocation)}
      >
        {t("app.db.dock.menu.revealOpen", { name: target.name })}
      </button>
    {/each}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="edit" onclick={() => onConn(editDbConn)}>
      {t("app.db.dock.menu.edit")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="duplicate" onclick={() => onConn(duplicateDbConn)}>
      {t("app.db.dock.menu.duplicate")}
    </button>
    {#if saved}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="forget" onclick={() => onConn(forgetDbConnPassword)}>
        {t("app.db.dock.menu.forget")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row danger" role="menuitem" data-db-action="delete" onclick={() => onConn(onaskdelete)}>
      {t("app.db.dock.menu.delete")}
    </button>
  {/if}
</div>

<style>
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 160px;
    max-width: 240px;
  }

  .menu-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctx-error {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
  }

  .ctx-confirm {
    padding: var(--space-1) var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    line-height: 1.45;
    color: var(--fg-1);
  }

  .ctx-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) 2px;
  }

  .ctx-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .ctx-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
