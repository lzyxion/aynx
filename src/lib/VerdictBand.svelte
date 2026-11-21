<script lang="ts">
  // 판결은 `verdictOf` 가 고르고 여기서는 글자만 만든다.
  // 가장자리까지 닿게 하는 것은 부모의 몫이다(카드의 `overflow: hidden` + 음수 여백) — 이 조각은 판의 색과 줄만 그린다.
  import type { Snippet } from "svelte";
  import type { ComputedEffect } from "$lib/operations";
  import type { Verdict } from "$lib/review-card";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    verdict: Verdict;
    end?: Snippet;
  }
  let { verdict, end }: Props = $props();

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
  /* 말줄임하지 않고 접어 내린다 — 어긋남 문장의 끝에 근거가 온다 */
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
  .vend {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }
</style>
