<script lang="ts">
  /**
   * **여러 줄 붙여넣기 확인의 그림** — `Terminal.svelte` 에서 뗀 표시 조각(2026-10-26 분할 3차): 타일 안 막 · 제목(줄 수) · 까닭 ·
   * 고칠 수 있는 칸 · [취소] [붙여넣기]. 확인 대기(`pastePrompt`) · 붙여넣기(`pasteToTerm` — 입력 출처 `paste`) · 취소 · 포커스 옮기기 `$effect` 는
   * 부모가 쥐고 여기는 그리기만 한다 — 고친 글은 `bind:draft`, [붙여넣기] 단추는 `bind:confirmBtn`(부모가 포커스를 옮긴다), 동작은 콜백.
   * 감싸개 없음 — 부모 `.term` 안 `{#if pastePrompt}` 자리에 그대로 선다.
   */
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  let {
    lines,
    draft = $bindable(),
    confirmBtn = $bindable(),
    onconfirm,
    oncancel,
  }: {
    /** 제목의 줄 수 — 고친 글을 따라간다(부모의 `pasteDraftLines`) */
    lines: number;
    /** 고칠 수 있는 칸의 글 */
    draft: string;
    /** [붙여넣기] 단추 — 부모가 확인이 뜨면 여기로 포커스를 옮긴다 */
    confirmBtn: HTMLButtonElement | null;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="dialog-veil" role="presentation">
  <!--
    키는 여기서 끊는다 — Escape 가 창 전역까지 올라가면 이 확인을 취소하려던 키가
    뒤에 있는 화면(모달·오버레이)까지 함께 닫는다 (`PaneMenu` 의 Escape 와 같은 처방).
  -->
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
  /* ── 여러 줄 붙여넣기 확인 (docs/log/2026-09-05-terminal-context-menu.md) ────
     `browser/TransferPanel.svelte` 의 충돌 확인과 **같은 모양**이다 — 둘 다 "타일 안에서
     지금 답해야 할 것이 하나" 를 말하는 오버레이라, 다르게 생기면 그 뜻이 흐려진다. */
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
    /* 고칠 수 있는 칸이 들어가 넓다 — 타일이 좁으면 타일 폭까지(`.dialog-veil` 의 여백 안) */
    width: min(560px, 100%);
    box-sizing: border-box;
    padding: 10px 12px;
    /* 대화 상자 등급의 뜬 면(10-29) — 터미널 글자 위에 뜬다. 평면은 불투명(`--surface-raised-solid` — 밑의 글자가 비치지
       않게), 글래스는 `.glass-raised` 의 흐림 · 흰 선 · 그림자와 슬라이더를 따르는 판 진하기(theme.css 재질 절).
       움직임이 없어 흐림을 끄는 `opacity` 도 없다 */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface); /* 확인 상자 — 바깥 면(2026-10-25) */
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

  /* 미리보기는 **터미널 글꼴**로 — 붙여넣을 그 글자가 어떻게 보일지가 곧 확인의 내용이다.
     길면 줄 단위로 가로 스크롤한다 (감싸면 "몇 줄인가" 가 화면에서 거짓말이 된다). */
  .dialog-preview {
    margin: 8px 0 10px;
    max-height: 96px;
    padding: 6px 8px;
    overflow: auto;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg);
    /* 필드의 우물 — 다른 대화 상자의 입력 칸과 같은 면(글래스면 유리에 섞인 우물). 예전 `--bg` 는 창 바탕이라
       슬라이더를 타 상자 판보다 옅게 비쳤다 */
    background: var(--surface-field);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    white-space: pre;
  }

  /* 고칠 수 있는 칸 — 미리보기와 같은 글꼴 · 면, 높이는 끌어 늘린다 */
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

  /* 단추 — 전역 `.btn .btn-sm`: 붙여넣기 = 주(기본 갈래), 취소 = 보조(Escape 에도 있는 길).
     옛 선 두른 규칙은 지웠다 (docs/log/2026-09-25-finish-menus.md). `dlg-btn` 은 표식으로만 남는다 */
</style>
