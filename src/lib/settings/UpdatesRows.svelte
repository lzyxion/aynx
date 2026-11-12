<script lang="ts">
  import { onMount } from "svelte";
  import { settings, setAutoCheckUpdates } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import { relativeTime } from "$lib/notifications";
  import { shownVersion, type UpdateView } from "$lib/updater";
  import {
    checkForUpdates,
    openUpdateCard,
    refreshUpdateView,
    skipUpdate,
    updateView,
  } from "$lib/app/updater.svelte.js";
  import { isMainWindow } from "$lib/app/window.svelte.js";

  /**
   * **설정 › 일반 › 업데이트**(2026-11-12 — 새 섹션 없이 일반의 끝 소제목 · 목업 ④). 줄 셋 — 모두 앱의 두 줄 줄(`.srow` 의
   * `.name` + 이름 밑 `.hint` · 손잡이는 오른쪽 — `settings.css`)이다:
   *
   * - 자동 확인 토글(`[updates] auto_check` — 기본 켬 · 미리보기 계약: 고르는 즉시 걸리고 [저장]이 쓴다).
   * - 판 줄 — "판 0.1.1" + 밑줄에 새 판 · 마지막 확인(실패면 오류색) · [지금 확인] · 새 판이 있으면 주 동작 [0.1.2 보기](카드 — 주 창에서만).
   *   설정값이 아니라 지금의 상태라 [저장] · [취소] 바깥이다(세션 서버 줄과 같다).
   * - 건너뛴 판 줄 — 건너뛴 판이 있을 때만 [건너뛰기 되돌리기](곧바로 `updater.json` — 저장을 기다리지 않는다).
   *
   * 상태는 `app/updater` 의 사본(주 창)이고, 보조 창의 설정은 열릴 때 한 번 받은 값을 쓴다.
   */

  let local = $state<UpdateView | null>(null);
  let now = $state(Date.now());

  const view = $derived(updateView() ?? local);
  const available = $derived(shownVersion(view));

  onMount(() => {
    void refreshUpdateView().then((v) => (local = v));
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  async function check(): Promise<void> {
    await checkForUpdates(false);
    if (!updateView()) local = await refreshUpdateView();
  }

  async function undoSkip(): Promise<void> {
    await skipUpdate(null);
    if (!updateView()) local = await refreshUpdateView();
  }

  /** 판 줄의 밑줄 — 확인 중 · 새 판 · 최신(+ 마지막 확인). 확인 실패는 따로(오류색) */
  const status = $derived.by(() => {
    const v = view;
    if (!v) return "";
    if (v.checking) return t("settings.general.updates.version.checking");
    const parts: string[] = [];
    if (available) parts.push(t("settings.general.updates.version.available", { version: available }));
    else if (v.checkedAt !== null && !v.checkError) parts.push(t("settings.general.updates.version.latest"));
    if (v.checkedAt !== null) parts.push(t("settings.general.updates.version.checked", { when: relativeTime(v.checkedAt, now, t) }));
    return parts.join(" · ");
  });
</script>

<h4 class="subhead">{t("settings.general.updates.heading")}</h4>

<!-- 설명은 이름의 툴팁에만(사용자 — 늘 보이는 설명 줄 없음) -->
<SettingRow id="updates-auto-check" label={t("settings.general.updates.auto.label")} tip={t("settings.general.updates.auto.tip")}>
  {#snippet control()}
    <Toggle id="updates-auto-check" checked={settings.autoCheckUpdates} onchange={setAutoCheckUpdates} />
  {/snippet}
</SettingRow>

<div class="srow" data-update-version>
  <!-- 이름은 UI 언어와 상관없이 늘 영어 `Version 0.1.1`(2026-11-12 사용자 결정 — 상태바 칩 글자와 같은 판단: 판 번호에 붙는 이름표) -->
  <span class="name">Version {view?.current ?? ""}</span>
  {#if view?.checkError && !view.checking}
    <span class="hint err" role="alert" data-update-check-error
      >{view.checkError}{#if view.checkedAt !== null}
        · {t("settings.general.updates.version.checked", { when: relativeTime(view.checkedAt, now, t) })}{/if}</span
    >
  {:else if status}
    <span class="hint" data-update-status>{status}</span>
  {/if}
  <span class="update-actions">
    <button
      type="button"
      id="updates-check"
      class="btn btn-sm btn-secondary"
      data-update-check
      disabled={!view || view.checking}
      onclick={() => void check()}>{t("settings.general.updates.check")}</button
    >
    {#if available && isMainWindow}
      <button type="button" class="btn btn-sm btn-primary" data-update-see onclick={() => openUpdateCard()}
        >{t("settings.general.updates.see", { version: available })}</button
      >
    {/if}
  </span>
</div>

{#if view?.skipped}
  <div class="srow" data-update-skipped>
    <TipName
      id="updates-skipped"
      label={t("settings.general.updates.skipped", { version: view.skipped })}
      tip={t("settings.general.updates.skipped.tip")}
    />
    <button type="button" class="btn btn-sm btn-secondary" data-update-undo-skip onclick={() => void undoSkip()}
      >{t("settings.general.updates.undo")}</button
    >
  </div>
{/if}


<style>
  .update-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .hint.err {
    color: var(--err);
  }
</style>
