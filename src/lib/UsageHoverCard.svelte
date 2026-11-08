<script lang="ts">
  /**
   * **사용량 호버 카드** — 상태바 사용 한도 고리에 얹으면(또는 키보드로 닿으면) 뜨는 막대 카드
   * (docs/log/2026-09-28-usage-hover-bars.md).
   *
   * 예전에는 고리의 `title` 한 줄("5시간 48% (2시간 10분 뒤 초기화) · 7일 83% (…) — Claude Code · …")이 전부였다 —
   * 한눈에 읽히지 않았다. 여기는 대시보드 사용 한도 카드(`console/UsageLimits.svelte`)의 **축소판**이다:
   * 머리(로고 · 이름 · "12분 전 기준") 아래 창마다 한 줄(라벨 · 막대 · % · 초기화 글자). 같은 줄 데이터(`limitCard`)를
   * 쓰고 같은 말을 한다 — 회색 막대 · 80% 경고색 · 95% 오류색(강조색은 쓰지 않는다) · 지난 창과 묵은 값은 흐리게 ·
   * 초기화가 지났으면 "낡음"(경고색 기울임).
   *
   * ## 흐른 몫 눈금
   *
   * 막대 위의 가는 세로 선 하나가 **창이 얼마나 흘렀나**다(`windowElapsed`). 채움이 눈금을 넘어 있으면 창이 끝나기
   * 전에 한도에 닿는 속도다. 새 색은 없다 — 본문 글자색 선 하나로 조용히 말한다. 기록(시계열)을 쌓지 않으므로
   * "시간에 따른 선 그래프" 는 없다 — 지금 값 둘(사용 % · 남은 시간)로 보이는 속도가 이 눈금이다.
   *
   * ## 자리 · 층
   *
   * `position: fixed` 로 상태바 띠 **밖**(`StatusBar` 의 최상위, 알림 상자·셸 메뉴와 같은 자리)에 선다 — 띠의 좁은 상자에
   * 잘리지 않는다. (`document.body` 로 옮기는 포털은 쓰지 않는다 — Svelte 5 는 블록을 걷을 때 제 노드 줄을 형제로
   * 따라가며 지우므로, 옮긴 노드는 엉뚱한 형제를 끌고 갈 수 있다.) 두 걸음 — 투명하게 그려 재고,
   * 자리를 잡은 뒤 보인다(`Tooltip.svelte` 와 같은 방식). 판 · 자리 계산 · 몸짓 · 재질은 공용 틀 `HoverCard.svelte`(2026-10-11). 가로 띠는 `placeTooltip`(아래가 기본, 모자라면 위 — 띠가
   * 아래 가장자리면 저절로 위로 선다), 세로 기둥은 `placeBeside`(왼쪽 기둥이면 오른쪽에, 오른쪽 기둥이면 왼쪽에).
   *
   * `aria-hidden` — 순수한 시각 층이다. 접근성 이름은 고리 단추의 `aria-label`(한 줄 글자)이 그대로 쥔다.
   * 커서를 먹지 않는다(`pointer-events: none`) — 먹으면 고리에서 `pointerleave` 가 나 카드가 깜빡인다.
   */
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { barWidth, type UsageRing } from "$lib/agent-usage";
  import HoverCard from "$lib/HoverCard.svelte";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ring,
    anchor,
    side,
  }: {
    ring: UsageRing;
    /** 고리 단추의 상자(뷰포트 좌표) */
    anchor: TooltipRect;
    /** 가로 띠면 `"vertical"`(위·아래 — `placeTooltip`), 세로 기둥이면 카드가 설 쪽 */
    side: "vertical" | "left" | "right";
  } = $props();
</script>

