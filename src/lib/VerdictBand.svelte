<script lang="ts">
  /**
   * **판결 띠**(10-24 "A + 명령 나눠 보기") — 검토 카드(`ReviewCard`)와 작업안 카드(`console/PlanList`) 맨 위의 가장자리까지 닿는
   * 한 줄. 이 명령이 무엇인지 · AI 설명과 맞는지를 **한 문장**으로 말한다. 예전에 제목 줄의 위험 배지 · 효과 칩 · 어긋남 칩이 각자
   * 실패색으로 말하던 것을 여기 하나로 모았다(빨강이 네 번 되풀이되던 카드).
   *
   * 문장의 열쇠와 날것의 값은 순수 함수 `verdictOf`(review-card.ts — 판정은 Rust 의 `mismatch` · 줄마다의 `over` 그대로)가 고르고,
   * 여기서는 `t()` 로 글자만 만든다. 오른쪽 끝(`end`)에는 부모가 ‹ i / N › · 만료 · 접기 같은 것을 둔다.
   *
   * 가장자리까지 닿게 하는 것은 부모의 몫이다(카드의 `overflow: hidden` + 음수 여백) — 이 조각은 판의 색과 줄만 그린다.
   */
  import type { Snippet } from "svelte";
  import type { ComputedEffect } from "$lib/operations";
  import type { Verdict } from "$lib/review-card";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    verdict: Verdict;
    /** 오른쪽 끝 — 이동 · 만료 · 접기(없으면 비운다) */
    end?: Snippet;
  }
  let { verdict, end }: Props = $props();

  /** 원문에서 찾은 것 — 낱말 + "(근거)" */
  function found(e: ComputedEffect | undefined, cause: string | null | undefined): string {
    const w = t(`app.review.found.${e ?? "unknown"}` as "app.review.found.read");
    return cause ? `${w}(${cause})` : w;
  }

  const text = $derived.by(() => {
    const a = verdict.args;
    const declared = a.declared ? t(`app.review.declared.${a.declared}` as "app.review.declared.read") : "";
    const what = t(`app.review.verdict.what.${a.found ?? "unknown"}` as "app.review.verdict.what.read");
    return t(`app.review.verdict.${verdict.key}` as "app.review.verdict.pending", {
      declared,
      found: found(a.found, a.cause),
      n: a.n ?? 0,
      m: a.m ?? 0,
      what,
    });
  });

  const ICON = { ok: "shield-check", neutral: "info", warn: "warning", err: "alert-caution" } as const;
</script>

<div class="vband {verdict.tone}" data-verdict={verdict.tone} data-verdict-key={verdict.key}>
  <span class="vicon" aria-hidden="true"><UiIcon name={ICON[verdict.tone]} size={14} /></span>
  <span class="vtext">{text}</span>
  {#if end}<span class="vend">{@render end()}</span>{/if}
</div>

<style>
  /*
    한 줄 판 — 판은 의미색을 옅게 섞은 것(초록 · 경고 · 실패), 글자는 그 의미색. 중성은 떠 있는 면 위의 살짝 다른 면에 본문 보조색.
    글이 길면 접어 내린다(말줄임하지 않는다 — 어긋남 문장의 끝에 근거가 온다).
  */
  .vband {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    padding: var(--space-1) var(--space-3);
    box-sizing: border-box;
    font-size: var(--t-xs);
    line-height: 1.45;
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
    background: var(--surface-hover);
  }
  .vband.ok {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }
  .vband.warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
  .vband.err {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 16%, transparent);
  }
  .vicon {
    flex: none;
    display: inline-flex;
  }
  .vtext {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* 오른쪽 끝 — 이동 · 만료 · 접기는 판의 의미색을 입지 않는다(보조 글자) */
  .vend {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }
</style>
