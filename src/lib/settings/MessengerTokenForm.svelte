<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLFormAttributes } from "svelte/elements";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** 칸은 모두 비밀번호형이고 [연결] 을 누르자마자 비운다 — 화면에 비밀을 남기지 않는다(거절되면 다시 붙여 넣는다) */
  let {
    fields,
    name = "",
    disabled,
    title,
    onsubmit,
    footnote,
    ...rest
  }: {
    /** `label` 은 이미 옮긴 글 */
    fields: readonly { id: string; label: string; placeholder: string }[];
    name?: string;
    disabled: boolean;
    title?: string;
    onsubmit: (values: string[]) => void;
    footnote?: Snippet;
  } & Omit<HTMLFormAttributes, "onsubmit" | "title"> = $props();

  let drafts = $state<string[]>([]);
  const values = $derived(fields.map((_, i) => drafts[i] ?? ""));
  const ready = $derived(values.every((v) => v.trim() !== ""));

  function submit() {
    const sent = values;
    drafts = [];
    if (sent.some((v) => v.trim() === "")) return;
    onsubmit(sent);
  }
</script>

<form
  class="srow wide-field"
  {...rest}
  onsubmit={(e) => {
    e.preventDefault();
    submit();
  }}
>
  {#if fields.length === 1}
    {@const f = fields[0]}
    <label class="name" for={f.id}>{f.label}</label>
    <div class="size-row">
      <input
        id={f.id}
        class="value"
        type="password"
        spellcheck="false"
        autocomplete="off"
        placeholder={f.placeholder}
        bind:value={drafts[0]}
        {disabled}
        {title}
      />
      <button type="submit" class="btn btn-primary btn-sm" disabled={disabled || !ready} {title}
        >{t("settings.messenger.webhook.save")}</button
      >
    </div>
  {:else}
    <span class="name">{name}</span>
    <div class="fields">
      {#each fields as f, i (f.id)}
        <label class="flab" for={f.id}>{f.label}</label>
        <input
          id={f.id}
          class="value"
          type="password"
          spellcheck="false"
          autocomplete="off"
          placeholder={f.placeholder}
          bind:value={drafts[i]}
          {disabled}
          {title}
        />
        {#if i === fields.length - 1}
          <button type="submit" class="btn btn-primary btn-sm" disabled={disabled || !ready} {title}
            >{t("settings.messenger.webhook.save")}</button
          >
        {:else}
          <span></span>
        {/if}
      {/each}
    </div>
  {/if}
  {@render footnote?.()}
</form>

<style>
  .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .fields {
    flex: 1 1 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    min-width: 0;
  }

  .flab {
    font-size: var(--t-sm);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .fields > .value {
    min-width: 6em;
  }
</style>
