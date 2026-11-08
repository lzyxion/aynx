<script lang="ts">
  import StatusChip from "$lib/settings/StatusChip.svelte";
  import { invoke } from "../ipc";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import { tipOf } from "$lib/settings/TipName.svelte";
  import { serverConfirm, type ServerAction } from "$lib/settings/session-server-confirm";

  /**
   * **세션 서버** 한 줄 (설계 internal/session-server-design-2026-10-08.md ③ — `src-tauri/src/server.rs`).
   *
   * 분리 프로세스 `aynx session-server` 에 붙어 있는지 · pid · 판 · 띄운 방식 · 살아 있는 세션 수를 보이고 [다시 시작] ·
   * [모든 세션 종료] 를 둔다. ③-2 부터 **로컬 세션은 서버에 산다** — 앱을 닫아도 셸이 살고, 다시 켜면 붙는다. 두 단추는
   * 세션을 닫으므로 살아 있는 세션이 있으면 앱의 다른 확인과 같은 확인 상자(`askConfirm()`)로 먼저 묻는다(0개면 바로 —
   * 판정은 `session-server-confirm.ts`). 대화를 못 띄우면 실행하지 않는다. 세션을 한꺼번에 끝내는 길은 이것과 트레이 메뉴의 [모든 세션 종료](③-4 —
   * 그쪽은 서버까지 끝내고 GUI 도 닫는다) 둘이다.
   * 이 줄이 열려 있는 동안만 3초마다 상태를 다시 읽는다(설정값이 아니라 [저장]·[취소] 바깥이다).
   */

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

  /** 세션을 닫는 단추 — 살아 있는 세션이 있으면 먼저 묻는다. 실행해도 되면 `true` */
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

  /** 붙어 있지 않을 때의 칩 하나 — 글자 · 툴팁(긴 사유) · 나쁜가. 붙어 있으면 `null` 이고 사실 칩 줄이 대신 선다 */
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
    <!-- 손잡이 둘이 한 줄에 선다 — 위험한 쪽([모든 세션 종료])이 오른쪽 끝. 칸이 모자라면 오른쪽 정렬로 두 줄 -->
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
<!-- 상태 — 원격 접속 › 상태와 같은 줄([상태] …… 알약들 — 공용 `.state-chips`, 2026-10-28). 붙어 있으면 [연결됨] [pid] [판] [띄운 방식] [세션 N개],
     아니면 칩 하나(연결 중 · 판 불일치 · 끊김 — 긴 사유는 툴팁) -->
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
  /* 손잡이 둘 — 볼트 상태 줄의 `.vault-actions` 와 같은 모양. 좁으면 줄을 바꾸되 오른쪽 끝에 맞춘다 */
  .server-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
