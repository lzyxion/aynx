<script lang="ts" module>
  /** `id` 를 안 받은 인스턴스의 목록 id — 한 화면에 여럿이 떠도 겹치지 않게 */
  let seq = 0;
</script>

<script lang="ts" generics="V extends string">
  import HostIcon from "$lib/HostIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import {
    DROPDOWN_GAP,
    TYPEAHEAD_RESET_MS,
    dropdownMaxHeight,
    placeBelowOrAbove,
    typeaheadIndex,
  } from "$lib/dropdown";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **값 하나를 고르는 목록** — 네이티브 `<select>` 를 대신한다
   * (docs/log/2026-09-20-host-form-tabs.md 의 "네이티브 select · datalist → Dropdown · Combobox").
   *
   * 닫힌 손잡이는 예전 `<select>` 와 **같은 모양**이다(같은 토큰·같은 여백). 갈린 것은
   * **열린 목록**뿐인데, 그것이 이 컴포넌트가 생긴 이유다: 네이티브 목록은 Chromium 이
   * 자기 색·자기 모서리로 그려 앱의 다른 "고르는 목록"(`SnippetSuggest` · `HostMenu` 의
   * `.ctx-menu`)과 한 벌로 보이지 않는다. 여기 상자는 그 둘과 **같은 토큰**을 쓴다.
   *
   * ## 자리는 `position: fixed` 다
   *
   * 이 고르개가 사는 호스트 폼의 패널(`.host-panel`)이 `overflow-y: auto` 라, `absolute`
   * 로 두면 상자 밖으로 나가는 목록이 **잘린다**. 그래서 여는 순간 손잡이의
   * `getBoundingClientRect()` 를 떠서 화면 좌표로 앉히고(폭은 손잡이와 같게), 아래가
   * 모자라면 위로 뒤집는다 (셈은 `dropdown.ts` 의 순수 함수 · 유닛 테스트).
   *
   * 그 대신 **스크롤·리사이즈에는 다시 재지 않고 닫는다** — 스크롤을 따라다니는 목록은
   * 프레임마다 재는 값이라 어긋나기 쉽고, 네이티브 `<select>` 도 그 자리에서 닫힌다.
   *
   * ## 몸짓
   *
   * 손잡이에서 `↓`·`↑`·`Enter`·`Space` 로 열고, 목록 안에서 `↓`·`↑`(끝에서 멈춘다 —
   * 네이티브와 같다) · `Home`/`End` 로 옮기고 `Enter`/`Space`·클릭으로 고른다. `Escape`
   * 는 값을 바꾸지 않고 닫는다(그리고 **창의 Escape 사슬로 새지 않게** 거기서 끊는다 —
   * 그러지 않으면 목록만 닫으려던 한 번이 호스트 폼까지 닫는다). 고르거나 닫으면 포커스는
   * 손잡이로 돌아온다.
   *
   * 열린 목록에서 글자를 치면 그 글자로 **시작하는 줄로 건너뛴다**(네이티브와 같다 — 같은 글자를
   * 거듭 치면 다음 줄로 돌고, 잇따라 치면 이어 친 글자로 찾는다. 셈은 `dropdown.ts` 의
   * `typeaheadIndex`).
   *
   * 고르는 순서는 **닫고 나서 값**이다 (`browser/menu-runner.ts` 의 `runOnMenu` — 스냅샷 → 닫기 → 실행).
   *
   * ## 줄 앞 아이콘
   *
   * 항목에 `icon`(HostIcon 이 받는 값 — `iconRef(...)` 의 `svg:` 이름)을 주면 줄과 닫힌 손잡이의
   * 글자 앞에 그린다(설정 › 기본 셸의 셸 로고). 주지 않은 항목은 글자만 선다.
   *
   * ## 묶음 머리글
   *
   * 항목에 `group`(이미 번역된 머리글 글자)을 주면 **같은 `group` 이 잇따른 줄들**을 한 묶음으로 묶고 그 위에
   * 머리글(`.menu-title`)을 세운다(설정 › 터미널 테마의 다크 · 라이트, 2026-10-24). 머리글은 `options` 밖의 그림이라
   * 고를 수 없고, 하이라이트 번호 · `↑↓` · `Home`/`End` · 타이핑 점프 · `aria-activedescendant` 는 지금처럼 `options`
   * 번호로만 움직인다 — 머리글을 건너뛰는 셈이 따로 없다. 접근성은 묶음마다 `role="group"` + 머리글을 가리키는
   * `aria-labelledby`. 묶음 뒤에 오는 `group` 없는 줄은 구분선(`.menu-sep`, 장식) 아래에 선다. 아무 항목도 `group` 을
   * 안 주면 예전과 같은 평평한 목록이다.
   *
   * ## 이름 붙은 칩 (`prefix` · `align`)
   *
   * `prefix`(이미 번역된 이름 글자)를 주면 손잡이 안 값 앞에 그 이름을 세운다 — 손잡이 하나가 "이름 값 ⌄" 칩이 되어 누르는 자리 ·
   * 포커스 고리가 하나다(작업안 기록의 거르기 칩, 2026-11-01). `align: "start"` 면 펼친 목록이 늘 손잡이 왼쪽 끝에 붙는다(기본
   * `"auto"` 는 창 오른쪽 절반의 손잡이면 오른쪽 끝을 맞춘다). 둘 다 안 주면 예전과 같다. 칩의 겉은 부르는 쪽이 `.trigger` 를 덮는다.
   *
   * ## 값의 타입은 부르는 쪽에서 온다
   *
   * `generics="V extends string"` — 셸 통합처럼 세 글자만 허용하는 칸(`"" | "on" | "off"`)이
   * `string` 으로 넓어지면, 고르개가 그 칸에 없는 값을 넣어도 타입이 잡아 주지 못한다.
   */
  let {
    id,
    value = $bindable(),
    options,
    disabled = false,
    ariaLabel,
    labelledby,
    onchange,
    prefix,
    align = "auto",
  }: {
    /** 손잡이 `<button>` 에 붙는다 — 폼의 `<label for>` 이 그대로 이 칸을 가리킨다 */
    id?: string;
    /** 고른 값. 목록에 없는 값이면 손잡이가 그 글자를 그대로 보여 준다 */
    value: V;
    options: readonly { value: V; label: string; icon?: string; group?: string }[];
    disabled?: boolean;
    /** `<label for>` 이 없을 때의 접근성 이름 */
    ariaLabel?: string;
    /** 이름을 그리는 요소의 id — 목록(`role="listbox"`)의 이름이 된다(손잡이는 `<label for>` 로 받는다) */
    labelledby?: string;
    /** 사람이 값을 **골랐을 때만** 불린다(`bind:value` 와 함께 써도 된다) */
    onchange?: (value: V) => void;
    /** 손잡이 안 값 앞의 이름 글자(이미 번역된 것) — 위 "이름 붙은 칩" */
    prefix?: string;
    /** 펼친 목록을 어디에 맞추나 — `"start"` = 늘 손잡이 왼쪽 끝 · `"auto"` = 창 절반 기준(기본) */
    align?: "auto" | "start";
  } = $props();

  /** `id` 를 준 쪽이 라벨을 걸므로 그 글자를 따라간다 — 없으면 인스턴스 번호로 */
  const fallbackId = `dropdown-${++seq}-listbox`;
  const listId = $derived(id ? `${id}-listbox` : fallbackId);

  let open = $state(false);
  /** 하이라이트된 줄 — 키보드가 옮기고 호버가 따라온다 */
  let sel = $state(0);
  let wrapEl = $state<HTMLElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let listEl = $state<HTMLElement | null>(null);
  /** 안쪽 스크롤 상자 — 바깥(`listEl`, 판 · 흐림 층)은 굴리지 않는다(글래스의 흐림 층이 내용과 함께 굴러가지 않게, 10-18) */
  let scrollEl = $state<HTMLElement | null>(null);
  /** 바깥 판의 위아래 안쪽 여백 합(`.menu-surface.md3-list` 의 padding 6px × 2) — 안쪽 상자의 최대 높이에서 뺀다 */
  const LIST_PAD = 12;
  /** 여는 순간 뜬 손잡이의 화면 좌표 (`fixed` 기준) */
  let rect = $state<{ left: number; top: number; bottom: number; width: number; right: number } | null>(null);
  /**
   * 펼친 목록은 손잡이 폭이 **최소**이고 항목 글자만큼 넓어진다(10-18 실기 — 좁은 설정 손잡이에서 "자동 (시스템)" 이 `…` 로 잘렸다).
   * 넓어지는 쪽은 창 안으로 — 손잡이가 창 오른쪽 절반이면 오른쪽 끝을 맞춘다(설정 줄의 고르개는 오른쪽 칸에 선다)
   */
  const alignRight = $derived(
    align === "auto" && rect !== null && typeof window !== "undefined" && rect.left + rect.width / 2 > window.innerWidth / 2,
  );

  const index = $derived(options.findIndex((o) => o.value === value));

  /** 잇따른 같은 `group` 끼리 묶은 토막 — `start` 는 첫 줄의 `options` 번호(줄 id · 하이라이트는 그 번호를 쓴다) */
  const segments = $derived.by(() => {
    const out: { group?: string; start: number; items: (typeof options)[number][] }[] = [];
    options.forEach((o, i) => {
      const last = out.at(-1);
      if (last && last.group === o.group) last.items.push(o);
      else out.push({ group: o.group, start: i, items: [o] });
    });
    return out;
  });
  const label = $derived(index >= 0 ? options[index].label : value);
  const curIcon = $derived(index >= 0 ? options[index].icon : undefined);

  /** 타이핑 점프 — 잇따라 친 글자와 마지막으로 친 시각 */
  let typed = "";
  let typedAt = 0;

  /** 손잡이가 이미 화면에서 사라졌는가 — 탭이 갈리거나(`hidden`) 폼이 닫힌 뒤 */
  function gone(): boolean {
    return !triggerEl?.isConnected || triggerEl.offsetParent === null;
  }

  function openList(): void {
    if (disabled) return;
    const r = triggerEl?.getBoundingClientRect();
    if (!r) return;
    rect = { left: r.left, top: r.top, bottom: r.bottom, width: r.width, right: window.innerWidth - r.right };
    sel = index >= 0 ? index : 0;
    typed = "";
    open = true;
  }

  function close(focusBack = true): void {
    if (!open) return;
    open = false;
    rect = null;
    // 스크롤을 되돌리지 않는다 — 패널이 스크롤돼 닫힌 경우 포커스가 화면을 다시 끌어당긴다
    if (focusBack) triggerEl?.focus({ preventScroll: true });
  }

  /** 스냅샷 → 닫기 → 값 (docs/conventions.md 의 메뉴 통로 `runOnMenu`) */
  function pick(i: number): void {
    runOnMenu(
      () => options[i]?.value,
      () => close(),
      (next) => {
        const changed = next !== value;
        value = next;
        if (changed) onchange?.(next);
      },
    );
  }

  // 목록이 그려지면 높이를 재서 자리를 잡고, 포커스를 준다 (키 처리는 목록이 받는다).
  $effect(() => {
    const el = listEl;
    const r = rect;
    if (!el || !r) return;
    void sel; // 하이라이트가 옮겨 가면 그 줄을 보이는 자리로 끌어온다
    if (scrollEl) scrollEl.style.maxHeight = `${dropdownMaxHeight(r, window.innerHeight) - LIST_PAD}px`;
    el.style.top = `${placeBelowOrAbove(r, el.offsetHeight, window.innerHeight).top}px`;
    el.querySelector("[data-sel]")?.scrollIntoView({ block: "nearest" });
  });

  $effect(() => {
    if (open) listEl?.focus({ preventScroll: true });
  });

  // 창이 움직이면 닫는다 — 조상 패널의 스크롤까지 잡으려면 **캡처 단계**여야 한다
  // (스크롤 이벤트는 버블하지 않는다). **목록 자신의 스크롤은 빼야 한다**(`MultiDropdown` 과 같은 규칙): 고른 값이 목록 아래쪽이면
  // 여는 순간 위 `$effect` 의 `scrollIntoView` 가 목록을 굴리고, 그 스크롤이 여기서 잡혀 **열리자마자 닫혔다**(10-18 실기 —
  // 월페이퍼 full 의 터미널 테마는 값 `dynamic` 이 목록 맨 끝이라 눌러도 안 열렸다). 휠로 긴 목록을 굴려도 닫혔다.
  $effect(() => {
    if (!open) return;
    const bail = () => close(!gone());
    const onScroll = (ev: Event) => {
      if (!(ev.target instanceof Node && listEl?.contains(ev.target))) bail();
    };
    window.addEventListener("resize", bail);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", bail);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  function triggerKeydown(ev: KeyboardEvent): void {
    if (disabled) return;
    // 여는 키는 **열기만** 한다 — 고른 줄이 하이라이트된 채 열린다(옮기는 것은 목록이 받는다)
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (!open) openList();
    }
  }

  function listKeydown(ev: KeyboardEvent): void {
    if (ev.key === "Tab") {
      close();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 창의 Escape 사슬(호스트 폼 닫기)로 새지 않게 여기서 끊는다
      close();
      return;
    }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      pick(sel);
      return;
    }
    // 끝에서 **멈춘다** (돌지 않는다) — 네이티브 `<select>` 와 같은 몸짓이다
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      sel = Math.min(sel + 1, options.length - 1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      sel = Math.max(sel - 1, 0);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      sel = 0;
    } else if (ev.key === "End") {
      ev.preventDefault();
      sel = options.length - 1;
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      // 글자 하나 — 그 글자로 시작하는 줄로 건너뛴다
      const now = Date.now();
      typed = now - typedAt > TYPEAHEAD_RESET_MS ? ev.key : typed + ev.key;
      typedAt = now;
      const hit = typeaheadIndex(
        options.map((o) => o.label),
        typed,
        sel,
      );
      if (hit >= 0) {
        ev.preventDefault();
        sel = hit;
      }
    }
  }
