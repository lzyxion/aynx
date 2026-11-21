<script module lang="ts">
  /** `\n` 은 말풍선에서 줄바꿈 */
  export function tipOf(summary: string, note?: string): string {
    return note ? `${summary}\n${note}` : summary;
  }
</script>

<script lang="ts">
  /** 설명 칸(`.tip-desc`)은 이름 밖에 둔다 — 안에 두면 손잡이의 이름(라벨 글자)에 설명까지 섞인다. */
  let {
    id,
    label,
    tip,
    for: htmlFor,
    nameId,
  }: {
    /** `{id}-label`(이름) · `{id}-tip`(설명) 이 여기서 나온다 — 칩 묶음이 `aria-labelledby` 로 가리킨다 */
    id: string;
    label: string;
    tip: string;
    /** 주면 `<label for>`, 안 주면 `<span>` */
    for?: string;
    /** 이름 자체가 설정 색인 anchor 인 줄이 준다 */
    nameId?: string;
  } = $props();
</script>

{#if htmlFor !== undefined}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <label class="name has-tip" id={nameId ?? `${id}-label`} for={htmlFor} title={tip} data-tip-place="above" tabindex="0" aria-describedby="{id}-tip">{label}</label>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <span class="name has-tip" id={nameId ?? `${id}-label`} title={tip} data-tip-place="above" tabindex="0" aria-describedby="{id}-tip">{label}</span>
{/if}
<span class="tip-desc" id="{id}-tip">{tip}</span>
