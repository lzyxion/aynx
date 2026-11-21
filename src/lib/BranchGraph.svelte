<script lang="ts">
  import type { AgentStatus } from "$lib/agent-status";
  import { tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { projectById } from "$lib/app/project-list.svelte.js";
  import { liveSessionFor, remoteHomeOf } from "$lib/app/remote-home.svelte.js";
  import { dockAgentPanes, dockProjectFolders } from "$lib/app/dock-dots.svelte.js";
  import { branchGraphStaleSeq } from "$lib/app/branch-graph-stale.svelte.js";
  import {
    focusPaneAnywhere,
    noteBranchGraph,
    openBranchFile,
    readCommitFiles,
    readCommitGraph,
    readWipFiles,
    type FilesRead,
    type GraphRead,
  } from "$lib/app/branch-graph.svelte.js";
  import { openDiff } from "$lib/app/diff-view.svelte.js";
  import { placeOf, projectDots, worktreeDotKey } from "$lib/dock-dots";
  import { relativeTime } from "$lib/notifications";
  import { isRemote } from "$lib/projects";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import BranchRowCells from "$lib/BranchRowCells.svelte";
  import {
    buildRows,
    commitsTotal,
    filesTotal,
    folderTail,
    MAIN_LIMIT,
    MAX_FILES,
    nextMainLimit,
    pickRow,
    revealScrollTop,
    rowCommit,
    rowIsMerge,
    rowMessage,
    shortHash,
    type ChangedFile,
    type CommitFiles,
    type GraphRow,
    type WipFiles,
  } from "$lib/branch-graph";

  /**
   * 브랜치 타일 — 두 줄기 커밋 그래프(읽기만). 접힘을 편 상태 · 주 줄 길이는 저장하지 않고 명세에는 고른 줄의 브랜치만 적는다.
   * 뿌리가 `[data-tile-focus]` 라 `Alt+화살표`로 들어오면 포커스가 온다.
   */
  type DiffCtx =
    | { kind: "commit"; hash: string; branch: string | null; worktree: string | null }
    | { kind: "wip"; worktree: string; branch: string | null };

  let {
    paneId,
    spec,
  }: {
    paneId: string;
    spec: { projectId: string; branch?: string };
  } = $props();

  const project = $derived(projectById(spec.projectId));

  let read = $state<GraphRead | { state: "loading" }>({ state: "loading" });
  let seenSeq = $state(0);
  let mainLimit = $state<number>(MAIN_LIMIT.initial);
  /** 병합 커밋 해시 */
  let openFolds = $state<string[]>([]);
  let selected = $state<string | null>(null);
  let commitFiles = $state<FilesRead<CommitFiles> | { state: "loading" } | null>(null);
  let wipFiles = $state<FilesRead<WipFiles> | { state: "loading" } | null>(null);
  /** 다시 읽음 · 줄 고름에서만 선다 — 사람이 둔 스크롤 자리는 건드리지 않는다 */
  let pendingReveal = $state(false);
  /** 접힘을 펴거나 접어 초점을 가진 단추가 사라졌다 — 그린 뒤 고른 줄로 초점을 옮긴다 */
  let pendingFocus = $state(false);
  let lwrap = $state<HTMLDivElement | null>(null);
  let loadSeq = 0;
  let fileSeq = 0;

  const graph = $derived(read.state === "ok" ? read.graph : null);
  const now = $derived.by(() => {
    void read;
    return Date.now();
  });
  const rows = $derived(graph ? buildRows(graph, new Set(openFolds)) : []);
  const current = $derived(rows.find((r) => r.key === selected) ?? null);
  /** 로빙 탭의 자리 */
  const tabKey = $derived(current?.key ?? rows.find((r) => r.kind !== "skip")?.key ?? null);

  // 독 워크트리 줄의 점과 같은 재료 · 같은 판정
  const agentPanes = $derived(dockAgentPanes());
  const folders = $derived(dockProjectFolders());
  const dots = $derived(projectDots(agentPanes, folders, remoteHomeOf, t));

  function agentOf(worktree: string | null): { state: AgentStatus; label: string; ids: string[] } | null {
    if (!worktree || !project) return null;
    const dot = dots.worktree[worktreeDotKey(project.id, worktree)];
    if (!dot) return null;
    const ids = agentPanes
      .filter((a) => a.state !== null)
      .filter((a) => {
        const at = placeOf(a, folders, remoteHomeOf);
        return at?.projectId === project.id && at.worktree === worktree;
      })
      .map((a) => a.id);
    return { state: dot.state, label: dot.label, ids };
  }

  /** `auto`(턴 끝의 자동 다시 읽기)는 고른 줄을 목록 칸 안으로 끌어오지 않는다 — 사람이 둔 스크롤 자리를 건드리지 않게. */
  async function load(auto = false): Promise<void> {
    const p = project;
    if (!p) return;
    const mine = ++loadSeq;
    if (read.state !== "ok") read = { state: "loading" };
    const seq = branchGraphStaleSeq(p.id);
    const r = await readCommitGraph(p, mainLimit);
    if (mine !== loadSeq) return;
    read = r;
    seenSeq = seq;
    if (r.state !== "ok") return;
    const list = buildRows(r.graph, new Set(openFolds));
    select(pickRow(list, spec.branch, selected), false, !auto);
  }

  // [새로 고침] 아이콘 — 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(`onanimationiteration`).
  let refreshing = $state(false);
  let spinning = $state(false);

  async function refresh(auto = false): Promise<void> {
    refreshing = true;
    spinning = true;
    try {
      await load(auto);
    } finally {
      refreshing = false;
    }
  }

  function select(key: string | null, note = true, reveal = true): void {
    selected = key;
    const row = key ? (rows.find((r) => r.key === key) ?? null) : null;
    if (!row) {
      commitFiles = null;
      wipFiles = null;
      return;
    }
    if (note && row.branch && spec.branch !== row.branch) noteBranchGraph(paneId, { branch: row.branch });
    if (reveal) pendingReveal = true;
    // 같은 줄을 다시 골라도 파일을 다시 읽는다 — 그사이 바뀌었을 수 있다.
    void loadFiles(row);
  }

  async function loadFiles(row: GraphRow): Promise<void> {
    const p = project;
    if (!p) return;
    const mine = ++fileSeq;
    if (row.kind === "wip" && row.worktree) {
      commitFiles = null;
      wipFiles = { state: "loading" };
      const r = await readWipFiles(p, row.worktree);
      if (mine === fileSeq) wipFiles = r;
    } else if ((row.kind === "main" || row.kind === "commit") && row.hash) {
      wipFiles = null;
      commitFiles = { state: "loading" };
      const r = await readCommitFiles(p, row.hash);
      if (mine === fileSeq) commitFiles = r;
    } else {
      commitFiles = null;
      wipFiles = null;
    }
  }

  function expand(merge: string): void {
    if (!openFolds.includes(merge)) openFolds = [...openFolds, merge];
    const first = rows.find((r) => r.kind === "commit" && r.block === `f:${merge}`);
    pendingFocus = true;
    if (first) select(first.key);
  }

  function collapse(merge: string): void {
    openFolds = openFolds.filter((m) => m !== merge);
    pendingFocus = true;
    select(`m:${merge}`);
  }

  function more(): void {
    const n = nextMainLimit(mainLimit);
    if (n === null) return;
    mainLimit = n;
    void load();
  }

  $effect(() => {
    const p = project;
    if (!p) return;
    untrack(() => {
      noteBranchGraph(paneId, { name: p.name });
      void load();
    });
  });

  // 턴 끝 신호는 참/거짓이 아니라 순번을 본다 — 읽는 도중 신호가 또 와도 마지막 턴의 변경을 놓치지 않는다.
  $effect(() => {
    const p = project;
    if (!p || read.state !== "ok") return;
    if (branchGraphStaleSeq(p.id) <= seenSeq) return;
    untrack(() => void refresh(true));
  });

  $effect(() => {
    const want = spec.branch;
    untrack(() => {
      if (!want || current?.branch === want) return;
      const key = pickRow(rows, want, null);
      const row = rows.find((r) => r.key === key);
      if (key && row?.branch === want) select(key, false);
    });
  });

  /** `scrollTop` 만 옮긴다 — `scrollIntoView` 는 바깥 창까지 흔든다 */
  function reveal(el: HTMLElement | null): void {
    const box = lwrap;
    if (!el || !box) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = revealScrollTop({ scrollTop: box.scrollTop, viewH: box.clientHeight, top, height: el.offsetHeight });
  }

  $effect(() => {
    if ((!pendingReveal && !pendingFocus) || !lwrap || rows.length === 0) return;
    const key = selected;
    const focus = pendingFocus;
    untrack(() => {
      pendingReveal = false;
      pendingFocus = false;
      void tick().then(() => {
        const el = key ? (lwrap?.querySelector<HTMLElement>(`[data-branch-key="${CSS.escape(key)}"]`) ?? null) : null;
        reveal(el);
        if (focus) el?.focus({ preventScroll: true });
      });
    });
  });

  // 시계 없음 — 세션 표가 반응형이다.
  $effect(() => {
    const p = project;
    if (!p || read.state !== "offline" || !isRemote(p)) return;
    if (liveSessionFor(p.host) !== null) untrack(() => void load());
  });

  /** 초점만 옮긴다 — 고르기 · 펴기는 Enter/Space(단추 누름) */
  function onNavKey(ev: KeyboardEvent): void {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const k = ev.key;
    if (k !== "ArrowDown" && k !== "ArrowUp" && k !== "Home" && k !== "End") return;
    const list = [...(lwrap?.querySelectorAll<HTMLElement>("[data-branch-nav]") ?? [])];
    const i = list.indexOf(ev.currentTarget as HTMLElement);
    if (i < 0) return;
    ev.preventDefault();
    const j =
      k === "Home" ? 0 : k === "End" ? list.length - 1 : Math.min(list.length - 1, Math.max(0, i + (k === "ArrowDown" ? 1 : -1)));
    list[j].focus({ preventScroll: true });
    reveal(list[j]);
  }

  /** 접힌 줄 자신은 아니다 — 같은 `f:` 덩어리 열쇠를 달고 있어도 아직 펴지지 않았다(넣으면 펴기 대신 빈 접기가 돈다). */
  function openFoldOf(r: GraphRow): string | null {
    if (r.kind === "fold") return null;
    if (r.block?.startsWith("f:")) return r.block.slice(2);
    const m = r.key.startsWith("m:") ? r.key.slice(2) : null;
    return m !== null && openFolds.includes(m) ? m : null;
  }

  /** 펼친 덩어리의 줄기 칸 · 이름 칸은 접기 손잡이다 — 펼 때 누른 `▸ 이름` 자리가 접기 자리이기도 해야 한다(사용자 결정). */
  function onRow(r: GraphRow, ev: MouseEvent): void {
    const refold = openFoldOf(r);
    if (refold !== null && ev.target instanceof Element && ev.target.closest(".gut, .ncell")) {
      collapse(refold);
      return;
    }
    if (r.kind === "fold" && r.hash) expand(r.hash);
    else if (r.kind !== "skip") select(r.key, true, false);
  }

  // ── 그리기 도우미 ──

  const commitOf = (r: GraphRow) => rowCommit(graph, r);

  function countsOf(r: GraphRow): { added: number; deleted: number } | null {
    if (!graph) return null;
    if (r.kind === "wip") {
      const d = graph.worktrees.find((w) => w.path === r.worktree)?.dirty;
      return d ? { added: d.added, deleted: d.deleted } : null;
    }
    if (r.kind === "fold") {
      const f = graph.folds.find((x) => x.merge === r.hash);
      return f ? commitsTotal(graph, f.commits) : null;
    }
    const c = commitOf(r);
    return c && c.added !== null && c.deleted !== null ? { added: c.added, deleted: c.deleted } : null;
  }

  const messageOf = (r: GraphRow) => rowMessage(graph, r, t);

  const isMergeCommit = (r: GraphRow) => rowIsMerge(graph, r);

  /** 열 수 없으면 그 까닭 */
  function blockOf(f: ChangedFile, worktree: string | null): string | null {
    if (!worktree) return t("app.branches.files.noWorktree");
    if (f.status === "D") return t("app.branches.files.deleted");
    return null;
  }

  function openFile(f: ChangedFile, worktree: string | null): void {
    const p = project;
    if (!p || !worktree || blockOf(f, worktree)) return;
    openBranchFile(paneId, p, worktree, f.path);
  }

  /** Ctrl+클릭은 워크트리의 지금 파일을 문서 보기로 연다. `f` 가 없으면 그 범위 전체 diff. */
  function openFileDiff(ev: MouseEvent | null, f: ChangedFile | null, ctx: DiffCtx): void {
    const p = project;
    if (!p) return;
    if (ev?.ctrlKey && f) {
      openFile(f, ctx.worktree);
      return;
    }
    const file = f?.path;
    if (ctx.kind === "commit") {
      openDiff(p, {
        scope: "commit",
        commit: ctx.hash,
        ...(ctx.branch ? { branch: ctx.branch } : {}),
        ...(ctx.worktree ? { worktreePath: ctx.worktree } : {}),
        ...(file ? { file } : {}),
      });
    } else {
      openDiff(p, {
        scope: "wip",
        worktreePath: ctx.worktree,
        ...(ctx.branch ? { branch: ctx.branch } : {}),
        ...(file ? { file } : {}),
      });
    }
  }
  // 머리줄이 서 있으면 도구줄이 머리줄 가운데로 올라가고(`pane/pane-tools.svelte.ts`), 없으면 몸 맨 위에 그린다.
  const inHead = $derived(!!paneId && paneHeadShown(paneId));
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, { bar: branchBar, nameTip: () => branchFacts });
  });
  /** 머리줄에서는 줄에 세우지 않고 이름 말풍선으로 옮긴다(사용자 결정) */
  const branchFacts = $derived(
    [t("app.branches.readOnly"), ...(graph ? [graph.main ? t("app.branches.base", { main: graph.main }) : t("app.branches.base.none")] : [])].join(" · "),
  );
