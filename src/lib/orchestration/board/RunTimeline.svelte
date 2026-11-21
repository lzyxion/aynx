<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { ACTOR_KEY, actionLabel, keyText, mergeTimelineWhat, type LogEntry } from "$lib/orchestration/model";
  import { clock } from "./format";

  let { timeline, titles }: { timeline: LogEntry[]; titles: Map<string, string> } = $props();
</script>

<section aria-label={t("orch.timeline.title")}>
  {#if timeline.length === 0}
    <p class="empty">{t("orch.timeline.empty")}</p>
  {:else}
    <ol class="timeline">
      {#each timeline as e (e.seq)}
        <li class="ev" data-ev={e.action}>
          <span class="mono when">{clock(e.at)}</span>
          <span class="who">{keyText(ACTOR_KEY, e.actor, t)}</span>
          {#if mergeTimelineWhat(e, t)}
            <span class="what">{mergeTimelineWhat(e, t)}</span>
            <span class="outcome mono">{e.outcome}</span>
            {#if e.action === "integration_auto_merged"}<span class="outcome">{t("orch.merge.timeline.basis")}</span>{/if}
          {:else}
            <span class="what">{actionLabel(e.action, t)}</span>
            {#if e.target}<span class="target">{titles.get(e.target) ?? e.target}</span>{/if}
            <span class="outcome" title={e.requestId ?? undefined}>{e.outcome}</span>
          {/if}
          {#if e.files != null}<span class="outcome">{t("orch.commits.files", { n: e.files })}</span>{/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  section {
    margin: 0 0 var(--space-3);
  }

  .empty {
    margin: var(--space-2) 0;
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .ev {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: 2px 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .ev .when {
    color: var(--fg-3);
  }

  .ev .what {
    color: var(--fg-1);
  }

  .ev .outcome {
    color: var(--fg-3);
  }
</style>
