<script lang="ts">
  import IconPicker from "$lib/IconPicker.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { SWATCH_PLACEHOLDER, swatchHex } from "$lib/host-meta-hint";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **아이콘 → 색** 두 칸 한 벌 (docs/log/2026-09-29-folder-project-icons.md).
   *
   * 셋이 이것 하나를 쓴다: 호스트 폼의 표시 탭(`HostForm`) · 호스트 독의 폴더 편집(`FolderEditDialog`) ·
   * 프로젝트 폼의 표시 면(`ProjectForm`). 칸의 차례(아이콘 먼저), 곁말(저장 형식 `svg:` 는 어디에도 안 보인다),
   * 견본 + 글자 칸 + 지우기의 모양이 세 곳에서 갈라지지 않게 한다
   * (docs/log/2026-09-29-hostform-display-tidy.md).
   *
   * **감싸는 상자가 없다** — 라벨 · 고르개 · 라벨 · 색 줄 네 조각을 그대로 내놓는다. 폼들의 `.fields`
   * 2열 격자(라벨 | 칸)에 그 자리 그대로 낀다(세 곳 모두 2열이다).
   * 그래서 라벨·칸의 모양은 여기서 스스로 갖는다(부르는 쪽의 스코프 CSS 는 이 안에 닿지 않는다).
   *
   * **상속은 호스트뿐이다** — `iconInherited`·`colorInherited` 와 곁말 문구는 호스트 폼만 준다. 폴더·프로젝트는
   * 물려받을 곳이 없어 평소 문구("이름으로 검색하거나 이모지 입력" · "없음 — 기본 색")와 "지우기" 그대로다.
   */
  let {
    icon = $bindable(""),
    color = $bindable(""),
    iconId,
    colorId,
    iconPlaceholder = t("app.iconcolor.icon.placeholder"),
    colorPlaceholder = t("app.iconcolor.color.placeholder"),
    iconInherited = null,
    colorInherited = null,
    iconResetTitle = t("app.iconcolor.reset"),
    colorResetTitle = t("app.iconcolor.reset"),
    fallback = "none",
  }: {
    /** 저장될 아이콘 값 그대로 (`svg:ubuntu` · `🚀` · `""`) */
    icon: string;
    /** 저장될 색 값 그대로 (`#4a90d9` · `""`) */
    color: string;
    /** 두 칸의 id — 안 주면 이 인스턴스의 것을 짓는다 (`<label for>` 가 늘 칸을 가리키게) */
    iconId?: string;
    colorId?: string;
    iconPlaceholder?: string;
    colorPlaceholder?: string;
    /** 아이콘 칸이 비었을 때 미리보기가 흐리게 그릴 물려받은 값 (호스트 폼만) */
    iconInherited?: string | null;
    /** 색 칸이 비었을 때 견본·미리보기가 흐리게 입을 물려받은 색 (호스트 폼만) */
    colorInherited?: string | null;
    iconResetTitle?: string;
    colorResetTitle?: string;
    /** 값도 상속도 없을 때 미리보기의 기본 그림 (`HostIcon` 과 같은 뜻 — 호스트는 서버, 폴더는 폴더) */
    fallback?: "none" | "server" | "folder";
  } = $props();

  const uid = $props.id();
  const iconFor = $derived(iconId ?? `${uid}-icon`);
  const colorFor = $derived(colorId ?? `${uid}-color`);

  /** 물려받은 색 (없으면 `null`) */
  const inheritedColor = $derived(colorInherited?.trim() || null);
  /** 견본이 지금 **물려받은 색**을 그리고 있는가 (흐리게·빗금) */
  const swatchInherited = $derived(color.trim() === "" && swatchHex(inheritedColor) !== null);
</script>

<label class="icf-label" for={iconFor}>{t("app.iconcolor.icon")}</label>
<!--
  고르개 격자 + 자유 입력 (`IconPicker.svelte`). 미리보기는 이 칸의 색(없으면 물려받은 색)을 입는다 —
  목록에서 보일 그대로다 (단색 선 아이콘과 기본 폴더만 입고, 컬러 로고·이모지는 제 색).
-->
<IconPicker
  id={iconFor}
  bind:value={icon}
  inherited={iconInherited}
  color={color.trim() || inheritedColor}
  {fallback}
  placeholder={iconPlaceholder}
  resetTitle={iconResetTitle}
  resetAria={t("app.iconcolor.icon.reset.aria")}
/>

<label class="icf-label" for={colorFor}>{t("app.iconcolor.color")}</label>
<div class="file-row color-row">
  <!--
    칸이 비었으면 견본은 **물려받은 색**을 흐리게·빗금으로 그린다 — 지금 보이는 색이 여기 적힌 값이
    아니라는 표시다. 물려받은 것도 없으면 회색 자리표. 견본은 `#rgb`·`#rrggbb` 만 그릴 수 있어
    그 밖의 CSS 색(`tomato`)은 자리표로 두고 글자 칸이 값을 말한다.
  -->
  <span class="swatch-wrap" class:inherited={swatchInherited}>
    <input
      id={colorFor}
      class="swatch"
      type="color"
      value={swatchHex(color) ?? swatchHex(inheritedColor) ?? SWATCH_PLACEHOLDER}
      oninput={(ev) => (color = ev.currentTarget.value)}
    />
  </span>
  <input
    class="color-text"
    bind:value={color}
    placeholder={colorPlaceholder}
    aria-label={t("app.iconcolor.color.aria")}
    autocomplete="off"
    spellcheck="false"
  />
  <button
    type="button"
    class="reset btn btn-secondary"
    title={colorResetTitle}
    aria-label={t("app.iconcolor.color.reset.aria")}
    onclick={() => (color = "")}
  >
    <UiIcon name="reset" size={13} />
  </button>
</div>

<style>
  /* 라벨 — 폼의 `.fields label` 과 같은 값 (스코프가 넘지 않아 여기 한 벌) */
  .icf-label {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .color-row {
    display: flex;
    gap: 6px;
    min-width: 0;
    align-items: center;
  }

  /* 글자 칸 — 표준 입력 칸(`--field-*` 토큰 · `IconPicker` 의 입력 칸 · 폼의 `.fields input` 과 한 벌) */
  .color-text {
    flex: 1;
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

  .color-text:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  .color-text:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .color-text::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  /* 견본 자리 — 물려받은 색일 때만 흐리게 + 빗금 한 겹 (눌러 고르는 것은 그대로 된다) */
  .swatch-wrap {
    position: relative;
    display: flex;
    flex: 0 0 auto;
  }

  .swatch {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 34px;
    height: var(--field-height);
    padding: 2px;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
  }

  /* 네이티브 색 면도 칸의 곡선을 따른다 — 여백은 `.swatch` 의 padding 이 맡는다 */
  .swatch::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .swatch::-webkit-color-swatch {
    border: none;
    border-radius: 999px;
  }

  .swatch-wrap.inherited .swatch {
    opacity: 0.5;
  }

  .swatch-wrap.inherited::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: 999px;
    pointer-events: none;
    background: repeating-linear-gradient(
      135deg,
      transparent 0 3px,
      color-mix(in srgb, var(--surface-field) 70%, transparent) 3px 5px
    );
  }

  /* 지우기 — 전역 `.btn .btn-secondary`, 줄 안에서 줄지 않게만 */
  .reset {
    flex: 0 0 auto;
  }

  /* 칸 옆이니 칸과 같은 높이 — 폭은 전역 `.btn` 그대로 */
  .color-row .reset {
    height: var(--field-height);
  }
</style>
