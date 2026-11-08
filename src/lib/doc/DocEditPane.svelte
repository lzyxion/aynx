<script lang="ts">
  /**
   * **문서 타일의 편집 면** — `DocView.svelte` 의 편집 줄 마크업을 그대로 옮긴 그림(2026-10-27 분할 9차).
   *
   * 편집기(`DocEditor`) · 나란히의 경계 · 마크다운 미리 보기가 옆으로 선다. 편집기는 보기를 바꿔도 **내리지 않고 숨기기만**
   * 한다(되돌리기 기록 · 커서가 산다). 다시 불러오기가 `editGen` 을 올려 편집기를 새로 세운다.
   *
   * **상태 · 효과 · 리스너는 없다** — 보기 고르기 · 경계 끌기 비율 · 미리 보기 글 · 스크롤 맞추기 · 커서 절 강조(`.sync-hl` 은 `DocView` 의
   * 효과가 DOM 에 단다 — 모양만 여기) · 저장은 `DocView`(와 `doc/document-controller.svelte.ts`)가 쥐고 여기는 콜백으로 올린다. `DocView` 가
   * 손에 쥐어야 하는 넷(편집기 인스턴스 · 편집 줄 · 미리 보기 상자 · 미리 보기 내용 상자)은 `$bindable` 로 돌려준다 — `bind:this` 가 이 안에서
   * 그 값을 채우고 비운다.
   */
  import DocEditor from "$lib/DocEditor.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import type { MdBlock } from "$lib/markdown";
  import type { DocImageCache } from "$lib/doc-images.svelte";
  import { DOC_SPLIT_DEFAULT } from "$lib/doc-edit-preview";
  import type { DocEditView } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ComponentProps } from "svelte";

  let {
    editGen,
    text,
    path,
    editShown,
    splitRatio,
    dragging,
    showPreview,
    previewBlocks,
    images,
    tasks,
    save,
    setDirty,
    editorChanged,
    oncursor,
    onviewport,
    editorFailed,
    startSplitDrag,
    moveSplitDrag,
    endSplitDrag,
    splitKey,
    onsplit,
    openLink,
    openPreviewDocLink,
    onjump,
    editor = $bindable(null),
    splitEl = $bindable(null),
    previewEl = $bindable(null),
    previewPageEl = $bindable(null),
  }: {
    /** 편집기를 새로 세우는 열쇠(`{#key}`) */
    editGen: number;
    /** 편집을 시작할 때의 글 */
    text: string;
    path: string;
    /** 지금 보이는 보기 — 마크다운이 아니면 늘 원문 */
    editShown: DocEditView;
    /** 나란히의 편집기 몫(끄는 중이면 끄는 값) */
    splitRatio: number;
    /** 경계를 끄는 중 */
    dragging: boolean;
    showPreview: boolean;
    previewBlocks: MdBlock[];
    images: DocImageCache;
    /** 편집 중 미리 보기의 체크박스(편집기 글을 바꾼다) */
    tasks: ComponentProps<typeof MarkdownBlocks>["tasks"];
    save: () => Promise<boolean>;
    setDirty: (dirty: boolean) => void;
    editorChanged: () => void;
    oncursor: (line: number) => void;
    onviewport: (top: number, bottom: number) => void;
    editorFailed: (message: string) => void;
    startSplitDrag: (ev: PointerEvent) => void;
    moveSplitDrag: (ev: PointerEvent) => void;
    endSplitDrag: (ev: PointerEvent) => void;
    splitKey: (ev: KeyboardEvent) => void;
    /** 경계 더블클릭(반반) — 상위가 패널 명세에 적는다 */
    onsplit?: (ratio: number) => void;
    openLink: (href: string) => void;
    openPreviewDocLink: (href: string) => void;
    /** 각주 오가기 — 미리 보기 상자를 그 요소로 */
    onjump: (el: HTMLElement) => void;
    editor?: ReturnType<typeof DocEditor> | null;
    splitEl?: HTMLDivElement | null;
    previewEl?: HTMLDivElement | null;
    previewPageEl?: HTMLDivElement | null;
  } = $props();
