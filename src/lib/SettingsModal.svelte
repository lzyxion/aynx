<script lang="ts">
  import {
    applyStoredLanguage,
    revertSettings,
    saveSettings,
    settings,
    settingsNav,
  } from "$lib/settings.svelte.js";
  import { askChoice } from "$lib/app/confirm-dialog.svelte.js";
  import { setSettingsLeaveGuard } from "$lib/app/dock.svelte.js";
  import { saveAndReflect, settleSettingsClose } from "$lib/settings/settings-close";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { SETTINGS_SECTIONS } from "$lib/settings-index";
  import { adoptExternalSettings, settingsExternal } from "$lib/settings-sync.svelte.js";
  import { toast } from "$lib/toast.svelte.js";
  import { syncStoredMode } from "$lib/mode.svelte.js";
  import { refreshWallpaper } from "$lib/wallpaper.svelte.js";
  import { modifiedActiveProfile, overwriteProfileWithCurrent } from "$lib/theme-profiles.svelte.js";
  import "$lib/settings/settings.css";
  import SectionNav from "$lib/settings/SectionNav.svelte";
  import GeneralSection from "$lib/settings/GeneralSection.svelte";
  import CredentialsSection from "$lib/settings/CredentialsSection.svelte";
  import RemoteSection from "$lib/settings/RemoteSection.svelte";
  import AppThemeSection from "$lib/settings/AppThemeSection.svelte";
  import TerminalSection from "$lib/settings/TerminalSection.svelte";
  import NotificationsSection from "$lib/settings/NotificationsSection.svelte";
  import KeybindingsSection from "$lib/settings/KeybindingsSection.svelte";
  import TriggersSection from "$lib/settings/TriggersSection.svelte";
  import McpSection from "$lib/settings/McpSection.svelte";
  import McpManager from "$lib/settings/McpManager.svelte";
  import AutomationSection from "$lib/settings/AutomationSection.svelte";
  import SnippetsSection from "$lib/settings/SnippetsSection.svelte";
  import TemplatesSection from "$lib/settings/TemplatesSection.svelte";
  import InstructionsSection from "$lib/settings/InstructionsSection.svelte";
  import NotePopover from "$lib/settings/NotePopover.svelte";

  /**
   * 미리보기 계약 — 모든 변경은 즉시 화면에 적용된다. [저장] 은 지금 보이는 것을 파일에 쓰고, [취소] 는 마지막 저장 값으로 되돌린다.
   * 닫기(Escape · 배경 · 머리줄 닫기 · 설정 단축키 · 독 화면 바꾸기)는 [취소] 와 같되 미저장 변경이 있으면 먼저 묻는다.
   * 섹션은 언마운트하지 않고 `hidden` 으로만 숨긴다 — `{#if}` 로 갈아 끼우면 섹션의 지역 상태가 날아간다.
   */
  let {
    open = false,
    onclose,
  }: { open?: boolean; onclose?: () => void } = $props();

  /** 팔레트의 설정 색인과 같은 표 — 순서 · 숨김 규칙은 `settings-index.ts` 에 */
  const SECTIONS = SETTINGS_SECTIONS;
  let activeTab = $state<string>("theme");
  let mcpManager = $state<ReturnType<typeof McpManager> | undefined>();
  let mcpSection = $state<ReturnType<typeof McpSection> | undefined>();
  let instructionsSection = $state<ReturnType<typeof InstructionsSection> | undefined>();
  let credentialsSection = $state<ReturnType<typeof CredentialsSection> | undefined>();
  let themeSection = $state<ReturnType<typeof AppThemeSection> | undefined>();
  let remoteSection = $state<ReturnType<typeof RemoteSection> | undefined>();
  let notificationsSection = $state<ReturnType<typeof NotificationsSection> | undefined>();
  let pendingAnchor: string | null = null;

  /** MCP 상태 조회 뒤에도 부른다 — 접힌 서버 상세의 목적지를 다시 찾게. */
  function revealPendingAnchor(): void {
    const anchor = pendingAnchor;
    if (anchor === null || !open) return;
    if (activeTab === "mcp") mcpManager?.expandForAnchor(anchor);
    if (activeTab === "instructions") instructionsSection?.showSummary();
    if (activeTab === "ai") mcpSection?.expandForAnchor(anchor);
    if (activeTab === "credentials") credentialsSection?.expandForAnchor(anchor);
    if (activeTab === "theme") themeSection?.expandForAnchor(anchor);
    if (activeTab === "remote") remoteSection?.expandForAnchor(anchor);
    if (activeTab === "notifications") notificationsSection?.expandForAnchor(anchor);
    // 프레임 두 개 뒤에 간다 — 섹션 맨 위 되돌림과 독의 rAF(`scrollToTop()` · 상자 포커스) 뒤여야 덮이지 않는다.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pendingAnchor === anchor && revealAnchor(anchor)) pendingAnchor = null;
    }));
  }

  /** 바깥에서 온 섹션 요청은 읽고 곧바로 비운다 — 남기면 설정을 열 때마다 그 섹션이 다시 펴진다. 모르는 id 는 무시한다. */
  $effect(() => {
    if (!open) return;
    const want = settingsNav.want;
    if (want === null) return;
    const anchor = settingsNav.anchor;
    settingsNav.want = null;
    settingsNav.anchor = null;
    if (!SECTIONS.some((s) => s.id === want)) return;
    activeTab = want;
    pendingAnchor = anchor;
    if (anchor !== null) {
      revealPendingAnchor();
    }
  });

  /** 이 패널 안에서만 찾는다 — 다른 화면의 요소가 선택되지 않게. `data-anchor-for` 는 빈칸으로 가른 목록이다. */
  function revealAnchor(anchor: string): boolean {
    const panel = panelEl;
    if (!panel || panel.getClientRects().length === 0) return false;
    const esc = CSS.escape(anchor);
    const el =
      panel.querySelector<HTMLElement>(`#${esc}`) ??
      panel.querySelector<HTMLElement>(`label[for="${esc}"]`) ??
      panel.querySelector<HTMLElement>(`[data-anchor-for~="${esc}"]`);
    if (!el || el.getClientRects().length === 0) return false;
    el.scrollIntoView({ block: "center" });
    if (el.matches("input, select, textarea, button") && !(el as HTMLInputElement).disabled) {
      el.focus({ preventScroll: true });
    }
    return true;
  }

  let panelEl = $state<HTMLElement | null>(null);

  // 스크롤 상자가 섹션마다가 아니라 하나라, 섹션을 갈면 맨 위로 되돌려야 새 섹션이 한가운데부터 보이지 않는다.
  $effect(() => {
    const section = activeTab; // 이 효과의 의존성 — 섹션이 바뀔 때만 다시 돈다
    if (section && panelEl) panelEl.scrollTop = 0;
  });

  /** 독이 열릴 때 부른다 — 타일은 부르지 않는다(포커스가 다녀온 것만으로 스크롤이 튀면 이어서 만지는 일이 끊긴다). */
  export function scrollToTop(): void {
    if (panelEl) panelEl.scrollTop = 0;
  }

  let saving = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (!open) return;
    error = null;
  });

  let keys = $state<ReturnType<typeof KeybindingsSection> | undefined>();

  function close() {
    onclose?.();
  }

  function cancel() {
    revertView();
    close();
  }

  /** [취소] 단추와 닫기의 [저장 안 함] 이 같이 쓴다 */
  function revertView() {
    revertSettings();
    // 모드 · 언어 · 배경은 화면에 이미 걸려 있어 값만 되돌리면 화면과 어긋난다 — 되돌린 값으로 다시 건다.
    syncStoredMode();
    applyStoredLanguage();
    void refreshWallpaper();
    // [취소] 는 바깥 변경 배너의 원인(이 창의 미저장 편집)을 버리므로 배너도 내린다.
    settingsExternal.pending = false;
  }

  /** 바깥 변경 배너가 뜬 채로 저장해도 막지 않는다 — 마지막 저장이 이긴다. */
  async function writeSettings(): Promise<boolean> {
    if (saving) return false;
    saving = true;
    error = null;
    try {
      await saveSettings();
      settingsExternal.pending = false;
      toast.success(t("settings.toast.saved"));
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      saving = false;
    }
  }

  /** 묻지 않는다 — 닫기 물음의 [저장] 도 이 길이다 */
  function save(): Promise<boolean> {
    return saveAndReflect({
      write: writeSettings,
      modifiedProfile: async () => (await modifiedActiveProfile())?.id ?? null,
      reflect: overwriteProfileWithCurrent,
    });
  }

  $effect(() => {
    let asking = false;
    setSettingsLeaveGuard((go) => {
      if (!settings.dirty) return false;
      if (asking) return true;
      asking = true;
      void settleSettingsClose({
        dirty: () => settings.dirty,
        ask: () =>
          askChoice(t("settings.close.ask.body"), {
            title: t("settings.close.ask.title"),
            kind: "warning",
            yesLabel: t("settings.close.ask.save"),
            noLabel: t("settings.close.ask.discard"),
            cancelLabel: t("settings.close.ask.keep"),
          }),
        save,
        revert: revertView,
      })
        .then((ok) => {
          if (ok) go();
        })
        .finally(() => {
          asking = false;
        });
      return true;
    });
    return () => setSettingsLeaveGuard(null);
  });

  /** 모달(`Dock.svelte`)의 keydown 이 닫기 전에 부른다 — 단축키 기록 중 Escape 는 기록만 취소한다. */
  export function captureIfRecording(ev: KeyboardEvent): boolean {
    if (!open) return false;
    return keys?.captureIfRecording(ev) ?? false;
  }
