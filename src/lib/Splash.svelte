<script lang="ts">
  /**
   * 시작 스플래시 — 창은 숨어서 태어나고(`visible:false`) 이 층이 한 번 칠해진 뒤에 `+page` 가 창을 띄운다.
   * 배경은 반드시 불투명(`--bg-base`)이다 — 월페이퍼 · 번짐까지 가려야 한다. 스피너 · "로딩 중" 글자는 두지 않는다.
   */
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { splashColors, splashIconSrc } from "$lib/splash-memo";

  let {
    booted = false,
    onhidden,
  }: {
    booted?: boolean;
    onhidden?: () => void;
  } = $props();

  /** 실패하면 아무것도 그리지 않는다 — 하드코딩한 판번호는 언젠가 진짜와 어긋난다 */
  let version = $state<string | null>(null);

  const logoSrc = splashIconSrc();
  const colors = splashColors();

  /** 아래 CSS 의 미디어 쿼리와 같은 질문이다 */
  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  onMount(() => {
    void getVersion()
      .then((v) => (version = v))
      .catch(() => {});
  });

  /** 모션을 줄이면 CSS 가 트랜지션을 꺼 `transitionend` 가 오지 않는다 — 이 갈래가 없으면 스플래시가 영영 남는다 */
  $effect(() => {
    if (booted && reduceMotion) onhidden?.();
  });

  /** WebView2 는 창이 가려지면 합성을 멈춰 `transitionend` 가 안 온다 — 불투명 층이 앱을 덮은 채 남지 않게 타이머를 둔다 */
  const FADE_MS = 180;
  $effect(() => {
    if (!booted || reduceMotion) return;
    const id = setTimeout(() => onhidden?.(), FADE_MS * 3);
    return () => clearTimeout(id);
  });
</script>

<!-- z-index 200 — 앱의 가장 높은 층(툴팁 130) 위. `.leaving` 은 CDP 로 시작 시간을 잴 때의 표식이기도 하다. -->
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
    <p class="brand">Aynx</p>
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
