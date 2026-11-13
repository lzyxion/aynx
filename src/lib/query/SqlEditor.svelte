<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { loadEditor } from "$lib/doc-editor-loader";
  import type { EditorHandle } from "$lib/doc-editor-cm";
  import type { CompleteFn } from "$lib/doc-editor-complete";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { blockInsert } from "./definition";
  import type { RunMark } from "./run-panel";

  /**
   * **쿼리 타일의 SQL 편집기** — 문서 편집기의 CodeMirror 몸통(`doc-editor-cm.ts` — 늦게 받는다)을 그대로 빌린다.
   *
   * 키: `Ctrl+Enter` = 실행 · `Alt+X` = 스크립트 실행(2단계 — DBeaver 관례. 둘 다 편집기 안에서만 — 전역 단축키 표에 없다. 편집기
   * 안의 키는 `keybindings.ts` 의 `editorOwnsKey` 가 편집기 몫으로 비켜 준다 — 앱이 편집기 안에서 쥐는 것은 `Ctrl+Shift+…` ·
   * `Alt+화살표` 계열뿐이라 `Alt+X` 와 겹치지 않는다) · `Esc` = 실행 중이면 취소(아니면 편집기의 것 — 검색 패널 닫기).
   * 방언(`lang` — `sql-sqlite` · `sql-postgres` · `sql-mysql`)은 연결이 서야 알므로 바뀌면 다시 건다.
   * 줄 끝은 `\n` 고정 — 편집기 글자 위치가 `getText()` 의 위치와 같아야 실행 범위(`statement-at`)가 맞는다.
   *
   * 스크립트 탭(10-14): 편집기는 하나이고 탭을 바꾸면 글을 바꿔 끼운다(`switchTo` — 탭마다 되돌리기 기록 · 커서 · 실행 표시가 따로
   * 산다, 몸통의 `switchDoc`). 실행 표시(거터 ✓ ↶ ✕ · · 연한 줄 바탕 · 실패 물결 밑줄과 말풍선 — 규칙은 `run-panel`)는 `setMarks`.
   * `onchange` 는 **지금 보이는 탭**의 글이다. `docKey` · `initial` 은 처음 한 번만 읽는다(그 뒤 탭 바꾸기는 `switchTo`).
   *
   * 자동완성(2026-11-10 — `complete`, 몸은 `sql-completer`): 표 · 뷰 · 열 · 키워드. 목록이 떠 있는 동안만 `Enter` · `Tab` = 넣기 · `Esc` = 닫기가
   * 위 키보다 먼저다(없으면 `Esc` 는 그대로 취소 · `Enter` 는 줄바꿈). `Ctrl+Space` = 부르기(앱 단축키 표에 없다 — 편집기 몫). `complete` 도 처음 한 번만 읽는다.
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
    /** 처음 보일 탭의 열쇠 */
    docKey: string;
    /** 처음 보일 탭의 글 */
    initial: string;
    lang: string | null;
    onrun: () => void;
    /** 스크립트 실행(`Alt+X`) */
    onscript: () => void;
    /** 실행 중이면 끊고 `true`(키를 먹는다), 아니면 `false` */
    oncancel: () => boolean;
    onchange: (text: string) => void;
    /** 자동완성 후보 */
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

  // 편집기가 뜨기 전에 탭을 바꿨으면 뜰 때 그 탭으로(`switchTo`)
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

  // 방언이 정해지면(연결이 선 뒤) 다시 건다
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

  /** 보이는 탭을 바꾼다 — `text` 는 그 탭을 처음 볼 때만 쓰인다(이미 본 탭은 넣어 둔 글 그대로) */
  export function switchTo(key: string, text: string): void {
    if (handle) handle.switchDoc(key, text);
    else {
      curKey = key;
      curText = text;
    }
  }

  /** 그 탭의 지금 글(보이는 탭 · 넣어 둔 탭) — 모르면 `null` */
  export function textOf(key: string): string | null {
    if (handle) return handle.textOf(key);
    return key === curKey ? curText : null;
  }

  /** 닫은 탭의 넣어 둔 글을 버린다 */
  export function dropDoc(key: string): void {
    handle?.dropDoc(key);
  }

  /** 그 탭의 실행 표시를 바꾼다(빈 배열 = 지운다) */
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

  /** 커서 자리(선택이 있으면 그 자리)에 글자를 넣는다 — 스키마 트리의 함수·시퀀스 같은 이름 */
  export function insert(text: string): void {
    handle?.insertText(text);
    handle?.focus();
  }

  /**
   * DDL 보기의 [편집기에 넣기] — 커서 자리(선택이 있으면 그 끝)에 문장 덩어리를 넣되 앞뒤 글과 붙지 않게 줄을 띄운다
   * (`query/definition` 의 `blockInsert`). 실행하지 않는다.
   */
  export function insertBlock(text: string): void {
    if (!handle) return;
    const s = handle.selection();
    const pos = Math.max(s.from, s.to);
    handle.insertAt(pos, blockInsert(handle.getText(), pos, text));
    handle.focus();
  }

  // 편집기가 뜨기 전(늦게 받는 CodeMirror)에 포커스를 바랐으면 뜨자마자 준다 — 데이터 탭으로 연 타일에서 처음 [+] 를 누른 경우
  let wantFocus = false;
  export function focus(): void {
    if (handle) handle.focus();
    else wantFocus = true;
  }

  /** 그 범위를 고르고 보이게 — 스크립트 결과에서 문장을 짚을 때(글은 바꾸지 않는다) */
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
