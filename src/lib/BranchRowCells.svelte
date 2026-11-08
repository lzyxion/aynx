<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { folderTail, LANE, shortHash, type GraphRow } from "$lib/branch-graph";

  /**
   * **커밋 그래프 한 줄의 앞 두 칸** — 줄기 칸(선 · 점) + 이름 칸(알약 · 워크트리 이름). 브랜치 타일(`BranchGraph.svelte`)과
   * [정리] 창의 앨범 그래프(`orchestration/board/CleanupGraph.svelte`)가 같이 쓴다. 감싸는 요소 없이 두 칸을 내놓는다 — 줄(그리드 ·
   * `tone-N` 칸)은 부르는 쪽이 쥔다. 선은 `buildRows` 의 표식대로 긋기만 한다.
   *
   * 색 — 줄기 조상에 `branch-tones`, 줄에 `tone-{row.tone}` 를 달면 `--lane` 이 선다(아래 전역 규칙 — 줄 밖 상세 칸의 알약도 쓴다).
   */
  let {
    row,
    merge,
    sub,
    after,
  }: {
    row: GraphRow;
    /** 병합 커밋 줄인가(빈 점) */
    merge: boolean;
    /** 덩어리 첫 줄의 곁글을 바꾼다 — 없으면 워크트리 이름 */
    sub?: (r: GraphRow) => string | null | undefined;
    /** 이름 칸 끝(덩어리 첫 줄 · 접힘 줄) */
    after?: Snippet<[GraphRow]>;
  } = $props();

  const M = LANE.row / 2;

  /** 선 하나 — 곧은 세로선이거나 위아래로 휘는 곡선 */
  function seg(x1: number, y1: number, x2: number, y2: number): string {
    if (x1 === x2) return `M${x1},${y1} V${y2}`;
    const ym = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${ym} ${x2},${ym} ${x2},${y2}`;
  }

  /** 이름 칸의 워크트리 글자 — 주 폴더 · 폴더 꼬리 · 없음 */
  function worktreeName(path: string | null, primary: boolean, merged: boolean): string {
    if (path) return primary ? t("app.branches.sub.primary") : folderTail(path);
    return merged ? t("app.branches.sub.merged") : t("app.branches.sub.noWorktree");
  }

  const L = $derived(row.links);
  const x = $derived(row.lane === 0 ? LANE.mainX : LANE.branchX);
  const lb = $derived(row.label);
</script>

<svg class="gut" width={LANE.width} height={LANE.row} viewBox="0 0 {LANE.width} {LANE.row}" aria-hidden="true">
  {#if L.trunkUp}<path class="ln main" class:dash={L.trunkUp === "dash"} d={seg(LANE.mainX, 0, LANE.mainX, M)} />{/if}
  {#if L.trunkDown}<path class="ln main" class:dash={L.trunkDown === "dash"} d={seg(LANE.mainX, M, LANE.mainX, LANE.row)} />{/if}
  {#if L.laneUp}<path class="ln" class:dash={L.laneUp === "dash"} d={seg(LANE.branchX, 0, LANE.branchX, M)} />{/if}
  {#if L.laneDown}<path class="ln" class:dash={L.laneDown === "dash"} d={seg(LANE.branchX, M, LANE.branchX, LANE.row)} />{/if}
  {#if L.mergeIn}<path class="ln" d={seg(LANE.mainX, 0, LANE.branchX, M)} />{/if}
  {#if L.forkOut}<path class="ln" class:dash={L.forkOut === "dash"} d={seg(LANE.branchX, M, LANE.mainX, LANE.row)} />{/if}
  {#if row.kind === "wip"}
    <circle class="pt wip" cx={x} cy={M} r="5" />
  {:else if row.kind === "fold"}
    <!-- 접힌 덩어리 = 이중 고리(꽉 찬 점 + 바깥 고리 — 10-27 사용자, 예전 둥근 네모) -->
    <circle class="pt ring" cx={x} cy={M} r="7.5" />
    <circle class="pt" cx={x} cy={M} r="3.6" />
  {:else if row.kind === "main" || row.kind === "commit"}
    {#if merge}
      <circle class="pt hollow" cx={x} cy={M} r="4" />
    {:else}
      <circle class="pt" cx={x} cy={M} r="4.5" />
    {/if}
  {/if}
</svg>

<!--
  이름 칸 — [브랜치 알약] 워크트리 이름(10-27 사용자 A안: 고정폭 굵은 이름 · 세로 색 막대를 걷고 줄기 색 알약 하나로. 이름 칸을
  걷고 알약을 제목 앞에 둔 B안은 브랜치가 잘 갈리지 않아 되돌렸다). 알약은 덩어리 첫 줄에만 — 접힌 덩어리는 점선 `▸`, 편 덩어리는 `▾`.
  이름 칸 전체와 줄기 칸이 펴기 · 접기 손잡이다(타일의 `onRow`). 덩어리 끝 줄에는 갈라진 곳.
-->
{#if row.kind === "skip"}
  <!-- 건너뛴 main 커밋 줄 — 이름 칸 자리만 -->
  <span class="name"></span>
{:else}
  <span class="ncell">
    {#if lb?.kind === "main"}
      <span class="name"><span class="bn">{lb.name}</span></span><span class="wt">{t("app.branches.sub.primary")}</span>
    {:else if lb?.kind === "head"}
      <span class="name" class:faded={lb.merged} title={lb.name}><span class="bn">{lb.merged ? "▾ " : ""}{lb.name}</span></span><span
        class="wt">{sub?.(row) ?? worktreeName(lb.worktree, lb.primary, lb.merged)}</span
      >{@render after?.(row)}
    {:else if lb?.kind === "fork"}
      <span class="fork">{t("app.branches.row.fork", { base: shortHash(lb.base) })}</span>
    {:else if lb?.kind === "fold"}
      <span class="name faded fold" title={lb.name}><span class="bn">▸ {lb.name}</span></span><span class="wt"
        >{t("app.branches.sub.merged")}</span
      >{@render after?.(row)}
    {/if}
  </span>
{/if}

<style>
  /* 줄 색 — main 은 흐린 글자 색, 브랜치는 **색상환을 45° 씩 나눈 여덟 색**(OKLCH — 밝기 · 채도는 고정하고 색상만 돌린다,
     10-27 사용자: 예전의 테마 파생 연한 톤 다섯은 흐린 글자색과 반쯤 섞여 서로 잘 갈리지 않았다). 밝기를 하나로 맞춰 어느 색도
     튀지 않고, 다크는 밝게 · 라이트는 어둡게만 다르다. 색은 선택 · 주 행동 · 입력 대기에만 쓴다는 규칙의 예외 — 그래프의
     줄기 · 이름을 가르는 데만 쓴다. 어느 브랜치가 몇 번째 색인지는 `branch-graph.ts` 의 `assignTones`(줄 차례). */
  :global(.branch-tones) {
    --tone-l: 0.78;
    --tone-c: 0.12;
    --tone-0: var(--fg-2);
    --tone-1: oklch(var(--tone-l) var(--tone-c) 250);
    --tone-2: oklch(var(--tone-l) var(--tone-c) 70);
    --tone-3: oklch(var(--tone-l) var(--tone-c) 160);
    --tone-4: oklch(var(--tone-l) var(--tone-c) 340);
    --tone-5: oklch(var(--tone-l) var(--tone-c) 200);
    --tone-6: oklch(var(--tone-l) var(--tone-c) 25);
    --tone-7: oklch(var(--tone-l) var(--tone-c) 295);
    --tone-8: oklch(var(--tone-l) var(--tone-c) 115);
  }
  :global(:root[data-theme="light"] .branch-tones) {
    --tone-l: 0.52;
    --tone-c: 0.13;
  }

  :global(.branch-tones .tone-0) {
    --lane: var(--tone-0);
  }
  :global(.branch-tones .tone-1) {
    --lane: var(--tone-1);
  }
  :global(.branch-tones .tone-2) {
    --lane: var(--tone-2);
  }
  :global(.branch-tones .tone-3) {
    --lane: var(--tone-3);
  }
  :global(.branch-tones .tone-4) {
    --lane: var(--tone-4);
  }
  :global(.branch-tones .tone-5) {
    --lane: var(--tone-5);
  }
  :global(.branch-tones .tone-6) {
    --lane: var(--tone-6);
  }
  :global(.branch-tones .tone-7) {
    --lane: var(--tone-7);
  }
  :global(.branch-tones .tone-8) {
    --lane: var(--tone-8);
  }

  .gut {
    display: block;
  }

  .ln {
    fill: none;
    stroke: var(--lane);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .ln.main {
    stroke: var(--tone-0);
  }

  .ln.dash {
    stroke-dasharray: 3 3;
    stroke-linecap: butt;
  }

  .pt {
    fill: var(--lane);
  }

  .pt.hollow,
  .pt.wip {
    /* 빈 점은 줄기를 가리는 타일 면 색 — 글래스 크롬 타일이면 그 면(`--tile-face`) */
    fill: var(--tile-face, var(--bg-panel));
    stroke: var(--lane);
    stroke-width: 2;
  }

  .pt.wip {
    stroke-dasharray: 2 2;
  }

  /* 접힌 덩어리의 바깥 고리 — 안쪽 꽉 찬 점보다 가늘고 옅게 */
  .pt.ring {
    fill: var(--tile-face, var(--bg-panel));
    stroke: var(--lane);
    stroke-width: 1.4;
    stroke-opacity: 0.75;
  }

  /* 이름 칸 — [알약] 워크트리 이름(흐린 작은 글자), 넘치면 워크트리 이름부터 말줄임 */
  .ncell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 32px;
    white-space: nowrap;
    overflow: hidden;
  }

  .wt {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--fg-3);
  }

  /* 브랜치 알약 — 그 줄기 색의 옅은 면 · 테두리 · 글자(접힌 덩어리는 점선) */
  .name {
    flex: 0 1 auto;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--lane) 38%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--lane) 16%, transparent);
    white-space: nowrap;
    overflow: hidden;
  }

  .name.fold {
    border-style: dashed;
    background: color-mix(in srgb, var(--lane) 8%, transparent);
  }

  .name.faded .bn {
    opacity: 0.75;
  }

  .bn {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--lane);
  }

  .fork {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
  }
</style>
