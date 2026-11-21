<script lang="ts">
  import { untrack } from "svelte";
  import { invoke, isRemote } from "../ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import ChoiceChips, { type ChoiceEntry } from "$lib/settings/ChoiceChips.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import MessengerBot from "$lib/settings/MessengerBot.svelte";
  import MessengerWebhook from "$lib/settings/MessengerWebhook.svelte";
  import MessengerSwitch from "$lib/settings/MessengerSwitch.svelte";
  import MessengerSlackSteps from "$lib/settings/MessengerSlackSteps.svelte";
  import {
    dualMode,
    dualSwitchLocked,
    dualView,
    parseBotStatus,
    tokenFields,
    type BotStatus,
    type DualChannel,
    type DualVia,
    type HookStatus,
  } from "$lib/settings/messenger-view";

  /**
   * 두 방식 채널(Discord · Slack)은 한 번에 한 방식이다 — 봇(알림 + 말하기) 또는 웹훅(알림만).
   * 바꾸기는 어느 방향이든 메인 PC 전용이다(봇 토큰을 넣거나 지운다 · `remote/deny.rs` HOME_ONLY). 거절이면 그 전 방식이 그대로다.
   * 줄 id `messenger-<채널>-…` 는 설정 색인 · 하네스가 본다.
   */
  let {
    channel,
    name,
    hook,
    status,
    loadError,
    chat,
    chatLocked,
    onchat,
    onstatus,
    onconfigured,
  }: {
    channel: DualChannel;
    name: string;
    hook: HookStatus | null;
    status: BotStatus | null;
    loadError: string | null;
    /** `[messenger] <채널>_chat` */
    chat: boolean;
    chatLocked: boolean;
    onchat: (on: boolean) => void;
    onstatus: (next: BotStatus, paired: boolean) => void;
    onconfigured: (configured: boolean) => void;
  } = $props();

  /** `botHowto` 가 `null` 이면 번호 줄(`MessengerSlackSteps`) */
  const TEXT: Record<DualChannel, { webhookHowto: Key; webhookPlaceholder: string; botHowto: Key | null }> = {
    discord: {
      webhookHowto: "settings.messenger.discord.howto",
      webhookPlaceholder: "https://discord.com/api/webhooks/…",
      botHowto: "settings.messenger.discord.bot.howto",
    },
    slack: {
      webhookHowto: "settings.messenger.slack.howto",
      webhookPlaceholder: "https://hooks.slack.com/services/…",
      botHowto: null,
    },
  };

  const VIA_ENTRIES: readonly ChoiceEntry[] = [
    ["bot", "settings.messenger.via.bot"],
    ["webhook", "settings.messenger.via.webhook"],
  ];

  let picked = $state<DualVia | null>(null);

  const text = $derived(TEXT[channel]);
  const mode = $derived(dualMode(hook, status));
  const view = $derived(dualView(mode, picked));
  const via = $derived<DualVia>(view === "to-bot" ? "bot" : view === "to-webhook" ? "webhook" : view);
  const locked = $derived(dualSwitchLocked(view, isRemote));
  const botFields = $derived(tokenFields(channel).map((f) => ({ ...f, label: t(f.label) })));
  const viaId = $derived(`messenger-${channel}-via`);
  const webhookLabel = $derived(t("settings.messenger.webhook.label", { channel: name }));

  $effect(() => {
    void mode;
    untrack(() => (picked = null));
  });

  /** 토큰이 받아들여지면 백엔드가 웹훅을 지운다 */
  async function toBot(token: string) {
    const next = parseBotStatus(await invoke<unknown>("messenger_bot_set_token", { channel, token }));
    if (next) onstatus(next, false);
  }

  async function toWebhook(url: string) {
    await invoke<unknown>("messenger_replace_bot_with_webhook", { channel, url });
    // 백엔드가 봇 해제를 확인한 뒤에야 저장했다
    onstatus({ configured: false, bot: null, paired: false, pairName: null, pending: null, link: "off" }, false);
    onconfigured(true);
  }
</script>

{#snippet slackSteps()}
  <MessengerSlackSteps />
{/snippet}

<div class="srow">
  <TipName id={viaId} label={t("settings.messenger.via.label")} tip={t("settings.messenger.via.note", { channel: name })} />
  <ChoiceChips
    id={viaId}
    labelledby="{viaId}-label"
    entries={VIA_ENTRIES}
    value={via}
    onpick={(key) => (picked = key === "webhook" ? "webhook" : "bot")}
  />
</div>

{#if view === "bot"}
  <MessengerBot {channel} {name} {status} {loadError} {chat} {chatLocked} {onchat} {onstatus} />
{:else if view === "webhook"}
  <MessengerWebhook
    {channel}
    {name}
    howtoKey={text.webhookHowto}
    placeholder={text.webhookPlaceholder}
    configured={mode === "webhook" ? true : hook === null ? null : false}
    {onconfigured}
  />
{:else if view === "to-bot"}
  <MessengerSwitch
    fields={botFields}
    name={botFields.length > 1 ? t("settings.messenger.bot.connect.label") : botFields[0].label}
    howto={text.botHowto ? t(text.botHowto) : ""}
    steps={text.botHowto ? undefined : slackSteps}
    note={t("settings.messenger.to_bot.note")}
    title={t("settings.messenger.to_bot.title")}
    body={t("settings.messenger.to_bot.body")}
    {locked}
    run={toBot}
  />
{:else}
  <MessengerSwitch
    fields={[{ id: `messenger-${channel}-webhook`, label: webhookLabel, placeholder: text.webhookPlaceholder }]}
    name={webhookLabel}
    howto={`${t(text.webhookHowto)} ${t("settings.messenger.webhook.note")}`}
    note={t("settings.messenger.to_webhook.note", { channel: name })}
    title={t("settings.messenger.to_webhook.title")}
    body={t("settings.messenger.to_webhook.body", { channel: name })}
    {locked}
    run={toWebhook}
  />
{/if}
