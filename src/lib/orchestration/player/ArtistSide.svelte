<script lang="ts">
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import {
    attemptActions,
    attemptBand,
    clipText,
    fileRows,
    formatDuration,
    shortOid,
    turnClock,
    turnList,
    type AttemptView,
    type ReportFilesView,
    type ReportView,
    type RunDetail,
    type WipFilesView,
  } from "$lib/orchestration/model";
  import type { TranscriptItem } from "$lib/context";
  import { shortPath } from "../board/format";
  import EqBars from "../EqBars.svelte";
  import SegTabs from "./SegTabs.svelte";

  const SHOWN_FILES = 12;

  let {
    a,
    detail,
    now,
    busy,
    items,
    judge,
    report,
    wip,
    reportFiles,
    gate,
    reviews,
    onTranscript,
    onStop,
    onDiff,
    onPermissions,
    head,
    gates,
    attempts,
    technical,
    more,
  }: {
    a: AttemptView;
    detail: RunDetail;
    now: number;
    busy: boolean;
    items: readonly TranscriptItem[];
    judge: boolean;
    report: ReportView | null;
    wip: WipFilesView | undefined;
    reportFiles: ReportFilesView | "loading" | { error: string } | undefined;
    gate: boolean;
    reviews: { have: number; need: number } | null;
    onTranscript: () => void;
    onStop: () => void;
    onDiff: () => void;
    onPermissions: () => void;
    head: Snippet;
    gates?: Snippet;
    attempts?: Snippet;
    technical?: Snippet;
    more?: Snippet;
  } = $props();

  let confirmStop = $state(false);
  let resTab = $state<"turns" | "info">("turns");
  const uid = $props.id();

  const lastTurn = $derived((a.turns ?? []).length > 0 ? a.turns![a.turns!.length - 1] : null);
  const clockBar = $derived(turnClock(a, detail, now));
  const turns = $derived(turnList(a, items, now, t));
  const band = $derived(attemptBand(a));
  const wa = $derived(attemptActions(a, detail.state, detail.leftovers));
  const list = $derived.by(() => {
    if (report) {
      const v = reportFiles;
      if (v === undefined || v === "loading") return { mode: judge ? "review" : "report", rows: [], total: null, truncated: false, error: null, loading: true };
      if ("error" in v) return { mode: judge ? "review" : "report", rows: [], total: null, truncated: false, error: v.error, loading: false };
      return { mode: judge ? "review" : "report", rows: fileRows(v.files), total: v.fileCount, truncated: v.truncated, error: null, loading: false };
    }
    if (!wip) return { mode: "wip", rows: [], total: null, truncated: false, error: null, loading: !!a.worktree };
    return { mode: "wip", rows: fileRows(wip.files), total: wip.fileCount, truncated: wip.truncated, error: wip.error ?? null, loading: false };
  });
  const filesNote = $derived(
    t(list.mode === "review" ? "orch.artist.files.review" : list.mode === "report" ? "orch.artist.files.report" : "orch.artist.files.wip", {
      n: list.total ?? (list.loading ? "…" : list.rows.length),
    }),
  );
  const canDiff = $derived(report ? !!report.commitOid && !!report.baseCommitOid : !!a.worktree && list.rows.length > 0);
  const moreFiles = $derived(Math.max(0, (list.total ?? list.rows.length) - Math.min(SHOWN_FILES, list.rows.length)));
  const nextTurnHint = $derived(!judge && (a.state === "idle" || a.state === "running") && !a.conversationBroken ? (lastTurn?.n ?? 0) + 1 : null);
  const baseOid = $derived(judge ? (a.reviewOf?.commitOid ?? null) : (a.baseCommit ?? null));
  const showClock = $derived(!gate || !!clockBar);
</script>