</script>

{#snippet row(o: (typeof options)[number], i: number)}
  <button
    id={`${listId}-o${i}`}
    type="button"
    tabindex="-1"
    class="row menu-row"
    class:selected={i === sel}
    data-sel={i === sel ? "" : undefined}
    data-value={o.value}
    role="option"
    aria-selected={o.value === value}
    onmouseenter={() => (sel = i)}
    onclick={() => pick(i)}
  >
    {#if o.icon}<span class="ico"><HostIcon icon={o.icon} size={14} /></span>{/if}
    <span class="opt-text">{o.label}</span>
    {#if o.value === value}<span class="check"><UiIcon name="check" size={12} /></span>{/if}
  </button>
{/snippet}

<!--
  포커스가 이 덩어리 **밖으로** 나가면 닫는다 — 탭 전환·폼 닫기처럼 목록이 살아남으면
  안 되는 자리를 한 줄로 막는다 (`relatedTarget` 이 안쪽이면 손잡이 ↔ 줄 사이의 이동이다).
-->
<div
  class="dd"
  bind:this={wrapEl}
  onfocusout={(ev) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && wrapEl?.contains(to)) return;
    close(false);
  }}
>
  <button
    {id}
    type="button"
    class="trigger"
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={listId}
    aria-label={ariaLabel}
    {disabled}
    bind:this={triggerEl}
    onclick={() => (open ? close() : openList())}
    onkeydown={triggerKeydown}
  >
    <span class="cur">
      {#if prefix}<span class="prefix">{prefix}</span>{/if}
      {#if curIcon}<span class="ico"><HostIcon icon={curIcon} size={14} /></span>{/if}
      <span class="cur-text">{label}</span>
    </span>
    <UiIcon name="chevron-down" size={13} />
  </button>

  {#if open && rect}
    <!-- 바깥 클릭을 받아 닫는 투명 백드롭 — 목록보다 한 겹 아래 (`HostMenu` 와 같은 모양) -->
    <button
      type="button"
      class="menu-backdrop"
      tabindex="-1"
      aria-label={t("app.dropdown.close.aria")}
      onclick={() => close()}
    ></button>
    <div
      id={listId}
      class="suggest menu-surface menu-keyed md3-list"
      role="listbox"
      tabindex="-1"
      aria-label={labelledby ? undefined : ariaLabel}
      aria-labelledby={labelledby}
      aria-activedescendant={`${listId}-o${sel}`}
      bind:this={listEl}
      style:left={alignRight ? undefined : `${rect.left}px`}
      style:right={alignRight ? `${rect.right}px` : undefined}
      style:min-width="{rect.width}px"
      style:width="max-content"
      style:max-width="calc(100vw - 16px)"
      style:top="{rect.bottom + DROPDOWN_GAP}px"
      onkeydown={listKeydown}
    >
      <div class="md3-scroll" bind:this={scrollEl}>
      {#each segments as seg, si (seg.start)}
        {#if seg.group}
          <div class="group" role="group" aria-labelledby={`${listId}-g${si}`}>
            <div id={`${listId}-g${si}`} class="menu-title group-head" role="presentation">{seg.group}</div>
            {#each seg.items as o, k (o.value)}{@render row(o, seg.start + k)}{/each}
          </div>
        {:else}
          {#if si > 0}<div class="menu-sep" aria-hidden="true"></div>{/if}
          {#each seg.items as o, k (o.value)}{@render row(o, seg.start + k)}{/each}
        {/if}
      {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .dd {
    min-width: 0;
  }

  /*
   * 닫힌 손잡이 — MD3 filled 면(2026-10-18): `--field-height` · surfaceContainerHighest(`--field-bg`) · `--field-radius` · 테두리 없음.
   * 다른 것은 오른쪽 끝의 `▾` 하나뿐이고, 그것은 네이티브가 스스로 그리던 자리다.
   */
  .trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-2) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    text-align: left;
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    box-shadow: var(--glass-ctl-edge, none);
    outline: none;
    cursor: pointer;
  }

  .trigger:hover:not(:disabled) {
    background: var(--control-bg-hover);
  }

  /* 포커스는 중성 링 — 둥근 모양을 따른다 (docs/log/2026-09-25-finish-menus.md) */
  .trigger:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .trigger:disabled {
    opacity: 0.6;
    cursor: default;
  }

  /* 고른 값 한 줄 — 길면 말줄임으로 끊는다 (`▾` 를 밀어내지 않는다) */
  .cur {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    user-select: none;
  }

  /* 이름 칩의 이름 — 값보다 흐리게, 줄지 않는다 */
  .prefix {
    flex: 0 0 auto;
    opacity: 0.8;
    white-space: nowrap;
  }

  .cur-text,
  .opt-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 줄 앞 아이콘 칸 — 로고마다 viewBox 가 달라도 같은 정사각 칸 (`HostIcon` 이 가운데 맞춘다) */
  .ico {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
  }

  /* 줄: 아이콘 · 이름 · (고른 줄이면) 오른쪽 끝 체크 */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .opt-text {
    flex: 1 1 auto;
  }

  /* 묶음 머리글 — 줄 글자와 같은 x 에서 시작하게 `.md3-list .menu-row` 의 안쪽 여백(--space-3)을 따른다 */
  .group-head {
    padding: var(--space-2) var(--space-3) var(--space-1);
    user-select: none;
  }

  .group + .group {
    margin-top: var(--space-1);
  }

  .check {
    display: inline-flex;
    flex: 0 0 auto;
    color: var(--fg-2);
  }

  .trigger :global(.ui-icon) {
    color: var(--fg-3);
  }

  /* 바깥 클릭을 받는 투명 백드롭 — 모달 오버레이(z-100)보다 위다 */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /*
   * 상자·줄은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface` · `.menu-row` · 골라진 줄이 하나인
   * `.menu-keyed`)이다 — 앱 안의 "고르는 목록" 이 서로 다르게 생기면 같은 종류라는 사실이 사라진다.
   * 폭은 손잡이와 같게 인라인으로 온다(네이티브 `<select>` 와 같은 몸짓).
   */
  .suggest {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    overflow: hidden; /* 굴리는 것은 안쪽 `.md3-scroll`(theme.css) */
  }

</style>
