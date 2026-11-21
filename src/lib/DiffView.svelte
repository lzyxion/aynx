<script lang="ts">
  import { tick, untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { paneHeadShown, setPaneTools } from "$lib/pane/pane-tools.svelte.js";
  import { projectById } from "$lib/app/project-list.svelte.js";
  import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
  import DomFindBar from "$lib/DomFindBar.svelte";
  import FilesPane from "$lib/diff/FilesPane.svelte";
  import ScopeBar from "$lib/diff/ScopeBar.svelte";
  import CommentTray from "$lib/diff/CommentTray.svelte";
  import PatchView from "$lib/diff/PatchView.svelte";
  import { createDiffComments } from "$lib/diff/comments-controller.svelte.js";
  import { registerTileFind } from "$lib/app/tile-find";
  import { comboFromEvent, effectiveCombo, isEditableTarget } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import {
    noteDiff,
    openDiffDoc,
    readDiffFile,
    readDiffFiles,
    type DiffFileRead,
    type DiffFilesRead,
  } from "$lib/app/diff-view.svelte.js";
  import {
    commentBelongs,
    commentEntryKey,
    selectionKeys,
    type DiffComment,
    type DiffCommentWhere,
  } from "$lib/diff-comments";
  import { isRemote } from "$lib/projects";
  import {
    canSplit,
    chunks,
    docBlock,
    effectiveView,
    entriesTotal,
    entryKey,
    isNarrow,
    lineKey,
    ROW_CHUNK,
    pickEntry,
    shortHash,
    splitPath,
    splitRows,
    stepEntry,
    unifiedRows,
    type DiffCommit,
    type DiffEntry,
    type DiffLine,
    type DiffScopeKind,
    type DiffSpec,
    type SplitRow,
    type UnifiedRow,
  } from "$lib/diff-view";

  /**
   * diff 타일 — 읽기 전용(docs/log/2026-10-05-diff-tile.md). 스테이징 · 커밋 · 편집은 없다(풀 git GUI 를 만들지 않는다).
   * 줄 코멘트는 타일 메모리에만 산다(명세 · 배치 파일 · 디스크에 싣지 않는다). AI 타일로는 붙여 넣기만 한다 — Enter 는 사람이 누른다(`app/ask-ai` 의 같은 몸통).
   */
  let {
    paneId,
    spec,
  }: {
    paneId: string;
    spec: DiffSpec;
  } = $props();

  const project = $derived(projectById(spec.projectId));

  let read = $state<DiffFilesRead | { state: "loading" }>({ state: "loading" });
  let selected = $state<string | null>(null);
  let fileRead = $state<DiffFileRead | { state: "loading" } | null>(null);
  let width = $state(0);
  let commitMenu = $state(false);
  let fileMenu = $state(false);
  let shownChunks = $state(3);
  let bodyEl = $state<HTMLDivElement | null>(null);
  let loadSeq = 0;
  let fileSeq = 0;
  let chunkRaf = 0;

  // ── 줄 코멘트 ──────────────────────────────────────
  let anchorKey = $state<string | null>(null);
  let focusKey = $state<string | null>(null);
  /** 끄는 동안은 "+ 코멘트" 줄을 세우지 않는다 — 줄이 밀려 끄는 손 아래가 바뀌지 않게 */
  let dragging = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let rowsEl = $state<HTMLDivElement | null>(null);
  let selbarTop = $state<number | null>(null);
  let finder = $state<ReturnType<typeof DomFindBar> | null>(null);
  let pendingScroll: string | null = null;

  const cm = createDiffComments({
    get paneId() {
      return paneId;
    },
    get spec() {
      return spec;
    },
    get project() {
      return project;
    },
    get files() {
      return files;
    },
    get branch() {
      return branch;
    },
    get worktree() {
      return worktree;
    },
    get current() {
      return current;
    },
    get here() {
      return here;
    },
    get selKeys() {
      return selKeys;
    },
    get allLines() {
      return allLines;
    },
    get rootEl() {
      return rootEl;
    },
    clearSelection() {
      anchorKey = null;
      focusKey = null;
    },
  });

  const files = $derived(read.state === "ok" ? read.files : null);
  const entries = $derived(files?.files ?? []);
  const current = $derived(entries.find((e) => entryKey(e) === selected) ?? null);
  const index = $derived(current ? entries.indexOf(current) : -1);
  const narrow = $derived(isNarrow(width));
  const splitOk = $derived(canSplit(width));
  const view = $derived(effectiveView(spec.view, width));
  const file = $derived(fileRead?.state === "ok" ? fileRead.file : null);
  const uRows = $derived<UnifiedRow[]>(file && view === "unified" ? unifiedRows(file) : []);
  const sRows = $derived<SplitRow[]>(file && view === "split" ? splitRows(file) : []);
  const uChunks = $derived(chunks(uRows));
  const sChunks = $derived(chunks(sRows));
  const totalChunks = $derived(view === "split" ? sChunks.length : uChunks.length);
  const committed = $derived(entries.filter((e) => e.group === "committed"));
  const uncommitted = $derived(entries.filter((e) => e.group === "uncommitted"));
  const total = $derived(entriesTotal(entries));
  const branch = $derived(spec.branch ?? files?.branch ?? null);
  const worktree = $derived(files?.worktree ?? spec.worktreePath ?? null);
  const docWhy = $derived(docBlock(current, worktree));
  const docWhyText = $derived(
    docWhy === "noWorktree"
      ? t("app.diff.doc.noWorktree")
      : docWhy === "deleted"
        ? t("app.diff.doc.deleted")
        : docWhy === "noFile"
          ? t("app.diff.doc.noFile")
          : null,
  );
  const pickedCommit = $derived(
    spec.scope === "commit" ? (files?.commits.find((c) => spec.commit && c.hash.startsWith(spec.commit)) ?? null) : null,
  );

  const allLines = $derived(file ? file.hunks.flatMap((h) => h.lines) : []);
  const scopeCommit = $derived(spec.scope === "commit" ? (spec.commit ?? null) : spec.scope === "range" ? (spec.tip ?? null) : null);
  const here = $derived<DiffCommentWhere | null>(
    current ? { scope: spec.scope, commit: scopeCommit, group: current.group } : null,
  );
  const entryWhere = (e: DiffEntry): DiffCommentWhere => ({
    scope: spec.scope,
    commit: scopeCommit,
    group: e.group,
  });
  const selKeys = $derived(anchorKey && focusKey ? selectionKeys(allLines, anchorKey, focusKey) : []);
  const selSet = $derived(new Set(selKeys));
  const selEnd = $derived(selKeys.length > 0 ? selKeys[selKeys.length - 1] : null);
  const pairOf = $derived.by(() => {
    const m = new Map<string, string>();
    for (const r of sRows) {
      if (r.type !== "pair") continue;
      if (r.left) m.set(lineKey(r.left), r.key);
      if (r.right) m.set(lineKey(r.right), r.key);
    }
    return m;
  });
  const slotOf = (key: string | null): string | null => (key === null ? null : view === "split" ? (pairOf.get(key) ?? null) : key);
  const cardsAt = $derived.by(() => {
    const m = new Map<string, { c: DiffComment; n: number }[]>();
    cm.comments.forEach((c, i) => {
      if (!current || !here || !commentBelongs(c, here, current.path) || c.keys.length === 0) return;
      const at = slotOf(c.keys[c.keys.length - 1]);
      if (at) m.set(at, [...(m.get(at) ?? []), { c, n: i + 1 }]);
    });
    return m;
  });
  const composerAt = $derived(
    cm.composer && current && here && commentEntryKey(cm.composer, cm.composer.path) === commentEntryKey(here, current.path)
      ? slotOf(cm.composer.keys[cm.composer.keys.length - 1] ?? null)
      : null,
  );
  const selbarAt = $derived(cm.composer || dragging ? null : slotOf(selEnd));
  const askCombo = $derived(effectiveCombo("ask-ai-block", settings.current.keybindings));

  /** 범위를 정하는 칸만 — 커밋 · 워크트리 범위의 브랜치는 고르개 재료일 뿐이다 */
  const scopeKey = $derived(
    spec.scope === "branch"
      ? `b:${spec.branch ?? ""}`
      : spec.scope === "commit"
        ? `c:${spec.commit ?? ""}`
        : spec.scope === "range"
          ? `r:${spec.base ?? ""}:${spec.tip ?? ""}`
          : `w:${spec.worktreePath ?? ""}`,
  );

  async function load(): Promise<void> {
    const p = project;
    if (!p) return;
    const mine = ++loadSeq;
    if (read.state !== "ok") read = { state: "loading" };
    const r = await readDiffFiles(p, spec);
    if (mine !== loadSeq) return;
    read = r;
    if (r.state !== "ok") {
      fileRead = null;
      return;
    }
    const learn: Partial<DiffSpec> = {};
    if (!spec.branch && r.files.branch) learn.branch = r.files.branch;
    if (!spec.worktreePath && r.files.worktree) learn.worktreePath = r.files.worktree;
    if (Object.keys(learn).length > 0) noteDiff(paneId, learn);
    const keep = selected ? r.files.files.find((e) => entryKey(e) === selected) : undefined;
    const pick = keep ?? pickEntry(r.files.files, spec.file, spec.scope === "wip" ? "uncommitted" : undefined);
    select(pick, false);
  }

  function select(entry: DiffEntry | null, note = true): void {
    selected = entry ? entryKey(entry) : null;
    anchorKey = null;
    focusKey = null;
    if (!entry) {
      fileRead = null;
      return;
    }
    if (note && spec.file !== entry.path) noteDiff(paneId, { file: entry.path });
    void loadFile(entry);
  }

  async function loadFile(entry: DiffEntry): Promise<void> {
    const p = project;
    if (!p) return;
    const mine = ++fileSeq;
    fileRead = { state: "loading" };
    const r = await readDiffFile(p, spec, entry);
    if (mine !== fileSeq) return;
    fileRead = r;
    resetChunks();
    await tick();
    if (bodyEl) bodyEl.scrollTop = 0;
    if (pendingScroll) {
      const key = pendingScroll;
      pendingScroll = null;
      void scrollToRow(key);
    }
  }

  function resetChunks(): void {
    cancelAnimationFrame(chunkRaf);
    shownChunks = 3;
    const step = () => {
      if (shownChunks >= totalChunks) return;
      shownChunks += 4;
      chunkRaf = requestAnimationFrame(step);
    };
    chunkRaf = requestAnimationFrame(step);
  }

  $effect(() => {
    const p = project;
    void scopeKey;
    if (!p) return;
    untrack(() => {
      if (spec.name !== p.name && !spec.branch) noteDiff(paneId, { name: p.name });
      selected = null;
      fileRead = null;
      read = { state: "loading" };
      void load();
    });
  });

  $effect(() => {
    const want = spec.file;
    untrack(() => {
      if (!want || current?.path === want || read.state !== "ok") return;
      const hit = pickEntry(entries, want, spec.scope === "wip" ? "uncommitted" : undefined);
      if (hit && hit.path === want) select(hit, false);
    });
  });

  $effect(() => {
    const p = project;
    if (!p || read.state !== "offline" || !isRemote(p)) return;
    if (liveSessionFor(p.host) !== null) untrack(() => void load());
  });

  $effect(() => () => cancelAnimationFrame(chunkRaf));

  $effect(() => {
    const slot = selbarAt;
    void shownChunks;
    void cardsAt;
    const box = rowsEl;
    if (!slot || !box) {
      selbarTop = null;
      return;
    }
    void tick().then(() => {
      const row = box.querySelector<HTMLElement>(`[data-diff-row="${CSS.escape(slot)}"]`);
      selbarTop = row ? row.getBoundingClientRect().bottom - box.getBoundingClientRect().top - 2 : null;
    });
  });

  // 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(브랜치 타일과 같은 규칙)
  let refreshing = $state(false);
  let spinning = $state(false);

  async function refresh(): Promise<void> {
    refreshing = true;
    spinning = true;
    try {
      await load();
    } finally {
      refreshing = false;
    }
  }

  /** 그린 패치가 없으면 `false` — 모든 터미널 검색으로 넘어간다 */
  function openFind(): boolean {
    if (!rowsEl) return false;
    return finder?.show() ?? false;
  }

  $effect(() => {
    const id = paneId;
    return untrack(() => registerTileFind(id, openFind));
  });

  // ── 범위 · 보기 ────────────────────────────────────────────────────────────

  function setScope(scope: DiffScopeKind, extra: Partial<DiffSpec> = {}): void {
    commitMenu = false;
    noteDiff(paneId, { scope, ...extra });
  }

  function pickCommit(c: DiffCommit): void {
    setScope("commit", { commit: c.hash, file: undefined });
  }

  function setView(v: "unified" | "split"): void {
    if (v === "split" && !splitOk) return;
    noteDiff(paneId, { view: v === "split" ? "split" : undefined });
    resetChunks();
  }

  function step(dir: -1 | 1): void {
    const next = stepEntry(entries, selected, dir);
    if (next && entryKey(next) !== selected) select(next);
  }

  function openDoc(): void {
    const p = project;
    if (!p || !current || !worktree || docWhy) return;
    openDiffDoc(paneId, p, worktree, current.path);
  }

  /** `ask-ai-block` 은 터미널 층 조합이라 전역 표에 없다 — 포커스가 이 타일에 있으면 여기서 코멘트를 넘긴다 */
  function onKey(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) return;
    const combo = comboFromEvent(ev);
    if (askCombo && combo === askCombo) {
      ev.preventDefault();
      ev.stopPropagation();
      void cm.handOver();
      return;
    }
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return;
    if (isEditableTarget(ev.target)) return;
    if (ev.code === "BracketLeft" || ev.code === "BracketRight") {
      ev.preventDefault();
      step(ev.code === "BracketLeft" ? -1 : 1);
    } else if (ev.code === "KeyC" && selKeys.length > 0 && !cm.composer) {
      ev.preventDefault();
      cm.openComposer();
    } else if (ev.code === "Escape" && (commitMenu || fileMenu || cm.targetMenu)) {
      ev.preventDefault();
      commitMenu = false;
      fileMenu = false;
      cm.targetMenu = false;
    } else if (ev.code === "Escape" && selKeys.length > 0) {
      ev.preventDefault();
      anchorKey = null;
      focusKey = null;
    }
  }

  // ── 줄 고르기 · 코멘트 ──────────────────────────────────────────────────────

  function onNoDown(ev: PointerEvent, key: string): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    if (ev.shiftKey && anchorKey) focusKey = key;
    else {
      anchorKey = key;
      focusKey = key;
    }
    dragging = true;
    // 같은 함수 하나라 거듭 눌러도 한 벌만 붙고, 놓기 전에 타일이 닫혀도 아래 정리가 걷는다
    window.addEventListener("pointerup", endNoDrag, { once: true });
    rootEl?.focus({ preventScroll: true });
  }

  function endNoDrag(): void {
    dragging = false;
  }

  // 놓기 전에 언마운트되면(타일 닫기 · 탭 이동) 창에 남은 리스너를 걷는다
  $effect(() => () => window.removeEventListener("pointerup", endNoDrag));

  function onNoEnter(key: string): void {
    if (dragging) focusKey = key;
  }

  /** 범위가 다르면 범위부터 바꾼다 — 다시 읽은 뒤 그 파일만 고르고 줄까지는 따라가지 않는다 */
  function jumpTo(c: DiffComment): void {
    const key = c.keys[c.keys.length - 1];
    const sameScope = c.scope === spec.scope && (c.scope !== "commit" && c.scope !== "range" ? true : c.commit === scopeCommit);
    if (!sameScope) {
      const at = c.commit ? (c.scope === "range" ? { tip: c.commit } : { commit: c.commit }) : {};
      setScope(c.scope, { ...at, file: c.path });
      return;
    }
    if (current && here && commentBelongs(c, here, current.path)) {
      if (key) void scrollToRow(key);
      return;
    }
    const e = entries.find((x) => x.path === c.path && x.group === c.group);
    if (!e) return;
    pendingScroll = key ?? null;
    select(e);
  }

  async function scrollToRow(key: string): Promise<void> {
    const slot = slotOf(key);
    if (!slot) return;
    const rows: { key: string }[] = view === "split" ? sRows : uRows;
    const at = rows.findIndex((r) => r.key === slot);
    if (at >= 0) shownChunks = Math.max(shownChunks, Math.ceil((at + 1) / ROW_CHUNK) + 1);
    await tick();
    const el = bodyEl?.querySelector<HTMLElement>(`[data-diff-row="${CSS.escape(slot)}"]`);
    if (el && bodyEl) bodyEl.scrollTop = Math.max(0, el.offsetTop - bodyEl.clientHeight / 3);
  }

  function onRootPointer(ev: PointerEvent): void {
    const el = ev.target as HTMLElement | null;
    if (commitMenu && !el?.closest("[data-diff-commit-menu], [data-diff-scope-btn='commit']")) commitMenu = false;
    if (fileMenu && !el?.closest("[data-diff-file-menu], [data-diff-narrow-picker]")) fileMenu = false;
    if (cm.targetMenu && !el?.closest("[data-diff-target-menu], [data-diff-target]")) cm.targetMenu = false;
  }

  const closeCommitMenu = () => (commitMenu = false);
  const closeFileMenu = () => (fileMenu = false);

  // ── 그리기 도우미 ──────────────────────────────────────────────────────────

  function scopeLabelCommit(): string {
    if (spec.scope === "commit" && spec.commit) {
      const subject = pickedCommit?.subject ?? "";
      return subject
        ? t("app.diff.scope.commitPicked", { hash: shortHash(spec.commit), subject })
        : shortHash(spec.commit);
    }
    return t("app.diff.scope.commit");
  }

  const now = $derived.by(() => {
    void read;
    return Date.now();
  });

  const noOf = (l: DiffLine): number | null => l.newNo ?? l.oldNo;
  // 머리줄이 서 있으면 도구줄이 머리줄 가운데로 올라간다(`pane/pane-tools.svelte.ts`), 없으면(설정 `tile_header` · 폰) 몸 맨 위에
  const inHead = $derived(!!paneId && paneHeadShown(paneId));
  $effect(() => {
    const id = paneId;
    if (!id) return;
    return setPaneTools(id, { bar: diffBar, nameTip: () => t("app.diff.readOnly") });
  });
