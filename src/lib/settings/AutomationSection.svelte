<script lang="ts">
  import { tick } from "svelte";
  import {
    settings,
    setAutoApprove,
    setAutoMaxTargets,
    setAutoMaxConcurrency,
    setApprovalTtlMinutes,
    AUTO_MAX_TARGETS_MIN,
    AUTO_MAX_TARGETS_MAX,
    AUTO_MAX_CONCURRENCY_MIN,
    AUTO_MAX_CONCURRENCY_MAX,
    APPROVAL_TTL_MINUTES_MIN,
    APPROVAL_TTL_MINUTES_MAX,
    setAuditRetentionDays,
    setAuditOutputExcerpt,
    setAllowPipes,
    AUDIT_RETENTION_DAYS_MIN,
    AUDIT_RETENTION_DAYS_MAX,
  } from "$lib/settings.svelte.js";
  import { BUNDLES, expandBundles } from "$lib/automation-presets";
  import Toggle from "$lib/Toggle.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import WarnChip from "$lib/settings/WarnChip.svelte";
  import AutomationBundles from "$lib/settings/AutomationBundles.svelte";
  import AutomationAllow from "$lib/settings/AutomationAllow.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";

  /**
   * 자동 승인 섹션 — 정책을 편집만 한다. 판정은 `policy.ts` · 권위는 Rust(`policy.rs`), 실행은 기존 승인 경로(`approve_operation`), 상한 강제는 백엔드다.
   * 위험 명령은 이 화면의 어떤 설정으로도 자동 승인되지 않는다 — 위험(`classifyRisk`) 배제는 allowlist 위에서 항상 조인다.
   * 체이닝(`&&` `||` `;`)은 구획마다 판정한다(docs/log/2026-09-16-auto-approval-chaining.md).
   */

  let { active = true }: { active?: boolean } = $props();

  const patterns = $derived(settings.current.automation.allow_patterns);
  const userRules = $derived(settings.current.automation.allow);
  const autoApprove = $derived(settings.current.automation.auto_approve);
  const enabledBundles = $derived(settings.current.automation.bundles);
  /** 원격 창은 볼 수만 있다 — 관문이 `save_settings` 의 `[automation]` 변경을 거절한다(`remote/deny.rs`) */
  const lockTip = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);
  const onCount = $derived(BUNDLES.filter((b) => enabledBundles.includes(b.id)).length);
  const ruleCount = $derived(expandBundles(enabledBundles, settings.current.automation.bundle_off).length);

  // ── 요약 ↔ 하위 화면 ──
  let view = $state<"summary" | "bundles" | "allow">("summary");
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let adjustBtn = $state<HTMLButtonElement | null>(null);
  let editBtn = $state<HTMLButtonElement | null>(null);

  function panel(): HTMLElement | null {
    return rootEl?.closest<HTMLElement>(".settings-panel") ?? null;
  }

  function openSub(v: "bundles" | "allow"): void {
    dir = "fwd";
    view = v;
    const p = panel();
    if (p) p.scrollTop = 0;
  }

  async function closeSub(returnFocus = true): Promise<void> {
    if (view === "summary") return;
    const from = view;
    dir = returnFocus ? "back" : null;
    view = "summary";
    if (!returnFocus) return;
    await tick();
    const btn = from === "bundles" ? adjustBtn : editBtn;
    btn?.scrollIntoView({ block: "nearest" });
    btn?.focus({ preventScroll: true });
  }

  // 요약에서는 Escape 를 모달 몫으로 넘긴다
  const onescape = $derived(view === "summary" ? null : () => void closeSub(true));

  $effect(() => {
    if (!active) void closeSub(false);
  });
</script>

