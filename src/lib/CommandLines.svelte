<script lang="ts">
  /**
   * 명령 나눠 보기 — 줄(Rust `analysis.lines`)마다 한 행. 줄의 효과 · `over` · `marks` 는 Rust 가 매긴다 — 여기서 다시 계산하지 않는다.
   * 보안: 승인은 명령 전문이 보이는 자리에서만 — 이 상자는 아무것도 숨기지 않으므로(줄 보기도 원문 보기도 전문 · 안에서 스크롤)
   * 부모는 이 상자일 때 `approveStep` 의 `hidden` 을 거짓으로 준다.
   */
  import AiNote from "$lib/AiNote.svelte";
  import type { CommandLine, ComputedEffect } from "$lib/operations";
  import { lineMark, markSegments, shownSep, type MarkSegment } from "$lib/review-card";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    operationId: string;
    command: string;
    lines: CommandLine[];
    reason?: string | null;
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
  /* `CommandClamp` 의 명령 상자와 같은 면 · 글꼴 */
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

  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    column-gap: var(--space-2);
    align-items: start;
  }
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
  .row.quiet .text,
  .row.quiet .num {
    color: color-mix(in srgb, var(--fg-3) 55%, transparent);
  }
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
