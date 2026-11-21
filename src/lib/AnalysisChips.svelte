<script lang="ts">
  /**
   * 앱 분석 칩 줄 — 판정은 Rust 의 `analysis` · `mismatch` 그대로다(판정을 두 벌 두지 않는다).
   * 프로그램 사슬 칩은 쓰지 않는다 — 명령을 되풀이할 뿐이다.
   */
  import type { ComputedEffect, Operation } from "$lib/operations";
  import { analysisChips, type AnalysisChip } from "$lib/review-card";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    op: Operation;
    autoRefused?: string | null;
    only?: AnalysisChip["kind"][];
  }
  let { op, autoRefused = null, only }: Props = $props();

  const chips = $derived(analysisChips(op, autoRefused).filter((c) => !only || only.includes(c.kind)));
  const labelled = $derived(!!op.analysis && !only);

  function effectWord(e: ComputedEffect): string {
    return t(`app.review.effect.${e}` as "app.review.effect.read");
  }

  function chipText(c: AnalysisChip): string {
    switch (c.kind) {
      case "effect":
        return c.declared ? t("app.review.declared.match", { effect: effectWord(c.effect) }) : effectWord(c.effect);
      case "mismatch": {
        const w = effectWord(c.effect);
        return t("app.review.declared.mismatch", { found: c.cause ? `${w}(${c.cause})` : w });
      }
      case "sudo":
        return t("app.review.sudo");
      case "stmt": {
        const head = c.table ? `${c.keyword} ${c.table}` : c.keyword;
        if (c.where === null) return head;
        return `${head} · ${t(c.where ? "app.review.db.where" : "app.review.db.nowhere")}`;
      }
      case "limit":
        return t("app.review.db.limit", { n: c.n });
      case "refused":
        return `${t("app.review.autoRefused")} — ${c.reason}`;
    }
  }

  function chipTitle(c: AnalysisChip): string {
    if (c.kind === "mismatch") {
      return t("app.review.declared.mismatch.title", {
        declared: t(`app.review.declared.${c.declared}` as "app.review.declared.read"),
      });
    }
    if (c.kind === "sudo") return t("app.review.sudo.title");
    return chipText(c);
  }
</script>

{#if chips.length > 0}
  <div class="achips" data-review-mismatch={op.mismatch === true}>
    {#if labelled}
      <span class="alabel" title={t("app.review.analysis.title")}>{t("app.review.analysis")}</span>
    {/if}
    {#each chips as chip, i (i)}
      {#if chip.kind === "stmt"}
        <span class="achip mono {chip.tone}" data-chip="stmt" title={chipTitle(chip)}
          ><span class="tok {chip.keywordTone}" data-tone={chip.keywordTone}>{chip.keyword}</span>{chipText(chip).slice(
            chip.keyword.length,
          )}</span
        >
      {:else}
        <span class="achip {chip.tone}" data-chip={chip.kind} title={chipTitle(chip)}>{chipText(chip)}</span>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .achips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    max-height: calc(2 * 20px + var(--space-1));
    overflow: hidden;
  }
  .alabel {
    flex: none;
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-3);
  }
  .achip {
    max-width: 100%;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-2);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .achip.mono {
    font-family: var(--font-mono, monospace);
  }
  .achip.ok {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .achip.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .tok.err {
    color: var(--err);
    font-weight: var(--fw-semibold);
  }
  .tok.warn {
    color: var(--warn);
  }
  .achip.err {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }
</style>
