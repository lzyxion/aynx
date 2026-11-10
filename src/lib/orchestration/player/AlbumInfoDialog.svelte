<script lang="ts">
  // **앨범 정보 창**(2026-11-07 — 목업 TXXyvWihqavpNcEmbgRA4b) — ⋯ 메뉴의 [앨범 정보]. 예전에는 앨범 머리 아래에 한 줄로 이어 붙었다. 읽기만 한다.
  // 앨범 판은 컨테이너 질의 상자라 고정 위치가 창이 아니라 판에 묶인다 — 본문 아래로 옮겨 그린다(`MergeDialog` 와 같은 틀).
  import { onMount, tick } from "svelte";
  import { trapTab } from "$lib/focus-trap";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { hasJudges, type RunDetail } from "$lib/orchestration/model";
  import { artistOf } from "../artists";

  let {
    detail,
    producerCli,
    elapsed,
    coordLimit,
    why = null,
    onclose,
  }: {
    detail: RunDetail;
    producerCli: string | null;
    elapsed: string;
    coordLimit: string;
    /** 앨범을 완료할 수 없는 까닭 */
    why?: string | null;
    onclose: () => void;
  } = $props();

  let dialogEl = $state<HTMLElement | null>(null);
  let closeEl = $state<HTMLButtonElement | null>(null);

  const reviewsLeft = $derived(typeof detail.remaining?.reviews === "number" && hasJudges(detail) ? detail.remaining.reviews : null);
  const hasReview = $derived(!!detail.requireReview || reviewsLeft !== null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function onKey(ev: KeyboardEvent): void {
    if (dialogEl && trapTab(ev, dialogEl)) return;
    // 앱의 전역 단축키 · 터미널이 이 창의 키를 받지 않게(창 버블 리스너보다 먼저 끊는다).
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      onclose();
    }
  }

  onMount(() => {
    void tick().then(() => (closeEl ?? dialogEl)?.focus());
  });
</script>

<div class="overlay" role="presentation" use:portal onmousedown={(ev) => { if (ev.target === ev.currentTarget) onclose(); }}>
  <div class="dialog glass-raised" role="dialog" aria-modal="true" aria-labelledby="album-info-title" tabindex="-1" data-album-info bind:this={dialogEl} onkeydown={onKey}>
    <div class="glass-scroll">
    <h2 id="album-info-title">{t("orch.album.menu.info")}</h2>
    <dl>
      <dt>{t("orch.album.info.producer")}</dt>
      <dd data-album-producer={producerCli ?? ""}>{producerCli ? artistOf(producerCli).name : t("orch.album.info.none")}</dd>
      <dt>{t("orch.album.info.time")}</dt>
      <dd class="nums" title={t("orch.elapsed", { elapsed, limit: coordLimit })}>{elapsed} / {coordLimit}</dd>
      {#if detail.verify}
        <dt>{t("orch.album.info.verify")}</dt>
        <dd>
          <span class="mono" data-run-verify-command title={t("orch.verify.head.title")}>{detail.verify.command}</span>
          {#if detail.verify.autoRun}<span class="chip warn" data-run-verify-auto title={t("orch.verify.auto.title")}>{t("orch.verify.auto.badge")}</span>{/if}
        </dd>
      {/if}
      {#if hasReview}
        <dt>{t("orch.album.info.review")}</dt>
        <dd>
          {#if detail.requireReview}<span data-run-require-review title={t("orch.reviewer.required.title")}>{t("orch.reviewer.required")}</span>{/if}
          {#if detail.requireReview && reviewsLeft !== null}<span aria-hidden="true">·</span>{/if}
          {#if reviewsLeft !== null}<span data-run-reviews-left>{t("orch.reviewer.budget", { n: reviewsLeft })}</span>{/if}
        </dd>
      {/if}
      <dt>{t("orch.album.info.gen")}</dt>
      <dd class="nums">{detail.gen}</dd>
    </dl>
    {#if why}<p class="why" data-run-complete-blocked>{why}</p>{/if}
    <div class="acts"><button type="button" class="btn btn-secondary" bind:this={closeEl} onclick={onclose}>{t("orch.album.info.close")}</button></div>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 112; display: grid; place-items: center; padding: var(--space-4); background: rgb(0 0 0 / 0.3); }
  .dialog {
    display: flex; flex-direction: column; width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: hidden; box-sizing: border-box; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) — 흐림 층이 밑동까지 덮게 */
    background: var(--glass-raised, var(--surface-raised-solid)); border: 1px solid var(--line); border-radius: var(--radius-surface); box-shadow: var(--shadow-raised); color: var(--fg-1); outline: none;
  }
  .glass-scroll { display: grid; gap: 14px; padding: 22px 24px; }
  h2 { margin: 0; font-size: 18px; font-weight: var(--fw-semibold); }
  dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 9px 18px; margin: 0; font-size: var(--t-sm); }
  dt { color: var(--fg-3); }
  dd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; margin: 0; overflow-wrap: anywhere; }
  .nums { font-variant-numeric: tabular-nums; }
  .mono { min-width: 0; font-family: var(--font-mono); font-size: var(--t-xs); overflow-wrap: anywhere; }
  .chip { flex: none; padding: 0 var(--space-2); font-size: var(--t-xs); line-height: 20px; color: var(--fg-1); border-radius: 999px; white-space: nowrap; }
  .chip.warn { background: var(--warn-soft); }
  .why { margin: 0; padding: 8px 12px; font-size: var(--t-xs); color: var(--fg-1); background: var(--warn-soft); border-radius: var(--radius-surface-inner); }
  .acts { display: flex; justify-content: flex-end; }
  @media (pointer: coarse) { .acts button { min-height: 44px; padding-inline: 18px; } }
</style>
