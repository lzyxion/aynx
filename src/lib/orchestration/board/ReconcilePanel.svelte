<script lang="ts">
  // ---------------------------------------------------------------------------
  // **[조정] 패널**(통합 설계 4-5) — `RunBoard.svelte` 에서 뗀 표시 조각. 두 머리 · 통합된 Task 표(`rec` — 연 순간 서버에서 읽은 것) ·
  // 반려 표시 · 확인 체크를 그린다. 열기 · 읽기 · 실행(`doReconcile` — 본 머리에 묶음)과 상태는 부모 보드가 쥔다. 확인 체크만 `bind:`.
  // ---------------------------------------------------------------------------
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { shortOid, type ReconcilePreview } from "$lib/orchestration/model";

  let {
    rec,
    recReject,
    recConfirm = $bindable(),
    busy,
    toggleRecReject,
    doReconcile,
    oncancel,
  }: {
    rec: ReconcilePreview | null;
    recReject: string[];
    recConfirm: boolean;
    busy: boolean;
    toggleRecReject: (taskId: string, on: boolean) => void;
    doReconcile: (mode: "revert" | "accept") => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="confirm" role="dialog" aria-labelledby="run-rec-title" data-run-reconcile>
  <p class="confirm-title" id="run-rec-title">{t("orch.reconcile.title")}</p>
  {#if !rec}
    <p class="confirm-text">{t("orch.reconcile.loading")}</p>
  {:else}
    <p class="confirm-text mono" data-reconcile-heads>
      {t("orch.reconcile.heads", { expected: shortOid(rec.expectedHead), current: rec.currentHead ? shortOid(rec.currentHead) : t("orch.reconcile.missing") })}
    </p>
    <p class="confirm-text">{t("orch.reconcile.revert.text")}</p>
    <p class="confirm-text">{t("orch.reconcile.accept.text")}</p>
    {#if rec.integrated.length > 0}
      <ul class="rec-list">
        {#each rec.integrated as it (it.taskId)}
          <li data-reconcile-task={it.taskId} data-contained={String(it.contained)}>
            <span class="task-title">{it.title}</span>
            <span class="meta mono">{shortOid(it.integrationCommit)}</span>
            <span class="chip {it.contained === false ? 'warn' : 'faint'}"
              >{it.contained === true ? t("orch.reconcile.contained.yes") : it.contained === false ? t("orch.reconcile.contained.no") : t("orch.reconcile.contained.unknown")}</span>
            <label class="meta" title={t("orch.reconcile.dependents")}>
              <input type="checkbox" checked={recReject.includes(it.taskId)}
                onchange={(e) => toggleRecReject(it.taskId, (e.currentTarget as HTMLInputElement).checked)} />
              {t("orch.reconcile.rejectTask")}
            </label>
          </li>
        {/each}
      </ul>
    {/if}
    <label class="confirm-text">
      <input type="checkbox" bind:checked={recConfirm} data-reconcile-confirm disabled={!rec.currentHead} />
      {t("orch.reconcile.accept.confirm")}
    </label>
  {/if}
  <div class="confirm-actions">
    <button type="button" class="btn btn-sm btn-ghost" onclick={() => oncancel()}>{t("orch.reconcile.cancel")}</button>
    <button type="button" class="btn btn-sm btn-secondary" data-reconcile-accept disabled={busy || !rec || !rec.currentHead || !recConfirm}
      onclick={() => doReconcile("accept")}>{t("orch.reconcile.accept")}</button>
    <button type="button" class="btn btn-sm btn-primary" data-reconcile-revert disabled={busy || !rec}
      onclick={() => doReconcile("revert")}>{t("orch.reconcile.revert")}</button>
  </div>
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: 999px;
    white-space: nowrap;
  }

  .chip.faint {
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
  }

  .rec-list {
    list-style: none;
    margin: var(--space-1) 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .rec-list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-sm);
  }

  .confirm {
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
  }

  .confirm-title {
    margin: 0 0 var(--space-1);
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }

  .confirm-text {
    margin: 0 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip.warn {
    background: var(--warn-soft);
  }

  .task-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .chip.warn {
    background: var(--warn-soft);
    color: var(--fg-1);
  }
</style>
