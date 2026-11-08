<script lang="ts">
  // **고르기 알약 묶음 = 탭 전환**(목업 V3FoldA — ▶ 펼침 대신). 같은 자리를 바꿔 보여 주고 아래로 길어지지 않는다.
  // 모양은 [새 앨범]의 `.seg`(읽기 | 편집 자동 | 전부 자동)와 같은 토큰 — 바탕 `--surface-field` · 고른 칸 `--control-sel-*`.
  // 접근성은 WAI-ARIA 탭: `role="tablist"` · 고른 탭만 Tab 순서에 · ← → Home End 로 옮긴다. 패널은 부르는 쪽이
  // `id = {idBase}-{탭 id}` · `role="tabpanel"` · `aria-labelledby = {idBase}-{탭 id}-tab` 으로 단다.
  // `name` 은 `data-{name}-tab="{id}"` 이름표의 머리다(하네스가 누른다).
  let {
    tabs,
    value = $bindable(),
    label,
    idBase,
    name,
    wide = false,
    onpick,
  }: {
    tabs: readonly { id: string; label: string; title?: string }[];
    value: string;
    label: string;
    idBase: string;
    name: string;
    /** 판 폭 전체 띠(앨범 화면) — 아니면 글자 폭 알약 묶음 */
    wide?: boolean;
    onpick?: (id: string) => void;
  } = $props();

  let el = $state<HTMLDivElement | null>(null);

  function pick(id: string): void {
    value = id;
    onpick?.(id);
  }

  function onkey(e: KeyboardEvent): void {
    // 수식이 붙은 화살표는 앱 단축키(Alt+화살표 = 타일 포커스 · Ctrl+Alt+화살표 = 확장)의 것이다
    if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
    const i = tabs.findIndex((x) => x.id === value);
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0 || n === 0) return;
    e.preventDefault();
    pick(tabs[to].id);
    el?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  }
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="seg" class:wide role="tablist" aria-label={label} tabindex={-1} bind:this={el} onkeydown={onkey}>
  {#each tabs as tab (tab.id)}
    <button type="button" role="tab" id="{idBase}-{tab.id}-tab" aria-selected={value === tab.id} aria-controls="{idBase}-{tab.id}" tabindex={value === tab.id ? 0 : -1} title={tab.title}
      {...{ [`data-${name}-tab`]: tab.id }} onclick={() => pick(tab.id)}>{tab.label}</button>
  {/each}
</div>

<style>
  .seg { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface-field); max-width: 100%; box-sizing: border-box; overflow-x: auto; scrollbar-width: none; }
  .seg.wide { display: flex; }
  .seg:focus { outline: none; }
  button { flex: 0 0 auto; padding: 5px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--fg-2); font: inherit; font-size: var(--t-xs); white-space: nowrap; cursor: pointer; }
  button:hover { background: var(--control-ghost-hover); color: var(--fg-1); }
  button[aria-selected="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); font-weight: 700; }
  button:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 1px; }
</style>