<HoverCard {anchor} {side} watch={ring} minWidth={280} maxWidth={440} data-usage-card-hover={ring.agent}>
  <div class="u-head">
    <span class="u-logo"><HostIcon icon={iconRef(ring.agent)} size={14} /></span>
    <span class="u-name">{ring.name}</span>
    {#if !ring.card.empty}
      <span class="u-measured" class:stale={ring.card.stale}>{ring.card.measured}</span>
    {/if}
  </div>
  {#if ring.card.empty}
    <p class="u-none">{t("app.statusbar.usage.card.none")}</p>
  {:else}
    <div class="u-rows">
      {#each ring.card.rows as r (r.key)}
        <div class="u-row" class:dim={r.dim} data-level={r.level}>
          <span class="u-label">{r.label}</span>
          <span class="u-bar">
            <span class="u-track"><span class="u-fill {r.level}" style:width="{barWidth(r.pct)}%"></span></span>
            {#if r.elapsed !== null}
              <!-- 흐른 몫 눈금 — 채움이 이 선을 넘었으면 창이 끝나기 전에 한도에 닿는 속도다 -->
              <span class="u-tick" data-elapsed={r.elapsed.toFixed(3)} style:left="{r.elapsed * 100}%"></span>
            {/if}
          </span>
          <span class="u-pct {r.level}">{r.pctText}</span>
          <span class="u-reset" class:stale={r.resetStale}>{r.reset}</span>
        </div>
      {/each}
    </div>
  {/if}
</HoverCard>

<style>
  .u-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .u-logo {
    flex: 0 0 auto;
    display: inline-flex;
    line-height: 0;
  }
  .u-name {
    flex: 1;
    min-width: 0;
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .u-measured {
    flex: 0 0 auto;
    padding-left: var(--space-3);
    color: var(--fg-3);
    white-space: nowrap;
  }
  /* 묵은 값 — 경고색 글자(줄은 흐려진다) */
  .u-measured.stale {
    color: var(--warn);
  }

  .u-none {
    margin: 0;
    color: var(--fg-3);
  }

  .u-rows {
    display: grid;
    /* 고정 열 — 창마다 막대가 같은 길이로 선다(대시보드 카드와 같은 판단) */
    grid-template-columns: auto 120px auto auto;
    align-items: center;
    column-gap: var(--space-2);
    row-gap: 4px;
  }
  /* 줄은 격자를 나눠 쓰는 겉옷일 뿐이다 — 칸은 부모 격자에 선다 */
  .u-row {
    display: contents;
  }
  .u-row.dim > * {
    opacity: 0.5;
  }
  .u-label {
    color: var(--fg-2);
    white-space: nowrap;
  }

  /* 막대 — 대시보드와 같은 8px MD3 게이지. 눈금이 트랙 위아래로 조금 삐져나오게 겉 상자는 자르지 않는다 */
  .u-bar {
    position: relative;
    height: 12px;
    display: flex;
    align-items: center;
  }
  /* MD3 막대 게이지(2026-10-18): 8px · 채움 primary · 나머지 트랙 secondaryContainer · 사이 2px 틈(트랙은 `::after` 가 남는 폭을 채운다). 80% 경고색 · 95% 오류색 */
  .u-track {
    display: flex;
    gap: 2px;
    width: 100%;
    height: 8px;
  }
  .u-track::after {
    flex: 1 1 0;
    content: "";
    border-radius: 4px;
    background: var(--control-track);
  }
  .u-fill {
    display: block;
    flex: none;
    height: 100%;
    border-radius: 4px;
    background: var(--control-on-bg);
  }
  .u-fill.warn {
    background: var(--warn);
  }
  .u-fill.err {
    background: var(--err);
  }
  /* 흐른 몫 눈금 — 본문 글자색 가는 선. 새 색을 들이지 않는다 */
  .u-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--fg-1);
  }

  .u-pct {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--fg-1);
  }
  .u-pct.warn {
    color: var(--warn);
  }
  .u-pct.err {
    color: var(--err);
  }
  .u-reset {
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* 초기화가 지난 창 — "낡음". 흐린 줄 안에서도 읽히게 경고색 기울임 */
  .u-reset.stale {
    color: var(--warn);
    font-style: italic;
  }
</style>
