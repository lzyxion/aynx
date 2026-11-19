<script lang="ts">
  import type { Snippet } from "svelte";
  import { isRemote } from "../ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import { joinTokens } from "$lib/settings/messenger-view";
  import MessengerTokenForm from "$lib/settings/MessengerTokenForm.svelte";

  /**
   * **두 방식 채널(Discord · Slack)의 방식 바꾸기 칸**(2026-11-19 목업 "Discord 채널 줄" ②③ · ⑤⑥ · "Slack 채널 줄" ④) — 한 방식이 연결된 채로
   * "연결 방식" 에서 다른 방식을 골랐을 때 그 방식의 칸(Slack 봇은 두 칸). [연결] 은 곧바로 등록하지 않고 칸 자리에 바꾸기 확인을 세운다 —
   * [바꾸기] 만 바꾸고(`run`), [취소] 는 칸으로 돌아간다.
   *
   * - **친 비밀(토큰 · 주소)은 화면에 남기지 않는다** — 확인이 서는 순간 칸을 비우고 값은 이 몸통의 메모리(룬 아닌 변수)에만 둔다. 확인 · 취소 ·
   *   거절 어느 쪽이든 끝나면 버린다. 칸이 둘이면 `joinTokens`(`"<봇>\n<앱>"`)로 이어 한 값으로 둔다.
   * - 거절(틀린 토큰 · 주소 · 닿지 않음)이면 아무것도 바뀌지 않는다(백엔드 순서 — `messenger_bot_set_token` · `messenger_replace_bot_with_webhook`) —
   *   칸으로 돌아가 그 밑에 문구를 세운다(연결 전 몸통과 같은 자리).
   * - 원격 창에서는 칸 · [연결] · [바꾸기] 가 잠긴다(`locked` — 어느 방향이든 봇 토큰을 넣거나 지운다 · "메인 PC 에서만" 툴팁).
   */
  let {
    fields,
    name,
    howto,
    steps,
    note,
    title,
    body,
    locked,
    run,
  }: {
    /** 칸들 — 연결 전 몸통의 칸과 같은 id(`messenger-<채널>-token` · `messenger-slack-app-token` · `messenger-<채널>-webhook`) */
    fields: readonly { id: string; label: string; placeholder: string }[];
    /** 줄 이름 — 칸이 둘일 때와 확인이 섰을 때 */
    name: string;
    /** 그 방식의 등록 요령(연결 전 몸통과 같은 글 — 번호 줄이면 빈 글자) */
    howto: string;
    /** 번호 줄 요령(Slack 봇 — `MessengerSlackSteps`) — 글 밑에 */
    steps?: Snippet;
    /** 지금 연결된 방식과 바꾸면 무엇이 지워지는가 한 줄 */
    note: string;
    /** 확인 상자의 제목 · 본문 */
    title: string;
    body: string;
    locked: boolean;
    /** [바꾸기] — 거절이면 던진다(문구 = 칸 밑 한 줄) */
    run: (secret: string) => Promise<void>;
  } = $props();

  let confirming = $state(false);
  let busy = $state(false);
  let rejection = $state<string | null>(null);
  /** 확인을 기다리는 값 — 화면 상태가 아니다(그리지 않는다) */
  let held: string | null = null;

  const homeOnly = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);
  const titleId = $derived(`${fields[0]?.id ?? "messenger-switch"}-confirm-title`);

  function ask(values: string[]) {
    const value = joinTokens(values);
    if (value === null || locked) return;
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

{#snippet footnote()}
  <p class="footnote">
    {#if rejection}<span class="rejection" role="alert">{rejection}</span><br />{/if}
    {#if howto}{howto}<br />{/if}{note}
  </p>
  {@render steps?.()}
{/snippet}

{#if confirming}
  <div class="srow wide-field" data-messenger-switch-to="confirm">
    <span class="name">{name}</span>
    <div class="confirm" role="alertdialog" aria-labelledby={titleId} data-messenger-confirm>
      <span>
        <b id={titleId}>{title}</b>
        {body}
      </span>
      <span class="acts">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          disabled={busy || locked}
          title={homeOnly}
          data-messenger-confirm-go
          onclick={() => void confirm()}>{t("settings.messenger.replace")}</button
        >
        <button type="button" class="btn btn-sm btn-secondary" disabled={busy} data-messenger-confirm-cancel onclick={cancel}
          >{t("settings.actions.cancel")}</button
        >
      </span>
    </div>
  </div>
{:else}
  <MessengerTokenForm
    {fields}
    {name}
    disabled={busy || locked}
    title={homeOnly}
    onsubmit={ask}
    {footnote}
    data-messenger-switch-to="field"
  />
{/if}

<style>
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
