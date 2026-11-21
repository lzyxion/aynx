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
   * 시계 위젯 — 보일 때만 고친다(숨은 시작 타일 · 뒤에 있는 창은 박자를 건너뛰고, 다시 보이면 곧바로 고치고 경계를 다시 맞춘다).
   * 날짜 줄 · 틈 · 여백은 `start-clock.ts` 의 박스 셈과 같은 값이다. 박스 어림이 넉넉하거나 모자라도 글자는 가운데에 서고 잘리지 않는다(`overflow: visible`).
   */
  let {
    options,
    font: liveFont,
  }: {
    options: Readonly<ClockOptions>;
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
  /* 여백 · 틈은 인라인 — 박스 셈과 같은 값 */
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

  /* 줄높이 1 이라 높이 셈이 곧 글자 크기다 */
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

  .date {
    color: var(--fg-2);
    white-space: nowrap;
  }
</style>
