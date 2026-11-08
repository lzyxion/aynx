<script lang="ts">
  // 트랙 경로 하나 = 목업 `V3Track` 의 가운데 판 + 오른쪽 칸(`V3TrackSide` · `V3TrackSideGate`).
  // 가운데 = 경로 줄(원형 ← · 오른쪽 끝 이웃 트랙 칩) · 아티스트 큰 얼굴 · "TRACK n · 지금 재생 중" · 제목 · 한 줄 부제 · 가사처럼 흐르는 타임라인.
  // 오른쪽(400px · 바탕 없이 카드 넷) = ① 상태(사람 확인이 필요하면 호박 카드 — 관문 · 확인 · 결과 · 판정이 그 안) ② 시도 · 검토
  // ③ 바뀐 파일 ④ 작업 자원 · 맨 아래 [대화 기록 전체] ■ ⋯(트랙 취소 · 다시 열기 메뉴). 서버 동작과 확인 대상 고정은 RunBoard가 계속 소유한다.
  import { untrack, type ComponentProps, type Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { TranscriptItem } from "$lib/context";
  import { currentTrackAttempt, trackAttempts, trackNeighbors, trackPresentation, trackRows, trackStatusIcon, attemptChipText, isReviewer, taskActions,
    trackHumanGate, trackReviewCount, TASK_STATE_KEY, keyText, type AttemptView, type TaskView, type WorkerActivity } from "../model";
  import { artistOf } from "../artists";
  import type { ArtistProfile } from "../artist-form";
  import { orchEscapeAllowed, orchEscapeTargetBlocked } from "../orch-tab";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import StatusIcon from "../StatusIcon.svelte";
  import TrackActions from "./TrackActions.svelte";
  import TrackTimeline from "./TrackTimeline.svelte";
  import ArtistSide from "./ArtistSide.svelte";
  import ArtistCard from "./ArtistCard.svelte";
  import ArtistAvatar from "./ArtistAvatar.svelte";

  type Props = Omit<ComponentProps<typeof TrackActions>, "attention"> & {
    attemptId?: string | null;
    activity: Record<string, WorkerActivity>;
    visible: boolean;
    ensureFiles: (taskId: string, reportId: string) => void;
    /** 판 맨 위 경로 줄(부모가 짓는다 — 오른쪽 끝 단추를 넘겨 받는다) */
    crumb?: Snippet<[Snippet | undefined]>;
    /** 아티스트 목록(이름 · 아이콘) */
    profiles?: readonly ArtistProfile[];
    onback: () => void;
    ontrack: (taskId: string) => void;
    onpick: (attemptId: string) => void;
    onpermissions: () => void;
    onreconcile: () => void;
    stopAttempt: (a: AttemptView) => void;
    removeWorktree: (a: AttemptView) => void;
    viewTranscript: (a: AttemptView) => void;
    viewWipDiff: (a: AttemptView) => void;
  };
  let { task, detail, attemptId, activity, visible, now, busy, titles, files, ensureFiles, crumb, profiles = [], onback, ontrack, onpick,
    onpermissions, onreconcile, stopAttempt, removeWorktree, viewTranscript, viewWipDiff, ...actions }: Props = $props();
  const a = $derived(currentTrackAttempt(detail, task.id, attemptId));
  const attempts = $derived(trackAttempts(detail, task.id));
  const neighbors = $derived(trackNeighbors(detail, task.id));
  const presentation = $derived(trackPresentation(detail, task));
  const ta = $derived(taskActions(task, detail.state));
  const rows = $derived(trackRows(detail, now));
  const row = $derived(rows.find((row) => row.task.id === task.id));
  const judge = $derived(!!a && (isReviewer(a) || a.kind === "judge"));
  const report = $derived(a ? judge
    ? detail.reports?.find((r) => r.reportId === a.reviewOf?.reportId) ?? null
    : detail.reports?.find((r) => r.attemptId === a.id && !r.late) ?? detail.reports?.find((r) => r.attemptId === a.id) ?? null : null);
  /** 이 시도의 판정 — 지금 보고의 판정(`reviewState`)은 관문 칸의 검토 블록이 이미 보인다(같은 말 두 번 없음 — 실기 10-31) */
  const shownReview = $derived(detail.reviewState?.[task.id]?.reviewId ?? null);
  const judgments = $derived(detail.reviewReports?.filter((r) => r.attemptId === a?.id && r.reviewId !== shownReview) ?? []);
  /** 시도 → 아티스트 프로필 · 이름(지운 아티스트면 띄울 때의 이름 사본) */
  const profileOf = (x: AttemptView | null | undefined) => (x?.roleId ? profiles.find((p) => p.id === x.roleId) ?? null : null);
  const nameOf = (x: AttemptView) => profileOf(x)?.name || x.roleName?.trim() || artistOf(x.cli).name;
  /** 상태 카드 머리 — 줄의 짧은 상태 낱말("작업 중 · 턴 1" → 굵은 앞 · 회색 뒤) */
  const statusText = $derived(row?.statusKey ? t(row.statusKey, { n: row.turnNo }) : keyText(TASK_STATE_KEY, task.state, t));
  const statusMain = $derived(statusText.split(" · ")[0]);
  const statusRest = $derived(statusText.split(" · ").slice(1).join(" · "));
  /** 사람 확인이 필요하다 — 첫 카드가 호박 카드(목업 V3TrackSideGate) */
  const gate = $derived(trackHumanGate(detail, task, row?.need ?? null));
  const reviews = $derived(trackReviewCount(detail, task));
  /** 이웃 트랙 칩의 얼굴 — 그 트랙의 쓴 아티스트 */
  const neighborFace = (taskId: string) => rows.find((r) => r.task.id === taskId)?.writer ?? null;
  let items = $state<TranscriptItem[]>([]);
  let confirmWt = $state<string | null>(null);
  $effect(() => { void a?.id; confirmWt = null; });
  let root = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const el = root;
    if (!el) return;
    untrack(() => {
      const cur = document.activeElement;
      if (!cur || cur === document.body || el.closest("[data-run-board]")?.contains(cur) || cur.closest("[data-orch-bar]")) el.focus({ preventScroll: true });
    });
  });
  function onkey(e: KeyboardEvent): void {
    if (!orchEscapeAllowed(e, orchEscapeTargetBlocked(e.target))) return;
    e.preventDefault();
    e.stopPropagation();
    onback();
  }

  // ⋯ 메뉴 — 트랙 취소 · 다시 열기(트랙 자체의 조작이라 관문 자리에 혼자 뜨지 않게 맨 아래 메뉴로). 실행은 메뉴 통로(스냅샷 → 닫기 → 실행)
  let moreEl = $state<HTMLButtonElement | null>(null);
  let menuOpen = $state(false);
  const hasMore = $derived(ta.cancel || ta.reopen);
  const menuRows = $derived<ToolbarMenuRow[]>([
    ...(ta.reopen ? [{ key: "reopen", icon: "undo", label: t("orch.player.task.reopen"), disabled: busy }] : []),
    ...(ta.cancel ? [{ key: "cancel", icon: "close", label: t("orch.player.task.cancel"), danger: true, disabled: busy }] : []),
  ]);
  $effect(() => { if (!hasMore) menuOpen = false; });
  function closeMenu(back: boolean): void {
    menuOpen = false;
    if (back) moreEl?.focus();
  }
  function pickMenu(key: string): void {
    const to = key === "cancel" ? "cancelled" : key === "reopen" ? "todo" : null;
    runOnMenu((): { task: TaskView; to: "cancelled" | "todo" } | null => (to ? { task, to } : null), () => closeMenu(false), (x) => actions.setTask(x.task, x.to));
  }
