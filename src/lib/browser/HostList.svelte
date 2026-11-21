<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { hostLabel, hostMeta, type HostEntry } from "$lib/hosts";
  import { isCutGroup, isCutHost } from "$lib/hosts-clipboard.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { groupPathOf, rowId, type HostTreeRow } from "$lib/host-folders";
  import { delegationGrantsOf } from "$lib/app/delegation.svelte.js";
  import { AI_STAGES, grantSummary, stageOf } from "$lib/delegation";
  import { gaugeIconName, gaugeIndex } from "$lib/ai-gauge";
  import { historyOf, historyTooltipLines } from "$lib/host-history";
  import { relativeTime } from "$lib/history-search";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import type { SelectionController } from "$lib/browser/selection-controller.svelte";
  import type { Box } from "$lib/selection";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { hostCache } from "$lib/app/hosts.svelte.js";
  import { dockAgentPanes } from "$lib/app/dock-dots.svelte.js";
  import { groupDot, hostDots } from "$lib/dock-dots";
  import {
    accordion,
    createSpringLoad,
    nestRows,
    plainClick,
    treeMotion,
    type TreeNode,
  } from "$lib/browser/tree-accordion";
  import "$lib/browser/dock-tree.css";

  /**
   * 호스트 트리 (docs/log/2026-09-25-hosts-tree.md). 아이콘 보기(격자)는 두지 않는다 — 들여쓰기가 뜻인 목록에 격자는 맞지 않는다.
   */
  let {
    rows,
    selection,
    order,
    /** `""` 는 최상위라 `null` 과 구분해야 한다 */
    dropTarget,
    draggingIds,
    iconOf,
    colorOf = () => null,
    loading,
    noHosts,
    searching,
    quickConnect = null,
    warning,
    marqueeBox,
    /** 소문자 별칭 */
    savedAliases,
    onactivate,
    onexpand,
    onmenu,
    ondragstart,
    ondragend,
    ondragover,
    ondragleave,
    ondrop,
    listEl = $bindable(null),
  }: {
    rows: readonly HostTreeRow[];
    selection: SelectionController;
    order: readonly string[];
    dropTarget: string | null;
    draggingIds: ReadonlySet<string> | null;
    iconOf: (path: string) => string | null;
    /** 호스트 줄에는 내려가지 않는다 */
    colorOf?: (path: string) => string | null;
    loading: boolean;
    noHosts: boolean;
    searching: boolean;
    quickConnect?: { label: string; run: () => void } | null;
    warning: string | undefined;
    marqueeBox: Box | null;
    savedAliases: ReadonlySet<string>;
    onactivate: (row: HostTreeRow) => void;
    onexpand: (row: Extract<HostTreeRow, { kind: "folder" }>) => void;
    onmenu: (ev: MouseEvent, row: HostTreeRow) => void;
    ondragstart: (ev: DragEvent, row: HostTreeRow) => void;
    ondragend: () => void;
    ondragover: (ev: DragEvent, path: string) => void;
    ondragleave: (path: string) => void;
    ondrop: (ev: DragEvent, path: string) => void;
    listEl?: HTMLUListElement | null;
  } = $props();

  const MAX_TAGS = 3;

  /** 목록 하나에 시계 하나 — 줄마다 타이머를 두지 않는다 */
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  /** 주소는 줄 말풍선에만 있다 */
  function rowTip(host: HostEntry): string | undefined {
    const address = hostLabel(host);
    const lines = [
      ...(address ? [address] : []),
      ...historyTooltipLines(historyOf(hostHistory(), host.name), now, t),
    ];
    return lines.length > 0 ? lines.join("\n") : undefined;
  }

  /** 로컬 타일은 여기 서지 않는다 — 프로젝트 독의 몫 (docs/log/2026-09-27-dock-agent-dots.md) */
  const agentPanes = $derived(dockAgentPanes());
  const agentDots = $derived(hostDots(agentPanes, t));
  const hostGroups = $derived(hostCache().map((h) => ({ name: h.name, group: groupPathOf(h) })));

  const tree = $derived(nestRows(rows, (r) => r.depth));

  const spring = createSpringLoad();
  $effect(() => () => spring.disarm());

  function endDrag() {
    spring.disarm();
    ondragend();
  }

  function leavesInside(ev: DragEvent): boolean {
    const to = ev.relatedTarget;
    return to instanceof Node && ev.currentTarget instanceof Node && ev.currentTarget.contains(to);
  }

  const INDENT_PX = 14;

  function indent(depth: number): string {
    return `calc(var(--row-pad-x) + ${depth * INDENT_PX}px)`;
  }
