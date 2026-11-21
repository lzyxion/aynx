<script lang="ts">
  import { baseNameOf } from "$lib/fs-backend";
  import { formatSize } from "$lib/sftp-browser";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Conflict, OnConflict } from "$lib/fs-ops";
  import type { TransferJob } from "$lib/browser/fs-transfer.svelte";

  let {
    job,
    percent,
    pending,
    hint = null,
    oncancel,
    onresolve,
    ondismiss,
  }: {
    job: TransferJob | null;
    percent: number;
    pending: { conflicts: Conflict[] } | null;
    hint?: string | null;
    oncancel: () => void;
    onresolve: (policy: OnConflict) => void;
    ondismiss: () => void;
  } = $props();

  const conflictNames = $derived(
    pending
      ? pending.conflicts
          .slice(0, 3)
          .map((c) => baseNameOf(c.path))
          .join(", ")
      : "",
  );
</script>

{#if hint}
  <div class="hint">{hint}</div>
{/if}

<!-- [취소] 는 `job.op === 0`(같은 곳 안의 이동)에 붙지 않는다 — 멈출 청크 경계가 없다 -->
{#if job}
  <div class="transfer">
    <span class="tr-name" title={job.current}>
      {t(job.labelKey)}{job.filesTotal > 0 ? ` ${job.filesDone}/${job.filesTotal}` : ""}
    </span>
    <div class="tr-bar"><div class="tr-fill" style:width={`${percent}%`}></div></div>
    <span class="tr-num">
      {formatSize(job.bytesDone)}{job.bytesTotal > 0
        ? ` / ${formatSize(job.bytesTotal)} · ${percent}%`
        : ""}
    </span>
    {#if job.op !== 0}
      <button type="button" class="tr-cancel btn btn-sm btn-ghost" disabled={job.canceling} onclick={oncancel}>
        {job.canceling ? t("files.transfer.canceling") : t("files.transfer.cancel")}
      </button>
    {/if}
  </div>
{/if}

{#if pending}
  <div class="dialog-veil" role="presentation">
    <div class="dialog glass-raised" role="dialog" aria-modal="true" aria-label={t("files.transfer.conflict.aria")}>
      <div class="dialog-title">
        {pending.conflicts.length === 1
          ? t("files.transfer.conflict.title.one")
          : t("files.transfer.conflict.title.other", { count: pending.conflicts.length })}
      </div>
      <div class="dialog-body">
        {pending.conflicts.length > 3
          ? t("files.transfer.conflict.more", {
              names: conflictNames,
              count: pending.conflicts.length - 3,
            })
          : conflictNames}
      </div>
      <div class="dialog-row">
        <button type="button" class="dlg-btn btn btn-sm btn-ghost" onclick={ondismiss}>{t("files.transfer.cancel")}</button>
        <button type="button" class="dlg-btn btn btn-sm btn-secondary" onclick={() => onresolve("skip")}>
          {t("files.transfer.conflict.skip")}
        </button>
        <button type="button" class="dlg-btn btn btn-sm btn-secondary" onclick={() => onresolve("rename")}>
          {t("files.transfer.conflict.rename")}
        </button>
        <button type="button" class="dlg-btn danger btn btn-sm" onclick={() => onresolve("overwrite")}>
          {t("files.transfer.conflict.overwrite")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .transfer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 10px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-muted);
  }

  .hint {
    flex: 0 0 auto;
    padding: 4px 10px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tr-name {
    flex: 0 1 auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
  }

  /* 진행 막대는 중성이다 — 강조색 막대는 "누르라" 로 읽혔다 */
  .tr-bar {
    flex: 1 1 auto;
    height: 4px;
    background: var(--surface-hover);
    border-radius: 2px;
    overflow: hidden;
  }

  .tr-fill {
    height: 100%;
    background: var(--fg-2);
    transition: width 120ms linear;
  }

  .tr-num {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
  }

  .tr-cancel {
    flex: 0 0 auto;
  }

  /* ── 충돌 확인 대화상자 ──────────────────────────────────────────────────── */

  .dialog-veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: rgb(0 0 0 / 35%);
  }

  .dialog {
    max-width: 320px;
    padding: 10px 12px;
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

  .dialog-body {
    margin: 6px 0 10px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }

  .dialog-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* `dlg-btn` 은 표식으로만 남는다 */
  .dlg-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .dlg-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
