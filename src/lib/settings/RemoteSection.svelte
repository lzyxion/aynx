<script lang="ts">
  import type { Snippet } from "svelte";
  import StateRow from "$lib/settings/StateRow.svelte";
  import StatusChip from "$lib/settings/StatusChip.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import { settings, settingsNav, setRemoteEnabled, setRemoteHost, setRemotePort } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import { DEV_INSTANCE } from "$lib/app/instance";
  import Toggle from "$lib/Toggle.svelte";
  import CommandBlock from "$lib/CommandBlock.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { relativeTime } from "$lib/notifications";
  import { writeClipboard } from "$lib/clipboard";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { refreshVault, vaultStatus } from "$lib/app/vault.svelte.js";
  import {
    connectFlow,
    connectRemoteServe,
    detectRemoteHost,
    disconnectAllRemote,
    refreshRemoteAccess,
    refreshRemoteServe,
    remoteDevices,
    remoteLog,
    remoteServe,
    remoteStatus,
    renameRemoteDevice,
    resetConnectFlow,
    revokeRemoteDevice,
    serveOffRemote,
  } from "$lib/app/remote-access.svelte.js";
  import {
    aclExample,
    connectRowState,
    DNS_NAME_COMMAND,
    firstOpenCard,
    SERVE_OFF_COMMAND,
    SERVE_STATUS_COMMAND,
    hostNote,
    hostNoteIcon,
    logKindKey,
    remoteAnchorCard,
    remoteStateView,
    remoteUrl,
    serveCommand,
    TAILSCALE_DOWNLOAD_URL,
    validTsHost,
    type RemoteCard,
  } from "$lib/remote-access";

  /**
   * 설정 › 원격 접속.
   * - 상태 줄 · 처음 펼칠 카드는 이번 방문에 새로 읽은 값으로만 판정한다 — 모듈 상태의 지난 값이면 초록이 깜빡이고 잘못된 카드가 열렸다 닫힌다.
   * - 켜기 · 이름 · 포트는 메인 PC 에서만이다(Rust `remote/deny.rs` 의 `save_settings` 칸 단위 문이 원격 저장을 거절한다) — 원격 창에서는
   *   그 칸을 잠그고(끄기만 된다) Tailscale 연결 줄 · [찾기] 도 그리지 않는다(메인 PC 전용 명령).
   * - [연결] 은 `[remote]` 의 켬 · 이름 · 포트만 곧바로 저장하고 다른 칸의 미저장 편집은 그대로 둔다 · [serve 끄기] 는 serve 만 걷고 `[remote]` 는 안 바꾼다.
   * - 저장된 켬이고 볼트에 마스터가 없으면 그 사실을 상태 줄의 경고 칩으로 밝힌다(마스터는 선택이다).
   * - 원격 창은 `remote-sessions` 이벤트를 받지 않으므로 보이는 동안 다시 읽는다.
   */
  let { active = false }: { active?: boolean } = $props();

  let accessFresh = $state(false);
  let serveFresh = $state(false);

  $effect(() => {
    if (!active) {
      confirmRevoke = null;
      editing = null;
      accessFresh = false;
      resetConnectFlow();
      return;
    }
    let live = true;
    void refreshRemoteAccess().then(() => {
      if (live) accessFresh = true;
    });
    void refreshVault();
    const id = setInterval(() => void refreshRemoteAccess(), 3000);
    return () => {
      live = false;
      clearInterval(id);
    };
  });

  /** 칸의 지금 포트(저장 전 포함) — `null` 이면 Rust 가 인스턴스 기본을 쓴다 */
  const servePort = $derived(settings.current.remote.port ?? null);
  $effect(() => {
    if (!active || isRemote) {
      serveFresh = false;
      return;
    }
    const p = servePort;
    let live = true;
    void refreshRemoteServe(p).then(() => {
      if (live) serveFresh = true;
    });
    const id = setInterval(() => void refreshRemoteServe(p), 15_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  });

  let now = $state(Date.now());
  $effect(() => {
    if (!active) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });

  const status = $derived(remoteStatus());
  const prefs = $derived(settings.current.remote);
  const saved = $derived(settings.saved.remote);
  const unsaved = $derived(
    prefs.enabled !== saved.enabled || prefs.host !== saved.host || prefs.port !== saved.port,
  );
  /** 원격 창은 끄기만 — 저장된 값이 켬일 때만 손잡이가 산다 */
  const toggleLocked = $derived(isRemote && !saved.enabled);
  const port = $derived(prefs.port ?? status?.port ?? 0);
  const hostInvalid = $derived(!!prefs.host && !validTsHost(prefs.host));
  const noMaster = $derived(!!saved.enabled && vaultStatus().hasMaster !== true);
  const url = $derived(remoteUrl(prefs.host ?? "") ?? "https://<MagicDNS>/");

  // ── Tailscale 연결 ──
  const row = $derived(
    connectRowState({
      flow: connectFlow(),
      status,
      serve: remoteServe(),
      savedEnabled: !!saved.enabled,
      savedHost: saved.host,
    }),
  );
  /** "443 이 {target} …" 을 `{target}` 자리에서 둘로 — 어순은 사전이 정하고 대상만 mono 로 그린다 */
  const otherParts = $derived.by(() => {
    const [before = "", after = ""] = t("settings.remote.connect.other").split("{target}");
    return { before, after };
  });
  function openExternal(link: string): void {
    void openUrl(link).catch(() => window.open(link, "_blank", "noopener"));
  }
  let urlCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyUrl(link: string): Promise<void> {
    if (!(await writeClipboard(link))) return;
    urlCopied = true;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (urlCopied = false), 1500);
  }
  $effect(() => () => clearTimeout(copyTimer));

  // ── 이름 찾기 ──
  let detecting = $state(false);
  let detectError = $state<string | null>(null);
  let detected = $state<{ host: string; changed: boolean } | null>(null);
  async function detect(): Promise<void> {
    detecting = true;
    detectError = null;
    detected = null;
    try {
      const before = prefs.host ?? "";
      setRemoteHost(await detectRemoteHost());
      const host = settings.current.remote.host ?? "";
      detected = { host, changed: host !== before };
    } catch (e) {
      detectError = String(e);
    } finally {
      detecting = false;
    }
  }

  const note = $derived(
    hostNote({
      host: prefs.host,
      savedHost: saved.host,
      enabled: !!prefs.enabled,
      status,
      detected,
      dev: DEV_INSTANCE,
      remote: isRemote,
    }),
  );
  const noteIcon = $derived(hostNoteIcon(note));
  const noteText = $derived.by(() => {
    switch (note?.kind) {
      case "found":
        return t("settings.remote.host.found", { host: note.host });
      case "same":
        return t("settings.remote.host.same");
      case "applied":
        return t("settings.remote.host.applied", { url: note.url });
      case "missing":
        return t("settings.remote.host.missing");
      case "devLoopback":
        return t("settings.remote.host.devLoopback");
      default:
        return "";
    }
  });

  // ── 펼침 ──
  const CARDS: readonly RemoteCard[] = ["access", "devices", "log", "guide"];
  let expanded = $state<RemoteCard | null>(null);
  const openIndex = $derived(expanded === null ? -1 : CARDS.indexOf(expanded));
  /** 이번 방문의 펼침이 정해졌다(처음 판정 · 사람의 여닫기 · 앵커) — 뒤로는 폴링이 펼침을 움직이지 않는다 */
  let decided = false;
  let instant = $state(false);

  $effect(() => {
    if (!active) {
      decided = false;
      expanded = null;
      return;
    }
    if (decided) return;
    const first = firstOpenCard(stateView.phase);
    if (first === undefined) return;
    decided = true;
    expanded = first;
  });

  function openCard(card: RemoteCard | null): void {
    decided = true;
    expanded = card;
  }

  /** 접힌 카드 안의 칸을 가리키면 그 카드 하나만 펼친다 — 펼친 줄이 곧바로 재어지도록 이때만 전이를 건너뛴다(`instant`) */
  export function expandForAnchor(anchor: string): void {
    const card = remoteAnchorCard(anchor);
    if (card === null) return;
    if (expanded !== card) instant = true;
    openCard(card);
    requestAnimationFrame(() => requestAnimationFrame(() => (instant = false)));
  }

  // ── 기기 ──
  let confirmRevoke = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let draft = $state("");
  let deviceError = $state<string | null>(null);
  let busy = $state(false);

  function whenOf(stamp: string): string {
    const at = Date.parse(stamp);
    return Number.isFinite(at) ? relativeTime(at, now, t) : "";
  }

  async function act(fn: () => Promise<unknown>): Promise<void> {
    busy = true;
    deviceError = null;
    try {
      await fn();
    } catch (e) {
      deviceError = String(e);
      // 오류 줄은 기기 카드 안에 선다 — 머리의 [모두 끊기] 는 접힌 채로 누를 수 있으니 열어서 보인다
      openCard("devices");
    } finally {
      busy = false;
    }
  }

  function startRename(id: string, name: string): void {
    editing = id;
    draft = name;
    confirmRevoke = null;
  }

  function saveRename(id: string): void {
    const name = draft.trim();
    if (!name) return;
    void act(async () => {
      await renameRemoteDevice(id, name);
      editing = null;
    });
  }

  function revoke(id: string): void {
    if (confirmRevoke !== id) {
      confirmRevoke = id;
      return;
    }
    confirmRevoke = null;
    void act(() => revokeRemoteDevice(id));
  }

  const openDevices = $derived(remoteDevices().filter((d) => d.unlocked).length);
  const stateView = $derived(
    remoteStateView({
      remote: isRemote,
      status: accessFresh ? status : null,
      serve: serveFresh ? remoteServe() : null,
      savedEnabled: !!saved.enabled,
      hasMaster: vaultStatus().hasMaster === true,
      deviceCount: remoteDevices().length,
    }),
  );
  const accessUrl = $derived.by(() => {
    if (isRemote) return stateView.phase === "connected" ? remoteUrl(saved.host ?? "") : null;
    return row.state === "connected" ? row.url : null;
  });
  const anyOpen = $derived(openDevices > 0);
  const recent = $derived(remoteLog().slice(0, 12));
  /** 그리는 최근 12건 안의 잠금 해제 실패 수 — 시간 창 · 확인 처리는 없다(그 줄들이 밀려 나가면 칩도 사라진다) */
  const unlockFailures = $derived(recent.filter((e) => e.kind === "unlockFailed").length);
  const lastLogLine = $derived.by(() => {
    for (const e of recent) {
      const key = logKindKey(e.kind);
      if (key) return `${whenOf(e.at)} · ${t(key)} · ${e.deviceName || t("settings.remote.log.all")}`;
    }
    return null;
  });
