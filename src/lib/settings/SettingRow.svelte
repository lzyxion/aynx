<script lang="ts">
  import type { Snippet } from "svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    id,
    label,
    noteLabel,
    summary,
    note,
    tip,
    control,
  }: {
    /** 컨트롤의 `id` — `<label for>` 와 접힌 설명의 `{id}-note` 가 이 값에 매인다 */
    id: string;
    label: string;
    noteLabel?: string;
    summary?: Snippet;
    note?: Snippet;
    /** 주면 요약 줄 · ⓘ 대신 라벨에 얹는 툴팁이 된다. `\n` 은 줄바꿈으로 읽힌다. */
    tip?: string;
    control: Snippet;
  } = $props();
</script>

<div class="toggle-row">
  {#if tip !== undefined}
    <TipName {id} {label} {tip} for={id} />
  {:else if summary}
    <label class="name" for={id}>
      {label}
      <InfoNote {id} label={noteLabel ?? t("settings.row.note", { label })} {summary} {note} />
    </label>
  {:else}
    <label class="name" for={id}>{label}</label>
  {/if}
  {@render control()}
</div>
