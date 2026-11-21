<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import {
    KIND_KEY,
    keyText,
    attemptActions,
    attemptChipText,
    attemptNeedsHuman,
    attentionKey,
    attemptBand,
    workerLine,
    turnRows,
    clipText,
    commitRejectionHint,
    formatDuration,
    shortOid,
    activityLine,
    activityStatusKey,
    attemptCommits,
    isReviewer,
    ACTIVITY_WARN_KEY,
    type WorkerActivity,
    type AttemptView,
    type RunDetail,
  } from "$lib/orchestration/model";
  import { shortPath } from "../board/format";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import { modelLabel } from "$lib/model-order";
  import InfoNote from "$lib/settings/InfoNote.svelte";

  let {
    a,
    detail,
    activity,
    now,
    titles,
    busy,
    confirmWt = $bindable(),
    stopAttempt,
    removeWorktree,
    editDelegation,
    openDetail,
    viewTranscript,
  }: {
    a: AttemptView;
    detail: RunDetail;
    activity: Record<string, WorkerActivity>;
    now: number;
    titles: Map<string, string>;
    busy: boolean;
    confirmWt: string | null;
    stopAttempt: (a: AttemptView) => void;
    removeWorktree: (a: AttemptView) => void;
    editDelegation: (role?: string | null) => void;
    openDetail: (attemptId: string) => void;
    viewTranscript?: (a: AttemptView) => void;
  } = $props();

  const wa = $derived(attemptActions(a, detail.state, detail.leftovers));
  const why = $derived(attentionKey(a));
  const act = $derived(activityLine(a, activity[a.id], detail.transcripts?.[a.id]));
  const wl = $derived(workerLine(a, now, t));
  const wb = $derived(attemptBand(a));
  const trows = $derived(turnRows(a, t));
</script>

