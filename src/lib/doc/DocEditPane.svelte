<script lang="ts">
  /**
   * 문서 타일의 편집 면 — 그림만이고 상태는 `DocView` 가 쥔다.
   * 편집기는 보기를 바꿔도 내리지 않고 숨기기만 한다 — 내리면 되돌리기 기록 · 커서가 사라진다.
   */
  import DocEditor from "$lib/DocEditor.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import type { MdBlock } from "$lib/markdown";
  import type { DocImageCache } from "$lib/doc-images.svelte";
  import { DOC_SPLIT_DEFAULT } from "$lib/doc-edit-preview";
  import type { DocEditView } from "$lib/session";
  import type { DocEditorRestore } from "$lib/doc-draft";
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
    codeActions,
    covered = false,
    restore = null,
    onready,
    editor = $bindable(null),
    splitEl = $bindable(null),
    previewEl = $bindable(null),
    previewPageEl = $bindable(null),
  }: {
    editGen: number;
    text: string;
    path: string;
    editShown: DocEditView;
    splitRatio: number;
    dragging: boolean;
    showPreview: boolean;
    previewBlocks: MdBlock[];
    images: DocImageCache;
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
    onsplit?: (ratio: number) => void;
    openLink: (href: string) => void;
    openPreviewDocLink: (href: string) => void;
    onjump: (el: HTMLElement) => void;
    codeActions?: ComponentProps<typeof MarkdownBlocks>["codeActions"];
    /** 비교 보기가 이 자리에 섰다 — 숨기기만 한다 */
    covered?: boolean;
    /** 편집기가 처음 설 때 한 번만 읽는다 */
    restore?: DocEditorRestore | null;
    onready?: () => void;
    editor?: ReturnType<typeof DocEditor> | null;
    splitEl?: HTMLDivElement | null;
    previewEl?: HTMLDivElement | null;
    previewPageEl?: HTMLDivElement | null;
  } = $props();
</script>

<div class="edit" class:hidden={covered} bind:this={splitEl}>
  <div
    class="edit-src"
    class:hidden={editShown === "preview"}
    style:flex-basis={editShown === "split" ? `${splitRatio * 100}%` : null}
    class:part={editShown === "split"}
  >
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
        {restore}
        {onready}
      />
    {/key}
  </div>
  {#if editShown === "split"}
    <!-- 값을 가진 포커스 가능한 separator 는 ARIA 에서 조작 위젯인데 svelte a11y 는 늘 비대화형으로 본다 — 그 두 경고만 끈다 -->
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
          {codeActions}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  /* `DocView` 의 읽기 `.md-page` 와 같은 규칙 — 함께 고친다 */
  .md-page {
    max-width: 920px;
    margin: 0 auto;
    padding: var(--space-4) var(--space-5);
    font-size: calc(var(--t-sm) * var(--doc-zoom, 1));
    line-height: 1.6;
    color: var(--fg-1);
  }

  .edit {
    display: flex;
    height: 100%;
    min-height: 0;
  }

  .edit.hidden {
    display: none;
  }

  .edit-src {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .edit-src.part {
    flex: 0 0 auto;
  }

  .edit-src.hidden {
    display: none;
  }

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

  /* `.sync-hl` 은 `DocView` 의 효과가 DOM 에 단다 */
  .edit-preview :global(.sync-hl) {
    background: var(--surface-hover);
    border-radius: var(--radius);
  }
</style>