</script>

<div class="settings-view" role="region" aria-label={t("settings.title")}>
  <!-- 섹션에 `h3` 제목을 두지 않는다 — 사이드 탭에 이름이 이미 눌린 채로 보인다 -->
  <div class="settings-body">
    <SectionNav tabs={SECTIONS} active={activeTab} onselect={(id) => { pendingAnchor = null; activeTab = id; }} />

    <div class="settings-panel" bind:this={panelEl}>
      <section hidden={activeTab !== "theme"}>
        <AppThemeSection bind:this={themeSection} active={open && activeTab === "theme"} />
      </section>

      <section hidden={activeTab !== "general"}>
        <GeneralSection />
      </section>

      <section hidden={activeTab !== "keys"}>
        <KeybindingsSection bind:this={keys} />
      </section>

      <section hidden={activeTab !== "terminal"}>
        <TerminalSection active={activeTab === "terminal"} />
      </section>

      <section hidden={activeTab !== "snippets"}>
        <SnippetsSection active={open && activeTab === "snippets"} />
      </section>

      <section hidden={activeTab !== "triggers"}>
        <TriggersSection active={open && activeTab === "triggers"} />
      </section>

      <section hidden={activeTab !== "templates"}>
        <TemplatesSection active={open && activeTab === "templates"} />
      </section>

      <section hidden={activeTab !== "ai"}>
        <McpSection bind:this={mcpSection} active={open && activeTab === "ai"} />
      </section>

      <section hidden={activeTab !== "mcp"}>
        <McpManager bind:this={mcpManager} active={open && activeTab === "mcp"} onloaded={revealPendingAnchor} />
      </section>
      <section hidden={activeTab !== "instructions"}>
        <InstructionsSection bind:this={instructionsSection} active={open && activeTab === "instructions"} onloaded={revealPendingAnchor} />
      </section>
      <section hidden={activeTab !== "automation"}>
        <AutomationSection active={open && activeTab === "automation"} />
      </section>
      <section hidden={activeTab !== "notifications"}>
        <NotificationsSection bind:this={notificationsSection} active={open && activeTab === "notifications"} />
      </section>

      <section hidden={activeTab !== "credentials"}>
        <CredentialsSection bind:this={credentialsSection} active={open && activeTab === "credentials"} />
      </section>

      <section hidden={activeTab !== "remote"}>
        <RemoteSection bind:this={remoteSection} active={open && activeTab === "remote"} />
      </section>
    </div>
  </div>

  <!-- 바깥 변경 안내 · 오류는 스크롤 패널 밖에 둔다 — 안에 두면 스크롤한 상태에서 화면 밖으로 밀린다 -->
  {#if settingsExternal.pending}
    <p class="external" role="status">
      <span class="external-text">{t("settings.external.text")}</span>
      <button
        type="button"
        class="btn btn-sm btn-secondary"
        title={t("settings.external.reload.title")}
        onclick={() => void adoptExternalSettings()}
      >
        {t("settings.external.reload")}
      </button>
    </p>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <!-- 섹션들의 `InfoNote` 가 연 팝오버를 스크롤 패널 밖에서 그린다 -->
  <NotePopover active={open} />

    <div class="actions">
      <button type="button" class="btn btn-secondary" onclick={cancel}>{t("settings.actions.cancel")}</button>
      <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>
        {saving ? t("settings.actions.saving") : t("settings.actions.save")}
      </button>
    </div>
</div>

<style>
  .settings-view {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: var(--space-4);
    /* 재질 글래스면 판은 독 상자가 칠하고 여기는 비운다 */
    background: var(--glass-inner, var(--m3-surface-container-low));
  }

  .settings-body {
    display: flex;
    gap: var(--space-5);
    flex: 1 1 auto;
    min-height: 0; /* 자식(패널)이 넘칠 때 스크롤이 생기도록 */
  }

  /* 왼쪽 12px 는 포커스 링이 설 자리다 — 스크롤 상자는 가로로도 padding box 에서 잘라 0 이면 왼쪽 끝의 링이 잘린다.
     12 = 하위 화면 [‹ 돌아가기](본문보다 8px 왼쪽) + 링 4. `SubViewStack` 의 `.sub-views` 가 이 여백 안으로 같은 12px 를 넓혀 쓴다
     (`scripts/dev/focus-ring-clip-harness.mjs` 의 배치 비교). */
  .settings-panel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    margin-left: -12px;
    padding: 0 var(--space-2) var(--space-4) 12px;
  }

  .settings-panel > section {
    max-width: 640px;
  }

  /* display:flex/grid 섹션이 있어도 숨긴 섹션이 이기게 */
  .settings-panel > section[hidden] {
    display: none !important;
  }

  /* 채움(fill-mode)을 두지 않는다 — transform 이 남으면 안의 fixed 팝오버 기준이 바뀐다 */
  .settings-panel > section:not([hidden]) {
    animation: settings-section-in 480ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  @keyframes settings-section-in {
    from {
      transform: translateY(14px);
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-panel > section:not([hidden]) {
      animation: none;
    }
  }

  .error {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    user-select: text;
  }

  /* 오류가 아니라 안내라 실패색을 쓰지 않는다 */
  .external {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }

  .external-text {
    flex: 1 1 auto;
    min-width: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    flex: 0 0 auto;
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line);
  }

  .actions > :global(.btn) {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }
</style>
