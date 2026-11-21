<script lang="ts">
  /** 검토 카드 · 작업안 카드의 명령 아래 흐린 한 줄. `extra` 의 칸도 `class="mi"` 를 달아야 구분점이 붙는다 */
  import type { Snippet } from "svelte";
  import type { Operation } from "$lib/operations";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    op: Operation;
    targetLookup: Map<string, { code: string; label: string }>;
    /** 서버가 쥔 그 글 */
    autoRefused?: string | null;
    /** DB 작업안은 대상이 `db:<id>` 하나라 연결 머리줄이 대신 말한다 */
    targets?: boolean;
    extra?: Snippet;
  }
  let { op, targetLookup, autoRefused = null, targets = true, extra }: Props = $props();

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
  /* 부모의 `extra` 칸에도 닿게 `:global(.mi)` 로 잡는다 */
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
