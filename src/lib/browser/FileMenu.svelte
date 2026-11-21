<script lang="ts">
  import { baseNameOf, LOCAL_KEY, type FsBackend } from "$lib/fs-backend";
  import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
  import { imageMime } from "$lib/browser/preview";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import type { InlineEdit } from "$lib/browser/inline-edit.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import { deviceDownloadRow, type DeviceDownloadRow } from "$lib/browser/device-download";
  import type { Key } from "$lib/i18n/keys";

  /**
   * 파일 타일의 우클릭 메뉴. 항목은 전부 통로 하나(`menu-runner` — 스냅샷 → 닫기 → 실행)를 지난다 —
   * `entry` 는 프롭이라 닫는 순간(부모가 `menu = null`) 사라지고, 닫고 나서 읽으면 그 자리에서 죽는다.
   */
  let {
    menu,
    mode,
    edit,
    backend,
    cwd,
    newFolderDir = cwd,
    tree = false,
    atRoot,
    isLocal,
    selCount,
    selPaths,
    selHasFolder,
    busy,
    hasClip,
    removeTargets,
    /** 백엔드가 "비어 있지 않다" 로 거절한 뒤에만 참 */
    confirmRecursive,
    sourcePaneId,
    onclose,
    oncut,
    oncopy,
    onpaste,
    ondownload,
    onexport,
    ontodevice,
    onopenentry,
    onpreview,
    oneditentry,
    onopenexternal,
    onreveal,
    oncopypath,
    onstartrename,
    onstartremove,
    onstartnewfolder,
    onstartnewfile,
    onpickupload,
    onimportfolders,
    onrevealhere,
    onrefresh,
    oncdhere,
    onsubmitrename,
    onsubmitnewfolder,
    onsubmitnewfile,
    onsubmitremove,
  }: {
    menu: { x: number; y: number; entry: SftpEntry | null };
    mode: "menu" | "rename" | "newfolder" | "newfile" | "confirm";
    edit: InlineEdit;
    backend: FsBackend;
    cwd: string;
    newFolderDir?: string;
    tree?: boolean;
    atRoot: boolean;
    isLocal: boolean;
    selCount: number;
    selPaths: readonly string[];
    /** 폴더를 가리키는 링크도 포함 */
    selHasFolder: boolean;
    busy: boolean;
    hasClip: boolean;
    removeTargets: readonly string[];
    confirmRecursive: boolean;
    sourcePaneId: string | null;
    onclose: () => void;
    oncut: () => void;
    oncopy: () => void;
    onpaste: () => void;
    ondownload: (paths: readonly string[]) => void;
    onexport: (paths: readonly string[]) => void;
    ontodevice: (paths: readonly string[]) => void;
    onopenentry: (entry: SftpEntry) => void;
    onpreview?: (entry: SftpEntry) => void;
    oneditentry: (entry: SftpEntry) => void;
    onopenexternal: (entry: SftpEntry) => void;
    onreveal: (entry: SftpEntry) => void;
    oncopypath: (entry: SftpEntry) => void;
    onstartrename: () => void;
    onstartremove: () => void;
    onstartnewfolder: () => void;
    onstartnewfile: () => void;
    onpickupload: () => void;
    onimportfolders: () => void;
    onrevealhere: () => void;
    onrefresh: () => void;
    oncdhere: () => void;
    onsubmitrename: () => void;
    onsubmitnewfolder: () => void;
    onsubmitnewfile: () => void;
    onsubmitremove: (recursive: boolean) => void;
  } = $props();

  const removeLabel = $derived(
    removeTargets.length === 1
      ? baseNameOf(removeTargets[0])
      : t("files.menu.remove.targets", { count: removeTargets.length }),
  );

  const toDeviceLabel: Record<Exclude<DeviceDownloadRow, "none">, Key> = {
    go: "files.menu.todevice",
    busy: "files.menu.todevice.busy",
  };

  const onEntry = (fn: (entry: SftpEntry) => void) => runOnMenu(() => menu.entry, onclose, fn);

  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
    }
  }
</script>

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
  class="ctx-menu menu-surface"
  role="menu"
  tabindex="-1"
  aria-label={menu.entry ? t("files.menu.entry.aria") : t("files.menu.dir.aria")}
  style:left={`${menu.x}px`}
  style:top={`${menu.y}px`}
  onkeydown={menuKeydown}