<!-- 자동 승인 줄 밑의 위험 배제 안내는 늘 보인다(자동 승인을 꺼 둬도 — 사용자 결정) -->
<SubViewStack {view} {dir} {onescape} bind:root={rootEl}>
{#if view === "bundles"}
  <AutomationBundles onback={() => void closeSub(true)} />
{:else if view === "allow"}
  <AutomationAllow onback={() => void closeSub(true)} />
{:else}
<p class="lead">
  <InfoNote id="auto-approve-info" label={t("settings.automation.approve.label")} plain>
    {#snippet summary()}{t("settings.automation.approve.summary")}{/snippet}
    {#snippet note()}{t("settings.automation.approve.note")}{/snippet}
  </InfoNote>
</p>
{#if isRemote}
  <p class="footnote warn-line" role="note">
    <UiIcon name="warning" size={13} />
    <span>{t("settings.remote.automationHomeOnly")}</span>
  </p>
{/if}
<p class="footnote warn-line" role="note">
  <UiIcon name="warning" size={13} />
  <span>
    {t("settings.automation.warn.before")}<strong>{t("settings.automation.warn.term")}</strong>{t(
      "settings.automation.warn.middle",
    )}<code>&amp;&amp;</code>{t("settings.automation.warn.middle2")}<strong
      >{t("settings.automation.warn.term.each")}</strong
    >{t("settings.automation.warn.after")}
  </span>
</p>

<div class="rows term">
  <div class="srow">
    <TipName
      id="auto-approve"
      for="auto-approve"
      label={t("settings.automation.approve.enabled")}
      tip={t("settings.automation.approve.summary")}
    />
    <div class="size-row">
      <Toggle id="auto-approve" checked={autoApprove} disabled={isRemote} title={lockTip} onchange={setAutoApprove} />
    </div>
  </div>
  <!-- 파이프 허용(기본 끔) — 다른 명령을 실행하는 단계(xargs · 셸 · sudo · tee …)는 늘 사람 승인이고, 리디렉트 · 치환 · 서브셸이 섞여도 그렇다 -->
  <div class="srow" class:dim={!autoApprove}>
    <TipName
      id="auto-allow-pipes"
      for="auto-allow-pipes"
      label={t("settings.automation.pipes.label")}
      tip={t("settings.automation.pipes.note")}
    />
    <div class="size-row">
      <Toggle
        id="auto-allow-pipes"
        checked={settings.current.automation.allow_pipes}
        disabled={isRemote}
        title={lockTip}
        onchange={setAllowPipes}
      />
    </div>
  </div>
</div>

<div class="rows term">
  <div class="srow" class:dim={!autoApprove}>
    <TipName
      id="auto-bundles-row"
      for="auto-bundles"
      label={t("settings.automation.bundles.label")}
      tip={t("settings.automation.bundles.tip")}
    />
    <div class="size-row bundle-summary">
      <span class="hint">{t("settings.automation.bundles.summary", { total: BUNDLES.length, on: onCount, rules: ruleCount })}</span>
      <button
        type="button"
        id="auto-bundles"
        class="btn btn-sm btn-secondary adjust"
        bind:this={adjustBtn}
        onclick={() => openSub("bundles")}
      >
        {t("settings.automation.bundles.adjust")}
        <UiIcon name="chevron" size={12} />
      </button>
    </div>
  </div>

  <div class="srow" class:dim={!autoApprove}>
    <TipName
      id="auto-allow-row"
      for="auto-allow"
      label={t("settings.automation.allow.label")}
      tip={t("settings.automation.allow.tip")}
    />
    <div class="size-row bundle-summary">
      <span class="hint">{t("settings.automation.allow.summary", { rules: userRules.length, patterns: patterns.length })}</span>
      <button
        type="button"
        id="auto-allow"
        class="btn btn-sm btn-secondary adjust"
        bind:this={editBtn}
        onclick={() => openSub("allow")}
      >
        {t("settings.automation.allow.edit")}
        <UiIcon name="chevron" size={12} />
      </button>
    </div>
    {#if patterns.length === 0 && userRules.length === 0}
      <p class="footnote allow-empty">
        {#if enabledBundles.length > 0}
          {t("settings.automation.allow.empty.bundles.before")}<strong
            >{t("settings.automation.bundle.term")}</strong
          >{t("settings.automation.allow.empty.bundles.after")}
        {:else}
          {t("settings.automation.allow.empty.none")}
        {/if}
      </p>
    {/if}
  </div>
</div>

<div class="rows term">
  <div class="srow">
    <TipName
      id="auto-max-targets"
      for="auto-max-targets"
      label={t("settings.automation.targets.label")}
      tip={t("settings.automation.targets.summary")}
    />
    <div class="size-row">
      <input
        id="auto-max-targets"
        class="value size"
        type="number"
        min={AUTO_MAX_TARGETS_MIN}
        max={AUTO_MAX_TARGETS_MAX}
        value={settings.current.automation.max_targets}
        disabled={isRemote}
        title={lockTip}
        oninput={(e) => setAutoMaxTargets(e.currentTarget.valueAsNumber)}
      />
      <span class="hint"
        >{t("settings.automation.targets.hint", {
          min: AUTO_MAX_TARGETS_MIN,
          max: AUTO_MAX_TARGETS_MAX,
        })}</span
      >
    </div>
  </div>

  <div class="srow">
    <TipName
      id="auto-max-concurrency"
      for="auto-max-concurrency"
      label={t("settings.automation.concurrency.label")}
      tip={tipOf(t("settings.automation.concurrency.summary"), t("settings.automation.concurrency.note"))}
    />
    <div class="size-row">
      <input
        id="auto-max-concurrency"
        class="value size"
        type="number"
        min={AUTO_MAX_CONCURRENCY_MIN}
        max={AUTO_MAX_CONCURRENCY_MAX}
        value={settings.current.automation.max_concurrency}
        disabled={isRemote}
        title={lockTip}
        oninput={(e) => setAutoMaxConcurrency(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{AUTO_MAX_CONCURRENCY_MIN}–{AUTO_MAX_CONCURRENCY_MAX}</span>
    </div>
  </div>

  <div class="srow">
    <!-- 검토 대기 만료는 자동 승인 토글과 무관하게 먹는다 · `0` 은 "만료 없음" 이라 하한으로 접지 않는다 -->
    <TipName
      id="approval-ttl"
      for="approval-ttl"
      label={t("settings.automation.ttl.label")}
      tip={t("settings.automation.ttl.note")}
    />
    <div class="size-row">
      <input
        id="approval-ttl"
        class="value size"
        type="number"
        min={APPROVAL_TTL_MINUTES_MIN}
        max={APPROVAL_TTL_MINUTES_MAX}
        value={settings.current.automation.approval_ttl_minutes}
        disabled={isRemote}
        title={lockTip}
        oninput={(e) => setApprovalTtlMinutes(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{t("settings.automation.ttl.hint", { max: APPROVAL_TTL_MINUTES_MAX })}</span>
    </div>
  </div>
</div>

<!-- 감사 로그는 끄는 칸이 없다(모든 실행을 기록 — 불변). 출력 발췌는 볼트 밖에 비밀이 남을 수 있어 기본 끔이다 -->
<h4 class="subhead">{t("settings.automation.audit.subhead")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName
      id="audit-retention"
      for="audit-retention"
      label={t("settings.automation.retention.label")}
      tip={t("settings.automation.retention.note")}
    />
    <div class="size-row">
      <input
        id="audit-retention"
        class="value size"
        type="number"
        min={AUDIT_RETENTION_DAYS_MIN}
        max={AUDIT_RETENTION_DAYS_MAX}
        value={settings.current.automation.audit_retention_days}
        disabled={isRemote}
        title={lockTip}
        oninput={(e) => setAuditRetentionDays(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{t("settings.automation.retention.hint", { max: AUDIT_RETENTION_DAYS_MAX })}</span>
    </div>
  </div>

  <div class="srow">
    <TipName
      id="audit-output-excerpt"
      for="audit-output-excerpt"
      label={t("settings.automation.excerpt.label")}
      tip={tipOf(t("settings.automation.excerpt.summary"), t("settings.automation.excerpt.note"))}
    />
    <div class="size-row">
      {#if settings.current.automation.audit_output_excerpt}
        <WarnChip label={t("settings.automation.excerpt.chip")} detail={t("settings.automation.excerpt.warn")} />
      {/if}
      <Toggle
        id="audit-output-excerpt"
        checked={settings.current.automation.audit_output_excerpt}
        disabled={isRemote}
        title={lockTip}
        onchange={setAuditOutputExcerpt}
      />
    </div>
  </div>
</div>
{/if}
</SubViewStack>

<style>
  .bundle-summary {
    gap: var(--space-2);
  }

  .adjust {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .srow.dim {
    opacity: 0.6;
  }

  .footnote.allow-empty {
    margin-top: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .footnote.warn-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin-top: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .footnote.warn-line :global(svg) {
    flex: 0 0 auto;
    color: var(--warn);
    transform: translateY(2px);
  }

  .footnote.warn-line strong {
    color: var(--fg-1);
  }
</style>
