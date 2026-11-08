<script lang="ts">
  // ---------------------------------------------------------------------------
  // **보드의 타임라인**(메타만 — 시각 · 주체 · 사건 · 대상 · 결과, 새것이 위) — `RunBoard.svelte` 에서 뗀 표시 조각.
  // 사건 목록(`timeline` — 이미 뒤집힌 것) · Task 제목 표는 부모 보드가 넘긴다.
  // ---------------------------------------------------------------------------
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { ACTOR_KEY, actionLabel, keyText, mergeTimelineWhat, type LogEntry } from "$lib/orchestration/model";
  import { clock } from "./format";

  let { timeline, titles }: { timeline: LogEntry[]; titles: Map<string, string> } = $props();
</script>

<!-- 이름은 앨범 판의 [타임라인] 탭이 단다(탭 패널 안이라 제목 줄을 따로 두지 않는다) -->
<section aria-label={t("orch.timeline.title")}>
  {#if timeline.length === 0}
    <p class="empty">{t("orch.timeline.empty")}</p>
  {:else}
    <ol class="timeline">
      {#each timeline as e (e.seq)}
        <!-- (3차 6단계) 옛 붙여넣기 전달 기록 칩은 걷었다 — 서버 보기에 `deliveries` 가 없다(옛 사건은 결과 낱말만) -->
        <li class="ev" data-ev={e.action}>
          <span class="mono when">{clock(e.at)}</span>
          <span class="who">{keyText(ACTOR_KEY, e.actor, t)}</span>
          {#if mergeTimelineWhat(e, t)}
            <!-- 병합 줄 — 대상 브랜치가 문장에 든다(`main에 병합 a1b2c3d`) · 자동이면 근거를 덧붙인다 -->
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
