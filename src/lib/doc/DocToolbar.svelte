<script lang="ts">
  /**
   * **문서 타일의 도구줄**(`.bar` — 목차 단추 자리 · 편집 중 보기 고르기 · 스크롤 맞추기 · 글자 크기 · 고정 · 저장 표시 · [저장] · [되돌리기]/[편집 종료] ·
   * 원문/보기 · [편집] · 외부 열기 · 새로고침) — `DocView.svelte` 에서 뗀 표시 조각. 읽기 · 편집 · 저장 · 충돌 · 고정 · 외부 열기와 그 상태는 부모가 쥐고
   * 여기는 받은 값대로 그리기만 하며 동작은 콜백이다. 머리줄 등록(`setPaneTools` 의 `docBar` 스니펫)은 부모에 있고 이것은 그 스니펫의 내용이다.
   * 목차 단추는 부모의 스니펫(`outlineToggle` · `outlineDropButton` — 드롭다운 단추 손잡이가 부모에 있다)을 받아 그린다. 스크롤 맞추기 켬 · 툴팁
   * 시각은 `bind:syncScroll` · `bind:infoNow`.
   */
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
    headSpan,
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
    headSpan: number | null;
    outlineSlot: boolean;
    narrow: boolean;
    hasOutline: boolean;
    outlineToggle: Snippet<[boolean]>;
    outlineDropButton: Snippet<[boolean]>;
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

