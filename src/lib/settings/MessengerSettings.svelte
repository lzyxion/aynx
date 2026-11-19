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
    botHandle,
    botHead,
    channelConnected,
    DUAL_CHANNELS,
    dualHead,
    dualMode,
    parseBotStatus,
    parseHookStatus,
    type BotChannel,
    type BotStatus,
    type ChannelHead,
    type DualChannel,
    type HookStatus,
  } from "$lib/settings/messenger-view";

  /**
   * **메신저 알림** (알림 섹션의 둘째 소제목 · docs/log/2026-09-27-discord-notify.md ·
   * docs/log/2026-09-28-messenger-channels.md "3단계 — 설정 화면" · docs/log/2026-11-18-messenger-bridge.md "1b").
   *
   * `NotificationsSection` 의 창 안·OS 알림 묶음 **아래**에 선다 — 같은 사건 넷(턴 끝 · 권한 물음 · 긴 명령 ·
   * 프로그램 알림)을 받되 제 켬/끔·자리 비움 표로 따로 간다. "자리 비움" 의 입력 시계는 보안 섹션의
   * 무입력 자동 잠금과 같은 것이다.
   *
   * ## 모양 (사용자 확정 목업 — 채널은 2026-11-19 B안)
   *
   * - **머리줄** — 제목뿐이다. 켜고 끄는 일은 채널 줄의 토글이 한다(전체 스위치는 2026-11-05 에 걷었다).
   * - **채널** — Discord · Slack · Telegram 이 연결 여부와 상관없이 늘 셋 다 **펼침 목록**(`.slist.accordion` — AI 에이전트 설정과 같은 틀)에
   *   선다(`MessengerChannel`). 줄을 누르면 그 채널의 설정 줄이 펼쳐지고(한 번에 하나만 — 펼친 칸은 목록에서 떨어진다), 끝 칸의 스위치는
   *   "이 채널로 알림 보내기"(연결된 채널만). 웹훅 URL · 봇 토큰은 비밀이라 설정 파일 바깥(백엔드의 채널별 자기 파일)이다 — [저장]·[취소]
   *   바깥에서 곧바로 쓰인다. Telegram 은 봇 토큰 + 계정 연결(짝짓기)까지 해야 연결된 것이다(`messenger-view.ts`). Discord · Slack 은 한 번에
   *   한 방식 — 웹훅(알림만) 또는 봇(Telegram 과 같은 몸통 · 2026-11-19 A안 · `MessengerDual` — "연결 방식" 줄이 늘 맨 위 · 바꾸기는 확인
   *   뒤 · 지금 방식은 머리줄 첫 칩 · Slack 봇은 토큰 둘).
   * - **규칙** — 연결된 채널이 하나라도 있을 때만. 없으면 안내 한 줄이 대신 선다(보낼 곳이 없는데 규칙을
   *   고르게 두지 않는다). 규칙은 `settings.toml` 의 `[messenger]` — 다른 설정과 같이 [저장] 이 쓴다.
   *
   * "연결됐는가" 는 여기서 쥔다(몸통이 등록·해제 결과를 올려 준다). **채널을 연결하는 순간** 그 채널 토글을 켠다 —
   * 사람이 토글을 켠 것과 같다([저장] 규칙도 같다). 연결된 채널의 토글이 모두 꺼지면 규칙 줄이 잠긴다.
   *
   * 봇 상태(Telegram · Discord · Slack 각각)는 이 화면이 **보이는 동안**(`active`) 읽고, 세션 서버의 사건(`messenger-bot-event` — 짝짓기 요청 ·
   * 연결 · 토큰 · 받는 고리 · 어느 채널이든)이 오면 봇 채널을 다 다시 읽는다 — 짝짓기 코드는 아무것도 누르지 않아도 선다(요청이 새로
   * 서면 그 채널 칸을 펼친다).
   *
   * 규칙 줄의 설명은 이름 툴팁(`TipName`)이다 — 늘 보이는 설명 줄·ⓘ·소제목 머리말은 걷었다. 선택지 둘인 "언제" 는
   * 칩 줄(`ChoiceChips`). 단 **싣기 두 칸의 주의**(비밀이 메신저 서버로 간다)는 툴팁에 더해, 실제로 실려 나가는
   * 동안(켬 · 잠기지 않음)에는 토글 옆 경고 칩(`WarnChip`)으로 보인다 — 상태에 따른 안내라서.
   */
  let { active = false }: { active?: boolean } = $props();

  const WHEN_ENTRIES = optionEntries(MESSENGER_WHENS);
  /** "언제" 칩 앞 아이콘 — 값 키 → `UiIcon` 이름 */
  const WHEN_ICONS: ChoiceIcons = { away: "away", always: "bell" };

  /**
   * 채널 표 — 화면 순서. `domId` 는 칸의 id(= 팔레트 색인의 anchor) · `sendId` 는 보내기 스위치 · `chatId` 는 봇 몸통 안의 말하기 줄.
   * 몸통은 Telegram 이 `MessengerBot`, Discord · Slack 이 `MessengerDual`(봇 · 웹훅 한 방식).
   */
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

  /**
   * 채널이 하나도 없어 숨는 줄들의 id(팔레트 색인에 오른 것) — 색인이 그 줄을 찾아오면 채널 상자로 떨어진다
   * (`SettingsModal` 의 `revealAnchor` 가 `data-anchor-for` 를 본다).
   */
  const RULE_ANCHORS = [
    "messenger-when",
    "messenger-away-after",
    "messenger-command-min",
    "messenger-include-command",
    "messenger-include-conversation",
  ].join(" ");

  /** 두 방식 채널(Discord · Slack)의 `messenger_status` (`null` = 아직 모름) — `via` 로 봇인지도 말한다 */
  const hooks = $state<Partial<Record<ChannelId, HookStatus | null>>>({ discord: null, slack: null });

  function refreshHook(id: ChannelId): void {
    invoke<unknown>("messenger_status", { channel: id })
      .then((s) => (hooks[id] = parseHookStatus(s)))
      .catch(() => (hooks[id] = { configured: false, via: null }));
  }

  $effect(() => {
    for (const c of DUAL_CHANNELS) refreshHook(c);
  });

  /** 봇 채널마다의 상태 (`null` = 아직 모름 · 못 읽음) */
  const bots = $state<Record<BotChannel, BotStatus | null>>({ telegram: null, discord: null, slack: null });
  /** 봇 상태를 못 읽은 까닭(옛 세션 서버 등) */
  const botErrors = $state<Record<BotChannel, string | null>>({ telegram: null, discord: null, slack: null });
  /** 늦게 온 답이 새 답을 덮지 않게 — 채널마다 */
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

  /** 새 상태 — 짝짓기 요청이 **새로** 섰으면 그 채널 칸을 펼친다(코드가 저절로 보이게) */
  function adoptBot(channel: BotChannel, next: BotStatus | null) {
    const fresh = !!next?.pending && next.pending.code !== bots[channel]?.pending?.code;
    // 두 방식 채널의 봇 토큰이 생기거나 사라졌다 — 웹훅을 지웠거나(토큰 등록) 방식이 비었다. `via` 를 다시 읽는다
    const tokenFlip = channel !== "telegram" && !!next?.configured !== !!bots[channel]?.configured;
    bots[channel] = next;
    if (fresh) expanded = channel;
    if (tokenFlip) refreshHook(channel);
  }

  // 보이는 동안 — 한 번 읽고, 서버 사건이 오면 봇 채널을 모두 다시 읽는다(사건의 `channel` 칸에 기대지 않는다). 화면을 떠나면 듣기를 걷는다.
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

  /** 웹훅을 등록·해제했다 — 연결했으면 그 채널 토글을 켠다 */
  function onConfigured(id: ChannelId, next: boolean) {
    hooks[id] = { configured: next, via: next ? "webhook" : null };
    if (next) setMessengerChannel(id, true);
  }

  /** 봇 몸통이 새 상태를 올렸다 — 방금 계정을 허용해 연결됐으면 그 채널 토글을 켠다 */
  function onBotStatus(channel: BotChannel, next: BotStatus, paired: boolean) {
    botSeq[channel]++;
    botErrors[channel] = null;
    adoptBot(channel, next);
    if (paired) setMessengerChannel(channel, true);
  }

  const rules = $derived(settings.messenger);
  /** 보낼 곳이 없다 — 연결된 채널의 토글이 모두 꺼졌다. 규칙 줄을 잠근다 */
  const noChannelOn = $derived(!CHANNELS.some((c) => connected[c.id] && rules[c.id]));
  /** 원격 창은 말하기를 켜지 못한다 — 저장된 값이 켬일 때만 손잡이가 산다(끄기는 된다 · `remote/deny.rs` `settings_home_only`). 채널마다 따로 */
  const chatLocked = $derived<Record<BotChannel, boolean>>({
    telegram: isRemote && settings.saved.messenger.telegram_chat !== true,
    discord: isRemote && settings.saved.messenger.discord_chat !== true,
    slack: isRemote && settings.saved.messenger.slack_chat !== true,
  });

  /** 채널마다의 말하기 칸(`[messenger] <채널>_chat`) — 값 · 손잡이 */
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

  /** 채널 머리의 칩 — Telegram 은 봇, Discord · Slack 은 그 방식대로 */
  function headOf(id: ChannelId): ChannelHead {
    if (id === "telegram") return botHead(bots.telegram, rules.telegram, rules.telegramChat);
    return dualHead(modes[id], bots[id], rules[id], chatOf[id]);
  }

  /** 봇 몸통 안의 말하기 줄이 지금 그려져 있는가 — 짝지은 봇일 때만(웹훅으로 연결한 Discord · Slack 에는 없다) */
  function chatRowShown(id: ChannelId): boolean {
    return connected[id] && (id === "telegram" || modes[id] === "bot");
  }

  /** **펼친 채널 하나**(아코디언 — 하나를 펴면 다른 것은 접힌다 · 다시 누르면 닫힘) — 화면 상태일 뿐 저장하지 않는다 */
  let expanded = $state<ChannelId | null>(null);
  const openIndex = $derived(CHANNELS.findIndex((c) => c.id === expanded));
  /** 설정 색인으로 펼칠 때 전이를 건너뛴다(펼친 줄이 그 자리에서 곧바로 재어지게 — `McpSection.expandForAnchor` 와 같은 꼴) */
  let instant = $state(false);

  /**
   * 팔레트의 설정 색인이 채널 칸(`messenger-channel-<채널>`) · 봇 채널의 말하기 줄을 가리키면 그 채널 **하나만** 펼친다 —
   * `SettingsModal` 의 `revealPendingAnchor` 가 스크롤 전에 부른다(`NotificationsSection` 을 거쳐). 규칙 줄은 펼침과 무관하다.
   */
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
      aside={head.aside === "bot"
        ? botHandle(bots[c.id]?.bot ?? null, c.id)
        : head.aside === "conflict"
          ? t("settings.messenger.status.conflict")
          : ""}
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
  /* "채널" · "규칙" — 섹션 소제목보다 한 단 낮은 작은 제목 */
  .minor {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
  }

  /* 채널 목록 — 공용 펼침 목록(`.slist.accordion` — 줄마다 면 · 2px 틈 · 첫 · 끝 24px · 펼친 칸은 홀로, settings.css)이다(2026-11-19 B안) */

  .footnote.empty {
    margin-top: var(--space-3);
  }
</style>
