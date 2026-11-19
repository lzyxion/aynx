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
   * **두 방식 채널(Discord · Slack) 칸의 몸통 — 한 번에 한 방식**(2026-11-19 사용자 A안 · 목업 "Discord 채널 줄" ①–⑥ · "Slack 채널 줄" ①–④):
   * 봇(알림 + 말하기) 또는 웹훅(알림만). 두 채널의 뼈대는 같고 웹훅 요령 · 주소 자리표시 · 봇 토큰 칸(Slack 은 둘)과 요령만 다르다(`TEXT` ·
   * `tokenFields` · `MessengerBot` 의 `TEXT`).
   *
   * 맨 위는 늘 "연결 방식" [봇 · 웹훅] 줄이다(연결 전 · 웹훅 · 봇의 계정 연결 대기 · 봇). 고르기는 **밑에 보일 줄만** 정한다 — 기본은 연결된 방식
   * (아무것도 없으면 봇) · 단추에 "연결됨" 표시는 없다(지금 방식은 머리줄 첫 칩). 그 밑은 `dualView`:
   *
   * | 몸통 | 줄 |
   * | --- | --- |
   * | `bot` | `MessengerBot`(Telegram 과 같은 몸통 — 연결 전이면 봇 토큰 칸) |
   * | `webhook` | `MessengerWebhook`(연결 전이면 주소 칸 · 확인 없이 등록) |
   * | `to-bot` | 웹훅이 연결된 채로 [봇] — 봇 토큰 칸 + 바꾸기 확인(`MessengerSwitch` → `messenger_bot_set_token` — 받아들여지면 백엔드가 웹훅을 지운다) |
   * | `to-webhook` | 봇이 연결된 채로 [웹훅] — 주소 칸 + 바꾸기 확인(`MessengerSwitch` → `messenger_replace_bot_with_webhook`) |
   *
   * 바꾸기는 어느 방향이든 메인 PC 전용이다(봇 토큰을 넣거나 지운다 · `remote/deny.rs` HOME_ONLY) — 원격 창은 칸 · 단추가 잠긴다. 거절이면 아무것도
   * 바뀌지 않는다(그 전 방식이 그대로). 상태는 부모가 쥔다 — 이 몸통이 쥐는 것은 고른 방식뿐이다(화면 상태 · 저장하지 않는다 · 방식이 바뀌면 기본으로).
   * 줄 id 는 `messenger-<채널>-…`(설정 색인 · 하네스가 본다).
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
    /** `messenger_status{channel}` (`null` = 아직 모름) */
    hook: HookStatus | null;
    /** 그 채널의 봇 상태(`null` = 아직 모름 · 못 읽음) */
    status: BotStatus | null;
    loadError: string | null;
    /** `[messenger] <채널>_chat` */
    chat: boolean;
    chatLocked: boolean;
    onchat: (on: boolean) => void;
    onstatus: (next: BotStatus, paired: boolean) => void;
    /** 웹훅을 등록 · 해제했다 */
    onconfigured: (configured: boolean) => void;
  } = $props();

  /** 채널마다 다른 웹훅 글 · 봇 바꾸기 칸의 요령(`null` = 번호 줄 `MessengerSlackSteps`) */
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

  /** 사람이 고른 방식 — `null` = 기본(연결된 방식) */
  let picked = $state<DualVia | null>(null);

  const text = $derived(TEXT[channel]);
  const mode = $derived(dualMode(hook, status));
  const view = $derived(dualView(mode, picked));
  const via = $derived<DualVia>(view === "to-bot" ? "bot" : view === "to-webhook" ? "webhook" : view);
  const locked = $derived(dualSwitchLocked(view, isRemote));
  const botFields = $derived(tokenFields(channel).map((f) => ({ ...f, label: t(f.label) })));
  const viaId = $derived(`messenger-${channel}-via`);
  const webhookLabel = $derived(t("settings.messenger.webhook.label", { channel: name }));

  // 방식이 바뀌면(등록 · 바꾸기 · 해제) 고르기를 기본으로 — 새 방식의 줄이 선다
  $effect(() => {
    void mode;
    untrack(() => (picked = null));
  });

  /** 웹훅 → 봇 — 토큰이 받아들여지면 백엔드가 웹훅을 지운다(부모가 `messenger_status` 를 다시 읽는다). 거절이면 던진다(웹훅 그대로) */
  async function toBot(token: string) {
    const next = parseBotStatus(await invoke<unknown>("messenger_bot_set_token", { channel, token }));
    if (next) onstatus(next, false);
  }

  /** 봇 → 웹훅 — 주소 검사 → 봇 해제 → 웹훅 저장(한 명령). 거절이면 던진다(봇 그대로) */
  async function toWebhook(url: string) {
    await invoke<unknown>("messenger_replace_bot_with_webhook", { channel, url });
    // 백엔드가 봇 해제를 확인한 뒤에야 저장했다 — 봇 상태를 비우고 웹훅을 세운다(서버 사건이 오면 다시 읽어 맞춘다)
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
