<script lang="ts">
  // 여러 줄 붙여넣기 확인의 그림 — 상태 · 붙여넣기 · 포커스 옮기기는 부모가 쥔다.
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  let {
    lines,
    draft = $bindable(),
    confirmBtn = $bindable(),
    onconfirm,
    oncancel,
  }: {
    lines: number;
    draft: string;
    /** 부모가 확인이 뜨면 여기로 포커스를 옮긴다 */
    confirmBtn: HTMLButtonElement | null;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="dialog-veil" role="presentation">
  <!-- Escape 를 여기서 끊는다 — 창 전역까지 올라가면 뒤의 모달 · 오버레이까지 함께 닫힌다 -->
  <div
    class="dialog glass-raised"
    role="dialog"
    aria-modal="true"
    aria-labelledby="paste-title"
    tabindex="-1"
    onkeydown={(ev) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      oncancel();
    }}
  >
    <div class="dialog-title" id="paste-title">
      {tr("pane.term.paste.title", { n: lines })}
    </div>
    <div class="dialog-why">{tr("pane.term.paste.why")}</div>
    <textarea
      class="dialog-preview dialog-edit"
      aria-label={tr("pane.term.paste.edit")}
      title={tr("pane.term.paste.edit.title")}
      spellcheck="false"
      autocomplete="off"
      wrap="off"
      bind:value={draft}
      onkeydown={(ev) => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          onconfirm();
        }
      }}
    ></textarea>
    <div class="dialog-row">
      <button type="button" class="dlg-btn btn btn-secondary btn-sm" onclick={oncancel}>
        {tr("pane.term.paste.cancel")}
      </button>
      <button
        type="button"
        class="dlg-btn primary btn btn-primary btn-sm"
        bind:this={confirmBtn}
        disabled={draft === ""}
        onclick={onconfirm}>{tr("pane.term.paste.confirm")}</button
      >
    </div>
  </div>
</div>

<style>
  /* `browser/TransferPanel.svelte` 의 충돌 확인과 같은 모양이어야 한다 (docs/log/2026-09-05-terminal-context-menu.md) */
  .dialog-veil {
    position: absolute;
    inset: 0;
    z-index: 6; /* 배너(4)·토스트(5) 위 — 답하기 전에는 이것이 이 타일의 전부다 */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: rgb(0 0 0 / 35%);
  }

  .dialog {
    width: min(560px, 100%);
    box-sizing: border-box;
    padding: 10px 12px;
    /* 평면은 불투명이어야 한다 — 밑의 터미널 글자가 비치지 않게 */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-modal);
  }

  .dialog-title {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
  }

  .dialog-why {
    margin-top: 4px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-muted);
  }

  /* 감싸지 않고 가로 스크롤한다 — 감싸면 "몇 줄인가" 가 화면에서 거짓말이 된다 */
  .dialog-preview {
    margin: 8px 0 10px;
    max-height: 96px;
    padding: 6px 8px;
    overflow: auto;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg);
    background: var(--surface-field);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    white-space: pre;
  }

  .dialog-edit {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 160px;
    min-height: 64px;
    max-height: min(60vh, 480px);
    resize: vertical;
    outline: none;
  }

  .dialog-edit:focus {
    border-color: var(--accent);
  }

  .dialog-row {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>