</script>

<!-- 칩 줄은 머리 단추의 형제다(단추 안에 경고 칩 단추를 둘 수 없다) · 접힌 몸통은 `inert` 라 Tab 이 밟지 않는다 -->
{#snippet card(
  id: RemoteCard,
  title: Snippet,
  sup: Snippet,
  trail: Snippet | null,
  body: Snippet,
)}
  {@const i = CARDS.indexOf(id)}
  {@const open = expanded === id}
  <section
    class="slist-item"
    class:open
    class:instant
    class:g-first={openIndex >= 0 && (i === openIndex || i === openIndex + 1)}
    class:g-last={i === CARDS.length - 1 || i === openIndex || i === openIndex - 1}
    data-remote-card={id}
    data-remote-card-open={open ? "" : undefined}
  >
    <div class="slist-row remote-head">
      <button
        type="button"
        class="slist-open"
        aria-expanded={open}
        aria-controls="remote-card-{id}"
        aria-describedby="remote-card-{id}-sup"
        data-remote-card-toggle={id}
        onclick={() => openCard(open ? null : id)}
      >
        <span class="slist-text">
          <span class="slist-title">{@render title()}</span>
        </span>
      </button>
      <span class="slist-sup head-sup" id="remote-card-{id}-sup">{@render sup()}</span>
      <span class="slist-trail">
        {@render trail?.()}
        <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron-down" size={16} /></span>
      </span>
    </div>
    <div class="slist-collapse" id="remote-card-{id}" inert={!open}>
      <div class="slist-collapse-inner">
        <div class="slist-panel">
          {@render body()}
        </div>
      </div>
    </div>
  </section>
{/snippet}

