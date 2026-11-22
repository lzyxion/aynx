<script lang="ts">
  import { invoke, isRemote, listen } from "../ipc";
  import {
    settings,
    NOTIFY_AFTER_MAX_SECS,
    setMessengerChannel,
    setMessengerTelegramChat,
    setMessengerDiscordChat,
    setMessengerSlackChat,
    setMessengerWhen,
    setMessengerAgentStop,
    setMessengerAgentPermission,
    setMessengerCommandMinSecs,
    setMessengerOsc,
    setMessengerOperationResults,
    setMessengerOperationPending,
    setMessengerIncludeSummary,
    setMessengerIncludeCommand,
    setMessengerIncludeConversation,
    setMessengerAwayAfterMin,
  } from "$lib/settings.svelte.js";
  import {
    DEFAULT_MESSENGER_AWAY_AFTER_MIN,
    DEFAULT_MESSENGER_COMMAND_MIN_SECS,
    MESSENGER_AWAY_MAX_MIN,
    MESSENGER_WHENS,
    type MessengerChannel as ChannelId,
  } from "$lib/messenger-notify";
  import { optionEntries, t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { stripReason } from "$lib/error-reason";
  import Toggle from "$lib/Toggle.svelte";
  import MessengerChannel from "$lib/settings/MessengerChannel.svelte";
  import MessengerBot from "$lib/settings/MessengerBot.svelte";
  import MessengerDual from "$lib/settings/MessengerDual.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";
  import {
    accordionEdges,
    BOT_CHANNELS,
    channelConnected,
    DUAL_CHANNELS,
    dualHead,
    dualMode,
    parseBotStatus,
    parseHookStatus,
    telegramHead,
    type BotChannel,
    type BotStatus,
    type ChannelHead,
    type DualChannel,
    type HookStatus,
  } from "$lib/settings/messenger-view";

  /**
   * 메신저 알림 (docs/log/2026-11-18-messenger-bridge.md).
   * - 웹훅 URL · 봇 토큰은 비밀이라 설정 파일 밖(백엔드의 채널별 자기 파일)이다 — [저장] · [취소] 와 무관하게 곧바로 쓰인다.
   * - 규칙(`settings.toml` 의 `[messenger]`)은 [저장] 이 쓴다. 채널을 연결하는 순간 그 채널 토글을 켠다 — 사람이 켠 것과 같다.
   * - 싣기 두 칸(비밀이 메신저 서버로 간다)은 실제로 실려 나가는 동안 토글 옆 경고 칩으로도 보인다.
   * - "자리 비움" 의 입력 시계는 보안 섹션의 무입력 자동 잠금과 같은 것이다.
   */
  let { active = false }: { active?: boolean } = $props();

  const WHEN_ENTRIES = optionEntries(MESSENGER_WHENS);
  const WHEN_ICONS: ChoiceIcons = { away: "away", always: "bell" };

  /** `domId` · `chatId` 는 팔레트 색인의 anchor 다 — 바꾸지 않는다 */
  const CHANNELS: {
    id: ChannelId;
    nameKey: Key;
    domId: string;
    sendId: string;
    chatId: string;
  }[] = [
    {
      id: "discord",
      nameKey: "settings.messenger.channel.discord",
      domId: "messenger-channel-discord",
      sendId: "messenger-discord",
      chatId: "messenger-channel-discord-chat",
    },
    {
      id: "slack",
      nameKey: "settings.messenger.channel.slack",
      domId: "messenger-channel-slack",
      sendId: "messenger-slack",
      chatId: "messenger-channel-slack-chat",
    },
    {
      id: "telegram",
      nameKey: "settings.messenger.channel.telegram",
      domId: "messenger-channel-telegram",
      sendId: "messenger-telegram",
      chatId: "messenger-channel-telegram-chat",
    },
  ];

  /** 채널이 없어 숨는 규칙 줄의 색인 anchor — 색인이 그 줄을 찾아오면 채널 상자로 떨어진다(`data-anchor-for`) */
  const RULE_ANCHORS = [
    "messenger-when",
    "messenger-away-after",
    "messenger-command-min",
    "messenger-include-command",
    "messenger-include-conversation",
  ].join(" ");

  const hooks = $state<Partial<Record<ChannelId, HookStatus | null>>>({ discord: null, slack: null });

  function refreshHook(id: ChannelId): void {
    invoke<unknown>("messenger_status", { channel: id })
      .then((s) => (hooks[id] = parseHookStatus(s)))
      .catch(() => (hooks[id] = { configured: false, via: null }));
  }

  $effect(() => {
    for (const c of DUAL_CHANNELS) refreshHook(c);
  });

  const bots = $state<Record<BotChannel, BotStatus | null>>({ telegram: null, discord: null, slack: null });
  const botErrors = $state<Record<BotChannel, string | null>>({ telegram: null, discord: null, slack: null });
  /** 늦게 온 답이 새 답을 덮지 않게 */
  const botSeq: Record<BotChannel, number> = { telegram: 0, discord: 0, slack: 0 };

  async function refreshBot(channel: BotChannel): Promise<void> {
    const seq = ++botSeq[channel];
    try {
      const next = parseBotStatus(await invoke<unknown>("messenger_bot_status", { channel }));
      if (seq !== botSeq[channel]) return;
      adoptBot(channel, next);
      botErrors[channel] = null;
    } catch (e) {
      if (seq !== botSeq[channel]) return;
      botErrors[channel] = stripReason(e instanceof Error ? e.message : String(e));
    }
  }

  function adoptBot(channel: BotChannel, next: BotStatus | null) {
    const fresh = !!next?.pending && next.pending.code !== bots[channel]?.pending?.code;
    // 봇 토큰이 생기거나 사라지면 백엔드가 웹훅을 지웠을 수 있다 — `via` 를 다시 읽는다
    const tokenFlip = channel !== "telegram" && !!next?.configured !== !!bots[channel]?.configured;
    bots[channel] = next;
    if (fresh) expanded = channel;
    if (tokenFlip) refreshHook(channel);
  }

  // 사건이 오면 봇 채널을 모두 다시 읽는다 — 사건의 `channel` 칸에 기대지 않는다
  $effect(() => {
    if (!active) return;
    for (const c of BOT_CHANNELS) void refreshBot(c);
    let stopped = false;
    let unlisten: (() => void) | null = null;
    listen("messenger-bot-event", () => {
      for (const c of BOT_CHANNELS) void refreshBot(c);
    })
      .then((fn) => {
        if (stopped) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      unlisten?.();
    };
  });

  const connected = $derived(
    Object.fromEntries(CHANNELS.map((c) => [c.id, channelConnected(c.id, hooks, bots)])) as Record<ChannelId, boolean>,
  );
  const anyConnected = $derived(CHANNELS.some((c) => connected[c.id]));
  const modes = $derived({
    discord: dualMode(hooks.discord ?? null, bots.discord),
    slack: dualMode(hooks.slack ?? null, bots.slack),
  } satisfies Record<DualChannel, ReturnType<typeof dualMode>>);

  function onConfigured(id: ChannelId, next: boolean) {
    hooks[id] = { configured: next, via: next ? "webhook" : null };
    if (next) setMessengerChannel(id, true);
  }

  function onBotStatus(channel: BotChannel, next: BotStatus, paired: boolean) {
    botSeq[channel]++;
    botErrors[channel] = null;
    adoptBot(channel, next);
    if (paired) setMessengerChannel(channel, true);
  }

  const rules = $derived(settings.messenger);
  const noChannelOn = $derived(!CHANNELS.some((c) => connected[c.id] && rules[c.id]));
  /** 원격 창은 말하기를 켜지 못한다 — 저장된 값이 켬일 때만 손잡이가 산다(끄기는 된다 · `remote/deny.rs` `settings_home_only`) */
  const chatLocked = $derived<Record<BotChannel, boolean>>({
    telegram: isRemote && settings.saved.messenger.telegram_chat !== true,
    discord: isRemote && settings.saved.messenger.discord_chat !== true,
    slack: isRemote && settings.saved.messenger.slack_chat !== true,
  });

  const chatOf = $derived<Record<BotChannel, boolean>>({
    telegram: rules.telegramChat,
    discord: rules.discordChat,
    slack: rules.slackChat,
  });
  const SET_CHAT: Record<BotChannel, (on: boolean) => void> = {
    telegram: setMessengerTelegramChat,
    discord: setMessengerDiscordChat,
    slack: setMessengerSlackChat,
  };

  function headOf(id: ChannelId): ChannelHead {
    if (id === "telegram") return telegramHead(bots.telegram, rules.telegram, rules.telegramChat);
    return dualHead(modes[id], bots[id], rules[id], chatOf[id]);
  }

  function chatRowShown(id: ChannelId): boolean {
    return connected[id] && (id === "telegram" || modes[id] === "bot");
  }

  let expanded = $state<ChannelId | null>(null);
  const openIndex = $derived(CHANNELS.findIndex((c) => c.id === expanded));
  /** 설정 색인으로 펼칠 때 전이를 건너뛴다 — 펼친 줄이 그 자리에서 곧바로 재어지게 */
  let instant = $state(false);

  export function expandForAnchor(anchor: string): void {
    const target = CHANNELS.find((c) => c.domId === anchor || c.chatId === anchor)?.id;
    if (!target) return;
    if (expanded !== target) instant = true;
    expanded = target;
    requestAnimationFrame(() => requestAnimationFrame(() => (instant = false)));
  }
</script>

<h4 class="subhead">{t("settings.messenger.heading")}</h4>

<h5 class="minor">{t("settings.messenger.channels.subhead")}</h5>
<div class="slist accordion channels" data-anchor-for={anyConnected ? undefined : RULE_ANCHORS}>
  {#each CHANNELS as c, i (c.id)}
    {@const name = t(c.nameKey)}
    {@const edges = accordionEdges(i, CHANNELS.length, openIndex)}
    {@const head = headOf(c.id)}
    <MessengerChannel
      channel={c.id}
      {name}
      id={c.domId}
      open={expanded === c.id}
      first={edges.first}
      last={edges.last}
      {instant}
      ontoggle={() => (expanded = expanded === c.id ? null : c.id)}
      connected={connected[c.id]}
      sendId={c.sendId}
      send={rules[c.id]}
      onSendChange={(on) => setMessengerChannel(c.id, on)}
      {head}
      aside={head.aside === "conflict" ? t("settings.messenger.status.conflict") : ""}
      anchorFor={!chatRowShown(c.id) ? c.chatId : undefined}
    >
      {#if c.id !== "telegram"}
        {@const id = c.id}
        <MessengerDual
          channel={id}
          {name}
          hook={hooks[id] ?? null}
          status={bots[id]}
          loadError={botErrors[id]}
          chat={chatOf[id]}
          chatLocked={chatLocked[id]}
          onchat={SET_CHAT[id]}
          onstatus={(next, paired) => onBotStatus(id, next, paired)}
          onconfigured={(next) => onConfigured(id, next)}
        />
      {:else}
        <MessengerBot
          channel="telegram"
          {name}
          status={bots.telegram}
          loadError={botErrors.telegram}
          chat={chatOf.telegram}
          chatLocked={chatLocked.telegram}
          onchat={SET_CHAT.telegram}
          onstatus={(next, paired) => onBotStatus("telegram", next, paired)}
        />
      {/if}
    </MessengerChannel>
  {/each}
</div>

{#if !anyConnected}
  <p class="footnote empty">{t("settings.messenger.empty")}</p>
{:else}
  <h5 class="minor">{t("settings.messenger.rules.subhead")}</h5>
  <div class="rows term">
    <div class="srow">
      <TipName id="messenger-when" label={t("settings.messenger.when.label")} tip={t("settings.messenger.when.note")} />
      <ChoiceChips
        id="messenger-when"
        labelledby="messenger-when-label"
        entries={WHEN_ENTRIES}
        icons={WHEN_ICONS}
        value={rules.when}
        disabled={noChannelOn}
        onpick={setMessengerWhen}
      />
    </div>

    <div class="srow">
      <TipName
        id="messenger-away-after"
        for="messenger-away-after"
        label={t("settings.messenger.away.label")}
        tip={t("settings.messenger.away.note")}
      />
      <div class="size-row">
        <input
          id="messenger-away-after"
          class="value size"
          type="number"
          min="0"
          max={MESSENGER_AWAY_MAX_MIN}
          value={rules.awayAfterMin}
          placeholder={String(DEFAULT_MESSENGER_AWAY_AFTER_MIN)}
          disabled={noChannelOn || rules.when === "always"}
          oninput={(e) => setMessengerAwayAfterMin(e.currentTarget.valueAsNumber)}
        />
        <span class="hint">{t("settings.messenger.minutes_hint")}</span>
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-agent-stop"
        for="messenger-agent-stop"
        label={t("settings.messenger.agent_stop.label")}
        tip={t("settings.messenger.agent.note")}
      />
      <div class="size-row">
        <Toggle
          id="messenger-agent-stop"
          checked={rules.agentStop}
          disabled={noChannelOn}
          onchange={setMessengerAgentStop}
        />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-agent-permission"
        for="messenger-agent-permission"
        label={t("settings.messenger.agent_permission.label")}
        tip={t("settings.messenger.agent.note")}
      />
      <div class="size-row">
        <Toggle
          id="messenger-agent-permission"
          checked={rules.agentPermission}
          disabled={noChannelOn}
          onchange={setMessengerAgentPermission}
        />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-command-min"
        for="messenger-command-min"
        label={t("settings.messenger.command.label")}
        tip={t("settings.messenger.command.note")}
      />
      <div class="size-row">
        <input
          id="messenger-command-min"
          class="value size"
          type="number"
          min="0"
          max={NOTIFY_AFTER_MAX_SECS}
          value={rules.commandMinSecs}
          placeholder={String(DEFAULT_MESSENGER_COMMAND_MIN_SECS)}
          disabled={noChannelOn}
          oninput={(e) => setMessengerCommandMinSecs(e.currentTarget.valueAsNumber)}
        />
        <span class="hint">{t("settings.terminal.seconds_hint")}</span>
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-include-command"
        for="messenger-include-command"
        label={t("settings.messenger.include_command.label")}
        tip={tipOf(t("settings.messenger.include_command.note"), t("settings.messenger.include_command.warn"))}
      />
      <div class="size-row">
        {#if !noChannelOn && rules.commandMinSecs > 0 && rules.includeCommand}
          <WarnChip label={t("settings.messenger.include.chip")} detail={t("settings.messenger.include_command.warn")} />
        {/if}
        <Toggle
          id="messenger-include-command"
          checked={rules.includeCommand}
          disabled={noChannelOn || rules.commandMinSecs <= 0}
          onchange={setMessengerIncludeCommand}
        />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-include-conversation"
        for="messenger-include-conversation"
        label={t("settings.messenger.include_conversation.label")}
        tip={tipOf(
          t("settings.messenger.include_conversation.note"),
          t("settings.messenger.include_conversation.warn"),
        )}
      />
      <div class="size-row">
        {#if !noChannelOn && (rules.agentStop || rules.agentPermission) && rules.includeConversation}
          <WarnChip label={t("settings.messenger.include.chip")} detail={t("settings.messenger.include_conversation.warn")} />
        {/if}
        <Toggle
          id="messenger-include-conversation"
          checked={rules.includeConversation}
          disabled={noChannelOn || (!rules.agentStop && !rules.agentPermission)}
          onchange={setMessengerIncludeConversation}
        />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-osc"
        for="messenger-osc"
        label={t("settings.messenger.osc.label")}
        tip={t("settings.messenger.osc.note")}
      />
      <div class="size-row">
        <Toggle id="messenger-osc" checked={rules.osc} disabled={noChannelOn} onchange={setMessengerOsc} />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-operation-results"
        for="messenger-operation-results"
        label={t("settings.messenger.operation_results.label")}
        tip={t("settings.messenger.operation_results.note")}
      />
      <div class="size-row">
        <Toggle
          id="messenger-operation-results"
          checked={rules.operationResults}
          disabled={noChannelOn}
          onchange={setMessengerOperationResults}
        />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-operation-pending"
        for="messenger-operation-pending"
        label={t("settings.messenger.operation_pending.label")}
        tip={t("settings.messenger.operation_pending.note")}
      />
      <div class="size-row">
        <Toggle
          id="messenger-operation-pending"
          checked={rules.operationPending}
          disabled={noChannelOn}
          onchange={setMessengerOperationPending}
        />
      </div>
    </div>

    <div class="srow">
      <TipName
        id="messenger-include-summary"
        for="messenger-include-summary"
        label={t("settings.messenger.include_summary.label")}
        tip={t("settings.messenger.include_summary.note")}
      />
      <div class="size-row">
        <Toggle
          id="messenger-include-summary"
          checked={rules.includeSummary}
          disabled={noChannelOn || !rules.operationPending}
          onchange={setMessengerIncludeSummary}
        />
      </div>
    </div>
  </div>
{/if}

<style>
  .minor {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
  }

  .footnote.empty {
    margin-top: var(--space-3);
  }
</style>
