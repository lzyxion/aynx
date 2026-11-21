<script lang="ts">
  /**
   * 문서 편집기 — CodeMirror 는 정적으로 들이지 않는다(`doc-editor-loader` 가 처음 편집할 때 받는다).
   * 글은 처음 한 번만 받는다 — 다시 불러오기는 상위가 `{#key}` 로 새로 세운다. (docs/log/2026-09-27-doc-edit.md)
   * `onready` 는 편집기가 실제로 섰을 때만 — 지연 로딩이 실패했는데 부르면 상위가 옮겨 온 초안을 놓는다.
   */
  import { onDestroy, onMount, untrack } from "svelte";
  import { loadEditor } from "$lib/doc-editor-loader";
  import type { EditorHandle, EditorSnapshot } from "$lib/doc-editor-cm";
  import type { DocEditorRestore } from "$lib/doc-draft";
  import type { DocFormat } from "$lib/doc-format";
  import { detectEol, detectIndent, editorLangOf } from "$lib/doc-edit";
  import { tooLargeToHighlight } from "$lib/highlight-size";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    text,
    path,
    autofocus = true,
    onsave,
    ondirty,
    onchange,
    oncursor,
    onviewport,
    onfailed,
    restore,
    onready,
  }: {
    /** 처음 한 번만 읽는다 */
    text: string;
    path: string;
    autofocus?: boolean;
    onsave: () => void;
    ondirty: (dirty: boolean) => void;
    onchange?: () => void;
    /** 0 기준 */
    oncursor?: (line: number) => void;
    /** 0 기준 */
    onviewport?: (top: number, bottom: number) => void;
    onfailed?: (message: string) => void;
    /** 처음 한 번만 읽는다 */
    restore?: DocEditorRestore | null;
    onready?: () => void;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let handle: EditorHandle | null = null;
  let ready = $state(false);
  let gone = false;

  /** 열쇠는 CodeMirror 의 영어 원문이다 */
  function phrases(): Record<string, string> {
    return {
      Find: t("files.doc.editor.find"),
      Replace: t("files.doc.editor.replace"),
      next: t("files.doc.editor.next"),
      previous: t("files.doc.editor.previous"),
      all: t("files.doc.editor.all"),
      "match case": t("files.doc.editor.matchcase"),
      regexp: t("files.doc.editor.regexp"),
      "by word": t("files.doc.editor.byword"),
      replace: t("files.doc.editor.replaceone"),
      "replace all": t("files.doc.editor.replaceall"),
      close: t("files.doc.editor.close"),
      "Go to line": t("files.doc.editor.gotoline"),
      go: t("files.doc.editor.go"),
    };
  }

  onMount(() => {
    const initial = untrack(() => text);
    const p = untrack(() => path);
    const r = untrack(() => restore) ?? null;
    loadEditor().then(
      (kit) => {
        if (gone || !host) return;
        handle = kit.createEditor(host, {
          text: initial,
          eol: r ? r.eol : detectEol(initial),
          indent: detectIndent(initial),
          lang: editorLangOf(p),
          plain: tooLargeToHighlight(initial),
          phrases: phrases(),
          onsave: () => onsave(),
          ondirty: (d) => ondirty(d),
          onchange: () => onchange?.(),
          oncursor: (line) => oncursor?.(line),
          onviewport: (top, bottom) => onviewport?.(top, bottom),
          ...(r
            ? { baseText: r.baseText, restore: { selection: r.selection, scrollPos: r.scrollPos, history: r.history } }
            : {}),
        });
        ready = true;
        if (autofocus) handle.focus();
        onready?.();
      },
      (e: unknown) => {
        if (gone) return;
        onfailed?.(e instanceof Error ? e.message : String(e));
      },
    );
  });

  onDestroy(() => {
    gone = true;
    handle?.destroy();
    handle = null;
  });

  export function getText(): string {
    return handle ? handle.getText() : text;
  }

  /** 편집기가 아직 서지 않았으면 `null` — 상위가 창 넘기기를 거절한다 */
  export function draft(): EditorSnapshot | null {
    return handle ? handle.snapshot() : null;
  }

  /** 지금 글의 정체(바뀌면 다른 값) */
  export function docRef(): object | null {
    return handle ? handle.docRef() : null;
  }

  export function setFrozen(on: boolean): void {
    handle?.setFrozen(on);
  }

  export function markSaved(saved: string): void {
    handle?.markSaved(saved);
  }

  /** 0 기준 */
  export function cursorLine(): number {
    return handle ? handle.cursorLine() : 0;
  }

  export function focus(): void {
    handle?.focus();
  }

  export function openSearch(): void {
    handle?.openSearch();
  }

  /** 글자 크기가 바뀌면 부른다 */
  export function remeasure(): void {
    handle?.remeasure();
  }

  /** 0 기준 */
  export function lineText(line: number): string | null {
    return handle ? handle.lineText(line) : null;
  }

  export function command(cmd: "undo" | "redo" | "selectAll"): void {
    handle?.command(cmd);
  }

  export function historyState(): { undo: boolean; redo: boolean } {
    return handle ? handle.historyState() : { undo: false, redo: false };
  }

  export function selectedText(): string {
    return handle ? handle.selectedText() : "";
  }

  export function insertText(text: string): void {
    handle?.focus();
    handle?.insertText(text);
  }

  export function format(kind: DocFormat): void {
    handle?.format(kind);
  }

  /** 그 줄 안 `[from, to)` 열을 바꾼다 */
  export function replaceInLine(line: number, from: number, to: number, insert: string): boolean {
    return handle ? handle.replaceInLine(line, from, to, insert) : false;
  }
</script>

<div class="doc-editor" bind:this={host}>
  {#if !ready}<p class="note">{t("files.doc.editor.loading")}</p>{/if}
</div>

<style>
  .doc-editor {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .doc-editor :global(.cm-editor) {
    height: 100%;
  }

  .note {
    margin: 0;
    padding: var(--space-4);
    font-size: 12px;
    color: var(--fg-2);
  }
</style>
