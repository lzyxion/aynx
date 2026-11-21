<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { loadEditor } from "$lib/doc-editor-loader";
  import type { EditorHandle } from "$lib/doc-editor-cm";
  import type { CompleteFn } from "$lib/doc-editor-complete";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { blockInsert } from "./definition";
  import type { RunMark } from "./run-panel";

  /**
   * 줄 끝은 `\n` 고정 — 편집기 글자 위치가 `getText()` 의 위치와 같아야 실행 범위(`statement-at`)가 맞는다.
   * `Alt+X` · `Ctrl+Space` 는 편집기 몫이다(전역 단축키 표에 없다 — `keybindings.ts` 의 `editorOwnsKey`).
   * `docKey` · `initial` · `complete` 는 처음 한 번만 읽는다(그 뒤 탭 바꾸기는 `switchTo`).
   */
  let {
    docKey,
    initial,
    lang,
    onrun,
    onscript,
    oncancel,
    onchange,
    complete,
  }: {
    docKey: string;
    initial: string;
    lang: string | null;
    onrun: () => void;
    onscript: () => void;
    /** 실행 중이면 끊고 `true`(키를 먹는다), 아니면 `false` */
    oncancel: () => boolean;
    onchange: (text: string) => void;
    complete?: CompleteFn;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  let handle: EditorHandle | null = null;
  let gone = false;
  let failed = $state<string | null>(null);

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
    };
  }

  // svelte-ignore state_referenced_locally
  let curKey = docKey;
  // svelte-ignore state_referenced_locally
  let curText = initial;

  onMount(() => {
    loadEditor().then(
      (kit) => {
        if (gone || !host) return;
        lastLang = lang;
        handle = kit.createEditor(host, {
          text: curText,
          docKey: curKey,
          runMarks: true,
          ...(complete ? { complete } : {}),
          eol: "\n",
          indent: "  ",
          lang,
          plain: false,
          phrases: phrases(),
          onsave: () => {},
          ondirty: () => {},
          onchange: () => handle && onchange(handle.getText()),
          keys: [
            {
              key: "Mod-Enter",
              run: () => {
                onrun();
                return true;
              },
            },
            {
              key: "Alt-x",
              run: () => {
                onscript();
                return true;
              },
            },
            { key: "Escape", run: () => oncancel() },
          ],
        });
        if (wantFocus) handle.focus();
      },
      (e: unknown) => {
        if (!gone) failed = e instanceof Error ? e.message : String(e);
      },
    );
  });

  let lastLang: string | null | undefined;
  $effect(() => {
    const l = lang;
    if (!handle || l === lastLang) return;
    lastLang = l;
    handle.setLang(l);
  });

  onDestroy(() => {
    gone = true;
    handle?.destroy();
    handle = null;
  });

  export function getText(): string {
    return handle?.getText() ?? curText;
  }

  /** `text` 는 그 탭을 처음 볼 때만 쓰인다(이미 본 탭은 넣어 둔 글 그대로) */
  export function switchTo(key: string, text: string): void {
    if (handle) handle.switchDoc(key, text);
    else {
      curKey = key;
      curText = text;
    }
  }

  export function textOf(key: string): string | null {
    if (handle) return handle.textOf(key);
    return key === curKey ? curText : null;
  }

  export function dropDoc(key: string): void {
    handle?.dropDoc(key);
  }

  export function setMarks(key: string, marks: readonly RunMark[]): void {
    handle?.setRunMarks(marks, key);
  }

  export function selection(): { from: number; to: number } {
    return handle?.selection() ?? { from: 0, to: 0 };
  }

  export function setText(text: string): void {
    handle?.setText(text);
    handle?.focus();
  }

  export function insert(text: string): void {
    handle?.insertText(text);
    handle?.focus();
  }

  export function insertBlock(text: string): void {
    if (!handle) return;
    const s = handle.selection();
    const pos = Math.max(s.from, s.to);
    handle.insertAt(pos, blockInsert(handle.getText(), pos, text));
    handle.focus();
  }

  let wantFocus = false;
  export function focus(): void {
    if (handle) handle.focus();
    else wantFocus = true;
  }

  export function select(from: number, to: number): void {
    handle?.select(from, to);
    handle?.focus();
  }
</script>

<div class="sql-editor" bind:this={host} data-query-editor>
  {#if failed}
    <p class="failed" role="alert">{t("pane.query.editor.failed", { reason: failed })}</p>
  {/if}
</div>

<style>
  .sql-editor {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--surface-field);
  }

  .sql-editor :global(.cm-editor) {
    height: 100%;
  }

  .failed {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--err);
  }
</style>
