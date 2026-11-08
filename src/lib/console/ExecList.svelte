<script lang="ts">
  // 작업안 목록 보기의 **실행** 묶음 — 승인된·도는·완료된 작업안의 결과 줄(대상별 상태·종료코드) · 취소 · 지우기.
  // 겉(2026-10-25 End-4): 테두리 없는 16px 카드 · 제목 + 상태 알약(끝난 대상 n/m) · 도는 동안 얇은 진행 막대 · 같은 칸 틀의 결과 줄.
  // 상태 알약 = MD3 톤 면(2026-11-01) — 실행 중 primaryContainer + 도는 고리 · 성공 `--ok-soft` ✓ · 일부 성공 `--warn-soft` ! ·
  // 실패 `--err-soft` ✕ · 승인됨/대기 중성 면 · 취소 테두리만 · 불명 경고색 테두리만(종류 판정 `exec-rows.ts`).
  // **완료된 실행은 한 줄로 접힌다**(2026-10-27 목업 A안 EN7xk2SJqU5HqaJXgGYKoz): ▸ 제목 · 상태 · 시각 · ✕ — 누르면 그 자리에서 명령 ·
  // 결과 줄이 펼쳐진다. AI 명령이 길고 실행이 쌓이면 카드가 목록을 다 먹었다. 도는 · 승인된 실행만 큰 카드(취소 단추)다.
  // 실행 뷰 상태와 취소(Tauri 명령)는 `ops-controller` 에 있다. `PlanList` 가 `.opsview` 안에 세운다.
  import type { OperationState } from "$lib/operations";
  import ErrorGlyph from "$lib/ErrorGlyph.svelte";
  import { commandPreview } from "$lib/command-preview";
  import { EXEC_ACTIVE, TARGET_LABEL, type OpsController } from "$lib/console/ops-controller.svelte";
  import { opStateKind, targetKind, type StateKind } from "$lib/console/exec-rows";
  import { relativeTime } from "$lib/notifications";
  import UiIcon from "$lib/UiIcon.svelte";
  import { EXEC_SORTS, setExecSort, settings } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  interface Props {
    ops: OpsController;
    /** 대상 id → 이 창의 {code, label} */
    targetLookup: Map<string, { code: string; label: string }>;
    /** 패널의 30초 시계 — 접힌 줄의 "N분 전" */
    now: number;
    /** 딥링크로 지금 맥박이 뛰는 카드 id (Console 의 spotlight 효과가 쥔다) */
    pulsing: string | null;
  }
  let { ops, targetLookup, now, pulsing }: Props = $props();

  function isActive(state: OperationState): boolean {
    return EXEC_ACTIVE.has(state);
  }

  const finishedCount = $derived(ops.execList.filter((ex) => !isActive(ex.state)).length);

  /** 접힌 줄의 이름 — 제목, 없으면 명령 첫 줄, 다른 창이 시작한 실행이면 그 말 */
  function rowTitle(ex: (typeof ops.execList)[number]): string {
    if (!ex.op) return t("board.exec.external");
    return ex.op.title || commandPreview(ex.op.command, { maxLines: 1, maxChars: 80 }).text;
  }

  /** 작업안 집계 상태 → 문구 키 */
  const OP_STATE_LABEL: Partial<Record<OperationState, Key>> = {
    approved: "board.exec.state.approved",
    running: "board.exec.state.running",
    succeeded: "board.exec.state.succeeded",
    partial: "board.exec.state.partial",
    failed: "board.exec.state.failed",
    cancelled: "board.exec.state.cancelled",
  };

  /**
   * 끝난 대상 수 / 전체 — 상태 알약의 `n/m` 과 얇은 진행 막대의 재료(2026-10-25). 이미 쥔 실행 뷰만 센다(새 데이터 길 없음):
   * 전체는 작업안의 대상 수(다른 창이 시작한 실행이면 지금까지 밀려 온 대상 수), 끝남 = 대기 · 도는 중이 아닌 칸.
   */
  function progressOf(ex: (typeof ops.execList)[number]): { done: number; total: number } {
    const rows = Object.values(ex.targets);
    const total = Math.max(ex.op?.targets.length ?? 0, rows.length);
    const done = rows.filter((r) => r.state !== "pending" && r.state !== "running").length;
    return { done, total };
  }

  /** 집계 상태 배지의 글자 — 모르는 상태는 원문 그대로 보여 준다(사전에 칸이 없는 새 상태) */
  function opStateLabel(state: OperationState): string {
    const key = OP_STATE_LABEL[state];
    return key ? t(key) : state;
  }
