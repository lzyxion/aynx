<script lang="ts">
  // **[정리] 창의 앨범 그래프** — 브랜치 타일과 같은 그림(`buildRows` · `BranchRowCells`)을 이 앨범의 브랜치만으로(`albumGraph`). 읽기만 한다 —
  // 줄은 누르지 않고 포커스도 받지 않는다. 재료는 창을 열 때 한 번 읽는 `git_commit_graph`. 못 읽어도 고르기 · 지우기는 그대로 된다(한 줄 안내뿐).
  import { onMount } from "svelte";
  import BranchRowCells from "$lib/BranchRowCells.svelte";
  import { buildRows, rowIsMerge, rowMessage, type GraphRow } from "$lib/branch-graph";
  import { openBranchGraph, readCommitGraph, type GraphRead } from "$lib/app/branch-graph.svelte.js";
  import { projectAtRepo } from "$lib/app/orchestration.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Project } from "$lib/projects";
  import { ALBUM_GRAPH_MAIN_LIMIT, albumBranches, albumGraph, albumRowPicked, pickedScope, type CleanupPreview } from "$lib/orchestration/model";

  let {
    repo,
    clean,
    picked,
    onclose,
  }: {
    repo: string;
    clean: CleanupPreview;
    /** 지금 고른 작업 폴더 경로 */
    picked: string[];
    onclose: () => void;
  } = $props();

  let read = $state<GraphRead | { state: "loading" }>({ state: "loading" });
  /** 그 저장소의 프로젝트 — 없으면 [전체 그래프 열기] 를 숨긴다 */
  let project = $state<Project | null>(null);

  const graph = $derived(
    read.state === "ok"
      ? albumGraph(read.graph, {
          branches: albumBranches(clean),
          worktrees: clean.worktrees.map((w) => w.path),
          labels: { merged: t("orch.cleanup.graph.row.merged"), empty: t("orch.cleanup.graph.row.empty") },
        })
      : null,
  );
  const rows = $derived(graph ? buildRows(graph, new Set()) : []);
  /** 이미 정리된 앨범은 브랜치가 재료에 없다 — main 줄기만 그리지 않고 안내한다 */
  const hasBranches = $derived(rows.some((r) => r.lane === 1));
  const scope = $derived(pickedScope(clean.worktrees, picked));

  /** 덩어리 첫 줄의 곁글 — 그 트랙 제목 · 내보낸 브랜치 */
  function subOf(r: GraphRow): string | null {
    if (r.branch && r.branch === clean.exportBranch) return t("orch.cleanup.graph.exported");
    return clean.worktrees.find((w) => w.branch === r.branch)?.taskTitle || null;
  }

  function openFull(): void {
    if (!project) return;
    openBranchGraph(project);
    onclose();
  }

  onMount(() => {
    let alive = true;
    void readCommitGraph({ host: null, path: repo }, ALBUM_GRAPH_MAIN_LIMIT).then((r) => {
      if (alive) read = r;
    });
    void projectAtRepo(repo).then((p) => {
      if (alive) project = p;
    });
    return () => {
      alive = false;
    };
  });
</script>

{#snippet gone(r: GraphRow)}
  {#if albumRowPicked(r, scope)}<span class="gone">{t("orch.cleanup.graph.gone")}</span>{/if}
{/snippet}

<figure class="graph branch-tones" data-cleanup-graph={read.state}>
  {#if read.state === "loading"}
    <p class="note" role="status">{t("app.branches.loading")}</p>
  {:else if rows.length === 0}
    <p class="note" data-cleanup-graph-note="failed">{t("orch.cleanup.graph.failed")}</p>
  {:else if !hasBranches}
    <p class="note" data-cleanup-graph-note="none">{t("orch.cleanup.graph.none")}</p>
  {:else}
    <div class="rows" role="group" aria-label={t("orch.cleanup.graph.aria")}>
      {#each rows as r (r.key)}
        <div class="row tone-{r.tone}" class:skip={r.kind === "skip"} class:picked={albumRowPicked(r, scope)} data-cleanup-graph-row={r.key}
          data-picked={albumRowPicked(r, scope) ? "" : undefined}>
          <BranchRowCells row={r} merge={rowIsMerge(graph, r)} sub={subOf} after={gone} />
          <span class="msg" class:dim={r.kind !== "commit" && r.kind !== "main" ? true : rowIsMerge(graph, r)}>{rowMessage(graph, r, t)}</span>
        </div>
      {/each}
    </div>
  {/if}
  <figcaption>
    {#if hasBranches}<span>{t("orch.cleanup.graph.caption")}</span>{/if}
    {#if project}<button type="button" class="link" data-cleanup-graph-open onclick={openFull}>{t("orch.cleanup.graph.open")}</button>{/if}
  </figcaption>
</figure>

<style>
  .graph {
    /* 빈 점이 줄기를 가리는 면 — 창의 면과 같은 색 */
    --tile-face: var(--surface-raised-solid);
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    min-height: 0;
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius-surface-inner);
    background: var(--surface-hover);
    font-family: var(--font-ui);
    color: var(--fg);
  }

  .note {
    margin: 0;
    padding: var(--space-3) 0;
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  .rows {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }

  /* 한 줄 — [줄기 칸 | 이름 칸 | 커밋 글]. 타일에서 뺀 칸: 변경 수 · 시각 */
  .row {
    display: grid;
    grid-template-columns: 46px minmax(0, min(190px, 40%)) minmax(0, 1fr);
    align-items: center;
    column-gap: 10px;
    height: 32px;
    cursor: default;
  }

  /* 건너뛴 main 커밋 줄 — 이름 칸 자리를 그리지 않는다 */
  .row.skip :global(.name) {
    visibility: hidden;
  }

  .msg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }

  .msg.dim {
    color: var(--fg-3);
  }

  /* 고른 작업 폴더의 줄 — 브랜치 선만 점선(main 줄기는 그대로) · 글자에 취소선 */
  .row.picked :global(.ln:not(.main)) {
    stroke-dasharray: 3 3;
    stroke-linecap: butt;
  }

  .row.picked .msg,
  .row.picked :global(.bn) {
    text-decoration: line-through;
    opacity: 0.7;
  }

  .gone {
    flex: none;
    font-size: 11px;
    color: var(--fg-2);
  }

  figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 10px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  figcaption:empty {
    display: none;
  }

  .link {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .link:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    .link {
      min-height: 44px;
    }
  }
</style>
