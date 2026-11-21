<script lang="ts">
  import {
    settings,
    setNotifyTurnEnd,
    setNotifyFocusedAfterSecs,
    setNotifyPermission,
    setNotifySideChat,
    setNotifyAfterSecs,
    setOscNotify,
    setNotifyReviewRequests,
    setNotifyOperationResults,
    DEFAULT_NOTIFY_AFTER_SECS,
    DEFAULT_NOTIFY_FOCUSED_AFTER_SECS,
    NOTIFY_AFTER_MAX_SECS,
  } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import MessengerSettings from "$lib/settings/MessengerSettings.svelte";

  /**
   * 알림 섹션 — 화면만 한자리로 모았다. `settings.toml` 키 · 문구 키는 원래 섹션의 것 그대로다(docs/conventions.md "id·식별자는 안 바뀐다").
   * `active` 는 이 섹션이 보이는가 — 메신저 묶음이 Telegram 봇 상태를 그동안만 읽고 듣는다.
   */
  let { active = false }: { active?: boolean } = $props();

  let messenger = $state<ReturnType<typeof MessengerSettings> | undefined>();

  export function expandForAnchor(anchor: string): void {
    messenger?.expandForAnchor(anchor);
  }
</script>

<h4 class="subhead">{t("settings.notifications.app.subhead")}</h4>

<div class="rows term">
  <div class="srow">
    <TipName
      id="ai-notify-turn-end"
      for="ai-notify-turn-end"
      label={t("settings.ai.notify_turn_end.label")}
      tip={t("settings.ai.notify_turn_end.note")}
    />
    <div class="size-row">
      <Toggle id="ai-notify-turn-end" checked={settings.notifyTurnEnd} onchange={setNotifyTurnEnd} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="ai-notify-permission"
      for="ai-notify-permission"
      label={t("settings.ai.notify_permission.label")}
      tip={t("settings.ai.notify_permission.note")}
    />
    <div class="size-row">
      <Toggle id="ai-notify-permission" checked={settings.notifyPermission} onchange={setNotifyPermission} />
    </div>
  </div>

  <div class="srow">
    <!-- 턴 끝 · 권한 물음 둘 다에 걸리므로 둘 다 꺼야 잠근다(값은 남는다) -->
    <TipName
      id="ai-notify-focused-after"
      for="ai-notify-focused-after"
      label={t("settings.ai.notify_focused.label")}
      tip={t("settings.ai.notify_focused.note")}
    />
    <div class="size-row">
      <input
        id="ai-notify-focused-after"
        class="value size"
        type="number"
        min="0"
        max={NOTIFY_AFTER_MAX_SECS}
        value={settings.notifyFocusedAfterSecs}
        placeholder={String(DEFAULT_NOTIFY_FOCUSED_AFTER_SECS)}
        disabled={!settings.notifyTurnEnd && !settings.notifyPermission}
        oninput={(e) => setNotifyFocusedAfterSecs(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{t("settings.terminal.seconds_hint")}</span>
    </div>
  </div>

  <div class="srow">
    <TipName
      id="ai-notify-side-chat"
      for="ai-notify-side-chat"
      label={t("settings.ai.notify_side_chat.label")}
      tip={t("settings.ai.notify_side_chat.note")}
    />
    <div class="size-row">
      <Toggle id="ai-notify-side-chat" checked={settings.notifySideChat} onchange={setNotifySideChat} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="notify-after"
      for="notify-after"
      label={t("settings.terminal.notify.label")}
      tip={tipOf(t("settings.terminal.notify.summary"), t("settings.terminal.notify.note"))}
    />
    <div class="size-row">
      <input
        id="notify-after"
        class="value size"
        type="number"
        min="0"
        max={NOTIFY_AFTER_MAX_SECS}
        value={settings.notifyAfterSecs}
        placeholder={String(DEFAULT_NOTIFY_AFTER_SECS)}
        oninput={(e) => setNotifyAfterSecs(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{t("settings.terminal.seconds_hint")}</span>
    </div>
  </div>

  <div class="srow">
    <TipName
      id="osc-notify"
      for="osc-notify"
      label={t("settings.terminal.osc_notify.label")}
      tip={tipOf(t("settings.terminal.osc_notify.summary"), t("settings.terminal.osc_notify.note"))}
    />
    <div class="size-row">
      <Toggle id="osc-notify" checked={settings.oscNotify} onchange={setOscNotify} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="notify-review"
      for="notify-review"
      label={t("settings.automation.notify.label")}
      tip={t("settings.automation.notify.note")}
    />
    <div class="size-row">
      <Toggle
        id="notify-review"
        checked={settings.current.automation.notify_review_requests}
        onchange={setNotifyReviewRequests}
      />
    </div>
  </div>

  <div class="srow">
    <!-- 끄는 것은 OS 알림뿐 — 토스트 · 알림 센터 기록에는 끄는 칸을 두지 않는다(실행 결과를 조용히 삼키는 길을 만들지 않는다) -->
    <TipName
      id="notify-run-results"
      for="notify-run-results"
      label={t("settings.automation.notifyResults.label")}
      tip={t("settings.automation.notifyResults.note")}
    />
    <div class="size-row">
      <Toggle
        id="notify-run-results"
        checked={settings.current.automation.notify_operation_results}
        onchange={setNotifyOperationResults}
      />
    </div>
  </div>
</div>

<MessengerSettings bind:this={messenger} {active} />
