<script lang="ts" module>
  export type IconSegment = "logos" | "basic";

  /** 마지막으로 고른 칸 — 창이 사는 동안만 기억한다(저장하지 않는다). */
  let rememberedSegment: IconSegment = "logos";
</script>

<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { onMount } from "svelte";
  import {
    HOST_ICONS,
    HOST_ICON_NAMES,
    ICON_PREFIX,
    iconNameOf,
    iconRef,
    logosNameOf,
    lucideNameOf,
    searchIcons,
    searchLucide,
    type IconHit,
  } from "$lib/host-icons";
  import { iconDisplayName } from "$lib/host-meta-hint";
  import { ensureLogos, ensureLucide, logosSet, lucideSet } from "$lib/icon-sets.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 아이콘 고르개 (docs/log/2026-09-04-icons-and-rows.md). 값은 늘 문자열 한 칸(`svg:<이름>` · 이모지 글자 · 빈 문자열)이고 빈 값의 뜻은 저장하는 쪽이 정한다.
   * 칸은 값이 아니라 검색창이다 — 걸리는 것이 있으면 값은 Enter·클릭이 정하고, 두 칸(기본 · 로고) 모두 걸리는 것이 없을 때만 친 글자가 값(이모지 길)이 된다.
   * 저장 형식(`svg:`)은 칸에 띄우지 않는다.
   */

  /** 로고 라벨은 생성 표의 글자 그대로다 — 로고 이름은 번역하지 않는다(검색어 쪽은 별칭 `keywords` 가 한국어를 받는다). */
  const iconLabel = (name: string): string => HOST_ICONS[name].label;

  const CURATED: IconHit[] = HOST_ICON_NAMES.map((name) => ({ ref: iconRef(name), label: iconLabel(name) }));

  const FEATURED: IconHit[] = searchLucide("", null).hits;

  onMount(() => {
    void ensureLogos();
    void ensureLucide();
  });

  let {
    value = $bindable(""),
    id,
    placeholder = "",
    ariaLabel = t("app.icon.aria"),
    inherited = null,
    fallback = "none",
    resetTitle = t("app.icon.reset"),
    resetAria,
    inlineEdit = false,
    inputEl = $bindable(null),
    onsubmit,
    color = null,
  }: {
    value: string;
    id?: string;
    placeholder?: string;
    ariaLabel?: string;
    inherited?: string | null | undefined;
    fallback?: "none" | "server" | "folder";
    resetTitle?: string;
    resetAria?: string;
    /** `data-inline-edit` 을 단다 — `+page` 의 `isInlineEditTarget` 이 보는 임시 편집기 표시다. */
    inlineEdit?: boolean;
    inputEl?: HTMLInputElement | null;
    onsubmit?: () => void;
    color?: string | null;
  } = $props();

  function displayOf(v: string): string {
    const name = iconNameOf(v);
    if (name !== null) return iconLabel(name);
    return logosNameOf(v) ?? lucideNameOf(v) ?? (v.trim().startsWith(ICON_PREFIX) ? iconDisplayName(v) : v);
  }

  function segmentOf(v: string): IconSegment {
    if (lucideNameOf(v) !== null) return "basic";
    if (iconNameOf(v) !== null || logosNameOf(v) !== null) return "logos";
    return rememberedSegment;
  }

  let segment = $state<IconSegment>(segmentOf(value));

  function setSegment(next: IconSegment): void {
    segment = next;
    rememberedSegment = next;
  }

  function searchIn(seg: IconSegment, q: string): { hits: IconHit[]; total: number } {
    return seg === "logos" ? searchIcons(q, logosSet()) : searchLucide(q, lucideSet());
  }

  const SEGMENTS: readonly IconSegment[] = ["basic", "logos"];
  const segLabel = (seg: IconSegment): string => t(seg === "logos" ? "app.icon.seg.logos" : "app.icon.seg.basic");

  const otherSegment = $derived<IconSegment>(segment === "logos" ? "basic" : "logos");

  /** 칸에 보이는 글자. **값과 따로 산다** — 치는 동안은 검색어이기 때문이다 */
  let text = $state(displayOf(value));

  let query = $state<string | null>(null);

  /** 마지막으로 우리가 그린 값 — 없으면 아래 `$effect` 가 치던 글자를 매 입력마다 값으로 덮어써 이모지를 두 글자 이상 칠 수 없다. */
  let lastValue = value;

  let gridEl = $state<HTMLElement | null>(null);

  function setValue(next: string): void {
    value = next;
    lastValue = next;
  }

  $effect(() => {
    const v = value;
    if (v === lastValue) return;
    lastValue = v;
    text = displayOf(v);
    query = null;
  });

  const found = $derived(query === null ? null : searchIn(segment, query));
  const hits = $derived(found?.hits ?? null);
  const more = $derived(found ? found.total - found.hits.length : 0);
  const searching = $derived(query !== null && query.trim() !== "");
  const otherTotal = $derived(searching && query !== null ? searchIn(otherSegment, query).total : 0);
  const shown = $derived(
    searching && hits && hits.length > 0 ? hits : segment === "logos" ? CURATED : FEATURED,
  );
  const hint = $derived(searching && hits && hits.length > 0 ? hits[0] : null);
  const noMatch = $derived(searching && hits !== null && hits.length === 0 && otherTotal === 0);

  /** 걸리는 것이 있으면 값은 그대로 두고 격자만 좁힌다 — 치는 도중에 값이 바뀌면 고르기도 전에 엉뚱한 아이콘이 붙는다. */
  function onInput(): void {
    query = text;
    if (text.trim() === "") {
      setValue("");
      return;
    }
    // 이모지 길은 **두 칸 모두** 빈 때만 — 한 칸만 보면 다른 칸에 있는 이름이 글자 값이 된다.
    if (searchIn("logos", text).total === 0 && searchIn("basic", text).total === 0) setValue(text);
  }

  function pick(hit: IconHit): void {
    if (value === hit.ref) {
      setValue("");
      text = "";
    } else {
      setValue(hit.ref);
      text = hit.label;
    }
    query = null;
  }

  function keydown(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      // 검색 중이면 Enter 는 **고르는 키**다 — 폼 제출로 새지 않는다.
      if (hint !== null) {
        ev.preventDefault();
        pick(hint);
        onsubmit?.();
        return;
      }
      if (onsubmit) {
        ev.preventDefault();
        onsubmit();
      }
      return;
    }
    if (ev.key === "ArrowDown") {
      const first = gridEl?.querySelector<HTMLButtonElement>(".pick");
      if (first) {
        ev.preventDefault();
        first.focus();
      }
    }
  }
