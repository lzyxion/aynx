<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { loadEditor } from "$lib/doc-editor-loader";
  import type { EditorHandle } from "$lib/doc-editor-cm";
  import { writeClipboard } from "$lib/clipboard";
  import { toast } from "$lib/toast.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { DbDefinition, DbDefinitionKind, DbDefinitionTarget, DbDialect } from "./query-backend";
  import type { Load } from "./schema-tree";
  import { definitionName } from "./definition";

  /**
   * **DDL 읽기 전용 보기** — 쿼리 타일 아래 칸의 "DDL" 쪽(위의 [결과 | DDL] 전환 — `QueryView`). 서버 op `db_definition` 의 답
   * (`query/definition` · Rust `db::definition`)을 **읽기 전용** CodeMirror(SQL 방언 색칠 — `doc-editor-cm` 의 `readOnly`)에 보인다.
   *
   * 머리줄: 종류 · 이름(`스키마.이름` — 표시용) · 재구성 표시(PG 테이블 · 시퀀스 · 형 · 집계 — "카탈로그로 재구성한 정의") · 잘림 표시 ·
   * [복사] · [편집기에 넣기](편집기 커서 자리 — 앞뒤 글과 줄을 띄운다 · **실행하지 않는다**). 실행 · 쓰기 단추는 없다.
   */
  let {
    target,
    dialect,
    load,
    oninsert,
  }: {
    target: DbDefinitionTarget;
    dialect: DbDialect;
    load: Load<DbDefinition>;
    /** 편집기에 넣기 — 부르는 쪽이 `SqlEditor.insertBlock` 으로 */
    oninsert: (sql: string) => void;
  } = $props();

  let host = $state<HTMLElement | null>(null);
  let handle: EditorHandle | null = null;
  let gone = false;
  let failed = $state<string | null>(null);

  const sql = $derived(load.state === "ok" ? load.value.sql : "");

  onMount(() => {
    loadEditor().then(
      (kit) => {
        if (gone || !host) return;
        handle = kit.createEditor(host, {
          text: sql,
          eol: "\n",
          indent: "  ",
          lang: `sql-${dialect}`,
          plain: false,
          readOnly: true,
          phrases: {
            Find: t("files.doc.editor.find"),
            next: t("files.doc.editor.next"),
            previous: t("files.doc.editor.previous"),
            all: t("files.doc.editor.all"),
            "match case": t("files.doc.editor.matchcase"),
            regexp: t("files.doc.editor.regexp"),
            "by word": t("files.doc.editor.byword"),
            close: t("files.doc.editor.close"),
          },
          onsave: () => {},
          ondirty: () => {},
        });
        shown = sql;
      },
      (e: unknown) => {
        if (!gone) failed = e instanceof Error ? e.message : String(e);
      },
    );
  });

  // 대상이 바뀌어 새 글이 오면 바꿔 끼운다(읽기 전용이어도 앱이 보내는 글은 들어간다)
  let shown = "";
  $effect(() => {
    const s = sql;
    if (!handle || s === shown) return;
    shown = s;
    handle.setText(s);
  });

  onDestroy(() => {
    gone = true;
    handle?.destroy();
    handle = null;
  });

  const KIND_LABEL: Record<DbDefinitionKind, string> = {
    table: "pane.query.schema.folder.table",
    view: "pane.query.schema.folder.view",
    matview: "pane.query.schema.folder.matview",
    foreign: "pane.query.schema.folder.foreign",
    function: "pane.query.schema.folder.function",
    procedure: "pane.query.schema.folder.procedure",
    sequence: "pane.query.schema.folder.sequence",
    type: "pane.query.schema.folder.type",
    index: "pane.query.schema.part.indexes",
    trigger: "pane.query.schema.part.triggers",
    constraint: "pane.query.schema.part.constraints",
  };
  const kindLabel = $derived(t(KIND_LABEL[target.kind] as "pane.query.schema.folder.table"));
  const name = $derived(definitionName(dialect, target));

  async function copy() {
    if (load.state !== "ok") return;
    if (await writeClipboard(load.value.sql)) toast.info(t("pane.query.def.copied"));
    else toast.error(t("pane.query.def.copyFailed"));
  }
</script>

<div class="def" data-query-definition={load.state}>
  <div class="head">
    <span class="kind">{kindLabel}</span>
    <span class="name" title={name}>{name}</span>
    {#if load.state === "ok" && load.value.reconstructed}
      <span class="tag" title={t("pane.query.def.reconstructed.title")} data-query-def-reconstructed>{t("pane.query.def.reconstructed")}</span>
    {/if}
    {#if load.state === "ok" && load.value.truncated}
      <span class="tag warn">{t("pane.query.def.truncated")}</span>
    {/if}
    <span class="sp"></span>
    <button type="button" class="btn" disabled={load.state !== "ok"} onclick={() => void copy()} data-query-def-copy
      ><UiIcon name="copy" size={12} /><span class="label">{t("pane.query.def.copy")}</span></button
    >
    <button
      type="button"
      class="btn"
      disabled={load.state !== "ok"}
      title={t("pane.query.def.insert.title")}
      onclick={() => load.state === "ok" && oninsert(load.value.sql)}
      data-query-def-insert><UiIcon name="paste" size={12} /><span class="label">{t("pane.query.def.insert")}</span></button
    >
  </div>
  {#if load.state === "ok" && load.value.reconstructed}
    <p class="note">{t("pane.query.def.reconstructed.title")}</p>
  {/if}
  <div class="body">
    <div class="cm" class:hidden={load.state !== "ok"} bind:this={host} aria-label={t("pane.query.def.aria")}></div>
    {#if failed}
      <p class="msg err" role="alert">{t("pane.query.editor.failed", { reason: failed })}</p>
    {:else if load.state === "loading"}
      <p class="msg">{t("pane.query.def.loading")}</p>
    {:else if load.state === "error"}
      <pre class="msg err" role="alert">{load.message}</pre>
    {/if}
  </div>
</div>

<style>
  .def {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 8px;
    font-size: 11px;
    color: var(--fg-2);
    border-bottom: 1px solid var(--line);
  }

  .kind {
    flex: 0 0 auto;
    color: var(--fg-3);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    color: var(--fg-1);
  }

  .tag {
    flex: 0 0 auto;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    white-space: nowrap;
  }

  .tag.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }

  .sp {
    flex: 1 1 auto;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn:focus-visible {
    outline: 1px solid var(--focus-border);
    outline-offset: -1px;
  }

  .note {
    flex: 0 0 auto;
    margin: 0;
    padding: 3px 10px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    border-bottom: 1px solid var(--line);
  }

  .body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    background: var(--surface-field);
  }

  .cm {
    height: 100%;
    overflow: hidden;
  }

  .cm.hidden {
    display: none;
  }

  .cm :global(.cm-editor) {
    height: 100%;
  }

  .msg {
    margin: 0;
    padding: var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg.err {
    color: var(--fg-1);
    background: var(--err-soft);
    user-select: text;
  }

  @container qtile (max-width: 480px) {
    .btn .label {
      display: none;
    }
  }
</style>
