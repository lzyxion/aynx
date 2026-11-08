<script lang="ts">
  import { invoke } from "../ipc";
  import { tick } from "svelte";
  import type { MessengerChannel } from "$lib/messenger-notify";
  import type { Key } from "$lib/i18n/keys";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import BrandMark from "$lib/settings/BrandMark.svelte";
  import StatusChip from "$lib/settings/StatusChip.svelte";
  import { toast } from "$lib/toast.svelte.js";

  /**
   * **메신저 채널 카드 한 장** — 채널 상자(`MessengerSettings`) 안의 한 줄
   * (docs/log/2026-09-28-messenger-channels.md "3단계 — 설정 화면" · "4단계 — 다듬기").
   *
   * 한 줄: 브랜드 마크(`BrandMark`) · 이름 · 상태 · 오른쪽 조작.
   * - **연결 안 됨** — `[+ 연결]` 을 누르면 이 카드 안에 주소 칸이 펼쳐진다(비밀번호형 · `[연결]` · `[취소]` · 등록 요령).
   *   거절 문구는 입력에 붙은 것이라 주소 칸 밑에 선다.
   * - **연결됨** — 보내기 스위치(`[messenger] <channel>`)와 `⋯` 메뉴(테스트 보내기 · 연결 해제). 메뉴 항목은 전부
   *   `runOnMenu`(스냅샷 → 닫기 → 실행 — `src/lib/browser/menu-runner.ts`)를 거친다. 결과는 토스트다(성공 · 오류).
   *
   * "연결됐는가"(`configured`)는 부모가 쥔다 — 연결된 채널이 하나라도 있는지로 부모가 규칙을 보이고
   * 숨기기 때문이다. 이 카드는 등록·해제·테스트 명령을 부르고 결과를 [`onconfigured`] 로 올린다. 웹훅 URL 은 비밀이라
   * 한 번 넣으면 다시 보여 주지 않는다(백엔드가 "등록됐는가" 만 준다 · `src-tauri/src/messenger.rs`).
   */
  let {
    channel,
    name,
    howtoKey,
    placeholder,
    id,
    sendId,
    send,
    onSendChange,
    configured,
    onconfigured,
  }: {
    channel: MessengerChannel;
    /** 화면에 적는 채널 이름 */
    name: string;
    /** 등록 요령 한 줄(그 메신저의 어디서 주소를 만드는가) */
    howtoKey: Key;
    /** 주소 칸 자리표시 — 그 채널 주소의 모양 */
    placeholder: string;
    /** 카드 자체의 id — 팔레트 색인의 anchor */
    id: string;
    /** 보내기 스위치의 id */
    sendId: string;
    /** 이 채널로 보내는가 */
    send: boolean;
    onSendChange: (on: boolean) => void;
    /** 웹훅이 등록돼 있는가 (`null` = 아직 모름) — 부모가 쥔다 */
    configured: boolean | null;
    /** 등록·해제가 끝났다 — 새 상태 */
    onconfigured: (configured: boolean) => void;
  } = $props();

  /** 주소 칸이 펼쳐져 있는가 */
  let connecting = $state(false);
  /** 주소 칸에 친 글자 — 연결하면 곧바로 비운다(화면에 남겨 두지 않는다) */
  let draft = $state("");
  let busy = $state(false);
  /** 주소 칸 밑 한 줄 — 연결 거절 문구(입력에 붙은 것이라 인라인). 테스트·연결 해제 결과는 토스트 */
  let rejection = $state<string | null>(null);
  let input = $state<HTMLInputElement | null>(null);

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function startConnect() {
    connecting = true;
    rejection = null;
    await tick();
    input?.focus({ preventScroll: true });
  }

  function cancelConnect() {
    connecting = false;
    draft = "";
    rejection = null;
  }

  /** 등록(`url`) · 해제(`null`). 등록 거절은 주소 칸 밑에, 해제 실패는 오류 토스트로 */
  async function setWebhook(url: string | null) {
    busy = true;
    rejection = null;
    try {
      const next = (await invoke<{ configured: boolean }>("messenger_set_webhook", { channel, url })).configured;
      draft = "";
      connecting = false;
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

  // ── ⋯ 메뉴 (ProfileCards 의 ⋯ 와 같은 규칙) ──────────────────────────────

  let menuOpen = $state(false);
  let menuEl = $state<HTMLElement | null>(null);
  let moreBtn = $state<HTMLButtonElement | null>(null);
  let cardEl = $state<HTMLElement | null>(null);

  function closeMenu() {
    menuOpen = false;
  }

  /** ⋯ 를 연다 — 첫 항목에 포커스를 줘 ↑↓·Enter 가 바로 닿게 한다 */
  async function toggleMenu() {
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    await tick();
    menuEl?.querySelector<HTMLButtonElement>("button[role='menuitem']")?.focus({ preventScroll: true });
  }

  /** ↑↓ 로 돌고 Escape 로 닫는다 — Escape 는 여기서 끊는다(설정 독까지 닫지 않게) */
  function onMenuKey(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
      moreBtn?.focus({ preventScroll: true });
      return;
    }
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const buttons = Array.from(menuEl?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']") ?? []);
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = ev.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus({ preventScroll: true });
  }

  /** 바깥을 누르면 닫는다 (메뉴·⋯ 는 이 카드 안이라 걸리지 않는다) */
  function onWindowPointerDown(ev: PointerEvent) {
    if (!menuOpen) return;
    if (ev.target instanceof Node && cardEl?.contains(ev.target)) return;
    menuOpen = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- 채널 한 칸 — 공용 분할 목록(`.slist`, settings.css)의 한 줄. 줄 누르기는 없고(줄 단추 `.slist-open` 없음), 끝 칸에 스위치 · ⋯ 또는 [연결] -->
<div class="channel" class:off={configured && !send} {id} bind:this={cardEl}>
  <div class="slist-row">
    <span class="slist-lead brand-lead" aria-hidden="true"><BrandMark {channel} size={18} /></span>
    <span class="slist-text">
      <span class="slist-name">{name}</span>
      <span class="slist-sup chip-line">
        {#if configured}
          <StatusChip tone={send ? "ok" : "idle"}>{send ? t("settings.messenger.status.sending") : t("settings.messenger.status.paused")}</StatusChip>
        {:else}
          <StatusChip tone="off">{t("settings.messenger.status.none")}</StatusChip>
        {/if}
      </span>
    </span>
    <span class="slist-trail">
    {#if configured}
      <span class="slist-switch">
        <Toggle
          id={sendId}
          checked={send}
          label={t("settings.messenger.channel.send.label", { channel: name })}
          onchange={onSendChange}
        />
      </span>
      <button
        type="button"
        class="btn btn-ghost btn-sm icon"
        bind:this={moreBtn}
        aria-label={t("settings.messenger.menu.aria", { channel: name })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={busy}
        onclick={() => void toggleMenu()}><UiIcon name="more" size={14} /></button
      >
    {:else if !connecting}
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        disabled={configured === null}
        onclick={() => void startConnect()}
        ><UiIcon name="plus" size={12} />{t("settings.messenger.connect")}</button
      >
    {/if}
    </span>
  </div>

  {#if menuOpen && configured}
    <div class="menu menu-surface" role="menu" tabindex="-1" bind:this={menuEl} onkeydown={onMenuKey}>
      <button type="button" class="menu-row" role="menuitem" onclick={() => runOnMenu(() => channel, closeMenu, sendTest)}
        >{t("settings.messenger.test.button")}</button
      >
      <div class="menu-sep" role="separator"></div>
      <button
        type="button"
        class="menu-row danger"
        role="menuitem"
        onclick={() => runOnMenu(() => channel, closeMenu, () => setWebhook(null))}
        >{t("settings.messenger.disconnect")}</button
      >
    </div>
  {/if}

  {#if connecting && !configured}
    <form
      class="connect"
      onsubmit={(e) => {
        e.preventDefault();
        if (draft.trim() !== "") void setWebhook(draft);
      }}
    >
      <div class="size-row">
        <input
          class="value"
          type="password"
          spellcheck="false"
          autocomplete="off"
          aria-label={t("settings.messenger.webhook.label", { channel: name })}
          {placeholder}
          bind:this={input}
          bind:value={draft}
          disabled={busy}
          onkeydown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelConnect();
            }
          }}
        />
        <button type="submit" class="btn btn-primary btn-sm" disabled={busy || draft.trim() === ""}
          >{t("settings.messenger.webhook.save")}</button
        >
        <button type="button" class="btn btn-ghost btn-sm" disabled={busy} onclick={cancelConnect}
          >{t("settings.actions.cancel")}</button
        >
      </div>
      {#if rejection}<p class="rejection" role="alert">{rejection}</p>{/if}
      <p class="howto">{t(howtoKey)} {t("settings.messenger.webhook.note")}</p>
    </form>
  {/if}
</div>

<style>
  /* 줄 면 · 모서리 · 틈은 공용 `.slist > *` 가 칠한다 — 여기는 ⋯ 메뉴의 기준 자리만 */
  .channel {
    position: relative;
  }

  /* 줄 누르기가 없는 줄이라 호버 상태 층을 걷는다(누를 수 있는 줄로 읽히지 않게) */
  .channel .slist-row:hover {
    background-image: none;
  }

  /* 앞 칸 = 브랜드 칩 자체 — 흰 칩(`BrandMark`)을 공용 앞 칸 크기 · 모서리로 키운다(칩 안에 칩이 겹치지 않게) */
  .brand-lead {
    background: none;
  }

  .brand-lead :global(.brand) {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  /* 딸린 줄 자리의 상태 칩 — 칩 높이를 공용 `.slist-sup` 의 넘침 자르기가 깎지 않게 */
  .slist-sup.chip-line {
    display: flex;
    overflow: visible;
  }

  .btn :global(svg) {
    flex: none;
  }

  /* ⋯ 메뉴 — 모양은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface`·`.menu-row`), 여기는 자리만 */
  .menu {
    position: absolute;
    top: 46px;
    right: var(--space-2);
    z-index: 5;
    min-width: 160px;
  }

  /* 연결 칸 — 줄 아래, 앞 칸(32) + 틈(12) 뒤 글자 열에 맞춘다 */
  .connect {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0 12px 12px 54px;
  }

  .connect .value {
    flex: 1 1 auto;
    min-width: 6em;
  }

  /* 웹훅 칸 옆 [저장] · [취소] — 칸과 같은 높이, 글자 · 여백은 전역 `.btn` 값 */
  .connect .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .howto,
  .rejection {
    margin: 0;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-3);
    word-break: keep-all;
  }

  .rejection {
    color: var(--err);
  }
</style>
