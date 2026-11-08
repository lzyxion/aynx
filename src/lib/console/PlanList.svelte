<script lang="ts">
  // 대시보드 작업안 칸의 **진행(목록) 보기** — 검토 대기 카드(판결 띠 · 명령 전문 · 대상 · 만료 · 거절 · 승인…)와 실행 묶음.
  // 실행 묶음은 `ExecList`, 상태·승인·거절은 `ops-controller` 에 있다. 승인은 카드에서 바로 — 검토 카드와 같은 판정(`approveStep`)이다
  // (2026-10-27 — 옛 확인 패널 `PlanConfirm` 은 걷었다 · 목업 6zsCHiT4b3RcSwZaGFkiwE).
  // 카드의 조각(판결 띠 `VerdictBand` · 명령 나눠 보기 `CommandLines` · 두 줄 접기 `CommandClamp` · 메타 줄 `ReviewMeta`)은 화면 아래
  // 검토 카드(`ReviewCard`)와 같은 것이다 — 10-24 "A + 명령 나눠 보기".
  import { expiryLabel, type Operation } from "$lib/operations";
  import { approvalRisk, approveStep, hasFoldedDetail, reasonShown, splitLines, verdictOf } from "$lib/review-card";
  import AiNote from "$lib/AiNote.svelte";
  import CommandClamp from "$lib/CommandClamp.svelte";
  import CommandLines from "$lib/CommandLines.svelte";
  import ReviewMeta from "$lib/ReviewMeta.svelte";
  import VerdictBand from "$lib/VerdictBand.svelte";
  import AiSummaryLine from "$lib/AiSummaryLine.svelte";
  import AnalysisChips from "$lib/AnalysisChips.svelte";
  import { autoRefusals } from "$lib/app/pending-plans.svelte.js";
  import type { OpsController } from "$lib/console/ops-controller.svelte";
  import ExecList from "$lib/console/ExecList.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    ops: OpsController;
    /** 대상 id → 이 창의 {code, label} */
    targetLookup: Map<string, { code: string; label: string }>;
    /** Console 의 30초 경과 시계 — 만료까지 남은 분을 따라 내린다 */
    now: number;
    /** 딥링크로 지금 맥박이 뛰는 카드 id (Console 의 spotlight 효과가 쥔다) */
    pulsing: string | null;
  }
  let { ops, targetLookup, now, pulsing }: Props = $props();

  /**
   * 카드마다 "접으면 명령이 잘린다"(`CommandClamp` 가 잰다) · "전체를 보고 다시 누르세요" 를 띄웠는가(10-22). 잘린 채 펼치지 않았으면
   * [실행 승인] 의 첫 누름은 펼치기다(`approveStep` — 검토 카드와 같은 판정 · "승인은 명령 전문이 보이는 자리에서만"). 펼침은 예전 그대로
   * `ops.expandedCmds` 가 쥔다.
   */
  let truncated = $state<Record<string, boolean>>({});
  let revealHint = $state<Record<string, boolean>>({});

  /** 잘린 채 펼치지 않았는가 — 명령 나눠 보기(`splitLines`)는 숨는 것이 없어 늘 거짓이다 */
  function hidden(op: Operation): boolean {
    const id = op.operationId;
    return splitLines(op) === null && truncated[id] === true && !ops.expandedCmds.has(id);
  }

  /**
   * [실행 승인] 한 번 — 검토 카드(`ReviewCard.approve`)와 같은 세 갈래: 잘린 명령이면 펼치기, 위험이면 확인 상태(펼치기를 겸한다 —
   * 두 번을 넘지 않는다), 아니면 승인. 확인 상태의 단추는 [확인했습니다 — 실행] 으로 바뀌고 그 둘째 누름만 나간다.
   */
  function approve(op: Operation, risk: "safe" | "dangerous"): void {
    const id = op.operationId;
    const step = approveStep({ hidden: hidden(op), risky: risk === "dangerous", armed: ops.confirming === id });
    if (step === "reveal") {
      if (!ops.expandedCmds.has(id)) ops.toggleCmd(id);
      revealHint = { ...revealHint, [id]: true };
      return;
    }
    if (step === "arm") {
      if (truncated[id] === true && !ops.expandedCmds.has(id)) ops.toggleCmd(id);
      revealHint = { ...revealHint, [id]: false };
      ops.arm(id);
      return;
    }
    revealHint = { ...revealHint, [id]: false };
    void ops.doApprove(op);
  }
