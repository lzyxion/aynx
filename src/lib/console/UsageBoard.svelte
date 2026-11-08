<script lang="ts">
  /**
   * **사용량 화면의 본문** — 에이전트의 토큰과 요금제 한도 (docs/log/2026-09-26-agent-usage.md "사용량 칸" ·
   * 2026-10-04 에 대시보드의 칸에서 제 화면 `UsageView.svelte` 로 옮겼다).
   *
   * 위에서 아래로: 사용 한도 카드(`UsageLimits`) → 거르개(에이전트 · 기간 7일/30일 — 기본 30일, 아래
   * 전부에 걸린다(잔디는 늘 다섯 주), 기억한다) → 요약 띠 다섯 칸 → 사용 잔디 + 고른 날의 풀이 → 최근 7일 모델별 막대 + 토큰 구성 → 모델 표.
   * 모양은 사용자의 앞선 앱 token-chan 을 본떴고 **요금은 어디에도 없다**(구독제 — 환산하지 않는다).
   *
   * 숫자는 Rust `agent_usage_summary` 가 캐시에서 모으고(대화별 토큰과 같은 캐시), 접는 규칙은 순수 층
   * `$lib/usage-board`, 저장소는 `app/agent-usage.svelte.ts`. 이 칸이 **보일 때마다** 다시 읽는다.
   *
   * 조용하게: 회색이 기본이고, 강조색은 이 칸에서 쓰지 않는다(고른 칸 단추는 대시보드 머리의 몫). 잔디는 `--ok`,
   * 모델 조각은 에이전트 빛깔(`--agent-*`).
   *
   * ## 어디서 (docs/log/2026-09-27-remote-conversations.md "2단계")
   *
   * 원격 대화를 읽은 호스트가 있으면 맨 위에 출처 칩. 호스트를 고르면 잔디 · 모델 표가 그
   * 서버의 것, "모두" 면 이 PC 와 서버들의 합이다(Rust 가 같은 셈으로 더한다). 원격 몫은 **센 대화만** 든다 — 머리 한 번에 다 온
   * 작은 대화는 목록을 읽을 때 세고, 큰 대화는 사람이 [전체 사용량 읽기] 를 누르면 조각씩 센다(붙은 SSH 타일로 · 진행 · 멈춤).
   * 남은 것은 호스트마다 한 줄로 밝힌다. 한도는 호스트면 그 서버의 Codex 만(Claude 한도는 이 PC 의 상태줄에서만 온다).
   */
  import { untrack } from "svelte";
  import { usageViewOpen } from "$lib/app/usage-view.svelte.js";
  import {
    loadLimits,
    loadUsage,
    loadUsageSummary,
    pickedUsageDay,
    pickUsageDay,
    setUsageFilter,
    usageFilter,
    usageSummary,
    usageSummaryError,
    usageSummaryLoading,
  } from "$lib/app/agent-usage.svelte.js";
  import { formatTokens } from "$lib/agent-usage";
  import {
    buildHeatmap,
    composition,
    dayDetail,
    modelTable,
    monthDay,
    pctText,
    periodLabel,
    periodTokens,
    PERIODS,
    shortModel,
    summaryStrip,
    usageColors,
    weekChart,
    type UsagePeriod,
  } from "$lib/usage-board";
  import UsageLimits from "$lib/console/UsageLimits.svelte";
  import UsageHeatmap from "$lib/console/UsageHeatmap.svelte";
  import UsageWeekChart from "$lib/console/UsageWeekChart.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { aiDisplayName } from "$lib/pane-icons";
  import { stripReason } from "$lib/error-reason";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import SourceChips from "$lib/console/SourceChips.svelte";
  import { dashboardSources, pickDashboardSource, refreshDashboardSource } from "$lib/app/dashboard-source.svelte.js";
  import {
    loadRemoteConversations,
    readRemoteUsageFully,
    remoteConversations,
    remoteUsageRead,
    stopRemoteUsageRead,
  } from "$lib/app/remote-conversations.svelte.js";
  import { loadConversations, conversationList } from "$lib/app/agent-sessions.svelte.js";
  import { setUsageSource } from "$lib/app/agent-usage.svelte.js";
  import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
  import { coverageLine, formatBytes, sourceScope, type CoverageLine } from "$lib/dashboard-source";

  const visible = $derived(usageViewOpen());

  /** 상대 시각의 "지금" — 칩의 "N분 전 읽음" */
  let now = $state(Date.now());
  $effect(() => {
    if (!visible) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  // 칩의 "이 PC · N" 은 대화 목록의 수다 — 아직 읽은 적이 없으면 목록을 한 번 읽는다
  $effect(() => {
    if (visible && conversationList() === null) void loadConversations();
  });

  const sources = $derived(dashboardSources());
  const scope = $derived(sourceScope(sources.key, sources.chips));
  /** 고른 출처에 든 호스트 칩들 */
  const hostChips = $derived(
    sources.chips.filter((c) => c.kind === "host" && (sources.key === "all" || c.key === sources.key)),
  );
  /** 원격 캐시가 바뀐 표식 — 호스트 목록을 다시 읽었거나 전체 읽기가 나아가면 요약을 다시 읽는다 */
  const remoteStamp = $derived(
    hostChips
      .map((c) => {
        const r = remoteUsageRead(c.alias ?? "");
        return `${c.alias}:${remoteConversations(c.alias ?? "").readAt ?? 0}:${c.loading}:${r?.doneBytes ?? 0}`;
      })
      .join("|"),
  );
  /** 출처의 글자 — 같은 출처면 같은 글자(탭이 바뀌어 칩이 다시 지어져도 요약을 다시 읽지 않게) */
  const scopeSig = $derived(JSON.stringify(scope));
  /** 보일 때 · 출처가 바뀔 때 · 원격 캐시가 바뀔 때 — 요약을 (다시) 읽는다 */
  $effect(() => {
    if (!visible) return;
    const sc = JSON.parse(scopeSig) as { local: boolean; hosts: string[] };
    void remoteStamp;
    untrack(() => setUsageSource(sc, true));
  });
  $effect(() => {
    if (visible) untrack(() => refreshDashboardSource());
  });

  /** 원격 호스트마다 한 줄 — 아직 세지 못한 큰 대화 · 전체 읽기의 진행 */
  const coverage = $derived(
    (usageSummary()?.remote ?? [])
      .map((cov) => coverageLine(cov, remoteUsageRead(cov.host), liveSessionFor(cov.host) !== null))
      .filter((l): l is CoverageLine => l !== null),
  );

  function coverageText(l: CoverageLine): string {
    const r = remoteUsageRead(l.host);
    switch (l.kind) {
      case "running":
        return t("board.usage.remote.reading", {
          host: l.host,
          done: formatBytes(r?.doneBytes ?? 0),
          total: formatBytes(r?.totalBytes ?? 0),
        });
      case "error":
        return t("board.usage.remote.error", { host: l.host, reason: r?.error ?? "" });
      case "offline":
        return t("board.usage.remote.offline", { host: l.host });
      case "done":
        return t("board.usage.remote.done", { host: l.host, n: l.n });
      case "pendingClaude":
        return t("board.usage.remote.pendingClaude", { host: l.host, n: l.n, size: formatBytes(l.bytes) });
      default:
        return t("board.usage.remote.pending", { host: l.host, n: l.n, size: formatBytes(l.bytes) });
    }
  }

  function readAll(host: string): void {
    void readRemoteUsageFully(host, () => setUsageSource(scope, true));
  }

  let refreshing = $state(false);

  /** 새로고침 — 고른 출처를 다시 읽은 뒤 한도와 기간 요약을 갱신한다 */
  async function refreshUsage(): Promise<void> {
    if (refreshing) return;
    const current = { local: scope.local, hosts: [...scope.hosts] };
    refreshing = true;
    try {
      await Promise.all([
        ...(current.local ? [loadLimits(), loadUsage()] : []),
        ...current.hosts.map((host) => loadRemoteConversations(host, true)),
      ]);
      await loadUsageSummary();
    } finally {
      refreshing = false;
    }
  }

  const filter = $derived(usageFilter());
  const s = $derived(usageSummary());
  const strip = $derived(s ? summaryStrip(s) : null);
  const heat = $derived(s ? buildHeatmap(s, locale()) : null);
  const selected = $derived(pickedUsageDay() ?? s?.today ?? "");
  const detail = $derived(s && selected ? dayDetail(s, selected) : null);
  /** 빛깔은 요약 한 벌에 하나 — 7일 막대 · 하루 구성 · 모델 표가 같은 모델에 같은 빛깔 */
  const detailColors = $derived(s ? usageColors(s) : new Map<string, string>());
  const week = $derived(s ? weekChart(s) : null);
  const comp = $derived(s ? composition(periodTokens(s)) : null);
  const table = $derived(s ? modelTable(s) : []);

  const modelName = (m: string) => (shortModel(m) === "" ? t("board.usage.model.unknown") : shortModel(m));
  const agentName = (a: string) => aiDisplayName(a) ?? a;

  function setAgent(agent: string | null): void {
    setUsageFilter({ agent });
  }

  function setPeriod(period: UsagePeriod): void {
    setUsageFilter({ period });
  }

  const COMP_KEY: Record<string, Key> = {
    cacheRead: "board.usage.tip.cacheRead",
    cacheWrite: "board.usage.tip.cacheWrite",
    output: "board.usage.tip.output",
    input: "board.usage.tip.input",
  };

  const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}%`;
</script>

<div class="usage" data-usage-board>
  <SourceChips chips={sources.chips} current={sources.key} {now} onpick={pickDashboardSource} />

  <UsageLimits
    host={scope.local ? null : (scope.hosts[0] ?? null)}
    mixed={scope.local && scope.hosts.length > 0}
    stamp={remoteConversations(scope.hosts[0] ?? "").readAt ?? 0}
    {refreshing}
    onrefresh={refreshUsage}
  />

  {#each coverage as l (l.host)}
    <p class="quiet remote-line" data-usage-remote={l.host} data-state={l.kind}>
      <span>{coverageText(l)}</span>
      {#if l.kind === "running"}
        <button type="button" class="btn btn-ghost btn-sm" data-usage-remote-stop onclick={() => stopRemoteUsageRead(l.host)}
          >{t("board.usage.remote.stop")}</button
        >
      {:else if l.canRead}
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          data-usage-remote-read
          title={t("board.usage.remote.readAll.title", { host: l.host })}
          onclick={() => readAll(l.host)}>{t("board.usage.remote.readAll")}</button
        >
      {/if}
    </p>
  {/each}
  {#if !scope.local || scope.hosts.length > 0}
    <p class="quiet" data-usage-remote-note>{t("board.usage.remote.subagents")}</p>
  {/if}

  <div class="filters">
    {#if (s?.agents.length ?? 0) > 1}
      <div class="seg" role="group" aria-label={t("board.usage.filter.agent.aria")}>
        <button
          type="button"
          class="seg-btn"
          class:on={filter.agent === null}
          aria-pressed={filter.agent === null}
          data-usage-agent="all"
          onclick={() => setAgent(null)}>{t("board.usage.filter.all")}</button
        >
        {#each s?.agents ?? [] as a (a)}
          <button
            type="button"
            class="seg-btn"
            class:on={filter.agent === a}
            aria-pressed={filter.agent === a}
            data-usage-agent={a}
            onclick={() => setAgent(a)}>{agentName(a)}</button
          >
        {/each}
      </div>
    {/if}
    <div class="seg" role="group" aria-label={t("board.usage.filter.period.aria")}>
      {#each PERIODS as p (p)}
        <button
          type="button"
          class="seg-btn"
          class:on={filter.period === p}
          aria-pressed={filter.period === p}
          data-usage-period={p}
          onclick={() => setPeriod(p)}>{periodLabel(p, t)}</button
        >
      {/each}
    </div>
  </div>

  {#if s === null}
    {#if usageSummaryError()}
      <p class="quiet" data-usage-error>{t("board.usage.error", { e: stripReason(usageSummaryError() ?? "") })}</p>
    {:else if usageSummaryLoading() || !visible}
      <p class="quiet" data-usage-loading>{t("board.usage.loading")}</p>
    {/if}
  {:else if strip}
    <!-- ── 요약 띠 ── -->
    <ul class="strip" data-usage-strip>
      <li data-cell="today">
        <span class="k">{t("board.usage.strip.today")}</span>
        <span class="v">{formatTokens(strip.today)}</span>
        <span class="sub"
          >{strip.todayDelta === null
            ? t("board.usage.strip.today.nodelta")
            : t("board.usage.strip.today.delta", { n: s.priorDays, d: signed(strip.todayDelta) })}</span
        >
      </li>
      <li data-cell="total">
        <span class="k">{t("board.usage.strip.total")}</span>
        <span class="v">{formatTokens(strip.periodTotal)}</span>
        <span class="sub">{t("board.usage.strip.total.avg", { n: formatTokens(strip.dailyAvg) })}</span>
      </li>
      <li data-cell="active">
        <span class="k">{t("board.usage.strip.active")}</span>
        <span class="v">{t("board.usage.strip.days", { n: strip.activeDays })}</span>
        <span class="sub">{t("board.usage.strip.active.of", { n: strip.recordedDays })}</span>
      </li>
      <li data-cell="streak">
        <span class="k">{t("board.usage.strip.streak")}</span>
        <span class="v">{t("board.usage.strip.days", { n: strip.streak })}</span>
        <span class="sub">{t("board.usage.strip.streak.sub", { n: s.daily.length })}</span>
      </li>
      <li data-cell="busiest">
        <span class="k">{t("board.usage.strip.busiest")}</span>
        <span class="v">{strip.busiest ? formatTokens(strip.busiest.total) : "—"}</span>
        <span class="sub">{strip.busiest ? monthDay(strip.busiest.date, locale()) : ""}</span>
      </li>
    </ul>

    {#if strip.periodTotal === 0 && s.firstDay === null}
      <p class="quiet" data-usage-nodata>{t("board.usage.nodata")}</p>
    {/if}

    <!-- ── 잔디 + 고른 날 ── -->
    <div class="pair">
      <section class="card" aria-labelledby="usage-heat-h">
        <h2 class="c-head" id="usage-heat-h">
          {t("board.usage.heat.heading")}
          {#if heat}<span class="c-aside" data-heat-months>{heat.months.join(" · ")}</span>{/if}
        </h2>
        {#if heat}
          <UsageHeatmap {heat} {selected} onpick={(d) => pickUsageDay(d === s.today ? null : d)} />
        {/if}
      </section>

      <section class="card" aria-labelledby="usage-day-h" data-usage-day={detail?.date ?? ""}>
        <h2 class="c-head" id="usage-day-h">
          {detail?.date === s.today ? t("board.usage.day.today") : monthDay(detail?.date ?? s.today, locale())}
          <span class="c-total">{formatTokens(detail?.total ?? 0)}</span>
        </h2>
        {#if !detail || detail.total === 0}
          <p class="quiet">{t("board.usage.day.empty")}</p>
        {:else}
          <ul class="agents">
            {#each detail.agents as a (a.agent)}
              <li data-day-agent={a.agent}>
                <span class="logo" aria-hidden="true"><HostIcon icon={iconRef(a.agent)} size={14} /></span>
                <span class="a-name">{agentName(a.agent)}</span>
                <span class="num">{formatTokens(a.total)}</span>
                <span class="num dim">{pctText(a.share)}</span>
              </li>
            {/each}
          </ul>
          <div class="mix" role="img" aria-label={t("board.usage.day.mix.aria")} data-day-mix>
            {#each detail.models as m (m.key)}
              <span style:flex-grow={m.total} style:background={detailColors.get(m.key)}></span>
            {/each}
          </div>
          <ul class="mix-legend">
            {#each detail.models as m (m.key)}
              <li data-day-model={m.model}>
                <span class="sw" style:background={detailColors.get(m.key)}></span>
                <span class="m-name">{modelName(m.model)}</span>
                <span class="num">{formatTokens(m.total)}</span>
                <span class="num dim">{pctText(m.share)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>

    <!-- ── 최근 7일 + 토큰 구성 ── -->
    <div class="pair">
      <section class="card" aria-labelledby="usage-week-h">
        <h2 class="c-head" id="usage-week-h">{t("board.usage.week.heading")}</h2>
        {#if week && week.max > 0}
          <UsageWeekChart chart={week} />
        {:else}
          <p class="quiet">{t("board.usage.week.empty")}</p>
        {/if}
      </section>

      <section class="card" aria-labelledby="usage-comp-h" data-usage-comp>
        <h2 class="c-head" id="usage-comp-h">{t("board.usage.comp.heading")}</h2>
        {#if comp}
          <ul class="comp">
            {#each comp.rows as r (r.key)}
              <li data-comp-row={r.key}>
                <span class="k">{t(COMP_KEY[r.key])}</span>
                <span class="bar"><span class="fill" style:width="{Math.round(r.share * 1000) / 10}%"></span></span>
                <span class="num">{formatTokens(r.total)}</span>
                <span class="num dim">{pctText(r.share)}</span>
              </li>
            {/each}
          </ul>
          <dl class="ratios">
            <dt>{t("board.usage.comp.hit")}</dt>
            <dd data-comp-hit>{comp.hitRate === null ? "—" : pctText(comp.hitRate)}</dd>
            <dt>{t("board.usage.comp.reuse")}</dt>
            <dd data-comp-reuse>
              {comp.reuse === null
                ? t("board.usage.comp.reuse.none")
                : t("board.usage.comp.reuse.times", { n: comp.reuse >= 10 ? Math.round(comp.reuse) : Math.round(comp.reuse * 10) / 10 })}
            </dd>
          </dl>
        {/if}
      </section>
    </div>

    <!-- ── 모델 표 ── -->
    <section class="card" aria-labelledby="usage-table-h">
      <h2 class="c-head" id="usage-table-h">{t("board.usage.table.heading", { period: periodLabel(filter.period, t) })}</h2>
      {#if table.length === 0}
        <p class="quiet">{t("board.usage.nodata")}</p>
      {:else}
        <table class="models" data-usage-table>
          <thead>
            <tr>
              <th>{t("board.usage.table.model")}</th>
              <th class="r">{t("board.usage.table.tokens")}</th>
              <th>{t("board.usage.table.share")}</th>
              <th class="r">{t("board.usage.table.output")}</th>
              <th class="r">{t("board.usage.table.convos")}</th>
              <th class="r">{t("board.usage.table.inputWrite")}</th>
            </tr>
          </thead>
          <tbody>
            {#each table as r (r.key)}
              <tr data-model-row={r.model} data-agent={r.agent}>
                <td
                  ><span class="m"
                    ><span class="sw" style:background={r.color}></span><span title={r.model}
                      >{r.label === "" ? t("board.usage.model.unknown") : r.label}</span
                    ></span
                  ></td
                >
                <td class="r num">{formatTokens(r.total)}</td>
                <td
                  ><span class="share"
                    ><span class="bar"><span class="fill" style:width="{Math.round(r.share * 1000) / 10}%"></span></span><span
                      class="num dim">{pctText(r.share)}</span
                    ></span
                  ></td
                >
                <td class="r num">{formatTokens(r.output)}</td>
                <td class="r num">{r.conversations}</td>
                <td class="r num">{formatTokens(r.inputWrite)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <!-- 보존 기간 안내 — Claude 기록이 있을 때만(그 기록이 30일 뒤 지워진다) -->
    {#if s.agents.includes("claude")}
      <p class="quiet foot" data-usage-retention>{t("board.usage.retention")}</p>
    {/if}
  {/if}
</div>

<style>
  .usage {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4) 0 var(--space-6);
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  .quiet {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 원격 호스트 한 줄 — 남은 큰 대화 · 전체 읽기 (docs/log/2026-09-27-remote-conversations.md "2단계") */
  .remote-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .num {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .dim {
    color: var(--fg-3);
  }

  /* ── 거르개 ── */
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .seg {
    display: inline-flex;
    gap: var(--space-1);
    margin-left: auto;
  }

  .seg:first-child {
    margin-left: 0;
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .seg-btn:hover {
    color: var(--fg-1);
  }

  .seg-btn.on {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .seg-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* ── 요약 띠 ── */
  .strip {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .strip li {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    box-shadow: -1px 0 0 var(--line);
  }

  .strip .k {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .strip .v {
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
  }

  .strip .sub {
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  /* ── 카드 두 장 줄 — 좁으면 한 장씩 ── */
  .pair {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: var(--space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3) var(--space-4);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .c-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }

  .c-total {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .c-aside {
    margin-left: auto;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-3);
  }

  /* ── 고른 날 ── */
  .agents,
  .mix-legend,
  .comp {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--t-xs);
  }

  .agents li,
  .mix-legend li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto 40px;
    align-items: center;
    gap: var(--space-2);
  }

  .agents .num.dim,
  .mix-legend .num.dim {
    text-align: right;
  }

  .logo {
    display: inline-flex;
    line-height: 0;
  }

  .a-name,
  .m-name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mix {
    display: flex;
    gap: 1px;
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--control-track); /* 게이지 트랙 = secondaryContainer(10-18 MD3) — 채움은 에이전트 빛깔 그대로 */
  }

  .mix span {
    flex-basis: 0;
    min-width: 2px;
  }

  .sw {
    display: inline-block;
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  /* ── 토큰 구성 ── */
  .comp li {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr) auto 40px;
    align-items: center;
    gap: var(--space-2);
  }

  .comp .k {
    color: var(--fg-2);
  }

  .comp .num.dim {
    text-align: right;
  }

  /* MD3 막대 게이지(2026-10-18): 8px · 채움 primary · 나머지 트랙 secondaryContainer · 사이 2px 틈(트랙은 `::after` 가 남는 폭을 채운다) */
  .bar {
    display: flex;
    gap: 2px;
    height: 8px;
  }

  .bar::after {
    flex: 1 1 0;
    content: "";
    border-radius: 4px;
    background: var(--control-track);
  }

  .fill {
    display: block;
    flex: none;
    height: 100%;
    background: var(--control-on-bg);
    border-radius: 4px;
  }

  .ratios {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--t-xs);
  }

  .ratios dt {
    color: var(--fg-2);
  }

  .ratios dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* ── 모델 표 ── */
  .models {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-xs);
  }

  .models th {
    padding: var(--space-1) var(--space-2);
    font-weight: var(--fw-regular);
    text-align: left;
    color: var(--fg-3);
    border-bottom: 1px solid var(--line);
  }

  .models td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
  }

  .models tr:last-child td {
    border-bottom: none;
  }

  .models .r {
    text-align: right;
  }

  /* 칸 안의 묶음 — td 자체를 flex/grid 로 만들면 표 줄의 테두리가 끊긴다 */
  .models .m {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
  }

  .models .share {
    display: grid;
    grid-template-columns: minmax(40px, 1fr) 40px;
    align-items: center;
    gap: var(--space-2);
    min-width: 120px;
  }

  .models .share .num {
    text-align: right;
  }
</style>
