<script lang="ts">
  import { invoke, isRemote } from "../ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { stripReason } from "$lib/error-reason";
  import { toast } from "$lib/toast.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import {
    botHandle,
    formatPairCode,
    joinTokens,
    parseBotStatus,
    splitAtMark,
    tokenFields,
    type BotChannel,
    type BotStatus,
  } from "$lib/settings/messenger-view";
  import MessengerTokenForm from "$lib/settings/MessengerTokenForm.svelte";
  import MessengerSlackSteps from "$lib/settings/MessengerSlackSteps.svelte";

  /**
   * 봇 채널 칸의 몸통 (docs/log/2026-11-18-messenger-bridge.md).
   * - 봇 토큰은 화면에 다시 보여 주지 않는다 — 칸은 [연결] 을 누르자마자 비우고, 상태에는 토큰이 없다. 토큰을 읽는 것은 세션 서버뿐이다.
   * - 짝짓기를 청한 이름 · 짝지은 이름은 남의 글자다 — 글자로만 그린다(`{@html}` 없음).
   * - 원격 창에서는 토큰 넣기 · 허용/거절 · 다시 연결 · 연결 해제가 잠긴다(`remote/deny.rs` HOME_ONLY). 말하기는 원격에서 켜지 못한다(끄기는 된다).
   * - 말하기 줄 id `messenger-channel-<채널>-chat` 은 설정 색인 anchor 다.
   */
  let {
    channel,
    name,
    status,
    loadError,
    chat,
    chatLocked,
    onchat,
    onstatus,
  }: {
    channel: BotChannel;
    name: string;
    status: BotStatus | null;
    loadError: string | null;
    /** `[messenger] <채널>_chat` */
    chat: boolean;
    chatLocked: boolean;
    onchat: (on: boolean) => void;
    /** `paired` = 이 몸통에서 짝을 허용해 막 연결됐는가 */
    onstatus: (next: BotStatus, paired: boolean) => void;
  } = $props();

  /** `howto` 가 `null` 이면 번호 줄(`MessengerSlackSteps`) */
  const TEXT: Record<BotChannel, { howto: Key | null; pairHowto: Key; chatNote: Key; unbotNote: Key }> = {
    telegram: {
      howto: "settings.messenger.telegram.howto",
      pairHowto: "settings.messenger.telegram.pair.howto",
      chatNote: "settings.messenger.telegram.chat.note",
      unbotNote: "settings.messenger.telegram.unbot.note",
    },
    discord: {
      howto: "settings.messenger.discord.bot.howto",
      pairHowto: "settings.messenger.discord.pair.howto",
      chatNote: "settings.messenger.discord.chat.note",
      unbotNote: "settings.messenger.discord.unbot.note",
    },
    slack: {
      howto: null,
      pairHowto: "settings.messenger.slack.pair.howto",
      chatNote: "settings.messenger.slack.chat.note",
      unbotNote: "settings.messenger.slack.unbot.note",
    },
  };

  let busy = $state(false);
  let rejection = $state<string | null>(null);

  const text = $derived(TEXT[channel]);
  const fields = $derived(tokenFields(channel).map((f) => ({ ...f, label: t(f.label) })));
  const chatId = $derived(`messenger-channel-${channel}-chat`);
  const homeOnly = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);
  const bot = $derived(botHandle(status?.bot ?? null, channel));
  /** 안내 문장에서 봇 이름만 강조해 그리려고 가른다 — 이름을 모르면 문장을 통째로 그린다(채널 이름이 그 자리에 든다) */
  const BOT_MARK = "\u0000";
  const pairParts = $derived(bot ? splitAtMark(t(text.pairHowto, { bot: BOT_MARK }), BOT_MARK) : null);

  function message(e: unknown): string {
    return stripReason(e instanceof Error ? e.message : String(e));
  }

  async function run(command: string, args: Record<string, unknown>, opts: { inline?: boolean; paired?: boolean } = {}) {
    busy = true;
    rejection = null;
    try {
      const next = parseBotStatus(await invoke<unknown>(command, { channel, ...args }));
      if (next) onstatus(next, opts.paired === true && next.configured && next.paired);
    } catch (e) {
      if (opts.inline) rejection = message(e);
      else toast.error(t("settings.messenger.action.failed", { channel: name, error: message(e) }));
    } finally {
      busy = false;
    }
  }

  function connect(values: string[]) {
    const token = joinTokens(values);
    if (token === null) return;
    void run("messenger_bot_set_token", { token }, { inline: true });
  }

  async function sendTest() {
    busy = true;
    try {
      await invoke("messenger_bot_test", { channel });
      toast.success(t("settings.messenger.test.ok", { channel: name }));
    } catch (e) {
      toast.error(t("settings.messenger.test.failed", { channel: name, error: message(e) }));
    } finally {
      busy = false;
    }
  }
</script>

