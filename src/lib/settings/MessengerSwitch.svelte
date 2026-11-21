<script lang="ts">
  import type { Snippet } from "svelte";
  import { isRemote } from "../ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { joinTokens } from "$lib/settings/messenger-view";
  import MessengerTokenForm from "$lib/settings/MessengerTokenForm.svelte";

  /**
   * 두 방식 채널의 방식 바꾸기 칸 — [연결] 은 곧바로 등록하지 않고 바꾸기 확인을 세운다.
   * - 친 비밀(토큰 · 주소)은 화면에 남기지 않는다 — 확인이 서는 순간 칸을 비우고 값은 룬 아닌 변수에만 둔다. 끝나면 어느 쪽이든 버린다.
   * - 원격 창에서는 칸 · [연결] · [바꾸기] 가 잠긴다(`locked` — 어느 방향이든 봇 토큰을 넣거나 지운다).
   */
  let {
    fields,
    name,
    howto,
    steps,
    note,
    title,
    body,
    locked,
    run,
  }: {
    /** 연결 전 몸통의 칸과 같은 id 다 */
    fields: readonly { id: string; label: string; placeholder: string }[];
    name: string;
    howto: string;
    steps?: Snippet;
    note: string;
    title: string;
    body: string;
    locked: boolean;
    /** 거절이면 던진다 — 그 문구가 칸 밑에 선다 */
    run: (secret: string) => Promise<void>;
  } = $props();

  let confirming = $state(false);
  let busy = $state(false);
  let rejection = $state<string | null>(null);
  /** 룬이 아니다 — 비밀을 그리지 않는다 */
  let held: string | null = null;

  const homeOnly = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);
  const titleId = $derived(`${fields[0]?.id ?? "messenger-switch"}-confirm-title`);

  function ask(values: string[]) {
    const value = joinTokens(values);
    if (value === null || locked) return;
    held = value;
    rejection = null;
    confirming = true;
  }

  function cancel() {
    held = null;
    confirming = false;
  }

  async function confirm() {
    const value = held;
    held = null;
    if (value === null || locked) return cancel();
    busy = true;
    try {
      await run(value);
    } catch (e) {
      rejection = stripReason(e instanceof Error ? e.message : String(e));
      confirming = false;
    } finally {
      busy = false;
    }
  }
</script>

{#snippet footnote()}
  <p class="footnote">
    {#if rejection}<span class="rejection" role="alert">{rejection}</span><br />{/if}
    {#if howto}{howto}<br />{/if}{note}
  </p>
  {@render steps?.()}
{/snippet}

{#if confirming}
  <div class="srow wide-field" data-messenger-switch-to="confirm">
    <span class="name">{name}</span>
    <div class="confirm" role="alertdialog" aria-labelledby={titleId} data-messenger-confirm>
      <span>
        <b id={titleId}>{title}</b>
        {body}
      </span>
      <span class="acts">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          disabled={busy || locked}
          title={homeOnly}
          data-messenger-confirm-go
          onclick={() => void confirm()}>{t("settings.messenger.replace")}</button
        >
        <button type="button" class="btn btn-sm btn-secondary" disabled={busy} data-messenger-confirm-cancel onclick={cancel}
          >{t("settings.actions.cancel")}</button
        >
      </span>
    </div>
  </div>
{:else}
  <MessengerTokenForm
    {fields}
    {name}
    disabled={busy || locked}
    title={homeOnly}
    onsubmit={ask}
    {footnote}
    data-messenger-switch-to="field"
  />
{/if}

<style>
  .rejection {
    color: var(--err);
  }

  .confirm {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    color: var(--on-warn-soft);
    background: var(--warn-soft);
    border-radius: 14px;
  }

  .confirm b {
    display: block;
    font-weight: var(--fw-semibold, 600);
  }

  .acts {
    display: inline-flex;
    gap: var(--space-2);
  }
</style>
