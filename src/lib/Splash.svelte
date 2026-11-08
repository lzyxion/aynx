<script lang="ts">
  /**
   * **시작 스플래시** — 창이 뜨는 순간부터 `boot()` 이 끝날 때까지 창 전체를 덮는 층 하나
   * (docs/log/2026-09-17-splash.md).
   *
   * ## 왜 있나
   * 메인 창은 `decorations:false` · `transparent:true` 다. 그래서 예전에는 켜는 순간
   * **아무것도 없는 투명한 사각형**이 먼저 뜨고, WebView2 가 페이지를 올리고 Svelte 가
   * 마운트한 뒤에야 탭 줄·타일이 한 조각씩 채워졌다. 그 사이가 "앱이 죽었나" 로 읽힌다.
   *
   * 지금은 창 자체가 **숨어서 태어나고**(`tauri.conf.json` 의 `visible:false`), 이 층이 한 번
   * 칠해진 **뒤에** `+page` 가 창을 띄운다. 그래서 사용자가 보는 첫 프레임이 곧 이 화면이다.
   *
   * ## 배경은 반드시 **불투명**이다
   * `html` 도 합성 이전의 `--bg-base` 를 칠하지만(10-22), 스플래시는 그 위에 깔린 월페이퍼 ·
   * 번짐까지 가려야 한다. 그래서 여기서도 `--bg-base` 를 직접 칠한다 — 라이트 모드에서도
   * `:root[data-theme="light"]` 가 같은 토큰을 다시 정의하므로 이 한 줄로 두 모드가 맞는다.
   *
   * ## 스피너도, "로딩 중" 글자도 없다
   * 부팅은 대개 한 박자다. 그 사이에 도는 바퀴를 넣으면 "오래 걸리는 일" 이라고 말하는 셈이
   * 된다. 로고와 판번호만 둔다. (예전에는 시작 화면(`StartPage`)도 같은 로고를 가운데 세워
   * 층이 걷힐 때 로고가 제자리에 남는 것처럼 이어졌다 — 2026-09-25 에 시작 화면이 launcher 가
   * 되며 큰 로고를 뺐다: docs/log/2026-09-25-launcher.md.)
   */
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { splashColors, splashIconSrc } from "$lib/splash-memo";

  let {
    booted = false,
    onhidden,
  }: {
    /** `boot()` 이 끝났는가 — `true` 가 되는 순간 이 층이 사라지기 시작한다 */
    booted?: boolean;
    /** 페이드가 **끝났다** — 상위가 `{#if}` 로 이 컴포넌트를 걷는다 */
    onhidden?: () => void;
  } = $props();

  /**
   * 판번호 — `tauri.conf.json` 의 `version` 을 앱에서 그대로 받는다(`core:app:default` 에
   * 이미 들어 있는 권한이라 따로 열 것이 없다). **실패하면 아무것도 그리지 않는다** —
   * 하드코딩한 문자열은 언젠가 진짜 판번호와 어긋나고, 그 어긋남은 아무도 눈치채지 못한다.
   */
  let version = $state<string | null>(null);

  /** 고른 앱 아이콘(캐릭터)과 지난번 화면의 바탕·글자색 — 설정을 읽기 전이라 적어 둔 사본을 읽는다 (`splash-memo.ts`) */
  const logoSrc = splashIconSrc();
  const colors = splashColors();

  /** 사용자가 움직임을 줄여 달라고 했는가 — 아래 CSS 의 미디어 쿼리와 **같은 질문**이다 */
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  onMount(() => {
    void getVersion()
      .then((v) => (version = v))
      .catch(() => {});
  });

  /**
   * 모션을 줄이는 환경에서는 CSS 가 트랜지션을 끄므로 `transitionend` 가 **오지 않는다** —
   * 그 자리에서 곧바로 걷는다. 이 갈래가 없으면 스플래시가 영영 남는다.
   */
  $effect(() => {
    if (booted && reduceMotion) onhidden?.();
  });

  /**
   * 페이드가 시작됐는데 `transitionend` 가 오지 않는 경우의 뒷문. WebView2 는 창이 가려지면
   * (시작하자마자 최소화 등) 합성을 멈춰 트랜지션이 아예 진행되지 않는다 — 그러면 불투명한
   * 층이 앱을 통째로 덮은 채 남는다. 화면에서 되돌릴 방법이 없는 상태라 타이머 하나를 둔다.
   */
  const FADE_MS = 180;
  $effect(() => {
    if (!booted || reduceMotion) return;
    const id = setTimeout(() => onhidden?.(), FADE_MS * 3);
    return () => clearTimeout(id);
  });
</script>

<!--
  z-index 200 — 앱에서 가장 높은 층(툴팁 130) 위다. 부팅 중에는 이것이 화면의 전부여야 한다.
  `.leaving` 이 붙는 동안이 페이드다 (CDP 로 시작 시간을 잴 때의 표식이기도 하다).
-->
<div
  class="splash"
  class:leaving={booted}
  style:--bg-base={colors?.bg}
  style:--fg-muted={colors?.fg}
  aria-busy={!booted}
  role="status"
  aria-label={t("app.splash.aria")}
  ontransitionend={(ev) => {
    if (ev.propertyName === "opacity" && booted) onhidden?.();
  }}
>
  <div class="inner">
    <img class="logo" src={logoSrc} alt="" draggable="false" />
    <p class="brand">AYNX</p>
    {#if version}
      <p class="version">{version}</p>
    {/if}
  </div>
</div>

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    /* 합성 **이전**의 기저색 — 투명도 슬라이더를 내려 둬도 구멍이 생기지 않는다 */
    background: var(--bg-base);
    opacity: 1;
    transition: opacity 180ms ease-out;
  }

  .splash.leaving {
    opacity: 0;
    /* 사라지는 중에는 뒤의 화면이 곧바로 눌린다 */
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .splash {
      transition: none;
    }
  }

  .inner {
    text-align: center;
    user-select: none;
  }

  /* 시작 화면과 **같은 96px** — 층이 걷힐 때 로고가 제자리에 남는 것처럼 보인다 */
  .logo {
    display: block;
    width: 96px;
    height: 96px;
    margin: 0 auto;
    -webkit-user-drag: none;
  }

  .brand {
    margin: 6px 0 0;
    font-size: 12px;
    letter-spacing: 0.18em;
    color: var(--fg-muted);
  }

  .version {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--fg-muted);
    opacity: 0.7;
  }
</style>
