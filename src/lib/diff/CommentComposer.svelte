<script lang="ts">
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
  /* 가로 스크롤해도 왼쪽에 붙어 있게 sticky */
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
