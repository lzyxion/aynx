<script lang="ts">
  // 원격 기기 페어링 확인(R1a-2) — 상태·IPC 는 `app/remote-pair.svelte.ts`. 주 창에서만 뜨고, **가림막이 떠 있으면 그리지 않는다**
  // (잠긴 집 PC 앞에서 기기를 들이지 못하게 — 그 파일 머리말). 기본 포커스는 [거절], Esc·바깥 클릭도 거절이다.
  import { tick } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { remotePair as p, respondRemotePair } from "$lib/app/remote-pair.svelte.js";
  let deny = $state<HTMLButtonElement | null>(null);
  let modalEl = $state<HTMLElement | null>(null);
  const visible = $derived(p.open && !veilVisible());
  $effect(() => { if (visible && deny) void tick().then(() => deny?.focus()); });
</script>

{#if visible}
  <div class="overlay" role="presentation" onmousedown={(ev) => { if (ev.target === ev.currentTarget) void respondRemotePair(false); }}>
    <div class="modal glass-raised" data-remote-pair role="dialog" tabindex="-1" aria-label={t("app.remotePair.title")}
      bind:this={modalEl}
      onkeydown={(ev) => { if (modalEl && trapTab(ev, modalEl)) return; ev.stopPropagation(); if (ev.code === "Escape") { ev.preventDefault(); void respondRemotePair(false); } }}>
      <h2>{t("app.remotePair.title")}</h2>
      <p>{t("app.remotePair.lead")}</p>
      <div class="code" data-remote-pair-code aria-label={t("app.remotePair.codeLabel")}>{p.code}</div>
      <dl>
        <dt>{t("app.remotePair.device")}</dt>
        <dd>{p.deviceName}</dd>
        {#if p.tailscaleLogin || p.tailscaleName}
          <dt>{t("app.remotePair.tailscale")}</dt>
          <dd>{[p.tailscaleName, p.tailscaleLogin].filter(Boolean).join(" · ")} <span class="note">{t("app.remotePair.tailscaleNote")}</span></dd>
        {/if}
      </dl>
      <p class="warn">{t("app.remotePair.warn")}</p>
      {#if p.error}<p class="error" role="alert">{p.error}</p>{/if}
      <div class="actions">
        <button type="button" class="btn btn-secondary" data-remote-pair-deny bind:this={deny} disabled={p.busy} onclick={() => void respondRemotePair(false)}>{t("app.remotePair.deny")}</button>
        <button type="button" class="btn btn-primary" data-remote-pair-allow disabled={p.busy} onclick={() => void respondRemotePair(true)}>{t("app.remotePair.allow")}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: grid;
    place-items: center;
    background: rgb(0 0 0 / 0.3);
  }
  .modal {
    width: 380px;
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
  }
  p {
    font-size: var(--t-sm);
    line-height: 1.5;
  }
  .code {
    margin: var(--space-3) 0;
    font-family: var(--font-mono, monospace);
    font-size: 30px;
    font-weight: var(--fw-semibold);
    letter-spacing: 0.18em;
    text-align: center;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0 0 var(--space-2);
    font-size: var(--t-sm);
  }
  dt {
    color: var(--fg-2);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note {
    color: var(--fg-2);
  }
  .warn {
    color: var(--fg-2);
  }
  .error {
    color: var(--err);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
</style>
