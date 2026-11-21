<script lang="ts">
  /**
   * 사용량 화면의 본문 — 에이전트의 토큰과 요금제 한도. 요금은 어디에도 없다(구독제 — 환산하지 않는다).
   * 원격 몫은 센 대화만 든다 — 큰 대화는 사람이 [전체 사용량 읽기] 를 눌러야 센다. 호스트의 한도는 Codex 만(Claude 한도는 이 PC 의 상태줄에서만 온다).
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

  let now = $state(Date.now());
  $effect(() => {
    if (!visible) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  // 칩의 "이 PC · N" 은 대화 목록의 수다
  $effect(() => {
    if (visible && conversationList() === null) void loadConversations();
  });

  const sources = $derived(dashboardSources());
  const scope = $derived(sourceScope(sources.key, sources.chips));
  const hostChips = $derived(
    sources.chips.filter((c) => c.kind === "host" && (sources.key === "all" || c.key === sources.key)),
  );
  /** 바뀌면 요약을 다시 읽는다 */
  const remoteStamp = $derived(
    hostChips
      .map((c) => {
        const r = remoteUsageRead(c.alias ?? "");
        return `${c.alias}:${remoteConversations(c.alias ?? "").readAt ?? 0}:${c.loading}:${r?.doneBytes ?? 0}`;
      })
      .join("|"),
  );
  /** 글자로 비교한다 — 탭이 바뀌어 칩이 다시 지어져도 요약을 다시 읽지 않게 */
  const scopeSig = $derived(JSON.stringify(scope));
  $effect(() => {
    if (!visible) return;
    const sc = JSON.parse(scopeSig) as { local: boolean; hosts: string[] };
    void remoteStamp;
    untrack(() => setUsageSource(sc, true));
  });
  $effect(() => {
    if (visible) untrack(() => refreshDashboardSource());
  });

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

  /* ── 카드 두 장 줄 ── */
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
    background: var(--control-track);
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

  /* 트랙은 `::after` 가 채움 뒤 남는 폭을 채운다 */
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
