<script lang="ts">
  import { UI_VIEWBOX } from "$lib/host-icons";

  /** 손으로 딴 UI 도형 하나 — 인라인 SVG 라 부모의 글자색(`currentColor`)을 입는다. 컬러 로고는 `HostIcon.svelte` */
  let {
    d,
    rule,
    size = 14,
    label = "",
  }: {
    /** 24×24 viewBox 안의 path 데이터 (`$lib/host-icons` 의 `*_D` 상수들) */
    d: string;
    /** 구멍이 있는 도형만 — 없으면 nonzero */
    rule?: "evenodd";
    size?: number;
    /** 비어 있으면 `aria-hidden` — 대개 옆 글자를 꾸미는 장식이다 */
    label?: string;
  } = $props();
</script>

<svg
  class="glyph-svg"
  viewBox={UI_VIEWBOX}
  width={size}
  height={size}
  fill="currentColor"
  fill-rule={rule}
  role={label ? "img" : "presentation"}
  aria-hidden={label ? undefined : "true"}
  aria-label={label || undefined}
>
  <path {d} />
</svg>

<style>
  /* `display: block` 이 아니면 baseline 아래 여백으로 아이콘이 든 줄만 1~2px 높아진다 */
  .glyph-svg {
    display: block;
    flex: 0 0 auto;
  }
</style>
