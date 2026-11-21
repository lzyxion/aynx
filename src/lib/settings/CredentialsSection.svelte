<script lang="ts">
  import { tick } from "svelte";
  import { settings, setIdleLockMin } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import UiIcon from "$lib/UiIcon.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import StateRow from "$lib/settings/StateRow.svelte";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import ValueSlider from "$lib/settings/ValueSlider.svelte";
  import { comboText } from "$lib/settings/combo";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import VaultItemsView from "$lib/settings/VaultItemsView.svelte";
  import DelegationHostsView from "$lib/settings/DelegationHostsView.svelte";
  import DbAiTargetsView from "$lib/settings/DbAiTargetsView.svelte";
  import "$lib/settings/credentials.css";
  import {
    cancelDeleteAll,
    openMasterPrompt,
    refreshVault,
    unlockVault,
    vaultBusy,
    vaultItems,
    vaultStatus,
    verifyMasterPrompt,
  } from "$lib/app/vault.svelte.js";
  import { delegationTargetViews, refreshDelegationTargets } from "$lib/app/delegation.svelte.js";
  import { reloadDbConns } from "$lib/app/db-conns.svelte.js";
  import { dbAiViews, refreshDbAi } from "$lib/app/db-ai.svelte.js";
  import {
    dbAiNeedsCleanup,
    isOrphanHost,
    vaultStateView,
    vaultKindCounts,
    DELEGATION_ORPHANS_ANCHOR,
    VAULT_KIND_LABEL,
  } from "$lib/settings/credentials-view";

  /**
   * 보안 섹션 — 볼트 · 마스터 암호 · 저장된 항목 · AI 권한 표 둘(화면 이름만 보안 — 섹션 id · 키 · 파일 이름은 `credentials`).
   * 들어가기 관문(사용자 결정): 섹션이 보이게 될 때마다 잠금 해제 · 마스터 확인(`vault_verify_master` — 상태를 바꾸지 않는다)을 거친다.
   * 통과는 화면 상태뿐이고 섹션이 안 보이게 되거나 볼트가 잠기면 다시 관문이다 — 자리를 비운 사이를 위한 확인이지 같은 계정의 프로세스를 막는 경계가 아니다.
   * 이 섹션의 손잡이는 [저장]·[취소] 바깥이다 — 마스터 걸기 · 항목 지우기는 누르는 즉시 디스크를 바꾼다(무입력 자동 잠금 한 칸만 미리보기 계약).
   * 잠금 = 가림막 하나 — 가림막을 걷는 것이 곧 볼트를 여는 것이다(→ docs/invariants.md 전문 2). 볼트만 잠그는 단추는 두지 않는다.
   */

  /** 다른 섹션을 보는 동안 디스크를 묻지 않는다 */
  let { active = false }: { active?: boolean } = $props();

  // ── 요약 ↔ 하위 화면 ──
  type Sub = "items" | "hosts" | "db";
  let view = $state<"summary" | Sub>("summary");
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  const btns = $state<Record<Sub, HTMLButtonElement | null>>({ items: null, hosts: null, db: null });
  let hostsFilter = $state<"all" | "cleanup">("all");

  // ── 들어가기 관문(저장하지 않는다) ──
  let passed = $state(false);
  /** 두 번 눌러 모달 둘을 세우지 않게 */
  let gateBusy = $state(false);
  let pendingAnchor: string | null = null;

  const GATE_NOTE = {
    locked: "settings.credentials.gate.locked",
    master: "settings.credentials.gate.master",
    nomaster: "settings.credentials.gate.nomaster",
    absent: "settings.credentials.gate.absent",
  } as const;

  const gateKind = $derived.by((): "locked" | "master" | "nomaster" | "absent" => {
    const s = vaultStatus();
    if (s.state === "locked") return "locked";
    if (s.state === "absent") return "absent";
    return s.hasMaster ? "master" : "nomaster";
  });

  /** 볼트를 새로 읽고 그때의 상태로 묻는다 — 그 사이 섹션이 안 보이게 됐으면 통과시키지 않는다 */
  async function pass(): Promise<void> {
    if (gateBusy) return;
    gateBusy = true;
    try {
      await refreshVault();
      const s = vaultStatus();
      let ok: boolean;
      if (s.state === "locked") {
        await unlockVault();
        ok = vaultStatus().state === "unlocked";
      } else if (s.state === "unlocked" && s.hasMaster) {
        ok = await verifyMasterPrompt();
      } else {
        ok = true;
      }
      if (!ok || !active) return;
      passed = true;
      await tick();
      revealAfterPass();
    } finally {
      gateBusy = false;
    }
  }

  /** 미뤄 둔 딥링크가 없으면 상태 줄 이름에 포커스 — 관문 단추가 사라져 포커스가 길을 잃지 않게 */
  function revealAfterPass(): void {
    const anchor = pendingAnchor;
    pendingAnchor = null;
    const p = panel();
    if (!p) return;
    const el = p.querySelector<HTMLElement>(`#${CSS.escape(anchor ?? "vault-state-label")}`);
    if (!el) return;
    if (anchor) el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }

  function panel(): HTMLElement | null {
    return rootEl?.closest<HTMLElement>(".settings-panel") ?? null;
  }

  function openSub(v: Sub): void {
    if (v === "hosts") hostsFilter = "all";
    dir = "fwd";
    view = v;
    const p = panel();
    if (p) p.scrollTop = 0;
  }

  async function closeSub(returnFocus = true): Promise<void> {
    if (view === "summary") return;
    const from = view;
    // [모두 삭제] 의 확인은 저장된 항목 화면의 것이다 — 떠나면 거둔다(줄 [제거] 의 확인은 하위 화면과 함께 사라진다)
    cancelDeleteAll();
    dir = returnFocus ? "back" : null;
    view = "summary";
    if (!returnFocus) return;
    await tick();
    const btn = btns[from];
    btn?.scrollIntoView({ block: "nearest" });
    btn?.focus({ preventScroll: true });
  }

  /** `SettingsModal.revealPendingAnchor` 가 스크롤 전에 부른다 */
  export function expandForAnchor(anchor: string): void {
    // 관문 앞이면 자리만 기억한다 — 통과한 뒤 그 줄로 간다
    if (!passed) pendingAnchor = anchor;
    if (anchor === DELEGATION_ORPHANS_ANCHOR) {
      hostsFilter = "cleanup";
      dir = null;
      view = "hosts";
      return;
    }
    void closeSub(false);
  }

  // 요약에서는 Escape 를 모달 몫으로 넘긴다
  const onescape = $derived(!passed || view === "summary" ? null : () => void closeSub(true));

  $effect(() => {
    if (passed && vaultStatus().state === "locked") {
      passed = false;
      void closeSub(false);
    }
  });

  /** 볼 때마다 다시 읽는다 — 그 사이 접속 모달에서 값을 담거나 호스트 폼에서 위임을 바꿨을 수 있다 */
  $effect(() => {
    if (!active) {
      cancelDeleteAll();
      void closeSub(false);
      passed = false;
      return;
    }
    void refreshVault();
    void reloadDbConns();
    void refreshDelegationTargets();
    void refreshDbAi();
  });

  /** 머리말은 관문 뒤에만 그려지니 줄은 늘 있다 */
  function goIdleLock(): void {
    const el = panel()?.querySelector<HTMLElement>("#lock-idle");
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }

  /** 분 · `0` 은 끄기. 간격이 고르지 않아 슬라이더는 인덱스를 움직인다(`ValueSlider` 의 `steps`) */
  const IDLE_MINUTES: number[] = [0, 1, 3, 5, 10, 15, 30];

  function idleLabel(min: number): string {
    return min === 0 ? t("settings.general.idle.off") : t("settings.general.idle.minutes", { min });
  }

  /** 자동 잠금이 꺼져 있으면 칩이 그 사실을 말한다 — "잠깁니다" 만 적으면 오지 않는 잠금을 약속하는 줄이 된다 */
  const stateView = $derived(vaultStateView(vaultStatus(), settings.idleLockMin));

  // ── 요약 줄의 숫자 ──
  const kindCounts = $derived(vaultKindCounts(vaultItems()));
  const hostCount = $derived(delegationTargetViews().length);
  const hostCleanup = $derived(delegationTargetViews().filter(isOrphanHost).length);
  const dbCount = $derived(dbAiViews().length);
  const dbCleanup = $derived(dbAiViews().filter(dbAiNeedsCleanup).length);