</script>

<!-- 경로 줄 오른쪽 끝 — 이전 · 다음 트랙 칩(얼굴 + 번호) -->
{#snippet neighborChips()}
  {#if neighbors.prev}{@const w = neighborFace(neighbors.prev.task.id)}<button type="button" class="chip" data-track-prev={neighbors.prev.task.id} title={neighbors.prev.task.title}
      onclick={() => ontrack(neighbors.prev!.task.id)}>{#if w}<ArtistAvatar cli={w.cli} profile={profileOf(w)} size={20} />{/if}‹ #{neighbors.prev.no}</button>{/if}
  {#if neighbors.next}{@const w = neighborFace(neighbors.next.task.id)}<button type="button" class="chip" data-track-next={neighbors.next.task.id} title={neighbors.next.task.title}
      onclick={() => ontrack(neighbors.next!.task.id)}>{#if w}<ArtistAvatar cli={w.cli} profile={profileOf(w)} size={20} />{/if}#{neighbors.next.no} ›</button>{/if}
{/snippet}

<!-- ① 상태 카드 머리 — 평소: 상태 그림 · "작업 중" · "· 턴 1" · [사람 할 일 없음] / 사람 확인: 경고 · "사람 확인 필요" · "· 보고됨 · 검토 1 / 1" -->
{#snippet head()}
  <div class="state" data-track-player-state={task.state} title={t(presentation.key)}>
    {#if gate}
      <StatusIcon icon="attention" size={15} />
      <strong class="gate-title">{t("orch.player.side.human")}</strong>
      <span class="state-note">· {statusText}{reviews ? ` · ${t("orch.artist.stat.reviews")} ${reviews.have}/${reviews.need}` : ""}</span>
    {:else}
      {#if row}<StatusIcon icon={trackStatusIcon(row)} size={14} />{/if}
      <strong>{statusMain}</strong>{#if statusRest}<span class="state-note">· {statusRest}</span>{/if}
      <span class="grow"></span>
      <span class="state-chip">{t("orch.player.side.noHuman")}</span>
    {/if}
  </div>
{/snippet}

<!-- ② 시도 · 검토 카드 — 누르면 가운데 타임라인이 그 시도로 -->
{#snippet attemptCards()}
  <section class="card attempts" data-track-card="attempts" data-track-attempts>
    <h3>{t("orch.player.attempts")}{#if attempts.length > 1}<span class="hint"> · {t("orch.player.attempts.hint")}</span>{/if}</h3>
    {#each attempts as attempt, i (attempt.id)}
      {@const isJudge = attempt.kind === "judge" || isReviewer(attempt)}
      {@const selected = a?.id === attempt.id}
      <button type="button" class="attempt" class:selected class:judge={isJudge} data-track-attempt={attempt.id} aria-pressed={selected} onclick={() => onpick(attempt.id)}>
        <ArtistAvatar cli={attempt.cli} profile={profileOf(attempt)} size={30} dim={!selected && !isJudge && attempt.state !== "running"} />
        <span class="attempt-text">
          <strong>{nameOf(attempt)}{isJudge ? "" : ` · ${t("orch.player.attempt", { n: attempts.length - i })}`}</strong>
          <span>{attemptChipText(attempt, detail.state, t)}</span>
        </span>
        {#if selected}<span class="viewing">{t("orch.player.viewing")}</span>{/if}
      </button>
    {:else}<p class="hint">{t("orch.player.noAttempts")}</p>{/each}
  </section>
{/snippet}

<!-- 상태 카드 안 — 사람 관문 · 확인 · 결과 · 판정 · 조정 -->
{#snippet gates()}
  <TrackActions {task} {detail} {titles} {busy} {now} {files} {...actions} taskState={false} attention={gate} />
  {#each judgments as judgment (judgment.reviewId)}
    <section class="judgment" data-track-judgment={judgment.reviewId}>
      <h3>{t("orch.player.judgment")}</h3>
      <p class="judgment-line"><strong>{t(judgment.verdict === "pass" ? "orch.verdict.pass" : "orch.verdict.changes-requested")}</strong> · <span>{t(judgment.state === "current" ? "orch.player.judgment.current" : judgment.state === "late" ? "orch.player.judgment.late" : "orch.player.judgment.stale")}</span></p>
      <p class="judgment-summary">{judgment.summary}</p>
      <ul>{#each judgment.findings as finding, i (i)}<li>{finding}</li>{/each}</ul>
    </section>
  {/each}
  {#if task.state === "conflict"}<button type="button" class="btn btn-sm btn-secondary reconcile" data-track-reconcile disabled={busy} onclick={onreconcile}>{t("orch.hold.reconcile")}</button>{/if}
{/snippet}

<!-- 작업 자원 카드의 [시도 정보] 탭 — 옛 아티스트 칸(선택 시도의 실행 세부 정보) -->
{#snippet technical()}
  {#if a}
    <div class="technical" data-track-technical>
      <ArtistCard {a} {detail} {activity} {now} {titles} {busy} bind:confirmWt {stopAttempt} removeWorktree={(attempt) => { confirmWt = null; removeWorktree(attempt); }} editDelegation={onpermissions} openDetail={onpick} />
    </div>
  {/if}
{/snippet}

<!-- 맨 아래 줄 끝 ⋯ — 트랙 취소 · 다시 열기 -->
{#snippet more()}
  {#if hasMore}
    <button type="button" class="more" data-track-more aria-haspopup="menu" aria-expanded={menuOpen} aria-label={t("orch.player.more")} title={t("orch.player.more")}
      bind:this={moreEl} onclick={() => (menuOpen = !menuOpen)}><UiIcon name="more" size={16} /></button>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<div class="player" data-track-player={task.id} tabindex="-1" bind:this={root} onkeydown={onkey}>
  <!-- 경로 줄은 두 판 위 한 줄(앨범 화면과 같은 자리 — 줄이 이 칸의 여백을 걷어 판 가장자리 기준 (24, 14)) -->
  {#if crumb}<div class="crumb">{@render crumb(neighborChips)}</div>{/if}
  <section class="center">
    {#if a}
      {#key a.id}
        <TrackTimeline {a} {detail} {activity} {now} {visible} {titles} {ensureFiles} stateKey={presentation.key} trackNo={row?.no ?? 0}
          profile={profileOf(a)} attemptNo={attempts.length - attempts.findIndex((x) => x.id === a!.id)} bind:items />
      {/key}
    {:else}
      <div class="waiting" data-track-empty>
        <span class="kicker">{t("orch.player.kicker", { no: row?.no ?? 0, state: t(presentation.key).split(" · ")[0] })}</span>
        <h2>{task.title}</h2><p>{t(presentation.key)}</p><p class="goal">{task.goal}</p>
      </div>
    {/if}
  </section>
  <aside class="side" data-track-side>
    {#if a}
      {#key a.id}
        <ArtistSide {a} {detail} {now} {busy} {items} {judge} {report} {gate} {reviews} wip={activity[a.id]?.wip} reportFiles={report ? files[report.reportId] : undefined}
          {head} {gates} attempts={attemptCards} {technical} {more}
          onTranscript={() => viewTranscript(a!)} onStop={() => stopAttempt(a!)} onDiff={() => report ? actions.viewDiff(report) : viewWipDiff(a!)} onPermissions={onpermissions} />
      {/key}
    {:else}
      <!-- 시도가 아직 없는 트랙 — 상태 카드(관문) · 시도 카드 · ⋯ 만 -->
      <section class="card status" class:gate data-track-card="status" data-human-gate={gate ? "true" : "false"}>{@render head()}{@render gates()}</section>
      {@render attemptCards()}
      <div class="foot">{@render more()}</div>
    {/if}
  </aside>
</div>

{#if menuOpen && moreEl}
  <ToolbarMenu label={t("orch.player.more")} rows={menuRows} trigger={moreEl} align="right" onpick={pickMenu} onclose={closeMenu} />
{/if}

<style>
  /* 세 칸 중 둘(왼쪽 프로듀서 채팅은 탭의 다른 잎) — 가운데 판 · 오른쪽 칸(400px) */
  .player { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 400px; grid-template-rows: minmax(0, 1fr); gap: 12px; padding: 12px; outline: none; }
  .player:has(> .crumb) { grid-template-rows: auto minmax(0, 1fr); }
  .center { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 14px 28px 0; border-radius: var(--radius-lg, 16px);
    background: color-mix(in srgb, var(--accent) 5%, var(--m3-surface-container, var(--bg-panel))); }
  /* 경로 줄 — 두 판 위 전체 폭 한 줄(줄 아래 간격은 격자의 12px) */
  .crumb { grid-column: 1 / -1; min-width: 0; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: var(--t-xs); border: 0; border-radius: 999px; padding: 3px 11px 3px 4px; color: var(--fg-2);
    background: var(--control-bg, var(--surface-hover)); cursor: pointer; white-space: nowrap; }
  .chip:hover { color: var(--fg-1); background: var(--control-bg-hover, var(--surface-hover)); }
  /* 오른쪽 칸 — 바탕 없이 카드 넷(카드 사이 10) · 넘치면 칸이 굴러간다 */
  .side { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; font-size: var(--t-sm); box-sizing: border-box; }
  /* 카드 — `ArtistSide` 의 카드와 같은 모양(시도 카드 · 시도 없는 트랙의 상태 카드가 이 파일의 조각이라 여기에도 둔다) */
  .card { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 14px 16px; border-radius: var(--radius-surface, 16px);
    background: var(--m3-surface-container-low, var(--bg-panel)); box-sizing: border-box; }
  .card.status { gap: 10px; }
  .card.gate { background: color-mix(in srgb, var(--warn) 12%, var(--m3-surface-container-low, var(--bg-panel)));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 50%, transparent); }
  .state { display: flex; align-items: center; gap: 8px; font-size: var(--t-sm); min-width: 0; }
  .state strong { font-size: 14px; white-space: nowrap; }
  .state .gate-title { color: color-mix(in srgb, var(--warn) 55%, var(--fg-1)); }
  .state-note { font-size: var(--t-xs); color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .grow { flex: 1; }
  .state-chip { flex: 0 0 auto; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; color: var(--fg-3); background: var(--m3-surface-container-high, var(--surface-hover)); white-space: nowrap; }
  h3 { margin: 0; font-size: 13px; font-weight: 700; }
  h3 .hint { font-weight: 400; }
  .attempt { text-align: left; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border: 0; border-radius: var(--radius-surface-inner, 12px); color: var(--fg-2);
    background: var(--m3-surface-container, var(--surface-hover)); cursor: pointer; font: inherit; }
  .attempt:hover { background: var(--m3-surface-container-high, var(--surface-hover)); }
  .attempt.selected { background: color-mix(in srgb, var(--accent) 12%, var(--m3-surface-container, transparent)); box-shadow: inset 0 0 0 2px var(--accent); color: var(--fg-1); }
  .attempt.judge > :global(.avatar) { box-shadow: 0 0 0 2px var(--tertiary, var(--accent)); }
  .attempt-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .attempt-text strong { color: var(--fg-1); font-size: var(--t-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .attempt-text span, .hint, .technical { font-size: var(--t-xs); }
  .attempt-text span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .viewing { flex: 0 0 auto; font-size: 11px; color: var(--accent); white-space: nowrap; }
  .hint { margin: 0; color: var(--fg-3); }
  .technical { color: var(--fg-3); overflow-wrap: anywhere; }
  .foot { display: flex; justify-content: flex-end; margin-top: auto; }
  .more { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; cursor: pointer;
    color: var(--fg-2); background: color-mix(in srgb, var(--accent) 8%, var(--m3-surface-container-high, var(--surface-hover))); }
  .more:hover, .more[aria-expanded="true"] { color: var(--fg-1); background: color-mix(in srgb, var(--accent) 12%, var(--m3-surface-container-highest, var(--surface-hover))); }
  .judgment { display: flex; flex-direction: column; gap: 4px; font-size: var(--t-xs); overflow-wrap: anywhere; }
  .judgment p, .judgment ul { margin: 0; }
  .judgment-line { color: var(--fg-2); }
  .judgment-line strong { color: var(--fg-1); }
  .judgment-summary { white-space: pre-wrap; line-height: 1.5; }
  .reconcile { align-self: flex-start; }
  .waiting { flex: 1; min-height: 0; overflow: auto; padding: 18px 0; display: flex; flex-direction: column; gap: 6px; }
  .waiting .kicker { color: var(--accent); font-size: var(--t-xs); font-weight: 700; letter-spacing: 1px; }
  .waiting h2 { margin: 0; font-size: 26px; font-weight: 900; }
  .waiting p { margin: 0; color: var(--fg-2); }
  .waiting .goal { color: var(--fg-3); font-size: var(--t-sm); white-space: pre-wrap; }
  @container (max-width: 800px) {
    .player { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(360px, 1fr) auto; overflow: auto; }
    .player:has(> .crumb) { grid-template-rows: auto minmax(360px, 1fr) auto; }
    .center { padding: 14px 16px 0; }
    .side { overflow: visible; }
  }
</style>
