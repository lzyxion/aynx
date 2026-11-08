<script lang="ts">
  // 원격 창의 앱 모달(R4) — 묻기(네이티브 confirm 대신)와 마스터 재확인. 상태는 `app/remote-dialog.svelte.ts`, 단추·문구는
  // `$lib/remote-dialog`. 원격 창에서만 줄이 찬다(집 PC 창에서는 아무것도 그리지 않는다).
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { initialFocus, reauthWhatKey } from "$lib/remote-dialog";
  import {
    answerRemoteMessage,
    cancelRemoteReauth,
    currentRemoteDialog,
    dismissRemoteMessage,
    remoteDialogBusy,
    remoteDialogError,
    submitRemoteReauth,
  } from "$lib/app/remote-dialog.svelte.js";

  const req = $derived(currentRemoteDialog());
  let modalEl = $state<HTMLElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let password = $state("");
  const buttons: HTMLButtonElement[] = $state([]);

  // 새 모달이 서면 포커스 — 재확인(마스터 있음)은 암호 칸, 묻기는 경고면 취소 쪽 · 아니면 강조 단추.
  $effect(() => {
    const r = req;
    if (!r) return;
    password = "";
    void tick().then(() => {
      if (r.kind === "reauth") (r.hasMaster ? input : buttons[1])?.focus();
      else buttons[initialFocus(r.choices, r.tone)]?.focus();
    });
  });

  // 실패하면 칸을 비우고 다시 포커스(암호는 이 컴포넌트의 칸에만 — 상태 모듈에 두지 않는다).
  $effect(() => {
    if (remoteDialogError() === null) return;
    password = "";
    void tick().then(() => input?.focus());
  });

  function close(): void {
    if (!req) return;
    if (req.kind === "reauth") cancelRemoteReauth();
    else dismissRemoteMessage();
  }

  function onKey(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    // 앱의 전역 단축키·터미널이 이 상자의 키를 받지 않게.
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      if (!remoteDialogBusy()) close();
    }
  }

  function submit(ev: SubmitEvent): void {
    ev.preventDefault();
    const pw = password;
    password = "";
    void submitRemoteReauth(pw);
  }
</script>

{#if req}
  <div
    class="overlay"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget && !remoteDialogBusy()) close();
    }}
  >
    {#if req.kind === "reauth"}
      {@const whatKey = reauthWhatKey(req.cmd)}
      <div
        class="modal glass-raised"
        data-remote-reauth
        role="dialog"
        aria-modal="true"
        aria-labelledby="remote-dialog-title"
        tabindex="-1"
        bind:this={modalEl}
        onkeydown={onKey}
      >
      <form onsubmit={submit}>
        <h2 id="remote-dialog-title">
          {req.hasMaster ? t("app.remoteReauth.title") : t("app.remoteReauth.title.noMaster")}
        </h2>
        <p class="what" data-remote-reauth-what>{whatKey ? t(whatKey) : req.cmd}</p>
        {#if req.hasMaster}
          <p class="lead">{t("app.remoteReauth.lead")}</p>
          <input
            type="password"
            autocomplete="current-password"
            maxlength="1024"
            spellcheck="false"
            aria-label={t("app.remoteReauth.field")}
            placeholder={t("app.remoteReauth.field")}
            bind:this={input}
            bind:value={password}
            disabled={remoteDialogBusy()}
          />
          {#if remoteDialogError()}
            <p class="error" role="alert" data-remote-reauth-error>{remoteDialogError()}</p>
          {/if}
        {:else}
          <!-- 9-① 사용자 결정의 화면 몫 — 마스터가 없으면 암호를 묻지 않는다는 사실을 그대로 밝힌다. -->
          <p class="lead">{t("app.remoteReauth.lead.noMaster")}</p>
        {/if}
        <div class="actions">
          <button
            type="button"
            class="btn btn-secondary"
            data-remote-reauth-cancel
            bind:this={buttons[0]}
            disabled={remoteDialogBusy()}
            onclick={cancelRemoteReauth}>{t("app.actions.cancel")}</button
          >
          <button
            type="submit"
            class="btn btn-primary"
            data-remote-reauth-ok
            bind:this={buttons[1]}
            disabled={remoteDialogBusy() || (req.hasMaster && password === "")}
            >{t("app.remoteReauth.ok")}</button
          >
        </div>
      </form>
      </div>
    {:else}
      <div
        class="modal glass-raised"
        data-remote-message
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={req.title ? "remote-dialog-title" : undefined}
        aria-describedby="remote-dialog-message"
        tabindex="-1"
        bind:this={modalEl}
        onkeydown={onKey}
      >
        {#if req.title}<h2 id="remote-dialog-title">{req.title}</h2>{/if}
        <p class="message" class:warn={req.tone === "warning"} class:bad={req.tone === "error"} id="remote-dialog-message">
          {req.message}
        </p>
        <div class="actions">
          {#each req.choices as c, i (i)}
            <button
              type="button"
              class="btn {c.primary ? 'btn-primary' : 'btn-secondary'}"
              data-remote-message-choice={c.result}
              bind:this={buttons[i]}
              onclick={() => answerRemoteMessage(c.result)}>{c.key ? t(c.key) : c.label}</button
            >
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* 다른 모달(설정 독 · 호스트 폼 …) 안에서 물어도 그 위에 — 원격 페어링 상자(110)보다 위 */
    z-index: 120;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: rgb(0 0 0 / 0.3);
  }
  .modal {
    width: min(400px, 100%);
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    box-sizing: border-box;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
    color: var(--fg-1);
  }
  h2 {
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
  }
  p {
    margin: 0 0 var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
  }
  .message {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .what {
    font-weight: var(--fw-semibold);
  }
  .lead {
    color: var(--fg-2);
  }
  .warn {
    color: var(--fg-1);
  }
  .bad,
  .error {
    color: var(--err);
  }
  input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    margin: 0 0 var(--space-3);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }
  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  /* 폰 · 태블릿(R5) — 손가락으로 누를 단추는 44px 높이 */
  @media (pointer: coarse) {
    .actions button {
      min-height: 44px;
      padding-inline: 18px;
    }
  }
</style>
