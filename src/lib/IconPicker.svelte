<script lang="ts" module>
  /** 고르개 머리의 두 칸 — 컬러 로고(큐레이션 + logos 전체) / 단색 일반 아이콘(lucide 전체) */
  export type IconSegment = "logos" | "basic";

  /**
   * 마지막으로 고른 칸 — **창이 사는 동안만** 기억한다(모듈 하나에 한 값, 저장은 안 한다).
   * 폴더 메뉴와 호스트 폼이 같은 기억을 나눈다: "기본" 을 쓰는 사람은 대개 계속 그 칸을 쓴다.
   */
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
   * **아이콘 고르개** — 미리보기 + 검색 칸 + 내장 로고 격자 한 덩어리
   * (docs/log/2026-09-04-icons-and-rows.md).
   *
   * 세 곳이 이것 하나를 쓴다 — 호스트 **속성 폼**(`HostForm`) · **폴더 편집**(`FolderEditDialog`) ·
   * **프로젝트 폼**(`ProjectForm`). 셋 다 색 칸과 묶인 `IconColorFields.svelte` 를 지난다
   * (docs/log/2026-09-29-folder-project-icons.md). 원래 격자는 호스트 폼 안에만 있어서 폴더는 `svg:docker` 를 **손으로
   * 타이핑해야만** 고를 수 있었다 — 같은 저장 형식을 쓰면서 고르는 방법만 둘이었다.
   * 컴포넌트로 뽑아 두면 로고가 늘거나 격자 모양이 바뀔 때 두 곳이 저절로 같이 따라온다.
   *
   * 값은 언제나 **문자열 한 칸**이다: 로고를 고르면 `svg:<이름>`, 이모지를 치면 그 글자,
   * 비우면 빈 문자열. 저장하는 쪽(호스트 메타 · 그룹 메타)이 빈 값의 뜻을 정하므로
   * (호스트는 상속으로 되돌리기, 폴더는 기본 폴더로 되돌리기) 여기서는 해석하지 않는다.
   *
   * ## 칸은 값이 아니라 **검색창**이다 (2026-09-20)
   *
   * 예전에는 이 칸이 값에 직접 묶여 있어 `svg:ubuntu` 라는 **저장 형식이 화면에 그대로**
   * 떴다. 사람에게 그 접두사는 아무 뜻도 없고(내부 표식이다), 서른네 칸을 눈으로 훑어야만
   * 원하는 로고를 찾을 수 있었다. 이제 칸에는 `Debian` 이라는 **라벨**이 보이고, 글자를
   * 치면 격자가 그 글자로 좁혀진다 (`matchIcons` — 이름·라벨·별칭, 접두사 먼저).
   *
   * 그래서 화면의 상태가 셋이다:
   *
   * | 친 글자 | 격자 | 값 |
   * | --- | --- | --- |
   * | 없음 | 전부 (고른 것에 `.on`) | 그대로 |
   * | 걸리는 것 있음 | **걸린 것만**, 첫 줄에 `hint` | **아직 안 바꾼다** — Enter·클릭이 정한다 |
   * | 걸리는 것 없음 | 전부 (고를 길은 남긴다) | **친 글자 그대로** (= 이모지 길) + 안내 한 줄 |
   *
   * 셋째 줄이 이 칸의 예전 성격을 그대로 지킨다 — 이모지는 어차피 검색으로 찾을 수 있는
   * 물건이 아니고, 이 칸의 자유 입력이 그 사람들의 유일한 길이다.
   *
   * 격자를 칸 **아래**에 둔 것은, 이미 이모지를 쓰던 사람의 눈에 먼저 들어오는 것이
   * 예전과 같은 그 칸이어야 해서다.
   *
   * ## logos 전체까지 찾는다 (2026-09-29)
   *
   * 빈 칸의 격자는 여전히 큐레이션 서른네 개다. 글자를 치면 그 뒤에 **logos 전체**(2,110개,
   * `svg:logos:<이름>`)가 이어 붙는다 — 표는 이 고르개가 열릴 때 받아 온다(`ensureLogos`).
   * 한 번에 그리는 칸은 [`ICON_SEARCH_CAP`] 까지이고, 넘치면 "N개 더" 한 줄이 좁히라고 말한다
   * (docs/log/2026-09-29-logos-full-icons.md).
   *
   * ## 두 칸 — 기본 / 로고 (2026-09-29)
   *
   * 머리의 두 칸 스위치(차례는 기본 → 로고 — 같은 날 폴더·프로젝트 편집 개편에서 바꿨다)가 **어느 표를 보는가**를 가른다. "로고" 는 위 그대로(큐레이션 + logos),
   * "기본" 은 lucide 전체(1,909개 단색 선 — 서버·DB·라우터…, `svg:lucide:<이름>`)이고 빈 칸은
   * 고른 스물네 개(`LUCIDE_FEATURED`)다. 검색은 고른 칸만 보고, **다른 칸에 걸리는 것이 있으면**
   * "기본에서 N개" 한 줄이 그 칸으로 옮겨 준다. 이모지 길은 **두 칸 모두** 비었을 때만이다 —
   * 한 칸만 보고 이모지로 떨어뜨리면 `database` 를 로고 칸에서 친 사람의 값이 글자가 된다.
   *
   * 여는 칸은 값이 말하면 그 칸(`svg:lucide:` → 기본, 로고 → 로고), 아니면 이 창에서 마지막으로
   * 고른 칸이다. 미리보기는 `color`(호스트 색)를 입는다 — 목록에서 보일 그대로.
   */

  /**
   * 로고 라벨은 생성 표(`host-icons.generated.ts`)의 글자 그대로다 — 전부 고유명(Bash ·
   * Ubuntu · Docker …)이고 두 언어에서 같다. 한때 "터미널" 하나만 사전으로 옮겼는데, 검색해
   * 고른 이름이 칸에서 다른 글자로 바뀌어 보여 **로고 이름은 번역하지 않는다**로 정했다
   * (검색어 쪽은 별칭 `keywords` 가 한국어를 받는다).
   */
  const iconLabel = (name: string): string => HOST_ICONS[name].label;

  /** 빈 칸일 때의 격자 — 큐레이션 서른네 개 (예전 그대로) */
  const CURATED: IconHit[] = HOST_ICON_NAMES.map((name) => ({ ref: iconRef(name), label: iconLabel(name) }));

  /** "기본" 칸의 빈 격자 — 고른 스물네 개 (표가 없어도 이름만으로 선다) */
  const FEATURED: IconHit[] = searchLucide("", null).hits;

  // 고르개가 열리면 두 표를 다 받아 둔다 — 치기 시작할 때 이미 와 있게 ("다른 칸에서 N개" 도 둘을 본다).
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
    /** 저장될 값 그대로 (`svg:ubuntu` · `🚀` · `""`) */
    value: string;
    /** `<label for>` 이 가리킬 입력 id (폼에서만 쓴다) */
    id?: string;
    placeholder?: string;
    ariaLabel?: string;
    /** 값이 비었을 때 **미리보기만** 대신 그릴 값 — 호스트 폼의 상속 아이콘 */
    inherited?: string | null | undefined;
    /** 값도 상속도 없을 때 미리보기가 그리는 것 (`HostIcon` 과 같은 뜻) */
    fallback?: "none" | "server" | "folder";
    resetTitle?: string;
    /** 되돌리기 단추의 접근성 이름 — 없으면 `resetTitle` 그대로 (말풍선이 "지우기 — …" 처럼 칸 이름을 뺄 때 준다) */
    resetAria?: string;
    /**
     * `data-inline-edit` 을 단다 — **한 번 열었다가 Enter/Escape 로 닫는 임시 편집기**
     * 라는 표시다 (`+page` 의 `isInlineEditTarget`). 컨텍스트 메뉴 안에서 켠다.
     */
    inlineEdit?: boolean;
    /** 입력 칸 자체 — 여는 쪽이 포커스를 주려고 받아 간다 */
    inputEl?: HTMLInputElement | null;
    /** 칸에서 Enter — 인라인 편집기가 확정하는 자리 (없으면 Enter 는 아무 일도 안 한다) */
    onsubmit?: () => void;
    /** 미리보기의 단색(lucide) 아이콘이 입는 색 — 호스트 폼의 "색" (없으면 글자색) */
    color?: string | null;
  } = $props();

  /**
   * 값 하나를 사람이 읽는 글자로 — 내장 로고면 라벨, logos·lucide 면 그 이름, 모르는 `svg:` 이름은
   * 접두사를 뗀 읽히는 이름(`iconDisplayName`), 아니면 그 글자 그대로. 저장 형식은 칸에 뜨지 않는다.
   */
  function displayOf(v: string): string {
    const name = iconNameOf(v);
    if (name !== null) return iconLabel(name);
    return logosNameOf(v) ?? lucideNameOf(v) ?? (v.trim().startsWith(ICON_PREFIX) ? iconDisplayName(v) : v);
  }

  /** 여는 칸 — 값이 어느 칸의 것인지 말하면 그 칸, 아니면 이 창에서 마지막으로 고른 칸 */
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

  /** 칸 하나의 검색 — 로고는 큐레이션 + logos, 기본은 lucide */
  function searchIn(seg: IconSegment, q: string): { hits: IconHit[]; total: number } {
    return seg === "logos" ? searchIcons(q, logosSet()) : searchLucide(q, lucideSet());
  }

  /** 머리의 차례 — **기본, 로고** (2026-09-29). 여는 칸의 규칙(`segmentOf`)과는 따로다: 차례만 바꿨다 */
  const SEGMENTS: readonly IconSegment[] = ["basic", "logos"];
  const segLabel = (seg: IconSegment): string => t(seg === "logos" ? "app.icon.seg.logos" : "app.icon.seg.basic");

  const otherSegment = $derived<IconSegment>(segment === "logos" ? "basic" : "logos");

  /** 칸에 보이는 글자. **값과 따로 산다** — 치는 동안은 검색어이기 때문이다 */
  let text = $state(displayOf(value));

  /** 지금 치고 있는 검색어 (`null` = 검색 중이 아니다 — 격자는 평소 모습) */
  let query = $state<string | null>(null);

  /**
   * **마지막으로 우리가 그린 값.** 바깥(폼 열기·되돌리기·상속 힌트)에서 값이 바뀐 것과
   * 우리가 방금 바꾼 것을 가르는 표식이다 — 이것이 없으면 아래 `$effect` 가 사람이 치던
   * 글자를 매 입력마다 값으로 덮어써, 이모지를 두 글자 이상 칠 수 없다.
   */
  let lastValue = value;

  let gridEl = $state<HTMLElement | null>(null);

  /** 우리가 값을 바꿀 때는 표식도 같이 옮긴다 (그래야 아래 효과가 우리 글자를 안 건드린다) */
  function setValue(next: string): void {
    value = next;
    lastValue = next;
  }

  // 바깥에서 값이 바뀌면 칸을 다시 그린다 (그리고 검색은 접는다).
  $effect(() => {
    const v = value;
    if (v === lastValue) return;
    lastValue = v;
    text = displayOf(v);
    query = null;
  });

  /** 검색 결과 — `null` 이면 검색 중이 아니다 */
  const found = $derived(query === null ? null : searchIn(segment, query));
  const hits = $derived(found?.hits ?? null);
  /** 상한에 잘려 안 그린 개수 — "N개 더" 한 줄 */
  const more = $derived(found ? found.total - found.hits.length : 0);
  /** 검색어가 실제로 글자를 담고 있는가 (빈 칸은 "전부 보여 줘" 이지 검색이 아니다) */
  const searching = $derived(query !== null && query.trim() !== "");
  /** 다른 칸에 걸리는 개수 — "기본에서 N개" 한 줄 (검색 중일 때만) */
  const otherTotal = $derived(searching && query !== null ? searchIn(otherSegment, query).total : 0);
  /** 격자가 그리는 것 — 걸린 것이 있으면 그것만, 아니면 그 칸의 평소 모습 */
  const shown = $derived(
    searching && hits && hits.length > 0 ? hits : segment === "logos" ? CURATED : FEATURED,
  );
  /** 첫 줄 표시 — Enter 가 고를 바로 그것 (값은 아직 안 바뀌었다) */
  const hint = $derived(searching && hits && hits.length > 0 ? hits[0] : null);
  /** 두 칸 모두 걸리는 것이 없다 = 이모지를 친 것이다 (안내 한 줄) */
  const noMatch = $derived(searching && hits !== null && hits.length === 0 && otherTotal === 0);

  /**
   * 칸에 글자가 들어왔다.
   *
   * 값을 **바로** 바꾸는 것은 두 갈래뿐이다: 빈 칸(= 지움)과 걸리는 것이 없는 글자
   * (= 이모지). 걸리는 것이 있으면 값은 그대로 두고 격자만 좁힌다 — `de` 를 치는 도중에
   * 값이 `de` 가 되면, 고르기도 전에 이미 이상한 아이콘이 붙는다.
   */
  function onInput(): void {
    query = text;
    if (text.trim() === "") {
      setValue("");
      return;
    }
    // 이모지 길은 **두 칸 모두** 빈 때만 — 한 칸만 보면 다른 칸에 있는 이름이 글자 값이 된다.
    if (searchIn("logos", text).total === 0 && searchIn("basic", text).total === 0) setValue(text);
  }

  /** 하나 고른다 — 클릭·Enter 가 함께 쓰는 길 (같은 것을 다시 고르면 지운다) */
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
    // 칸에서 격자로 — 안쪽은 브라우저의 기본 포커스 이동(화살표·Tab)에 맡긴다.
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
  <!-- 어느 표를 볼까 — 컬러 로고 / 단색 기본. 값은 건드리지 않는다(격자만 바뀐다) -->
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
    <!-- 지금 값의 미리보기 — 목록에서 보일 그대로. 자리는 고정이라 값이 없어도 칸이 안 흔들린다 -->
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
  <!-- 상한에 잘린 것이 있을 때 — 2,000칸을 한꺼번에 그리지 않고 좁히라고 말한다 -->
  {#if searching && more > 0}
    <p class="nomatch">{t("app.icon.more", { n: more })}</p>
  {/if}
  <!-- 다른 칸에도 걸리는 것이 있다 — 누르면 그 칸으로 (검색어는 그대로) -->
  {#if searching && otherTotal > 0}
    <button type="button" class="other" data-icon-other={otherSegment} onclick={() => setSegment(otherSegment)}>
      {t("app.icon.other", { seg: segLabel(otherSegment), n: otherTotal })}
    </button>
  {/if}
  <!--
    걸리는 것이 없을 때의 한 줄 — **실패가 아니라 다른 길**이라고 말한다. 이 칸은 예전부터
    이모지를 받았고, 그 글자는 이미 값이 되어 있다(`onInput`). 빈 칸에는 띄우지 않는다.
  -->
  {#if noMatch}
    <p class="nomatch">{t("app.icon.nomatch")}</p>
  {/if}
</div>

<style>
  /* 칸 + 격자를 한 덩어리로 (폼에서는 `label` 오른쪽 한 칸을 차지한다) */
  .icon-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  /* 기본 / 로고 — 대시보드 사용량 거르개(`UsageBoard` 의 `.seg`)와 같은 결의 작은 두 칸 */
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

  /* "기본에서 N개" — 곁말 크기의 글자 단추 */
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

  /* 미리보기 자리는 고정 — 값이 없어도 칸이 안 흔들린다 */
  .preview {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
  }

  /* 값이 비어 **물려받은** 아이콘을 그리는 중 — 흐리게 (이 호스트에 적힌 값이 아니다) */
  .preview.inherited {
    opacity: 0.5;
  }

  /*
   * 아이콘 칸은 이제 **검색창**이라 긴 글자가 들어온다 (`Raspberry Pi`). 가운데 정렬을
   * 뺀 것도 그래서다 — 긴 이름이 가운데에서 잘리면 앞뒤 어디가 잘렸는지 알 수 없다.
   * 스코프 CSS 는 컴포넌트를 넘지 않으므로 표준 입력 칸(`--field-*` 토큰)의 값을 여기 한 벌
   * 적어 둔다 (폼의 `.fields input` 과 같은 칸으로 보여야 한다).
   */
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

  /* 되돌리기 — 호스트는 상속으로, 폴더는 기본 폴더로 (뜻은 부르는 쪽이 정한다).
     모양은 전역 `.btn .btn-secondary` — 옛 선 두른 규칙은 지웠다(스코프 규칙이 전역 클래스를 이긴다). */
  .reset {
    flex: 0 0 auto;
  }

  /* 칸 옆이니 칸과 같은 높이 — 폭은 전역 `.btn` 그대로 */
  .row .reset {
    height: var(--field-height);
  }

  /*
   * 내장 로고 고르개 — `auto-fill` 격자라 폭에 맞춰 칸 수가 는다 (모달에서는 넓게, 컨텍스트
   * 메뉴에서는 여섯 칸쯤). 높이를 한 번 잘라(`max-height` + 스크롤) 아래 단추들이 화면 밖으로
   * 밀리지 않게 한다. **검색으로 좁혀도 칸 크기는 그대로다** — 두 개만 남으면 상자가 짧아질
   * 뿐이고, 남은 것이 커지면 같은 로고가 자리마다 다른 크기로 보인다.
   */
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

  /* 검색의 첫 줄 — Enter 가 고를 그것. **호버와 같은 모양**인 것이 요점이다: 아직 고른
     것이 아니라 "여기에 손이 얹혀 있다" 는 뜻이라 `.on`(테두리)과 갈라 둔다. */
  .pick.hint {
    background: var(--surface-hover);
  }

  /* 지금 골라져 있는 것 — 선택 판(`--accent-soft`, "강조 셋" 의 선택 행)에 중성 테두리 한 줄.
     강조색 테두리는 걷었다 — 컬러 로고 둘레의 강조색은 로고 색과 다툰다 */
  .pick.on {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .pick:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 안내 한 줄 — 폼의 `.field-note` 와 같은 결(곁말) */
  .nomatch {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    word-break: keep-all;
  }
</style>
