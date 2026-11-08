<script module lang="ts">
  /** 라벨 툴팁 글자 — 요약 한 줄, 있으면 그 아래 자세한 설명 (`\n` 은 말풍선에서 줄바꿈) */
  export function tipOf(summary: string, note?: string): string {
    return note ? `${summary}\n${note}` : summary;
  }
</script>

<script lang="ts">
  /**
   * 설정 줄의 **이름 + 라벨 툴팁** — 늘 보이는 설명 줄도 ⓘ 도 없이, 설명(요약 + 자세히)을
   * 이름에 얹는다 (앱 테마 · 터미널 섹션, `SettingRow` 의 `tip`).
   *
   * 말풍선은 앱 툴팁 층(`tooltip.svelte.ts` — `title` 을 가로채 테마 면으로 그린다)이 **위로**
   * 띄우고(`data-tip-place="above"`), 이름은 Tab 으로 닿으며(포커스에도 뜬다) 같은 글자를
   * `aria-describedby`(`.tip-desc`)로 잇는다. 설명 칸은 이름 **밖**이다 — 안에 두면 손잡이의
   * 이름(라벨 글자)에 설명까지 섞인다. 모양은 `settings.css` 의 `.name.has-tip` · `.tip-desc`.
   *
   * `for` 를 주면 `<label for>`(누르면 그 손잡이로), 안 주면 `<span id="{id}-label">` 이다 —
   * 칩 묶음처럼 `aria-labelledby` 로 이 이름을 가리키는 줄이 쓴다.
   */
  let {
    id,
    label,
    tip,
    for: htmlFor,
    nameId,
  }: {
    /** 줄의 키 — `{id}-label`(이름) · `{id}-tip`(설명) 이 여기서 나온다 */
    id: string;
    /** 화면의 이름 */
    label: string;
    /** 툴팁 글자 (`tipOf` 로 요약 + 자세히를 잇는다) */
    tip: string;
    /** 이름이 묶일 손잡이의 `id` — 주면 `<label>` 로 선다 */
    for?: string;
    /** 이름 요소의 `id` — 이름 자체가 설정 색인 anchor 인 줄(AI 훅)이 준다. 안 주면 `{id}-label` */
    nameId?: string;
  } = $props();
</script>

{#if htmlFor !== undefined}
  <!-- 키보드로도 설명(툴팁)에 닿아야 해서 tabindex 를 준다 -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <label class="name has-tip" id={nameId ?? `${id}-label`} for={htmlFor} title={tip} data-tip-place="above" tabindex="0" aria-describedby="{id}-tip">{label}</label>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <span class="name has-tip" id={nameId ?? `${id}-label`} title={tip} data-tip-place="above" tabindex="0" aria-describedby="{id}-tip">{label}</span>
{/if}
<span class="tip-desc" id="{id}-tip">{tip}</span>
