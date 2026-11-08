<script lang="ts">
  /**
   * **메타 줄**(10-24 "A + 명령 나눠 보기") — 검토 카드(`ReviewCard`)와 작업안 카드(`console/PlanList`)가 명령 아래에 두는 **흐린 12px
   * 한 줄**(넘치면 접어 내린다). 예전에 대상 칩 줄 · 경로 · 검증 줄 · sudo 칩 · 자동 승인 거부 칩이 각자 자리를 잡던 것을 ` · ` 로 이었다.
   *
   * 차례: `대상 N` + 대상들(신원 코드는 고정폭 · 여럿이면 첫 대상에 흐린 "(먼저)" — canary: 성공해야 나머지로 번진다 · 넷을 넘으면
   * "대상 N ▸" 한 단추로 접는다) · `경로 /x` · `검증: cmd` · `sudo`(경고색) · "자동 승인 안 됨 — {사유}"(서버가 쥔 그 글 그대로).
   * 부모가 덧붙일 칸(작업안의 방식 · 타임아웃)은 `extra` 로 받아 끝에 잇는다 — 그 칸들도 `class="mi"` 를 달면 구분점이 붙는다.
   *
   * 대상 펼침은 이 조각의 상태다 — 보이는 작업안이 바뀌면(`op.operationId`) 다시 접힌다.
   */
  import type { Snippet } from "svelte";
  import type { Operation } from "$lib/operations";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    op: Operation;
    /** 대상 id → 이 창의 {code, label} */
    targetLookup: Map<string, { code: string; label: string }>;
    /** 자동 승인 거부 사유(서버가 쥔 그 글) — 없으면 `null` */
    autoRefused?: string | null;
    /** 대상 칸을 그릴지(DB 작업안은 대상이 `db:<id>` 하나라 연결 머리줄이 대신 말한다) */
    targets?: boolean;
    /** 끝에 덧붙일 칸들 */
    extra?: Snippet;
  }
  let { op, targetLookup, autoRefused = null, targets = true, extra }: Props = $props();

  /** 대상이 이보다 많으면 늘어놓지 않고 "대상 N ▸" 한 단추로 접는다 */
  const TARGETS_INLINE_MAX = 4;

  let open = $state(false);
  $effect(() => {
    void op.operationId;
    open = false;
  });

  const inline = $derived(op.targets.length <= TARGETS_INLINE_MAX);
</script>

<div class="rmeta" data-review-meta>
  {#if targets}
    <span class="mi" data-meta="targets"
      >{#if inline}<span class="tcount">{t("app.review.targets", { n: op.targets.length })}</span>{:else}<button
          type="button"
          class="tcount ttoggle"
          aria-expanded={open}
          title={t(open ? "app.review.targets.hide" : "app.review.targets.show")}
          onclick={() => (open = !open)}
          >{t("app.review.targets", { n: op.targets.length })}<UiIcon
            name={open ? "chevron-down" : "chevron"}
            size={12}
          /></button
        >{/if}{#if inline || open}{#each op.targets as targetId, i (targetId)}{@const info = targetLookup.get(targetId)}<span
            class="tgt"
            ><span class="code">{info?.code ?? targetId}</span>{#if info}&nbsp;{info.label}{/if}{#if i === 0 && op.targets.length > 1}<span
                class="first"
                title={t("app.review.canary.title")}>&nbsp;{t("app.review.first")}</span
              >{/if}</span
          >{/each}{/if}</span
    >
  {/if}
  {#if op.cwd}
    <span class="mi mono" data-meta="cwd" title={t("board.plan.cwd.title")}>{t("board.plan.cwd", { path: op.cwd })}</span>
  {/if}
  {#if op.validate}
    <span class="mi mono" data-meta="validate" title={t("board.confirm.validate.title")}
      >{t("board.confirm.validate", { command: op.validate })}</span
    >
  {/if}
  {#if op.analysis?.sudo && !op.db}
    <span class="mi sudo" data-meta="sudo" title={t("app.review.sudo.title")}>{t("app.review.sudo")}</span>
  {/if}
  {#if autoRefused !== null}
    <span class="mi" data-meta="refused">{t("app.review.autoRefused")} — {autoRefused}</span>
  {/if}
  {@render extra?.()}
</div>

<style>
  /* 글자 흐름 한 줄 — 칸 사이 흐린 " · ". 부모의 `extra` 칸에도 닿게 `:global(.mi)` 로 잡는다 */
  /* flex 라 칸 사이 템플릿 공백(글자 마디)이 사라진다 — 구분점 양옆 간격이 `::before` 여백 하나로 같다 */
  .rmeta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    min-width: 0;
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }
  .rmeta > :global(.mi + .mi)::before {
    content: "·";
    margin: 0 0.5em;
    color: var(--fg-3);
    opacity: 0.7;
    font-family: var(--font-ui, inherit);
  }
  .rmeta > :global(.mi) {
    min-width: 0;
  }
  .mono {
    font-family: var(--font-mono, monospace);
  }
  .tcount {
    margin-right: 0.4em;
  }
  .tgt + .tgt {
    margin-left: 0.6em;
  }
  .code {
    font-family: var(--font-mono, monospace);
    color: var(--fg-2);
  }
  .tgt {
    color: var(--fg-2);
  }
  .first {
    color: var(--fg-3);
  }
  .sudo {
    color: var(--warn);
  }
  .ttoggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 var(--space-1);
    font: inherit;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    vertical-align: baseline;
  }
  .ttoggle:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }
</style>