</script>

{#snippet counts(a: number | null, d: number | null, binary: boolean)}
  {#if binary}
    <span class="n">{t("app.diff.files.binary")}</span>
  {:else if a !== null || d !== null}
    <span class="n"
      >{#if (a ?? 0) > 0}<span class="plus">+{a}</span>{/if}{#if (a ?? 0) > 0 && (d ?? 0) > 0}{" "}{/if}{#if (d ?? 0) > 0}<span
          class="minus">−{d}</span
        >{/if}</span
    >
  {/if}
{/snippet}

{#snippet diffBar(head: boolean)}
    <div class="bar" class:inhead={head}>
      {#if !head}<span class="ro">{t("app.diff.readOnly")}</span>{/if}
      <span class="sp"></span>
      <button
        type="button"
        class="btn"
        data-head-act
        disabled={docWhy !== null}
        title={docWhyText ?? t("app.diff.openDoc.title")}
        aria-label={t("app.diff.openDoc")}
        data-diff-doc
        onclick={openDoc}
        ><UiIcon name="file-text" size={13} />{#if !head}<span class="label">{t("app.diff.openDoc")}</span>{/if}</button
      >
      <button
        type="button"
        class="btn refresh"
        class:spinning
        data-head-act
        title={t("app.diff.refresh")}
        aria-label={t("app.diff.refresh")}
        aria-busy={refreshing}
        data-diff-refresh
        onclick={() => void refresh()}
        onanimationiteration={() => {
          if (!refreshing) spinning = false;
        }}
        ><UiIcon name="refresh" size={13} />{#if !head}<span class="label">{t("app.diff.refresh")}</span>{/if}</button
      >
    </div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="diff"
  role="presentation"
  tabindex="-1"
  data-tile-focus
  data-diff-pane={paneId}
  data-diff-scope={spec.scope}
  data-diff-view={view}
  data-diff-narrow={narrow ? "" : undefined}
  bind:clientWidth={width}
  bind:this={rootEl}
  onkeydown={onKey}
  onpointerdown={onRootPointer}
>
  {#if !inHead}{@render diffBar(false)}{/if}

  {#if !project}
    <p class="note" data-diff-note="noProject">{t("app.diff.noProject")}</p>
  {:else}
    <ScopeBar
      {spec}
      {files}
      {branch}
      {worktree}
      {entries}
      {total}
      {view}
      {splitOk}
      {narrow}
      {current}
      {index}
      {selected}
      {now}
      bind:commitMenu
      bind:fileMenu
      {setScope}
      {pickCommit}
      {setView}
      {select}
      {scopeLabelCommit}
      {closeCommitMenu}
      {closeFileMenu}
      {counts}
    />

    {#if read.state === "loading"}
      <p class="note" data-diff-note="loading">{t("app.diff.loading")}</p>
    {:else if read.state === "offline"}
      <p class="note" data-diff-note="offline">{t("app.diff.offline", { host: project.host ?? "" })}</p>
    {:else if read.state === "notRepo"}
      <p class="note" data-diff-note="notRepo">{t("app.diff.notRepo")}</p>
    {:else if read.state === "noScope"}
      <p class="note" data-diff-note="noScope">{t("app.diff.noScope")}</p>
    {:else if read.state === "error"}
      <p class="note err" data-diff-note="error" title={read.message}>{read.message}</p>
    {:else if files && files.merge}
      <p class="note" data-diff-note="merge">{t("app.diff.merge")}</p>
    {:else if files}
      <div class="body" class:narrow>
        {#if !narrow}
          <div class="lcol"><FilesPane {files} {entries} {committed} {uncommitted} {selected} commentCount={cm.commentCount} {entryWhere} {select} {counts} /></div>
        {/if}
        <div class="rcol">
          {#if current}
            {@const sp = splitPath(current.path)}
            <div class="fhead" data-diff-file-head={current.path}>
              <span class="path" title={current.path}><span class="dir">{sp.dir}</span>{sp.name}</span>
              {#if file}{@render counts(file.added, file.deleted, file.binary)}{/if}
              <span class="sp"></span>
              {#if !narrow && file && file.hunks.length > 0}<span class="fhint">{t("app.diff.file.hint")}</span>{/if}
              <button type="button" class="nav" disabled={index <= 0} title={t("app.diff.file.prev")} aria-label={t("app.diff.file.prev")} data-diff-prev onclick={() => step(-1)}>◀</button>
              <span class="pos">{index + 1}/{entries.length}</span>
              <button
                type="button"
                class="nav"
                disabled={index >= entries.length - 1}
                title={t("app.diff.file.next")}
                aria-label={t("app.diff.file.next")}
                data-diff-next
                onclick={() => step(1)}>▶</button
              >
            </div>
          {/if}
          <DomFindBar
            bind:this={finder}
            root={rowsEl}
            scroller={() => bodyEl}
            label={t("app.diff.find")}
            onclose={() => rootEl?.focus({ preventScroll: true })}
          />
          <div class="dbody" bind:this={bodyEl} role="region" aria-label={t("app.diff.body.aria")} data-diff-body>
            {#if !current}
              <p class="note">{t("app.diff.files.none")}</p>
            {:else if fileRead === null || fileRead.state === "loading"}
              <p class="note" data-diff-note="fileLoading">{t("app.diff.file.loading")}</p>
            {:else if fileRead.state === "offline"}
              <p class="note">{t("app.diff.offline", { host: project.host ?? "" })}</p>
            {:else if fileRead.state === "error"}
              <p class="note err" title={fileRead.message}>{fileRead.message}</p>
            {:else if file}
              {#if file.binary}
                <p class="note" data-diff-note="binary">{t("app.diff.file.binary")}</p>
              {:else if file.hunks.length === 0 && file.truncated}
                <p class="note" data-diff-note="tooLarge">
                  {t("app.diff.file.tooLarge")}
                  {#if !docWhy}<button type="button" class="link" onclick={openDoc}>{t("app.diff.openDoc")}</button>{/if}
                </p>
              {:else if file.hunks.length === 0}
                <p class="note" data-diff-note="empty">{t("app.diff.file.empty")}</p>
              {:else}
                <PatchView
                  {paneId}
                  {view}
                  {narrow}
                  {uChunks}
                  {sChunks}
                  {shownChunks}
                  {selSet}
                  {selbarAt}
                  {selbarTop}
                  {cardsAt}
                  {composerAt}
                  {cm}
                  {noOf}
                  {onNoDown}
                  {onNoEnter}
                  bind:rowsEl
                />
                {#if file.truncated}
                  <p class="note trunc" data-diff-note="truncated">
                    {t("app.diff.file.truncated")}
                    {#if !docWhy}<button type="button" class="link" onclick={openDoc}>{t("app.diff.openDoc")}</button>{/if}
                  </p>
                {/if}
              {/if}
            {/if}
          </div>
        </div>
      </div>
    {/if}
    {#if cm.comments.length > 0 || cm.composer}
      <CommentTray
        comments={cm.comments}
        composer={cm.composer}
        targets={cm.targets}
        target={cm.target}
        unsent={cm.unsent}
        {askCombo}
        bind:targetMenu={cm.targetMenu}
        {jumpTo}
        clearSent={cm.clearSent}
        closeTargetMenu={cm.closeTargetMenu}
        pickTarget={cm.pickTarget}
        handOver={cm.handOver}
      />
    {/if}
  {/if}
</div>

<style>
  .diff {
    container: diff / inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    /* 글래스 크롬 타일이면 판은 타일 상자가 한 번 칠한다 — 여기서 또 칠하면 겹친다 */
    background: var(--tile-inner, var(--bg-panel));
    color: var(--fg);
    font-family: var(--font-ui);
    --plus-fg: color-mix(in srgb, var(--ok) 70%, var(--fg-3));
    --minus-fg: color-mix(in srgb, var(--err) 70%, var(--fg-3));
    --plus-bg: color-mix(in srgb, var(--ok) 14%, transparent);
    --minus-bg: color-mix(in srgb, var(--err) 14%, transparent);
    --row-h: 20px;
  }

  .diff:focus {
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
  }

  .bar.inhead {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 0 0 4px;
    border-bottom: none;
    /* 포커스 밖에서 접힐 때 지울 앞 간격 = 이 줄의 `gap`(`PaneHeader` "드러냄" 절) */
    --head-act-gap: 4px;
  }

  .ro {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
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

  .btn:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .btn:focus-visible,
  .nav:focus-visible,
  .link:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  @container diff (max-width: 520px) {
    .btn .label {
      display: none;
    }
  }

  .btn.refresh.spinning :global(svg) {
    animation: diff-spin 0.9s linear infinite;
  }

  @keyframes diff-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .btn.refresh.spinning :global(svg) {
      animation: none;
    }
    .btn.refresh[aria-busy="true"] :global(svg) {
      opacity: 0.5;
    }
  }

  .plus {
    color: var(--plus-fg);
    font-family: var(--font-mono);
  }

  .minus {
    color: var(--minus-fg);
    font-family: var(--font-mono);
  }

  .note {
    margin: 0;
    padding: 24px 16px;
    text-align: center;
    font-size: 12px;
    color: var(--fg-3);
  }

  .note.err {
    color: var(--err);
  }

  .note.trunc {
    padding: 10px 16px;
    border-top: 1px dashed var(--border);
  }

  .link {
    border: 0;
    background: transparent;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 270px minmax(0, 1fr);
  }

  .body.narrow {
    grid-template-columns: minmax(0, 1fr);
  }

  .lcol {
    min-height: 0;
    overflow: auto;
    border-right: 1px solid var(--border);
  }

  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }

  .dir {
    color: var(--fg-3);
  }

  .n {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .rcol {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .fhead {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-raised);
    font-size: 11.5px;
  }

  .fhead .path {
    font-size: 12px;
  }

  .fhead .pos {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-3);
  }

  .nav {
    padding: 1px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg-2);
    font-size: 10px;
    cursor: pointer;
  }

  .nav:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--fg);
  }

  .nav:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .dbody {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .fhint {
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
</style>