{#snippet accessTitle()}
  <span class="slist-name" title={t("settings.remote.enabled.note")} data-tip-place="above">{t("settings.remote.enabled.label")}</span>
{/snippet}

{#snippet accessSup()}
  {#if accessUrl}
    {@const link = accessUrl}
    <span class="mono" data-remote-access-url>{accessUrl}</span>
    <button type="button" class="btn btn-sm btn-secondary mini" data-remote-url-copy onclick={() => void copyUrl(link)}>
      {urlCopied ? t("settings.remote.connect.copied") : t("settings.remote.connect.copy")}
    </button>
  {:else}
    <span data-remote-access-url>{t("settings.remote.notConnected")}</span>
  {/if}
  {#if unsaved}
    <StatusChip tone="warn" role="status" data-remote-unsaved>{t("settings.remote.unsaved")}</StatusChip>
  {/if}
{/snippet}

{#snippet accessTrail()}
  <span class="slist-switch" title={t("settings.remote.enabled.note")} data-tip-place="above">
    <Toggle
      id="remote-enabled"
      checked={!!prefs.enabled}
      disabled={toggleLocked}
      label={t("settings.remote.enabled.label")}
      title={toggleLocked ? t("settings.remote.homeOnly") : undefined}
      onchange={setRemoteEnabled}
    />
  </span>
{/snippet}

{#snippet accessBody()}
  <div class="rows term slist-body">
    {#if !isRemote}
      <!-- 어느 상태든 이 줄 안에서 — 둘째 줄과 오른쪽 단추만 바뀌고 줄 높이는 그대로다 -->
      <div class="srow connect-row" data-remote-connect data-state={row.state}>
        <span class="name">{t("settings.remote.connect.label")}</span>
        <div class="hint line2" class:warn={row.state === "other" || row.state === "admin" || row.state === "failed"} role="status">
          {#if row.state === "checking"}
            {t("settings.remote.connect.checking")}
          {:else if row.state === "ready"}
            {t("settings.remote.connect.ready")}
          {:else if row.state === "busy"}
            {t(row.step === "off" ? "settings.remote.connect.busyOff" : "settings.remote.connect.busy")}
          {:else if row.state === "connected"}
            <!-- serve 는 걸려 있어도 관문이 닫혔거나 Funnel 로 공개 중이면 초록이 아니다(상태 줄과 같은 판정) -->
            <StatusChip tone={stateView.tone === "bad" ? "bad" : "ok"} data-remote-connect-on>{t("settings.remote.connect.on")}</StatusChip>
          {:else if row.state === "other"}
            <span>{otherParts.before}<span class="mono">{row.target}</span>{otherParts.after}</span>
          {:else if row.state === "admin" || row.state === "failed"}
            {row.message}
          {:else}
            {t("settings.remote.connect.nocli")}
          {/if}
        </div>
        <div class="size-row">
          {#if row.state === "connected"}
            <button type="button" class="btn btn-sm btn-secondary" data-remote-serve-off onclick={() => void serveOffRemote(servePort)}>
              {t("settings.remote.connect.off")}
            </button>
          {:else if row.state === "other"}
            {@const target = row.target}
            <button type="button" class="btn btn-sm btn-secondary" data-remote-connect-cancel onclick={resetConnectFlow}>
              {t("settings.remote.connect.cancel")}
            </button>
            <button type="button" class="btn btn-sm btn-secondary danger" data-remote-connect-replace onclick={() => void connectRemoteServe(servePort, target)}>
              {t("settings.remote.connect.replace")}
            </button>
          {:else if row.state === "admin"}
            {#if row.url}
              {@const adminUrl = row.url}
              <button type="button" class="btn btn-sm btn-secondary" data-remote-connect-admin onclick={() => openExternal(adminUrl)}>
                {t("settings.remote.connect.admin")}
              </button>
            {/if}
            <button type="button" class="btn btn-sm btn-secondary" data-remote-connect-retry onclick={() => void connectRemoteServe(servePort)}>
              {t("settings.remote.connect.retry")}
            </button>
          {:else if row.state === "failed"}
            {@const retry = row.retry}
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              data-remote-connect-retry
              onclick={() => void (retry === "off" ? serveOffRemote(servePort) : connectRemoteServe(servePort))}
            >
              {t("settings.remote.connect.retry")}
            </button>
          {:else if row.state === "nocli"}
            <button type="button" class="btn btn-sm btn-secondary" data-remote-connect-install onclick={() => openExternal(TAILSCALE_DOWNLOAD_URL)}>
              {t("settings.remote.connect.install")}
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-sm btn-secondary"
              data-remote-connect-go
              disabled={row.state === "busy"}
              onclick={() => void connectRemoteServe(servePort)}
            >
              {t("settings.remote.connect.go")}
            </button>
          {/if}
        </div>
      </div>
    {/if}

    <div class="srow wide-field">
      <TipName id="remote-host" for="remote-host" label={t("settings.remote.host.label")} tip={t("settings.remote.host.note")} />
      <div class="size-row">
        <!-- 자리는 늘 잡아 둔다(상태가 바뀌어도 칸 폭·줄 높이가 그대로) · 문장은 툴팁과 읽기 이름으로만 -->
        <span
          class="host-state"
          data-host-note={note?.kind ?? ""}
          data-tone={noteIcon?.tone ?? ""}
          role="status"
          title={noteText || undefined}
          aria-label={noteText || undefined}
        >
          {#if noteIcon?.icon === "dot"}
            <span class="dot" aria-hidden="true"></span>
          {:else if noteIcon}
            <UiIcon name={noteIcon.icon} size={14} />
          {/if}
          <span class="sr">{noteText}</span>
        </span>
        <input
          id="remote-host"
          class="value mono"
          type="text"
          spellcheck="false"
          autocomplete="off"
          placeholder="mypc.tailXXXX.ts.net"
          value={prefs.host ?? ""}
          disabled={isRemote}
          title={isRemote ? t("settings.remote.homeOnly") : undefined}
          aria-invalid={hostInvalid}
          onchange={(e) => setRemoteHost(e.currentTarget.value)}
        />
        {#if !isRemote}
          <button type="button" class="btn btn-sm btn-secondary" disabled={detecting} onclick={() => void detect()}>
            {detecting ? t("settings.remote.host.detecting") : t("settings.remote.host.detect")}
          </button>
        {/if}
      </div>
      {#if hostInvalid || detectError}
        <p class="footnote warn" role="alert">{detectError ?? t("settings.remote.host.invalid")}</p>
      {/if}
    </div>

    <div class="srow">
      <TipName id="remote-port" for="remote-port" label={t("settings.remote.port.label")} tip={t("settings.remote.port.note")} />
      <input
        id="remote-port"
        class="value size"
        type="number"
        min="1"
        max="65535"
        value={prefs.port ?? ""}
        placeholder={status ? String(status.port) : ""}
        disabled={isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onchange={(e) => setRemotePort(e.currentTarget.valueAsNumber)}
      />
    </div>

    {#if status?.error}
      <p class="footnote warn" role="status">{status.error}</p>
    {/if}
  </div>
{/snippet}

{#snippet devicesTitle()}
  <span class="slist-name" id="remote-devices-label">{t("settings.remote.devices.subhead")}</span>
{/snippet}

{#snippet devicesSup()}
  {#if openDevices > 0}
    <StatusChip tone="ok" data-remote-open-count>{t("settings.remote.devices.open", { n: openDevices })}</StatusChip>
  {/if}
  <span>{remoteDevices().length > 0 ? t("settings.remote.devices.total", { n: remoteDevices().length }) : t("settings.remote.none")}</span>
{/snippet}

{#snippet devicesTrail()}
  {#if anyOpen}
    <button type="button" class="btn btn-sm btn-secondary danger" data-remote-disconnect-all disabled={busy} onclick={() => void act(disconnectAllRemote)}>
      {t("settings.remote.disconnectAll")}
    </button>
  {/if}
{/snippet}

{#snippet devicesBody()}
  {#if remoteDevices().length === 0}
    <div class="slist-body">
      <p class="hint">{t("settings.remote.devices.empty")}</p>
    </div>
  {:else}
    <ul class="devices slist-body" aria-labelledby="remote-devices-label">
      {#each remoteDevices() as d (d.id)}
        <li data-remote-device={d.id}>
          <span class="head">
            {#if editing === d.id}
              <input
                class="value rename"
                type="text"
                maxlength="80"
                aria-label={t("settings.remote.devices.rename.aria", { name: d.name })}
                bind:value={draft}
                onkeydown={(e) => {
                  if (e.key === "Enter") saveRename(d.id);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    editing = null;
                  }
                }}
              />
              <button type="button" class="btn btn-sm btn-secondary" disabled={busy || !draft.trim()} onclick={() => saveRename(d.id)}>
                {t("settings.remote.devices.rename.save")}
              </button>
              <button type="button" class="btn btn-sm btn-ghost" onclick={() => (editing = null)}>
                {t("settings.remote.devices.rename.cancel")}
              </button>
            {:else}
              <span class="dname" title={d.name}>{d.name}</span>
              {#if d.unlocked}<StatusChip tone="ok">{t("settings.remote.devices.unlocked")}</StatusChip>{/if}
              {#if d.connected > 0}<StatusChip tone="ok">{t("settings.remote.devices.connected", { n: d.connected })}</StatusChip>{/if}
              <button type="button" class="btn btn-sm btn-secondary" disabled={busy} onclick={() => startRename(d.id, d.name)}>
                {t("settings.remote.devices.rename")}
              </button>
              <button
                type="button"
                class="btn btn-sm btn-secondary danger"
                disabled={busy}
                aria-label={t("settings.remote.devices.revoke.aria", { name: d.name })}
                onclick={() => revoke(d.id)}
              >
                {confirmRevoke === d.id ? t("settings.remote.devices.revoke.confirm") : t("settings.remote.devices.revoke")}
              </button>
            {/if}
          </span>
          <span class="meta"
            >{t("settings.remote.devices.created", { when: whenOf(d.created) })} · {t("settings.remote.devices.lastSeen", {
              when: whenOf(d.lastSeen),
            })}</span
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if deviceError}
    <p class="footnote warn device-error" role="alert">{deviceError}</p>
  {/if}
{/snippet}

{#snippet logTitle()}
  <span class="slist-name">{t("settings.remote.log.subhead")}</span>
{/snippet}

{#snippet logSup()}
  {#if unlockFailures > 0}
    <StatusChip tone="bad" data-remote-log-failed>{t("settings.remote.log.failedChip", { n: unlockFailures })}</StatusChip>
  {/if}
  <span data-remote-log-last>{lastLogLine ?? t("settings.remote.none")}</span>
{/snippet}

{#snippet logBody()}
  <div class="slist-body">
    {#if recent.length === 0}
      <p class="hint">{t("settings.remote.log.empty")}</p>
    {:else}
      <ul class="log" data-remote-log>
        {#each recent as e, i (i + e.at + e.kind)}
          {@const key = logKindKey(e.kind)}
          {#if key}
            <li>
              <span class="when">{whenOf(e.at)}</span>
              <span class="what" class:bad={e.kind === "unlockFailed"}>{t(key)}{#if e.what}<span class="detail">{e.what}</span>{/if}</span>
              <span class="who">{e.deviceName || t("settings.remote.log.all")}</span>
            </li>
          {/if}
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

{#snippet guideTitle()}
  <span class="slist-name">{t("settings.remote.guide.title")}</span>
{/snippet}

{#snippet guideSup()}
  <span>{t("settings.remote.guide.sup")}</span>
{/snippet}

{#snippet guideBody()}
  <div class="guide">
    <h4 class="subhead first">{t("settings.remote.setup.subhead")}</h4>
    <p class="hint">{t("settings.remote.setup.open", { url })}</p>
    <p class="hint warn-line">{t("settings.remote.setup.funnel")}</p>

    <h4 class="subhead" id="remote-checklist">{t("settings.remote.check.subhead")}</h4>
    <ul class="checklist">
      <li>{t("settings.remote.check.idp")}</li>
      <li>{t("settings.remote.check.approval")}</li>
      <li>
        {t("settings.remote.check.acl")}
        <CommandBlock
          lines={aclExample({
            default: t("settings.remote.check.acl.comment.default"),
            self: t("settings.remote.check.acl.comment.self"),
            server: t("settings.remote.check.acl.comment.server"),
          })}
          label={t("settings.remote.check.acl.copy")}
        />
      </li>
      <li>{t("settings.remote.check.master")}</li>
      <li>{t("settings.remote.check.lost")}</li>
    </ul>

    <h4 class="subhead">{t("settings.remote.setup.manual")}</h4>
    <ol class="steps" data-remote-manual>
      <li>
        <p class="hint">{t("settings.remote.setup.serve")}</p>
        <CommandBlock lines={[serveCommand(port)]} label={t("settings.remote.setup.serve.copy")} />
        <p class="hint more">{t("settings.remote.setup.serve.more")} <code>{SERVE_OFF_COMMAND}</code> · <code>{SERVE_STATUS_COMMAND}</code></p>
      </li>
      <li>
        <p class="hint">{t("settings.remote.setup.name")}</p>
        <CommandBlock lines={[DNS_NAME_COMMAND]} label={t("settings.remote.setup.serve.copy")} />
      </li>
    </ol>
  </div>
{/snippet}

<p class="lead">{t("settings.remote.lead")}</p>

<div class="slist accordion remote-list">
  <StateRow id="remote-state" tone={stateView.tone} icon={stateView.icon} note={stateView.note ? t(stateView.note) : ""} data-remote-status={stateView.phase}>
    {#snippet title()}
      <span class="name">{t(stateView.title)}</span>
    {/snippet}
    {#snippet chips()}
      {#if stateView.chips.length > 0 || noMaster}
        <div class="vstate-chips">
          {#each stateView.chips as c (c.id)}
            <StatusChip tone={c.tone} data-chip={c.id} data-funnel={c.id === "funnel" ? (status?.funnel ?? "") : undefined} title={c.tipKey ? t(c.tipKey) : c.tip}>{t(c.label)}</StatusChip>
          {/each}
          {#if noMaster}
            <WarnChip
              label={t("settings.remote.noMaster.chip")}
              detail={t("settings.remote.noMaster")}
              onclick={() => (settingsNav.want = "credentials")}
              data-remote-no-master
            />
          {/if}
        </div>
      {/if}
    {/snippet}
  </StateRow>
  {@render card("access", accessTitle, accessSup, accessTrail, accessBody)}
  {@render card("devices", devicesTitle, devicesSup, devicesTrail, devicesBody)}
  {@render card("log", logTitle, logSup, null, logBody)}
  {@render card("guide", guideTitle, guideSup, null, guideBody)}
</div>

<style>
  .mono {
    font-family: var(--font-mono);
  }

  .warn {
    color: var(--warn);
  }

  .remote-list .remote-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    row-gap: 2px;
    padding-left: 14px;
  }

  .remote-head .slist-open {
    grid-column: 1;
    grid-row: 1;
  }

  .remote-head .slist-trail {
    grid-column: 2;
    grid-row: 1 / span 2;
    margin-left: 0;
  }

  /* 칩 줄 — 덮개 위에 서되 빈 자리 · 글자는 덮개로 흘려 머리를 누른 것과 같고, 칩 · 복사 단추만 받아서(말풍선 · 경고 칩 단추) 여닫지 않는다 */
  .remote-head .head-sup {
    grid-column: 1;
    grid-row: 2;
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    min-height: 20px;
    overflow: visible;
    overflow-wrap: anywhere;
    white-space: normal;
    color: var(--fg-2);
    pointer-events: none;
  }

  .head-sup :global(.status-chip),
  .head-sup :global(.warn-chip),
  .head-sup .mini {
    pointer-events: auto;
  }

  .head-sup .mini {
    height: 22px;
  }

  .remote-list > :global(.vstate) {
    align-items: center;
    padding: var(--space-3) 14px;
  }

  /* 첫 카드는 펼쳐도 상태 줄에서 떨어지지 않는다(사용자 결정 — 보안 화면처럼 잇는다) */
  :global(.settings-view) .remote-list.accordion > .slist-item.open:nth-child(2) {
    margin-top: 0;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
  }

  .remote-list :global(.vstate-chips .warn-chip) {
    box-sizing: border-box;
    height: 20px;
    padding-block: 0;
  }

  .remote-list .slist-panel {
    padding: 0 8px 8px;
  }

  /* 폭은 창이 아니라 목록 칸으로 잰다 — 폰에서는 설정 왼쪽 메뉴가 그대로라 창 폭 400 에 이 칸은 160 안팎이다 */
  .remote-list {
    container-type: inline-size;
  }

  @container (max-width: 380px) {
    .remote-head .head-sup {
      grid-column: 1 / -1;
    }

    .remote-head .slist-trail {
      grid-row: 1;
    }

    .remote-head .slist-name {
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .remote-list > :global(.vstate) :global(.vstate-tile) {
      display: none;
    }

    .remote-list > :global(.vstate) {
      overflow-wrap: anywhere;
    }

    .remote-list :global(.status-chip),
    .remote-list :global(.vstate-chips .warn-chip) {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
      height: auto;
      min-height: 20px;
      white-space: normal;
    }

    .remote-list .srow {
      display: flex;
      flex-wrap: wrap;
    }

    .remote-list .srow > * {
      max-width: 100%;
      min-width: 0;
    }

    .remote-list .srow > .name,
    .remote-list .srow > .hint {
      flex: 1 1 100%;
    }

    .remote-list .srow .size-row {
      flex-wrap: wrap;
      margin-left: auto;
    }

    .remote-list .srow > .value {
      flex: 1 1 100%;
      width: auto;
    }

    .log li {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }

  /* Tailscale 연결 — 둘째 줄이 모든 상태를 맡는다. 높이를 잡아 두어(복사 단추 22px) 상태가 바뀌어도 줄 높이가 그대로다 */
  .connect-row .line2 {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--space-2);
    min-height: 22px;
    overflow-wrap: anywhere;
  }

  .connect-row .line2.warn {
    color: var(--warn);
  }


  /* 칸은 늘 14px 를 잡아 상태가 바뀌어도 입력 칸 폭이 흔들리지 않는다 */
  .host-state {
    position: relative;
    flex: 0 0 14px;
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    cursor: default;
  }

  .host-state[data-tone="ok"] {
    color: var(--ok);
  }

  .host-state[data-tone="accent"] {
    color: var(--accent);
  }

  .host-state[data-tone="warn"] {
    color: var(--warn);
  }

  .host-state .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  /* 읽기 전용 글자 — live region 이 내용으로 읽히게(눈에는 안 보임) */
  .host-state .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .guide {
    min-width: 0;
    padding: 2px 6px 6px;
    overflow-wrap: anywhere;
  }

  .guide .subhead {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--t-sm);
  }

  .guide .subhead.first {
    margin-top: 0;
  }

  .steps,
  .checklist {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .steps .hint {
    margin: 0 0 var(--space-1);
  }

  .steps .hint.more {
    margin-top: var(--space-1);
  }

  .steps code {
    overflow-wrap: anywhere;
  }

  .checklist li {
    position: relative;
    min-width: 0;
    padding-left: var(--space-4);
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-2);
    word-break: keep-all;
  }

  .checklist li::before {
    content: "";
    position: absolute;
    left: 4px;
    top: 0.6em;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .checklist li :global(.command-block) {
    margin-top: var(--space-1);
  }

  .warn-line {
    margin: var(--space-2) 0 0;
    color: var(--warn);
  }

  .devices,
  .log {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .devices li {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .log li + li {
    border-top: 1px solid var(--line);
  }

  .devices .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .devices .dname {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-sm);
    color: var(--fg-1);
  }

  .devices .rename {
    flex: 1 1 auto;
    min-width: 6em;
  }

  .size-row .value + .btn,
  .devices .rename ~ .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }

  .devices .meta {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .device-error {
    margin: var(--space-2) 6px 0;
  }

  .log li {
    display: grid;
    grid-template-columns: 6em minmax(0, 1fr) minmax(0, 10em);
    gap: var(--space-2);
    padding: var(--space-1) 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .log .what {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--fg-1);
  }

  .log .what.bad {
    color: var(--err);
  }

  .log .detail {
    margin-left: 0.5em;
    color: var(--fg-2);
  }

  .log .who {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
