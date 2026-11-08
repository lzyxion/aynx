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
   * **자동 승인** 섹션 — 로드맵 **단계 10b** (docs/log/2026-09-10-auto-approval.md).
   *
   * 로드맵에서 **처음으로 수동 클릭 없이 실행이 일어날 수 있는** 기능이라 경계가 결정적이다.
   * 이 화면은 정책을 **편집**만 한다 — 판정은 순수 평가기(`policy.ts`)와 권위인 Rust(`policy.rs`),
   * 실행은 기존 승인 경로(Tauri `approve_operation`), 상한 강제는 백엔드다.
   *
   * **위험 명령은 이 화면의 어떤 설정으로도 자동 승인되지 않는다** — 위험(`classifyRisk`) 배제는
   * 정책 평가기가 allowlist 위에서 항상 조인다. 체이닝(`&&` `||` `;`)은 **구획마다** 판정한다
   * (docs/log/2026-09-16-auto-approval-chaining.md).
   *
   * **요약과 하위 화면(2026-10-05 세분화):** 이 섹션 본문은 **요약**이다 — 자동 승인 스위치 · 묶음 줄
   * ("10개 중 N개 켜짐 · 규칙 M줄" + [편집 ›]) · 허용 패턴 줄("규칙 N개 · 간단 패턴 M개" + [편집 ›]) · 상한들.
   * 묶음을 켜고 끄고 명령을 하나씩 끄는 일은 [편집 ›] 이 여는 **묶음 편집**(`AutomationBundles`), 사용자 규칙
   * (`[[automation.allow]]`)과 간단 패턴을 더하고 고치는 일은 [편집 ›] 이 여는 **허용 패턴 편집**(`AutomationAllow`)이
   * 한다 — 둘 다 같은 틀(`SettingsSubView`)과 같은 시험 칸(`AutomationTester`)을 쓴다.
   * 설정 본문이 그 화면으로 미끄러져 바뀌고(`SubViewStack` — 200ms, 돌아올 땐 반대 방향, reduced-motion 이면 즉시), 위의
   * `‹ 자동 승인` 또는 Escape 로 돌아온다 — Escape 는 하위 화면에서 요약으로만 가고(모달은 그대로), 한 번 더
   * Escape 면 늘 그렇듯 모달이 닫힌다. 돌아오면 그 화면을 연 단추([편집 ›]/[편집 ›])에 포커스가 선다. 섹션이 안
   * 보이게 되면(다른 섹션 · 모달 닫힘) 요약으로 돌아간다. 값은 다른 설정과 같은 미리보기 → [저장]/[취소] 계약이다.
   */

  /** 이 섹션이 지금 보이는가 — 꺼지면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  const patterns = $derived(settings.current.automation.allow_patterns);
  const userRules = $derived(settings.current.automation.allow);
  const autoApprove = $derived(settings.current.automation.auto_approve);
  const enabledBundles = $derived(settings.current.automation.bundles);
  /** 켜진 묶음 수 — 모르는 id(새 버전의 묶음)는 세지 않는다 */
  const onCount = $derived(BUNDLES.filter((b) => enabledBundles.includes(b.id)).length);
  /** 지금 묶음이 펼치는 규칙 줄 수(끈 명령 제외) — 판정이 실제로 보는 몫 */
  const ruleCount = $derived(expandBundles(enabledBundles, settings.current.automation.bundle_off).length);

  // ── 요약 ↔ 하위 화면(묶음 편집 · 허용 패턴 편집) — 화면 상태, 저장하지 않는다 ──
  let view = $state<"summary" | "bundles" | "allow">("summary");
  /** 들어오는 화면이 어느 쪽에서 미끄러져 오나 — 처음 그릴 때는 움직이지 않는다 */
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

  // Escape(하위 화면 → 요약)는 `SubViewStack` 이 창에 캡처로 받는다 — 요약에서는 모달 몫이라 넘기지 않는다.
  const onescape = $derived(view === "summary" ? null : () => void closeSub(true));

  // 섹션이 안 보이게 되면(다른 섹션 · 모달 닫힘) 요약으로 — 다음에 열면 요약부터다.
  $effect(() => {
    if (!active) void closeSub(false);
  });
</script>

<!--
  **줄에는 늘 보이는 설명 줄도 ⓘ 도 없다** — 설명은 이름에 얹는 툴팁(`TipName.svelte`, 다른 설정 섹션과 공용)이다.
  예외 하나: 자동 승인 줄 밑의 위험 배제 안내는 **늘 보인다**(사용자 결정, 2026-10-03 — 자동 승인을 꺼 둬도) —
  이 화면 어디를 만져도 뚫리지 않는 배제를 못 박는다. 2026-10-04 에 섹션 맨 위 빨간 상자에서 **그 옵션 줄 바로
  아래**(그 옵션에 속한 안내)로 옮겼고, 모양도 다른 섹션의 줄 밑 안내(`.footnote`)에 맞췄다. 그래서 자동 승인 줄의
  툴팁은 같은 말을 되풀이하지 않는다. 빈 허용 목록·출력 발췌 켬처럼 상태에 따른 안내도 줄 밑에 선다.
