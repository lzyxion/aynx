<script lang="ts">
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { closeDbWriteConfirm, dbWriteConfirm as prompt } from "$lib/app/query.svelte.js";

  // **쓰기 켜기 확인** (쿼리 타일 10단계, docs/log/2026-10-12-query-tile.md) — 상태는 `app/query.svelte.ts`, Escape 사슬 ·
  // `anyModalOpen` 은 `app/keys`. 꼴은 `WorkspaceDeleteDialog` 와 같다(Tab 순환 `trapTab` · 바깥 누르기 = 취소). 첫 포커스는
  // **[취소]** 다 — 위험 쪽 단추가 Enter 한 번에 눌리지 않게.
  let cancelBtn = $state<HTMLButtonElement | null>(null);
  let modalEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (prompt.open && cancelBtn) void tick().then(() => cancelBtn?.focus());
  });
</script>

{#if prompt.open}
  <div
    class="overlay"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget) closeDbWriteConfirm(false);
    }}
  >
    <div
      class="modal glass-raised"
      data-db-write-confirm
      role="dialog"
      tabindex="-1"
      aria-label={t("pane.query.write.confirm.title")}
      bind:this={modalEl}
      onkeydown={(ev) => {
        if (modalEl && trapTab(ev, modalEl)) return;
        ev.stopPropagation();
        if (ev.code === "Escape") {
          ev.preventDefault();
          closeDbWriteConfirm(false);
        }
      }}
    >
      <form
        onsubmit={(ev) => {
          ev.preventDefault();
          closeDbWriteConfirm(true);
        }}
      >
        <h2>{t("pane.query.write.confirm.title")}</h2>
        <p>{t("pane.query.write.confirm.body", { target: prompt.target })}</p>
        <div class="actions">
          <button type="button" class="btn btn-secondary" bind:this={cancelBtn} onclick={() => closeDbWriteConfirm(false)}
            >{t("pane.query.write.confirm.cancel")}</button
          >
          <button type="submit" class="btn danger-solid" data-db-write-submit>{t("pane.query.write.confirm.submit")}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.3);
  }
  .modal {
    width: 400px;
    max-width: calc(100vw - 32px);
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
    color: var(--fg-1);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
  }
  p {
    font-size: var(--t-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  /* 위험 단추 — src/lib/console/PlanList.svelte · WorkspaceDeleteDialog 와 같은 꼴 */
  .btn.danger-solid {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }

  .btn.danger-solid:hover {
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }
</style>
