<script lang="ts">
  /**
   * **JSON 트리 한 마디**(블록 리치 보기 — `term/BlockView.svelte`). 객체 · 배열은 ▸/▾ 로 접고 펴며 개수를 말하고, 값은 종류별 색
   * (문자열 · 수 · 참거짓 · null)이다. 처음에는 깊이 [`OPEN_DEPTH`] 미만만 펼친다. 아이가 많으면 [`MAX_CHILDREN`] 개까지 그리고
   * "… N개 더" 한 줄(큰 배열이 화면을 붙잡지 않게). 값은 글자 보간으로만 그린다(`{@html}` 없음).
   */
  import JsonTree from "./JsonTree.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { value, name = null, depth = 0 }: { value: unknown; name?: string | null; depth?: number } = $props();

  const OPEN_DEPTH = 2;
  const MAX_CHILDREN = 200;

  const isObj = $derived(typeof value === "object" && value !== null);
  const entries = $derived.by((): [string, unknown][] => {
    if (!isObj) return [];
    return Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value as Record<string, unknown>);
  });
  // 처음 펼침만 깊이로 정한다(그 뒤는 사람이 누른 대로) — 마디는 깊이가 바뀌지 않는다
  // svelte-ignore state_referenced_locally
  let open = $state(depth < OPEN_DEPTH);
  const kind = $derived(
    value === null ? "null" : typeof value === "string" ? "str" : typeof value === "number" ? "num" : typeof value === "boolean" ? "bool" : "other",
  );
</script>

<div class="jt" style:padding-left="{depth === 0 ? 0 : 16}px">
  {#if isObj}
    <button type="button" class="node" aria-expanded={open} onclick={() => (open = !open)} data-json-node={name ?? "$"}>
      <span class="chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      {#if name !== null}<span class="key">{name}</span>{/if}
      <span class="meta">{Array.isArray(value) ? "[ ]" : "{ }"} {t("pane.blockview.count", { n: entries.length })}</span>
    </button>
    {#if open}
      {#each entries.slice(0, MAX_CHILDREN) as [k, v] (k)}
        <JsonTree value={v} name={k} depth={depth + 1} />
      {/each}
      {#if entries.length > MAX_CHILDREN}
        <div class="more">{t("pane.blockview.more", { n: entries.length - MAX_CHILDREN })}</div>
      {/if}
    {/if}
  {:else}
    <div class="leaf">
      {#if name !== null}<span class="key">{name}</span><span class="colon">:</span>{/if}
      <span class="v {kind}">{kind === "str" ? JSON.stringify(value) : String(value)}</span>
    </div>
  {/if}
</div>

<style>
  .jt {
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    line-height: 1.8;
  }

  .node {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 0 4px;
    margin-left: -4px;
    font: inherit;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .node:hover {
    background: var(--surface-hover);
  }

  .chev,
  .meta,
  .more,
  .colon {
    color: var(--fg-3);
  }

  .colon {
    margin-right: 6px;
  }

  .key {
    color: var(--accent);
  }

  .leaf {
    overflow-wrap: anywhere;
  }

  .v.str {
    color: var(--ok);
  }

  .v.num {
    color: var(--warn);
  }

  .v.bool {
    color: var(--accent-hover, var(--accent));
  }

  .v.null {
    color: var(--fg-3);
    font-style: italic;
  }
</style>
