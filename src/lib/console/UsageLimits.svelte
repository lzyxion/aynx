<script lang="ts">
  /**
   * 사용 한도 카드. 창 라벨은 데이터의 창 길이(분)에서 짓는다 — "5시간" 을 박아 두지 않는다. 값이 없으면 숫자를 지어내지 않는다.
   * 원격 호스트는 Codex 한도만 — 원격 목록의 캐시에서 읽고 서버에 따로 묻지 않는다. Claude 한도는 이 PC 의 상태줄 도우미만 적는다.
   */
  import { usageViewOpen } from "$lib/app/usage-view.svelte.js";
  import { enabledAgentLimits, limitsReady, loadLimits } from "$lib/app/agent-usage.svelte.js";
  import { allAgentsDisabled, withoutDisabled } from "$lib/agent-enabled";
  import { settings } from "$lib/settings.svelte.js";
  import { barWidth, limitCard, type AgentLimits } from "$lib/agent-usage";
  import { agentUsageRemoteLimits } from "$lib/context";

  let { host = null, mixed = false, stamp = 0, refreshing = false, onrefresh }: {
    host?: string | null;
    /** 이 PC 와 서버들을 함께 보는 중("모두") */
    mixed?: boolean;
    /** 바뀌면 원격 한도를 다시 가져온다 */
    stamp?: number;
    refreshing?: boolean;
    onrefresh: () => Promise<void>;
  } = $props();

  let remote = $state<AgentLimits[] | null>(null);
  $effect(() => {
    const h = host;
    void stamp;
    remote = null;
    if (h === null) return;
    let alive = true;
    agentUsageRemoteLimits(h)
      .then((r) => {
        if (alive) remote = r;
      })
      .catch(() => {
        if (alive) remote = [];
      });
    return () => {
      alive = false;
    };
  });
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { aiDisplayName } from "$lib/pane-icons";
  import { locale, t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  const visible = $derived(usageViewOpen());

  let now = $state(Date.now());
  $effect(() => {
    if (!visible) return;
    now = Date.now();
    void loadLimits();
    const read = setInterval(() => void loadLimits(), 60_000);
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      clearInterval(read);
      clearInterval(tick);
    };
  });

  const cards = $derived(
    (host !== null ? withoutDisabled(remote ?? [], (l) => l.agent, settings.disabledAgents) : enabledAgentLimits()).map(
      (l) => limitCard(l, now, t, locale()),
    ),
  );
  const remoteEmpty = $derived(host !== null && remote !== null && cards.length > 0 && cards.every((c) => c.empty));
  const allOff = $derived(allAgentsDisabled(settings.disabledAgents));

  // 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝(`onanimationiteration`)에서 멈춘다
  let spinning = $state(false);

  const EMPTY_KEY: Record<string, Key> = {
    claude: "board.usage.empty.claude",
    codex: "board.usage.empty.codex",
  };
</script>

<section class="block" aria-labelledby="agents-usage-h" data-usage-limits data-limits-host={host ?? undefined}>
  <div class="head">
    <h2 class="heading" id="agents-usage-h">{t("board.usage.heading")}</h2>
    <button
      type="button"
      class="btn btn-secondary btn-sm refresh-btn"
      class:spinning
      data-usage-refresh
      disabled={refreshing}
      aria-busy={refreshing}
      aria-label={t(refreshing ? "board.usage.refreshing" : "board.usage.refresh")}
      title={t(refreshing ? "board.usage.refreshing" : "board.usage.refresh")}
      onclick={() => {
        spinning = true;
        void onrefresh();
      }}
      onanimationiteration={() => {
        if (!refreshing) spinning = false;
      }}
      ><UiIcon name="refresh" size={13} /></button
    >
  </div>
  {#if allOff}
    <p class="aside" data-limits-note data-limits-off>{t("board.usage.limits.allOff")}</p>
  {:else if host !== null && remoteEmpty}
    <p class="aside" data-limits-note>{t("board.usage.limits.remoteEmpty", { host })}</p>
  {:else if (host !== null ? remote !== null : limitsReady()) && cards.length > 0}
    {#if host !== null}
      <p class="aside" data-limits-note>{t("board.usage.limits.remote", { host })}</p>
    {:else if mixed}
      <p class="aside" data-limits-note>{t("board.usage.limits.local")}</p>
    {/if}
    <ul class="cards">
      {#each cards as c (c.agent)}
        <li class="card" data-usage-card={c.agent} data-empty={c.empty ? "" : undefined}>
          <div class="c-head">
            <span class="logo" aria-hidden="true"><HostIcon icon={iconRef(c.agent)} size={14} /></span>
            <span class="c-name">{aiDisplayName(c.agent) ?? c.agent}</span>
            {#if !c.empty}
              <span class="measured" class:stale={c.stale} data-measured>{c.measured}</span>
            {/if}
          </div>
          {#if c.empty}
            <p class="hint" data-usage-empty>{t(EMPTY_KEY[c.agent] ?? "board.usage.empty.claude")}</p>
          {:else}
            {#each c.rows as r (r.key)}
              <div class="row" class:dim={r.dim} data-usage-row={r.label} data-level={r.level}>
                <span class="w-label">{r.label}</span>
                <span
                  class="bar"
                  role="img"
                  aria-label={t("board.usage.bar.aria", { label: r.label, pct: r.pctText })}
                  ><span class="fill {r.level}" style:width="{barWidth(r.pct)}%"></span></span
                >
                <span class="pct {r.level}">{r.pctText}</span>
                <span
                  class="reset"
                  class:stale={r.resetStale}
                  data-reset
                  title={r.resetStale ? t("board.usage.reset.stale.title") : undefined}>{r.reset}</span
                >
              </div>
            {/each}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .heading {
    margin: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .refresh-btn {
    width: 24px;
    padding: 0;
    flex: 0 0 auto;
  }

  .refresh-btn.spinning :global(svg) {
    animation: usage-spin 0.9s linear infinite;
  }

  @keyframes usage-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 돌지 않으니 바퀴 끝 이벤트도 없다 — 흐림은 `aria-busy` 를 따른다 */
  @media (prefers-reduced-motion: reduce) {
    .refresh-btn.spinning :global(svg) {
      animation: none;
    }
    .refresh-btn[aria-busy="true"] :global(svg) {
      opacity: 0.5;
    }
  }

  .aside {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: var(--space-3);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .c-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .logo {
    flex: 0 0 auto;
    display: inline-flex;
    line-height: 0;
  }

  .c-name {
    flex: 1;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .measured {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .measured.stale {
    color: var(--warn);
  }

  .hint {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
  }

  .row {
    display: grid;
    /* 고정 열 — 창마다 막대가 같은 길이로 선다 */
    grid-template-columns: 48px minmax(60px, 1fr) 44px 150px;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--t-xs);
  }

  .row.dim {
    opacity: 0.5;
  }

  .w-label {
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 트랙은 `::after` 가 채움 뒤 남는 폭을 채운다 */
  .bar {
    position: relative;
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
    border-radius: 4px;
    background: var(--control-on-bg);
  }

  .fill.warn {
    background: var(--warn);
  }

  .fill.err {
    background: var(--err);
  }

  .pct {
    text-align: right;
    color: var(--fg-1);
    font-variant-numeric: tabular-nums;
  }

  .pct.warn {
    color: var(--warn);
  }

  .pct.err {
    color: var(--err);
  }

  /* 자르지 않는다 — 넘치면 접는다 */
  .reset {
    min-width: 0;
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .reset.stale {
    color: var(--warn);
    font-style: italic;
  }
</style>
