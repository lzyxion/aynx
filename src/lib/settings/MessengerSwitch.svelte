<script lang="ts">
  import { isRemote } from "../ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { stripReason } from "$lib/error-reason";

  /**
   * **Discord 의 방식 바꾸기 칸**(2026-11-19 목업 "Discord 채널 줄" ②③ · ⑤⑥) — 한 방식이 연결된 채로 "연결 방식" 에서 다른 방식을 골랐을 때
   * 그 방식의 칸 하나. [연결] 은 곧바로 등록하지 않고 칸 자리에 바꾸기 확인을 세운다 — [바꾸기] 만 바꾸고(`run`), [취소] 는 칸으로 돌아간다.
   *
   * - **친 비밀(토큰 · 주소)은 화면에 남기지 않는다** — 확인이 서는 순간 칸을 비우고 값은 이 몸통의 메모리(룬 아닌 변수)에만 둔다. 확인 · 취소 ·
   *   거절 어느 쪽이든 끝나면 버린다.
   * - 거절(틀린 토큰 · 주소 · 닿지 않음)이면 아무것도 바뀌지 않는다(백엔드 순서 — `messenger_bot_set_token` · `messenger_replace_bot_with_webhook`) —
   *   칸으로 돌아가 그 밑에 문구를 세운다(연결 전 몸통과 같은 자리).
   * - 원격 창에서는 칸 · [연결] · [바꾸기] 가 잠긴다(`locked` — 어느 방향이든 봇 토큰을 넣거나 지운다 · "메인 PC 에서만" 툴팁).
   */
  let {
    inputId,
    label,
    placeholder,
    howto,
    note,
    title,
    body,
    locked,
    run,
  }: {
    /** 연결 전 몸통의 칸과 같은 id(`messenger-discord-token` · `messenger-discord-webhook`) */
    inputId: string;
    label: string;
    placeholder: string;
    /** 그 방식의 등록 요령(연결 전 몸통과 같은 글) */
    howto: string;
    /** 지금 연결된 방식과 바꾸면 무엇이 지워지는가 한 줄 */
    note: Key;
    /** 확인 상자의 제목 · 본문 */
    title: Key;
    body: Key;
    locked: boolean;
    /** [바꾸기] — 거절이면 던진다(문구 = 칸 밑 한 줄) */
    run: (secret: string) => Promise<void>;
  } = $props();

  let draft = $state("");
  let confirming = $state(false);
  let busy = $state(false);
  let rejection = $state<string | null>(null);
  /** 확인을 기다리는 값 — 화면 상태가 아니다(그리지 않는다) */
  let held: string | null = null;

  const homeOnly = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);

  function ask() {
    const value = draft.trim();
    draft = "";
    if (value === "" || locked) return;
    held = value;
    rejection = null;
    confirming = true;
  }

  function cancel() {
    held = null;
    confirming = false;
  }

  async function confirm() {
    const value = held;
    held = null;
    if (value === null || locked) return cancel();
    busy = true;
    try {
      await run(value);
    } catch (e) {
      rejection = stripReason(e instanceof Error ? e.message : String(e));
      confirming = false;
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="srow wide-field"
  data-messenger-switch-to={confirming ? "confirm" : "field"}
  onsubmit={(e) => {
    e.preventDefault();
    ask();
  }}
>
  <label class="name" for={confirming ? undefined : inputId}>{label}</label>
  {#if confirming}
    <div class="confirm" role="alertdialog" aria-labelledby="{inputId}-confirm-title" data-messenger-confirm>
      <span>
        <b id="{inputId}-confirm-title">{t(title)}</b>
        {t(body)}
      </span>
      <span class="acts">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          disabled={busy || locked}
          title={homeOnly}
          data-messenger-confirm-go
          onclick={() => void confirm()}>{t("settings.messenger.discord.replace")}</button
        >
        <button type="button" class="btn btn-sm btn-secondary" disabled={busy} data-messenger-confirm-cancel onclick={cancel}
          >{t("settings.actions.cancel")}</button
        >
      </span>
    </div>
  {:else}
    <div class="size-row">
      <input
        id={inputId}
        class="value"
        type="password"
        spellcheck="false"
        autocomplete="off"
        {placeholder}
        bind:value={draft}
        disabled={busy || locked}
        title={homeOnly}
      />
      <button type="submit" class="btn btn-primary btn-sm" disabled={busy || locked || draft.trim() === ""} title={homeOnly}
        >{t("settings.messenger.webhook.save")}</button
      >
    </div>
    <p class="footnote">
      {#if rejection}<span class="rejection" role="alert">{rejection}</span><br />{/if}
      {howto}<br />{t(note)}
    </p>
  {/if}
</form>

<style>
  /* 칸 옆 [연결] — 칸과 같은 높이 */
  .wide-field .size-row .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .rejection {
    color: var(--err);
  }

  /* 바꾸기 확인 — 칸 자리에 서는 경고 면(이름 밑 줄을 다 쓴다) */
  .confirm {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    color: var(--on-warn-soft);
    background: var(--warn-soft);
    border-radius: 14px;
  }

  .confirm b {
    display: block;
    font-weight: var(--fw-semibold, 600);
  }

  .acts {
    display: inline-flex;
    gap: var(--space-2);
  }
</style>
