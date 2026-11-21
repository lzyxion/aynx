<script lang="ts">
  import AiNote from "$lib/AiNote.svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { tick, untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { listen, type UnlistenFn } from "../ipc";
  import {
    hiddenRuns,
    hideRuns,
    historyClearedAt,
    historyFilter,
    historyJustCleared,
    historyPeriod,
    historyRequestPending,
    setHistoryFilter,
    setHistoryPeriod,
    takeHistoryRequest,
  } from "$lib/app/run-history.svelte.js";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { auditRuns, type AuditRun, type OperationStateEvent } from "$lib/operations";
  import { EXIT_WINDOW_MS, exitingWithin, makeEmptyIn, makeRowExit } from "$lib/row-exit";
  import type { ExitSide } from "$lib/dock-alert-exit";
  import { formatDuration } from "$lib/finish-notify";
  import { isFinishedRun, runDurationMs, type LabelOf } from "$lib/operation-notify";
  import {
    excerptBlocks,
    filterRuns,
    groupByDay,
    hostOptions,
    hostsLine,
    isAuto,
    OPEN_DAYS,
    PERIODS,
    periodSince,
    ratioPercents,
    runKind,
    runMarkdown,
    runName,
    runOutcome,
    runResults,
    runTargetNames,
    summarize,
    toTargetState,
    type ApprovalFilter,
    type DayGroup,
    type Period,
    type ResultFilter,
    type RunKind,
  } from "$lib/run-history";
  import { settings } from "$lib/settings.svelte.js";
  import { writeClipboard } from "$lib/clipboard";
  import { showNotice } from "$lib/app/notice";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  // 작업안 칸 › 기록 — 감사 로그(`audit_runs`)를 사람이 읽는 장부로.
  // 모양은 한 줄 목록 + 그 자리 펼침 하나다 — 두 칸(목록 | 상세)은 좁은 독에서 목록이 잘려 걷었다.

  interface Props {
    /** 감사 스냅샷에 대상 이름이 없을 때만 쓴다 */
    live: LabelOf;
    count?: number;
    /** 걸려 있으면 바닥 줄은 보이는 기록만 지운다 */
    filtered?: boolean;
    shownIds?: string[];
    exitSide?: ExitSide;
  }

  let {
    live,
    count = $bindable(0),
    filtered = $bindable(false),
    shownIds = $bindable([]),
    exitSide = "right",
  }: Props = $props();

  let runs = $state<AuditRun[]>([]);
  let status = $state<"loading" | "ready" | "error">("loading");
  let selectedId = $state<string | null>(null);
  /** 사람이 접었다 — 그동안은 가장 최근 실행을 저절로 펴지 않는다 */
  let closedByUser = $state(false);
  let wanted = $state<string | null>(null);
  /** 기본 펼침(`OPEN_DAYS`)에서 뒤집은 날 */
  const toggledDays = new SvelteSet<string>();

  let listEl = $state<HTMLElement | null>(null);

  const period = $derived(historyPeriod());
  const filter = $derived(historyFilter());

  /** 읽기 순번 — 늦게 도착한 옛 응답이 새 기간의 목록을 덮지 않게 */
  let seq = 0;

  async function load(days: Period): Promise<void> {
    const my = ++seq;
    if (runs.length === 0) status = "loading";
    const got = await auditRuns(periodSince(days, new Date()), 5000);
    if (my !== seq) return;
    if (got === null) {
      status = "error";
      return;
    }
    runs = got;
    status = "ready";
  }

  // 읽는 몸은 `untrack` — `runs` 가 이 효과의 의존성이 되면 목록이 올 때마다 다시 읽는다.
  $effect(() => {
    const p = period;
    untrack(() => void load(p));
  });

  $effect(() => {
    let off: UnlistenFn | null = null;
    let dead = false;
    void listen<OperationStateEvent>("operation-state", (ev) => {
      if (isFinishedRun(ev.payload.state)) setTimeout(() => void load(historyPeriod()), 300);
    })
      .then((fn) => (dead ? fn() : (off = fn)))
      .catch(() => {});
    return () => {
      dead = true;
      off?.();
    };
  });

  $effect(() => {
    if (historyRequestPending() === null) return;
    const id = takeHistoryRequest();
    if (id === null) return;
    wanted = id;
    setHistoryFilter({ host: null, result: "all", approval: "all", query: "" });
  });

  $effect(() => {
    const id = wanted;
    if (id === null || status !== "ready") return;
    const hit = kept.find((r) => r.operationId === id);
    if (hit) {
      wanted = null;
      void selectAndReveal(hit);
      return;
    }
    if (period !== 90) {
      setHistoryPeriod(90);
      return;
    }
    wanted = null;
  });

  /** 화면에서 지운 것을 뺀 실행 — 감사 파일은 그대로다 */
  const kept = $derived.by(() => {
    const cut = historyClearedAt();
    const gone = hiddenRuns();
    return cut > 0 || gone.size > 0 ? runs.filter((r) => r.approvedAt > cut && !gone.has(r.operationId)) : runs;
  });

  const justCleared = () => historyJustCleared(EXIT_WINDOW_MS);
  /** 줄이 날짜 카드마다 흩어져 있어 나가는 차례는 `.days` 안의 `[data-exit-row]` 로 매긴다 */
  const EXIT_ROWS = "[data-exit-row]";
  const rowExit = makeRowExit(
    () => exitSide,
    justCleared,
    (node) => exitingWithin(node.closest(".days"), EXIT_ROWS),
  );
  // 목록 상자는 빈 상태로 바뀌는 순간 `bind:this` 가 비울 수 있다 — 나가는 중인 그 상자를 따로 쥐어 빈 문구가 마지막 줄 뒤에 들어오게 한다.
  let lastListEl: HTMLElement | null = null;
  $effect(() => {
    if (listEl) lastListEl = listEl;
  });
  const emptyIn = makeEmptyIn(() => exitingWithin(listEl ?? lastListEl, EXIT_ROWS), justCleared);

  const shown = $derived(filterRuns(kept, filter, live));
  $effect(() => {
    count = shown.length;
    filtered = filter.host !== null || filter.result !== "all" || filter.approval !== "all" || filter.query.trim() !== "";
    shownIds = shown.map((r) => r.operationId);
  });
  const groups = $derived(groupByDay(shown, new Date()));
  const summary = $derived(summarize(shown));
  const ratio = $derived(ratioPercents(summary));
  const hosts = $derived(hostOptions(kept, live));

  function dayOpen(g: DayGroup, index: number): boolean {
    return (index < OPEN_DAYS) !== toggledDays.has(g.key);
  }

  function toggleDay(key: string): void {
    if (toggledDays.has(key)) toggledDays.delete(key);
    else toggledDays.add(key);
  }

  const visibleRuns = $derived.by<AuditRun[]>(() =>
    groups.flatMap((g, i) => (dayOpen(g, i) ? g.runs : [])),
  );

  $effect(() => {
    if (status !== "ready" || wanted !== null) return;
    if (selectedId !== null && shown.some((r) => r.operationId === selectedId)) return;
    if (selectedId === null && closedByUser) return;
    selectedId = visibleRuns[0]?.operationId ?? null;
  });

  async function toggleRow(id: string): Promise<void> {
    if (selectedId === id) {
      selectedId = null;
      closedByUser = true;
      return;
    }
    selectedId = id;
    closedByUser = false;
    await tick();
    listEl?.querySelector(`[data-run-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  }

  const selected = $derived(runs.find((r) => r.operationId === selectedId) ?? null);

  async function selectAndReveal(run: AuditRun): Promise<void> {
    selectedId = run.operationId;
    closedByUser = false;
    const idx = groups.findIndex((g) => g.runs.some((r) => r.operationId === run.operationId));
    if (idx >= 0 && !dayOpen(groups[idx], idx)) toggleDay(groups[idx].key);
    await tick();
    focusRow(run.operationId);
  }

  function focusRow(id: string): void {
    const el = listEl?.querySelector(`[data-run-id="${CSS.escape(id)}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
      el.focus({ preventScroll: true });
    }
  }

  function onListKey(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" && ev.key !== "Home" && ev.key !== "End") return;
    const list = visibleRuns;
    if (list.length === 0) return;
    ev.preventDefault();
    const at = list.findIndex((r) => r.operationId === selectedId);
    let next: number;
    if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = list.length - 1;
    else if (at < 0) next = 0;
    else next = Math.max(0, Math.min(list.length - 1, at + (ev.key === "ArrowDown" ? 1 : -1)));
    selectedId = list[next].operationId;
    closedByUser = false;
    focusRow(selectedId);
  }

  // ── 글자 ─────────────────────────────────────────────────────────────────

  const loc = $derived(locale());

  function timeOf(at: number): string {
    return new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));
  }

  function dateOf(d: Date): string {
    return new Intl.DateTimeFormat(loc, { month: "long", day: "numeric", weekday: "short" }).format(d);
  }

  function dateTimeOf(at: number): string {
    return new Intl.DateTimeFormat(loc, {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(at));
  }

  function dayLabel(g: DayGroup): string {
    const date = dateOf(g.date);
    if (g.relative === "today") return t("board.history.day.today", { date });
    if (g.relative === "yesterday") return t("board.history.day.yesterday", { date });
    return date;
  }

  const MARK: Record<RunKind, string> = { ok: "✓", bad: "!", cancelled: "■", open: "·" };

  const RESULT_OPTIONS: readonly { id: ResultFilter; key: Key }[] = [
    { id: "all", key: "board.history.filter.all" },
    { id: "ok", key: "board.history.result.ok" },
    { id: "bad", key: "board.history.result.bad" },
    { id: "cancelled", key: "board.history.result.cancelled" },
  ];

  const APPROVAL_OPTIONS: readonly { id: ApprovalFilter; key: Key }[] = [
    { id: "all", key: "board.history.filter.all" },
    { id: "manual", key: "board.history.approval.manual" },
    { id: "auto", key: "board.history.approval.auto" },
  ];

  const TARGET_LABEL: Record<string, Key> = {
    pending: "board.target.pending",
    running: "board.target.running",
    succeeded: "board.target.succeeded",
    failed: "board.target.failed",
    timedOut: "board.target.timedOut",
    cancelled: "board.target.cancelled",
    unknown: "board.target.unknown",
  };

  function stateKind(s: string): "ok" | "bad" | "dim" {
    const st = toTargetState(s);
    if (st === "succeeded") return "ok";
    if (st === "failed" || st === "timedOut" || st === "unknown") return "bad";
    return "dim";
  }

  interface TargetLine {
    id: string;
    name: string;
    canary: boolean;
    state: string;
    exit: number | null;
    duration: string | null;
  }

  const detail = $derived.by(() => {
    const run = selected;
    if (!run) return null;
    const names = runTargetNames(run, live);
    const res = runResults(run);
    const lines: TargetLine[] = run.targets.map((id, i) => {
      const r = res[id];
      const ms = r && r.startedAt != null && r.endedAt != null ? r.endedAt - r.startedAt : null;
      return {
        id,
        name: names[i],
        canary: i === 0 && run.targets.length > 1,
        state: r?.state ?? "unknown",
        exit: r?.exitCode ?? null,
        duration: ms !== null && ms >= 0 ? formatDuration(ms, t) : null,
      };
    });
    // 실패 줄이 먼저 — 정렬은 안정이라 나머지는 실행 순서(첫째가 canary) 그대로다.
    lines.sort((a, b) => Number(stateKind(b.state) === "bad") - Number(stateKind(a.state) === "bad"));
    const total = runDurationMs(res);
    return {
      run,
      outcome: runOutcome(run, live, t),
      lines,
      duration: total === null ? null : formatDuration(total, t),
      excerpts: excerptBlocks(run, live),
      hasResults: run.results.length > 0,
    };
  });

  function openExcerptSetting(): void {
    openSettingsAt("automation", "audit-output-excerpt");
  }

  // ── [복사] ──

  let copiedId = $state<string | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  const COPIED_MS = 1500;

  $effect(() => () => {
    if (copiedTimer !== null) clearTimeout(copiedTimer);
  });

  async function copyRun(d: NonNullable<typeof detail>): Promise<void> {
    const nm = runName(d.run);
    const ok = d.lines.filter((l) => toTargetState(l.state) === "succeeded").length;
    const result = d.outcome ? d.outcome.result : t("board.history.open");
    const text = runMarkdown(
      {
        title: nm.title ?? nm.command,
        result: d.lines.length > 0 ? `${result} (${ok}/${d.lines.length})` : result,
        at: d.run.approvedAt,
        summary: d.run.summary ?? null,
        command: d.run.command,
        rows: d.lines.map((l) => ({
          name: l.name,
          state: t(TARGET_LABEL[l.state] ?? "board.target.unknown"),
          exit: l.exit,
        })),
        excerpts: d.excerpts,
      },
      t,
    );
    if (!(await writeClipboard(text))) {
      showNotice(t("board.history.copy.failed"));
      return;
    }
    copiedId = d.run.operationId;
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedId = null;
      copiedTimer = null;
    }, COPIED_MS);
  }