{#snippet unbot()}
  <div class="srow">
    <TipName id="messenger-{channel}-unbot" label={t("settings.messenger.bot.unbot.label")} tip={t(text.unbotNote)} />
    <div class="size-row">
      <button
        type="button"
        class="btn btn-sm btn-secondary danger"
        disabled={busy || isRemote}
        title={homeOnly}
        onclick={() => void run("messenger_bot_set_token", { token: null })}>{t("settings.messenger.disconnect")}</button
      >
    </div>
  </div>
{/snippet}

{#snippet howto()}
  {@const alert = rejection ?? loadError}
  {#if text.howto}
    <p class="footnote">
      {#if alert}<span class="rejection" role="alert">{alert}</span><br />{/if}
      {t(text.howto)}
    </p>
  {:else}
    {#if alert}<p class="footnote"><span class="rejection" role="alert">{alert}</span></p>{/if}
    <MessengerSlackSteps />
  {/if}
{/snippet}

{#if !status?.configured}
  {#key channel}
    <MessengerTokenForm
      {fields}
      name={t("settings.messenger.bot.connect.label")}
      disabled={busy || isRemote}
      title={homeOnly}
      onsubmit={connect}
      footnote={howto}
    />
  {/key}
{:else if !status.paired}
  <div class="srow pair-row" data-messenger-pairing={status.pending ? "pending" : "idle"}>
    <span class="name">{t("settings.messenger.bot.pair.label")}</span>
    <p class="footnote">
      {#if pairParts}{pairParts[0]}<strong class="bot-name">{bot}</strong>{pairParts[1]}{:else}{t(text.pairHowto, { bot: bot || name })}{/if}
    </p>
    {#if status.pending}
      {@const pending = status.pending}
      <div class="pair" role="group" aria-label={t("settings.messenger.bot.pair.label")}>
        <span class="who">
          <span>{t("settings.messenger.bot.pair.request", { name: pending.name || "?" })}</span>
          <span class="code" aria-label={t("settings.messenger.bot.pair.code")}>{formatPairCode(pending.code)}</span>
        </span>
        <span class="pair-actions">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            disabled={busy || isRemote}
            title={homeOnly}
            onclick={() => void run("messenger_bot_pair", { code: pending.code, allow: true }, { paired: true })}
            >{t("settings.messenger.bot.pair.allow")}</button
          >
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            disabled={busy || isRemote}
            title={homeOnly}
            onclick={() => void run("messenger_bot_pair", { code: pending.code, allow: false })}
            >{t("settings.messenger.bot.pair.deny")}</button
          >
        </span>
      </div>
    {/if}
  </div>
  {@render unbot()}
{:else}
  <div class="srow">
    <TipName id={chatId} for={chatId} label={t("settings.messenger.bot.chat.label")} tip={t(text.chatNote)} />
    <div class="size-row">
      {#if chat}
        <WarnChip label={t("settings.messenger.bot.chat.chip")} detail={t("settings.messenger.bot.chat.warn", { channel: name })} />
      {/if}
      <Toggle
        id={chatId}
        checked={chat}
        disabled={chatLocked}
        title={chatLocked ? t("settings.remote.homeOnly") : undefined}
        onchange={onchat}
      />
    </div>
  </div>
  <div class="srow">
    <TipName
      id="messenger-{channel}-account"
      label={t("settings.messenger.bot.account.label")}
      tip={t("settings.messenger.bot.account.note")}
    />
    <div class="size-row">
      <span class="val" data-messenger-pair-name>{status.pairName ?? ""}</span>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={busy || isRemote}
        title={homeOnly}
        onclick={() => void run("messenger_bot_unpair", {})}>{t("settings.messenger.bot.repair")}</button
      >
    </div>
  </div>
  <div class="srow">
    <span class="name">{t("settings.messenger.bot.row")}</span>
    <div class="size-row">
      <span class="val">{bot}</span>
      <button type="button" class="btn btn-sm btn-secondary" disabled={busy} onclick={() => void sendTest()}
        >{t("settings.messenger.test.button")}</button
      >
    </div>
  </div>
  {@render unbot()}
{/if}

<style>
  .val {
    min-width: 0;
    overflow: hidden;
    font-size: var(--t-sm);
    color: var(--fg-2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rejection {
    color: var(--err);
  }

  .bot-name {
    font-weight: var(--fw-semibold);
    color: var(--accent);
  }

  .srow.pair-row > .pair {
    grid-column: 1 / -1;
    grid-row: 3;
    justify-self: stretch;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--m3-surface-container-highest);
    border-radius: 8px;
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: var(--t-sm);
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }

  .code {
    font-family: var(--font-mono);
    font-size: var(--t-lg, 18px);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em;
    color: var(--fg-1);
  }

  .pair-actions {
    display: inline-flex;
    gap: var(--space-2);
  }
</style>
