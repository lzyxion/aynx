<script lang="ts">
  /**
   * **줄 코멘트 입력 칸**(고른 범위 바로 아래 — Ctrl+Enter 추가 · Esc 취소) — `DiffView.svelte` 에서 뗀 표시 조각.
   * 쓰는 중인 코멘트(`composer`) · 추가/취소 · 키 처리는 부모가 쥐고, 글(`draft`)과 입력 칸 요소(`composerEl` — 부모가 포커스를 준다)만
   * `bind:` 로 부모 상태에 잇는다. 댓글 상태 · 전송은 여기 없다.
   */
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    composer,
    paneId,
    draft = $bindable(),
    composerEl = $bindable(),
    onComposerKey,
    cancelComposer,
    submitComposer,
  }: {
    composer: { label: string; editing: number | null };
    paneId: string;
    draft: string;
    composerEl: HTMLTextAreaElement | null;
    onComposerKey: (ev: KeyboardEvent) => void;
    cancelComposer: () => void;
    submitComposer: () => void;
  } = $props();
</script>

<div class="composer" data-diff-composer data-find-skip>
  <label for="diff-composer-{paneId}">{t("app.diff.composer.label", { range: composer.label })}</label>
  <textarea
    id="diff-composer-{paneId}"
    rows="2"
    placeholder={t("app.diff.composer.placeholder")}
    bind:this={composerEl}
    bind:value={draft}
    onkeydown={onComposerKey}
  ></textarea>
  <div class="cfoot">
    <span class="hint">{t("app.diff.composer.hint")}</span>
    <button type="button" class="tbtn" data-diff-composer-cancel onclick={cancelComposer}>{t("app.diff.composer.cancel")}</button>
    <button type="button" class="tbtn primary" disabled={draft.trim() === ""} data-diff-composer-submit onclick={submitComposer}
      >{composer.editing !== null ? t("app.diff.composer.save") : t("app.diff.composer.submit")}</button
    >
  </div>
</div>

<style>
  /* 쓰는 중 · 단 코멘트 — 범위 바로 아래, 줄 번호 칸만큼 들여(가로 스크롤해도 왼쪽에 붙어 있다) */
  .composer {
    position: sticky;
    left: 0;
    box-sizing: border-box;
    width: min(640px, calc(100cqw - 120px));
    margin: 6px 12px 8px 104px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-raised-solid);
    font-family: var(--font-ui);
    font-size: 12.5px;
  }

  .composer {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    border-color: var(--accent);
  }

  .composer label {
    font-size: 11.5px;
    color: var(--fg-2);
  }

  .composer textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    resize: vertical;
    padding: var(--space-2) var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--field-radius-multi);
    background: var(--field-bg);
    color: var(--fg);
    font: inherit;
    line-height: 1.5;
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
  }

  .composer textarea:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .composer textarea:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .cfoot {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cfoot .hint {
    flex: 1 1 auto;
    font-size: 11px;
    color: var(--fg-3);
  }

  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-field);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .tbtn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .tbtn.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .tbtn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  /* 강조색 단추 위의 단축키 칩 — 불투명 판 대신 단추 글자색을 옅게 섞은 판 · 선 */
  .tbtn.primary {
    --keycap-fg: var(--on-accent);
    --keycap-bg: color-mix(in srgb, var(--on-accent) 14%, transparent);
    --keycap-line: color-mix(in srgb, var(--on-accent) 32%, transparent);
  }

  .tbtn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .tbtn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
</style>
