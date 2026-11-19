<script lang="ts">
  import { invoke, isRemote, listen } from "../ipc";
  import {
    settings,
    NOTIFY_AFTER_MAX_SECS,
    setMessengerChannel,
    setMessengerTelegramChat,
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
  import MessengerWebhook from "$lib/settings/MessengerWebhook.svelte";
  import MessengerTelegram from "$lib/settings/MessengerTelegram.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";
  import {
    accordionEdges,
    botHandle,
    channelConnected,
    parseBotStatus,
    telegramHead,
    webhookHead,
    type BotStatus,
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
   *   바깥에서 곧바로 쓰인다. Telegram 은 봇 토큰 + 계정 연결(짝짓기)까지 해야 연결된 것이다(`messenger-view.ts`).
   * - **규칙** — 연결된 채널이 하나라도 있을 때만. 없으면 안내 한 줄이 대신 선다(보낼 곳이 없는데 규칙을
   *   고르게 두지 않는다). 규칙은 `settings.toml` 의 `[messenger]` — 다른 설정과 같이 [저장] 이 쓴다.
   *
   * "연결됐는가" 는 여기서 쥔다(몸통이 등록·해제 결과를 올려 준다). **채널을 연결하는 순간** 그 채널 토글을 켠다 —
   * 사람이 토글을 켠 것과 같다([저장] 규칙도 같다). 연결된 채널의 토글이 모두 꺼지면 규칙 줄이 잠긴다.
   *
   * Telegram 봇 상태는 이 화면이 **보이는 동안**(`active`) 읽고, 세션 서버의 사건(`messenger-bot-event` — 짝짓기 요청 · 연결 · 토큰 ·
   * 받는 고리)이 오면 다시 읽는다 — 짝짓기 코드는 아무것도 누르지 않아도 선다(요청이 새로 서면 Telegram 칸을 펼친다).
   *
   * 규칙 줄의 설명은 이름 툴팁(`TipName`)이다 — 늘 보이는 설명 줄·ⓘ·소제목 머리말은 걷었다. 선택지 둘인 "언제" 는
   * 칩 줄(`ChoiceChips`). 단 **싣기 두 칸의 주의**(비밀이 메신저 서버로 간다)는 툴팁에 더해, 실제로 실려 나가는
   * 동안(켬 · 잠기지 않음)에는 토글 옆 경고 칩(`WarnChip`)으로 보인다 — 상태에 따른 안내라서.
   */
  let { active = false }: { active?: boolean } = $props();

  const WHEN_ENTRIES = optionEntries(MESSENGER_WHENS);
  /** "언제" 칩 앞 아이콘 — 값 키 → `UiIcon` 이름 */
  const WHEN_ICONS: ChoiceIcons = { away: "away", always: "bell" };

  /** 채널 표 — 화면 순서. `domId` 는 칸의 id(= 팔레트 색인의 anchor) · `sendId` 는 보내기 스위치 */
  const CHANNELS: {
    id: ChannelId;
    nameKey: Key;
    domId: string;
    sendId: string;
    /** 웹훅 채널만 */
    webhook: { howtoKey: Key; placeholder: string } | null;
  }[] = [
    {
      id: "discord",
      nameKey: "settings.messenger.channel.discord",
      domId: "messenger-channel-discord",
      sendId: "messenger-discord",
      webhook: { howtoKey: "settings.messenger.discord.howto", placeholder: "https://discord.com/api/webhooks/…" },
    },
    {
      id: "slack",
      nameKey: "settings.messenger.channel.slack",
      domId: "messenger-channel-slack",
      sendId: "messenger-slack",
      webhook: { howtoKey: "settings.messenger.slack.howto", placeholder: "https://hooks.slack.com/services/…" },
    },
    {
      id: "telegram",
      nameKey: "settings.messenger.channel.telegram",
      domId: "messenger-channel-telegram",
      sendId: "messenger-telegram",
      webhook: null,
    },
  ];

  /** Telegram 몸통 안의 말하기 줄(팔레트 색인 anchor) — 짝짓기 전에는 없어 Telegram 칸으로 떨어진다 */
  const TELEGRAM_CHAT_ANCHOR = "messenger-channel-telegram-chat";

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

  /** 웹훅 채널마다 등록돼 있는가 (`null` = 아직 모름) */
  const configured = $state<Partial<Record<ChannelId, boolean | null>>>({ discord: null, slack: null });

  $effect(() => {
    for (const c of CHANNELS) {
      if (!c.webhook) continue;
      invoke<{ configured: boolean }>("messenger_status", { channel: c.id })
        .then((s) => (configured[c.id] = s.configured))
        .catch(() => (configured[c.id] = false));
    }
  });

  /** Telegram 봇 상태 (`null` = 아직 모름 · 못 읽음) */
  let bot = $state<BotStatus | null>(null);
  /** 봇 상태를 못 읽은 까닭(옛 세션 서버 등) */
  let botError = $state<string | null>(null);
  /** 늦게 온 답이 새 답을 덮지 않게 */
  let botSeq = 0;

  async function refreshBot(): Promise<void> {
    const seq = ++botSeq;
    try {
      const next = parseBotStatus(await invoke<unknown>("messenger_bot_status"));
      if (seq !== botSeq) return;
      adoptBot(next);
      botError = null;
    } catch (e) {
      if (seq !== botSeq) return;
      botError = stripReason(e instanceof Error ? e.message : String(e));
    }
  }

  /** 새 상태 — 짝짓기 요청이 **새로** 섰으면 Telegram 칸을 펼친다(코드가 저절로 보이게) */
  function adoptBot(next: BotStatus | null) {
    const fresh = !!next?.pending && next.pending.code !== bot?.pending?.code;
    bot = next;
    if (fresh) expanded = "telegram";
  }

  // 보이는 동안 — 한 번 읽고, 서버 사건이 오면 다시 읽는다. 화면을 떠나면 듣기를 걷는다.
  $effect(() => {
    if (!active) return;
    void refreshBot();
    let stopped = false;
    let unlisten: (() => void) | null = null;
    listen("messenger-bot-event", () => void refreshBot())
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
    Object.fromEntries(CHANNELS.map((c) => [c.id, channelConnected(c.id, configured, bot)])) as Record<ChannelId, boolean>,
  );
  const anyConnected = $derived(CHANNELS.some((c) => connected[c.id]));

  /** 웹훅을 등록·해제했다 — 연결했으면 그 채널 토글을 켠다 */
  function onConfigured(id: ChannelId, next: boolean) {
    configured[id] = next;
    if (next) setMessengerChannel(id, true);
  }

  /** Telegram 몸통이 새 상태를 올렸다 — 방금 계정을 허용해 연결됐으면 그 채널 토글을 켠다 */
  function onBotStatus(next: BotStatus, paired: boolean) {
    botSeq++;
    botError = null;
    adoptBot(next);
    if (paired) setMessengerChannel("telegram", true);
  }

  const rules = $derived(settings.messenger);
  /** 보낼 곳이 없다 — 연결된 채널의 토글이 모두 꺼졌다. 규칙 줄을 잠근다 */
  const noChannelOn = $derived(!CHANNELS.some((c) => connected[c.id] && rules[c.id]));
  /** 원격 창은 말하기를 켜지 못한다 — 저장된 값이 켬일 때만 손잡이가 산다(끄기는 된다 · `remote/deny.rs` `settings_home_only`) */
  const chatLocked = $derived(isRemote && settings.saved.messenger.telegram_chat !== true);

  /** **펼친 채널 하나**(아코디언 — 하나를 펴면 다른 것은 접힌다 · 다시 누르면 닫힘) — 화면 상태일 뿐 저장하지 않는다 */
  let expanded = $state<ChannelId | null>(null);
  const openIndex = $derived(CHANNELS.findIndex((c) => c.id === expanded));
  /** 설정 색인으로 펼칠 때 전이를 건너뛴다(펼친 줄이 그 자리에서 곧바로 재어지게 — `McpSection.expandForAnchor` 와 같은 꼴) */
  let instant = $state(false);

  /**
   * 팔레트의 설정 색인이 채널 칸(`messenger-channel-<채널>`) · Telegram 의 말하기 줄을 가리키면 그 채널 **하나만** 펼친다 —
   * `SettingsModal` 의 `revealPendingAnchor` 가 스크롤 전에 부른다(`NotificationsSection` 을 거쳐). 규칙 줄은 펼침과 무관하다.
   */
  export function expandForAnchor(anchor: string): void {
    const target = anchor === TELEGRAM_CHAT_ANCHOR ? "telegram" : CHANNELS.find((c) => c.domId === anchor)?.id;
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
    {@const head = c.webhook ? webhookHead(configured[c.id] ?? null, rules[c.id]) : telegramHead(bot, rules.telegram, rules.telegramChat)}
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
      aside={head.aside === "bot" ? botHandle(bot?.bot ?? null) : head.aside === "conflict" ? t("settings.messenger.status.conflict") : ""}
      anchorFor={c.webhook || connected.telegram ? undefined : TELEGRAM_CHAT_ANCHOR}
    >
      {#if c.webhook}
        <MessengerWebhook
          channel={c.id}
          {name}
          howtoKey={c.webhook.howtoKey}
          placeholder={c.webhook.placeholder}
          configured={configured[c.id] ?? null}
          onconfigured={(next) => onConfigured(c.id, next)}
        />
      {:else}
        <MessengerTelegram
          {name}
          status={bot}
          loadError={botError}
          chat={rules.telegramChat}
          {chatLocked}
          onchat={setMessengerTelegramChat}
          onstatus={onBotStatus}
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
