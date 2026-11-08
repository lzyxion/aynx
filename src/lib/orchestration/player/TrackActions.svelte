<script lang="ts">
  // 트랙 플레이어 오른쪽의 상태·보고·사람 관문. 확인 대상은 부모의 고정 묶음만 돌려준다.
  import { t } from "$lib/i18n/i18n.svelte.js";
  import {
    TASK_STATE_KEY,
    OUTCOME_KEY,
    KIND_KEY,
    VERDICT_KEY,
    keyText,
    roleSteps,
    judgmentRows,
    readinessLine,
    waiverNoteNeeded,
    waiverTexts,
    acceptedWaivers,
    reworkText,
    formatDuration,
    lastRevoked,
    lateReports,
    reportDiffRange,
    reviewActions,
    reviewReport,
    shortOid,
    taskActions,
    validAccepted,
    attemptCommits,
    liveJob,
    conflictSummary,
    conflictHintKey,
    resolverOf,
    integrationAbortText,
    lastAbortedJob,
    needsMergeHint,
    JOB_PHASE_KEY,
    VERIFY_OUTCOME_KEY,
    VERIFY_APPROVAL_TTL_MS,
    approveVerifyArgs,
    awaitingVerify,
    overridableVerify,
    reviewLine,
    reviewTurnLine,
    REVIEW_TURN_KEY,
    REVIEW_STATE_KEY,
    fileStatusLetter,
    type ReportFilesView,
    type ReportView,
    type RunDetail,
    type TaskView,
  } from "$lib/orchestration/model";
  import type { OverridePin, VerifyPin } from "../confirm-pin";
  import { clock } from "../board/format";
  import InfoNote from "$lib/settings/InfoNote.svelte";

  /** 판정 이력에 늘 보이는 줄 수 — 나머지는 "n개 더" ⓘ 팝오버 */
  const JUDGED_SHOWN = 4;

  let {
    task,
    detail,
    titles,
    busy,
    now,
    drift,
    files,
    filesOpen,
    verifyAsk,
    overrideAsk,
    setTask,
    review,
    toggleFiles,
    viewDiff,
    cancelTaskIntegration,
    askVerify,
    cancelVerify,
    runVerify,
    askOverride,
    cancelOverride,
    confirmOverride,
    taskState = true,
    attention = false,
  }: {
    task: TaskView;
    detail: RunDetail;
    titles: Map<string, string>;
    busy: boolean;
    now: number;
    drift: Set<string>;
    files: Record<string, ReportFilesView | "loading" | { error: string }>;
    filesOpen: Set<string>;
    verifyAsk: VerifyPin | null;
    overrideAsk: OverridePin | null;
    setTask: (task: TaskView, state: "cancelled" | "todo") => void;
    review: (task: TaskView, decision: "accept" | "reject") => void;
    toggleFiles: (task: TaskView, r: ReportView) => void;
    viewDiff: (r: ReportView) => void;
    cancelTaskIntegration: (task: TaskView) => void;
    askVerify: (taskId: string) => void;
    cancelVerify: () => void;
    runVerify: (pin: VerifyPin) => void;
    askOverride: (task: TaskView) => void;
    cancelOverride: () => void;
    confirmOverride: (pin: OverridePin, task: TaskView) => void;
    /** Task 취소 · 다시 열기를 이 줄에 그릴지 — 트랙 화면은 오른쪽 칸 맨 아래(시도 세부 정보 줄)에 따로 둔다 */
    taskState?: boolean;
    /** 사람 확인 카드 안인가 — 관문의 주 단추가 호박(아니면 강조색) */
    attention?: boolean;
  } = $props();

  const ta = $derived(taskActions(task, detail.state));
  const rep = $derived(reviewReport(detail, task));
  const acc = $derived(validAccepted(detail, task.id));
  // 통합 ref 에 쌓인 수락은 [반려로 뒤집기] 를 숨긴다(트랙 줄 "통합 a3f9c21" 과 같은 값)
  const ra = $derived(reviewActions(task, rep, detail.state, !!acc?.integrationCommit));
  const rev = $derived(acc ? null : lastRevoked(detail, task.id));
  const lates = $derived(lateReports(detail, task.id));
  const job = $derived(liveJob(detail, task.id));
  const resolver = $derived(resolverOf(task, detail.attempts));
  const ask = $derived(awaitingVerify(detail, task.id));
  const askArgs = $derived(ask ? approveVerifyArgs(detail, ask) : null);
  const ovr = $derived(overridableVerify(detail, task));
  const lv = $derived(detail.lastVerify?.[task.id]);
  const rvw = $derived(reviewLine(detail, task));
  const rturn = $derived(reviewTurnLine(detail, task));
  const steps = $derived(roleSteps(task, t));
  const judged = $derived(judgmentRows(detail, task.id, t));
  const ready = $derived(readinessLine(task, t));
  const rework = $derived(reworkText(task, t));

  const verifyOn = $derived(!!askArgs && detail.state !== "orphaned");
  /** 지금 이 트랙에 고정된 [검증 실행] 확인 묶음(있으면 관문 칸이 확인 모양 — 주 단추가 [이 후보로 검증 실행]) */
  const pinned = $derived(verifyOn && verifyAsk && verifyAsk.taskId === task.id ? verifyAsk : null);

  /** 확인이 고정되면 관문 칸을 화면 안으로(좁은 창은 오른쪽 칸이 가운데 판 아래로 쌓인다 — 이미 보이면 움직이지 않는다) */
  function reveal(el: HTMLElement, on: boolean) {
    const go = (v: boolean) => {
      if (v) requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }));
    };
    go(on);
    return { update: go };
  }

  function reviewer(who: "coordinator" | "human"): string {
    return who === "coordinator" ? t("orch.review.by.coordinator") : t("orch.review.by.human");
  }
