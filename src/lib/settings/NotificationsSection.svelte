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
   * **알림** 섹션 (2026-09-27 — docs/log/2026-09-27-discord-notify.md 의 "설정 자리").
   *
   * 알림 손잡이가 넷으로 흩어져 있었다 — 에이전트 턴 끝·권한(AI 에이전트) · 긴 명령(터미널) · 프로그램
   * 알림 OSC 9·777(터미널) · 검토 요청(자동 승인). 거기에 Discord 가 더해지면서 "알림이 왜 안 오나 / 왜
   * 너무 오나" 를 고치러 온 사람이 섹션 셋을 뒤지게 됐다. 그래서 **화면만** 한자리로 모았다 —
   * `settings.toml` 의 키(`[ai] notify_*` · `[terminal] notify_after_secs`·`osc_notify` ·
   * `[automation] notify_review_requests`·`notify_operation_results` · `[messenger]`)도, 문구 키(`settings.ai.notify_*` …)도 그대로다
   * (docs/conventions.md "id·식별자는 안 바뀐다").
   *
   * 남겨 둔 것: 벨(`[terminal] bell`)은 터미널이 `\a` 에 어떻게 반응하는가라 터미널에, 실행 시간 표식
   * (`mark_after_secs`)은 표시라 터미널에 있다.
   *
   * 묶음은 둘이다 — **창 안 · OS 알림**(사건 종류 순: 에이전트 → 긴 명령 → 프로그램 → 검토 요청 → 실행 결과)과
   * **Discord**(`MessengerSettings`).
   */
</script>

<!--
  **줄에는 늘 보이는 설명 줄도 ⓘ 도 없다** — 설명은 이름에 얹는 툴팁(`TipName.svelte`, 앱 테마·터미널·일반과
  공용)이다. 옛 섹션 머리말(lead)은 섹션 일반 설명이라 걷었다. 칸 옆 단위(`초 · 0 = 끄기`)는 그대로 둔다.
-->

<h4 class="subhead">{t("settings.notifications.app.subhead")}</h4>

<div class="rows term">
  <div class="srow">
    <!--
      **턴 끝 알림** — `[ai] notify_turn_end` (docs/log/2026-09-25-agent-stop-notify.md). 신호는 AI 에이전트 섹션의
      에이전트 블록이 설치하는 훅 `Stop` 이다. 읽는 쪽(`app/agent-notify.ts`)이 `settings` 를 그 자리에서 보므로
      저장 전에도 듣는다.
    -->
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
    <!--
      **권한 물음 알림** — `[ai] notify_permission` (docs/log/2026-09-25-shell-claude-signals.md). 턴 끝
      알림과 같은 배관·같은 표면 규칙이고, 신호는 `Notification` 훅 중 범주가 `permission` 인 것뿐이다.
    -->
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
    <!--
      **보고 있는 타일도 알림** — `[ai] notify_focused_after_secs` (docs/log/2026-09-27-agent-banners.md "보고 있는
      타일도"). 턴 끝 · 권한 물음 둘 다에 걸리므로 그 아래에 두고, 둘 다 꺼야 잠근다(값은 남는다).
    -->
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
    <!-- **사이드 채팅** — `[ai] notify_side_chat`. 끝남 · 권한 물음을 한 칸으로 켜고 끈다(규칙은 `$lib/side-chat-notify`) -->
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
    <!--
      **긴 명령 완료** — `[terminal] notify_after_secs` (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
      터미널 섹션의 셸 통합 훅이 내는 명령 블록(OSC 133) 위에 서 있다 — 그 사실은 툴팁이 말한다.
    -->
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
    <!--
      **프로그램 알림** — `[terminal] osc_notify` (docs/log/2026-09-26-osc-notify-inline-images.md). 셸 통합과
      무관하게 모든 타일에서 돈다. 끄면 Discord 로도 가지 않는다(아래 Discord 칸의 설명).
    -->
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
    <!--
      **검토 요청 OS 알림** — `[automation] notify_review_requests` (docs/log/2026-09-22-review-notify.md).
      자동 승인과 무관하게 기본이 켜진 칸이다: 실행을 허락하는 칸이 아니라 알리기만 하는 칸이라 기본 침묵이 곧
      놓침이다.
    -->
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
    <!--
      **실행 결과 OS 알림** — `[automation] notify_operation_results` (docs/log/2026-09-28-run-result-notify.md).
      검토 요청 알림의 짝이라 바로 아래, 기본 켬. 이 칸이 끄는 것은 OS 알림뿐이다 — 토스트와 알림 센터 기록은 끄는
      칸이 없다(실행 결과를 조용히 삼키는 길을 만들지 않는다).
    -->
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

<MessengerSettings />
