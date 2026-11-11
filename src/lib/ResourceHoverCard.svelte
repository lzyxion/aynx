<script lang="ts">
  /**
   * **자원 호버 카드** (2026-10-17) — 상태바의 CPU · 메모리 고리에 얹으면(또는 키보드로 닿으면) 뜨는 카드. 사용량 카드
   * (`UsageHoverCard`) · 옛 작업안 칸 카드(`RunningHoverCard` — 2026-10-18 걷음)와 같은 틀(`HoverCard` — 자리 · 층 · 재질 · 몸짓)이고 내용만 다르다.
   *
   * 위에서 아래로(목업 resource-statusbar-mock):
   * 1. 큰 숫자 + "CPU · 이 PC 전체"(메모리는 오른쪽에 `9.8 / 16 GB` — 논리 CPU 수는 응답에 없어 CPU 쪽은 비운다)
   * 2. 최근 5분 선 — 작은 SVG(`sparkline` — `at` 시간축 · 틈에서 끊김 · 80% 점선 기준선 · 끝점 강조). 색은 테마 토큰:
   *    CPU `--accent` · 메모리 `--chip-branch`(목업의 두 색). 고리 자신은 강조색을 쓰지 않는다 — 여기는 그림이라 색 하나씩.
   * 3. 앱(GUI + 세션 서버) · 타일 — 자원 화면 띠와 같은 셋(위의 큰 숫자가 PC 전체) · 같은 차례(10-27 사용자: "PC 전체 · 앱 · 타일" —
   *    "그 밖"(전체 − 몫) · "Aynx 몫/앱 전체" 는 걷음)
   * 4. 많이 쓰는 셋 — 타일(이름은 자원 화면 · 칩과 같은 `localTileInfo` — 폭이 좁아 타일 이름 글자 대신 `PaneIcon` 로고 + 탭 제목,
   *    로고의 접근성 이름 = 타일 이름) · 그 지표 1위 프로세스 이름, 앱 자신 줄 포함, 값 + 몫 대비 막대
   * 5. 바닥 줄 — "누르면 자원 화면" · 표본 간격
   *
   * 값은 저장소(`app/resources.svelte.ts`)에서 직접 읽는다 — 상태바가 고리를 세우는 동안 그 저장소의 보는 쪽이다(알림 상자가 앱
   * 모듈에서 직접 읽는 것과 같은 모양). 계산은 순수 `resource-status.ts`.
   *
   * `aria-hidden` · 커서를 먹지 않음 — 틀의 규칙(접근성 이름은 고리 단추의 `aria-label`).
   */
  import HoverCard from "$lib/HoverCard.svelte";
  import { resourceInterval, resourceRing, resourceTop } from "$lib/app/resources.svelte.js";
  import { localTileInfo } from "$lib/console/resource-tiles";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { appUsage, formatCpu, formatMem, tilesUsage } from "$lib/resources";
  import {
    formatMemPair,
    lastSystemSample,
    sparkline,
    systemPct,
    topConsumers,
    type ResourceMetric,
  } from "$lib/resource-status";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    metric,
    anchor,
    side,
  }: {
    metric: ResourceMetric;
    /** 고리 단추의 상자(뷰포트 좌표) */
    anchor: TooltipRect;
    /** 가로 띠면 `"vertical"`(위·아래), 세로 기둥이면 카드가 설 쪽 */
    side: "vertical" | "left" | "right";
  } = $props();

  const SPARK_W = 240;
  const SPARK_H = 38;

  const ring = $derived(resourceRing());
  const last = $derived(lastSystemSample(ring));
  const pct = $derived(last ? systemPct(last.system, metric) : null);
  const spark = $derived(sparkline(ring, metric, { w: SPARK_W, h: SPARK_H }));
  const fmt = (v: number) => (metric === "cpu" ? formatCpu(v) : formatMem(v));
  const rows = $derived(last ? topConsumers(last, resourceTop(), metric) : []);
  const tiles = $derived(localTileInfo());
  const every = $derived(Math.max(1, Math.round(resourceInterval() / 1000)));

  function nameOf(key: string): string {
    if (key === "@app") return t("app.statusbar.resources.card.app");
    const info = tiles.get(key);
    // 이 창의 타일 — 타일 이름(`Claude` · `PowerShell 7` …)은 앞의 로고가 말하므로 탭 제목만 글자로(같으면 타일 이름 그대로)
    return info ? (info.place ?? info.paneName) : t("board.resources.otherTile");
  }
</script>

