<script lang="ts">
  import StatusChip from "$lib/settings/StatusChip.svelte";
  import { invoke } from "../ipc";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import { tipOf } from "$lib/settings/TipName.svelte";
  import { serverConfirm, type ServerAction } from "$lib/settings/session-server-confirm";

  /** 두 단추는 세션을 닫는다 — 확인 상자를 못 띄우면 실행하지 않는다. 설정값이 아니라 [저장] · [취소] 바깥이다. */

  type Status = {
    connected: boolean;
    server_pid: number | null;
    protocol: number | null;
    app_version: string | null;
    launch_mode: string | null;
    uptime_ms: number | null;
    clients: number | null;
    sessions: number | null;
    own_job: boolean | null;
    mismatch: boolean;
    last_error: string | null;
  };

  let status = $state<Status | null>(null);
  let busy = $state(false);
  let failure = $state<string | null>(null);

  async function confirmed(action: ServerAction): Promise<boolean> {
    const q = serverConfirm(action, status?.sessions);
    if (q === null) return true;
    try {
      return await askConfirm(t(q.message, q.params), {
        title: t("settings.general.server.confirm.title"),
        kind: "warning",
        okLabel: t(q.ok),
        cancelLabel: t("settings.general.server.cancel"),
        danger: true,
      });
    } catch {
      return false;
    }
  }

  async function closeAll() {
    if (busy || !(await confirmed("closeAll"))) return;
    busy = true;
    failure = null;
    try {
      await invoke<number>("session_server_close_all");
      await refresh();
    } catch (e) {
      failure = t("settings.general.server.close_all.failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    try {
      status = await invoke<Status>("session_server_status");
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    }
  }

  async function restart() {
    if (busy || !(await confirmed("restart"))) return;
    busy = true;
    failure = null;
    try {
      status = await invoke<Status>("session_server_restart");
    } catch (e) {
      failure = t("settings.general.server.restart.failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  });

  const offChip = $derived.by((): { text: string; tip?: string; bad: boolean } | null => {
    const s = status;
    if (!s) return { text: t("settings.general.server.connecting"), bad: false };
    if (s.mismatch) return { text: t("settings.general.server.chip.mismatch"), tip: t("settings.general.server.mismatch"), bad: true };
    if (s.connected) return null;
    if (s.last_error)
      return { text: t("settings.general.server.chip.disconnected"), tip: t("settings.general.server.disconnected.error", { error: s.last_error }), bad: true };
    return { text: t("settings.general.server.connecting"), bad: false };
  });
</script>

<SettingRow
  id="session-server"
  label={t("settings.general.server.label")}
  tip={tipOf(t("settings.general.server.summary"), t("settings.general.server.note"))}
>
  {#snippet control()}
    <span class="server-actions">
      <button
        type="button"
        id="session-server"
        class="btn btn-sm btn-secondary"
        disabled={busy}
        onclick={() => void restart()}
      >
        {busy ? t("settings.general.server.restarting") : t("settings.general.server.restart")}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        data-session-server-close-all
        disabled={busy || !status?.connected}
        onclick={() => void closeAll()}
      >
        {t("settings.general.server.close_all")}
      </button>
    </span>
  {/snippet}
</SettingRow>
<div class="srow" data-session-server-state={offChip === null ? "connected" : "disconnected"}>
  <span class="name">{t("settings.general.server.status.label")}</span>
  <span class="state-chips">
    {#if offChip === null && status}
      <StatusChip tone="ok">{t("settings.general.server.chip.connected")}</StatusChip>
      <StatusChip tone="info">{t("settings.general.server.chip.pid", { pid: String(status.server_pid ?? "?") })}</StatusChip>
      <StatusChip tone="info">{t("settings.general.server.chip.protocol", { protocol: String(status.protocol ?? "?") })}</StatusChip>
      <StatusChip tone="info" title={t("settings.general.server.chip.mode")}>{status.launch_mode ?? "?"}</StatusChip>
      <StatusChip tone="info">{t("settings.general.server.chip.sessions", { sessions: String(status.sessions ?? "?") })}</StatusChip>
    {:else if offChip}
      <StatusChip tone={offChip.bad ? "bad" : "idle"} title={offChip.tip} role="status">{offChip.text}</StatusChip>
    {/if}
  </span>
</div>
{#if status?.connected && status.launch_mode === "same-job"}
  <p class="lead" role="note">{t("settings.general.server.same_job")}</p>
{/if}
{#if failure}
  <p class="lead" role="alert">{failure}</p>
{/if}

<style>
  .server-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
