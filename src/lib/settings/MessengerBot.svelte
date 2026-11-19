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
    tokenFields,
    type BotChannel,
    type BotStatus,
  } from "$lib/settings/messenger-view";
  import MessengerTokenForm from "$lib/settings/MessengerTokenForm.svelte";
  import MessengerSlackSteps from "$lib/settings/MessengerSlackSteps.svelte";

  /**
   * **봇 채널 칸의 몸통**(Telegram · 봇으로 연결한 Discord · Slack) — 봇 연결 · 계정 연결(짝짓기) · 말하기(메신저 다리 1b —
   * docs/log/2026-11-18-messenger-bridge.md · 사용자 확정 목업 "설정 › 알림 › 채널" · Discord · Slack 은 2026-11-19 A안).
   *
   * | 상태 | 줄 |
   * | --- | --- |
   * | 토큰 없음 | 봇 토큰 칸(비밀번호형 · Slack 은 봇 · 앱 토큰 두 칸) + [연결] + 요령(Slack 은 번호 줄 + [매니페스트 복사]) |
   * | 토큰만 | 계정 연결(요령 · 짝짓기를 청한 계정이 있으면 이름 · 코드 · [허용] · [거절]) · 봇 연결 해제 |
   * | 짝지음 | 메신저에서 AI 타일에 말하기 · 연결된 계정 [다시 연결] · 봇 [테스트 보내기] · 봇 연결 해제 |
   *
   * 세 채널의 줄은 같고, 요령 글 · 연결 해제 설명만 채널마다 다르다(`TEXT` — 토큰 칸은 `tokenFields`). 명령은 모두 `channel` 을 싣는다
   * (`messenger_bot_*` — 짝지은 계정은 채널마다 하나). 줄 id 는 `messenger-<채널>-…` · 말하기만 `messenger-channel-<채널>-chat`(설정 색인 anchor).
   * Slack 의 두 토큰은 `"<봇>\n<앱>"` 한 글자열로 넘긴다(`joinTokens` — 서버가 접두사로 가르고, 어느 토큰이 틀렸는지도 서버가 말한다).
   * Slack 은 이름 대신 멤버 ID 가 온다(서버가 준 글자를 그대로 그린다).
   *
   * - **봇 토큰은 화면에 다시 보여 주지 않는다** — 칸은 [연결] 을 누르자마자 비우고, 상태(`messenger_bot_status`)에는 토큰이 없다.
   *   토큰을 읽는 것은 세션 서버뿐이다(`server/messenger_bridge_proxy.rs`).
   * - 짝짓기를 청한 이름 · 짝지은 이름은 **남의 글자**다 — 글자로만 그린다(`{@html}` 없음).
   * - 원격 창에서는 토큰 넣기 · 허용/거절 · 다시 연결 · 연결 해제가 잠긴다(`remote/deny.rs` HOME_ONLY — 손잡이에 "메인 PC 에서만" 툴팁 —
   *   보안 · 원격 접속 섹션과 같은 관례). 말하기는 원격에서 **켜지** 못한다(끄기는 된다 — 부모가 `chatLocked` 로 넘긴다).
   * - 상태는 부모가 쥔다(머리줄 칩 · 규칙 묶음이 같은 값을 본다) — 이 몸통은 명령을 부르고 새 상태를 `onstatus` 로 올린다.
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
    /** 봇 상태(`null` = 아직 모름 · 못 읽음) */
    status: BotStatus | null;
    /** 상태를 못 읽은 까닭(옛 세션 서버 등) — 이미 표식을 뗀 글 */
    loadError: string | null;
    /** `[messenger] <채널>_chat` */
    chat: boolean;
    /** 말하기 손잡이를 잠근다(원격 창 · 저장된 값이 꺼짐) */
    chatLocked: boolean;
    onchat: (on: boolean) => void;
    /** 명령이 새 상태를 돌려줬다 — `paired` 는 이 몸통에서 짝을 허용해 막 연결됐는가 */
    onstatus: (next: BotStatus, paired: boolean) => void;
  } = $props();

  /** 채널마다 다른 글 — 나머지 줄은 `settings.messenger.bot.*` 를 함께 쓴다. `howto` 가 `null` 이면 번호 줄(`MessengerSlackSteps`) */
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
  /** 토큰 칸 밑 한 줄 — 등록 거절 문구 */
  let rejection = $state<string | null>(null);

  const text = $derived(TEXT[channel]);
  const fields = $derived(tokenFields(channel).map((f) => ({ ...f, label: t(f.label) })));
  const chatId = $derived(`messenger-channel-${channel}-chat`);
  const homeOnly = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);
  const bot = $derived(botHandle(status?.bot ?? null, channel));

  function message(e: unknown): string {
    return stripReason(e instanceof Error ? e.message : String(e));
  }

  /** 명령 하나(`channel` 을 싣는다) — 새 상태를 올린다. 실패는 토스트(`inline` 이면 칸 밑) */
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

  /** [연결] — 칸은 넣자마자 비운다(`MessengerTokenForm` — 거절되면 다시 붙여 넣는다 · 화면에 토큰을 남겨 두지 않는다) */
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
    <p class="footnote">{t(text.pairHowto, { bot: bot || name })}</p>
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

  /* 코드 확인 상자 — 요령 밑에 두 칸을 다 쓴다(이름 · 코드 | 허용 · 거절) */
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