>
  {#if mode === "rename"}
    <div class="ctx-title menu-title">{t("files.menu.rename.title")}</div>
    <input
      class="ctx-input menu-input"
      data-inline-edit
      bind:value={edit.value}
      bind:this={edit.el}
      spellcheck="false"
      autocomplete="off"
      placeholder={t("files.menu.rename.placeholder")}
      oninput={() => (edit.error = null)}
      onkeydown={(ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          onsubmitrename();
        }
      }}
    />
    {#if edit.error}<div class="ctx-error">{edit.error}</div>{/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.menu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" onclick={onsubmitrename}>
        {t("files.menu.rename.submit")}
      </button>
    </div>
  {:else if mode === "newfolder" || mode === "newfile"}
    {@const file = mode === "newfile"}
    {@const submitNew = file ? onsubmitnewfile : onsubmitnewfolder}
    <div class="ctx-title menu-title" title={newFolderDir}>
      {t(file ? "files.menu.newfile.title" : "files.menu.newfolder.title", { path: newFolderDir })}
    </div>
    <input
      class="ctx-input menu-input"
      data-inline-edit
      bind:value={edit.value}
      bind:this={edit.el}
      spellcheck="false"
      autocomplete="off"
      placeholder={t(file ? "files.menu.newfile.placeholder" : "files.menu.newfolder.placeholder")}
      oninput={() => (edit.error = null)}
      onkeydown={(ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitNew();
        }
      }}
    />
    {#if edit.error}<div class="ctx-error">{edit.error}</div>{/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.menu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" onclick={submitNew}>
        {t("files.menu.newfolder.submit")}
      </button>
    </div>
  {:else if mode === "confirm"}
    <!-- 재귀 삭제는 백엔드가 "비어 있지 않다" 로 거절한 뒤에만 — 트리를 통째로 날리는 길을 한 단계 멀리 둔다 -->
    <div class="ctx-title menu-title" title={removeTargets.join("\n")}>{removeLabel}</div>
    <div class="ctx-confirm">
      {confirmRecursive
        ? t("files.menu.remove.confirm.recursive")
        : t("files.menu.remove.confirm")}
    </div>
    {#if edit.error}<div class="ctx-error">{edit.error}</div>{/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.menu.cancel")}</button>
      {#if confirmRecursive}
        <button type="button" class="ctx-btn danger btn btn-sm" onclick={() => onsubmitremove(true)}>
          {t("files.menu.remove.recursive")}
        </button>
      {:else}
        <button type="button" class="ctx-btn danger btn btn-sm" onclick={() => onsubmitremove(false)}>
          {t("files.menu.remove")}
        </button>
      {/if}
    </div>
  {:else if menu.entry && selCount >= 2}
    <div class="ctx-title menu-title">{t("files.menu.selected", { count: selCount })}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncut)}>
      {t("files.menu.cut")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncopy)}>
      {t("files.menu.copy")}
    </button>
    {#if hasClip && !atRoot}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpaste)}>
        {t("files.menu.paste")}
      </button>
    {/if}
    <!-- 원격 창에서는 [다운로드] · [내보내기] 가 메인 PC 대화상자라 서지 못한다 — 그 자리에 [이 기기로 다운로드] -->
    {#if isRemote}
      {@const deviceRow = deviceDownloadRow({ hasFolder: selHasFolder, busy })}
      {#if (backend.canDownload || (backend.key === LOCAL_KEY && !atRoot)) && deviceRow !== "none"}
        <div class="ctx-sep menu-sep" role="separator"></div>
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          disabled={deviceRow !== "go"}
          onclick={() => runOnMenu(() => [...selPaths], onclose, ontodevice)}
        >
          {t(toDeviceLabel[deviceRow])}
        </button>
      {/if}
    {:else}
    {#if backend.canDownload || (backend.key === LOCAL_KEY && !atRoot)}
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    {#if backend.canDownload}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => runOnMenu(() => [...selPaths], onclose, ondownload)}
      >
        {busy ? t("files.menu.download.busy") : t("files.menu.download")}
      </button>
    {/if}
    {#if backend.key === LOCAL_KEY && !atRoot}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => runOnMenu(() => [...selPaths], onclose, onexport)}
      >
        {busy ? t("files.menu.export.busy") : t("files.menu.export")}
      </button>
    {/if}
    {/if}
    {#if !atRoot}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row danger" role="menuitem" onclick={onstartremove}>
        {t("files.menu.remove.more")}
      </button>
    {/if}
  {:else if menu.entry}
    {@const entry = menu.entry}
    {@const canCreate = tree && isDirLike(entry) && !atRoot}
    {@const canSend = backend.canDownload || (backend.key === LOCAL_KEY && !atRoot)}
    {@const deviceRow = deviceDownloadRow({ hasFolder: isDirLike(entry), busy })}
    {@const sendGroup = isRemote ? canSend && deviceRow !== "none" : canSend}
    <div class="ctx-title menu-title" title={entry.path}>{entry.name}</div>
    {#if canCreate}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-menu-newfile onclick={onstartnewfile}>
        {t("files.menu.newfile")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-menu-newfolder onclick={onstartnewfolder}>
        {t("files.menu.newfolder")}
      </button>
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(onopenentry)}>
      {isDirLike(entry) ? t("files.menu.enter") : t("files.menu.open")}
    </button>
    <!-- 그림 파일에는 세우지 않는다 — [열기]가 곧 이미지 타일이라 같은 일을 하는 줄이 둘이 된다 -->
    {#if !isDirLike(entry) && backend.canView && onpreview && imageMime(entry.name) === null}
      {@const preview = onpreview}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(preview)}>
        {t("files.doc.preview")}
      </button>
    {/if}
    {#if !isDirLike(entry) && backend.canEdit}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(oneditentry)}>
        {t("files.menu.edit.external")}
      </button>
    {/if}
    {#if !isDirLike(entry) && backend.canOpenExternal}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(onopenexternal)}>
        {t("files.menu.openexternal")}
      </button>
    {/if}
    {#if backend.canReveal}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(onreveal)}>
        {t("files.menu.reveal")}
      </button>
    {/if}
    {#if sendGroup}
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    {#if isRemote}
      <!-- 원격 창에서는 [다운로드] · [내보내기] 가 메인 PC 대화상자라 서지 못한다 -->
      {#if sendGroup && deviceRow !== "none"}
        {@const row = deviceRow}
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          disabled={row !== "go"}
          onclick={() => onEntry((e) => ontodevice([e.path]))}
        >
          {t(toDeviceLabel[row])}
        </button>
      {/if}
    {:else}
    {#if backend.canDownload}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => onEntry((e) => ondownload([e.path]))}
      >
        {busy ? t("files.menu.download.busy") : t("files.menu.download")}
      </button>
    {/if}
    {#if backend.key === LOCAL_KEY && !atRoot}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => onEntry((e) => onexport([e.path]))}
      >
        {busy ? t("files.menu.export.busy") : t("files.menu.export")}
      </button>
    {/if}
    {/if}
    {#if !atRoot}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncut)}>
        {t("files.menu.cut")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncopy)}>
        {t("files.menu.copy")}
      </button>
      {#if hasClip}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpaste)}>
          {t("files.menu.paste")}
        </button>
      {/if}
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(oncopypath)}>
      {t("files.menu.copypath")}
    </button>
    {#if !atRoot}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartrename}>
        {t("files.menu.rename.more")}
      </button>
      <button type="button" class="ctx-item menu-row danger" role="menuitem" onclick={onstartremove}>
        {t("files.menu.remove.more")}
      </button>
    {/if}
  {:else}
    {@const gCreate = !atRoot}
    {@const gPlace = (backend.canReveal && !atRoot) || !!sourcePaneId}
    {@const gPaste = hasClip && !atRoot}
    {@const gBring = !atRoot && (backend.canUpload || (isLocal && !isRemote))}
    <div class="ctx-title menu-title" title={cwd}>{cwd === "" ? t("files.browser.mypc") : cwd}</div>
    {#if gCreate}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-menu-newfile onclick={onstartnewfile}>
        {t("files.menu.newfile")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartnewfolder}>
        {t("files.menu.newfolder")}
      </button>
    {/if}
    {#if gPlace}
      {#if gCreate}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      {#if backend.canReveal && !atRoot}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onrevealhere)}>
          {t("files.menu.revealhere")}
        </button>
      {/if}
      {#if sourcePaneId}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncdhere)}>
          {t("files.menu.cdhere")}
        </button>
      {/if}
    {/if}
    {#if gPaste}
      {#if gCreate || gPlace}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpaste)}>
        {t("files.menu.paste")}
      </button>
    {/if}
    {#if gBring}
      {#if gCreate || gPlace || gPaste}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      {#if backend.canUpload}
        <!-- 원격 창에서는 로컬 타일(메인 PC 디스크)로도 그 기기에서 올리는 것이라 "업로드" -->
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpickupload)}>
          {isLocal && !isRemote ? t("files.menu.import") : t("files.menu.upload")}
        </button>
      {/if}
      <!-- 폴더는 웹 DnD 로 오지 않아 대화상자가 필요하다 — 원격 창은 폴리필이 그 대화상자를 거절해 숨긴다 -->
      {#if isLocal && !isRemote}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onimportfolders)}>
          {t("files.menu.importfolders")}
        </button>
      {/if}
    {/if}
    {#if gCreate || gPlace || gPaste || gBring}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onrefresh)}>
      {t("files.menu.refresh")}
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

  /* `ctx-*` 이름은 표식으로 남는다 — 검증 도구가 이 이름으로 찾는다 */
  .ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 160px;
    max-width: 240px;
  }

  .ctx-error {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
    overflow-wrap: anywhere;
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

  /* 스코프 규칙이 전역 `.btn` 을 이긴다 — 여기에는 삭제 색만 둔다 */
  .ctx-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .ctx-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
