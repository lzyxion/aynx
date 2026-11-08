<script lang="ts" module>
  /** 목록 id — 한 화면에 문서 타일이 여럿이어도 겹치지 않게 */
  let seq = 0;
</script>

<script lang="ts">
  /**
   * **문서 보기 타일의 목차** — 거르기 칸 + 제목 목록 + 작은 줄(제목 N개 · 지금 i / N). 넓은 타일의 곁 패널과 좁은
   * 타일의 드롭다운이 이 한 벌을 쓴다(`variant`). 놓는 자리 · 여닫기 · 스크롤 추적은 `DocView` 몫이고, 규칙
   * (목차 만들기 · 거르기 · 지금 절 · 목록 상자 밀기)은 `doc-outline.ts` 의 순수 함수다.
   *
   * 키보드는 칸 하나에서 한다(콤보박스 모양): ↑↓ 로 고를 줄을 옮기고 Enter 로 그 절에 간다. Esc 는 드롭다운이면
   * 닫기 · 패널이면 거르기를 비우고(비어 있으면 본문으로 돌아간다).
   *
   * 목록 상자는 **제 상자만** 민다(`revealScrollTop`) — `scrollIntoView` 는 조상의 넘침 숨김 상자까지 밀어 타일
   * 배치를 흔든다(`DocView` 의 앵커 스크롤과 같은 까닭).
   */
  import { tick } from "svelte";
  import { filterOutline, revealScrollTop, type OutlineItem } from "$lib/doc-outline";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    items,
    current,
    variant,
    onpick,
    onescape,
  }: {
    /** 거르기 전 목차 전체 (`outlineOf`) */
    items: OutlineItem[];
    /** 지금 읽는 절 — `items` 의 자리, 없으면 `-1` */
    current: number;
    /** 곁 패널 · 드롭다운 */
    variant: "panel" | "drop";
    /** 줄을 골랐다(클릭 · Enter) — 상위가 스크롤하고 본문으로 포커스를 돌린다(드롭다운이면 닫기 통로를 지난다) */
    onpick: (item: OutlineItem) => void;
    /** 드롭다운의 Esc · 패널의 빈 칸 Esc — 상위가 닫거나 본문으로 돌아간다 */
    onescape?: () => void;
  } = $props();

  const listId = `doc-outline-${++seq}`;

  let query = $state("");
  /** 키보드로 고른 줄 — 거른 목록 안의 자리 */
  let active = $state(0);
  /** 칸에 포커스가 있다 — 그때만 고른 줄을 칠한다(마우스로 볼 때는 "지금 절" 만 보이게) */
  let typing = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);

  const shown = $derived(filterOutline(items, query));
  /** 들여쓰기의 바닥 — `##` 부터 쓰는 문서가 한 칸 밀려 시작하지 않게 */
  const minLevel = $derived(items.reduce((m, it) => Math.min(m, it.level), 6));

  // 거르기가 바뀌면 고른 줄을 지금 절(없으면 첫 줄)로 되놓는다
  $effect(() => {
    void query;
    const at = shown.findIndex((it) => it.index === current);
    active = at >= 0 ? at : 0;
  });

  // 드롭다운은 열리자마자 칸에 포커스 — 바로 쳐서 거른다
  $effect(() => {
    if (variant === "drop" && inputEl) void tick().then(() => inputEl?.focus({ preventScroll: true }));
  });

  // 지금 절이 바뀌면 목록 상자를 그 줄까지 민다(패널이 길 때)
  $effect(() => {
    const i = current;
    void shown;
    void tick().then(() => reveal(`[data-i="${i}"]`));
  });

  function reveal(selector: string) {
    if (!listEl) return;
    const row = listEl.querySelector<HTMLElement>(selector);
    if (!row) return;
    listEl.scrollTop = revealScrollTop(listEl.scrollTop, listEl.clientHeight, row.offsetTop, row.offsetHeight);
  }

  function move(delta: number) {
    if (shown.length === 0) return;
    active = (active + delta + shown.length) % shown.length;
    const it = shown[active];
    void tick().then(() => reveal(`[data-i="${it.index}"]`));
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    switch (ev.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Enter": {
        const it = shown[active];
        if (it) onpick(it);
        break;
      }
      case "Escape":
        if (variant === "panel" && query !== "") query = "";
        else onescape?.();
        break;
      default:
        return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }

  const optionId = (it: OutlineItem) => `${listId}-${it.index}`;