</script>

<div class="icon-field" data-inline-edit={inlineEdit ? "" : undefined}>
  <div class="seg" role="group" aria-label={t("app.icon.seg.aria")}>
    {#each SEGMENTS as seg (seg)}
      <button
        type="button"
        class="seg-btn"
        class:on={segment === seg}
        aria-pressed={segment === seg}
        data-icon-seg={seg}
        onclick={() => setSegment(seg)}>{segLabel(seg)}</button
      >
    {/each}
  </div>
  <div class="row">
    <span class="preview" class:inherited={!value && !!inherited}>
      <HostIcon icon={value || inherited} size={18} {fallback} {color} />
    </span>
    <input
      {id}
      bind:value={text}
      bind:this={inputEl}
      {placeholder}
      aria-label={ariaLabel}
      autocomplete="off"
      spellcheck="false"
      oninput={onInput}
      onkeydown={keydown}
    />
    <button
      type="button"
      class="reset btn btn-secondary"
      title={resetTitle}
      aria-label={resetAria ?? resetTitle}
      onclick={() => {
        setValue("");
        text = "";
        query = null;
      }}
    >
      <UiIcon name="reset" size={13} />
    </button>
  </div>
  <div class="grid" role="group" aria-label={t("app.icon.builtin")} bind:this={gridEl}>
    {#each shown as hit (hit.ref)}
      <button
        type="button"
        class="pick"
        class:on={value === hit.ref}
        class:hint={hit.ref === hint?.ref}
        aria-pressed={value === hit.ref}
        title={hit.label}
        onclick={() => pick(hit)}
      >
        <HostIcon icon={hit.ref} size={20} label={hit.label} />
      </button>
    {/each}
  </div>
  {#if searching && more > 0}
    <p class="nomatch">{t("app.icon.more", { n: more })}</p>
  {/if}
  {#if searching && otherTotal > 0}
    <button type="button" class="other" data-icon-other={otherSegment} onclick={() => setSegment(otherSegment)}>
      {t("app.icon.other", { seg: segLabel(otherSegment), n: otherTotal })}
    </button>
  {/if}
  {#if noMatch}
    <p class="nomatch">{t("app.icon.nomatch")}</p>
  {/if}
</div>

<style>
  .icon-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .seg {
    display: inline-flex;
    align-self: flex-start;
    gap: 2px;
    padding: 2px;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .seg-btn {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .seg-btn:hover {
    color: var(--fg-1);
  }

  .seg-btn.on {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .seg-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .other {
    align-self: flex-start;
    margin: 0;
    padding: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    background: none;
    border: none;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .other:hover {
    color: var(--fg-1);
  }

  .other:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .row {
    display: flex;
    gap: var(--space-2);
    min-width: 0;
    align-items: center;
  }

  .preview {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
  }

  .preview.inherited {
    opacity: 0.5;
  }

  /* 표준 입력 칸(`--field-*`)의 값을 여기 한 벌 적는다(스코프 CSS 가 넘지 않는다) · 가운데 정렬은 뺀다 — 긴 이름이 가운데에서 잘리면 어디가 잘렸는지 모른다. */
  input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  /* 포커스는 중성 — 폼 칸과 같은 값 (docs/log/2026-09-25-finish-menus.md) */
  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  /* 모양은 전역 `.btn .btn-secondary` — 여기 스코프 규칙을 더하면 전역 클래스를 이긴다. */
  .reset {
    flex: 0 0 auto;
  }

  .row .reset {
    height: var(--field-height);
  }

  /* 검색으로 좁혀도 칸 크기는 그대로다 — 남은 것이 커지면 같은 로고가 자리마다 다른 크기로 보인다. */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(30px, 1fr));
    gap: 2px;
    max-height: 108px;
    overflow-y: auto;
    padding: var(--space-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--field-radius-multi);
  }

  /* 둥근 모서리에 스크롤바 막대 끝이 먹히지 않게 트랙을 곡선 안쪽으로 줄인다 */
  .grid::-webkit-scrollbar-track {
    margin-block: var(--space-2);
  }

  .pick {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .pick:hover {
    background: var(--surface-hover);
  }

  /* 검색의 첫 줄 — 호버와 같은 모양인 것이 요점이다(아직 고른 것이 아니다) · `.on` 과 갈라 둔다. */
  .pick.hint {
    background: var(--surface-hover);
  }

  /* 지금 골라진 것 — 강조색 테두리는 쓰지 않는다(컬러 로고의 색과 다툰다). */
  .pick.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .pick:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .nomatch {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    word-break: keep-all;
  }
</style>
