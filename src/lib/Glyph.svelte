<script lang="ts">
  import { UI_VIEWBOX } from "$lib/host-icons";

  /**
   * **UI 글리프 하나를 그리는 인라인 SVG** (docs/log/2026-09-04-icons-and-rows.md).
   *
   * **화면이 늘 그리는** 손으로 딴 도형 전용이다 — 지금은 아이콘을 안 고른 호스트의 기본 서버
   * 랙(`SERVER_D`) 하나뿐이다 (폴더·파일·링크는 2026-09-25 에 Lucide 선 아이콘으로 옮겨
   * `UiIcon` 이 그린다 — docs/log/2026-09-25-duotone-glyphs.md). 색은 언제나 `currentColor`
   * 이므로 **부모가 정한 글자색**을 입는다.
   *
   * 사용자가 골라 붙이는 **컬러 로고**는 여기로 오지 않는다 (`HostIcon.svelte`) — 그쪽은
   * 원본 색을 그대로 지켜야 한다.
   *
   * `<img>` 나 배경 이미지가 아니라 인라인 SVG 인 이유가 색이다: 그 둘은 색을 물려받지 못한다.
   */
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
    /** 한 변의 픽셀 (기본은 목록 줄의 앞자리 크기) */
    size?: number;
    /**
     * 스크린 리더가 읽을 이름. **비어 있으면 `aria-hidden`** 이다 — 대개 이 아이콘은 바로
     * 옆 글자(폴더 이름·파일 이름)를 꾸미는 장식이라, 이름을 또 읽으면 같은 말이 두 번 들린다.
     */
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
  /*
   * `display: block` 이라야 줄 안에서 baseline 아래의 여백(inline 요소의 descender 자리)이
   * 생기지 않는다 — 그 여백 때문에 아이콘이 든 줄만 1~2px 높아지면, 맞춰 놓은 파일
   * 브라우저·세션 타일의 줄 높이가 다시 어긋난다.
   */
  .glyph-svg {
    display: block;
    flex: 0 0 auto;
  }
</style>
