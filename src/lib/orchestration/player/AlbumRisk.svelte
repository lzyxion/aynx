<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  let { full, verify, planTools, autoMerge = false, confirmed = $bindable(false), tag = "new" }: { full: boolean; verify: boolean; planTools: boolean; autoMerge?: boolean; confirmed?: boolean; tag?: string } = $props();
  const uid = $props.id();
</script>
<!-- 긴 위험 설명은 ⓘ 팝오버(목업 V3FoldA — ▶ 펼침 없음 · 그리는 것은 판 뿌리의 `NotePopover` 한 벌) -->
<div class="risk-box" data-new-risk={tag === "new" ? "" : undefined} data-perm-risk={tag === "perm" ? "" : undefined}>
  {#if full}<p>{t("orch.config.risk.short.full")}</p>{/if}
  {#if verify}<p>{t("orch.config.risk.short.verify")}</p>{/if}
  {#if planTools}<p>{t("orch.new.planRisk")}</p>{/if}
  {#if autoMerge}<p data-risk-auto-merge>{t("orch.config.risk.short.autoMerge")}</p>{/if}
  <div class="more" data-risk-more>
    <InfoNote id="risk-{tag}-{uid}" label={t("orch.config.risk.more")} plain>
      {#snippet summary()}<span>{t("orch.config.risk.more")}</span>{/snippet}
      {#snippet note()}<p class="note">{t("orch.config.full.risk.text")}</p><p class="note">{t("orch.config.verify.risk.inject")}</p>{/snippet}
    </InfoNote>
  </div>
  <label><input type="checkbox" data-new-risk-confirm={tag === "new" ? "" : undefined} data-perm-risk-confirm={tag === "perm" ? "" : undefined} bind:checked={confirmed} />{t("orch.config.risk.confirm")}</label>
</div>
<style>
  .risk-box { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 12px 18px; border: 1px solid var(--warn); border-radius: var(--radius-surface-inner); background: var(--warn-soft); }
  p, label { margin: 0; font-size: var(--t-xs); line-height: 1.6; color: var(--fg-1); }
  .more { font-size: var(--t-xs); line-height: 1.6; color: var(--fg-2); }
  .note { margin: 0 0 6px; color: var(--fg-2); }
  .note:last-child { margin-bottom: 0; }
  label { display: flex; gap: 8px; align-items: center; }
</style>
