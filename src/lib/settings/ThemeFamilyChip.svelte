<script lang="ts">
  import { nextInFamily, type AppColorFamily, type AppColorThemeId } from "$lib/app-color-themes";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { id, family, current, disabled = false, onpick }: {
    id: string;
    family: AppColorFamily;
    current: AppColorThemeId | null;
    disabled?: boolean;
    /** `ev` — 누른 칩(원 퍼짐의 시작점 — `theme-reveal.ts`) */
    onpick: (id: AppColorThemeId, ev: Event) => void;
  } = $props();

  const selected = $derived(family.variants.find((variant) => variant.id === current));
  /** 변형 하나뿐인 계열(Aynx — 기본만)은 순환이 없다: 이름 · 순서 · "다음 테마로" 를 내지 않고 계열 이름만 쓴다(눌림은 `aria-pressed`) */
  const cycles = $derived(family.variants.length > 1);
  const order = $derived(family.variants.map((variant) => t(variant.label)).join(" → "));
  const label = $derived(selected && cycles
    ? t("settings.theme.palette.familyLabel", { family: t(family.label), name: t(selected.label) })
    : t(family.label));
  const aria = $derived(!cycles
    ? t(family.label)
    : selected
      ? t("settings.theme.palette.familyAria", { family: t(family.label), name: t(selected.label), order })
      : t("settings.theme.palette.familyStartAria", { family: t(family.label), order }));
</script>

<button
  {id}
  type="button"
  class="opt-chip family-chip"
  class:active={!!selected}
  aria-pressed={!!selected}
  aria-label={aria}
  data-color-theme={selected?.id}
  {disabled}
  onclick={(ev) => onpick(nextInFamily(family.id, current), ev)}
>
  {label}
</button>
