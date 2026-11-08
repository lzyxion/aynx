<script lang="ts">
  /**
   * **명령 나눠 보기**(10-24 "A + 명령 나눠 보기") — 검토 카드(`ReviewCard`)와 작업안 카드(`console/PlanList`)가 **맨 위 줄이 둘
   * 이상인 셸 명령**(Rust `analysis.lines`)에 쓰는 상자. 긴 한 덩이 명령의 글자 벽 대신 줄마다 한 행: 줄 번호 · 표지 · 원문.
   *
   * - **읽기 줄은 표시 없이** 둔다(10-24 실기 — 읽기 · 쓰기 점이 색만 달라 구분되지 않았다). 읽기가 아닌 줄은 옅은 판 + 왼쪽 2px 띠 +
   *   줄 끝 글자 표지("쓰기 · systemctl restart") — 쓰기 · 판단 못 함 = 경고색, 삭제 = 실패색(`lineMark`). `echo` 만 하는 머리 줄
   *   (`quiet`)은 확연히 흐리게(글자 · 줄 번호 모두 — 구획 이름일 뿐이다).
   * - **줄 안 표시 낱말**(Rust `marks` — 효과를 낸 프로그램 · 인자 · 연산자의 코드 포인트 자리)은 굵게 + 효과 색 글자 + 옅은 같은 색
   *   바탕으로 칠한다(삭제 = 실패색 · 쓰기 · 판단 못 함 = 경고색). 자르기는 `markSegments`(판정 없음 — 이상한 자리는 버린다). 줄 판 ·
   *   띠 · 끝 표지는 그 줄의 요약이라 그대로 둔다.
   * - **권한 올리기 낱말**(`marks[].kind === "sudo"` — `sudo` · `doas` · `pkexec` · `su`)은 효과와 무관하게 경고색(굵게 + 옅은 경고색
   *   바탕)이다. 그 표시만 있는 읽기 줄(`sudo journalctl …`)은 줄 판 · 띠 · 표지 없이 둔다 — 낱말만 색(`lineMark` 가 읽기면 `null`).
   * - **DB 작업안**(10-24)도 같은 상자 — 문장마다 한 행(구문 강조 없이 고정폭 글자 · 동사 · 테이블 낱말 표시). 바깥 `WHERE` 없는
   *   `UPDATE` · `DELETE` · `DROP` · `TRUNCATE` 줄(`danger`)은 효과와 무관하게 실패색(줄 판 · 띠 · 표시 낱말 모두).
   * - **AI 가 선언한 효과보다 센 줄**(`over` — Rust 가 매긴다, 여기서 다시 계산하지 않는다)은 효과와 무관하게 실패색이고 표지 끝에
   *   "AI 설명보다 강함" 을 붙인다. 표지는 진짜 글자라 스크린리더가 그 줄과 함께 읽는다.
   * - 한 행뿐이면(`splitLines` 가 실은 한 줄 비읽기 명령) 줄 번호 칸을 접는다.
   * - 줄 끝 구분자는 `&&` · `||` · `&` 만 흐리게(`;` · 줄바꿈은 줄이 나뉜 것으로 이미 보인다 — `shownSep`).
   * - 상자는 열네 줄까지, 넘치면 **안에서** 스크롤한다(카드가 화면을 밀어 올리지 않게).
   *
   * 아래 범례 줄에 [원문 보기] ⇄ [줄로 보기](원문 = 명령 전문 그대로 · 접지 않는다)와, 이유가 있으면 [요청 배경](`AiNote`)을 둔다.
   * 둘 다 **승인과 무관한 보기 전환**이다 — 검토 카드 안에서는 카드 상자의 `keepFocus` 가 포커스를 옮기지 않게 한다.
   *
   * **보안 — "승인은 명령 전문이 보이는 자리에서만"**(ReviewCard 머리말): 이 상자는 아무것도 숨기지 않는다(줄 보기도 원문 보기도 전문 ·
   * 안에서 스크롤). 그래서 부모는 이 상자일 때 `approveStep` 의 `hidden` 을 거짓으로 준다.
   */
  import AiNote from "$lib/AiNote.svelte";
  import type { CommandLine, ComputedEffect } from "$lib/operations";
  import { lineMark, markSegments, shownSep, type MarkSegment } from "$lib/review-card";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    /** 작업안 id — 바뀌면 보기 전환 · 이유 펼침을 푼다 */
    operationId: string;
    /** 명령 전문(원문 보기) */
    command: string;
    lines: CommandLine[];
    /** AI 가 적은 이유 — 비면 [요청 배경] 단추가 없다 */
    reason?: string | null;
    /** 상자의 최대 줄 수(넘치면 안에서 스크롤) */
    maxRows?: number;
  }
  let { operationId, command, lines, reason = null, maxRows = 14 }: Props = $props();

  let raw = $state(false);
  let reasonOpen = $state(false);
  $effect(() => {
    void operationId;
    raw = false;
    reasonOpen = false;
  });

  const reasonText = $derived(reason?.trim() ?? "");

  function tagWord(e: ComputedEffect): string {
    return t(`app.review.lines.tag.${e}` as "app.review.lines.tag.read");
  }

  /** 표시 낱말의 색 — `sudo` 낱말은 늘 경고색, 위험한 줄(`danger`)의 낱말은 실패색, 그 밖은 효과(삭제 = 실패색 · 나머지 경고색) */
  function wordTone(seg: MarkSegment, line: CommandLine): "warn" | "err" {
    if (seg.kind === "sudo") return "warn";
    return line.danger === true || seg.effect === "delete" ? "err" : "warn";
  }

  const single = $derived(lines.length === 1);
  const anyQuiet = $derived(lines.some((l) => l.quiet === true));
