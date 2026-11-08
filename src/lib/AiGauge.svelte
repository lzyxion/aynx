<script lang="ts" generics="S extends string">
  /**
   * **AI 권한 게이지**(2026-10-23 — 사용자 승인 목업 `gauge-mock` · docs/log/2026-10-23-approve-all.md "게이지") — 호스트 폼 AI 칸 · DB 연결 폼 ·
   * 타일 머리줄의 AI 권한 팝오버(원격 · 쿼리 타일)가 **이 고르개 하나**를 쓴다. 예전의 세그먼트 버튼(아이콘 + 이름 다섯 칸) · 라디오 줄을 대신한다.
   *
   * 모양: 왼쪽 작은 고리 = '끔'(고르면 테두리가 찬다), 오른쪽 같은 폭 칸 넷 = 단계 1~4(고른 자리까지 차고, 찬 칸은 **지금 단계의 색** —
   * `theme.css` 의 `--ai-lv*` · 규칙은 `ai-gauge.ts`). 칸 아래 이름 줄(고른 이름은 굵게 + 단계 색), 위 오른쪽에 지금 단계 이름, 아래 설명 한 줄.
   * YOLO(자리 4)이면 카드 테두리 · 설명 상자가 따뜻한 판을 입고 위 오른쪽 이름이 표지(단계 색 판) 모양이 된다.
   *
   * - **자리 하나 = 단추 하나**(`role="radio"` — 칸과 그 아래 이름이 한 단추라 어디를 눌러도 같다). 묶음은 `radiogroup`, ←→ 로 옮긴다
   *   (끝에서 돌지 않는다 — `gaugeKeyStep`). 포커스는 고른 단추 하나만 Tab 에 걸린다(`data-gauge-stop` — 팝오버의 ↑↓ 가 이것을 줄 하나로 센다).
   * - 넓은 꼴(폼): 카드 · 단추 높이 44px 이상. 좁은 꼴(`compact` — 칩 팝오버): 카드 없이 · 32px 이상(이름은 넓은 꼴과 같은 글자 — 10-23 이름이 짧은 영어 낱말이 됐다).
   * - **고르는 규칙은 모른다** — 누르면 `onpick(단계)` 만 올린다. 확인 상자(YOLO) · 저장 · 원격 웹 재확인은 부르는 쪽 그대로다.
   *   값이 바뀌었을 때 포커스가 이 안에 있으면 새로 고른 단추로 옮긴다(저장이 비동기여도 · 확인 상자가 포커스를 가져갔으면 손대지 않는다).
   * - **잠긴 자리**(`lockedFrom` — 10-23 로컬 타일: Off · Read 만, Ask · Auto · YOLO 는 원격 호스트에만): 그 자리부터의 단추는 `disabled` ·
   *   `aria-disabled` · 이름 "… (잠김)" 이고, 칸은 빗금 · 이름은 흐린 글자 + 작은 자물쇠다. ←→ 는 잠긴 자리 앞에서 멈춘다(`gaugeKeyStep`).
   */
  import { tick } from "svelte";
  import { GAUGE_SEGMENTS, gaugeIndex, gaugeKeyStep, gaugeTone, segmentShape } from "$lib/ai-gauge";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";

  let {
    levels,
    value,
    nameOf,
    descOf,
    title = "",
    labelledby,
    label,
    compact = false,
    itemAttr = "stage",
    lockedFrom,
    onpick,
    ...rest
  }: {
    /** 단계 다섯(낮은 것부터 — 0 = 끔) */
    levels: readonly S[];
    /** 지금 단계 — `null` 이면 어느 자리도 고르지 않은 것(DB 연결의 대상이 바뀌어 풀림) */
    value: S | null;
    /** 단계 → 이름(모든 언어에서 같은 짧은 영어 낱말 — Off · Read · Ask · Auto · YOLO, 10-23) — 위 오른쪽 · 눈금 · `aria-label` */
    nameOf: (s: S) => string;
    /** 단계 → 설명 한 줄(말풍선 · 아래 상자) */
    descOf: (s: S) => string;
    /** 카드 머리 왼쪽 글자(없으면 그리지 않는다 — 바깥에 제목이 있는 자리) */
    title?: string;
    labelledby?: string;
    label?: string;
    compact?: boolean;
    /** 단추에 다는 `data-*` 이름 — 호스트 `stage` · DB `level`(예전 세그먼트 단추와 같은 손잡이) */
    itemAttr?: "stage" | "level";
    /** 이 자리부터는 잠겨 고를 수 없다(없으면 모두 고를 수 있다) — 로컬 타일은 2(Off · Read 만) */
    lockedFrom?: number;
    onpick: (s: S) => void;
    [key: `data-${string}`]: unknown;
  } = $props();

  const at = $derived(gaugeIndex(levels, value));
  const tone = $derived(gaugeTone(at));
  const yolo = $derived(at === GAUGE_SEGMENTS);
  const lockAt = $derived(lockedFrom ?? levels.length);

  let group = $state<HTMLElement | null>(null);
  const buttons: HTMLButtonElement[] = $state([]);

  // 값이 바뀌면(키보드 · 저장 뒤 사본) 포커스가 이 묶음 안에 있을 때만 고른 단추로 — 라디오 묶음의 "포커스가 선택을 따라간다"
  $effect(() => {
    const i = at;
    const g = group;
    if (!g || i < 0) return;
    void tick().then(() => {
      if (g.contains(document.activeElement) && document.activeElement !== buttons[i]) buttons[i]?.focus();
    });
  });

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
    ev.preventDefault();
    ev.stopPropagation();
    const next = gaugeKeyStep(at, ev.key, levels.length, lockAt);
    if (next !== null) onpick(levels[next]);
  }