<aside class="side" data-artist-side={a.id}>
  <section class="card status" class:gate data-track-card="status" data-human-gate={gate ? "true" : "false"}>
    {@render head()}

    {#if band}
      <div class="band" role="status" data-artist-band={band.blocked ? "blocked" : "broken"}>
        {#if band.blocked}
          {@const need = clipText(band.blocked.need, 220)}
          <p class="band-head">{t("orch.blocked.head")}</p>
          <p class="band-text" title={need.clipped ? band.blocked.need : undefined} data-artist-need>{need.short}</p>
          <p class="band-text">{t("orch.player.permissionsHint")}</p>
          <button type="button" class="band-btn" data-artist-permissions onclick={onPermissions}>{t("orch.perm.title")}</button>
        {/if}
        {#if band.broken}
          <p class="band-head" data-artist-broken>{t("orch.conversation.broken")}</p>
        {/if}
      </div>
    {/if}

    {#if showClock}
      <div class="clock" data-artist-stat="clock">
        <div class="clock-row">
          <span>{t("orch.artist.stat.clock")}</span>
          {#if clockBar}<span class="mono">{`${formatDuration(clockBar.elapsedMs)} / ${formatDuration(clockBar.limitMs)}`}</span>
          {:else}<span class="idle">{t("orch.artist.stat.idle")}</span>{/if}
        </div>
        {#if clockBar}<span class="bar" aria-hidden="true"><span class="fill" class:late={clockBar.ratio >= 0.85} style:width="{Math.round(clockBar.ratio * 100)}%"></span></span>{/if}
      </div>
      {#if lastTurn}
        <div class="nums" style:--cols={reviews ? 3 : 2}>
          <div class="num" data-artist-stat="tools"><span class="num-label">{t("orch.artist.stat.tools")}</span><span class="stat-num">{lastTurn.tools ?? 0}</span></div>
          <div class="num" data-artist-stat="denials"><span class="num-label">{t("orch.artist.stat.denials")}</span><span class="stat-num" class:amber={(lastTurn.denials ?? 0) > 0}>{lastTurn.denials ?? 0}</span></div>
          {#if reviews}
            <div class="num" data-artist-stat="reviews"><span class="num-label">{t("orch.artist.stat.reviews")}</span><span class="stat-num">{reviews.have} / {reviews.need}</span></div>
          {/if}
        </div>
      {/if}
    {/if}

    {@render gates?.()}
  </section>

  {@render attempts?.()}

  <section class="card" data-track-card="files" data-artist-files={list.mode}>
    <div class="card-head">
      <h4>{t("orch.artist.stat.files")}</h4><span class="faint">· {filesNote}</span>
      <span class="grow"></span>
      {#if canDiff}
        <button type="button" class="chip-btn" data-artist-diff title={t("orch.artist.diff")} onclick={onDiff}>{t("orch.artist.diff")}</button>
      {/if}
    </div>
    {#if list.loading}
      <p class="faint small">{t("orch.artist.files.loading")}</p>
    {:else if list.error}
      <p class="faint small" data-artist-files-error>{t("orch.artist.files.error", { error: list.error })}</p>
    {:else if list.rows.length === 0}
      <p class="faint small">{t("orch.artist.files.none")}</p>
    {:else}
      <ul class="file-list">
        {#each list.rows.slice(0, SHOWN_FILES) as f (f.path)}
          <li data-artist-file={f.path} data-letter={f.letter}>
            <span class="letter" data-status={f.status}>{f.letter}</span>
            <span class="path" title={f.path}>{f.path}</span>
            {#if f.uncommitted}<span class="dot" title={t("orch.artist.files.uncommitted")} aria-label={t("orch.artist.files.uncommitted")}></span>{/if}
            {#if f.binary}
              <span class="faint small">{t("orch.artist.files.binary")}</span>
            {:else if f.adds === null && f.untracked}
              <span class="faint small">{t("orch.artist.files.new")}</span>
            {:else}
              {#if f.adds !== null && f.adds > 0}<span class="adds">+{f.adds}</span>{/if}
              {#if f.dels !== null && f.dels > 0}<span class="dels">−{f.dels}</span>{/if}
            {/if}
          </li>
        {/each}
      </ul>
      {#if moreFiles > 0 || list.truncated}
        <p class="faint small" data-artist-files-more>{t("orch.artist.files.more", { n: moreFiles })}</p>
      {/if}
    {/if}
  </section>

  <section class="card res" data-track-card="resources">
    <div class="card-head">
      <h4>{t("orch.artist.resources")}</h4>
      <span class="grow"></span>
      {#if technical}
        <SegTabs tabs={[{ id: "turns", label: turns.length > 0 ? `${t("orch.artist.res.turns")} ${turns.length}` : t("orch.artist.res.turns") }, { id: "info", label: t("orch.artist.res.info") }]}
          bind:value={resTab} label={t("orch.artist.res.tabs")} idBase="res-{uid}" name="artist-res" />
      {/if}
    </div>
    {#if a.worktree || baseOid}
      <dl class="kv" title={a.worktree ?? ""}>
        {#if a.worktree}<dt>{t("orch.artist.worktree")}</dt><dd class="mono">{shortPath(a.worktree)}</dd>{/if}
        {#if baseOid}<dt>{t(judge ? "orch.artist.reviewOf" : "orch.artist.base")}</dt><dd class="mono">{shortOid(baseOid)}</dd>{/if}
      </dl>
    {/if}
    <div class="turns" role={technical ? "tabpanel" : undefined} id="res-{uid}-turns" aria-labelledby={technical ? `res-${uid}-turns-tab` : undefined}
      data-artist-turns={turns.length} hidden={resTab !== "turns"}>
      {#if turns.length > 0}
        <ul>
          {#each turns as r (r.n)}
            <li class="turn" class:running={r.running} class:bad={r.bad} data-artist-turn={r.n} data-turn-outcome={r.outcome}>
              {#if r.running}
                <EqBars state={judge ? "reviewing" : "playing"} size={12} />
              {:else}
                <span class="turn-no mono">{r.n}</span>
              {/if}
              <span class="turn-text" title={r.prompt}>{t("orch.turn.no", { n: r.n })} · {r.prompt}</span>
              {#if r.bad}<span class="turn-bad">{r.outcomeText}</span>{/if}
              <span class="mono small">{formatDuration(r.durationMs)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="faint small" data-artist-turns-none>{t("orch.artist.turns.none")}</p>
      {/if}
      {#if nextTurnHint !== null}
        <p class="faint small">{t("orch.artist.turns.hint", { n: nextTurnHint })}</p>
      {/if}
    </div>
    {#if technical}
      <div class="res-info" role="tabpanel" id="res-{uid}-info" aria-labelledby="res-{uid}-info-tab" hidden={resTab !== "info"} data-artist-res-info>
        {@render technical()}
      </div>
    {/if}
  </section>

  <div class="bottom">
    {#if confirmStop}
      <div class="confirm" role="alertdialog" data-artist-stop-confirm>
        <p class="confirm-text">{t("orch.artist.stop.confirm")}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-sm btn-secondary" onclick={() => (confirmStop = false)}>{t("orch.stop.cancel")}</button>
          <button type="button" class="btn btn-sm btn-primary" data-artist-stop-ok disabled={busy}
            onclick={() => {
              confirmStop = false;
              onStop();
            }}>{t("orch.artist.stop.ok")}</button>
        </div>
      </div>
    {/if}
    <div class="row" data-artist-actions>
      <button type="button" class="pill" data-artist-transcript title={t("orch.artist.transcript.title")} disabled={!a.conversationId} onclick={onTranscript}
        >{t("orch.artist.transcript")}</button
      >
      {#if wa.stop}
        <button type="button" class="stop" aria-label={t("orch.artist.stop")} title={t("orch.artist.stop")} data-artist-stop disabled={busy}
          onclick={() => (confirmStop = true)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"></rect></svg>
        </button>
      {/if}
      {@render more?.()}
    </div>
  </div>
</aside>

<style>
  .side {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: var(--t-sm);
    color: var(--fg-1);
    box-sizing: border-box;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    padding: 14px 16px;
    border-radius: var(--radius-surface, 16px);
    background: var(--m3-surface-container-low, var(--bg-panel));
    box-sizing: border-box;
  }
  .card.gate {
    background: color-mix(in srgb, var(--warn) 12%, var(--m3-surface-container-low, var(--bg-panel)));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 50%, transparent);
  }
  .card.res {
    gap: 6px;
    padding-block: 12px;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .grow {
    flex: 1;
  }
  h4 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
  }
  .card-head .faint {
    font-size: var(--t-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-btn {
    flex: 0 0 auto;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--m3-surface-container-high, var(--surface-hover));
    border: 0;
    border-radius: 999px;
    padding: 4px 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .chip-btn:hover {
    background: var(--m3-surface-container-highest, var(--surface-hover));
  }
  .res-info[hidden] {
    display: none;
  }
  .clock-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  .idle {
    color: var(--fg-2);
  }
  .bar {
    display: block;
    position: relative;
    margin-top: 6px;
    height: 4px;
    border-radius: 999px;
    background: var(--control-track, var(--m3-surface-container-highest, var(--line)));
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    background: var(--accent);
  }
  .fill.late {
    background: var(--warn);
  }
  .nums {
    display: grid;
    grid-template-columns: repeat(var(--cols, 3), minmax(0, 1fr));
    gap: 6px;
  }
  .num {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 7px 10px;
    border-radius: 10px;
    background: var(--m3-surface-container, var(--surface-hover));
  }
  .num-label {
    font-size: 11px;
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .stat-num {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .stat-num.amber {
    color: var(--warn);
  }
  .band {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-surface-inner, 12px);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
  .card:not(.gate) .band {
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
  }
  .band p {
    margin: 0;
  }
  .band-head {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--warn);
  }
  .band-text {
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }
  .band-btn {
    align-self: flex-start;
    font: inherit;
    font-size: var(--t-xs);
    font-weight: 700;
    border: 0;
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    background: var(--warn);
    color: color-mix(in srgb, var(--warn) 22%, black);
  }
  .faint {
    color: var(--fg-3);
    font-weight: var(--fw-regular, 400);
  }
  .small {
    font-size: var(--t-xs);
  }
  p.small {
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }
  .file-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .letter {
    flex: 0 0 auto;
    width: 12px;
    text-align: center;
    color: var(--warn);
  }
  .letter[data-status="added"] {
    color: var(--ok);
  }
  .letter[data-status="deleted"] {
    color: var(--err);
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .adds {
    color: var(--ok);
  }
  .dels {
    color: var(--err);
  }
  .kv {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    row-gap: 4px;
    margin: 0;
    font-size: var(--t-xs);
  }
  .kv dt {
    color: var(--fg-3);
  }
  .kv dd {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .turns[hidden] {
    display: none;
  }
  .turns ul {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .turns p.small {
    margin-top: 6px;
  }
  .turn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--m3-surface-container, var(--surface-hover));
  }
  .turn.bad {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
  }
  .turn-no {
    width: 12px;
    text-align: center;
    color: var(--fg-3);
    font-size: var(--t-xs);
  }
  .turn-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .turn-bad {
    font-size: var(--t-xs);
    color: var(--warn);
    white-space: nowrap;
  }
  .bottom {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pill {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font: inherit;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--fg-1);
    background: color-mix(in srgb, var(--accent) 8%, var(--m3-surface-container-high, var(--surface-hover)));
    border: 0;
    border-radius: 999px;
    padding: 10px 12px;
    cursor: pointer;
  }
  .pill:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, var(--m3-surface-container-highest, var(--surface-hover)));
  }
  .pill:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .stop {
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--line-strong, var(--line));
    background: transparent;
    color: var(--err);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .stop:hover:not(:disabled) {
    background: var(--err-soft, var(--surface-hover));
  }
  .confirm {
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised-solid, var(--m3-surface-container-high));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md, 12px);
  }
  .confirm-text {
    margin: 0 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
