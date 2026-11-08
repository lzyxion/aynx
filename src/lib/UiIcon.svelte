<script lang="ts" module>
  /** 이미 경고한 이름 — 모듈 하나에 모아 인스턴스가 늘어도 줄은 하나다 */
  const warned = new Set<string>();
</script>

<script lang="ts">
  import { UI_ICONS } from "$lib/ui-icons.generated";

  /**
   * **앱 크롬의 단색 아이콘 하나** — Material Symbols Rounded 굵기 400 (`scripts/gen-ui-icons.mjs` 머리말).
   *
   * 상태바·머리줄·메뉴처럼 **앱이 자기 얘기를 하는 자리**의 아이콘 전용이다. 그림은 언제나
   * `currentColor` 라 **부모가 정한 글자색**을 입는다 — 눌린 칸이 강조색을 따라가는 것도 그
   * 한 규칙의 결과다.
   *
   * 형제가 둘 있고, 셋의 경계는 **아이콘 데이터가 어디서 오느냐**로 갈린다:
   *
   * | | 무엇을 그리나 | 데이터 |
   * | --- | --- | --- |
   * | `UiIcon`(이 파일) | 앱 크롬의 단색 아이콘 | `ui-icons.generated.ts` (Material Symbols · Lucide 다섯 · 손그림 · MCP 로고) |
   * | `Glyph` | 손으로 딴 24×24 path 하나 (지금은 기본 서버 랙뿐) | `host-icons.ts` 의 `*_D` 상수 |
   * | `HostIcon` | 사용자가 호스트에 골라 붙인 **컬러 로고** | `host-icons.generated.ts` |
   *
   * `<img>` 나 배경 이미지가 아니라 인라인 SVG 인 이유가 색이다: 그 둘은 색을 물려받지 못한다.
   *
   * ## 굵기
   *
   * 덮지 않는다. Material 은 면으로 그린 path 라 `stroke-width` 가 닿지 않고, 남는 선 그림(Lucide · 손그림)은 원본의 2 그대로
   * 그린다 — 1.75 로 줄이면 Material 400 과 결이 어긋난다.
   *
   * ## 꽉 찬 그림 (`filled`)
   *
   * 윤곽 아이콘 사이에서 폴더가 한눈에 갈리게 **꽉 찬 변형**을 100% 로 그린다 — 생성 파일의 `filledBody` 다
   * (`gen-ui-icons.mjs` 의 `WANTED` 셋째 칸 — 지금은 `folder` · `folder-open` · `play`). 변형이 없는 이름이면 윤곽 그림 그대로다.
   * 예전의 이중톤(선 안쪽 18% 칠)은 Material 에서 그림 전체가 18% 가 되어 사라지므로 걷었다.
   */
  let {
    name,
    size = 14,
    label = "",
    filled = false,
  }: {
    /** `ui-icons.generated.ts` 의 키 (`"terminal"`·`"server"`…) */
    name: string;
    /** 한 변의 픽셀 */
    size?: number;
    /**
     * 스크린 리더가 읽을 이름. **비어 있으면 `aria-hidden`** 이다 — 대개 이 아이콘은 바로
     * 옆 글자나 버튼의 `aria-label` 을 꾸미는 장식이라, 이름을 또 읽으면 같은 말이 두 번
     * 들린다 (`Glyph` 와 **같은 규칙**).
     */
    label?: string;
    /** 꽉 찬 변형으로 그린다 (위 "꽉 찬 그림") */
    filled?: boolean;
  } = $props();

  const icon = $derived(UI_ICONS[name] ?? null);

  /**
   * 모르는 이름은 **아무것도 그리지 않는다** — 이 이름은 사용자가 고르는 값이 아니라 코드가
   * 글자로 적는 키라, 화면에 이상한 것을 남기는 것보다 개발 중 콘솔 경고 한 줄이 맞다
   * (`HostIcon` 이 모르는 이름을 글자로 떨어뜨리는 것과 반대인 이유다: 저쪽 값은 남의
   * 설정 파일에서 온다).
   *
   * 경고는 **이름마다 한 번**이다 — 이 컴포넌트는 띠가 다시 그려질 때마다 수십 번 생기므로
   * 매번 적으면 콘솔이 같은 줄로 덮인다.
   */
  $effect(() => {
    if (icon || !import.meta.env.DEV || warned.has(name)) return;
    warned.add(name);
    console.warn(`[UiIcon] 모르는 아이콘 이름: ${name} (scripts/gen-ui-icons.mjs 의 WANTED 참고)`);
  });
</script>

{#if icon}
  <!--
    `{@html}` 로 붙이는 것은 **빌드 시점에 이 저장소가 생성한 마크업**이다
    (`ui-icons.generated.ts` — 사용자 입력도, 네트워크에서 온 것도 아니다). 고를 수 있는 것은
    그 목록의 **이름**뿐이고, 모르는 이름은 위에서 이미 걸러졌다 (`HostIcon` 과 같은 근거).
  -->
  <svg
    class="ui-icon"
    viewBox={icon.viewBox}
    width={size}
    height={size}
    role={label ? "img" : "presentation"}
    aria-hidden={label ? undefined : "true"}
    aria-label={label || undefined}>{@html filled && icon.filledBody ? icon.filledBody : icon.body}</svg
  >
{/if}

<style>
  /*
   * `display: block` 이라야 줄 안에서 baseline 아래의 여백(inline 요소의 descender 자리)이
   * 생기지 않는다 — 그 여백 때문에 아이콘이 든 줄만 1~2px 높아진다 (`Glyph` 와 같은 이유).
   */
  .ui-icon {
    display: block;
    flex: 0 0 auto;
  }
</style>
