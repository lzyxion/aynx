<script lang="ts">
  /**
   * 값은 말풍선으로만 보인다 — 슬라이더 곁에 늘 보이는 값 글자는 두지 않는다(사용자 결정).
   * `steps` 를 주면 슬라이더는 후보의 인덱스를 움직인다. 받은 값이 후보에 없으면(손으로 적은 값) 움직이기 전에는 아무것도 쓰지 않는다.
   * `commit="change"` 는 값이 화면 배율 자체를 바꿔 손잡이가 포인터 밑에서 움직이는 칸(UI 크기)이 쓴다.
   */
  let {
    id,
    min = 0,
    max = 100,
    step = 1,
    steps,
    value,
    unit = "",
    format,
    commit = "input",
    disabled = false,
    onchange,
  }: {
    /** 줄 라벨(`for`)과 설정 색인 anchor 가 여기에 매인다 */
    id: string;
    min?: number;
    max?: number;
    step?: number;
    /** 오름차순 */
    steps?: readonly number[];
    value: number;
    unit?: string;
    format?: (n: number) => string;
    commit?: "input" | "change";
    disabled?: boolean;
    onchange: (n: number) => void;
  } = $props();

  const label = (n: number) => (format ? format(n) : `${n}${unit}`);

  function nearestIndex(list: readonly number[], v: number): number {
    let best = 0;
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
    }
    return best;
  }

  /** `commit="change"` 에서 끄는 동안의 값 */
  let pending = $state<number | null>(null);

  const shown = $derived(pending ?? value);
  const pos = $derived(steps ? nearestIndex(steps, shown) : shown);
  const lo = $derived(steps ? 0 : min);
  const hi = $derived(steps ? Math.max(steps.length - 1, 0) : max);
  const ratio = $derived(hi > lo ? (pos - lo) / (hi - lo) : 0);
  const text = $derived(label(shown));

  function valueAt(raw: string): number {
    const n = Number(raw);
    return steps ? steps[Math.min(Math.max(Math.round(n), 0), steps.length - 1)] : n;
  }

  function onInput(raw: string) {
    const v = valueAt(raw);
    if (commit === "input") onchange(v);
    // 제자리로 끌어 돌아오면 `change` 가 오지 않는다 — 그때 남은 값이 밖의 값(취소 등)을 가리지 않게 비운다
    else pending = v === value ? null : v;
  }

  function onChange(raw: string) {
    if (commit === "change") onchange(valueAt(raw));
    pending = null;
  }
</script>

<span class="range-tip" style:--p={ratio}>
  <input
    {id}
    type="range"
    min={lo}
    max={hi}
    step={steps ? 1 : step}
    value={pos}
    {disabled}
    oninput={(e) => onInput(e.currentTarget.value)}
    onchange={(e) => onChange(e.currentTarget.value)}
    onblur={() => (pending = null)}
    aria-valuetext={text}
  />
  <span class="range-val" aria-hidden="true">{text}</span>
</span>

<style>
  /* 감싸개 폭 = 슬라이더 폭 — 말풍선의 `100%` 가 곧 트랙 길이다 */
  .range-tip {
    --thumb: 4px; /* `::-webkit-slider-thumb` 의 폭과 같은 값 */
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  /* 채움 끝은 말풍선과 같은 셈(손잡이 중심)이다. WebView2(크로미엄)만 그리므로 `-webkit-` 가상 요소 하나로 충분하다 */
  input[type="range"] {
    --fill: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--p));
    --gap: 6px;
    appearance: none;
    height: 28px; /* 손잡이 막대 높이 — 누르는 자리 */
    margin: 0;
    background: transparent;
    cursor: pointer;
  }

  input[type="range"]::-webkit-slider-runnable-track {
    height: 16px;
    border-radius: 8px;
    background:
      radial-gradient(circle at calc(100% - 8px) 50%, var(--control-on-bg) 2px, transparent 2.5px),
      linear-gradient(
        to right,
        var(--control-on-bg) 0 max(0px, calc(var(--fill) - var(--thumb) / 2 - var(--gap))),
        transparent 0 calc(var(--fill) + var(--thumb) / 2 + var(--gap)),
        var(--control-track) 0 100%
      );
  }

  input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    box-sizing: border-box;
    width: var(--thumb);
    height: 28px;
    margin-top: -6px; /* (16 − 28) / 2 */
    border: none;
    border-radius: 2px;
    background: var(--control-on-bg);
  }

  input[type="range"]:focus-visible {
    outline: none;
  }

  input[type="range"]:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  input[type="range"]:disabled {
    opacity: 0.45;
    cursor: default;
  }

  /* 말풍선은 값 비율만큼 왼쪽으로 민다 — 가운데 맞춤(-50%)이면 끝 값에서 반쪽이 트랙 밖으로 나가, 숨겨져 있어도
     설정 패널에 가로 스크롤을 만든다. */
  .range-val {
    position: absolute;
    bottom: calc(100% + 4px);
    left: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--p));
    transform: translateX(calc(-100% * var(--p)));
    z-index: 2;
    padding: 1px 6px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    line-height: 1.45;
    white-space: nowrap;
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    pointer-events: none;
    opacity: 0;
    transition: opacity 80ms ease-out;
  }

  .range-tip:hover .range-val,
  .range-tip:has(input:active) .range-val,
  .range-tip:has(input:focus-visible) .range-val {
    opacity: 1;
  }

  .range-tip:has(input:disabled) .range-val {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .range-val {
      transition: none;
    }
  }
</style>
