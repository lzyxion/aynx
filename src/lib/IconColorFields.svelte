<script lang="ts">
  import IconPicker from "$lib/IconPicker.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { SWATCH_PLACEHOLDER, swatchHex } from "$lib/host-meta-hint";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 아이콘 → 색 두 칸 한 벌 (docs/log/2026-09-29-folder-project-icons.md). 감싸는 상자가 없다 — 네 조각이 폼들의 `.fields` 2열 격자에 그대로 낀다.
   * 그래서 라벨·칸의 모양은 여기서 스스로 갖는다(부르는 쪽의 스코프 CSS 는 이 안에 닿지 않는다). 상속(`*Inherited`)은 호스트 폼만 준다.
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
    icon: string;
    color: string;
    iconId?: string;
    colorId?: string;
    iconPlaceholder?: string;
    colorPlaceholder?: string;
    iconInherited?: string | null;
    colorInherited?: string | null;
    iconResetTitle?: string;
    colorResetTitle?: string;
    fallback?: "none" | "server" | "folder";
  } = $props();

  const uid = $props.id();
  const iconFor = $derived(iconId ?? `${uid}-icon`);
  const colorFor = $derived(colorId ?? `${uid}-color`);

  const inheritedColor = $derived(colorInherited?.trim() || null);
  const swatchInherited = $derived(color.trim() === "" && swatchHex(inheritedColor) !== null);
</script>

<label class="icf-label" for={iconFor}>{t("app.iconcolor.icon")}</label>
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

  .reset {
    flex: 0 0 auto;
  }

  .color-row .reset {
    height: var(--field-height);
  }
</style>
