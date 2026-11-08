<script lang="ts">
  import { untrack } from "svelte";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";
  import { plansView, setPlansView, takePlansRequest, plansRequestPending, type OpsView } from "$lib/app/plans.svelte.js";
  import { windowTargetLookup } from "$lib/console/window-rows";
  import RunHistory from "$lib/console/RunHistory.svelte";
  import { openRunInHistory } from "$lib/app/run-history.svelte.js";
  import PlanList from "$lib/console/PlanList.svelte";
  import { OPERATION_POLL_MS, OpsController } from "$lib/console/ops-controller.svelte";
  import { listen, type UnlistenFn } from "./ipc";
  import type { OperationProgress, OperationStateEvent } from "$lib/operations";
  import { setHumanConfirming } from "$lib/app/auto-approve.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  // ---------------------------------------------------------------------------
  // **작업안의 몸통** — 2026-10-07 전체 화면 대시보드의 작업안 칸 → 작업안 타일(`kind:"plans"`) → 2026-10-25 **채팅 독의 작업안 갈래**
  // (`ChatDock.svelte`). 원격 창에서는 제 덮개 안에서 그린다(데스크톱 폭 `PlansCover.svelte` · 폰 `mobile/MobilePlans.svelte`).
  // 앞선 판: docs/log/2026-09-25-dashboard.md · docs/log/2026-09-09-management-view.md · docs/log/2026-10-25-plans-tile-refresh.md.
  //
  // AI 가 저장한 작업안의 검토 · 승인 · 실행 결과를 보기 둘(진행 · 기록)로 그린다. 승인은 진행 보기의
  // 카드에서만 눌리고 Tauri 명령이다(MCP 는 여기 닿지 않는다). 보기의 그림은 `console/` 의 `PlanList`(+
  // `ExecList`) · `RunHistory`, 상태 · 손잡이는 `console/ops-controller.svelte.ts` 다.
  // 이 파일이 쥐는 것은 **배선**이다: 보기 단추 · 폴링 · 이벤트 구독 · 딥링크(spotlight · 맥박) · 감사 알약.
  // 보기와 딥링크 칸은 창마다 하나인 모듈(`app/plans.svelte.ts`)에 산다.
  //
  // 비교(타일들의 마지막 명령 결과) · 행렬(호스트 × 작업안) 보기는 2026-10-25 에 걷었다 — 비교는 작업안이 아니었고,
  // "어느 호스트만 튀었나" 는 기록 상세의 대상별 표(실패 먼저)와 호스트 · 결과 거르기가 답한다
  // (docs/log/2026-10-25-plans-tile-refresh.md).
  //
  // **보일 때만 돈다** — 폴링 · 진행 이벤트 구독 · 경과 시계는 `visible`(독이 열려 있고 작업안 갈래다 · 덮개가 떠 있다)일 때만이다.
  // 닫힌 독 안에 마운트된 채 백그라운드 왕복을 남기지 않는다(대시보드가 "열려 있는 동안만" 돌던 규칙 그대로).
  //
  // 좁은 폭(독 기본 380px)이 기본이다 — 진행 카드 · 기록의 한 줄 목록(고른 줄이 그 자리에서 펼쳐진다)이 그 폭에 맞춰 선다.
  // 바탕은 칠하지 않는다 — 감싸는 판(독 · 덮개)이 칠한다. `phone` 이면 보기 탭이 넓은 두 칸 · 거절 · 승인 단추가 터치 크기(44)다.
  // ---------------------------------------------------------------------------

  let { visible = true, phone = false }: { visible?: boolean; phone?: boolean } = $props();

  let panelEl = $state<HTMLElement | null>(null);

  const opsView = $derived(plansView());

  /**
   * 보기 단추 — 진행 · 기록. 진행(`list`)은 검토 대기와 지금·최근 실행(메모리),
   * 기록은 감사 로그의 장부(앱을 다시 켜도 남는다 · docs/log/2026-09-28-run-history.md).
   */
  const OPS_VIEWS: readonly { id: OpsView; key: Key; title: Key }[] = [
    { id: "list", key: "board.view.list", title: "board.view.list.title" },
    { id: "history", key: "board.view.history", title: "board.view.history.title" },
  ];

  /** 작업안 · 실행 관리의 상태와 손잡이 — 이 타일과 수명이 같다 */
  const ops = new OpsController();

  /** 경과 시계 — 30 초마다 한 칸, 보일 때만 돈다(진행 보기 카드의 "N분 전 · 만료까지") */
  const ELAPSED_TICK_MS = 30_000;
  let now = $state(Date.now());

  // **사람이 확인 중인 카드를 알린다** — 자동 승인(`app/auto-approve.svelte.ts`)이 사람이 확인 상태로 둔 위험 카드를 가로채면 안 된다.
  $effect(() => {
    setHumanConfirming(ops.confirming);
    return () => setHumanConfirming(null);
  });

  // 보일 때만 폴링한다(가려지면 멈춘다 — 백그라운드 왕복을 남기지 않는다).
  $effect(() => {
    if (!visible) return;
    void ops.refresh();
    const id = setInterval(() => void ops.refresh(), OPERATION_POLL_MS);
    return () => clearInterval(id);
  });

  /**
   * 대상 id(streamId) → 표시용 {code, label}. 이 창의 세션 타일에서 만든다 — 못 찾으면 카드가 raw id 를 그대로
   * 보여 준다(다른 창의 세션일 수 있다). 화면 아래 검토 카드가 같은 표를 쓴다(docs/log/2026-09-27-review-popup-card.md).
   */
  const targetLookup = $derived.by<Map<string, { code: string; label: string }>>(() => windowTargetLookup(t));

  // 보일 때만 진행 이벤트를 구독한다(가려지면 뗀다). 받은 값은 컨트롤러가 실행 뷰에 싣는다.
  $effect(() => {
    if (!visible) return;
    let offP: UnlistenFn | null = null;
    let offS: UnlistenFn | null = null;
    let dead = false;
    void listen<OperationProgress>("operation-progress", (ev) => ops.onProgress(ev.payload))
      .then((fn) => (dead ? fn() : (offP = fn)))
      .catch(() => {});
    void listen<OperationStateEvent>("operation-state", (ev) => ops.onOpState(ev.payload))
      .then((fn) => (dead ? fn() : (offS = fn)))
      .catch(() => {});
    return () => {
      dead = true;
      offP?.();
      offS?.();
    };
  });

  // 경과 시계 — 보일 때만 돈다.
  $effect(() => {
    if (!visible) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(id);
  });

  /** 감사 알약의 title — 전체 문구(상태 · 기록 수 · 실패) + 쌓이는 폴더 */
  const auditTitle = $derived.by<string>(() => {
    const a = ops.audit;
    if (!a) return "";
    const summary = t("board.audit.summary", {
      state: a.running ? t("board.audit.on") : t("board.audit.off"),
      written: a.written,
    });
    const failed = a.failed > 0 ? t("board.audit.failed", { n: a.failed }) : "";
    return `${summary}${failed}\n${a.dir ?? t("board.audit.nodir")}`;
  });

  // ---------------------------------------------------------------------------
  // **딥링크** — 검토 대기 카드의 [작업안에서 보기] · 알림 센터의 "승인 대기" · 결과 알림의 [결과 보기]가 "이 작업안으로
  // 데려가 달라" 를 남긴다 (docs/log/2026-09-22-review-card.md · 칸은 `app/plans.svelte.ts` 의 take-once 슬롯).
  // ---------------------------------------------------------------------------

  /** 데려갈 작업안 + 포기 시각 — 목록이 오기를 기다리는 동안만 산다 */
  let spotlight = $state<{ id: string; until: number; seq: number } | null>(null);
  /** 지금 맥박이 뛰는 카드 — 1.2초 뒤 스스로 꺼진다 */
  let pulsing = $state<string | null>(null);
  /** 목록이 오기를 기다려 주는 시간 — 폴링 한 바퀴(2초)에 여유를 더한 값 */
  const SPOTLIGHT_WAIT_MS = 6000;
  const PULSE_MS = 1200;

  // 부탁을 **가져온다**(한 번만). 보기는 `openPlansAt` 이 이미 진행으로 돌렸고, 여기 남은 것은 데려갈 작업안뿐이다.
  // 타일이 이미 떠 있을 때 온 부탁도 받도록 남은 요청(`plansRequestPending`)을 읽어 둔다.
  $effect(() => {
    void plansRequestPending();
    if (!visible) return;
    const id = untrack(() => takePlansRequest());
    if (id === null) return;
    spotlight = { id, until: Date.now() + SPOTLIGHT_WAIT_MS, seq: untrack(() => ops.refreshSeq) };
  });

  /**
   * 목록이 그려진 **뒤에** 그 카드로 스크롤하고 잠깐 맥박을 준다.
   *
   * `operations` 를 읽어 두는 것이 요점이다 — 타일은 폴링으로 목록을 채우므로 [검토]를 누른 그 프레임에는 카드가
   * 아직 DOM 에 없다. 이 효과는 목록이 도착한 프레임에 다시 돌고, 그때 요소를 찾는다. 못 찾은 채 시간이 지나면(이미
   * 거절·만료된 작업안) 조용히 포기한다.
   *
   * **메모리에 없는 실행은 기록으로** (docs/log/2026-09-28-run-history.md) — 폴링이 요청 **뒤로 한 바퀴** 돈 뒤에도
   * 그 id 가 검토 대기에도 실행 뷰에도 없으면 기록 보기의 그 실행으로 넘긴다(감사 로그에는 남아 있다).
   */
  $effect(() => {
    const want = spotlight;
    if (want === null) return;
    void ops.operations.length; // 목록이 바뀌면 다시 돈다 (의존성 등록)
    const polled = ops.refreshSeq > want.seq;
    if (Date.now() > want.until) {
      spotlight = null;
      return;
    }
    if (opsView !== "list") return;
    const el = panelEl?.querySelector(`[data-operation-id="${CSS.escape(want.id)}"]`);
    if (!(el instanceof HTMLElement)) {
      if (polled && !(want.id in ops.executions) && !ops.operations.some((o) => o.operationId === want.id)) {
        spotlight = null;
        openRunInHistory(want.id);
      }
      return;
    }
    spotlight = null;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
    pulsing = want.id;
    const timer = setTimeout(() => (pulsing = null), PULSE_MS);
    return () => clearTimeout(timer);
  });
