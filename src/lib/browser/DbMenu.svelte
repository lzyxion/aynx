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
   * **독 DB 칸의 우클릭 메뉴** (2026-10-12). 상자 모양 · 클래스는 `ProjectMenu` · `HostMenu` 와 **같은 값**이라 독의 메뉴가
   * 한 벌로 보인다(`.menu-backdrop` · `role="menu"` 라 독의 바깥 클릭 판정도 그대로 산다).
   *
   * 대상은 셋이다: 빈 배경(`conn === null` · `folder === null` — 폴더 추가 · 새 DB 연결 · 새로고침) · **폴더**(10-15 — 호스트 독 폴더
   * 메뉴와 같은 항목: 새 DB 연결 · 하위 폴더 추가 · 편집 · 그룹 해제) · 연결 한 줄. 편집 · 복제 · 삭제는 **모든 연결**에 선다(경유든
   * 직접이든 같은 폼 · 삭제는 OS 확인 대화 — 목록이 띄운다).
   *
   * 폴더 추가와 그룹 해제는 `HostMenu` 처럼 **이 상자 안에서** 확정한다(모드 `newfolder` · `dissolve`), 폴더 편집(이름 · 아이콘 · 색)은
   * 목록이 띄우는 모달 한 장(`FolderEditDialog` — 호스트 독과 같은 상자)이다.
   *
   * 항목 핸들러는 **전부 통로 하나**를 지난다 (`$lib/browser/menu-runner` · docs/conventions.md 의 "메뉴를 닫는 코드"):
   * 스냅샷 → 닫기 → 실행. 폼 · 모달을 여는 항목이 많아 백드롭이 남아 있으면 그 클릭을 가로챈다.
   *
   * **여러 줄을 골라 놓고**(Ctrl · Shift · 러버밴드 — 10-15) 줄을 우클릭하면 무엇을 눌렀든 **다중 메뉴** 하나다(호스트 독과 같은 넷:
   * 잘라내기 · 복사 · 붙여넣기 · 제거…). 붙여넣기는 빈 곳 메뉴(최상위) · 폴더 메뉴(그 폴더) · 다중 메뉴(고른 줄의 폴더)에 선다.
   *
   * **AI 권한은 여기 없다**(10-15 — 3b 에서 넣었다가 뺐다): 바꾸는 곳은 연결 편집 폼 · 쿼리 타일 머리줄 칩, 보고 지우는 곳은 설정 › 보안.
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
    /** 메뉴의 대상 — `null` 이면 빈 배경(또는 폴더) 메뉴 */
    conn: DbDockConn | null;
    /** 폴더 메뉴의 대상 경로 — `null` 이면 폴더 메뉴가 아니다 */
    folder?: string | null;
    /** 그 연결의 비밀번호가 볼트에 있다 — "저장된 비밀번호 지우기" 가 선다 */
    saved?: boolean;
    /** 다른 워크스페이스에 열린 곳 — 줄마다 "열린 곳으로 이동 (‹이름›)" */
    elsewhere?: { name: string; location: DbOpenLocation }[];
    x: number;
    y: number;
    onclose: () => void;
    onreload: () => void;
    /** 삭제 — 목록이 OS 확인 대화를 띄운다 */
    onaskdelete: (c: DbDockConn) => void;
    /** 폴더 편집 모달을 연다(이름 · 아이콘 · 색 — 대상 경로는 인자로 온다) */
    oneditfolder: (path: string) => void;
    /** 고른 줄 수 — 2 이상이고 줄을 우클릭했으면 다중 메뉴 */
    selCount?: number;
    /** 앱 안 클립보드에 담긴 것이 있다 — "붙여넣기" 가 선다 */
    hasClip?: boolean;
    /** 다중 메뉴의 붙여넣기 자리 — 고른 줄의 폴더(`Ctrl+V` 와 같은 자리) */
    pasteTarget?: string;
    oncut?: () => void;
    oncopy?: () => void;
    /** `dest` 폴더에 붙여넣는다 (`""` = 최상위) */
    onpaste?: (dest: string) => void;
    /** 고른 것 전부 제거 — 목록이 OS 확인 대화를 띄운다 */
    onremoveselection?: () => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  /** 상자 안 모드 — 메뉴 · 폴더 추가 칸 · 해제 확인 (`HostMenu` 와 같은 모양) */
  let mode = $state<"menu" | "newfolder" | "dissolve">("menu");
  let folderName = $state("");
  let folderError = $state<string | null>(null);
  /** 새 폴더가 생길 부모 — 배경 메뉴면 최상위, 폴더 메뉴면 그 폴더 안 */
  const newFolderParent = $derived(folder ?? "");

  /** 연결 항목 통로 — 대상은 **닫기 전에** 스냅샷한다 */
  const onConn = (fn: (c: DbDockConn) => void | Promise<void>) => runOnMenu(() => conn, onclose, fn);
  /** 폴더 항목 통로 — 대상(경로)은 **인자로** 온다 */
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

  /** 폴더 추가 확정 — 검사(비었나 · `/` · 같은 층 겹침)에 걸리면 상자를 연 채 한 줄로 말한다 */
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

  /** 그룹 해제 확정 — 안의 연결은 최상위로(지우지 않는다) */
  function submitDissolve() {
    const path = folder;
    if (path === null) return;
    onclose();
    void dissolveDbFolder(path);
  }

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게 (`ProjectMenu` 와 같은 클램프)
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

  /** 메뉴 안 키보드 — Escape 로 닫고, ↑/↓ 로 항목 사이를 오간다 */
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
    <!-- 폴더 추가 — 배경 메뉴("폴더 추가…") · 폴더 메뉴("하위 폴더 추가…")가 같은 칸이다(`HostMenu` 와 같은 꼴) -->
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
    <!-- 다중 선택 메뉴 — 무엇을 우클릭했든 같다(호스트 독의 다중 메뉴와 같은 넷 · "전부에 대해 뜻이 있는 것" 만) -->
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
    <!-- 무리 순서는 호스트 · 파일 타일 메뉴와 같다: 만들기 → 붙여넣기 → 편집 → 위험한 것(그룹 해제)은 맨 아래 혼자 -->
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
      <!-- 빈 곳의 붙여넣기 — 최상위가 대상(아무것도 안 고른 채로 붙일 수 있어야 한다) -->
      <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="paste" onclick={() => runAfterClose(onclose, () => onpaste(""))}>
        {t("files.hostmenu.paste")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" data-db-action="refresh" onclick={() => runAfterClose(onclose, onreload)}>
      {t("files.hostmenu.refresh")}
    </button>
  {:else}
    <!-- 무리 순서는 호스트 줄과 같다: 열기 → 편집 · 복제 → 저장된 비밀번호 → 위험한 것(삭제)은 맨 아래 혼자 -->
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
  /* 바깥 클릭을 받아 닫는 투명 백드롭 — `ProjectMenu` · `HostMenu` 와 같은 값 */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /* 상자 · 줄 · 머리글 · 구분선은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`) — 여기는 자리와 폭뿐이다 */
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

  /* 폴더 추가 · 해제 확인 — `HostMenu` 와 같은 값 */
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
