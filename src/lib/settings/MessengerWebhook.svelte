<script lang="ts">
  import { invoke } from "../ipc";
  import type { MessengerChannel } from "$lib/messenger-notify";
  import type { Key } from "$lib/i18n/keys";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { toast } from "$lib/toast.svelte.js";

  /** 웹훅 URL 은 비밀이라 한 번 넣으면 다시 보여 주지 않는다 — 백엔드가 "등록됐는가" 만 준다(`src-tauri/src/messenger.rs`) */
  let {
    channel,
    name,
    howtoKey,
    placeholder,
    configured,
    onconfigured,
  }: {
    channel: MessengerChannel;
    name: string;
    howtoKey: Key;
    placeholder: string;
    /** `null` = 아직 모름 */
    configured: boolean | null;
    onconfigured: (configured: boolean) => void;
  } = $props();

  /** 연결하면 곧바로 비운다 — 화면에 남겨 두지 않는다 */
  let draft = $state("");
  let busy = $state(false);
  let rejection = $state<string | null>(null);

  const inputId = $derived(`messenger-${channel}-webhook`);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function setWebhook(url: string | null) {
    busy = true;
    rejection = null;
    try {
      const next = (await invoke<{ configured: boolean }>("messenger_set_webhook", { channel, url })).configured;
      draft = "";
      onconfigured(next);
    } catch (e) {
      if (url === null) toast.error(t("settings.messenger.disconnect.failed", { channel: name, error: message(e) }));
      else rejection = message(e);
    } finally {
      busy = false;
    }
  }

  /** 오류 문구에 URL 이 없는 것은 백엔드가 보장한다 */
  async function sendTest() {
    busy = true;
    try {
      await invoke("messenger_test", { channel });
      toast.success(t("settings.messenger.test.ok", { channel: name }));
    } catch (e) {
      toast.error(t("settings.messenger.test.failed", { channel: name, error: message(e) }));
    } finally {
      busy = false;
    }
  }
</script>

{#if configured}
  <div class="srow">
    <span class="name">{t("settings.messenger.webhook.row")}</span>
    <div class="size-row">
      <span class="val">{t("settings.messenger.webhook.registered")}</span>
      <button type="button" class="btn btn-sm btn-secondary" disabled={busy} onclick={() => void sendTest()}
        >{t("settings.messenger.test.button")}</button
      >
    </div>
  </div>
  <div class="srow">
    <span class="name">{t("settings.messenger.webhook.disconnect.label")}</span>
    <div class="size-row">
      <button type="button" class="btn btn-sm btn-secondary danger" disabled={busy} onclick={() => void setWebhook(null)}
        >{t("settings.messenger.disconnect")}</button
      >
    </div>
  </div>
{:else}
  <form
    class="srow wide-field"
    onsubmit={(e) => {
      e.preventDefault();
      if (draft.trim() !== "") void setWebhook(draft);
    }}
  >
    <label class="name" for={inputId}>{t("settings.messenger.webhook.label", { channel: name })}</label>
    <div class="size-row">
      <input
        id={inputId}
        class="value"
        type="password"
        spellcheck="false"
        autocomplete="off"
        {placeholder}
        bind:value={draft}
        disabled={busy || configured === null}
      />
      <button type="submit" class="btn btn-primary btn-sm" disabled={busy || draft.trim() === ""}
        >{t("settings.messenger.webhook.save")}</button
      >
    </div>
    <p class="footnote">
      {#if rejection}<span class="rejection" role="alert">{rejection}</span><br />{/if}
      {t(howtoKey)} {t("settings.messenger.webhook.note")}
    </p>
  </form>
{/if}

<style>
  .val {
    font-size: var(--t-sm);
    color: var(--fg-2);
  }

  .wide-field .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .rejection {
    color: var(--err);
  }
</style>
