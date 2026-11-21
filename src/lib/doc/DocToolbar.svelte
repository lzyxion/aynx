<script lang="ts">
  /** 문서 타일의 도구줄 — 그림만이고 상태 · 동작은 `DocView` 가 쥔다. 머리줄 안이면 `setPaneTools` 의 `docBar` 스니펫 내용이다. */
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { DOC_ZOOM_DEFAULT } from "$lib/doc-zoom";
  import type { FsBackend } from "$lib/fs-backend";
  import type { EditBlock } from "$lib/doc-edit";
  import type { NarrowEditTab } from "$lib/doc-edit-preview";
  import type { DocEditView, DocMode } from "$lib/session";

  let {
    head,
    filesSlot,
    filesToggle,
    filesDropButton,
    outlineSlot,
    narrow,
    hasOutline,
    outlineToggle,
    outlineDropButton,
    mdEdit,
    wideEdit,
    editView,
    pickEditView,
    editShown,
    syncScroll = $bindable(),
    narrowTab,
    narrowTabKey,
    pickNarrowTab,
    zoom,
    setZoom,
    preview,
    keep,
    editing,
    onunkeep,
    unkeep,
    dirty,
    savedFlash,
    saving,
    offline,
    save,
    endEdit,
    markdown,
    rendered,
    onmode,
    showEdit,
    editTitle,
    editBlock,
    startEdit,
    backend,
    openExternally,
    editRemote,
    autoInfo,
    infoNow = $bindable(),
    loading,
    load,
  }: {
    head: boolean;
    filesSlot: boolean;
    filesToggle: Snippet<[boolean]>;
    filesDropButton: Snippet<[boolean]>;
    outlineSlot: boolean;
    narrow: boolean;
    hasOutline: boolean;
    outlineToggle: Snippet;
    outlineDropButton: Snippet;
    mdEdit: boolean;
    wideEdit: boolean;
    editView: DocEditView;
    pickEditView: (v: DocEditView) => void;
    editShown: DocEditView;
    syncScroll: boolean;
    narrowTab: NarrowEditTab;
    narrowTabKey: (ev: KeyboardEvent) => void;
    pickNarrowTab: (tab: NarrowEditTab) => void;
    zoom: number;
    setZoom: (next: number) => void;
    preview: boolean;
    keep: () => void;
    editing: boolean;
    onunkeep?: () => void;
    unkeep: () => void;
    dirty: boolean;
    savedFlash: boolean;
    saving: boolean;
    offline: boolean;
    save: (force?: boolean) => Promise<boolean>;
    endEdit: () => void;
    markdown: boolean;
    rendered: boolean;
    onmode?: (mode: DocMode) => void;
    showEdit: boolean;
    editTitle: () => string;
    editBlock: EditBlock | null;
    startEdit: () => void;
    backend: FsBackend;
    openExternally: () => Promise<void>;
    editRemote: (target?: string) => Promise<void>;
    autoInfo: string | undefined;
    infoNow: number;
    loading: boolean;
    load: () => Promise<void>;
  } = $props();
</script>