{#if last && pct !== null}
  <!-- 폭 고정(최소 = 최대) — 값이 2초마다 바뀌어 카드 폭이 따라 출렁이면 글래스 흐림 판(`::before`)이 옛 폭에 남아 오른쪽 가장자리
       빛이 잘려 보였다(10-17 실기). 긴 타일 이름은 줄마다 말줄임이 맡는다. -->
  <HoverCard {anchor} {side} watch={rows} minWidth={296} maxWidth={296} gap="10px" data-resource-card-hover={metric}>
    <div class="r-head">
      <span class="r-big">{Math.round(pct)}%</span>
      <span class="r-sub"
        >{metric === "cpu" ? t("app.statusbar.resources.card.cpu") : t("app.statusbar.resources.card.mem")}</span
      >
      <span class="r-fill"></span>
      {#if metric === "mem"}<span class="r-sub r-pair">{formatMemPair(last.system.memUsed, last.system.memTotal)}</span>{/if}
    </div>

    <div class="r-spark-box">
      <svg
        class="r-spark"
        class:mem={metric === "mem"}
        viewBox="0 0 {SPARK_W} {SPARK_H}"
        preserveAspectRatio="none"
        width="100%"
        height={SPARK_H}
      >
        <line class="r-ref" x1="0" y1={spark.refY} x2={SPARK_W} y2={spark.refY} />
        {#if spark.area}<path class="r-area" d={spark.area} />{/if}
        {#if spark.line}<path class="r-line" d={spark.line} />{/if}
        {#if spark.last}<circle class="r-dot" cx={spark.last.x} cy={spark.last.y} r="2.6" />{/if}
      </svg>
      <div class="r-axis"><span>{t("app.statusbar.resources.card.ago")}</span><span>{t("app.statusbar.resources.card.now")}</span></div>
    </div>

    <div class="r-split">
      <span>{t("app.statusbar.resources.card.appShort")} <b>{fmt(appUsage(last)[metric])}</b></span>
      <span>{t("app.statusbar.resources.card.tiles")} <b>{fmt(tilesUsage(last)[metric])}</b></span>
    </div>

    {#if rows.length > 0}
      <div class="r-rows">
        {#each rows as r (r.key)}
          {@const info = tiles.get(r.key)}
          <div class="r-row" data-resource-card-row={r.key}>
            <span class="r-nm"
              >{#if info}<span class="r-logo" role="img" aria-label={info.paneName} title={info.paneName}
                  ><PaneIcon pane={info.pane} size={12} /></span
                >{/if}{nameOf(r.key)}{#if r.proc}<span class="r-dim"> · </span><span class="r-proc">{r.proc}</span>{/if}</span
            >
            <span class="r-v">{fmt(r.value)}</span>
            <span class="r-bar"><i style:width="{r.frac * 100}%"></i></span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="r-ft">
      <span>{t("app.statusbar.resources.card.open")}</span>
      <span>{t("app.statusbar.resources.card.every", { n: every })}</span>
    </div>
  </HoverCard>
{/if}

<style>
  .r-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }
  .r-big {
    flex: 0 0 auto;
    font-size: 20px;
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
  }
  .r-sub {
    color: var(--fg-2);
    white-space: nowrap;
  }
  .r-fill {
    flex: 1;
  }
  .r-pair {
    font-variant-numeric: tabular-nums;
  }

  /* 최근 5분 선 — 판 위에 직접(상자 없음). 색은 테마 토큰 하나(`--spark`) */
  .r-spark {
    --spark: var(--accent);
    display: block;
    overflow: visible;
  }
  .r-spark.mem {
    --spark: var(--chip-branch);
  }
  .r-ref {
    stroke: var(--line-strong);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .r-area {
    fill: var(--spark);
    fill-opacity: 0.14;
  }
  .r-line {
    fill: none;
    stroke: var(--spark);
    stroke-width: 1.5;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .r-dot {
    fill: var(--spark);
  }
  .r-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-size: 10px;
    color: var(--fg-2);
  }

  .r-split {
    display: flex;
    gap: var(--space-3);
    color: var(--fg-2);
  }
  .r-split b {
    color: var(--fg-1);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
  }

  .r-rows {
    display: grid;
    gap: 5px;
  }
  .r-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-2);
    row-gap: 3px;
    align-items: center;
  }
  .r-nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 타일 이름 대신 서는 로고 — 글자 높이(12px)에 맞추고 위치 글자가 바로 붙는다 */
  .r-logo {
    display: inline-flex;
    vertical-align: -2px;
    margin-right: 5px;
  }
  .r-dim {
    color: var(--fg-2);
  }
  .r-proc {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--fg-2);
  }
  .r-v {
    font-variant-numeric: tabular-nums;
  }
  /* 가는 막대 — 사용량 카드와 같은 MD3 게이지(채움 primary · 트랙 secondaryContainer · 2px 틈). 줄이 촘촘한 카드라 6px.
     몫 대비라 경고색은 없다 */
  .r-bar {
    grid-column: 1 / -1;
    display: flex;
    gap: 2px;
    height: 6px;
  }
  .r-bar::after {
    flex: 1 1 0;
    content: "";
    border-radius: 3px;
    background: var(--control-track);
  }
  .r-bar i {
    display: block;
    flex: none;
    height: 100%;
    border-radius: 3px;
    background: var(--control-on-bg);
  }

  .r-ft {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
    color: var(--fg-2);
  }
</style>