</script>

<!--
  `data-plans-view` — 하네스 · 사람이 찾는 표식. 키보드 몸은 타일 상자(`.pane-body` 의 `[data-tile-focus]`)다.
-->
<div class="plans" class:phone bind:this={panelEl} data-plans-view data-view={opsView}>
  <!--
    머리 줄 — 왼쪽은 보기 전환 알약 묶음(진행 · 기록 — 진행의 배지는 검토 대기 수), 오른쪽 끝은 감사 알약.
  -->
  <div class="ops-head">
    <div class="seg view-seg" role="group" aria-label={t("board.view.aria")}>
      {#each OPS_VIEWS as v (v.id)}
        <button
          type="button"
          class="seg-btn"
          class:on={opsView === v.id}
          aria-pressed={opsView === v.id}
          data-ops-view={v.id}
          title={t(v.title)}
          onclick={() => setPlansView(v.id)}
          >{t(v.key)}{#if v.id === "list" && ops.pendingCount > 0}<span class="seg-badge">{ops.pendingCount}</span
            >{/if}</button
        >
      {/each}
    </div>

    <!--
      감사 알약 — "중앙 감독" 의 기록이 실제로 도는지 사용자가 볼 수 있게(옛 바닥 띠를 2026-10-25 에 머리 줄로 옮겼다).
      색 하나로만 말하지 않게 문구가 늘 함께 있다("감사 N" · "감사 꺼짐" · "· 실패 M") — 꺼짐 · 실패면 점 대신 M3 error 글리프(`ErrorGlyph` 10px)다.
      전체 문구와 폴더는 title 로 — 어디에 쌓이는지 보인다.
    -->
    {#if ops.audit}
      {@const bad = !ops.audit.running || ops.audit.failed > 0}
      <span class="audit" class:bad data-audit-pill title={auditTitle}>
        {#if bad}<ErrorGlyph size={10} data-audit-bad aria-hidden="true" />{:else}<span class="audit-dot ok" aria-hidden="true"></span>{/if}
        <span class="audit-text"
          >{ops.audit.running
            ? t("board.audit.pill", { n: ops.audit.written })
            : t("board.audit.pill.off")}{#if ops.audit.failed > 0}{t("board.audit.failed", {
              n: ops.audit.failed,
            })}{/if}</span
        >
      </span>
    {/if}
  </div>

  <div class="body" data-view={opsView}>
    {#if opsView === "history"}
      <!-- 기록 보기 — 감사 로그의 장부. 이름은 감사 스냅샷이 먼저, 그다음 이 창의 타일 표(`targetLookup`). -->
      <RunHistory live={(id) => targetLookup.get(id)?.label ?? null} />
    {:else}
      <!--
        진행(목록) 보기 — 검토 대기 카드 + 실행 묶음 (`console/PlanList.svelte`). 승인은 확인 한 단계(위험 명령은
        두 단계)를 지나야 하고 Tauri 명령이다(`ops-controller` 의 `doApprove`).
      -->
      <PlanList {ops} {targetLookup} {now} {pulsing} />
    {/if}
  </div>
</div>

<style>
  /*
   * 감싸는 판(채팅 독 · 원격 덮개)을 채운다 — 머리 줄(보기 알약 · 감사 알약) · 본문(세로 스크롤). 바탕은 감싸는 판의 것
   * (여기서 또 칠하면 독의 글래스가 두 겹이 된다).
   */
  .plans {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  /* 머리 줄 — 보기 알약 묶음(왼쪽) · 감사 알약(오른쪽 끝) */
  .ops-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: var(--space-1) var(--space-4) var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
  }

  /*
   * 보기 전환 — End-4 식 알약 세그먼트(2026-10-25): 낮은 면(surfaceContainerLow) 알약 안에 28px 알약 단추,
   * 고른 것 = `--control-sel-*`(secondaryContainer — 독 칸 지시자 · 고른 칩과 같은 역할, theme.css 의 컨트롤 색 블록).
   */
  .seg {
    flex: 0 0 auto;
    display: inline-flex;
    gap: var(--space-1);
    padding: 3px;
    background: var(--m3-surface-container-low);
    border-radius: 999px;
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-weight: 500;
    line-height: 1;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color 120ms ease,
      color 120ms ease;
  }

  .seg-btn:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .seg-btn.on {
    font-weight: var(--fw-semibold);
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .seg-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 진행 단추의 대기 수 — 강조색 채움(입력 대기 = 강조색이 서는 자리) */
  .seg-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    box-sizing: border-box;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--on-accent);
    background: var(--accent);
    border-radius: 999px;
  }

  /* 감사 알약 — 오른쪽 끝의 조용한 알약. 12px 흐린 글자 + 의미색 점(도는 중 = 초록 동그라미, 꺼짐·실패 = 실패색 네모). */
  .audit {
    flex: 0 1 auto;
    min-width: 0;
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 10px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border-radius: 999px;
    white-space: nowrap;
  }

  .audit.bad {
    color: var(--err);
  }

  .audit-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .audit-dot.ok {
    background: var(--ok);
  }


  .audit-text {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 본문 — 세로로 스크롤한다. 넓은 타일에서는 1080px 에서 멈추고 가운데 선다(대시보드 시절의 열 폭). */
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-1) var(--space-4) var(--space-4);
  }

  .body > :global(*) {
    max-width: 1080px;
    margin-inline: auto;
  }

  /*
   * 폰(원격 R5 — `mobile/MobilePlans.svelte`) — 보기 탭은 화면 폭 두 칸(높이 40) · 감사 알약은 그 위 줄 오른쪽 · 거절 · 승인은
   * 터치 크기(높이 44 · 반반). 카드의 조각은 그대로다(공유 조각을 바꾸지 않고 이 판의 스코프에서만).
   */
  .plans.phone .ops-head {
    flex-wrap: wrap;
    overflow: visible;
  }

  .plans.phone .seg {
    order: 2;
    flex: 1 1 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 4px;
  }

  .plans.phone .seg-btn {
    justify-content: center;
    height: 40px;
    font-size: var(--t-md);
  }

  .plans.phone .audit {
    order: 1;
  }

  .plans.phone :global(.obtns) {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
  }

  .plans.phone :global(.obtns .btn) {
    height: 44px;
    font-size: var(--t-md);
  }

  .plans.phone .body {
    padding-inline: var(--space-3);
  }
</style>
