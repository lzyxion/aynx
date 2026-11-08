<script lang="ts">
  import { invoke } from "../ipc";
  import {
    settings,
    NOTIFY_AFTER_MAX_SECS,
    setMessengerChannel,
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
  import Toggle from "$lib/Toggle.svelte";
  import MessengerChannel from "$lib/settings/MessengerChannel.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";

  /**
   * **메신저 알림** (알림 섹션의 둘째 소제목 · docs/log/2026-09-27-discord-notify.md ·
   * docs/log/2026-09-28-messenger-channels.md "3단계 — 설정 화면").
   *
   * `NotificationsSection` 의 창 안·OS 알림 묶음 **아래**에 선다 — 같은 사건 넷(턴 끝 · 권한 물음 · 긴 명령 ·
   * 프로그램 알림)을 받되 제 켬/끔·자리 비움 표로 따로 간다. "자리 비움" 의 입력 시계는 일반 › 프라이버시의
   * 무입력 자동 잠금과 같은 것이다.
   *
   * ## 모양 (사용자 확정 목업 "D. 확정안")
   *
   * - **머리줄** — 제목뿐이다. 켜고 끄는 일은 채널 줄의 토글이 한다(전체 스위치는 2026-11-05 에 걷었다).
   * - **채널** — Discord · Slack 줄이 연결 여부와 상관없이 늘 둘 다 공용 분할 목록(`.slist`)에 선다(`MessengerChannel`).
   *   웹훅 URL 은 비밀이라 설정 파일 바깥(백엔드의 채널별 자기 파일)이다 — [저장]·[취소] 바깥에서 곧바로 쓰인다.
   * - **규칙** — 연결된 채널이 하나라도 있을 때만. 없으면 안내 한 줄이 대신 선다(보낼 곳이 없는데 규칙을
   *   고르게 두지 않는다). 규칙은 `settings.toml` 의 `[messenger]` — 다른 설정과 같이 [저장] 이 쓴다.
   *
   * "연결됐는가" 는 여기서 쥔다(카드가 등록·해제 결과를 올려 준다). **채널을 연결하는 순간** 그 채널 토글을 켠다 —
   * 사람이 토글을 켠 것과 같다([저장] 규칙도 같다). 연결된 채널의 토글이 모두 꺼지면 규칙 줄이 잠긴다.
   *
   * 규칙 줄의 설명은 이름 툴팁(`TipName`)이다 — 늘 보이는 설명 줄·ⓘ·소제목 머리말은 걷었다. 선택지 둘인 "언제" 는
   * 칩 줄(`ChoiceChips`). 단 **싣기 두 칸의 주의**(비밀이 메신저 서버로 간다)는 툴팁에 더해, 실제로 실려 나가는
   * 동안(켬 · 잠기지 않음)에는 토글 옆 경고 칩(`WarnChip`)으로 보인다 — 상태에 따른 안내라서.
   */

  const WHEN_ENTRIES = optionEntries(MESSENGER_WHENS);
  /** "언제" 칩 앞 아이콘 — 값 키 → `UiIcon` 이름 */
  const WHEN_ICONS: ChoiceIcons = { away: "away", always: "bell" };

  /** 채널 표 — 화면 순서. `domId` 는 카드의 id(= 팔레트 색인의 anchor) */
  const CHANNELS: {
    id: ChannelId;
    nameKey: Key;
    howtoKey: Key;
    placeholder: string;
    domId: string;
    sendId: string;
  }[] = [
    {
      id: "discord",
      nameKey: "settings.messenger.channel.discord",
      howtoKey: "settings.messenger.discord.howto",
      placeholder: "https://discord.com/api/webhooks/…",
      domId: "messenger-channel-discord",
      sendId: "messenger-discord",
    },
    {
      id: "slack",
      nameKey: "settings.messenger.channel.slack",
      howtoKey: "settings.messenger.slack.howto",
      placeholder: "https://hooks.slack.com/services/…",
      domId: "messenger-channel-slack",
      sendId: "messenger-slack",
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

  /** 채널마다 웹훅이 등록돼 있는가 (`null` = 아직 모름) */
  const configured = $state<Record<ChannelId, boolean | null>>({ discord: null, slack: null });

  $effect(() => {
    for (const c of CHANNELS) {
      invoke<{ configured: boolean }>("messenger_status", { channel: c.id })
        .then((s) => (configured[c.id] = s.configured))
        .catch(() => (configured[c.id] = false));
    }
  });

  const anyConnected = $derived(CHANNELS.some((c) => configured[c.id] === true));

  /** 카드가 등록·해제를 마쳤다 — 연결했으면 그 채널 토글을 켠다 */
  function onConfigured(id: ChannelId, next: boolean) {
    configured[id] = next;
    if (next) setMessengerChannel(id, true);
  }

  const rules = $derived(settings.messenger);
  /** 보낼 곳이 없다 — 연결된 채널의 토글이 모두 꺼졌다. 규칙 줄을 잠근다 */
  const noChannelOn = $derived(!CHANNELS.some((c) => configured[c.id] === true && rules[c.id]));
</script>

<h4 class="subhead">{t("settings.messenger.heading")}</h4>

<h5 class="minor">{t("settings.messenger.channels.subhead")}</h5>
<div class="slist channels" data-anchor-for={anyConnected ? undefined : RULE_ANCHORS}>
  {#each CHANNELS as c (c.id)}
    <MessengerChannel
      channel={c.id}
      name={t(c.nameKey)}
      howtoKey={c.howtoKey}
      placeholder={c.placeholder}
      id={c.domId}
      sendId={c.sendId}
      send={rules[c.id]}
      onSendChange={(on) => setMessengerChannel(c.id, on)}
      configured={configured[c.id]}
      onconfigured={(next) => onConfigured(c.id, next)}
    />
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

  /* 채널 목록 — 공용 분할 목록(`.slist` — 줄마다 면 · 2px 틈 · 첫 · 끝 24px, settings.css)이다(2026-10-28 — 예전 테두리 상자에서 옮김) */

  .footnote.empty {
    margin-top: var(--space-3);
  }
</style>
