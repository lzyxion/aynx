<script lang="ts">
  // [새 앨범] 구성 판의 절 하나 — 번호 원 · 굵은 제목 · 회색 한 줄 설명 · 오른쪽 끝 동작(목업 V3NewAlbum). 둥근 면 카드다.
  import type { Snippet } from "svelte";
  let { num, title, hint = "", action, children, ...rest }: { num: number; title: string; hint?: string; action?: Snippet; children?: Snippet; [k: string]: unknown } = $props();
</script>

<section class="card" {...rest}>
  <header><span class="num" aria-hidden="true">{num}</span><h3>{title}</h3>{#if hint}<span class="hint">· {hint}</span>{/if}{#if action}<span class="act">{@render action()}</span>{/if}</header>
  {@render children?.()}
</section>

<style>
  .card { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 14px 18px; border-radius: var(--radius-surface-inner); background: var(--surface-hover); }
  header { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .num { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--control-sel-bg); color: var(--control-sel-fg); font-size: var(--t-xs); font-weight: 700; }
  h3 { margin: 0; font-size: var(--t-sm); font-weight: 700; color: var(--fg-1); }
  .hint { min-width: 0; font-size: var(--t-xs); color: var(--fg-3); overflow-wrap: anywhere; }
  .act { margin-left: auto; }
</style>