<div class="worker" class:alert={attemptNeedsHuman(a)} data-attempt-id={a.id} data-attempt-state={a.state}
  data-attempt-kind={wl.kind} data-attempt-role-id={a.roleId ?? ""}>
  <div class="worker-row">
    <ArtistAvatar cli={a.cli} size={20} />
    {#if wl.roleName}
      <span class="role-name" data-attempt-role-name={wl.roleName}>{wl.roleName}</span>
    {/if}
    <span class="chip faint" data-attempt-kind-chip={wl.kind} title={t(wl.kind === "judge" ? "orch.kind.judge.title" : "orch.kind.write.title")}
      >{keyText(KIND_KEY, wl.kind, t)}</span>
    <span class="chip faint mono">{a.cli}</span>
    <span class="chip" class:breathe={wl.turnRunning} data-attempt-chip={detail.state === "orphaned" ? "unknown" : a.state}
      title={detail.state === "orphaned" ? t("orch.attempt.state.unknown.title") : undefined}>{attemptChipText(a, detail.state, t)}</span>
    {#if a.resolves}
      <span class="chip warn" title={t("orch.attempt.resolves.title")} data-attempt-resolves={a.resolves}>{t("orch.attempt.resolves")}</span>
    {/if}
    {#if isReviewer(a)}
      <span class="chip" title={t("orch.attempt.role.reviewer.title")} data-attempt-role="reviewer">{t("orch.attempt.role.reviewer")}</span>
    {/if}
    <span class="task-title" title={a.taskId}>{titles.get(a.taskId) ?? a.taskId}</span>
    {#if a.branch}<span class="meta mono" title={a.worktree ?? ""}>{a.branch}</span>{/if}
    <span class="grow"></span>
    {#if detail.tasks.some((task) => task.id === a.taskId)}
    <button type="button" class="btn btn-sm btn-secondary" title={t("orch.artist.open.title")} data-attempt-detail={a.id}
      onclick={() => openDetail(a.id)}>{t("orch.player.select")}</button>
    {:else if viewTranscript}<button type="button" class="btn btn-sm btn-secondary" data-attempt-transcript={a.id} disabled={!a.conversationId} onclick={() => viewTranscript?.(a)}>{t("orch.artist.transcript")}</button>{/if}
    {#if wa.stop}
      <button type="button" class="btn btn-sm btn-ghost danger" title={t("orch.worker.stop.title")} data-attempt-stop={a.id}
        disabled={busy} onclick={() => stopAttempt(a)}>{t("orch.worker.stop")}</button>
    {/if}
    {#if wa.removeWorktree}
      <button type="button" class="btn btn-sm btn-ghost" title={t("orch.worker.wtRemove.title")} data-attempt-wt-remove={a.id}
        disabled={busy} onclick={() => (confirmWt = a.id)}>{t("orch.worker.wtRemove")}</button>
    {/if}
  </div>
  {#if why}<p class="attention" role="status" data-attempt-attention={a.attention ?? a.state}>{t(why)}</p>{/if}
  {#if a.lastCommitRejection}
    {@const cr = a.lastCommitRejection}
    {@const hint = commitRejectionHint(cr)}
    <p class={hint ? "attention" : "meta"} data-attempt-commit-rejected={cr.reason} data-needs-human={cr.needsHuman ? "1" : "0"}
      title={t("orch.commitRejected.title", { request: cr.requestId ?? "-" })}>
      {t("orch.commitRejected.line")} <span class="chip faint mono">{cr.reason}</span>{#if hint} — {t(hint)}{/if}
    </p>
  {/if}
  {#if wb}
    <div class="wband" role="status" data-attempt-band={wb.blocked ? "blocked" : "broken"}>
      {#if wb.blocked}
        {@const need = clipText(wb.blocked.need)}
        <p class="wband-head">{t("orch.blocked.head")}</p>
        {#if need.clipped}
          <div class="need-text" data-attempt-blocked-need>
            <InfoNote id="need-{a.id}" label={t("orch.blocked.full")} plain>
              {#snippet summary()}<span>{need.short}</span>{/snippet}
              {#snippet note()}<p class="need-text full" data-attempt-blocked-need-full>{wb.blocked!.need}</p>{/snippet}
            </InfoNote>
          </div>
        {:else}
          <p class="need-text" data-attempt-blocked-need>{need.short}</p>
        {/if}
        <p class="meta">{t("orch.blocked.hint")}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-attempt-delegation-edit={a.id} onclick={() => editDelegation(a.roleId ?? null)}
            >{t("orch.perm.title")}</button
          >
        </div>
      {/if}
      {#if wb.broken}
        <p class="wband-head" data-attempt-broken>{t("orch.conversation.broken")}</p>
      {/if}
    </div>
  {/if}
  {#if wl.headless && wl.turnNo > 0}
    <p class="meta turn-row" data-attempt-turn={wl.turnNo} data-turn-running={wl.turnRunning ? "1" : "0"}>
      <span class="chip faint">{t("orch.turn.no", { n: wl.turnNo })}</span>
      {#if wl.lastTool}<span class="mono" data-attempt-last-tool={wl.lastTool}>{t("orch.turn.tool", { tool: wl.lastTool })}</span>{/if}
      {#if wl.denials > 0}<span class="chip warn" data-attempt-denials={wl.denials}>{t("orch.turn.denials", { n: wl.denials })}</span>{/if}
      {#if wl.model}<span class="chip faint" data-attempt-model={wl.model} title={wl.model}>{t("orch.reviewer.turn.model", { model: modelLabel(wl.model) })}</span>{/if}
      <span data-attempt-elapsed>{formatDuration(wl.elapsedMs)}</span>
    </p>
    {#if wl.args}<p class="meta mono" data-attempt-turn-args title={t("orch.turn.args.title")}>{wl.args}</p>{/if}
  {/if}
  {#if trows.length > 0}
    <div class="notes" data-attempt-turns={trows.length}>
      <p class="meta notes-head">{t("orch.turn.history", { n: trows.length })}</p>
      <ul class="file-list">
        {#each trows as r (r.n)}
          <li data-turn={r.n} data-turn-outcome={r.outcome}>
            <span class="mono">#{r.n}</span>
            <span class={r.bad ? "chip warn" : "chip faint"}>{r.text}</span>
            <span class="grow"></span>
            <span class="meta">{t("orch.turn.tools", { n: r.tools })}</span>
            {#if r.denials > 0}<span class="meta" title={r.denialKinds.join(", ")}>{t("orch.turn.denials", { n: r.denials })}</span>{/if}
            <span class="meta mono">{r.durationMs === null ? "…" : formatDuration(r.durationMs)}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if act}
    <div class="activity" data-attempt-activity={a.id}>
      {#if act.warnings.length > 0}
        <p class="act-warns">
          {#each act.warnings as w (w)}
            <span class="chip warn" data-activity-warn={w} title={t(ACTIVITY_WARN_KEY[w].title)}>{t(ACTIVITY_WARN_KEY[w].label)}</span>
          {/each}
        </p>
      {/if}
      {#if act.lastText}
        <p class="act-text" data-activity-text>{act.lastText}</p>
      {:else if act.status}
        <p class="meta" data-activity-status={act.status}>{t(activityStatusKey(act.status))}</p>
      {:else if act.tools.length === 0}
        <p class="meta" data-activity-empty>{t("orch.activity.empty")}</p>
      {/if}
      {#if act.tools.length > 0}
        <ul class="act-tools">
          {#each act.tools as tl, i (i)}
            <li class="mono" data-activity-tool={tl.name}>
              <span class="tool-name">{tl.name}</span>
              {#if tl.summary}<span class="tool-sum">{tl.summary}</span>{/if}
              {#if tl.pending}<span class="meta">· {t("orch.activity.toolPending")}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      <div class="act-foot">
        {#if act.changedCount !== null}
          <span class="meta" data-activity-changed={act.changedCount}
            >{t(act.changedMore ? "orch.activity.changedMore" : "orch.activity.changed", { n: act.changedCount })}</span
          >
        {/if}
      </div>
    </div>
  {/if}
  {#if !detail.reports?.some((r) => r.attemptId === a.id)}
    {@const commits = attemptCommits(detail, a.id)}
    {#if commits.length > 0}
      <p class="meta" data-attempt-commits={a.id}>
        {t("orch.commits.title")}:
        {#each commits as c (c.commitOid)}
          <span class="chip faint mono" title={`${c.branch} · ${t("orch.commits.files", { n: c.files })}`}
            >{t("orch.commits.item", { oid: shortOid(c.commitOid), subject: c.subject })}</span>
        {/each}
      </p>
    {/if}
  {/if}
  {#if a.launchArgs}<p class="meta mono" data-attempt-args>{t("orch.worker.args", { args: a.launchArgs })}</p>{/if}
  {#if a.worktree}<p class="meta mono" title={a.worktree}>{shortPath(a.worktree)}</p>{/if}
  {#if a.exitReason}<p class="meta" data-attempt-exit>{t("orch.worker.exit", { reason: a.exitReason })}</p>{/if}
  {#if confirmWt === a.id}
    <div class="confirm" role="alertdialog" data-attempt-wt-confirm>
      <p class="confirm-text">{t("orch.worker.wtRemove.confirm")}</p>
      <div class="confirm-actions">
        <button type="button" class="btn btn-sm btn-secondary" onclick={() => (confirmWt = null)}>{t("orch.stop.cancel")}</button>
        <button type="button" class="btn btn-sm btn-primary" data-attempt-wt-ok disabled={busy}
          onclick={() => removeWorktree(a)}>{t("orch.worker.wtRemove")}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .grow {
    flex: 1;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: 999px;
    white-space: nowrap;
  }

  .chip.faint {
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
  }

  .danger {
    color: var(--err);
  }

  .confirm {
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-2) var(--space-3);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
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

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .worker {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) 0;
    border-top: 1px solid var(--line-faint, var(--line));
    font-size: var(--t-sm);
  }

  .worker > .meta,
  .worker > .attention {
    margin: 0;
  }

  .worker-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
  }

  .worker.alert {
    padding-left: var(--space-2);
    border-left: 3px solid var(--warn);
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
  }

  .attention {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .chip[data-attempt-chip="running"],
  .chip[data-attempt-chip="working"],
  .chip[data-attempt-chip="ready"] {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
  }

  .chip[data-attempt-chip="awaiting-human"],
  .chip[data-attempt-chip="stop-unconfirmed"],
  .chip[data-attempt-chip="stopping"] {
    background: var(--warn-soft);
  }

  .chip[data-attempt-chip="exited"],
  .chip[data-attempt-chip="stopped"] {
    color: var(--fg-2);
  }

  .chip.warn {
    background: var(--warn-soft);
  }

  .task-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* 작업자 줄 */
  .role-name {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .turn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0;
  }

  .chip.breathe {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
    animation: run-breathe 2.4s ease-in-out infinite;
  }

  @keyframes run-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chip.breathe {
      animation: none;
    }
  }

  .wband {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0;
    padding: var(--space-1) var(--space-2);
    background: var(--warn-soft);
    border: 1px solid var(--warn);
    border-radius: var(--radius-sm);
  }

  .wband p {
    margin: 0;
  }

  .wband-head {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .need-text {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-word;
    user-select: text;
  }

  .need-text.full {
    color: var(--fg-2);
  }

  .notes-head {
    margin: 2px 0 0;
  }

  /* 최근 활동 */
  .activity {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-field, transparent);
  }

  .act-warns {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
  }

  .chip.warn {
    background: var(--warn-soft);
    color: var(--fg-1);
  }

  .act-text {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .act-tools {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .act-tools li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .act-tools .tool-name {
    color: var(--fg-1);
    font-weight: var(--fw-semibold);
    margin-right: var(--space-1);
  }

  .act-foot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .file-list {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 240px;
    overflow: auto;
    font-size: var(--t-xs);
  }

  .file-list li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    line-height: 20px;
  }
</style>
