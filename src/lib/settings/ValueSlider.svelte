<script lang="ts">
  /**
   * 설정 슬라이더 — 값(`45%`·`8px`)은 손잡이 바로 위의 작은 말풍선이 보인다(끄는 동안 ·
   * 얹은 동안 · 키보드 포커스 동안). 자리는 값 비율 `--p` 로 손잡이를 따라간다(`.range-val` 의
   * `left`). 읽어 주는 값은 그대로 `aria-valuetext` 다 — 말풍선은 시각 전용이라 `aria-hidden`.
   * 그래서 줄의 설명(툴팁)에는 값을 적지 않는다.
   *
   * 두 모양이 있다:
   *
   * - **연속** (`min`·`max`·`step`) — 앱 테마의 투명도·월페이퍼 슬라이더. 입력값이 곧 값이다.
   * - **후보** (`steps`) — 간격이 고르지 않은 이산 값(UI 크기 80·90·100·110·125·150 · 자동 잠금
   *   0·1·3·5·10·15·30분). 슬라이더는 **후보의 인덱스**(0 ~ n-1, step 1)를 움직이고, setter 에는
   *   그 자리의 실제 값을 넘긴다. 받은 `value` 가 후보에 없으면(손으로 적은 20분) 손잡이는 가장
   *   가까운 후보에 서고, 글자는 실제 값을 그대로 적는다 — 움직이기 전에는 아무것도 쓰지 않는다.
   *
   * `format` 이 값 → 글자(말풍선 · `aria-valuetext`)이고, 없으면 `${value}${unit}` 이다.
   * 값은 **말풍선으로만** 보인다 — 슬라이더 곁에 늘 보이는 값 글자는 두지 않는다(사용자 결정).
   *
   * `commit="change"` 는 **놓을 때만** setter 를 부른다 — 끄는 동안(`input`)은 말풍선만
   * 따라간다. UI 크기처럼 값이 화면 배율 자체를 바꿔 손잡이가 포인터 밑에서 움직이는 칸이 쓴다.
   * 키보드(화살표)는 한 번 누를 때마다 `input`·`change` 가 함께 와서 바로 걸린다.
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
    /** 입력의 `id` — 줄 라벨(`for`)과 설정 색인 anchor 가 여기에 매인다 */
    id: string;
    /** 연속 모양의 범위 — `steps` 를 주면 쓰지 않는다 */
    min?: number;
    max?: number;
    step?: number;
    /** 후보 모양 — 오름차순 값 목록. 주면 슬라이더는 이 목록의 인덱스를 움직인다 */
    steps?: readonly number[];
    value: number;
    /** 값 뒤에 붙는 단위 (`%`·`px`) — `format` 이 없을 때만 쓴다 */
    unit?: string;
    /** 값 → 화면 글자 (말풍선 · `aria-valuetext`) */
    format?: (n: number) => string;
    /** setter 를 부르는 때 — `input`(끄는 동안 계속) · `change`(놓을 때) */
    commit?: "input" | "change";
    disabled?: boolean;
    onchange: (n: number) => void;
  } = $props();

  const label = (n: number) => (format ? format(n) : `${n}${unit}`);

  /** 후보 중 `v` 에 가장 가까운 것의 인덱스 (거리가 같으면 앞의 것) */
  function nearestIndex(list: readonly number[], v: number): number {
    let best = 0;
    for (let i = 1; i < list.length; i++) {
      if (Math.abs(list[i] - v) < Math.abs(list[best] - v)) best = i;
    }
    return best;
  }

  /** `commit="change"` 에서 끄는 동안의 값 — 놓으면(`change`) 비운다 */
  let pending = $state<number | null>(null);

  /** 지금 화면에 보일 값 — 끄는 중이면 그 값, 아니면 받은 값 */
  const shown = $derived(pending ?? value);
  /** 입력의 위치 — 후보 모양이면 인덱스, 연속이면 값 그대로 */
  const pos = $derived(steps ? nearestIndex(steps, shown) : shown);
  const lo = $derived(steps ? 0 : min);
  const hi = $derived(steps ? Math.max(steps.length - 1, 0) : max);
  const ratio = $derived(hi > lo ? (pos - lo) / (hi - lo) : 0);
  const text = $derived(label(shown));

  /** 입력의 위치 → 값 */
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
    --thumb: 4px; /* 손잡이 폭(아래 `::-webkit-slider-thumb`) — 손잡이 중심은 양끝에서 반 폭 안쪽을 오간다 */
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  /* MD3 expressive 슬라이더(2026-10-18 — End-4 식 목업): 16px 트랙, 손잡이까지 = primary · 나머지 = secondaryContainer
     (`--control-track`), 손잡이 양옆 6px 틈, 손잡이 = 4×28 세로 막대(primary — 실기: 44 는 길었다), 오른쪽 끝 4px 점(primary).
     채움 끝은 말풍선과 같은 셈(손잡이 중심)이다. 트랙 안쪽 끝의 둥근 모서리는 그리지 않는다(배경 한 겹 — 직각).
     WebView2(크로미엄)만 그리므로 `-webkit-` 가상 요소 하나로 충분하다 */
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

  /* 포커스 링은 중성(`--focus-ring`) — 손잡이 둘레에만 */
  input[type="range"]:focus-visible::-webkit-slider-thumb {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  input[type="range"]:disabled {
    opacity: 0.45;
    cursor: default;
  }

  /* 앱 툴팁(`Tooltip.svelte` 의 `.tip`)과 같은 면 — 비치지 않는 뜬 판 · 진한 선 · 작은 글자.
     기준점은 손잡이 중심이고, 말풍선은 값 비율만큼 왼쪽으로 민다(0 → 왼쪽 맞춤, 1 → 오른쪽 맞춤) —
     가운데 맞춤(-50%)이면 끝 값에서 말풍선 반쪽이 트랙 밖으로 나가, 숨겨져 있어도(opacity 0)
     패널 오른쪽 끝의 슬라이더가 설정 패널에 가로 스크롤을 만든다. */
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

  /* 끄는 동안(`:active` 는 포인터가 트랙 밖으로 나가도 놓을 때까지 남는다) · 얹은 동안 · 키보드 포커스 */
  .range-tip:hover .range-val,
  .range-tip:has(input:active) .range-val,
  .range-tip:has(input:focus-visible) .range-val {
    opacity: 1;
  }

  /* 꺼진 슬라이더(예: 월페이퍼가 없을 때)는 값을 띄우지 않는다 */
  .range-tip:has(input:disabled) .range-val {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .range-val {
      transition: none;
    }
  }
</style>