</script>

<!-- 잠그는 시점 줄과 상태 · 위협 모델은 늘 보인다(사용자 결정) — 감추면 잘못된 안심을 산다. 문구에 HTML 을 넣지 않는다 -->
{#if !passed}
  <!-- 통과 전엔 상태 · 마스터 · 목록 줄을 그리지 않는다 — 색인 anchor 도 없으니 딥링크는 미뤄진다(`expandForAnchor`) -->
  <div class="gate" bind:this={rootEl} data-cred-gate={gateKind}>
    <div class="gate-card" role="group" aria-labelledby="cred-gate-title" aria-describedby="cred-gate-note">
      <span class="gate-icon" aria-hidden="true"><UiIcon name="lock" size={22} /></span>
      <h4 class="gate-title" id="cred-gate-title">{t("settings.credentials.gate.title")}</h4>
      <p class="gate-note" id="cred-gate-note">{t(GATE_NOTE[gateKind])}</p>
      <button type="button" class="btn btn-primary" disabled={gateBusy || vaultBusy()} onclick={() => void pass()}>
        {gateKind === "locked" || gateKind === "master"
          ? t("settings.credentials.gate.unlock")
          : t("settings.credentials.gate.open")}
      </button>
    </div>
  </div>
{:else}
<SubViewStack {view} {dir} {onescape} bind:root={rootEl}>
{#if view === "items"}
  <VaultItemsView onback={() => void closeSub(true)} />
{:else if view === "hosts"}
  <DelegationHostsView bind:filter={hostsFilter} onback={() => void closeSub(true)} />
{:else if view === "db"}
  <DbAiTargetsView onback={() => void closeSub(true)} />
{:else}
<p class="lead">
  {t("settings.credentials.lead.veil.before", { combo: comboText("toggle-veil", settings.keybindings) })}<button type="button" class="link" onclick={goIdleLock}
    >{t("settings.credentials.lead.veil.link")}</button
  >{t("settings.credentials.lead.veil.after")}
</p>

<!-- 줄 판의 틴트는 `::before` 가 깐다 — 묶음 카드 규칙이 `background` 를 쥐고 있어서. `vault-state` 는 색인 anchor 다 -->
<StateRow id="vault-state" tone={stateView.tone} icon={stateView.icon} note={t(stateView.note)} bodyClass="vault-state-note">
  {#snippet title()}
    <TipName
      id="vault-state"
      label={t(stateView.title)}
      tip={tipOf(t("settings.credentials.lead"), t("settings.credentials.state.note"))}
    />
  {/snippet}
  {#snippet chips()}
    {#if stateView.chips.length > 0}
      <ul class="vstate-chips">
        {#each stateView.chips as c (c.id)}
          <li class="vchip" data-look={c.look} data-chip={c.id} title={c.title ? t(c.title) : undefined}>
            <UiIcon name={c.icon} size={13} />
            <span>{t(c.label, c.params)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}
</StateRow>

<div class="srow">
  <TipName
    id="vault-master"
    for="vault-master"
    label={t("settings.credentials.master.label")}
    tip={t("settings.credentials.master.note")}
  />
  <span class="vault-actions">
    {#if vaultStatus().hasMaster}
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => openMasterPrompt("change")}
      >
        {t("settings.credentials.master.change")}
      </button>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => openMasterPrompt("remove")}
      >
        {t("settings.credentials.master.remove")}
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        disabled={vaultBusy() || isRemote}
        title={isRemote ? t("settings.remote.homeOnly") : undefined}
        onclick={() => openMasterPrompt("set")}
      >
        {t("settings.credentials.master.set")}
      </button>
    {/if}
  </span>
</div>

<!-- 저장된 항목 — 값은 여기 오지 않는다: 요약은 종류별 개수뿐이고 잠겼으면 "잠김" 한 마디다 -->
<div class="srow">
  <TipName
    id="vault-items-row"
    for="vault-items"
    label={t("settings.credentials.items.label")}
    tip={t("settings.credentials.items.note")}
  />
  <div class="size-row cred-summary">
    {#if vaultStatus().state === "locked"}
      <span class="sum-chip"><UiIcon name="lock" size={13} />{t("settings.credentials.state.locked")}</span>
    {:else if kindCounts.length === 0}
      <span class="hint">{t("settings.credentials.items.empty")}</span>
    {:else}
      <span class="sum-chips">
        {#each kindCounts as c (c.kind)}
          <span class="sum-chip">{t(VAULT_KIND_LABEL[c.kind])} {c.n}</span>
        {/each}
      </span>
    {/if}
    <button
      type="button"
      id="vault-items"
      class="btn btn-sm btn-secondary adjust"
      bind:this={btns.items}
      onclick={() => openSub("items")}
    >
      {t("settings.credentials.manage")}
      <UiIcon name="chevron" size={12} />
    </button>
  </div>
</div>

<!-- AI 권한 호스트 — 여기서는 보고 지우기만 한다. 켜고 끄는 자리는 호스트 폼의 AI 칸이다 -->
<div class="srow">
  <TipName
    id="delegation-targets-row"
    for="delegation-targets"
    label={t("settings.credentials.delegation.label")}
    tip={t("settings.credentials.delegation.note")}
  />
  <div class="size-row cred-summary">
    <span class="sum-chips">
      <span class="hint">{t("settings.credentials.count", { n: hostCount })}</span>
      {#if hostCleanup > 0}
        <span class="sum-chip warn">{t("settings.credentials.cleanup.count", { n: hostCleanup })}</span>
      {/if}
    </span>
    <button
      type="button"
      id="delegation-targets"
      class="btn btn-sm btn-secondary adjust"
      bind:this={btns.hosts}
      onclick={() => openSub("hosts")}
    >
      {t("settings.credentials.manage")}
      <UiIcon name="chevron" size={12} />
    </button>
  </div>
</div>

<div class="srow">
  <TipName
    id="db-ai-targets-row"
    for="db-ai-targets"
    label={t("settings.credentials.dbai.label")}
    tip={t("settings.credentials.dbai.note")}
  />
  <div class="size-row cred-summary">
    <span class="sum-chips">
      <span class="hint">{t("settings.credentials.count", { n: dbCount })}</span>
      {#if dbCleanup > 0}
        <span class="sum-chip warn">{t("settings.credentials.cleanup.count", { n: dbCleanup })}</span>
      {/if}
    </span>
    <button
      type="button"
      id="db-ai-targets"
      class="btn btn-sm btn-secondary adjust"
      bind:this={btns.db}
      onclick={() => openSub("db")}
    >
      {t("settings.credentials.manage")}
      <UiIcon name="chevron" size={12} />
    </button>
  </div>
</div>

<!-- 무입력 자동 잠금 — 가림막이 곧 볼트 잠금이다. 값은 미리보기 계약을 탄다(이 섹션의 다른 손잡이와 다르다). 줄 id `lock-idle` 은 색인 anchor -->
<SettingRow
  id="lock-idle"
  label={t("settings.general.idle.label")}
  tip={tipOf(
    t("settings.general.idle.summary") + t("settings.general.idle.summary.term"),
    t("settings.general.idle.note") + comboText("toggle-veil", settings.keybindings),
  )}
>
  {#snippet control()}
    <ValueSlider
      id="lock-idle"
      steps={IDLE_MINUTES}
      value={settings.idleLockMin}
      format={idleLabel}
      onchange={setIdleLockMin}
    />
  {/snippet}
</SettingRow>
{/if}
</SubViewStack>
{/if}

<style>
  /* 강조색은 [저장] 의 몫이다 — 이 링크는 본문 글자 + 밑줄 */
  .link {
    padding: 0;
    font: inherit;
    color: var(--fg-1);
    background: transparent;
    border: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .link:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-radius: 3px;
  }

  .vault-actions {
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-2);
  }

  .cred-summary {
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .sum-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }

  /* 요약 안의 `.hint` 는 줄 밑 안내가 아니라 글자 하나다 — 위 여백을 걷는다 */
  .sum-chips .hint,
  .cred-summary > .hint {
    margin-top: 0;
  }

  .sum-chip {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 8px;
    font-size: var(--t-xs);
    line-height: 1;
    white-space: nowrap;
    border-radius: 999px;
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .sum-chip.warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }

  .vchip {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 8px;
    font-size: var(--t-xs);
    line-height: 1;
    white-space: nowrap;
    border-radius: 999px;
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .vchip[data-look="accent"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .vchip[data-look="warn"] {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }

  /* ── 들어가기 관문 ── */
  .gate {
    display: flex;
    justify-content: center;
    padding: var(--space-5) 0;
  }

  .gate-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: 360px;
    padding: var(--space-5) var(--space-4);
    text-align: center;
    background: var(--glass-card, var(--m3-surface-container));
    border-radius: var(--radius-surface-inner);
  }

  .gate-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: calc(var(--radius-surface-inner) - 2px);
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .gate-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-md);
    font-weight: 600;
    color: var(--fg-1);
  }

  .gate-note {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
    word-break: keep-all;
  }

  .adjust {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
</style>
