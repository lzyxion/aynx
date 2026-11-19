<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLFormAttributes } from "svelte/elements";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **비밀 칸 + [연결] 한 줄**(메신저 채널 몸통 · 바꾸기 칸이 함께 쓴다 — `MessengerBot` · `MessengerSwitch`).
   *
   * - 칸 하나 — 칸의 이름표가 줄 이름이고 칸 옆에 [연결](Telegram · Discord 봇 토큰 · 웹훅 주소).
   * - 칸 둘(Slack 봇 · 앱 토큰 — 2026-11-19 확정 목업 "Slack 채널 줄" ①) — 줄 이름(`name`) 밑에 이름표 달린 칸이 위아래로, [연결] 은 둘째 칸 옆.
   *
   * 칸은 모두 비밀번호형이고 **[연결] 을 누르자마자 비운다**(화면에 비밀을 남기지 않는다 — 거절되면 다시 붙여 넣는다). 칸이 다 차야
   * [연결] 이 켜진다. 값은 칸 순서대로 `onsubmit` 에 넘긴다(잇는 일은 부르는 쪽 — `joinTokens`). 칸 밑 글(거절 · 요령)은 `footnote`.
   */
  let {
    fields,
    name = "",
    disabled,
    title,
    onsubmit,
    footnote,
    ...rest
  }: {
    /** 칸들 — `label` 은 이미 옮긴 글 */
    fields: readonly { id: string; label: string; placeholder: string }[];
    /** 칸이 둘 이상일 때의 줄 이름 */
    name?: string;
    disabled: boolean;
    /** 칸 · 단추의 툴팁(원격 창의 "메인 PC 에서만") */
    title?: string;
    onsubmit: (values: string[]) => void;
    footnote?: Snippet;
  } & Omit<HTMLFormAttributes, "onsubmit" | "title"> = $props();

  /** 칸마다 친 글자(칸 순서) — 비어 있는 자리는 빈 글자 */
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
  /* 칸 옆 [연결] — 칸과 같은 높이 */
  .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  /* 칸 둘 — 이름표 | 칸 | (끝 칸만) [연결] · 이름 밑 줄을 다 쓴다 */
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
