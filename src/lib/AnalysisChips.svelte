<script lang="ts">
  /**
   * **앱 분석 칩 줄**(승인 요약 — docs/log/2026-10-21-approval-summary.md) — 화면 아래 검토 카드(`ReviewCard`)와 작업안 타일의
   * 카드(`console/PlanList`)가 같은 조각을 쓴다(둘이 어긋나지 않게).
   *
   * 고르는 것은 순수 함수 `analysisChips`(Rust 의 `analysis` · `mismatch` 그대로 — 판정을 두 벌 두지 않는다), 글자는 여기서 `t()` 로.
   * 두 줄까지(넘치면 잘린다 · 칩마다 말풍선에 전문). 첫 칸 `앱 분석` 표지는 분석이 있을 때만 — 옛 작업안이면 자동 승인 거부 사유
   * 칩 하나만 서거나 아무것도 없다. `only` 를 주면 그 종류만 그린다.
   *
   * **10-24 "A + 명령 나눠 보기"** 부터 두 카드는 `only` 로만 부른다 — DB 문장 · 상한(`stmt` · `limit`).
   * 효과 · 어긋남은 카드 맨 위 판결 띠(`VerdictBand`)가, sudo · 자동 승인 거부는 메타 줄이 말한다. 프로그램 사슬 칩은 걷었다(명령을
   * 되풀이할 뿐이었다 — 줄마다의 효과는 `CommandLines` 가 줄 옆에 보인다).
   */
  import type { ComputedEffect, Operation } from "$lib/operations";
  import { analysisChips, type AnalysisChip } from "$lib/review-card";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    op: Operation;
    /** 자동 승인 거부 사유(서버가 쥔 그 글) — 없으면 `null` */
    autoRefused?: string | null;
    /** 이 종류만(없으면 전부) */
    only?: AnalysisChip["kind"][];
  }
  let { op, autoRefused = null, only }: Props = $props();

  const chips = $derived(analysisChips(op, autoRefused).filter((c) => !only || only.includes(c.kind)));
  const labelled = $derived(!!op.analysis && !only);

  /** 앱이 매긴 효과 → 낱말 */
  function effectWord(e: ComputedEffect): string {
    return t(`app.review.effect.${e}` as "app.review.effect.read");
  }

  /** 칩 하나의 글자 */
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

  /** 말풍선 — 어긋남은 AI 가 무엇이라 했는지, 나머지는 글자 전부(말줄임된 칩을 읽게) */
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
  /* 두 줄까지(칩 20px · 사이 4px). 넘치면 잘린다 */
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
  /* 칩 안 낱말의 색 — 삭제 = 실패색, 쓰기 · 확인 필요 = 경고색(판은 칩의 것 그대로) */
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