<div class="bar" class:inhead={head} class:flush={head && headSpan !== null}>
  {#if outlineSlot && !head}
    <!-- 몸 위 줄 — 좁은 타일은 곁 패널 자리가 없어 지금 절 이름 단추(누르면 같은 목록이 드롭다운), 넓은 타일은 곁 패널 토글.
         머리줄 안이면 둘 다 이름 뒤 `docTail` 이 같은 자리에 그린다 -->
    {#if narrow && hasOutline}{@render outlineDropButton(false)}{:else}{@render outlineToggle(false)}{/if}
  {/if}
  {#if mdEdit}
    {#if wideEdit}
      <!-- 넓은 타일 — 편집 중 보기 세 칸 묶음(고른 값은 타일의 것) · 나란히일 때만 스크롤 맞추기 -->
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
      <!-- 좁은 타일 — 나란히 자리가 없다. 두 칸 탭(저장하지 않는다 — 넓어지면 고른 보기가 돌아온다) -->
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
  <!-- 빈 칸 — 뒤의 상태 · 단추를 줄 오른쪽 끝으로 민다(예전에는 경로 글자가 이 자리를 채웠다 — 10-20 걷음) -->
  <span class="grow" aria-hidden="true"></span>
  {#if zoom !== DOC_ZOOM_DEFAULT}
    <!-- 글자 크기 — 100% 가 아닐 때만 선다. 글자가 지금 배율이고, 누르면 100% (툴팁은 이름만) -->
    <button
      type="button"
      class="btn pct"
      title={t("files.doc.zoom.reset")}
      aria-label={t("files.doc.zoom.aria", { pct: String(zoom) })}
      onclick={() => setZoom(DOC_ZOOM_DEFAULT)}>{zoom}%</button
    >
  {/if}
  {#if preview}
    <!-- 미리 보기 ↔ 붙박이. 타일링이라 되돌리는 길도 둔다 — 고정을 풀면 다음에 여는 문서가 이 칸을 갈아 끼운다 -->
    <button
      type="button"
      class="btn ico keep"
      data-head-act
      title={t("files.doc.keep")}
      aria-label={t("files.doc.keep")}
      onclick={keep}><UiIcon name="pin" size={13} /></button
    >
  {:else if !editing && onunkeep}
    <!-- 편집 중에는 서지 않는다 — 편집하는 동안은 고정이어야 다음 파일이 이 칸을 갈아 끼우지 않는다 -->
    <button
      type="button"
      class="btn ico keep"
      data-head-act
      title={t("files.doc.unkeep")}
      aria-label={t("files.doc.unkeep")}
      onclick={unkeep}><UiIcon name="pin-off" size={13} /></button
    >
  {/if}
  {#if editing}
    <!-- 편집 모드 — 저장 안 됨(●) · 방금 저장됨 · [저장] · [되돌리기]/[편집 종료]. 원문/보기 전환은 편집 중 쉰다 -->
    {#if dirty}
      <span class="dirty" title={t("files.doc.dirty")} role="img" aria-label={t("files.doc.dirty")}>●</span>
    {:else if savedFlash}
      <span class="saved">{t("files.doc.saved")}</span>
    {/if}
    <!-- [저장] — 저장하지 않은 변경이 있을 때만 강조색으로 채운다(없으면 흐린 평범한 단추). 저장 중에는 툴팁이 말한다 -->
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
    <!-- 한 자리 — 변경이 있으면 [되돌리기], 없으면 [편집 종료] -->
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
      <!-- 그림 · 이름은 **누르면 갈 보기**다 — 글자 시절에도 이 단추는 갈 곳([원문]/[보기])을 적었고, 툴팁이
           동작 이름("원문 보기")이라 그림도 동작과 맞춘다. 지금 원문이라는 것은 눌린 색(`on`)이 말한다 -->
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
  <!-- 외부 열기 자리 하나 — 로컬은 기본 앱으로 열기, 원격은 외부 편집기로 편집(받아서 열고 저장하면 올린다).
       `fs-backend` 에서 둘(`canOpenExternal` · `canEdit`)은 동시에 서지 않는다 -->
  {#if backend.canOpenExternal}
    <button
      type="button"
      class="btn ico"
      data-head-act
      title={t("files.menu.openexternal")}
      aria-label={t("files.menu.openexternal")}
      onclick={() => void openExternally()}><UiIcon name="external" size={13} /></button
    >
  {:else if backend.canEdit}
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

  /* 머리줄 안(2026-10-20) — 머리줄 가운데 칸을 채우고 선 · 여백이 없다(머리줄과 몸 사이에 선을 긋지 않는다) */
  .bar.inhead {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 0 0 4px;
    border-bottom: none;
    /* 줄의 gap — 포커스 밖에서 접히는 조작 단추(`data-head-act`)의 앞 간격을 지운다(`pane/pane-tools.svelte.ts`) */
    --head-act-gap: 4px;
  }

  /* 목차 패널 경계에 맞춘 머리줄(`span`) — 도구가 본문 열의 x 에서 바로 선다(그 x 는 머리줄이 맞춘다 — `pane/head-span`) */
  .bar.inhead.flush {
    padding-left: 0;
  }

  /* 빈 칸 — 남는 폭을 먹어 뒤의 상태 · 단추를 오른쪽 끝으로(예전 경로 글자의 자리) */
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

  /* 미리 보기의 [고정] — 점선 테두리가 "아직 임시다" 를 말한다(이름의 기울임과 같은 뜻). 다른 조작처럼 포커스 밖에서는 접힌다 —
     그때 임시임은 이름의 기울임이 말한다 */
  .btn.keep {
    border-style: dashed;
    border-color: var(--border);
  }

  /* 아이콘만 선 단추 — 정사각 한 크기(목차 드롭다운처럼 글자가 내용인 단추만 이 밖이다) */
  .btn.ico {
    width: 24px;
    height: 24px;
    padding: 0;
  }

  /* 글자 크기 단추 — 아이콘 단추 줄과 같은 높이의 글자 단추. 숫자 폭이 흔들리지 않게 */
  .btn.pct {
    height: 24px;
    padding: 0 5px;
    font-variant-numeric: tabular-nums;
  }

  /* [저장] — 도구줄에서 하나뿐인 강조. 저장하지 않은 변경이 있을 때만 붙는다(강조색 채움) */
  .btn.primary:not(:disabled) {
    color: var(--on-accent);
    background: var(--accent);
  }

  .btn.primary:hover:not(:disabled) {
    color: var(--on-accent);
    background: var(--accent-hover);
  }

  /* 저장 안 됨 ● · 방금 저장됨 — 작은 글자, 토스트 없음 */
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

  /* 켜진 토글(목차 · 원문 보기 · 편집 보기 · 스크롤 맞추기) — 파일 타일 도구줄(`.bar-btn.on`)과 같은 말: 강조 면 하나 */
  .btn.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  /* 편집 중 보기 묶음 · 두 칸 탭 — 단추 사이를 붙인다 */
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