</script>

<!-- 편집 줄 — 편집기는 보기를 바꿔도 내리지 않고 숨긴다(되돌리기 기록 · 커서가 산다). 마크다운이면 곁에
     경계와 미리 보기(나란히) 또는 미리 보기만 -->
<div class="edit" bind:this={splitEl}>
  <div
    class="edit-src"
    class:hidden={editShown === "preview"}
    style:flex-basis={editShown === "split" ? `${splitRatio * 100}%` : null}
    class:part={editShown === "split"}
  >
    <!-- 편집기 — 다시 불러오기가 `editGen` 을 올려 새로 세운다(되돌리기 기록 · 줄 끝 판정이 새 글에서) -->
    {#key editGen}
      <DocEditor
        bind:this={editor}
        {text}
        {path}
        onsave={() => void save()}
        ondirty={setDirty}
        onchange={editorChanged}
        {oncursor}
        {onviewport}
        onfailed={editorFailed}
      />
    {/key}
  </div>
  {#if editShown === "split"}
    <!-- 경계 — 끌기(20~80%) · 더블클릭 반반 · 포커스하면 ←/→. 값을 가진 포커스 가능한 separator 는 ARIA 에서
         조작 위젯(창 분할선)인데 svelte 의 a11y 표는 separator 를 늘 비대화형으로 본다 — 그 두 경고만 끈다 -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="splitter"
      class:dragging
      role="separator"
      aria-orientation="vertical"
      aria-label={t("files.doc.editview.splitter")}
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(splitRatio * 100)}
      tabindex="0"
      title={t("files.doc.editview.splitter.title")}
      onpointerdown={startSplitDrag}
      onpointermove={moveSplitDrag}
      onpointerup={endSplitDrag}
      onpointercancel={endSplitDrag}
      ondblclick={() => onsplit?.(DOC_SPLIT_DEFAULT)}
      onkeydown={splitKey}
    ></div>
  {/if}
  {#if showPreview}
    <div class="edit-preview" bind:this={previewEl}>
      <div class="md-page" bind:this={previewPageEl}>
        <MarkdownBlocks
          blocks={previewBlocks}
          onlink={openLink}
          ondoclink={openPreviewDocLink}
          {onjump}
          diagrams
          {tasks}
          {images}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  /* 읽는 폭은 920px 까지 — 타일이 더 넓으면 양옆을 비워 가운데 둔다(`DocView` 의 같은 규칙을 복제 — 미리 보기 내용 상자) */
  .md-page {
    max-width: 920px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-5);
    /* 글자 크기 배율(`--doc-zoom` — `DocView` 의 "글자 크기"). 읽는 폭 상한은 그대로라 크게 하면 한 줄에 드는 글자가 준다 */
    font-size: calc(var(--t-sm) * var(--doc-zoom, 1));
    line-height: 1.6;
    color: var(--fg-1);
  }

  /* 편집 줄 — 편집기 · 경계 · 미리 보기가 옆으로 */
  .edit {
    display: flex;
    height: 100%;
    min-height: 0;
  }

  .edit-src {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  /* 나란히 — 몫은 `flex-basis` 가 준다 */
  .edit-src.part {
    flex: 0 0 auto;
  }

  .edit-src.hidden {
    display: none;
  }

  /* 경계 — 잡기 편하게 6px, 보이는 선은 가운데 1px. 다가가면(hover · focus · 끄는 중) 강조색 */
  .splitter {
    position: relative;
    flex: 0 0 6px;
    cursor: col-resize;
    touch-action: none;
  }

  .splitter::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: var(--line);
  }

  .splitter:hover::after,
  .splitter:focus-visible::after,
  .splitter.dragging::after {
    width: 2px;
    background: var(--accent);
  }

  .splitter:focus {
    outline: none;
  }

  .edit-preview {
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    overflow: auto;
  }

  /* 커서가 있는 절의 제목 — 옅은 판만(왼쪽 선 없음) */
  .edit-preview :global(.sync-hl) {
    background: var(--surface-hover);
    border-radius: var(--radius);
  }
</style>
