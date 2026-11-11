<script lang="ts">
  /**
   * **문서 편집기** — 문서 보기 타일의 편집 모드 몸통 (문서 편집 E1 · docs/log/2026-09-27-doc-edit.md).
   *
   * CodeMirror 는 여기서도 정적으로 들이지 않는다: `doc-editor-loader` 가 처음 편집할 때 한 번 받아 오고,
   * 이 컴포넌트는 그 손잡이(`EditorHandle`)만 쥔다. 받기 전에는 "편집기를 불러오는 중…" 한 줄이다.
   *
   * 글은 **처음 한 번만** 받는다(`text` 프롭을 나중에 바꿔도 편집기를 덮지 않는다). 다시 불러오기는 상위가
   * `{#key}` 로 이 컴포넌트를 새로 세운다 — 되돌리기 기록 · 줄 끝 판정이 새 글에서 다시 시작한다.
   *
   * 저장 · dirty 판정의 기준 글은 편집기 안에 있고, 상위는 [`getText`] · [`markSaved`] 로만 묻고 알린다.
   *
   * 다른 창에서 옮겨 온 초안(`doc-draft.ts`)이면 상위가 [`restore`] 를 준다 — 줄 끝 · 기준 글(모르면 `null` = 저장할 때까지 dirty) ·
   * 선택 · 화면 맨 위 줄 · 실행 취소 기록을 되살려 선다. 편집기가 **실제로 섰을 때만** [`onready`] 를 부른다(지연 로딩이 실패하면
   * 부르지 않는다 — 상위가 초안을 놓지 않게). 창을 넘길 때는 상위가 [`draft`] 로 지금 상태를 뜬다.
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
    /** 편집을 시작할 글(처음 한 번만 읽는다) */
    text: string;
    /** 언어를 고르는 데만 쓴다 */
    path: string;
    /** 서자마자 포커스를 가져가는가 */
    autofocus?: boolean;
    /** 편집기 안의 `Ctrl+S` */
    onsave: () => void;
    /** 저장해 둔 글과 달라졌는가가 바뀔 때 */
    ondirty: (dirty: boolean) => void;
    /** 글이 바뀌었다(미리 보기의 디바운스가 받는다) */
    onchange?: () => void;
    /** 커서 줄이 바뀌었다 — 0 기준 */
    oncursor?: (line: number) => void;
    /** 스크롤해서 보이는 줄 범위가 바뀌었다 — 0 기준 */
    onviewport?: (top: number, bottom: number) => void;
    /** 편집기 모듈을 받지 못했다 */
    onfailed?: (message: string) => void;
    /** 되살릴 편집 상태(옮겨 온 초안 — 처음 한 번만 읽는다) */
    restore?: DocEditorRestore | null;
    /** 편집기가 섰다(지연 로딩 성공 · 처음 글을 들였다) */
    onready?: () => void;
  } = $props();

  let host = $state<HTMLDivElement | null>(null);
  let handle: EditorHandle | null = null;
  let ready = $state(false);
  let gone = false;

  /** 검색 패널 등의 문구 — CodeMirror 의 영어 원문 → 화면 문구 */
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

  /** 지금 글 — 편집기가 아직 서지 않았으면 처음 받은 글 그대로다 */
  export function getText(): string {
    return handle ? handle.getText() : text;
  }

  /** 창을 넘길 편집 상태 — 편집기가 아직 서지 않았으면 `null`(뜰 수 없다 = 상위가 창 넘기기를 거절한다) */
  export function draft(): EditorSnapshot | null {
    return handle ? handle.snapshot() : null;
  }

  /** 지금 글의 정체(바뀌면 다른 값) — 편집기가 아직 서지 않았으면 `null` */
  export function docRef(): object | null {
    return handle ? handle.docRef() : null;
  }

  /** 잠시 읽기 전용 — 편집기가 아직 서지 않았으면 아무것도 하지 않는다 */
  export function setFrozen(on: boolean): void {
    handle?.setFrozen(on);
  }

  /** 이 글을 저장했다 */
  export function markSaved(saved: string): void {
    handle?.markSaved(saved);
  }

  /** 커서 줄(0 기준) — 편집기가 아직 서지 않았으면 0 */
  export function cursorLine(): number {
    return handle ? handle.cursorLine() : 0;
  }

  export function focus(): void {
    handle?.focus();
  }

  /** 검색 패널 — 편집기가 아직 서지 않았으면 아무것도 하지 않는다 */
  export function openSearch(): void {
    handle?.openSearch();
  }

  /** 글자 크기가 바뀌었다 — 편집기가 다시 잰다(아직 서지 않았으면 처음 잴 때 새 크기다) */
  export function remeasure(): void {
    handle?.remeasure();
  }

  /** 그 줄(0 기준)의 글 — 편집기가 아직 서지 않았거나 없는 줄이면 `null` */
  export function lineText(line: number): string | null {
    return handle ? handle.lineText(line) : null;
  }

  /** 우클릭 메뉴의 편집 명령 · 상태 · 서식 — 편집기가 아직 서지 않았으면 아무것도 하지 않는다(상태는 "없음") */
  export function command(cmd: "undo" | "redo" | "selectAll"): void {
    handle?.command(cmd);
  }

  export function historyState(): { undo: boolean; redo: boolean } {
    return handle ? handle.historyState() : { undo: false, redo: false };
  }

  export function selectedText(): string {
    return handle ? handle.selectedText() : "";
  }

  /** 고른 글을 이 글로 바꾼다(잘라내기 · 붙여넣기 — 되돌리기 기록에 남는다) */
  export function insertText(text: string): void {
    handle?.focus();
    handle?.insertText(text);
  }

  export function format(kind: DocFormat): void {
    handle?.format(kind);
  }

  /** 그 줄 안 `[from, to)` 열을 바꾼다(되돌리기 기록에 남는다) — 편집기가 아직 서지 않았으면 `false` */
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

  /* 편집기 뿌리는 CodeMirror 가 이 상자 안에 붙인다 — 높이를 채운다 */
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
