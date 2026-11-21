<script lang="ts">
  /**
   * 명령 · SQL 상자 — 보이는 줄 두 줄 접기.
   * 보안: 승인은 명령 전문이 보이는 자리에서만 — 잘림(`onTruncated`)을 부모에 알리고, 부모가 잘린 채면 첫 [승인] 을 펼치기로 쓴다
   * (`review-card.ts` `approveStep`). 이 조각은 재기만 한다.
   */
  import CodeView from "$lib/CodeView.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  interface Props {
    text: string;
    lang?: "sql" | null;
    expanded: boolean;
    onToggle: () => void;
    onTruncated?: (truncated: boolean) => void;
    expandedLines?: number;
    /** 명령이 잘리지 않아도 펼치면 보일 것이 있다(AI 가 적은 이유) */
    more?: boolean;
  }
  let { text, lang = null, expanded, onToggle, onTruncated, expandedLines = 10, more = false }: Props = $props();

  let box = $state<HTMLElement | null>(null);
  /** 펼친 동안에는 접힌 꼴을 잴 수 없으므로 앞서 잰 값을 쥔다 */
  let truncated = $state(false);

  function measure(): void {
    if (!box || expanded) return;
    const next = box.scrollHeight > box.clientHeight + 1;
    truncated = next;
    onTruncated?.(next);
  }

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
  /* 긴 한 줄은 접어 내린다 — 가로 스크롤이 생기면 줄 끝의 `; rm …` 이 화면 밖에 숨는다 */
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