</script>

<!-- 트랙 상태 낱말 · 판 버전은 오른쪽 칸 머리가 쥔다(같은 말 두 번 없음 — 버전은 툴팁) -->
<div class="task" data-task-id={task.id} data-task-state={task.state} title={`${keyText(TASK_STATE_KEY, task.state, t)} · ${t("orch.task.version", { n: task.version })}`}>
  <!-- 사람 관문(목업 V3TrackSideGate) — 검증 후보 · 명령 상자 · [검증 실행](넓게) · [반려](빨간 테두리) · 한 줄 안내. 확인이 고정되면 같은 칸이
       확인 모양이 된다(주 단추 = 이 후보로 검증 실행 · 경고 문구 · 만료 · [diff] [닫기]) — 칸이 오른쪽 맨 위 카드라 화면 밖으로 밀리지 않는다 -->
  {#if verifyOn || ra.accept || ra.reject}
    <div class="gate-box" class:amber={attention} data-track-gate-box={task.id} data-verify-ask={pinned ? task.id : undefined} role={pinned ? "dialog" : undefined}
      aria-label={pinned ? t("orch.verify.ask.title") : undefined} use:reveal={!!pinned}>
      {#if verifyOn && askArgs}
        {@const cand = t("orch.verify.ask.candidate", { oid: "\u0000", n: rep?.changedFiles.length ?? 0 }).split("\u0000")}
        <div class="verify-box">
          <!-- 한글 문장은 UI 글꼴 · 후보 OID 만 고정폭(실기 10-31) -->
          <p class="meta">{cand[0]}<span class="mono oid">{shortOid(pinned?.candidate ?? askArgs.candidate)}</span>{cand[1] ?? ""}</p>
          <p class="mono cmd">{detail.verify?.command}</p>
        </div>
        {#if pinned}
          <p class="attention-text">{t("orch.verify.ask.text")}</p>
          {#if ask?.awaitingAt}
            <p class="meta">{t("orch.verify.ask.expires", { min: Math.max(0, Math.ceil((ask.awaitingAt + VERIFY_APPROVAL_TTL_MS - now) / 60_000)) })}</p>
          {/if}
        {/if}
      {/if}
      <div class="gate-row">
        {#if verifyOn && pinned}
          {@const pin = pinned}
          <button type="button" class="gate-main" data-verify-run={task.id} disabled={busy} onclick={() => runVerify(pin)}>{t("orch.verify.ask.run")}</button>
        {:else if verifyOn}
          <button type="button" class="gate-main" data-verify-approve={task.id} title={t("orch.verify.approve.title")}
            disabled={busy} onclick={() => askVerify(task.id)}>{t("orch.verify.approve")}</button>
        {/if}
        {#if ra.accept}
          <button type="button" class={verifyOn ? "gate-side" : "gate-main"} data-review-accept={task.id} title={ra.blocked ? t(ra.blocked) : t("orch.review.accept.title")}
            disabled={busy || ra.blocked !== null} onclick={() => review(task, "accept")}
            >{ra.acceptFlip ? t("orch.review.flipAccept") : t("orch.review.accept")}</button>
        {/if}
        {#if ra.reject}
          <button type="button" class="gate-reject" data-review-reject={task.id} disabled={busy}
            onclick={() => review(task, "reject")}>{ra.rejectFlip ? t("orch.review.flipReject") : t("orch.review.reject")}</button>
        {/if}
      </div>
      {#if pinned}
        <div class="gate-row sub">
          {#if rep && reportDiffRange(rep)}
            <button type="button" class="btn btn-sm btn-ghost" onclick={() => viewDiff(rep)}>{t("orch.report.diff")}</button>
          {/if}
          <span class="grow"></span>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => cancelVerify()}>{t("orch.verify.ask.cancel")}</button>
        </div>
      {:else if verifyOn}
        <p class="gate-hint">{t("orch.verify.gate.hint")}</p>
      {/if}
      {#if ra.accept && ra.blocked === null && waiverNoteNeeded(task)}
        <p class="review-line warn-text" data-review-waiver-note={task.id}>{t("orch.waiver.note")}</p>
      {/if}
    </div>
  {/if}
  {#if rework}
    <span class={rework.atLimit ? "chip warn" : "chip faint"} title={t("orch.rework.title")} data-task-rework={rework.text}
      >{rework.text}</span>
  {/if}
  {#if resolver}
    <span class="chip warn" title={t("orch.conflict.resolving.title")} data-task-resolving={resolver.id}>{t("orch.conflict.resolving")}</span>
  {/if}
  {#each task.dependsOn as dep (dep)}
    <span class="chip faint" title={t("orch.task.deps")}>↳ {titles.get(dep) ?? dep}</span>
  {/each}
  <span class="grow"></span>
  {#if job}
    <span class="chip faint" data-task-job={job.phase}>{t("orch.integration.phase", { phase: keyText(JOB_PHASE_KEY, job.phase, t) })}</span>
    {#if job.phase !== "committing" && (detail.state === "running" || detail.state === "paused" || detail.state === "stopping")}
      <button type="button" class="btn btn-sm btn-ghost" data-integration-cancel={task.id} title={t("orch.integration.cancel.title")}
        disabled={busy} onclick={() => cancelTaskIntegration(task)}>{t("orch.integration.cancel")}</button>
    {/if}
  {/if}
  {#if taskState && ta.cancel}
    <button type="button" class="btn btn-sm btn-ghost" disabled={busy} onclick={() => setTask(task, "cancelled")}>{t("orch.task.cancel")}</button>
  {/if}
  {#if taskState && ta.reopen}
    <button type="button" class="btn btn-sm btn-ghost" disabled={busy} onclick={() => setTask(task, "todo")}>{t("orch.task.reopen")}</button>
  {/if}
  <!-- 거친 역할 · 판정 이력(3b — 설계 3-2a: roleHistory · reviewReports) -->
  {#if steps.length > 0}
    <p class="review-line roles-line" data-task-roles={task.id}>
      <span class="meta">{t("orch.roles.history")}</span>
      {#each steps as s (s.attemptId)}
        <span class={s.tone === "good" ? "chip" : s.tone === "bad" ? "chip warn" : "chip faint"} data-role-step={s.attemptId}
          data-role-kind={s.kind} data-role-outcome={s.outcome} title={keyText(KIND_KEY, s.kind, t)}>{s.name} · {s.text}</span>
      {/each}
    </p>
  {/if}
  {#if judged.length > 0}
    <!-- 판정 이력 — 늘 보이는 목록(최근 JUDGED_SHOWN 줄 · 나머지는 "n개 더" ⓘ 팝오버) -->
    {#snippet judgmentRow(j: (typeof judged)[number])}
      <li data-judgment={j.reviewId} data-verdict={j.verdict} data-judgment-state={j.state}>
        <span class="file-path">{j.roleName}</span>
        <span class={j.verdict === "pass" ? "chip" : "chip warn"}>{keyText(VERDICT_KEY, j.verdict, t)}</span>
        {#if j.state !== "current"}<span class="chip faint">{t(j.state === "late" ? "orch.player.judgment.late" : "orch.player.judgment.stale")}</span>{/if}
        <span class="grow"></span>
        <span class="meta mono">{clock(j.at)}</span>
      </li>
    {/snippet}
    <div class="notes" data-task-judgments={task.id}>
      <p class="meta notes-head">{t("orch.judgments.title", { n: judged.length })}</p>
      <ul class="file-list">
        {#each judged.slice(0, JUDGED_SHOWN) as j (j.reviewId)}{@render judgmentRow(j)}{/each}
      </ul>
      {#if judged.length > JUDGED_SHOWN}
        <div class="meta" data-task-judgments-more={judged.length - JUDGED_SHOWN}>
          <InfoNote id="judged-{task.id}" label={t("orch.judgments.title", { n: judged.length })} plain>
            {#snippet summary()}<span>{t("orch.judgments.more", { n: judged.length - JUDGED_SHOWN })}</span>{/snippet}
            {#snippet note()}<ul class="file-list pop-list">{#each judged.slice(JUDGED_SHOWN) as j (j.reviewId)}{@render judgmentRow(j)}{/each}</ul>{/snippet}
          </InfoNote>
        </div>
      {/if}
    </div>
  {/if}
  <!-- 수락 규칙 충족(3b — acceptReadiness · 보고된 Task 만) -->
  {#if ready}
    <div class="readiness" data-task-readiness={ready.ok ? "ok" : ready.delegationOff ? "no-delegation" : "unmet"}>
      {#if ready.ok}
        <span class="chip" data-readiness-ok>{t("orch.readiness.ok")}</span>
      {:else if ready.delegationOff}
        <span class="chip faint" data-readiness-off>{t("orch.readiness.off")}</span>
      {:else}
        {#each ready.rules as r (r.roleName)}
          <span class="chip warn" data-readiness-rule={r.roleName} data-have={r.have} data-need={r.need} data-last={r.last}>{r.text}</span>
        {/each}
      {/if}
    </div>
  {/if}
  {#if rep}
    {@const range = reportDiffRange(rep)}
    <div class="report" data-task-report={task.id} data-report-id={rep.reportId}>
      <div class="report-row">
        <span class="chip" data-report-outcome={rep.outcome}>{keyText(OUTCOME_KEY, rep.outcome, t)}</span>
        <span class="meta mono" data-report-commit={rep.commitOid ?? ""}
          >{rep.commitOid ? t("orch.report.commit", { oid: shortOid(rep.commitOid) }) : t("orch.report.noCommit")}</span>
        <span class="meta">{t("orch.report.files", { n: rep.changedFiles.length })}{rep.changedFilesTruncated ? "+" : ""}</span>
        {#if rep.dirty}
          <span class="chip warn" title={t("orch.report.dirty.title")} data-report-dirty>{t("orch.report.dirty")}</span>
        {/if}
        {#if rep.mismatch}
          <span class="chip warn" title={t("orch.report.mismatch.title")} data-report-mismatch={rep.mismatch}
            >{rep.mismatch === "branch-changed" ? t("orch.report.mismatch.branch-changed") : t("orch.report.mismatch.unexpected-head")}</span>
        {/if}
        {#if rep.noChanges}
          <span class="chip faint" title={t("orch.report.noChanges.title")} data-report-no-changes>{t("orch.report.noChanges")}</span>
        {/if}
        {#each attemptCommits(detail, rep.attemptId) as c (c.commitOid)}
          <span class="chip faint mono" title={`${c.branch} · ${t("orch.commits.files", { n: c.files })}`} data-report-server-commit={c.commitOid}
            >{t("orch.commits.item", { oid: shortOid(c.commitOid), subject: c.subject })}</span>
        {/each}
        {#if drift.has(rep.attemptId)}
          <span class="chip warn" title={t("orch.report.drift.title")} data-report-drift>{t("orch.report.drift")}</span>
        {/if}
        <span class="grow"></span>
        {#if range}
          <button type="button" class="btn btn-sm btn-ghost" title={t("orch.report.fileList.title")} data-report-files={rep.reportId}
            aria-expanded={filesOpen.has(rep.reportId)} onclick={() => toggleFiles(task, rep)}>{t("orch.report.fileList")}</button>
          <button type="button" class="btn btn-sm btn-secondary" title={t("orch.report.diff.title")} data-report-diff={rep.reportId}
            onclick={() => viewDiff(rep)}>{t("orch.report.diff")}</button>
        {/if}
      </div>
      <!-- [파일 목록] — 조정자 get_diff 와 같은 고정 OID 의 목록(패치는 [diff 보기]) -->
      {#if filesOpen.has(rep.reportId)}
        {@const fv = files[rep.reportId]}
        <div class="files" data-report-file-list={rep.reportId}>
          {#if !fv || fv === "loading"}
            <p class="meta">{t("orch.report.fileList.loading")}</p>
          {:else if "error" in fv}
            <p class="meta" role="alert">{fv.error}</p>
          {:else if fv.files.length === 0}
            <p class="meta">{t("orch.report.fileList.empty")}</p>
          {:else}
            <ul class="file-list mono">
              {#each fv.files as f (f.path)}
                <li data-report-file={f.path} data-file-status={f.status}>
                  <span class="file-st" title={f.status}>{fileStatusLetter(f.status)}</span>
                  <span class="file-path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>{f.path}</span>
                  {#if f.oldPath}<span class="meta">{t("orch.report.fileList.renamed", { from: f.oldPath })}</span>{/if}
                  <span class="grow"></span>
                  {#if f.binary}
                    <span class="meta">{t("orch.report.fileList.binary")}</span>
                  {:else if f.adds !== null || f.dels !== null}
                    <span class="file-add">+{f.adds ?? 0}</span><span class="file-del">−{f.dels ?? 0}</span>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if fv.truncated}
              <p class="meta" data-report-files-truncated>{t("orch.report.fileList.truncated", { shown: fv.files.length, total: fv.fileCount })}</p>
            {/if}
          {/if}
        </div>
      {/if}
      <p class="summary" data-report-summary>{rep.summary}</p>
      {#if rep.resolved && rep.resolved.length > 0}
        <div class="notes" data-report-resolved={rep.resolved.length}>
          <p class="meta notes-head">{t("orch.report.resolved", { n: rep.resolved.length })}</p>
          <ul class="file-list mono">
            {#each rep.resolved as r (r.path)}
              <li><span class="file-path">{r.path}</span><span class="grow"></span><span class="meta">{r.how}</span></li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if rep.notes}
        <!-- 보고 메모 — 짧은 글이라 ⓘ 팝오버(판 뿌리의 `NotePopover`) -->
        <div class="notes" data-report-notes>
          <InfoNote id="report-notes-{rep.reportId}" label={t("orch.report.notes")} plain>
            {#snippet summary()}<span class="meta">{t("orch.report.notes")}</span>{/snippet}
            {#snippet note()}<p class="pop-text" data-report-notes-text>{rep!.notes}</p>{/snippet}
          </InfoNote>
        </div>
      {/if}
      {#if rep.gitError}<p class="meta">{t("orch.report.gitError", { msg: rep.gitError })}</p>{/if}
      {#if ra.blocked}<p class="meta blocked" data-review-blocked>{t(ra.blocked)}</p>{/if}
    </div>
  {/if}
  <!-- 검토(통합 설계 5단계) — 보고 커밋의 역할 기반 보조 검토(통합 후보 검토 아님) -->
  {#if rvw || rturn}
    <div class="report" data-task-review={task.id} data-review-state={rvw?.state ?? "none"}>
      {#if rvw}
        <div class="report-row">
          <span class={rvw.state === "pass" ? "chip" : rvw.state === "changes-requested" ? "chip warn" : "chip faint"}
            >{keyText(REVIEW_STATE_KEY, rvw.state, t)}</span>
          {#if rvw.findings.length > 0}<span class="meta">{t("orch.reviewer.findings", { n: rvw.findings.length })}</span>{/if}
          <span class="meta faint-text">{t("orch.reviewer.scope")}</span>
        </div>
      {/if}
      <!-- 3차 2단계 — 헤드리스 검토자의 턴(도는 중 · 끝 · 실패 사유 낱말 · 실효 모델) -->
      {#if rturn}
        <p class={rturn.phase === "failed" ? "meta blocked" : "meta"} data-review-turn={rturn.phase} title={t("orch.reviewer.turn.title")}>
          {keyText(REVIEW_TURN_KEY, rturn.phase, t, { reason: rturn.reason ?? "" })}
          {#if rturn.model}<span class="chip faint mono" data-review-turn-model>{t("orch.reviewer.turn.model", { model: rturn.model })}</span>{/if}
        </p>
      {/if}
      {#if rvw}
        {#if rvw.summary}<p class="summary" data-review-summary>{rvw.summary}</p>{/if}
        {#if rvw.findings.length > 0}
          <ul class="file-list" data-review-findings>
            {#each rvw.findings as f, i (i)}<li>{f}</li>{/each}
          </ul>
        {/if}
        {#if rvw.required && rvw.state === "none" && rvw.budgetLeft === 0}
          <p class="meta blocked" data-review-budget-out>{t("orch.reviewer.budgetOut")}</p>
        {/if}
      {/if}
    </div>
  {/if}
  {#each lates as l (l.reportId)}
    <div class="report late" data-report-late={l.reportId}>
      <div class="report-row">
        <span class="chip faint" title={t("orch.report.late.title")}>{t("orch.report.late")}</span>
        <span class="chip faint">{keyText(OUTCOME_KEY, l.outcome, t)}</span>
        {#if l.commitOid}<span class="meta mono">{t("orch.report.commit", { oid: shortOid(l.commitOid) })}</span>{/if}
      </div>
      <p class="summary">{l.summary}</p>
    </div>
  {/each}
  {#if acc}
    <p class="review-line" data-task-accepted={acc.commitOid}>
      {t("orch.review.accepted", { who: reviewer(acc.reviewer), when: clock(acc.acceptedAt), oid: shortOid(acc.commitOid) })}
    </p>
    <!-- 면제(3b — 사람 수락이 넘은 규칙: Task 보기의 `waived`, 없으면 산출물의 `waived` · 옛 `reviewWaivedBy`) -->
    {@const waivers = waiverTexts(acceptedWaivers(task, acc), t)}
    {#each waivers as w, i (i)}
      <p class="review-line faint" data-task-review-waived data-task-waived={w}>{w}</p>
    {/each}
  {:else if rev && rev.revokedAt}
    <p class="review-line faint" data-task-revoked>
      {t("orch.review.revoked", { who: reviewer(rev.revokedBy ?? "human"), when: clock(rev.revokedAt) })}
    </p>
  {/if}
  {#if task.state === "conflict" && task.conflict}
    <div class="report" data-task-conflict={task.id} data-needs-human={String(task.conflict.needsHuman)}>
      <div class="report-row">
        <span class="chip warn">{conflictSummary(task.conflict, t)}</span>
      </div>
      <p class={task.conflict.needsHuman ? "attention" : "meta"} data-conflict-hint>{t(conflictHintKey(task.conflict))}</p>
      <div class="notes" data-conflict-paths>
        <p class="meta notes-head">{t("orch.conflict.paths")}</p>
        <ul class="file-list mono">
          {#each task.conflict.entries as e, i (i)}
            <li><span class="file-path">{e.paths.join(" · ")}</span><span class="grow"></span><span class="meta">{e.kinds.join(", ")}</span></li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
  {#if lv}
    <div class="report" data-task-verify={task.id} data-verify-outcome={lv.outcome}>
      <div class="report-row">
        <span class={lv.outcome === "pass" ? "chip" : "chip warn"}>{t("orch.verify.last", {
          outcome: keyText(VERIFY_OUTCOME_KEY, lv.outcome, t),
          code: lv.exitCode ?? "—",
          dur: formatDuration(lv.durationMs),
        })}</span>
        <span class="meta">{t(lv.approvedBy === "auto" ? "orch.verify.last.by.auto" : "orch.verify.last.by.human")}</span>
        {#if !lv.hermetic}<span class="chip faint" data-verify-hermetic="false">{t("orch.verify.hermetic.no")}</span>{/if}
        <span class="grow"></span>
        {#if ovr && detail.state !== "orphaned"}
          <button type="button" class="btn btn-sm btn-ghost danger" data-verify-override={task.id} title={t("orch.verify.override.title")}
            disabled={busy} onclick={() => askOverride(task)}>{t("orch.verify.override")}</button>
        {/if}
      </div>
      {#if lv.tail}
        <div class="notes">
          <p class="meta notes-head">{t("orch.verify.tail")}</p>
          <pre class="tail mono" data-verify-tail>{lv.tail}</pre>
        </div>
      {/if}
      {#if ovr && overrideAsk && overrideAsk.taskId === task.id}
        {@const opin = overrideAsk}
        <div class="report-row" data-verify-override-ask={task.id}>
          <p class="attention">{t("orch.verify.override.text", { oid: shortOid(opin.candidate), outcome: keyText(VERIFY_OUTCOME_KEY, ovr.outcome, t), code: ovr.exitCode ?? "—" })}</p>
          <span class="grow"></span>
          <button type="button" class="btn btn-sm btn-ghost" onclick={() => cancelOverride()}>{t("orch.verify.ask.cancel")}</button>
          <button type="button" class="btn btn-sm btn-ghost danger" data-verify-override-confirm={task.id} disabled={busy}
            onclick={() => confirmOverride(opin, task)}
            >{t("orch.verify.override.confirm")}</button>
        </div>
      {/if}
    </div>
  {/if}
  {#if task.state === "reported"}
    {@const aborted = lastAbortedJob(detail, task.id)}
    {#if aborted}<p class="review-line faint" data-task-integration-aborted={aborted}>{integrationAbortText(aborted, t)}</p>{/if}
  {/if}
  {#if needsMergeHint(task, detail)}<p class="review-line faint" data-task-needs-merge>{t("orch.deps.needsMerge")}</p>{/if}
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

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .attention {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  /* 펼친 트랙 안쪽 — 줄 머리 아래에 붙는다(테두리는 줄 카드가 쥔다) */
  .task {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    padding: 0;
    font-size: var(--t-sm);
  }

  /* 보일 것이 없으면(빈 자리 채움만) 칸을 접는다 — 상태 카드 아래에 빈 간격이 남지 않게 */
  .task:not(:has(> :not(.grow))) {
    display: none;
  }

  /* 사람 관문 — 행 맨 위 한 줄 전체(목업 V3TrackSideGate: 후보 · 명령 상자 · 넓은 주 단추 + 빨간 테두리 [반려] · 한 줄 안내) */
  .gate-box {
    flex-basis: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .gate-box p {
    margin: 0;
  }

  .verify-box {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: var(--radius-surface-inner, 12px);
    background: color-mix(in srgb, var(--m3-surface-container-lowest, var(--bg)) 60%, transparent);
    min-width: 0;
  }

  .verify-box .oid {
    color: var(--fg-1);
  }

  .verify-box .cmd {
    font-size: 13px;
    color: var(--fg-1);
    overflow-wrap: anywhere;
    user-select: text;
  }

  .gate-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .gate-main,
  .gate-side,
  .gate-reject {
    font: inherit;
    font-size: 13px;
    border-radius: 999px;
    padding: 9px 14px;
    cursor: pointer;
    white-space: nowrap;
  }

  .gate-main {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 700;
    border: 0;
    color: var(--on-accent, var(--bg));
    background: var(--accent);
  }

  .amber .gate-main {
    color: color-mix(in srgb, var(--warn) 22%, black);
    background: var(--warn);
  }

  .gate-side {
    flex: 0 0 auto;
    border: 1px solid var(--line-strong, var(--line));
    color: var(--fg-1);
    background: transparent;
  }

  .gate-reject {
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--err) 50%, transparent);
    color: var(--err);
    background: transparent;
  }

  .gate-main:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .gate-side:hover:not(:disabled),
  .gate-reject:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .gate-reject:hover:not(:disabled) {
    background: var(--err-soft, var(--surface-hover));
  }

  .gate-main:disabled,
  .gate-side:disabled,
  .gate-reject:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .gate-row.sub {
    gap: var(--space-1);
  }

  .gate-hint {
    font-size: var(--t-xs);
    color: var(--fg-3);
    line-height: 1.5;
  }

  .attention-text {
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
  }

  /* 보고 블록 — Task 행 아래 한 줄 전체(행은 flex wrap) */
  .report,
  .review-line {
    flex-basis: 100%;
    margin: 0;
  }

  .report {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }

  .report.late {
    background: transparent;
    border: 1px dashed var(--line);
  }

  .report-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
  }

  .report .summary {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 7.5em;
    overflow: auto;
    user-select: text;
  }

  .report .notes {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 접지 않는 부가 묶음(판정 이력 · 해결한 파일 · 충돌 경로 · 출력 꼬리) — 작은 머리 한 줄 + 목록 */
  .notes {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex-basis: 100%;
  }

  .notes-head {
    margin: 2px 0 0;
  }

  /* ⓘ 팝오버 안(판 뿌리의 `NotePopover` 가 그린다 — 조각은 이 파일의 범위 이름을 가진다) */
  .pop-text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .pop-list {
    max-height: none;
  }

  .report .blocked {
    color: var(--fg-2);
  }

  .review-line {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .review-line.faint {
    color: var(--fg-3);
  }

  .chip.warn {
    background: var(--warn-soft);
  }

  .chip[data-report-outcome="success"] {
    background: color-mix(in srgb, var(--ok) 18%, transparent);
  }

  .chip[data-report-outcome="failure"],
  .chip[data-report-outcome="blocked"] {
    background: var(--err-soft);
  }

  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* 3b — Task 의 거친 역할 · 수락 규칙 충족 */
  .roles-line,
  .readiness {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .readiness {
    flex-basis: 100%;
    margin-left: var(--space-3);
  }

  .warn-text {
    color: var(--warn, var(--fg-2));
  }

  .chip.warn {
    background: var(--warn-soft);
    color: var(--fg-1);
  }

  /* 통합 설계 1단계 — 보고 파일 목록 */
  .files {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 2px;
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

  .file-st {
    flex: 0 0 auto;
    width: 1.2em;
    color: var(--fg-2);
    font-weight: var(--fw-semibold);
  }

  .file-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-1);
  }

  .file-add {
    color: var(--ok);
  }

  .file-del {
    color: var(--err);
  }

  .faint-text {
    color: var(--fg-3);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tail {
    max-height: 220px;
    overflow: auto;
    margin: var(--space-1) 0 0;
    padding: var(--space-2);
    font-size: var(--t-xs);
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-field);
    border-radius: var(--radius-sm);
  }
</style>