</script>

{#snippet nums(c: { added: number; deleted: number } | null)}
  {#if c && (c.added > 0 || c.deleted > 0)}<span class="plus">+{c.added}</span>{" "}<span class="minus">−{c.deleted}</span>{/if}
{/snippet}

{#snippet fileCounts(f: ChangedFile)}
  {#if f.added === null && f.deleted === null}
    <span class="n">{t("app.branches.files.binary")}</span>
  {:else}
    <span class="n"
      >{#if (f.added ?? 0) > 0}<span class="plus">+{f.added}</span>{/if}{#if (f.added ?? 0) > 0 && (f.deleted ?? 0) > 0}{" "}{/if}{#if (f.deleted ?? 0) > 0}<span
          class="minus">−{f.deleted}</span
        >{/if}</span
    >
  {/if}
{/snippet}

{#snippet fileList(
  fr: FilesRead<CommitFiles> | FilesRead<WipFiles> | { state: "loading" } | null,
  worktree: string | null,
  ctx: DiffCtx | null,
)}
  <div class="sec">
    {#if fr === null || fr.state === "loading"}
      <div class="sh"><span>{t("app.branches.files.title")}</span></div>
      <div class="muted">{t("app.branches.files.loading")}</div>
    {:else if fr.state === "offline"}
      <div class="sh"><span>{t("app.branches.files.title")}</span></div>
      <div class="muted">{t("app.branches.offline", { host: project?.host ?? "" })}</div>
    {:else if fr.state === "error"}
      <div class="sh"><span>{t("app.branches.files.title")}</span></div>
      <div class="muted err" title={fr.message}>{fr.message}</div>
    {:else}
      {@const sum = filesTotal(fr.files.files)}
      <div class="sh">
        <span>{t("app.branches.files.title")}</span>
        <span class="n">{@render nums(sum)}</span>
        {#if ctx && !("merge" in fr.files && fr.files.merge) && fr.files.files.length > 0}
          <button type="button" class="alllink" data-branch-diff-all onclick={() => openFileDiff(null, null, ctx)}
            >{ctx.kind === "commit" ? t("app.branches.files.diffAll") : t("app.branches.files.wipAll")}</button
          >
        {/if}
      </div>
      {#if "merge" in fr.files && fr.files.merge}
        <div class="muted" data-branch-files-merge>{t("app.branches.files.merge")}</div>
      {:else if fr.files.files.length === 0}
        <div class="muted">{t("app.branches.files.none")}</div>
      {:else}
        <div class="files">
          {#each fr.files.files as f (f.path)}
            {@const blocked = blockOf(f, worktree)}
            <button
              type="button"
              class="file"
              data-branch-file={f.path}
              data-branch-file-doc-blocked={blocked !== null ? "" : undefined}
              title={t("app.branches.files.diff", { path: f.path }) +
                `\n${blocked ?? t("app.branches.files.ctrlDoc")}` +
                (f.oldPath ? `\n${t("app.branches.files.renamed", { old: f.oldPath })}` : "")}
              onclick={(ev) => (ctx ? openFileDiff(ev, f, ctx) : openFile(f, worktree))}
            >
              <span class="st st-{f.status}">{f.status}</span>
              <span class="p"><span dir="ltr">{f.path}</span></span>
              {@render fileCounts(f)}
            </button>
          {/each}
        </div>
        {#if fr.files.truncated}
          <div class="muted">{t("app.branches.files.truncated", { n: MAX_FILES })}</div>
        {/if}
      {/if}
    {/if}
  </div>
{/snippet}

{#snippet rowAgent(r: GraphRow)}
  {#if r.label?.kind === "head" && !r.label.merged}
    {@const agent = agentOf(r.label.worktree)}
    {#if agent}<AgentStatusGlyph state={agent.state} data-agent-dot={agent.state} title={agent.label} aria-label={agent.label} />{/if}
  {/if}
{/snippet}

{#snippet branchBar(head: boolean)}
    <div class="bar" class:inhead={head}>
      {#if !head}
        <span class="ro">{t("app.branches.readOnly")}</span>
        {#if graph}
          <span class="base">{graph.main ? t("app.branches.base", { main: graph.main }) : t("app.branches.base.none")}</span>
        {/if}
      {/if}
      <span class="sp"></span>
      <button
        type="button"
        class="btn refresh"
        data-head-act
        class:spinning
        title={t("app.branches.refresh")}
        aria-label={t("app.branches.refresh")}
        aria-busy={refreshing}
        data-branch-refresh
        onclick={() => void refresh()}
        onanimationiteration={() => {
          if (!refreshing) spinning = false;
        }}><UiIcon name="refresh" size={13} /></button
      >
    </div>
{/snippet}

<div class="branches branch-tones" role="presentation" tabindex="-1" data-tile-focus data-branch-graph={spec.projectId}>
  {#if !inHead}{@render branchBar(false)}{/if}

  {#if !project}
    <p class="note" data-branch-note="noProject">{t("app.branches.noProject")}</p>
  {:else if read.state === "loading"}
    <p class="note" data-branch-note="loading">{t("app.branches.loading")}</p>
  {:else if read.state === "offline"}
    <p class="note" data-branch-note="offline">{t("app.branches.offline", { host: project.host ?? "" })}</p>
  {:else if read.state === "notRepo"}
    <p class="note" data-branch-note="notRepo">{t("app.branches.notRepo")}</p>
  {:else if read.state === "error"}
    <p class="note err" data-branch-note="error" title={read.message}>{read.message}</p>
  {:else if graph && rows.length === 0}
    <p class="note" data-branch-note="empty">{t("app.branches.empty")}</p>
  {:else if graph}
    <div class="body">
      <div class="lwrap" bind:this={lwrap}>
        {#if graph.truncated}
          <p class="trunc">{t("app.branches.truncated")}</p>
        {/if}
        <div class="list" role="group" aria-label={t("app.branches.list.aria")}>
          {#each rows as r (r.key)}
            {@const isSel = r.key === selected}
            {#if r.kind === "skip"}
              <div class="row skip tone-0" data-branch-key={r.key} data-branch-kind="skip">
                <BranchRowCells row={r} merge={false} />
                <span class="msg dim">{messageOf(r)}</span>
                <span class="w"></span>
                <span class="t"></span>
              </div>
            {:else}
              <button
                type="button"
                class="row tone-{r.tone}"
                class:sel={isSel}
                class:refold={openFoldOf(r) !== null}
                tabindex={r.key === tabKey ? 0 : -1}
                aria-pressed={r.kind === "fold" ? undefined : isSel}
                aria-expanded={r.kind === "fold" ? false : undefined}
                title={r.kind === "fold" ? t("app.branches.row.foldTitle") : undefined}
                data-branch-nav
                data-branch-key={r.key}
                data-branch-kind={r.kind}
                data-branch-lane={r.lane}
                data-branch-name={r.branch ?? undefined}
                data-branch-selected={isSel ? "" : undefined}
                onclick={(ev) => onRow(r, ev)}
                onkeydown={onNavKey}
              >
                <BranchRowCells row={r} merge={isMergeCommit(r)} after={rowAgent} />
                <span class="msg" class:dim={r.kind !== "commit" && r.kind !== "main" ? true : isMergeCommit(r)}
                  >{messageOf(r)}</span
                >
                <span class="w">{@render nums(countsOf(r))}</span>
                <span class="t"
                  >{#if r.kind === "wip"}{t("app.branches.row.wipTime")}{:else if commitOf(r)}{relativeTime(
                      (commitOf(r)?.time ?? 0) * 1000,
                      now,
                      t,
                    )}{/if}</span
                >
              </button>
            {/if}
          {/each}
        </div>
        {#if graph.mainMore && nextMainLimit(mainLimit) !== null}
          <button type="button" class="more" data-branch-more onclick={more}>{t("app.branches.more")}</button>
        {/if}
      </div>

      <div class="info" data-branch-info={current?.key ?? ""}>
        {#if current && current.kind === "wip"}
          {@const wt = graph.worktrees.find((w) => w.path === current.worktree) ?? null}
          {@const agent = agentOf(current.worktree)}
          {@const wtName = wt ? (wt.primary ? t("app.branches.sub.primary") : folderTail(wt.path)) : ""}
          <div class="h">{t("app.branches.wip.head")}</div>
          <div class="subj">{t("app.branches.wip.title", { worktree: wtName })}</div>
          <dl class="kv">
            <dt>{t("app.branches.info.worktree")}</dt>
            <dd class="mono">{wtName}</dd>
            <dt>{t("app.branches.info.branch")}</dt>
            <dd class="mono tone-{current.tone}"><span class="tn">{wt?.branch ?? t("app.branches.info.detached")}</span></dd>
            <dt>{t("app.branches.info.base")}</dt>
            <dd class="mono">{t("app.branches.info.head", { hash: shortHash(wt?.head) })}</dd>
          </dl>
          {@render fileList(
            wipFiles,
            current.worktree,
            current.worktree ? { kind: "wip", worktree: current.worktree, branch: wt?.branch ?? null } : null,
          )}
          {#if agent && agent.ids.length > 0}
            <div class="acts">
              <button
                type="button"
                class="btn secondary"
                title={t("app.branches.goto.title")}
                data-branch-goto
                onclick={() => focusPaneAnywhere(agent.ids[0])}>{t("app.branches.goto")}</button
              >
            </div>
          {/if}
        {:else if current && current.kind === "fold"}
          <div class="h">{current.branch ?? shortHash(current.hash)}</div>
          <div class="subj">{messageOf(current)}</div>
          <button type="button" class="chipbtn" data-branch-unfold onclick={() => current.hash && expand(current.hash)}
            >{t("app.branches.row.foldTitle")}</button
          >
        {:else if current && (current.kind === "main" || current.kind === "commit")}
          {@const c = commitOf(current)}
          {@const agent = agentOf(current.worktree)}
          {@const foldMerge = current.block?.startsWith("f:") ? current.block.slice(2) : null}
          <div class="hd">
            <span class="subj">{c?.subject ?? ""}</span>
            <span class="h">{shortHash(current.hash)}</span>
          </div>
          <div class="meta">
            <span class="pill tone-{current.tone}" title={t("app.branches.info.branch")}>{current.branch ?? "—"}</span>
            {#if c}<span>{relativeTime(c.time * 1000, now, t)}</span>{/if}
            {#if foldMerge}
              <button type="button" class="chipbtn" data-branch-refold onclick={() => collapse(foldMerge)}
                >{t("app.branches.refold", { name: current.branch ?? shortHash(foldMerge) })}</button
              >
            {/if}
          </div>
          {@render fileList(
            commitFiles,
            current.worktree,
            current.hash
              ? { kind: "commit", hash: current.hash, branch: current.branch ?? graph.main ?? null, worktree: current.worktree }
              : null,
          )}
          {#if agent && agent.ids.length > 0}
            <div class="acts">
              <button
                type="button"
                class="btn secondary"
                title={t("app.branches.goto.title")}
                data-branch-goto
                onclick={() => focusPaneAnywhere(agent.ids[0])}>{t("app.branches.goto")}</button
              >
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .branches {
    container: branches / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판은 타일 상자가 한 번 칠한다 — 여기는 `--tile-inner`(투명 · `PaneHost`) */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
  }

  .branches:focus {
    outline: none;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-2);
    flex-wrap: wrap;
  }

  .bar.inhead {
    flex: 1 1 0;
    min-width: 0;
    flex-wrap: nowrap;
    padding: 0 0 0 4px;
    border-bottom: none;
    /* 줄의 gap 과 같은 값 — 포커스 밖에서 접히는 단추(`data-head-act`)의 앞 간격을 지운다(`pane/pane-tools.svelte.ts`) */
    --head-act-gap: 8px;
  }

  .ro {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    white-space: nowrap;
  }

  .btn:focus-visible,
  .file:focus-visible,
  .more:focus-visible,
  .chipbtn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .base {
    color: var(--fg-3);
    white-space: nowrap;
  }

  .sp {
    flex: 1 1 auto;
  }

  .btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 7px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius);
    cursor: pointer;
  }

  .btn:hover {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn.secondary {
    border-color: var(--border);
    color: var(--fg);
  }

  .btn.refresh {
    padding: 3px 5px;
  }

  .btn.refresh.spinning :global(svg) {
    animation: branches-spin 0.9s linear infinite;
  }

  @keyframes branches-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 돌지 않으니 바퀴 끝 이벤트도 없다 — 흐림은 `spinning` 이 아니라 `aria-busy` 를 따른다. */
  @media (prefers-reduced-motion: reduce) {
    .btn.refresh.spinning :global(svg) {
      animation: none;
    }
    .btn.refresh[aria-busy="true"] :global(svg) {
      opacity: 0.5;
    }
  }

  @container branches (max-width: 420px) {
    .base {
      display: none;
    }
  }

  .note {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    font-size: 12px;
    color: var(--fg-3);
  }

  .note.err,
  .muted.err {
    color: var(--err);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
  }

  @container branches (max-width: 720px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
    }
    .body .lwrap {
      border-right: 0;
      border-bottom: 1px solid var(--border);
    }
  }

  .lwrap {
    min-width: 0;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    border-right: 1px solid var(--border);
  }

  .trunc {
    margin: 0;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--fg-3);
    border-bottom: 1px solid var(--border);
  }

  .list {
    display: grid;
    padding: 4px 6px;
  }

  /* [줄기 칸 | 이름 칸 | 커밋 제목 | +A −D | 상대 시각] */
  .row {
    display: grid;
    grid-template-columns: 46px 190px minmax(0, 1fr) auto 52px;
    align-items: center;
    column-gap: 10px;
    height: 32px;
    width: 100%;
    /* 오른쪽만 — 커밋 점이 알약의 왼쪽 반원 안에 들게 */
    padding: 0 var(--space-3) 0 0;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row.skip {
    cursor: default;
  }

  .row:not(.skip):hover {
    background: var(--bg-hover);
  }

  /* 면만 — 왼쪽 색 띠는 두지 않는다(사용자 결정) */
  .row.sel {
    background: var(--accent-soft);
  }

  .row:focus-visible {
    outline: 1px solid var(--focus-ring, var(--accent));
    outline-offset: -1px;
  }

  @container branches (max-width: 520px) {
    .row {
      grid-template-columns: 46px 112px minmax(0, 1fr) 0 44px;
      column-gap: 6px;
    }
    .row .w {
      display: none;
    }
  }

  /* 펼친 덩어리의 줄기 칸 · 이름 칸 = 다시 접는 손잡이(`onRow`) */
  .row.refold :global(.gut),
  .row.refold :global(.ncell) {
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .row.refold :global(.gut:hover) {
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }

  .row.refold :global(.ncell:hover .name),
  .row:hover :global(.name.fold) {
    background: color-mix(in srgb, var(--lane) 28%, transparent);
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

  .w {
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
  }

  .t {
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    text-align: right;
    overflow: hidden;
  }

  .more {
    display: block;
    margin: 4px auto 10px;
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--fg-2);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .more:hover {
    color: var(--fg-2);
    background: var(--bg-hover);
  }

  .info {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 12px;
  }

  .h {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-3);
  }

  .subj {
    font-size: 13.5px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .hd .subj {
    flex: 1 1 auto;
    min-width: 0;
  }

  .hd .h {
    flex: 0 0 auto;
  }

  .meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    color: var(--fg-2);
  }

  .pill {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    height: 20px;
    padding: 0 8px;
    box-sizing: border-box;
    border: 1px solid color-mix(in srgb, var(--lane) 38%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--lane) 16%, transparent);
    color: var(--lane);
    font-size: 11.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta .chipbtn {
    align-self: center;
  }

  .kv {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 4px 12px;
    margin: 0;
  }

  .kv dt {
    color: var(--fg-3);
    white-space: nowrap;
  }

  .kv dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kv .mono {
    font-family: var(--font-mono);
  }

  .kv .tn {
    color: var(--lane);
  }

  .chipbtn {
    align-self: flex-start;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .chipbtn:hover {
    color: var(--fg);
  }

  .sec {
    display: grid;
    gap: 1px;
  }

  .sh {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: var(--fg-3);
    margin-bottom: 3px;
  }

  .muted {
    color: var(--fg-3);
  }

  .files {
    display: grid;
    gap: 1px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--fg) 3%, transparent);
  }

  .file {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: 6px;
    align-items: center;
    width: 100%;
    padding: 3px 4px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .file:hover {
    background: var(--bg-hover);
  }

  .st {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 700;
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 8%, transparent);
  }

  .st-M {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }

  .st-A {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }

  .st-D {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 14%, transparent);
  }

  .st-R {
    color: var(--tertiary);
    background: color-mix(in srgb, var(--tertiary) 14%, transparent);
  }

  /* 넘치면 앞을 자른다 — rtl + 안쪽 ltr 격리(문서 타일 경로와 같다) */
  .p {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  .n {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .plus {
    color: color-mix(in srgb, var(--ok) 70%, var(--fg-3));
  }

  .minus {
    color: color-mix(in srgb, var(--err) 70%, var(--fg-3));
  }

  .alllink {
    margin-left: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  .alllink:hover {
    text-decoration: underline;
  }

  .alllink:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  .acts {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
</style>