</script>

<div class="outline" class:drop={variant === "drop"}>
  <input
    bind:this={inputEl}
    bind:value={query}
    class="menu-input filter"
    type="text"
    spellcheck="false"
    autocomplete="off"
    role="combobox"
    aria-expanded="true"
    aria-controls={listId}
    aria-activedescendant={typing && shown[active] ? optionId(shown[active]) : undefined}
    aria-label={t("files.doc.outline.filter")}
    placeholder={t("files.doc.outline.filter")}
    {onkeydown}
    onfocus={() => (typing = true)}
    onblur={() => (typing = false)}
  />
  <ul class="list" id={listId} role="listbox" aria-label={t("files.doc.outline")} bind:this={listEl}>
    {#each shown as it, i (it.index)}
      <!-- 줄 클릭은 마우스의 길 — 키보드는 위 칸의 ↑↓ · Enter 가 같은 일을 한다(콤보박스) -->
      <li
        id={optionId(it)}
        class="row lv{Math.min(it.level, 4)}"
        class:current={it.index === current}
        class:active={typing && i === active}
        role="option"
        tabindex="-1"
        aria-selected={typing && i === active}
        aria-current={it.index === current ? "location" : undefined}
        data-i={it.index}
        title={it.text}
        style:padding-left={`calc(var(--space-2) + ${(it.level - minLevel) * 12}px)`}
        onmousedown={(ev) => ev.preventDefault()}
        onclick={() => onpick(it)}
        onkeydown={(ev) => {
          if (ev.key === "Enter") onpick(it);
        }}
      >
        {it.text || "—"}
      </li>
    {:else}
      <li class="none" role="presentation">{t("files.doc.outline.nomatch")}</li>
    {/each}
  </ul>
  <p class="foot">
    {current >= 0
      ? t("files.doc.outline.count.at", { n: String(items.length), i: String(current + 1) })
      : t("files.doc.outline.count", { n: String(items.length) })}
  </p>
</div>

<style>
  .outline {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    padding: var(--space-2) var(--space-2) 0;
    box-sizing: border-box;
  }

  /* 드롭다운 — 상자(`DocView` 의 `.outline-pop`)가 높이 상한을 쥐고, 목록이 그 안에서 민다 */
  .outline.drop {
    flex: 1 1 auto;
    height: auto;
    padding: 0;
  }

  .filter {
    flex: 0 0 auto;
    margin-top: 0;
  }

  /* 목록 상자 — 길면 이것만 민다. `position: relative` 라 줄의 `offsetTop` 이 이 상자 기준이다 */
  .list {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .row {
    overflow: hidden;
    padding: 3px var(--space-2);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    white-space: nowrap;
    text-overflow: ellipsis;
    border-radius: var(--radius-sm);
    cursor: pointer;
    user-select: none;
  }

  .row.lv1 {
    font-weight: 600;
  }

  /* 깊을수록 흐리게 — 뼈대(h1·h2)가 먼저 눈에 든다 */
  .row.lv3 {
    color: var(--fg-2);
  }

  .row.lv4 {
    color: var(--fg-3);
  }

  .row:hover,
  .row.active {
    background: var(--surface-hover);
  }

  /* 지금 읽는 절 — 앱 목록의 고른 줄(`.item.selected`)과 같은 강조 면 하나 */
  .row.current {
    color: var(--fg-1);
    background: var(--accent-soft);
  }

  .row.active {
    outline: 1px solid var(--line);
    outline-offset: -1px;
  }

  .none {
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .foot {
    flex: 0 0 auto;
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: 11px;
    color: var(--fg-3);
    border-top: 1px solid var(--line);
  }
</style>