</script>

{#if raw}
  <pre class="box rawbox" data-cmd-raw style:max-height="calc(1.5em * {maxRows} + 2 * var(--space-2))">{command}</pre>
{:else}
  <ol
    class="box lines"
    aria-label={t("app.review.lines.label")}
    data-cmd-lines={lines.length}
    style:max-height="calc(1.5em * {maxRows} + 2 * var(--space-2))"
  >
    {#each lines as line, i (i)}
      {@const sep = shownSep(line.sep)}
      {@const mark = lineMark(line)}
      <li
        class="row {mark ?? ''}"
        class:single
        class:quiet={line.quiet}
        data-line-over={line.over === true}
        data-line-mark={mark ?? "none"}
      >
        {#if !single}<span class="num" aria-hidden="true">{i + 1}</span>{/if}
        <span class="text"
          >{#each markSegments(line.text, line.marks) as seg, k (k)}{#if seg.effect}<span
                class="mk {wordTone(seg, line)}"
                data-line-word={seg.kind ?? seg.effect}>{seg.text}</span
              >{:else}{seg.text}{/if}{/each}{#if sep}<span class="sep">{" " + sep}</span>{/if}{#if mark}<span class="tag" data-line-tag
              >{tagWord(line.effect)}{#if line.cause}&nbsp;· {line.cause}{/if}{#if line.over}&nbsp;— {t(
                  "app.review.lines.over",
                )}{/if}</span
            >{/if}</span
        >
      </li>
    {/each}
  </ol>
{/if}
<div class="legend">
  {#if !raw}
    {#if anyQuiet}
      <span class="lg">{t("app.review.lines.quiet")}</span>
    {/if}
  {/if}
  <span class="lfill"></span>
  {#if reasonText !== ""}
    <button type="button" class="ltoggle" aria-expanded={reasonOpen} onclick={() => (reasonOpen = !reasonOpen)}
      >{t("app.review.reason.label")}</button
    >
  {/if}
  <button type="button" class="ltoggle" aria-pressed={raw} onclick={() => (raw = !raw)}
    >{t(raw ? "app.review.lines.split" : "app.review.lines.raw")}</button
  >
</div>
<AiNote label={t("app.review.reason.label")} text={reasonOpen ? reasonText : null} />

<style>
  /* 상자 — 두 줄 접기(`CommandClamp`)의 명령 상자와 같은 면 · 글꼴. 넘치면 안에서 스크롤 */
  .box {
    flex: none;
    margin: 0;
    padding: var(--space-2) 0;
    overflow-y: auto;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--bg-base);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    user-select: text;
  }
  .rawbox {
    padding: var(--space-2) var(--space-3);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .lines {
    list-style: none;
  }

  /* 한 행 — 번호(22px 오른쪽 맞춤) · 표지(12px) · 원문(접혀 내려가면 원문 칸 안에서 들여 쓴 채로) */
  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    column-gap: var(--space-2);
    align-items: start;
  }
  /* 한 행뿐이면 번호 칸 없이 */
  .row.single {
    grid-template-columns: minmax(0, 1fr);
    padding-left: var(--space-3);
  }
  .num {
    text-align: right;
    color: var(--fg-3);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .text {
    white-space: pre-wrap;
    word-break: break-all;
    /* 오른쪽 여백은 원문 칸이 쥔다 — 센 줄의 옅은 판이 상자 오른쪽 끝까지 닿게 */
    padding-right: var(--space-2);
  }
  /* echo 머리 줄 — 구획 이름일 뿐이라 확연히 흐리게(글자 · 번호 모두) */
  .row.quiet .text,
  .row.quiet .num {
    color: color-mix(in srgb, var(--fg-3) 55%, transparent);
  }
  /* 줄 안 표시 낱말 — 굵게 · 효과 색 · 옅은 같은 색 바탕(줄 판 위에서도 드러나게) */
  .mk {
    font-weight: 700;
    border-radius: 3px;
    padding: 0 1px;
    margin: 0 -1px;
  }
  .mk.warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 20%, transparent);
  }
  .mk.err {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 18%, transparent);
  }
  /* 읽기가 아닌 줄 — 옅은 판 + 왼쪽 안쪽 2px 띠. 쓰기 · 판단 못 함 = 경고색, 삭제 · AI 설명보다 센 줄 = 실패색 */
  .row.warn {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    box-shadow: inset 2px 0 0 var(--warn);
  }
  .row.err {
    background: color-mix(in srgb, var(--err) 12%, transparent);
    box-shadow: inset 2px 0 0 var(--err);
  }
  .sep {
    color: var(--fg-3);
  }
  .tag {
    display: inline-block;
    margin-left: var(--space-2);
    padding: 0 5px;
    font-family: var(--font-ui, inherit);
    font-size: 10.5px;
    line-height: 16px;
    font-weight: var(--fw-semibold);
    word-break: keep-all;
    border-radius: var(--radius-sm);
  }
  .row.warn .tag {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }
  .row.err .tag {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 14%, transparent);
  }

  /* 범례 줄 — 12px 흐림 · 오른쪽 끝에 보기 전환 */
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }
  .lfill {
    flex: 1 1 auto;
  }
  /* 글자 단추 — 밑줄 없이, 올리면 밑줄(주 동작이 아니다) */
  .ltoggle {
    flex: none;
    padding: 0;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: 0;
    cursor: pointer;
    text-underline-offset: 2px;
  }
  .ltoggle:hover {
    color: var(--fg-1);
    text-decoration: underline;
  }
  @media (pointer: coarse) {
    .ltoggle {
      min-height: 32px;
      padding-inline: var(--space-1);
    }
  }
</style>