-->
<SubViewStack {view} {dir} {onescape} bind:root={rootEl}>
{#if view === "bundles"}
  <AutomationBundles onback={() => void closeSub(true)} />
{:else if view === "allow"}
  <AutomationAllow onback={() => void closeSub(true)} />
{:else}
<!-- 머리 — MCP · 지침과 같은 틀: 한 줄 설명(ⓘ 자세히) · 각주(항상 제외되는 명령 경고). 켜기 스위치는 그 아래 따로 선 줄이다. -->
<p class="lead">
  <InfoNote id="auto-approve-info" label={t("settings.automation.approve.label")} plain>
    {#snippet summary()}{t("settings.automation.approve.summary")}{/snippet}
    {#snippet note()}{t("settings.automation.approve.note")}{/snippet}
  </InfoNote>
</p>
{#if isRemote}
  <!-- 원격 창(R1a-4) — 정책은 집 PC 전용이다(관문이 save_settings 의 [automation] 변경을 거절한다 — remote/deny.rs) -->
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
      <Toggle id="auto-approve" checked={autoApprove} onchange={setAutoApprove} />
    </div>
  </div>
  <!--
    파이프(|) 허용(10-22 옵트인 · 기본 끔) — 단계마다 허용 범위일 때만. 다른 명령을 실행하는 단계(xargs · 셸 · sudo · tee …)는
    늘 사람 승인이고, 리디렉트 · 치환 · 서브셸이 섞여도 그렇다. 정책 칸이라 원격 웹에서는 저장이 거절된다.
  -->
  <div class="srow" class:dim={!autoApprove}>
    <TipName
      id="auto-allow-pipes"
      for="auto-allow-pipes"
      label={t("settings.automation.pipes.label")}
      tip={t("settings.automation.pipes.note")}
    />
    <div class="size-row">
      <Toggle id="auto-allow-pipes" checked={settings.current.automation.allow_pipes} onchange={setAllowPipes} />
    </div>
  </div>
</div>

<!--
  묶음 — 요약 한 줄("10개 중 N개 켜짐 · 규칙 M줄") + [편집 ›]. 켜고 끄기 · 명령 하나씩 끄기 · 시험은 하위 화면이다.
  [편집 ›] 이 설정 색인(`auto-bundles`)의 목적지다(이름 라벨이 그 단추를 가리킨다).
-->
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

  <!--
    허용 패턴 — 요약 한 줄("규칙 N개 · 간단 패턴 M개") + [편집 ›]. 사용자 규칙(`[[automation.allow]]`)과 간단 패턴
    (`allow_patterns` — 단어 경계 prefix)을 더하고 고치는 일은 하위 화면이다. [편집 ›] 이 설정 색인(`auto-allow`)의
    목적지다. 아무것도 없을 때의 안내(묶음만 켜졌는가 · 아무것도 없는가)는 상태 안내라 요약 줄 밑에 남는다.
  -->
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
        oninput={(e) => setAutoMaxConcurrency(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{AUTO_MAX_CONCURRENCY_MIN}–{AUTO_MAX_CONCURRENCY_MAX}</span>
    </div>
  </div>

  <div class="srow">
    <!--
      검토 대기 만료 — 위 둘과 달리 **자동 승인 토글과 무관하게** 먹는다(검토를 기다리는 작업안은
      수동 승인 쪽이 더 흔하다). `0` 은 "만료 없음" 이라는 답이라 하한으로 접지 않는다.
    -->
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
        oninput={(e) => setApprovalTtlMinutes(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{t("settings.automation.ttl.hint", { max: APPROVAL_TTL_MINUTES_MAX })}</span>
    </div>
  </div>
</div>

<!--
  **실행 기록** — 감사 로그의 보관 기간과 출력 발췌 (docs/log/2026-09-28-run-history.md). 감사 로그 자체는
  끄는 칸이 없다("모든 실행을 기록" 은 불변). 보관 기간은 오래된 날짜 파일을 치우는 칸이고, 출력 발췌는
  볼트 밖에 비밀이 남을 수 있어 **기본 끔**이다 — 무엇이 어디에 적히는지는 툴팁이 말하고, 켜 둔 동안에는 줄 밑
  주의 줄이 보인다(비밀이 볼트 밖 평문 파일로 가는 상태라서).
-->
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
        onchange={setAuditOutputExcerpt}
      />
    </div>
  </div>
</div>
{/if}
</SubViewStack>

<style>
  /* 묶음 요약 줄 — 숫자 글자 + [편집 ›] */
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

  /* 허용 패턴이 하나도 없을 때의 상태 안내 — 요약 줄 밑(두 칸을 다 쓴다) */
  .footnote.allow-empty {
    margin-top: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /* 늘 보이는 위험 배제 안내 — 자동 승인 줄 밑의 `.footnote`(두 칸을 다 쓴다 — settings.css). 다른 줄 밑 안내와
     같은 크기·간격이고, 강조는 경고색 아이콘 하나 + 굵은 낱말뿐이다(빨간 판은 걷었다 — 오류가 아니라 늘 참인 배제다). */
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
