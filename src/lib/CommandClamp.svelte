<script lang="ts">
  /**
   * **명령 · SQL 상자 — 두 줄 접기**(승인 요약 10-22) — 화면 아래 검토 카드(`ReviewCard`)와 작업안 카드(`console/PlanList`)가
   * 같은 조각을 쓴다.
   *
   * 접힌 꼴은 **보이는 줄 기준 두 줄**(`line-clamp` — `\n` 수가 아니라 긴 한 줄이 접혀 내려간 것까지)에서 말줄임이고, 넘칠 때만
   * [전체 보기] 가 선다(펼치면 [접기]). 펼친 꼴은 `expandedLines` 줄까지 상자 안에서 스크롤한다(예전 상자와 같다). SQL 은 접힌 동안
   * 같은 글꼴의 평문, 펼치면 구문 강조(`CodeView`).
   *
   * **보안 — "승인은 명령 전문이 보이는 자리에서만"**(ReviewCard 머리말): 잘려 있는지(`truncated`)를 부모에게 알린다. 부모는 잘린 채
   * 펼치지 않았으면 첫 [승인] 을 승인이 아니라 **펼치기**로 쓴다(`review-card.ts` `approveStep`). 이 조각은 판정하지 않는다 — 재기만 한다.
   * 펼침 상태는 부모가 쥔다(작업안이 바뀌면 부모가 접는다).
   */
  import CodeView from "$lib/CodeView.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    text: string;
    /** `"sql"` 이면 펼친 꼴을 구문 강조로 */
    lang?: "sql" | null;
    expanded: boolean;
    onToggle: () => void;
    /** 접힌 꼴에서 잘리는지 — 잴 때마다 알린다 */
    onTruncated?: (truncated: boolean) => void;
    /** 펼친 꼴의 최대 줄 수(넘치면 상자 안에서 스크롤) */
    expandedLines?: number;
    /** 명령이 잘리지 않아도 펼치면 보일 것이 있다(AI 가 적은 이유) — [전체 보기] 를 세운다 */
    more?: boolean;
  }
  let { text, lang = null, expanded, onToggle, onTruncated, expandedLines = 10, more = false }: Props = $props();

  let box = $state<HTMLElement | null>(null);
  /** 마지막으로 잰 "접으면 잘린다" — 펼친 동안에는 접힌 꼴을 잴 수 없으므로 앞서 잰 값을 쥔다 */
  let truncated = $state(false);

  function measure(): void {
    if (!box || expanded) return;
    const next = box.scrollHeight > box.clientHeight + 1;
    truncated = next; // 같은 값이면 룬이 깨우지 않는다(이 효과는 `truncated` 를 읽지 않는다)
    onTruncated?.(next);
  }

  // 글자 · 폭이 바뀔 때마다 다시 잰다(접힌 동안만 — 펼친 꼴에서는 잘림이 없다).
  $effect(() => {
    void text;
    void expanded;
    const el = box;
    if (!el || expanded) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

{#if expanded && lang === "sql"}
  <div class="sqlbox" style:max-height="calc(1.5em * {expandedLines} + 2 * var(--space-2))">
    <CodeView code={text} {lang} framed />
  </div>
{:else}
  <pre
    class="cmd"
    class:clamped={!expanded}
    data-cmd-clamped={!expanded && truncated}
    style:max-height={expanded ? `calc(1.5em * ${expandedLines})` : null}
    bind:this={box}>{text}</pre>
{/if}
{#if truncated || expanded || more}
  <button type="button" class="more" aria-expanded={expanded} onclick={onToggle}
    >{t(expanded ? "app.review.cmd.less" : "app.review.cmd.more")}</button
  >
{/if}

<style>
  /*
    명령 상자 — 줄바꿈 그대로(`pre-wrap`), 긴 한 줄은 접어 내린다(`overflow-wrap: anywhere` — 가로 스크롤이 생기면 줄 끝의
    `; rm …` 이 화면 밖에 숨는다). 접힌 꼴은 보이는 줄 두 줄에서 말줄임, 펼친 꼴은 상자 안에서 스크롤.
  */
  .cmd {
    flex: none;
    margin: 0;
    padding: var(--space-2) var(--space-3);
    box-sizing: content-box;
    overflow-y: auto;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--fg-1);
    background: var(--bg-base);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .cmd.clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .sqlbox {
    overflow: auto;
  }
  /* [전체 보기] · [접기] — 글자 단추(주 동작이 아니다) */
  .more {
    align-self: flex-start;
    padding: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
    background: transparent;
    border: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .more:hover {
    color: var(--fg-1);
  }
</style>