</script>

<!-- 상태 알약 앞 그림 — 실행 중 = 도는 고리 · 성공 ✓ · 일부 성공 ! · 실패 ✕(색 하나로만 말하지 않게). 승인됨 · 취소됨 · 대기는 그림 없음 -->
{#snippet glyph(kind: StateKind)}
  {#if kind === "run"}
    <span class="spin" aria-hidden="true"></span>
  {:else if kind === "ok"}
    <span class="gl" aria-hidden="true"><UiIcon name="check" size={11} /></span>
  {:else if kind === "warn"}
    <span class="gl" aria-hidden="true"
      ><svg viewBox="0 0 12 12" width="11" height="11"
        ><path d="M6 2.2v4.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" fill="none" /><circle
          cx="6"
          cy="9.6"
          r="1.1"
          fill="currentColor"
        /></svg
      ></span
    >
  {:else if kind === "err"}
    <span class="gl" aria-hidden="true"><UiIcon name="close" size={11} /></span>
  {/if}
{/snippet}

{#snippet command(ex: (typeof ops.execList)[number])}
  <div class="ohead">
    {#if ex.op}
      {@const prev = commandPreview(ex.op.command)}
      {@const shown = ops.expandedCmds.has(ex.id)}
      {#if shown}
        <div class="cmdbox"><pre class="ocmd">{ex.op.command}</pre></div>
      {:else}
        <pre class="ocmd" title={prev.truncated ? undefined : ex.op.command}>{prev.text}</pre>
      {/if}
      {#if prev.truncated}
        <button type="button" class="btn btn-ghost btn-sm cmdmore" onclick={() => ops.toggleCmd(ex.id)}>
          {shown ? t("board.cmd.collapse") : t("board.cmd.expand", { chars: prev.chars, lines: prev.lines })}
        </button>
      {/if}
    {:else}
      <p class="oexternal">{t("board.exec.external")}</p>
    {/if}
  </div>
{/snippet}

{#snippet matrix(ex: (typeof ops.execList)[number])}
  <!-- 결과 줄 — 대상마다 점 · code·label · 상태 · 종료코드(줄마다 같은 칸 틀이라 세로로 맞는다) -->
  <ul class="matrix">
    {#each Object.entries(ex.targets) as [streamId, r] (streamId)}
      {@const info = targetLookup.get(streamId)}
      {@const tk = targetKind(r.state)}
      <li class="mrow">
        <!-- 실패 · 시간 초과는 M3 error 글리프(10px — 8px 점 줄에 1px 씩만 넘친다), 나머지는 예전 점 -->
        {#if r.state === "failed" || r.state === "timedOut"}<ErrorGlyph size={10} data-tdot={r.state} aria-hidden="true" />{:else}<span
            class="tdot {r.state}"
            aria-hidden="true"
          ></span>{/if}
        <span class="who"
          ><span class="chip-code">{info?.code ?? streamId}</span>{#if info}<span class="mlabel" title={info.label}
              >{info.label}</span
            >{/if}</span
        >
        <span class="tbadge {tk}" data-target-state={r.state}
          >{#if tk === "run"}<span class="spin" aria-hidden="true"></span>{/if}{t(TARGET_LABEL[r.state])}</span
        >
        <span class="exit" class:bad={r.exitCode !== null && r.exitCode !== 0} title={t("board.exec.exit.title")}
          >{r.exitCode ?? ""}</span
        >
        {#if r.errorClass}
          <span class="eclass" title={r.errorClass}>{r.errorClass}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/snippet}

<section class="block" aria-labelledby="ops-exec-h">
  <div class="heading-row">
    <h3 class="heading" id="ops-exec-h">
      {t("board.exec.heading")}<span class="count">{ops.execList.length}</span>
    </h3>
    {#if finishedCount > 0}
      <button
        type="button"
        class="clear-all"
        data-exec-clear-finished
        title={t("board.exec.dismiss.title")}
        onclick={() => ops.dismissFinished()}>{t("board.exec.dismissFinished")}</button
      >
    {/if}
    <!-- 정렬 — 런처 독의 정렬 단추와 같은 모양. 지금 순서의 그림 · 이름을 보인다(누르면 반대). 도는 · 승인된 실행은 늘 위 -->
    <button
      type="button"
      class="btn btn-ghost icon-btn"
      title={t(EXEC_SORTS[settings.execSort])}
      aria-label={t(EXEC_SORTS[settings.execSort])}
      aria-pressed={settings.execSort === "oldest"}
      data-exec-sort={settings.execSort}
      onclick={() => setExecSort(settings.execSort === "oldest" ? "newest" : "oldest")}
      ><UiIcon name={settings.execSort === "oldest" ? "sort-oldest" : "sort-newest"} size={14} /></button
    >
  </div>
  <ul class="ops">
    {#each ops.execList as ex (ex.id)}
      {@const active = isActive(ex.state)}
      {@const prog = progressOf(ex)}
      {@const kind = opStateKind(ex.state)}
      {#if !active}
        {@const open = ops.expandedExecs.has(ex.id)}
        {@const at = ex.op ? (ex.op.requestedAt ?? ex.op.createdAt) : null}
        <!-- 완료된 실행 — 한 줄(▸ 제목 · 상태 · 시각 · ✕). 누르면 그 자리에서 명령 · 결과 줄 -->
        <li class="op row" class:open class:pulse={pulsing === ex.id} data-operation-id={ex.id} data-exec-row>
          <div class="rline">
            <button type="button" class="rtoggle" aria-expanded={open} onclick={() => ops.toggleExec(ex.id)}>
              <span class="chev" class:open aria-hidden="true"><UiIcon name="chevron" size={14} /></span>
              <span class="rtitle" title={rowTitle(ex)}>{rowTitle(ex)}</span>
              <span class="ostate {kind}" data-exec-state={ex.state}>{@render glyph(kind)}{opStateLabel(ex.state)}</span>
              {#if at !== null}<span class="rtime">{relativeTime(at, now, t)}</span>{/if}
            </button>
            <button
              type="button"
              class="rdismiss"
              aria-label={t("board.exec.dismiss")}
              title={t("board.exec.dismiss.title")}
              onclick={() => ops.dismissExec(ex.id)}><UiIcon name="close" size={14} /></button
            >
          </div>
          {#if open}
            <div class="rbody">
              {@render command(ex)}
              {@render matrix(ex)}
            </div>
          {/if}
        </li>
      {:else}
      <li
        class="op exec"
        class:active
        class:pulse={pulsing === ex.id}
        data-operation-id={ex.id}
      >
        <!-- 윗줄 — 제목(없으면 빈 자리) · (오른쪽) 집계 상태 알약 + 끝난 대상 n/m -->
        <div class="otop">
          <span class="otitle" title={ex.op?.title ?? undefined}>{ex.op?.title ?? ""}</span>
          <span class="ostate {kind}" data-exec-state={ex.state}
            >{@render glyph(kind)}{opStateLabel(ex.state)}{#if prog.total > 0}<span class="oprog"
                >{prog.done}/{prog.total}</span
              >{/if}</span
          >
        </div>
        {#if active && prog.total > 0}
          <!-- 얇은 진행 막대 — 도는 동안만(끝나면 알약 색이 말한다). 장식이라 알약의 n/m 이 같은 말을 글자로 한다 -->
          <div class="obar" aria-hidden="true">
            <span style:width="{Math.round((prog.done / prog.total) * 100)}%"></span>
          </div>
        {/if}
        {@render command(ex)}
        {@render matrix(ex)}
        <!-- 아랫줄 — (오른쪽) 취소 -->
        <div class="obtns">
          <button
            type="button"
            class="btn btn-ghost btn-sm cancel danger-text"
            title={t("board.exec.cancel.title")}
            onclick={() => ops.cancelExec(ex.id)}>{t("board.exec.cancel")}</button
          >
        </div>
      </li>
      {/if}
    {/each}
  </ul>
</section>

<style>
  /* ---------------------------------------------------------------------------
   * 카드 뼈대 — `PlanList.svelte` 의 검토 대기 카드와 **같은 면**이다(스코프라 베껴 둔다 — 한쪽을 고치면
   * 다른 쪽도 본다): 묶음 · 제목 · 개수 · 카드 · 맥박 · 윗줄 · 명령 상자.
   * --------------------------------------------------------------------------- */
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  /* 묶음 제목 — 작은 흐린 글자 + 숫자 알약(2026-10-25 End-4 겉) */
  .heading {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) 2px 0;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
    color: var(--fg-2);
  }

  .count {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    font-size: 11px;
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    background: var(--control-bg);
    border-radius: 999px;
  }

  .ops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /* 카드 — 테두리 없는 면(surfaceContainerHigh) · 16px 둥글게(2026-10-25 End-4 겉) */
  .op {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    background: var(--control-tile-bg);
    border-radius: var(--radius-surface-inner); /* 독 · 덮개 안의 카드(2026-10-25) */
  }

  /*
    딥링크가 데려온 카드 — 1.2초 동안 테두리 바깥 고리가 한 번 뛴다(중성 포커스 고리 색 —
    강조색이 아니다). 움직임을 줄여 달라고 한 사람에게는 **깜박임 대신 그냥 켜 둔다**.
  */
  .op.pulse {
    animation: op-pulse 1.2s ease-out 1;
  }
  @keyframes op-pulse {
    0%,
    60% {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
    100% {
      outline: 2px solid transparent;
      outline-offset: 2px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .op.pulse {
      animation: none;
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }
  }

  /* 윗줄 — 제목 · (오른쪽) 상태 알약 */
  .otop {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 24px;
    min-width: 0;
  }

  .otitle {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 얇은 진행 막대 — 도는 동안만. 채움은 강조색(지금 일어나는 일 하나) */
  .obar {
    height: 4px;
    overflow: hidden;
    background: var(--control-bg);
    border-radius: 999px;
  }

  .obar span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 200ms ease;
  }

  /* 묶음 제목 줄 — 제목(왼쪽) · [완료된 실행 모두 지우기] · 정렬 단추(오른쪽 끝) */
  .heading-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .heading-row .heading {
    flex: 1 1 auto;
  }

  .clear-all {
    flex: 0 0 auto;
    height: 24px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--accent);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .clear-all:hover {
    background: var(--control-ghost-hover);
  }

  .clear-all:focus-visible,
  .rtoggle:focus-visible,
  .rdismiss:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* ── 완료된 실행의 한 줄 — 카드 면 그대로 · 높이 40 · 펼치면 아래에 명령 · 결과 줄 ── */
  .op.row {
    gap: 0;
    padding: 0;
  }

  .rline {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding-right: var(--space-1);
  }

  .rtoggle {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    padding: 0 var(--space-1) 0 var(--space-3);
    font-family: var(--font-ui);
    color: var(--fg-1);
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-surface-inner);
    cursor: pointer;
  }

  .chev {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--fg-3);
    transition: transform 160ms ease;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }

  .rtitle {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rtime {
    flex: 0 0 auto;
    min-width: 4.5em;
    text-align: right;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  .rdismiss {
    flex: 0 0 auto;
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
  }

  .rdismiss:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .rbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-4) var(--space-3);
  }

  /* 아랫줄 — 오른쪽 끝 취소 */
  .obtns {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .ohead {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }

  /* 명령문 — 판보다 한 단 가라앉은 우물(창 바탕색) 안의 고정폭. 여러 줄 허용 */
  .ocmd {
    align-self: stretch;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-base);
    border-radius: 12px;
  }

  /* 펼친 명령문 상자 — **카드가 무한정 자라지 않게** 240px 에서 멈춘다(자체 스크롤).
     우물은 상자가 그리고 안쪽 `pre` 는 글자만 (2026-09-20-console-fixes ①). */
  .cmdbox {
    align-self: stretch;
    max-height: 240px;
    overflow: auto;
    background: var(--bg-base);
    border-radius: 12px;
  }

  .cmdbox .ocmd {
    background: transparent;
    border: none;
  }

  /* "전체 보기 / 접기" — 작은 고스트 버튼. 글자 끝을 명령 상자 왼쪽 가장자리에 맞춘다 */
  .cmdmore {
    margin-left: calc(-1 * var(--space-2));
  }

  /* 다른 창이 시작한 실행 — 명령 상세가 없다는 한 줄 */
  .oexternal {
    margin: 0;
    font-size: var(--t-sm);
    color: var(--fg-3);
  }

  /* 파괴적 동작의 글자 — [취소]. `.btn-*` 호버가 글자를 본문색으로 되돌리므로 여기서 잡는다 */
  .btn.danger-text,
  .btn.danger-text:hover {
    color: var(--err);
  }

  /* 세션 신원 코드(고정폭 흐림) — 비교 보기·검토 대기 칩과 같은 말 */
  .chip-code {
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 종료 코드 — 0 은 조용히, 0 아니면 실패색 */
  .exit {
    text-align: right;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
  }

  .exit.bad {
    color: var(--err);
    font-weight: var(--fw-semibold);
  }

  /* ── 실행 뷰 — 집계 상태 알약 + 대상별 결과 줄 ──
   * MD3 톤 면(2026-11-01): 면 = container · 글자 = onContainer. 꽉 찬 면(primary)은 주 단추 전용, secondaryContainer 는 걸린 칩 ·
   * 고른 칸의 면이라 쓰지 않는다. 기본(승인됨 · 대기)은 중성 회색 면이다. */
  .ostate {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 22px;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
    white-space: nowrap;
  }

  /* 끝난 대상 n/m — 알약 글자에 이어 붙는다 */
  .oprog {
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
  }

  /* 앞 그림(✓ · ! · ✕) — 11px, 글자색을 따른다 */
  .gl {
    display: inline-flex;
    flex: 0 0 auto;
  }

  /* 도는 고리 — primary 원호 하나가 1초에 한 바퀴. 움직임을 줄여 달라고 했으면 멈춘 원호로 둔다 */
  .spin {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1.75px solid color-mix(in srgb, var(--accent) 28%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: exec-spin 1s linear infinite;
  }
  @keyframes exec-spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  /* 실행 중 — primaryContainer(지금 일어나는 일 · 진행 막대와 같은 primary 계열) */
  .ostate.run,
  .tbadge.run {
    color: var(--m3-on-primary-container);
    background: var(--m3-primary-container);
  }
  .ostate.ok,
  .tbadge.ok {
    color: var(--on-ok-soft);
    background: var(--ok-soft);
  }
  .ostate.warn,
  .tbadge.warn {
    color: var(--on-warn-soft);
    background: var(--warn-soft);
  }
  .ostate.err,
  .tbadge.err {
    color: var(--m3-on-error-container);
    background: var(--err-soft);
  }
  /* 취소 — 면 없이 중성 테두리 · 불명 — 면 없이 경고색 테두리("정직히 불확실") */
  .ostate.cancelled,
  .tbadge.cancelled {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--m3-outline-variant);
  }
  .ostate.unknown,
  .tbadge.unknown {
    color: var(--warn);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--warn);
  }

  /* 결과 줄 — 줄마다 같은 칸 틀(점 · 이름 · 상태 · 종료 코드)이라 대상끼리 세로로 맞는다. 오류분류는 이름 칸 아래 한 줄 */
  .matrix {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mrow {
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr) auto 3.5ch;
    align-items: center;
    column-gap: var(--space-3);
    min-height: 28px;
    font-size: var(--t-sm);
  }

  .who {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .mlabel {
    min-width: 0;
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 대상 상태 점 — 도는 중 = primary 고리 · 성공 = 초록 · 취소 = 빈 고리 (실패/시간초과는 `ErrorGlyph`) */
  .tdot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .tdot.running {
    background: transparent;
    border: 1.5px solid var(--accent);
  }
  .tdot.succeeded {
    background: var(--ok);
  }
  .tdot.cancelled {
    background: transparent;
    border: 1.5px solid var(--fg-3);
  }
  /* 상태 불명 — 경고색 고리(성공도 실패도 취소도 아닌 "정직히 불확실") */
  .tdot.unknown {
    background: transparent;
    border: 1.5px solid var(--warn);
  }
  .tdot.pending {
    opacity: 0.5;
  }

  /* 대상별 알약 — 집계 알약과 같은 톤 면(색은 위 `.ostate` 와 함께 적었다). 그림은 실행 중의 작은 고리 하나뿐 */
  .tbadge {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    border-radius: 999px;
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  /* 오류분류 — 남는 폭에 흐리게(취소의 협력적 한계 등을 정직히 보여 준다) */
  .eclass {
    grid-column: 2 / -1;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