</script>

<div class="gauge" class:compact class:yolo data-ai-tone={tone} data-ai-gauge {...rest}>
  <div class="head">
    {#if title}<span class="title">{title}</span>{/if}
    <span class="now" class:badge={yolo} data-ai-gauge-now>{value === null ? t("app.ai.gauge.none") : nameOf(value)}</span>
  </div>

  <div
    class="track"
    role="radiogroup"
    aria-labelledby={labelledby}
    aria-label={labelledby ? undefined : label}
    tabindex="-1"
    bind:this={group}
    onkeydown={onKey}
  >
    {#each levels as lv, i (lv)}
      {@const on = i === at}
      {@const locked = i >= lockAt}
      <button
        type="button"
        role="radio"
        class="lv"
        class:off={i === 0}
        class:on
        class:locked
        aria-checked={on}
        aria-label={locked ? t("app.ai.gauge.locked", { name: nameOf(lv) }) : nameOf(lv)}
        aria-disabled={locked ? "true" : undefined}
        disabled={locked}
        title={locked ? t("app.ai.gauge.locked", { name: nameOf(lv) }) : descOf(lv)}
        tabindex={on || (at < 0 && i === 0) ? 0 : -1}
        data-gauge-stop={on || (at < 0 && i === 0) ? "" : undefined}
        {...{ [`data-${itemAttr}`]: lv }}
        bind:this={buttons[i]}
        onclick={() => {
          if (!on && !locked) onpick(lv);
        }}
      >
        <span class="mark" aria-hidden="true">
          {#if i === 0}
            <span class="ring" class:on></span>
          {:else}
            <span class="seg" class:filled={at >= i} data-shape={segmentShape(i)}></span>
          {/if}
        </span>
        <span class="tick" aria-hidden="true"
          >{#if locked}<UiIcon name="lock" size={9} />{/if}{nameOf(lv)}</span
        >
      </button>
    {/each}
  </div>

  {#if value !== null}
    <p class="desc" data-ai-gauge-desc>{descOf(value)}</p>
  {/if}
</div>

<style>
  /* 넓은 꼴 — 카드(뜬 면 위 한 겹). 판은 본문색을 옅게 얹어 글래스에서도 비친다. 모서리는 MD3 의 큰 둥근 모양(`--radius-md`) */
  .gauge {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-4) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--fg) 3%, transparent);
  }

  .gauge.yolo {
    border-color: var(--ai-all-line);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 20px;
  }

  .title {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }

  .now {
    margin-left: auto;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--ai-c);
  }

  /* YOLO 표지 — 자리 4 에서만 지금 이름(`.now`)이 이 모양을 입는다(이름이 곧 'YOLO' 라 따로 표지를 세우지 않는다 — 10-23). 판 = 단계 색 · 글자 = 그 위 글자색 */
  .now.badge {
    padding: 0 6px;
    border-radius: 4px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--on-ai-lv4);
    background: var(--ai-lv4);
  }

  /* 자리 다섯 — 첫 칸('끔' 고리)은 고정 폭, 나머지 넷은 같은 폭 */
  .track {
    display: grid;
    grid-template-columns: 48px repeat(4, minmax(0, 1fr));
    gap: 6px;
    outline: none;
  }

  .lv {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-width: 0;
    min-height: 44px;
    padding: 0;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .lv:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .mark {
    display: flex;
    align-items: center;
    height: 28px;
  }

  .seg {
    display: block;
    width: 100%;
    height: 12px;
    border-radius: 4px;
    background: var(--ai-track);
    transition: background-color 120ms ease;
  }

  .seg[data-shape="start"] {
    border-radius: 999px 4px 4px 999px;
  }

  .seg[data-shape="end"] {
    border-radius: 4px 999px 999px 4px;
  }

  .seg.filled {
    background: var(--ai-c);
  }

  .lv:hover .seg:not(.filled) {
    background: color-mix(in srgb, var(--ai-c) 30%, var(--ai-track));
  }

  .ring {
    display: block;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border-radius: 999px;
    border: 2px solid var(--ai-ring);
  }

  .lv:hover .ring,
  .ring.on {
    border-color: var(--ai-lv0);
  }

  .ring.on {
    background: color-mix(in srgb, var(--ai-lv0) 35%, transparent);
  }

  .tick {
    padding-bottom: 2px;
    font-size: var(--t-xs);
    font-weight: 500;
    line-height: 1.3;
    text-align: center;
    word-break: keep-all;
  }

  .lv.off .tick {
    text-align: left;
  }

  .lv:hover .tick {
    color: var(--fg-1);
  }

  .lv.on .tick {
    font-weight: 700;
    color: var(--ai-c);
  }

  /* 잠긴 자리(로컬 타일의 Ask · Auto · YOLO — 10-23 목업 A) — 칸은 빗금 · 이름은 흐린 글자 + 자물쇠. 눌러도 · 호버해도 바뀌지 않는다 */
  .lv.locked {
    cursor: not-allowed;
  }

  .lv.locked .seg,
  .lv.locked:hover .seg:not(.filled) {
    background: repeating-linear-gradient(
      135deg,
      var(--ai-track) 0 3px,
      color-mix(in srgb, var(--ai-track) 40%, transparent) 3px 6px
    );
  }

  .lv.locked .tick,
  .lv.locked:hover .tick {
    color: var(--fg-3);
    opacity: 0.75;
  }

  .lv.locked .tick :global(svg) {
    display: inline-block;
    margin-right: 2px;
    vertical-align: -1px;
  }

  /* 설명 한 줄 — 우물 상자. 모두 승인이면 따뜻한 판 */
  .desc {
    margin: var(--space-1) 0 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-1);
    background: var(--surface-field-solid);
    word-break: keep-all;
  }

  .yolo .desc {
    background: var(--ai-all-soft);
  }

  /* 좁은 꼴 — 칩 팝오버 안(상자는 팝오버가 그린다). 칸은 8px · 단추는 32px 이상 */
  .compact {
    gap: var(--space-1);
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
  }

  .compact .now {
    font-size: var(--t-xs);
  }

  .compact .track {
    grid-template-columns: 30px repeat(4, minmax(0, 1fr));
    gap: 4px;
  }

  .compact .lv {
    min-height: 32px;
  }

  .compact .mark {
    height: 18px;
  }

  .compact .seg {
    height: 8px;
    border-radius: 3px;
  }

  .compact .seg[data-shape="start"] {
    border-radius: 999px 3px 3px 999px;
  }

  .compact .seg[data-shape="end"] {
    border-radius: 3px 999px 999px 3px;
  }

  .compact .ring {
    width: 10px;
    height: 10px;
  }

  .compact .tick {
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compact .desc {
    margin: 0;
    padding: 0;
    background: transparent;
    color: var(--fg-2);
  }

  .compact.yolo .desc {
    background: transparent;
    color: color-mix(in srgb, var(--ai-lv4) 60%, var(--fg-1));
  }

  /* 폰 · 태블릿(원격 웹) — 좁은 꼴도 손가락 크기 */
  @media (pointer: coarse) {
    .compact .lv {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .seg {
      transition: none;
    }
  }
</style>