</script>

<div class="history" data-run-history>
  <label class="search">
    <UiIcon name="search" size={14} />
    <input
      type="search"
      data-filter="query"
      placeholder={t("board.history.search")}
      aria-label={t("board.history.search")}
      autocomplete="off"
      spellcheck="false"
      value={filter.query}
      oninput={(e) => setHistoryFilter({ query: e.currentTarget.value })}
    />
  </label>

  <!-- 기간은 가져오는 범위라 늘 걸려 있다(`set`) — 나머지 거르기는 가져온 것 위에서 한다 -->
  <div class="filters" role="group" aria-label={t("board.history.filters.aria")}>
    <span class="f set" data-filter="period"
      ><Dropdown
        value={String(period)}
        prefix={t("board.history.filter.period")}
        align="start"
        ariaLabel={t("board.history.filter.period")}
        options={PERIODS.map((p) => ({ value: String(p), label: t("board.history.period.days", { n: p }) }))}
        onchange={(v) => setHistoryPeriod(Number(v) as Period)}
      /></span
    >
    <span class="f" class:set={filter.host !== null} data-filter="host"
      ><Dropdown
        value={filter.host ?? ""}
        prefix={t("board.history.filter.host")}
        align="start"
        ariaLabel={t("board.history.filter.host")}
        options={[{ value: "", label: t("board.history.filter.all") }, ...hosts.map((h) => ({ value: h, label: h }))]}
        onchange={(v) => setHistoryFilter({ host: v || null })}
      /></span
    >
    <span class="f" class:set={filter.result !== "all"} data-filter="result"
      ><Dropdown
        value={filter.result as string}
        prefix={t("board.history.filter.result")}
        align="start"
        ariaLabel={t("board.history.filter.result")}
        options={RESULT_OPTIONS.map((o) => ({ value: o.id as string, label: t(o.key) }))}
        onchange={(v) => setHistoryFilter({ result: v as ResultFilter })}
      /></span
    >
    <span class="f" class:set={filter.approval !== "all"} data-filter="approval"
      ><Dropdown
        value={filter.approval as string}
        prefix={t("board.history.filter.approval")}
        align="start"
        ariaLabel={t("board.history.filter.approval")}
        options={APPROVAL_OPTIONS.map((o) => ({ value: o.id as string, label: t(o.key) }))}
        onchange={(v) => setHistoryFilter({ approval: v as ApprovalFilter })}
      /></span
    >
  </div>

  {#if status === "loading" && runs.length === 0}
    <p class="empty" data-history-state="loading">{t("board.history.loading")}</p>
  {:else if status === "error"}
    <p class="empty" data-history-state="error">
      {t("board.history.error")}
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => void load(period)}
        >{t("board.history.retry")}</button
      >
    </p>
  {:else}
    <div class="summary" data-history-summary>
      <div class="stat">
        <span class="k">{t("board.history.sum.runs")}</span>
        <span class="v" data-stat="runs">{summary.runs}<small>{t("board.history.unit.runs")}</small></span>
      </div>
      <div class="stat">
        <span class="k">{t("board.history.sum.failed")}</span>
        <span class="v" class:bad={summary.withFailure > 0} data-stat="failed"
          >{summary.withFailure}<small>{t("board.history.unit.runs")}</small></span
        >
      </div>
      <div class="stat">
        <span class="k">{t("board.history.sum.targets")}</span>
        <span class="v" data-stat="targets"
          >{summary.targetRuns}<small>{t("board.history.unit.times")}</small></span
        >
      </div>
      <div class="ratio">
        <span class="k"
          ><span>{t("board.history.sum.approval")}</span><span data-stat="ratio"
            >{t("board.history.sum.ratio", { manual: summary.manual, auto: summary.auto })}</span
          ></span
        >
        <div class="bar" aria-hidden="true">
          <span class="man" style:flex-basis="{ratio.manual}%"></span>
          <span class="auto" style:flex-basis="{ratio.auto}%"></span>
        </div>
      </div>
    </div>

    {#if kept.length === 0}
      <p class="empty" data-history-state="empty" in:emptyIn>{t("board.history.empty", { n: period })}</p>
    {:else if shown.length === 0}
      <p class="empty" data-history-state="filtered">{t("board.history.empty.filtered")}</p>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="days" role="list" aria-label={t("board.history.list.aria")} bind:this={listEl} onkeydown={onListKey}>
        {#each groups as g, gi (g.key)}
          {@const isOpen = dayOpen(g, gi)}
          <div class="daygroup" role="listitem">
            <button
              type="button"
              class="day"
              data-exit-row
              out:rowExit|global
              data-day={g.key}
              aria-expanded={isOpen}
              onclick={() => toggleDay(g.key)}
              >{dayLabel(g)}{#if !isOpen}<span class="more"
                  >{` · ${t("board.history.day.more", { n: g.runs.length })} ▾`}</span
                >{/if}</button
            >
            {#if isOpen}
              <div class="list">
                {#each g.runs as run (run.operationId)}
                  {@const kind = runKind(run)}
                  {@const o = runOutcome(run, live, t)}
                  {@const names = runTargetNames(run, live)}
                  {@const nm = runName(run)}
                  {@const open = selectedId === run.operationId}
                  <div class="entry" class:open data-exit-row out:rowExit|global>
                    <div class="irow">
                    <button
                      type="button"
                      class="item"
                      class:sel={open}
                      aria-expanded={open}
                      aria-controls={open ? `run-detail-${run.operationId}` : undefined}
                      aria-current={open ? "true" : undefined}
                      data-run-id={run.operationId}
                      onclick={() => void toggleRow(run.operationId)}
                    >
                      <span class="time">{timeOf(run.approvedAt)}</span>
                      <span class="mark {kind}" aria-hidden="true">{MARK[kind]}</span>
                      <span class="what">
                        {#if nm.title !== null}
                          <span class="h" title={nm.command}>{nm.title}</span>
                        {:else}
                          <span class="c solo">{nm.command}</span>
                        {/if}
                        <span class="line2">
                          <span class="hosts" title={names.join(", ")}>{hostsLine(names, t)}</span>
                          {#if isAuto(run) && run.approveAll}
                            <span class="how auto all" title={t("app.opnotify.all.title")}>{t("app.opnotify.all")}</span>
                          {:else if isAuto(run)}
                            <span class="how auto" title={t("app.opnotify.auto.title")}
                              >{t("board.history.approval.auto")}</span
                            >
                          {:else}
                            <span class="how">{t("board.history.approval.manual")}</span>
                          {/if}
                        </span>
                      </span>
                      <span class="res">
                        {#if o}
                          <span class="lead {o.tone}">{o.result}</span>
                          {#if o.details.length > 0}<span class="sub">{o.details[0]}</span>{/if}
                        {:else}
                          <span class="lead plain" title={t("board.history.open.title")}
                            >{t("board.history.open")}</span
                          >
                        {/if}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="rdel"
                      data-run-del={run.operationId}
                      aria-label={t("board.history.del")}
                      title={t("board.history.del")}
                      onclick={() => hideRuns([run.operationId])}><UiIcon name="close" size={14} /></button
                    >
                    </div>

                    {#if open && detail && detail.run.operationId === run.operationId}
                      {@const d = detail}
                      <section
                        class="detail"
                        id={`run-detail-${d.run.operationId}`}
                        data-history-detail={d.run.operationId}
                        aria-label={t("board.history.detail.aria")}
                      >
                        <div class="dhead">
                          <div class="dtop">
                          <div class="meta">
                            <span>{dateTimeOf(d.run.approvedAt)}</span>
                            <span
                              >{isAuto(d.run)
                                ? d.run.approveAll
                                  ? t("board.history.detail.all")
                                  : t("board.history.detail.auto")
                                : t("board.history.detail.manual")}</span
                            >
                            {#if d.duration}<span>{d.duration}</span>{/if}
                            <span class="mono" title={d.run.operationId}>{d.run.operationId.slice(0, 11)}</span>
                          </div>
                          <button
                            type="button"
                            class="copy"
                            class:done={copiedId === d.run.operationId}
                            data-history-copy
                            title={t("board.history.copy.title")}
                            onclick={() => void copyRun(d)}
                            ><UiIcon name={copiedId === d.run.operationId ? "check" : "copy"} size={14} />{copiedId === d.run.operationId
                              ? t("board.history.copy.done")
                              : t("board.history.copy")}</button
                          >
                          </div>
                          {#if d.outcome}
                            <div class="dres" data-detail-result>
                              <span class="lead {d.outcome.tone}">{d.outcome.result}</span
                              >{#each d.outcome.details as x, i (i)}<span class="sub">{` · ${x}`}</span>{/each}
                            </div>
                          {:else}
                            <div class="dres"><span class="lead plain">{t("board.history.open.title")}</span></div>
                          {/if}
                        </div>
                        <pre class="cmd">{d.run.command}</pre>
                        <AiNote label={t("app.review.summary.label")} text={d.run.summary} />
                        <AiNote label={t("app.review.reason.label")} text={d.run.reason} />
                        {#if d.run.cwd || d.run.validate}
                          <div class="meta">
                            {#if d.run.cwd}<span class="mono">{t("board.history.detail.cwd", { path: d.run.cwd })}</span>{/if}
                            {#if d.run.validate}<span class="mono"
                                >{t("board.history.detail.validate", { command: d.run.validate })}</span
                              >{/if}
                          </div>
                        {/if}
                        {#if d.hasResults}
                          <table class="tgt">
                            <tbody>
                              {#each d.lines as line (line.id)}
                                <tr data-target={line.id}>
                                  <td class="tname"
                                    >{line.name}{#if line.canary}<span class="canary">canary</span>{/if}</td
                                  >
                                  <td class="tstate {stateKind(line.state)}"
                                    >{t(TARGET_LABEL[line.state] ?? "board.target.unknown")}</td
                                  >
                                  <td class="tmeta"
                                    >{[
                                      line.exit !== null ? t("board.history.detail.exit", { code: line.exit }) : null,
                                      line.duration,
                                    ]
                                      .filter((x) => x !== null)
                                      .join(" · ")}</td
                                  >
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        {:else}
                          <p class="optin">{t("board.history.detail.noResults")}</p>
                        {/if}
                        {#if d.excerpts.length > 0}
                          <div class="out" data-excerpt>
                            {#each d.excerpts as b, i (i)}
                              <span class="ohead" class:e={b.stream === "stderr"}>{b.name} {b.stream}</span>
                              <pre class="otext">{b.text}</pre>
                            {/each}
                          </div>
                        {:else if settings.current.automation.audit_output_excerpt}
                          <p class="optin" data-optin="none">{t("board.history.detail.optin.none")}</p>
                        {:else}
                          <p class="optin" data-optin="off">
                            {t("board.history.detail.optin.off")} ·
                            <button type="button" class="link" onclick={openExcerptSetting}
                              >{t("board.history.detail.optin.link")}</button
                            >
                          </p>
                        {/if}
                      </section>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .history {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-1) 0 var(--space-4);
  }

  .search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 0 14px;
    box-sizing: border-box;
    color: var(--fg-3);
    background: var(--m3-surface-container-low);
    border-radius: 999px;
    cursor: text;
  }

  .search:focus-within {
    outline: 2px solid var(--focus-ring);
    outline-offset: -1px;
  }

  .search input {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: transparent;
    border: none;
    outline: none;
  }

  .search input::placeholder {
    color: var(--fg-3);
  }

  /* `Dropdown` 손잡이의 우물 면 · 모서리를 이 칩 안에서만 덮는다 */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .f {
    display: inline-flex;
  }

  .f :global(.trigger) {
    width: auto;
    height: 28px;
    gap: 4px;
    padding: 0 8px 0 12px;
    font-size: var(--t-xs);
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px var(--m3-outline-variant);
  }

  .f :global(.trigger:hover:not(:disabled)) {
    background: var(--control-ghost-hover);
  }

  .f :global(.trigger[aria-expanded="true"]) {
    background: color-mix(in srgb, var(--control-fg) 12%, transparent);
  }

  .f.set :global(.trigger) {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    box-shadow: none;
  }

  .f.set :global(.trigger:hover:not(:disabled)) {
    background: var(--control-sel-bg-hover);
  }

  .f.set :global(.trigger[aria-expanded="true"]) {
    background: color-mix(in srgb, var(--control-sel-fg) 12%, var(--control-sel-bg));
  }

  .f :global(.cur) {
    gap: 5px;
  }

  .f :global(.cur-text) {
    font-weight: var(--fw-semibold);
  }

  .f :global(.trigger .ui-icon) {
    color: currentColor;
    transition: transform 160ms ease;
  }

  .f :global(.trigger[aria-expanded="true"] .ui-icon) {
    transform: rotate(180deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .f :global(.trigger .ui-icon) {
      transition: none;
    }
  }

  .empty {
    margin: 0;
    padding: var(--space-4) 0;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: var(--space-2) var(--space-5);
    padding: 2px 2px var(--space-1);
  }

  .stat {
    display: grid;
    gap: 2px;
  }

  .k {
    font-size: 11px;
    color: var(--fg-3);
  }

  .v {
    font-size: var(--t-lg);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--fg-1);
  }

  .v.bad {
    color: var(--err);
  }

  .v small {
    margin-left: 2px;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
  }

  .ratio {
    flex: 1 1 160px;
    display: grid;
    gap: 5px;
    align-content: end;
    padding-bottom: 6px;
  }

  .ratio .k {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .bar {
    display: flex;
    gap: 3px;
    height: 6px;
  }

  .bar span {
    flex-grow: 0;
    flex-shrink: 1;
    height: 100%;
    border-radius: 999px;
  }

  .bar .man {
    background: var(--fg-2);
  }

  .bar .auto {
    background: var(--m3-outline-variant);
  }

  .days {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }

  .daygroup {
    display: grid;
    gap: var(--space-2);
  }

  .day {
    justify-self: start;
    padding: var(--space-1) 2px 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .day:hover {
    color: var(--fg-1);
  }

  .day .more {
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }

  .day:focus-visible,
  .item:focus-visible,
  .link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .list {
    display: grid;
    overflow: hidden;
    background: var(--control-tile-bg);
    border-radius: var(--radius-surface-inner);
  }

  .irow {
    position: relative;
  }
  .rdel {
    position: absolute;
    top: 50%;
    right: 8px;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity 120ms ease;
  }
  .rdel:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }
  .rdel:focus-visible {
    opacity: 1;
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .irow:hover .rdel,
  .irow:focus-within .rdel {
    opacity: 1;
  }
  .irow:hover .item,
  .irow:focus-within .item {
    padding-right: 44px;
  }
  @media (pointer: coarse) {
    .rdel {
      opacity: 1;
    }
    .item {
      padding-right: 44px;
    }
  }

  .entry + .entry {
    border-top: 1px solid var(--line-faint);
  }

  .item {
    display: grid;
    grid-template-columns: 40px 18px minmax(0, 1fr) auto;
    column-gap: var(--space-3);
    align-items: center;
    width: 100%;
    padding: 10px 14px;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .item:hover {
    background: var(--control-tile-bg-hover);
  }

  .item.sel {
    background: var(--control-bg);
  }

  .time {
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }

  /* 색 하나로만 말하지 않게 모양 · 글자가 함께 다르다 */
  .mark {
    --m: var(--fg-3);
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    font-size: 10px;
    font-weight: 700;
    color: var(--m);
    background: color-mix(in srgb, var(--m) 22%, transparent);
    border-radius: 50%;
  }

  .mark.ok {
    color: var(--on-ok-soft);
    background: var(--ok-soft);
  }

  .mark.bad {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
    border-radius: 4px;
  }

  .mark.cancelled {
    --m: var(--fg-2);
    border-radius: 4px;
  }

  .what {
    display: grid;
    min-width: 0;
  }

  .what .h,
  .what .c,
  .hosts,
  .res .lead,
  .res .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .what .h {
    font-weight: var(--fw-semibold);
    line-height: 20px;
  }

  .what .c.solo {
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
  }

  .line2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--t-xs);
    line-height: 18px;
  }

  .hosts {
    min-width: 0;
    color: var(--fg-3);
  }

  .res {
    display: grid;
    justify-items: end;
    max-width: 14em;
    min-width: 0;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
  }

  @container (max-width: 440px) {
    .item {
      grid-template-columns: 38px 16px minmax(0, 1fr) auto;
      column-gap: var(--space-2);
      padding-inline: 12px;
    }

    .res {
      max-width: 6.5em;
    }
  }

  .lead.good {
    color: var(--ok);
  }

  .lead.bad {
    color: var(--err);
  }

  .lead.plain {
    color: var(--fg-2);
  }

  .res .sub {
    max-width: 100%;
    color: var(--fg-3);
  }

  .how {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .how.auto {
    padding: 0 6px;
    color: var(--fg-2);
    background: var(--control-bg);
    border-radius: 999px;
  }

  .how.auto.all {
    color: var(--err);
  }

  .detail {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3) 14px 14px;
  }

  .dhead {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }

  .dtop {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }

  .dtop .meta {
    flex: 1 1 auto;
    min-width: 0;
  }

  .copy {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 10px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--control-fg);
    background: var(--control-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .copy:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .copy:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .copy.done {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .meta span {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    min-height: 22px;
    padding: 0 9px;
    background: var(--control-bg);
    border-radius: 999px;
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono, monospace);
  }

  .dres {
    font-size: var(--t-xs);
  }

  .dres .sub {
    color: var(--fg-2);
  }

  .cmd {
    margin: 0;
    max-height: 240px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-base);
    border-radius: 12px;
  }

  .tgt {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-xs);
  }

  .tgt td {
    padding: 4px var(--space-1);
  }

  .tname {
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }

  .canary {
    margin-left: 6px;
    font-size: 11px;
    color: var(--warn);
  }

  .tstate.ok {
    color: var(--ok);
  }

  .tstate.bad {
    color: var(--err);
  }

  .tstate.dim {
    color: var(--fg-3);
  }

  .tmeta {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    white-space: nowrap;
  }

  .out {
    display: grid;
    gap: var(--space-1);
    max-height: 320px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-base);
    border-radius: 12px;
  }

  .ohead {
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .ohead.e {
    color: var(--err);
  }

  .otext {
    margin: 0 0 var(--space-1);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-2);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .optin {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
    border: 1px dashed var(--line-strong);
    border-radius: 12px;
  }

  .link {
    padding: 0;
    font: inherit;
    color: var(--fg-2);
    text-decoration: underline;
    text-underline-offset: 2px;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .link:hover {
    color: var(--fg-1);
  }
</style>