<div class="bar" class:inhead={head}>
  {#if filesSlot && !head}
    <!-- 머리줄 안이면 이름 뒤 `docTail`(DocView)이 그린다 -->
    {#if narrow}{@render filesDropButton(false)}{:else}{@render filesToggle(false)}{/if}
  {/if}
  {#if mdEdit}
    {#if wideEdit}
      <div class="seg" data-head-act role="group" aria-label={t("files.doc.editview")}>
        <button
          type="button"
          class="btn ico"
          class:on={editView === "source"}
          aria-pressed={editView === "source"}
          title={t("files.doc.editview.source")}
          aria-label={t("files.doc.editview.source")}
          onclick={() => pickEditView("source")}><UiIcon name="view-source" size={13} /></button
        >
        <button
          type="button"
          class="btn ico"
          class:on={editView === "split"}
          aria-pressed={editView === "split"}
          title={t("files.doc.editview.split")}
          aria-label={t("files.doc.editview.split")}
          onclick={() => pickEditView("split")}><UiIcon name="split-h" size={13} /></button
        >
        <button
          type="button"
          class="btn ico"
          class:on={editView === "preview"}
          aria-pressed={editView === "preview"}
          title={t("files.doc.editview.preview")}
          aria-label={t("files.doc.editview.preview")}
          onclick={() => pickEditView("preview")}><UiIcon name="view-rendered" size={13} /></button
        >
      </div>
      {#if editShown === "split"}
        <button
          type="button"
          class="btn ico"
          data-head-act
          class:on={syncScroll}
          aria-pressed={syncScroll}
          title={t("files.doc.editview.sync")}
          aria-label={t("files.doc.editview.sync")}
          onclick={() => (syncScroll = !syncScroll)}><UiIcon name="scroll-sync" size={13} /></button
        >
      {/if}
    {:else}
      <!-- 좁은 타일의 탭은 저장하지 않는다 — 넓어지면 고른 보기가 돌아온다 -->
      <div class="seg" data-head-act role="tablist" aria-label={t("files.doc.editview")} tabindex="-1" onkeydown={narrowTabKey}>
        <button
          type="button"
          class="btn ico"
          class:on={narrowTab === "source"}
          role="tab"
          aria-selected={narrowTab === "source"}
          tabindex={narrowTab === "source" ? 0 : -1}
          data-edit-tab="source"
          title={t("files.doc.editview.tab.source")}
          aria-label={t("files.doc.editview.tab.source")}
          onclick={() => pickNarrowTab("source")}><UiIcon name="view-source" size={13} /></button
        >
        <button
          type="button"
          class="btn ico"
          class:on={narrowTab === "preview"}
          role="tab"
          aria-selected={narrowTab === "preview"}
          tabindex={narrowTab === "preview" ? 0 : -1}
          data-edit-tab="preview"
          title={t("files.doc.editview.tab.preview")}
          aria-label={t("files.doc.editview.tab.preview")}
          onclick={() => pickNarrowTab("preview")}><UiIcon name="view-rendered" size={13} /></button
        >
      </div>
    {/if}
  {/if}
  <span class="grow" aria-hidden="true"></span>
  {#if zoom !== DOC_ZOOM_DEFAULT}
    <button
      type="button"
      class="btn pct"
      title={t("files.doc.zoom.reset")}
      aria-label={t("files.doc.zoom.aria", { pct: String(zoom) })}
      onclick={() => setZoom(DOC_ZOOM_DEFAULT)}>{zoom}%</button
    >
  {/if}
  {#if preview}
    <button
      type="button"
      class="btn ico"
      data-head-act
      aria-pressed="false"
      title={t("files.doc.keep")}
      aria-label={t("files.doc.keep")}
      onclick={keep}><UiIcon name="pin" size={13} /></button
    >
  {:else if !editing && onunkeep}
    <!-- 편집 중에는 서지 않는다 — 편집하는 동안 고정을 풀면 다음 파일이 이 칸을 갈아 끼운다 -->
    <button
      type="button"
      class="btn ico on"
      data-head-act
      aria-pressed="true"
      title={t("files.doc.unkeep")}
      aria-label={t("files.doc.unkeep")}
      onclick={unkeep}><UiIcon name="pin" size={13} /></button
    >
  {/if}
  {#if editing}
    {#if dirty}
      <span class="dirty" title={t("files.doc.dirty")} role="img" aria-label={t("files.doc.dirty")}>●</span>
    {:else if savedFlash}
      <span class="saved">{t("files.doc.saved")}</span>
    {/if}
    <button
      type="button"
      class="btn ico"
      data-head-act
      class:primary={dirty}
      title={saving ? t("files.doc.saving") : t("files.doc.save.title")}
      aria-label={t("files.doc.save")}
      aria-busy={saving}
      disabled={saving || !dirty || offline}
      onclick={() => void save()}><UiIcon name="save" size={13} /></button
    >
    <button
      type="button"
      class="btn ico"
      data-head-act
      title={dirty ? t("files.doc.revert") : t("files.doc.done")}
      aria-label={dirty ? t("files.doc.revert") : t("files.doc.done")}
      disabled={saving}
      onclick={endEdit}><UiIcon name={dirty ? "undo" : "check"} size={13} /></button
    >
  {:else}
    {#if markdown}
      <!-- 그림 · 이름은 지금 보기가 아니라 누르면 갈 보기다 — 지금 원문인지는 `on` 이 말한다 -->
      <button
        type="button"
        class="btn ico"
        data-head-act
        class:on={!rendered}
        title={rendered ? t("files.doc.mode.source") : t("files.doc.mode.rendered")}
        aria-label={rendered ? t("files.doc.mode.source") : t("files.doc.mode.rendered")}
        onclick={() => onmode?.(rendered ? "source" : "rendered")}
        ><UiIcon name={rendered ? "view-source" : "view-rendered"} size={13} /></button
      >
    {/if}
    {#if showEdit}
      <button
        type="button"
        class="btn ico"
        data-head-act
        title={editTitle()}
        aria-label={t("files.doc.edit")}
        disabled={editBlock !== null || offline}
        onclick={startEdit}><UiIcon name="edit" size={13} /></button
      >
    {/if}
  {/if}
  <!-- 머리줄 안에서는 타일 ⋯ 의 줄(`DocView` 의 `fileMenu`)이 쥔다 — 머리줄이 없으면(`tile_header` 끔 · 폰) ⋯ 에 그 줄이 없어 여기 둔다 -->
  {#if !head && backend.canOpenExternal}
    <button
      type="button"
      class="btn ico"
      data-head-act
      title={t("files.menu.openexternal")}
      aria-label={t("files.menu.openexternal")}
      onclick={() => void openExternally()}><UiIcon name="external" size={13} /></button
    >
  {:else if !head && backend.canEdit}
    <button
      type="button"
      class="btn ico"
      data-head-act
      title={offline ? t("files.doc.edit.block.offline") : t("files.menu.edit.external")}
      aria-label={t("files.menu.edit.external")}
      disabled={offline}
      onclick={() => void editRemote()}><UiIcon name="external" size={13} /></button
    >
  {/if}
  <button
    type="button"
    class="btn ico"
    data-head-act
    title={t("files.doc.refresh")}
    data-tip-sub={autoInfo}
    aria-label={t("files.doc.refresh")}
    onpointerenter={() => (infoNow = Date.now())}
    onfocus={() => (infoNow = Date.now())}
    disabled={offline || loading}
    onclick={() => void load()}><UiIcon name="refresh" size={13} /></button
  >
  {#if outlineSlot}
    {#if narrow && hasOutline}{@render outlineDropButton()}{:else}{@render outlineToggle()}{/if}
  {/if}
</div>

<style>
  .bar {
    container: doc-bar / inline-size;
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
  }

  .bar.inhead {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 0 0 4px;
    border-bottom: none;
    /* 줄의 gap 과 같은 값 — `pane/pane-tools.svelte.ts` 가 접힌 단추의 앞 간격을 지운다 */
    --head-act-gap: 4px;
    /* 담긴 상자는 내용 폭이 0 으로 잡혀 `PaneTools.keepBar` 가 좁을 때 이름을 먼저 줄이지 못한다 */
    container-type: normal;
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 1.4em;
    padding: 3px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .btn.ico {
    width: 24px;
    height: 24px;
    padding: 0;
  }

  .btn.pct {
    height: 24px;
    padding: 0 5px;
    font-variant-numeric: tabular-nums;
  }

  .btn.primary:not(:disabled) {
    color: var(--on-accent);
    background: var(--accent);
  }

  .btn.primary:hover:not(:disabled) {
    color: var(--on-accent);
    background: var(--accent-hover);
  }

  .dirty {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--accent);
  }

  .saved {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--fg-3);
  }

  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .seg {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 2px;
  }

  .seg .btn {
    border-radius: 999px;
  }

  .seg:focus {
    outline: none;
  }
</style>
