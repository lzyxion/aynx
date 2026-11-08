<script lang="ts">
  import { locale } from "$lib/i18n/i18n.svelte.js";
  import {
    CLOCK_DATE_LINE,
    CLOCK_PAD_X,
    CLOCK_PAD_Y,
    CLOCK_PERIOD_EM,
    CLOCK_PERIOD_GAP_EM,
    clampClockFont,
    clockDateFont,
    clockDateGap,
    clockFace,
    msUntilNextTick,
    type ClockOptions,
  } from "$lib/start-clock";

  /**
   * **시계 위젯** (2026-11-03) — 디지털, 크게: 큰 숫자 시:분(고르면 :초) + 그 아래 날짜 · 요일 한 줄(앱 언어의
   * `Intl.DateTimeFormat`). 카드 없이 글자만 판 위에 뜬다(프레임의 맨몸 `bare` — 윤곽 · × · 크기 모서리는 손이 올라갈 때만).
   * 글자 셈은 순수 `start-clock.ts`, 고른 표시(12/24시간 · 초 · 날짜)는 `start-widgets.svelte.ts` 가 쥐고
   * `StartPage` 가 넘긴다 — 바꾸는 길은 이 위젯 위 우클릭 메뉴(`StartWidgetMenu`) 하나다. 고를 줄이 없어 키보드 선택은 이
   * 위젯을 건너뛴다(`launcher.ts`).
   *
   * **갱신** — 다음 분 경계(초를 보이면 다음 초 경계)에 맞춰 `setTimeout` 을 다시 건다(`msUntilNextTick` — `setInterval` 처럼
   * 밀리지 않는다). 시작 화면의 다른 박자(`StartPage` 의 `now`)와 같은 규칙으로 **보일 때만** 고친다 — 다른 탭에 숨은 시작
   * 타일(`checkVisibility()` 거짓)과 뒤에 있는 창(`document.hidden`)에서는 박자를 건너뛰고, 창이 앞으로 오거나(`visibilitychange`)
   * 숨은 타일이 다시 보이면(`IntersectionObserver`) 곧바로 고치고 경계를 다시 맞춘다. 위젯이 사라지면 타이머 · 귀를 걷는다.
   *
   * **크기 = 글자 크기**(2026-11-03) — 박스가 글자를 꼭 감싼다: 큰 숫자의 글자 크기(`options.size` — 크기 모서리를 끄는 동안은
   * 그 순간의 `font`)를 그대로 쓰고, 날짜 줄 · 틈 · 여백도 같은 셈(`start-clock.ts` 의 `clockDateFont` · `clockDateGap` ·
   * `CLOCK_PAD_*`)이다. 박스 크기는 그 셈으로 `clockBoxSize` 가 정해 배치에 넣는다(시각 값이 아니라 형식으로 — 초마다 박스가 흔들리지
   * 않는다). 숫자는 `tabular-nums`. 판에 칠이 없으니 글자는 앱 글자색에 판 바탕색의 옅은 번짐(`text-shadow`)을 둘러 월페이퍼
   * 위에서도 읽힌다. 박스 어림이 실제 글자보다 조금 넉넉할 수 있어 글자는 가운데에 서고, 모자라도 잘리지 않는다(`overflow: visible`).
   */
  let {
    options,
    font: liveFont,
  }: {
    options: Readonly<ClockOptions>;
    /** 크기 모서리를 끄는 동안의 글자 크기 — 없으면 고른 값(`options.size`) */
    font?: number;
  } = $props();

  const font = $derived(clampClockFont(liveFont ?? options.size));

  let at = $state(new Date());
  let el = $state<HTMLElement | null>(null);

  $effect(() => {
    const seconds = options.seconds;
    const node = el;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const visible = () => !document.hidden && (node.checkVisibility?.() ?? true);
    const schedule = () => {
      timer = setTimeout(tick, msUntilNextTick(Date.now(), seconds));
    };
    function tick() {
      if (visible()) at = new Date();
      schedule();
    }
    /** 곧바로 고치고 경계를 다시 맞춘다 — 숨었다 돌아온 동안 밀린 타이머를 믿지 않는다 */
    const refresh = () => {
      if (timer) clearTimeout(timer);
      if (visible()) at = new Date();
      schedule();
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) refresh();
          });
    io?.observe(node);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      io?.disconnect();
    };
  });

  const face = $derived(clockFace(at, locale(), options));

</script>

<div
  class="clock"
  bind:this={el}
  data-start-clock
  style:padding="{CLOCK_PAD_Y}px {CLOCK_PAD_X}px"
  style:gap="{clockDateGap(font)}px"
>
  <div class="time" style:font-size="{font}px" style:gap="{CLOCK_PERIOD_GAP_EM}em" data-start-clock-time>
    {#if face.period && face.periodFirst}<span class="period" style:font-size="{CLOCK_PERIOD_EM}em">{face.period}</span
      >{/if}<span class="digits">{face.time}</span>{#if face.period && !face.periodFirst}<span
        class="period"
        style:font-size="{CLOCK_PERIOD_EM}em">{face.period}</span
      >{/if}
  </div>
  {#if options.date}<div
      class="date"
      style:font-size="{clockDateFont(font)}px"
      style:line-height={CLOCK_DATE_LINE}
      data-start-clock-date
    >
      {face.date}
    </div>{/if}
</div>

<style>
  /* 박스 전체 — 숫자 · 날짜를 가운데 한 묶음으로(여백 · 틈은 위 인라인 — 박스 셈과 같은 값). 글자 둘레의 옅은 번짐은 판 바탕색 */
  .clock {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    overflow: visible;
    color: var(--fg-1);
    text-shadow: 0 0 10px color-mix(in srgb, var(--bg-base) 55%, transparent);
    user-select: none;
  }

  /* 큰 숫자 — 글자 크기는 인라인(고른 크기). 줄높이 1 이라 높이 셈이 곧 글자 크기다 */
  .time {
    display: flex;
    align-items: baseline;
    font-weight: var(--fw-regular);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  .period {
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
    letter-spacing: 0;
  }

  /* 날짜 · 요일 한 줄 */
  .date {
    color: var(--fg-2);
    white-space: nowrap;
  }
</style>
