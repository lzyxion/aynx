<script lang="ts" module>
  const warned = new Set<string>();
</script>

<script lang="ts">
  import { UI_ICONS } from "$lib/ui-icons.generated";

  // 앱 크롬의 단색 아이콘 — 인라인 SVG `currentColor` 라 부모의 글자색을 입는다(`<img>` · 배경 이미지는 색을 물려받지 못한다).
  // 굵기는 덮지 않는다 — 선 그림(Lucide · 손그림)을 1.75 로 줄이면 Material 400 과 결이 어긋난다.
  let {
    name,
    size = 14,
    label = "",
    filled = false,
  }: {
    name: string;
    size?: number;
    /** 비어 있으면 `aria-hidden` — 옆 글자 · `aria-label` 을 꾸미는 장식이라 두 번 읽히지 않게 */
    label?: string;
    /** 생성 파일의 `filledBody` — 변형이 없는 이름이면 윤곽 그림 그대로 */
    filled?: boolean;
  } = $props();

  const icon = $derived(UI_ICONS[name] ?? null);

  // 모르는 이름은 그리지 않고 개발 중 경고만 이름마다 한 번 — 코드가 적는 키라서다(`HostIcon` 은 남의 설정 값이라 글자로 떨어뜨린다)
  $effect(() => {
    if (icon || !import.meta.env.DEV || warned.has(name)) return;
    warned.add(name);
    console.warn(`[UiIcon] 모르는 아이콘 이름: ${name} (scripts/gen-ui-icons.mjs 의 WANTED 참고)`);
  });
</script>

{#if icon}
  <!-- `{@html}` 은 빌드 때 생성한 마크업뿐이다 — 사용자 입력 · 네트워크 값이 아니고 고를 수 있는 것은 이름뿐이다 -->
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
  /* inline 이면 baseline 아래 여백 때문에 아이콘이 든 줄만 1~2px 높아진다 */
  .ui-icon {
    display: block;
    flex: 0 0 auto;
  }
</style>