</script>

<!-- ssh config 는 같은 별칭이 여러 번 나올 수 있어 키 없이(인덱스) 순회한다 -->
{#snippet branch(nodes: TreeNode<HostTreeRow>[])}
  {#each nodes as node}
    {@const row = node.row}
    {#if row.kind === "folder"}
      {@const picked = iconOf(row.fullPath)}
      {@const motionKey = `host:${row.fullPath}`}
      <li class="dtree-node" class:open={row.expanded} class:still={!treeMotion.allows(motionKey)}>
        <button
          type="button"
          class="item folder"
          aria-expanded={row.expanded}
          class:selected={selection.has(rowId(row))}
          class:focused={selection.focus === rowId(row)}
          class:drop-over={dropTarget === row.fullPath}
          class:dragging={draggingIds?.has(rowId(row))}
          class:cut={isCutGroup(row.fullPath)}
          style:padding-left={indent(row.depth)}
          data-id={rowId(row)}
          data-depth={row.depth}
          title={row.fullPath}
          draggable="true"
          onclick={(ev) => {
            selection.click(ev, rowId(row), order);
            if (plainClick(ev)) onactivate(row);
          }}
          oncontextmenu={(ev) => onmenu(ev, row)}
          ondragstart={(ev) => ondragstart(ev, row)}
          ondragend={endDrag}
          ondragover={(ev) => {
            ondragover(ev, row.fullPath);
            // 받는 자리(preventDefault)이고 접혀 있을 때만 — 머물면 연다
            if (ev.defaultPrevented && !row.expanded) spring.arm(row.fullPath, () => onexpand(row));
            else spring.disarm(row.fullPath);
          }}
          ondragleave={(ev) => {
            if (!leavesInside(ev)) spring.disarm(row.fullPath);
            ondragleave(row.fullPath);
          }}
          ondrop={(ev) => {
            spring.disarm();
            ondrop(ev, row.fullPath);
          }}
        >
          <span class="line">
            <span class="lead">
              <HostIcon icon={picked} size={ROW_ICON_PX} fallback="folder" color={colorOf(row.fullPath)} />
            </span>
            <span class="name">{row.label}</span>
            <span class="count">{row.count}</span>
            {#if !row.expanded}
              {@const gdot = groupDot(row.fullPath, hostGroups, agentPanes, t)}
              {#if gdot}
                <AgentStatusGlyph
                  state={gdot.state}
                  data-agent-dot={gdot.state}
                  data-group-dot={row.fullPath}
                  title={gdot.label}
                  aria-label={gdot.label}
                />
              {/if}
            {/if}
            <span
              class="dtree-chev"
              data-host-twisty
              aria-hidden="true"
              title={row.expanded ? t("app.hosts.tree.collapse") : t("app.hosts.tree.expand")}
              ><UiIcon name="chevron-down" size={14} /></span
            >
          </span>
        </button>
        {#if node.children.length > 0}
          <ul class="dtree-kids" transition:accordion={{ key: motionKey }}>
            {@render branch(node.children)}
          </ul>
        {/if}
      </li>
    {:else}
      {@const host = row.host}
      {@const meta = hostMeta(host)}
      {@const tags = meta.tags.slice(0, MAX_TAGS)}
      {@const hidden = meta.tags.length - tags.length}
      {@const delegation = delegationGrantsOf(host.name)}
      {@const where = groupPathOf(host)}
      {@const when = row.lastOkAt === null ? "" : relativeTime(row.lastOkAt, now, t)}
      <li class="dtree-node">
        <button
          type="button"
          class="item"
          class:selected={selection.has(rowId(row))}
          class:focused={selection.focus === rowId(row)}
          class:dragging={draggingIds?.has(rowId(row))}
          class:cut={isCutHost(host.name)}
          style:padding-left={indent(row.depth)}
          data-id={rowId(row)}
          data-depth={row.depth}
          title={rowTip(host)}
          draggable="true"
          ondragstart={(ev) => ondragstart(ev, row)}
          ondragend={endDrag}
          onclick={(ev) => selection.click(ev, rowId(row), order)}
          ondblclick={() => onactivate(row)}
          oncontextmenu={(ev) => onmenu(ev, row)}
          ondragover={(ev) => {
            spring.disarm();
            ondragover(ev, where);
          }}
          ondragleave={() => ondragleave(where)}
          ondrop={(ev) => {
            spring.disarm();
            ondrop(ev, where);
          }}
        >
            <span class="line">
              <span class="lead">
                <HostIcon icon={meta.icon} size={ROW_ICON_PX} fallback="server" color={meta.color} />
              </span>
              <!-- 표식은 이름 바로 뒤에 — 줄 오른쪽 끝에 세우면 이름과 떨어져 별개의 배지로 읽힌다 -->
              <span class="name-cell">
                <span class="name">{host.name}</span>
                {#if host.proxy_jump}
                  <span class="jump" title={t("files.host.jump", { jump: host.proxy_jump })}>
                    <UiIcon name="route" size={12} />
                  </span>
                {/if}
                <!-- `=== true` 로 못 박는다 — `null`/`false` 는 둘 다 꺼짐이고, 참 같은 값 판정이면 칸이 3값이 될 때 뜻이 갈린다 -->
                {#if meta.tmux === true}
                  <span class="tmux" title={t("files.host.tmux")}>
                    <UiIcon name="tmux" size={12} />
                  </span>
                {/if}
                {#if meta.forwards.length > 0}
                  <span class="forward" title={t("files.host.forwards", { n: meta.forwards.length })}>
                    <UiIcon name="forward" size={12} />
                  </span>
                {/if}
                <!-- 키 암호구는 표식을 두지 않는다 — 키 파일의 성질이라 같은 키를 쓰는 호스트 전부에 붙어 아무것도 가르지 못한다 -->
                {#if savedAliases.has(host.name.toLowerCase())}
                  <span class="vault" title={t("files.host.vault")}>
                    <UiIcon name="lock" size={12} />
                  </span>
                {/if}
                {#if delegation && stageOf(delegation) !== "off"}
                  <span
                    class="delegation"
                    data-stage={stageOf(delegation)}
                    title={t("files.host.delegation.tip", { grants: grantSummary(delegation, t) })}
                  >
                    <UiIcon name={gaugeIconName(gaugeIndex(AI_STAGES, stageOf(delegation)))} size={12} />
                  </span>
                {/if}
              </span>
              {#if when}
                <span class="meta" data-host-when>{when}</span>
              {/if}
              {#if tags.length > 0}
                <span class="tags">
                  {#each tags as tag}<span class="tag">{tag}</span>{/each}
                  {#if hidden > 0}<span class="tag" title={t("files.host.tags.more", { count: hidden })}>+{hidden}</span>{/if}
                </span>
              {/if}
              {#if agentDots[host.name.toLowerCase()]}
                {@const hdot = agentDots[host.name.toLowerCase()]}
                <AgentStatusGlyph
                  state={hdot.state}
                  data-agent-dot={hdot.state}
                  data-host-dot={host.name}
                  title={hdot.label}
                  aria-label={hdot.label}
                />
              {/if}
              <span class="dtree-chev-pad" aria-hidden="true"></span>
            </span>
        </button>
      </li>
    {/if}
  {/each}
{/snippet}

<ul class="list" aria-label={t("app.hosts.tree.aria")} bind:this={listEl}>
  {@render branch(tree)}
</ul>

{#if loading}
  <p class="empty">{t("files.host.loading")}</p>
{:else if noHosts && rows.length === 0}
  <!-- 호스트가 없어도 빈 폴더는 있을 수 있다 — 폴더가 보이는데 "호스트가 없습니다" 가 뜨면 안 된다 -->
  <p class="empty">{warning ?? t("files.host.empty.nohosts")}</p>
{:else if rows.length === 0 && searching}
  <p class="empty">{t("files.host.empty.nomatch")}</p>
{/if}

<!-- 빠른 접속은 위 사슬 밖에 둔다 — 호스트가 하나도 없는 첫 실행이 이 줄이 가장 쓸모 있는 상태다 -->
{#if quickConnect}
  <p class="quick">
    <button type="button" class="btn btn-secondary quick-btn" onclick={quickConnect.run}>
      {t("files.host.quick.connect")}
      <span class="quick-target">{quickConnect.label}</span>
    </button>
  </p>
{/if}

<!-- 좌표 원점은 부모의 `.body` 다 -->
{#if marqueeBox}
  <div
    class="marquee"
    aria-hidden="true"
    style:left="{marqueeBox.left}px"
    style:top="{marqueeBox.top}px"
    style:width="{marqueeBox.right - marqueeBox.left}px"
    style:height="{marqueeBox.bottom - marqueeBox.top}px"
  ></div>
{/if}

<style>
  /* 포인터를 받지 않아야 긋는 동안 아래 항목의 hover · 커서가 산다 */
  .marquee {
    position: absolute;
    z-index: 2;
    background: var(--accent-soft);
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    pointer-events: none;
  }

  .list {
    margin: 0;
    padding: var(--row-inset);
    list-style: none;
  }

  .list li {
    position: relative;
  }

  .item {
    display: block;
    width: 100%;
    padding: var(--row-pad-y) var(--row-pad-x);
    text-align: left;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .item:hover {
    background: var(--surface-hover);
  }

  .item:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 커서(포커스)에는 따로 표시를 두지 않는다 — 왼쪽 세로 띠는 선택 배경과 겹쳐 읽혀 쓰지 않는다 */
  .item.selected {
    background: var(--accent-soft);
  }

  .item.dragging {
    opacity: 0.45;
  }

  .item.cut {
    opacity: 0.5;
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    min-width: 0;
  }

  .lead {
    flex: 0 0 var(--row-icon);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--row-font);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tags {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-1);
  }

  .tag {
    padding: 0 var(--space-1);
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--fg-2);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
    white-space: nowrap;
    max-width: 56px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name-cell {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .name-cell .name {
    flex: 0 1 auto;
  }

  .jump,
  .tmux,
  .forward,
  .vault,
  .delegation {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    color: var(--fg-3);
  }

  .meta {
    flex: 0 1 auto;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── 폴더 줄 ── */

  .item.folder .name {
    font-weight: 500;
  }

  .item.drop-over,
  :global(.dock.launcher) .item.drop-over.drop-over {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .count {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .quick {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
  }

  .quick-btn {
    width: 100%;
    justify-content: flex-start;
  }

  .quick-target {
    font-family: var(--font-mono);
  }

  /* 독 안에서만(`.dock.launcher`) MD3 목록 줄 */
  :global(.dock.launcher) .item {
    border-radius: var(--radius-row);
  }

  :global(.dock.launcher) .item:hover {
    background: color-mix(in srgb, var(--fg-1) var(--state-hover), transparent);
  }

  :global(.dock.launcher) .item.selected {
    color: var(--on-accent-soft);
    background: var(--glass-pick, var(--accent-soft));
  }

  :global(.dock.launcher) .lead {
    flex-basis: 28px;
    height: 28px;
  }

  :global(.dock.launcher) .item:not(.folder) > .line > .lead {
    border-radius: 50%;
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
  }

  :global(.dock.launcher) :is(.tag) {
    padding: 1px 8px;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
</style>
