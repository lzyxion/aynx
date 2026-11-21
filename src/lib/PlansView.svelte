<script lang="ts">
  import { untrack } from "svelte";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";
  import { plansView, setPlansView, takePlansRequest, plansRequestPending, type OpsView } from "$lib/app/plans.svelte.js";
  import { windowTargetLookup } from "$lib/console/window-rows";
  import RunHistory from "$lib/console/RunHistory.svelte";
  import { clearHistoryView, hideRuns, openRunInHistory } from "$lib/app/run-history.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { ExitSide } from "$lib/dock-alert-exit";
  import PlanList from "$lib/console/PlanList.svelte";
  import { OPERATION_POLL_MS, OpsController } from "$lib/console/ops-controller.svelte";
  import { listen, type UnlistenFn } from "./ipc";
  import type { OperationProgress, OperationStateEvent } from "$lib/operations";
  import { setHumanConfirming } from "$lib/app/auto-approve.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  // 승인은 진행 보기의 카드에서만 눌리고 Tauri 명령이다 — MCP 는 여기 닿지 않는다.
  // 폴링 · 진행 이벤트 구독 · 경과 시계는 `visible` 일 때만 돈다 — 닫힌 독 안에 마운트된 채 백그라운드 왕복을 남기지 않는다.

  let {
    visible = true,
    phone = false,
    exitSide = "right",
  }: {
    visible?: boolean;
    phone?: boolean;
    exitSide?: ExitSide;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);

  const opsView = $derived(plansView());

  const OPS_VIEWS: readonly { id: OpsView; key: Key; title: Key }[] = [
    { id: "list", key: "board.view.list", title: "board.view.list.title" },
    { id: "history", key: "board.view.history", title: "board.view.history.title" },
  ];

  const ops = new OpsController();

  let historyCount = $state(0);
  let historyFiltered = $state(false);
  let historyShownIds = $state<string[]>([]);

  /** 기록 보기의 지우기는 화면에서만이다 — 감사 파일은 그대로 */
  const isHistory = $derived(opsView === "history");
  const clearCount = $derived(isHistory ? historyCount : ops.finishedCount);
  const clearKey = $derived(
    isHistory ? (historyFiltered ? "board.history.clearShown" : "board.history.clear") : "board.exec.dismissFinished",
  );
  const clearLabel = $derived(t(clearKey));
  const countKey = $derived(
    isHistory ? (historyFiltered ? "board.foot.historyShown" : "board.foot.history") : "board.foot.finished",
  );
  function clearView(): void {
    if (!isHistory) ops.dismissFinished();
    else if (historyFiltered) hideRuns(historyShownIds);
    else clearHistoryView();
  }
  $effect(() => {
    ops.exitSide = exitSide;
  });


  const ELAPSED_TICK_MS = 30_000;
  let now = $state(Date.now());

  // 자동 승인(`app/auto-approve.svelte.ts`)이 사람이 확인 중인 위험 카드를 가로채면 안 된다.
  $effect(() => {
    setHumanConfirming(ops.confirming);
    return () => setHumanConfirming(null);
  });

  $effect(() => {
    if (!visible) return;
    void ops.refresh();
    const id = setInterval(() => void ops.refresh(), OPERATION_POLL_MS);
    return () => clearInterval(id);
  });

  const targetLookup = $derived.by<Map<string, { code: string; label: string }>>(() => windowTargetLookup(t));

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

  $effect(() => {
    if (!visible) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(id);
  });

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

  // ── 딥링크 ──

  let spotlight = $state<{ id: string; until: number; seq: number } | null>(null);
  let pulsing = $state<string | null>(null);
  /** 폴링 한 바퀴(`OPERATION_POLL_MS`)에 여유를 더한 값 */
  const SPOTLIGHT_WAIT_MS = 6000;
  const PULSE_MS = 1200;

  // 타일이 이미 떠 있을 때 온 부탁도 받도록 남은 요청(`plansRequestPending`)을 읽어 둔다.
  $effect(() => {
    void plansRequestPending();
    if (!visible) return;
    const id = untrack(() => takePlansRequest());
    if (id === null) return;
    spotlight = { id, until: Date.now() + SPOTLIGHT_WAIT_MS, seq: untrack(() => ops.refreshSeq) };
  });

  /** `operations` 를 읽어 두는 것이 요점이다 — [검토]를 누른 그 프레임에는 카드가 아직 DOM 에 없다 */
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

<div class="plans" class:phone bind:this={panelEl} data-plans-view data-view={opsView}>
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

    <!-- 색 하나로만 말하지 않게 문구가 늘 함께 있다 -->
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

  <!-- `tabindex="-1"` — 검토 대기 카드가 없을 때 채팅 독의 키보드 첫 자리 -->
  <div class="body" data-view={opsView} data-plans-body tabindex="-1">
    {#if opsView === "history"}
      <RunHistory live={(id) => targetLookup.get(id)?.label ?? null} {exitSide}
        bind:count={historyCount}
        bind:filtered={historyFiltered}
        bind:shownIds={historyShownIds}
      />
    {:else}
      <PlanList {ops} {targetLookup} {now} {pulsing} />
    {/if}
  </div>

  <div class="foot" data-plans-foot={opsView}>
    <span class="hint" data-plans-clear-count={clearCount}
      >{t(countKey, { n: clearCount })}</span
    >
    <button
      type="button"
      class="foot-btn"
      data-plans-clear={opsView}
      disabled={clearCount === 0}
      title={clearLabel}
      aria-label={clearLabel}
      onclick={clearView}><UiIcon name="trash" size={16} /><span class="label">{clearLabel}</span></button
    >
  </div>
</div>

<style>
  /* 바탕은 칠하지 않는다 — 여기서 또 칠하면 감싸는 독의 글래스가 두 겹이 된다 */
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

  /* 런처 독 알림 칸의 바닥 줄(`Dock.svelte` 의 `.foot` · `.foot-btn.icon`)과 같은 높이 · 글자 · 알약 */
  .foot {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    box-sizing: border-box;
    height: 48px;
    padding: 0 var(--space-3) 0 var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--control-fg);
    white-space: nowrap;
    overflow: hidden;
    background: var(--glass-inner, transparent);
    container: plans-foot / inline-size;
  }
  .foot .hint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .foot-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 32px;
    margin-left: auto;
    padding: 0 var(--space-4) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .foot-btn:hover:not(:disabled) {
    background: var(--control-sel-bg-hover);
  }
  .foot-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .foot-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  @container plans-foot (max-width: 240px) {
    .foot-btn {
      width: 32px;
      padding: 0;
      justify-content: center;
    }
    .foot-btn .label {
      display: none;
    }
  }
  .plans.phone .foot-btn {
    height: 44px;
  }

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

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-1) var(--space-4) var(--space-4);
  }

  /* 키보드 첫 자리로 받아도 고리 없이 스크롤만 받는다 */
  .body:focus {
    outline: none;
  }

  .body > :global(*) {
    max-width: 1080px;
    margin-inline: auto;
  }

  /* 폰 — 카드의 공유 조각은 바꾸지 않고 이 판의 스코프에서만 */
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
