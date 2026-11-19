<script lang="ts">
  import { invoke, isRemote } from "../ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { toast } from "$lib/toast.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import { botHandle, formatPairCode, parseBotStatus, type BotStatus } from "$lib/settings/messenger-view";

  /**
   * **Telegram 칸의 몸통** — 봇 연결 · 계정 연결(짝짓기) · 말하기(메신저 다리 1b — docs/log/2026-11-18-messenger-bridge.md ·
   * 사용자 확정 목업 "설정 › 알림 › 채널").
   *
   * | 상태 | 줄 |
   * | --- | --- |
   * | 토큰 없음 | 봇 토큰 칸(비밀번호형) + [연결] + 요령 |
   * | 토큰만 | 계정 연결(요령 · 짝짓기를 청한 계정이 있으면 이름 · 코드 · [허용] · [거절]) · 봇 연결 해제 |
   * | 짝지음 | 메신저에서 AI 타일에 말하기 · 연결된 계정 [다시 연결] · 봇 [테스트 보내기] · 봇 연결 해제 |
   *
   * - **봇 토큰은 화면에 다시 보여 주지 않는다** — 칸은 [연결] 을 누르자마자 비우고, 상태(`messenger_bot_status`)에는 토큰이 없다.
   *   토큰을 읽는 것은 세션 서버뿐이다(`server/messenger_bridge_proxy.rs`).
   * - 짝짓기를 청한 이름 · 짝지은 이름은 **남의 글자**다 — 글자로만 그린다(`{@html}` 없음).
   * - 원격 창에서는 토큰 넣기 · 허용/거절 · 다시 연결 · 연결 해제가 잠긴다(`remote/deny.rs` HOME_ONLY — 손잡이에 "메인 PC 에서만" 툴팁 —
   *   보안 · 원격 접속 섹션과 같은 관례). 말하기는 원격에서 **켜지** 못한다(끄기는 된다 — 부모가 `chatLocked` 로 넘긴다).
   * - 상태는 부모가 쥔다(머리줄 칩 · 규칙 묶음이 같은 값을 본다) — 이 몸통은 명령을 부르고 새 상태를 `onstatus` 로 올린다.
   */
  let {
    name,
    status,
    loadError,
    chat,
    chatLocked,
    onchat,
    onstatus,
  }: {
    name: string;
    /** 봇 상태(`null` = 아직 모름 · 못 읽음) */
    status: BotStatus | null;
    /** 상태를 못 읽은 까닭(옛 세션 서버 등) — 이미 표식을 뗀 글 */
    loadError: string | null;
    /** `[messenger] telegram_chat` */
    chat: boolean;
    /** 말하기 손잡이를 잠근다(원격 창 · 저장된 값이 꺼짐) */
    chatLocked: boolean;
    onchat: (on: boolean) => void;
    /** 명령이 새 상태를 돌려줬다 — `paired` 는 이 몸통에서 짝을 허용해 막 연결됐는가 */
    onstatus: (next: BotStatus, paired: boolean) => void;
  } = $props();

  let draft = $state("");
  let busy = $state(false);
  /** 토큰 칸 밑 한 줄 — 등록 거절 문구 */
  let rejection = $state<string | null>(null);

  const homeOnly = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);
  const bot = $derived(botHandle(status?.bot ?? null));

  function message(e: unknown): string {
    return stripReason(e instanceof Error ? e.message : String(e));
  }

  /** 명령 하나 — 새 상태를 올린다. 실패는 토스트(`inline` 이면 칸 밑) */
  async function run(command: string, args: Record<string, unknown> | undefined, opts: { inline?: boolean; paired?: boolean } = {}) {
    busy = true;
    rejection = null;
    try {
      const next = parseBotStatus(await invoke<unknown>(command, args));
      if (next) onstatus(next, opts.paired === true && next.configured && next.paired);
    } catch (e) {
      if (opts.inline) rejection = message(e);
      else toast.error(t("settings.messenger.action.failed", { channel: name, error: message(e) }));
    } finally {
      busy = false;
    }
  }

  /** [연결] — 칸은 넣자마자 비운다(거절되면 다시 붙여 넣는다 — 화면에 토큰을 남겨 두지 않는다) */
  function connect() {
    const token = draft.trim();
    draft = "";
    if (token === "") return;
    void run("messenger_bot_set_token", { token }, { inline: true });
  }

  async function sendTest() {
    busy = true;
    try {
      await invoke("messenger_bot_test");
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
    <TipName id="messenger-telegram-unbot" label={t("settings.messenger.telegram.unbot.label")} tip={t("settings.messenger.telegram.unbot.note")} />
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

{#if !status?.configured}
  <form
    class="srow wide-field"
    onsubmit={(e) => {
      e.preventDefault();
      connect();
    }}
  >
    <label class="name" for="messenger-telegram-token">{t("settings.messenger.telegram.token.label")}</label>
    <div class="size-row">
      <input
        id="messenger-telegram-token"
        class="value"
        type="password"
        spellcheck="false"
        autocomplete="off"
        placeholder="123456789:AA…"
        bind:value={draft}
        disabled={busy || isRemote}
        title={homeOnly}
      />
      <button type="submit" class="btn btn-primary btn-sm" disabled={busy || isRemote || draft.trim() === ""} title={homeOnly}
        >{t("settings.messenger.webhook.save")}</button
      >
    </div>
    <p class="footnote">
      {#if rejection ?? loadError}<span class="rejection" role="alert">{rejection ?? loadError}</span><br />{/if}
      {t("settings.messenger.telegram.howto")}
    </p>
  </form>
{:else if !status.paired}
  <div class="srow pair-row" data-messenger-pairing={status.pending ? "pending" : "idle"}>
    <span class="name">{t("settings.messenger.telegram.pair.label")}</span>
    <p class="footnote">{t("settings.messenger.telegram.pair.howto", { bot: bot || "Telegram" })}</p>
    {#if status.pending}
      {@const pending = status.pending}
      <div class="pair" role="group" aria-label={t("settings.messenger.telegram.pair.label")}>
        <span class="who">
          <span>{t("settings.messenger.telegram.pair.request", { name: pending.name || "?" })}</span>
          <span class="code" aria-label={t("settings.messenger.telegram.pair.code")}>{formatPairCode(pending.code)}</span>
        </span>
        <span class="pair-actions">
          <button
            type="button"
            class="btn btn-sm btn-primary"
            disabled={busy || isRemote}
            title={homeOnly}
            onclick={() => void run("messenger_bot_pair", { code: pending.code, allow: true }, { paired: true })}
            >{t("settings.messenger.telegram.pair.allow")}</button
          >
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            disabled={busy || isRemote}
            title={homeOnly}
            onclick={() => void run("messenger_bot_pair", { code: pending.code, allow: false })}
            >{t("settings.messenger.telegram.pair.deny")}</button
          >
        </span>
      </div>
    {/if}
  </div>
  {@render unbot()}
{:else}
  <div class="srow">
    <TipName
      id="messenger-channel-telegram-chat"
      for="messenger-channel-telegram-chat"
      label={t("settings.messenger.telegram.chat.label")}
      tip={t("settings.messenger.telegram.chat.note")}
    />
    <div class="size-row">
      {#if chat}
        <WarnChip label={t("settings.messenger.telegram.chat.chip")} detail={t("settings.messenger.telegram.chat.warn")} />
      {/if}
      <Toggle
        id="messenger-channel-telegram-chat"
        checked={chat}
        disabled={chatLocked}
        title={chatLocked ? t("settings.remote.homeOnly") : undefined}
        onchange={onchat}
      />
    </div>
  </div>
  <div class="srow">
    <TipName
      id="messenger-telegram-account"
      label={t("settings.messenger.telegram.account.label")}
      tip={t("settings.messenger.telegram.account.note")}
    />
    <div class="size-row">
      <span class="val" data-messenger-pair-name>{status.pairName ?? ""}</span>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={busy || isRemote}
        title={homeOnly}
        onclick={() => void run("messenger_bot_unpair", undefined)}>{t("settings.messenger.telegram.repair")}</button
      >
    </div>
  </div>
  <div class="srow">
    <span class="name">{t("settings.messenger.telegram.bot.label")}</span>
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

  /* 칸 옆 [연결] — 칸과 같은 높이 */
  .wide-field .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
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
