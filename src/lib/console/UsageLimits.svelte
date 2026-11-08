<script lang="ts">
  /**
   * **사용 한도** — 사용량 화면(`UsageView.svelte`)의 맨 위 덩어리 (docs/log/2026-09-26-agent-usage.md).
   *
   * 에이전트마다 카드 한 장: 머리(로고 · 이름 · "12분 전 기준") 아래 창마다 한 줄(라벨 · 6px 막대 · % ·
   * 초기화 글자). 창 라벨은 데이터의 창 길이(분)에서 짓는다 — "5시간" 을 박아 두지 않는다. 값이 없으면
   * 숫자를 지어내지 않고 안내 한 줄이다.
   *
   * ## 조용하게
   *
   * 막대는 회색이다. 80% 부터 경고색, 95% 부터 오류색 — **강조색은 쓰지 않는다**(입력 대기의 색이다).
   * 값이 묵었거나(3시간) 초기화가 지난 창은 흐리게, 묵은 "기준" 글자는 경고색.
   *
   * 읽기: 이 칸이 **보이는 동안** 1분마다(`agent_usage_limits` — 싸다). 앱이 뜰 때 한 번은 `+page` 가 읽는다.
   * 자리는 사용량 화면의 맨 위 하나다(사용자 결정 — 한때 에이전트 칸에도 섰지만 한도는 이제 사용량 화면과 상태바 고리의 몫이다).
   *
   * ## 자리 (실기 발견 — 카드가 좁아 막대 길이가 줄마다 달랐고 초기화 글자가 "…초기…" 로 잘렸다)
   *
   * 카드는 한 줄을 나눠 갖는다(둘이면 반씩). 줄은 **고정 열** `라벨 | 막대(1fr) | % | 초기화(150px)` 라 창마다
   * 막대가 같은 길이로 서고, 초기화 글자는 자르지 않고 접는다. 초기화가 지난 창은 "낡음"(경고색 기울임 — token-chan
   * 과 같은 말)이고 % 는 지운 0 이 아니라 흐린 지난 값이다.
   *
   * ## 어디서 (docs/log/2026-09-27-remote-conversations.md "2단계")
   *
   * 대시보드의 출처가 **호스트 하나**면(`host`) 그 서버의 **Codex** 한도만 선다 — 서버의 롤아웃 꼬리에서 읽은 것(원격 목록의
   * 캐시 · 서버에 따로 묻지 않는다). Claude 한도는 이 PC 의 상태줄 도우미만 적으므로 원격에는 없다 — 그 말을 한 줄로 단다.
   * "모두" 면(`mixed`) 이 PC 의 카드 그대로에 "한도는 이 PC 의 것" 한 줄.
   */
  import { usageViewOpen } from "$lib/app/usage-view.svelte.js";
  import { enabledAgentLimits, limitsReady, loadLimits } from "$lib/app/agent-usage.svelte.js";
  import { allAgentsDisabled, withoutDisabled } from "$lib/agent-enabled";
  import { settings } from "$lib/settings.svelte.js";
  import { barWidth, limitCard, type AgentLimits } from "$lib/agent-usage";
  import { agentUsageRemoteLimits } from "$lib/context";

  let { host = null, mixed = false, stamp = 0, refreshing = false, onrefresh }: {
    /** 원격 호스트 하나를 보는 중이면 그 별칭 — 그 서버의 Codex 한도만 */
    host?: string | null;
    /** 이 PC 와 서버들을 함께 보는 중("모두") — 카드는 이 PC 의 것이라는 한 줄 */
    mixed?: boolean;
    /** 원격 캐시가 바뀐 표식(다시 읽은 때) — 바뀌면 원격 한도를 다시 가져온다 */
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

  /** 보이는 동안 1분마다 다시 읽고, 30초마다 "N분 전" 을 새로 쓴다 */
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

  // 설정에서 끈 에이전트의 카드는 세우지 않는다(원격도 같다) — 다시 켜면 돌아온다
  const cards = $derived(
    (host !== null ? withoutDisabled(remote ?? [], (l) => l.agent, settings.disabledAgents) : enabledAgentLimits()).map(
      (l) => limitCard(l, now, t, locale()),
    ),
  );
  /** 원격 호스트의 Codex 기록에 한도가 없다 */
  const remoteEmpty = $derived(host !== null && remote !== null && cards.length > 0 && cards.every((c) => c.empty));
  /** 에이전트를 모두 껐다(설정 › AI 에이전트) — 카드 자리에 한 줄 */
  const allOff = $derived(allAgentsDisabled(settings.disabledAgents));

  // [새로고침] 아이콘 — 읽는 동안 돌고, 빨리 끝나도 한 바퀴는 채운 뒤 바퀴 끝에서 멈춘다(`onanimationiteration`)
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

  /* 움직임을 줄여 달라고 한 사람에게는 돌리지 않는다 — 돌지 않으니 바퀴 끝 이벤트도 없어 흐림은 `aria-busy` 를 따른다 */
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
    /* 카드가 한 줄을 나눠 갖는다 — auto-fit 이라 둘이면 반씩(빈 열이 남지 않는다), 좁으면 한 장씩 */
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

  /* 묵은 값 — 경고색 글자(막대는 흐려진다) */
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

  /* MD3 막대 게이지(2026-10-18): 8px · 채움 primary · 나머지 트랙 secondaryContainer · 사이 2px 틈(트랙은 `::after` 가 남는 폭을 채운다). 80% 경고색 · 95% 오류색 */
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

  /* 초기화가 지난 창 — "낡음". 흐린 줄(.dim) 안에서도 읽히게 경고색 기울임 */
  .reset.stale {
    color: var(--warn);
    font-style: italic;
  }
</style>