</script>

<!--
  작업안 모드 — 위는 실행 뷰(승인된·도는·끝난 작업안의 결과), 아래는 AI 가 저장한 검토 대기
  작업안 카드(명령 전문 · 위험 배지 · 대상 · 만료 · 방식). 승인은 확인 한 단계(위험 명령은
  두 단계)를 지나야 하고 Tauri 명령이다. ② 위험 신호는 자문 배지일 뿐 아무것도 막지 않는다.
  감싸개 없이 조각으로 그린다 — Console `.body` 의 직계 자식 규칙(1080px 가운데 열)이 그대로 닿는다.
-->
{#if ops.operations.length === 0 && ops.execList.length === 0}
  <p class="empty">{t("board.plan.empty")}</p>
{:else}
  <!--
    두 묶음 — **검토 대기**(위) · **실행**(아래: 승인된/도는/끝난 작업안의 결과 행렬 — 대상별
    상태·종료코드를 라이브로, 실행 중이면 취소(협력적), 끝났으면 지우기). 승인·취소는 Tauri
    명령이라 AI 는 닿지 못한다. 묶음 제목은 세션 칸의 머리줄과 같은 말이다.
  -->
  <div class="opsview">
    {#if ops.operations.length > 0}
      <!-- 검토 대기 — 나를 기다리는 것이 먼저다 -->
      <section class="block" aria-labelledby="ops-pending-h">
        <h3 class="heading" id="ops-pending-h">
          {t("board.plan.heading")}<span class="count">{ops.operations.length}</span>
        </h3>
        <ul class="ops">
                    {#each ops.operations as op (op.operationId)}
            {@const risk = approvalRisk(op)}
            {@const armed = ops.confirming === op.operationId}
            {@const shown = ops.expandedCmds.has(op.operationId)}
            <!--
              **검토 대기 만료까지 얼마나 남았나** (docs/log/2026-09-21-approval-ttl.md).
              `now` 는 이 패널의 30초 시계라 아무도 건드리지 않아도 따라 내려간다. 판정은 순수
              함수 하나(`expiryLabel`)이고 문구는 판결 띠 오른쪽 끝이 만든다. `{@const}` 는 블록의
              **첫 자식**이어야 해서 여기 선다.
            -->
            {@const left = expiryLabel(op.expiresAt, now)}
            <!-- 명령 나눠 보기의 줄들(10-24 — 검토 카드와 같은 판정 `splitLines`) — 없으면 두 줄 접기 -->
            {@const split = splitLines(op)}
            <!-- `data-operation-id` 는 딥링크가 찾아오는 손잡이다 (Console 의 `spotlight` 효과) -->
            <li
              class="op"
              class:danger={risk === "dangerous"}
              class:pulse={pulsing === op.operationId}
              data-operation-id={op.operationId}
            >
              <!--
                **판결 띠**(10-24 — 검토 카드와 같은 조각 `VerdictBand`) — 카드 맨 위 가장자리까지: 이 명령이 무엇인지 · AI 설명과 맞는지.
                예전 윗줄의 위험 배지와 효과 / 어긋남 칩을 대신한다. 오른쪽 끝은 만료까지 남은 시간.
              -->
              <VerdictBand verdict={verdictOf(op, risk)}>
                {#snippet end()}
                  <span class="oexpiry" title={t("board.plan.expires.title")}
                    >{left === null
                      ? t("board.plan.expires.none")
                      : t("board.plan.expires", { n: left.minutes })}</span
                  >
                {/snippet}
              </VerdictBand>
              <!-- 순서(10-24): 판결 띠 → 제목 → AI 설명 → 명령(DB 면 문장 칩) → 메타 줄 → 단추 -->
              {#if op.title}
                <span class="otitle">{op.title}</span>
              {/if}
              <!-- AI 가 쓴 설명(승인 요약) — 검토 카드와 같은 조각 · 옛 작업안이면 없다 -->
              <AiSummaryLine operationId={op.operationId} summary={op.summary} />
              {#if split}
                <!--
                  명령 나눠 보기 — 숨는 것이 없으므로 [승인…]이 펼치기를 겸하지 않는다(`hidden`). AI 가 적은 이유는 범례 줄의 단추가 연다.
                -->
                <CommandLines
                  operationId={op.operationId}
                  command={op.command}
                  lines={split}
                  reason={op.reason}
                  maxRows={16}
                />
              {:else}
                <!--
                  명령 상자 — 두 줄에서 말줄임 + [전체 보기](`CommandClamp` — 검토 카드와 같은 조각). 잘린 채로는 승인 흐름이 열리지 않는다
                  (첫 [승인…]이 펼친다).
                -->
                <div class="ohead">
                  <CommandClamp
                    text={op.command}
                    lang={op.db ? "sql" : null}
                    expanded={shown}
                    more={hasFoldedDetail(op)}
                    expandedLines={16}
                    onToggle={() => ops.toggleCmd(op.operationId)}
                    onTruncated={(v) => {
                      if (truncated[op.operationId] !== v) truncated = { ...truncated, [op.operationId]: v };
                    }}
                  />
                </div>
                <!-- AI 가 적은 이유 — 펼쳤을 때만(검토 카드와 같은 규칙 `reasonShown`) -->
                <AiNote label={t("app.review.reason.label")} text={reasonShown(op, shown)} />
              {/if}
              {#if op.db}
                <!--
                  DB 문장 칩 · 상한(검토 카드와 같은 조각). WHERE 없는 쓰기 · 선언과 다름은 `approvalRisk` 가 위험으로 올려 테두리가
                  실패색이고 승인이 두 걸음([실행 승인] → [확인했습니다 — 실행])이 된다 — 그 말은 판결 띠가 한다.
                -->
                <!-- 문장 나눠 보기(10-24)면 줄이 문장마다 같은 말을 하므로 상한 칩만 -->
                <AnalysisChips {op} only={split ? ["limit"] : ["stmt", "limit"]} />
              {/if}
              <!--
                메타 줄(검토 카드와 같은 조각 `ReviewMeta`) — 대상(코드 · 이름 · 첫 대상 "(먼저)") · 경로 · 검증 · sudo · 자동 승인 거부 ·
                (여기만) 방식 · 타임아웃. DB 작업안이면 대상 대신 상한 · 문장 수.
              -->
              <ReviewMeta
                {op}
                {targetLookup}
                autoRefused={autoRefusals().get(op.operationId) ?? null}
                targets={!op.db}
              >
                {#snippet extra()}
                  {#if op.db}
                    <span class="mi" title={t("app.review.db.tx")}
                      >{t("app.review.db.max", { n: op.db.maxAffected, count: op.db.statements.length })}</span
                    >
                  {/if}
                  <span class="mi" title={t("board.plan.timeout.title")}>⏱ {op.timeoutSeconds}s</span>
                {/snippet}
              </ReviewMeta>
              {#if revealHint[op.operationId]}
                <!-- 잘린 명령에 [실행 승인]을 눌렀다 — 펼쳐 보였으니 확인하고 다시 -->
                <p class="reveal" data-reveal-hint>{t("app.review.cmd.revealHint")}</p>
              {/if}
              {#if armed}
                <!-- 위험 확인 상태 — 검토 카드와 같은 문장 -->
                <p class="armwarn" data-plan-armed>{t("board.confirm.warn")}</p>
              {/if}
              <!--
                아랫줄 — (오른쪽) 거절 · 실행 승인. 안전 = 화면의 **주 동작 하나**만 채운 강조(`primaryOpId`), 나머지는 회색 채움.
                위험 = 실패색 테두리의 빈 단추(강조색으로 권하지 않는다) → 누르면 옅은 실패색 판의 [확인했습니다 — 실행] 으로 바뀌고
                그 둘째 누름만 나간다(검토 카드와 같은 모양).
              -->
              <div class="obtns">
                <button
                  type="button"
                  class="btn btn-ghost reject danger-text"
                  onclick={() => ops.reject(op.operationId)}>{t("board.plan.reject")}</button
                >
                {#if risk === "dangerous"}
                  <button
                    type="button"
                    class="btn approve {armed ? 'danger-solid' : 'danger-outline'}"
                    title={t(armed ? "app.review.approve.danger.title" : "app.review.approve.arm.title")}
                    data-plan-approve
                    onclick={() => approve(op, risk)}
                    >{armed ? t("app.review.approve.danger") : t("app.review.approve")}</button
                  >
                {:else}
                  <button
                    type="button"
                    class="btn approve {ops.primaryOpId === op.operationId ? 'btn-primary' : 'btn-secondary'}"
                    data-plan-approve
                    onclick={() => approve(op, risk)}>{t("app.review.approve")}</button
                  >
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if ops.execList.length > 0}
      <ExecList {ops} {targetLookup} {now} {pulsing} />
    {/if}
  </div>
{/if}

<style>
  /* 빈 상태 한 줄 — Console·다른 보기와 같은 규칙(스코프라 파일마다 베껴 둔다) */
  .empty {
    margin: 0;
    padding: var(--space-4) 0;
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /* ---------------------------------------------------------------------------
   * 작업안 목록 보기 — 묶음 둘(검토 대기 · 실행), 제목은 작은 흐린 글자 + 숫자 알약.
   * 카드는 테두리 없는 면(surfaceContainerHigh) · 16px 둥글게(2026-10-25 End-4 겉). 파괴적으로 보이는
   * 작업안만 실패색 테두리(자문일 뿐 아무것도 막지 않는다). 강조색은 **주 동작 하나**(`primaryOpId` 의 [승인…] 또는
   * 확인 상태인 위험 카드의 [확인했습니다 — 실행])뿐이다. 카드 뼈대는 `ExecList.svelte` 에 베껴 두었다(같은 면).
   * --------------------------------------------------------------------------- */
  .opsview {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    padding: var(--space-1) 0 var(--space-6);
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

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

  .op {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--control-tile-bg);
    border-radius: var(--radius-surface-inner); /* 독 · 덮개 안의 카드(2026-10-25) */
  }

  /* 위험 작업안만 실패색 테두리 — 안쪽 그림자라 카드 크기가 흔들리지 않는다 */
  .op.danger {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--err) 40%, transparent);
  }

  /*
   * 메타 줄(`ReviewMeta` — 검토 카드와 공유)을 **이 타일에서만** 작은 알약 칩으로 — 칸(`.mi`)마다 면을 깔고 구분점을 걷는다.
   * 조각 자신은 그대로라 화면 아래 검토 카드의 흐린 한 줄은 바뀌지 않는다.
   */
  .op :global([data-review-meta]) {
    gap: 6px;
    align-items: center;
  }
  .op :global([data-review-meta] > .mi) {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 10px;
    line-height: 1.4;
    color: var(--fg-2);
    background: var(--control-bg);
    border-radius: 999px;
  }
  .op :global([data-review-meta] > .mi + .mi)::before {
    content: none;
  }

  /* 판결 띠(10-24) — 카드의 위 · 양옆 가장자리까지(여백을 되돌린다 · 둥근 모서리는 카드의 `overflow: hidden` 이 자른다) */
  .op {
    overflow: hidden;
  }
  .op > :global(.vband) {
    margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-4)) 0;
    padding-inline: var(--space-4);
  }

  /* 명령 상자(공유 조각 `CommandClamp` · `CommandLines`)의 우물도 이 타일에서만 큰 둥근 모서리 · 테두리 없이 */
  .op :global(.cmd),
  .op :global(.box) {
    border-color: transparent;
    border-radius: 12px;
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

  .otitle {
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }

  /* 만료까지 남은 시간 — 흐린 보조 글자(재촉하지 않는다) */
  .oexpiry {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .ohead {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }

  /* 잘린 명령에 [실행 승인]을 눌렀을 때의 안내 한 줄 */
  .reveal {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--warn);
  }

  /*
   * 파괴적 동작의 글자 — [거절]. 버튼 종류(고스트)는 그대로 두고 **글자만** 실패색이다.
   * `.btn-*` 호버가 글자를 본문색으로 되돌리므로 여기서 잡는다. ([취소]는 `ExecList` 가 같은 규칙을 베껴 둔다.)
   */
  .btn.danger-text,
  .btn.danger-text:hover {
    color: var(--err);
  }

  /* 위험 확인 상태의 경고 한 줄 — 옅은 실패색 판(검토 카드와 같은 말) */
  .armwarn {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--err);
    background: var(--err-soft);
    border-radius: 12px;
  }

  /* 아랫줄 — 오른쪽 끝 거절 · 실행 승인 */
  .obtns {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /* 위험 명령의 [실행 승인] — 실패색 테두리의 빈 단추(검토 카드와 같은 모양 · 강조색으로 권하지 않는다) */
  .btn.danger-outline,
  .btn.danger-outline:hover {
    color: var(--err);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--err);
  }
  .btn.danger-outline:hover {
    background: color-mix(in srgb, var(--err) 10%, transparent);
  }

  /* 확인 상태의 [확인했습니다 — 실행] — 옅은 실패색 판 + 실패색 글자(강조색으로 권하지 않는다) */
  .btn.danger-solid {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }

  .btn.danger-solid:hover {
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }
</style>
