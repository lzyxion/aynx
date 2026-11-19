<script lang="ts">
  import { invoke } from "../ipc";
  import type { MessengerChannel } from "$lib/messenger-notify";
  import type { Key } from "$lib/i18n/keys";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { toast } from "$lib/toast.svelte.js";

  /**
   * **웹훅 채널(Discord · Slack)의 몸통** — 채널 칸(`MessengerChannel`)을 펼치면 서는 줄들
   * (docs/log/2026-09-28-messenger-channels.md · docs/log/2026-11-18-messenger-bridge.md "1b" — 예전 ⋯ 메뉴의 항목이 줄로 나왔다).
   *
   * - **연결 전** — 웹훅 주소 칸(비밀번호형) + [연결] + 등록 요령. 거절 문구는 입력에 붙은 것이라 칸 밑에 선다.
   * - **연결됨** — "웹훅 — 등록됨 [테스트 보내기]" · "웹훅 연결 해제 [연결 해제]". 결과는 토스트(성공 · 오류).
   *
   * "연결됐는가"(`configured`)는 부모가 쥔다 — 연결된 채널이 하나라도 있는지로 부모가 규칙을 보이고 숨긴다. 웹훅 URL 은 비밀이라
   * 한 번 넣으면 다시 보여 주지 않는다(백엔드가 "등록됐는가" 만 준다 · `src-tauri/src/messenger.rs`).
   */
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
    /** 등록 요령 한 줄(그 메신저의 어디서 주소를 만드는가) */
    howtoKey: Key;
    /** 주소 칸 자리표시 — 그 채널 주소의 모양 */
    placeholder: string;
    /** 웹훅이 등록돼 있는가 (`null` = 아직 모름) */
    configured: boolean | null;
    /** 등록 · 해제가 끝났다 — 새 상태 */
    onconfigured: (configured: boolean) => void;
  } = $props();

  /** 주소 칸에 친 글자 — 연결하면 곧바로 비운다(화면에 남겨 두지 않는다) */
  let draft = $state("");
  let busy = $state(false);
  /** 주소 칸 밑 한 줄 — 연결 거절 문구 */
  let rejection = $state<string | null>(null);

  const inputId = $derived(`messenger-${channel}-webhook`);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  /** 등록(`url`) · 해제(`null`). 등록 거절은 주소 칸 밑에, 해제 실패는 오류 토스트로 */
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

  /** 테스트 한 줄 — 결과는 토스트(성공 · 오류). 오류 문구에 URL 이 없는 것은 백엔드가 보장한다 */
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

  /* 칸 옆 [연결] — 칸과 같은 높이 */
  .wide-field .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .rejection {
    color: var(--err);
  }
</style>
