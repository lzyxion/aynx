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
  import InstructionsSection from "$lib/settings/InstructionsSection.svelte";
  import NotePopover from "$lib/settings/NotePopover.svelte";

  /**
   * 앱 설정 화면의 **셸** — 사이드 내비 · 지금 보이는 섹션 · [저장]/[취소] · Escape.
   *
   * 값과 손잡이는 하나도 여기 없다. 섹션 여덟 개가 `$lib/settings/` 아래에 있고, 전부
   * `settings.svelte.ts` 의 모듈 상태를 **직접** 읽고 쓴다 — 프롭으로 값을 내려보내지
   * 않는다 (docs/log/2026-09-05-refactor-settings.md). 그래서 여기 남은 배선은 셋뿐이다:
   * 어느 섹션을 보이느냐, 창 keydown 을 누가 먹느냐, 저장·취소를 언제 부르느냐.
   *
   * ## 설계안 "디자인 커스텀" 3층 중 이 화면이 맡는 범위
   *
   * **①앱 크롬**과 **②터미널 내부**의 자주 쓰는 부분만 다룬다. 그 이상은 ③사용자 CSS
   * 오버라이드로 넘긴다 (하단 안내).
   *
   * ## 설정 모달의 본문
   *
   * 가운데 상자와 배경, 제목, 키보드 순회와 Escape는 `Dock.svelte`가 맡는다.
   * 본문은 상시 마운트되어 보던 섹션과 편집 상태를 유지한다.
   * `open`은 단축키 기록과 MCP 상태 조회를 켜고, `onclose`는 모달을 닫는다.
   * 모달은 키를 처리하기 전에 `captureIfRecording`에 물어 기록 취소를 우선한다.
   * 저장은 화면을 닫지 않고, 취소는 저장된 값으로 되돌린 뒤 닫는다. **닫기(Escape · 배경 누르기 · 머리줄 닫기 · 설정 단축키 · 독 화면 바꾸기)는 [취소] 와
   * 같다** — 미저장 변경이 있으면 먼저 [저장] / [저장 안 함] / [계속 편집] 을 묻는다. **저장하면 고른 테마 프로필에도 지금 모양을
   * 반영한다**(묻지 않음 — 다를 때만 · 알림 한 줄)(`settings/settings-close.ts` · 독의 닫기 문
   * `setSettingsLeaveGuard` — docs/log/2026-10-22-settings-close-asks-save.md).
   *
   * ## 미리보기 계약
   *
   * 모든 변경은 **즉시** 화면에 적용된다 (`applySettings` + 터미널의 `$effect` 구독).
   * 그래서 [저장]은 "지금 보이는 것을 파일에 쓴다", [취소]는 "마지막 저장 값으로 되돌린다"
   * 는 뜻이 된다 — 미리보기와 실제 적용이 어긋날 자리가 없다.
   */
  let {
    open = false,
    onclose,
  }: { open?: boolean; onclose?: () => void } = $props();

  /**
   * 섹션 목록 — 팔레트의 설정 색인과 **같은 표**라 `settings-index.ts` 에 산다
   * (docs/log/2026-09-25-palette.md). 순서·숨김 규칙의 까닭도 거기 주석에 있다.
   */
  const SECTIONS = SETTINGS_SECTIONS;
  /** 지금 보이는 카테고리 — 첫 항목(일반)으로 시작한다 */
  let activeTab = $state<string>("theme");
  let mcpManager = $state<ReturnType<typeof McpManager> | undefined>();
  let mcpSection = $state<ReturnType<typeof McpSection> | undefined>();
  let instructionsSection = $state<ReturnType<typeof InstructionsSection> | undefined>();
  let credentialsSection = $state<ReturnType<typeof CredentialsSection> | undefined>();
  let themeSection = $state<ReturnType<typeof AppThemeSection> | undefined>();
  let remoteSection = $state<ReturnType<typeof RemoteSection> | undefined>();
  let pendingAnchor: string | null = null;

  /** MCP 상태 조회 뒤에도 접힌 서버 상세의 팔레트 목적지를 다시 찾는다. */
  function revealPendingAnchor(): void {
    const anchor = pendingAnchor;
    if (anchor === null || !open) return;
    if (activeTab === "mcp") mcpManager?.expandForAnchor(anchor);
    if (activeTab === "instructions") instructionsSection?.showSummary();
    // AI 에이전트 — 접힌 에이전트 몸통 안의 줄(훅 · 추가 인자 · 스위치)이면 그 에이전트를 먼저 펼친다
    if (activeTab === "ai") mcpSection?.expandForAnchor(anchor);
    // 보안 — 목록 셋은 하위 화면이다: 색인 줄은 요약의 [관리 ›] 이라 요약으로, 고아 알림은 AI 권한 호스트 화면으로
    if (activeTab === "credentials") credentialsSection?.expandForAnchor(anchor);
    // 테마 — 아바타 줄들은 하위 화면이다: 그 줄이면 아바타 하위 화면을, 나머지는 요약을 연다
    if (activeTab === "theme") themeSection?.expandForAnchor(anchor);
    // 원격 접속 — 접힌 카드 안의 칸이면 그 카드를 먼저 펼친다
    if (activeTab === "remote") remoteSection?.expandForAnchor(anchor);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pendingAnchor === anchor && revealAnchor(anchor)) pendingAnchor = null;
    }));
  }

  /**
   * **바깥에서 온 섹션 요청을 한 번 소비한다** ([`settingsNav`] — 치트시트의 "설정에서 바꾸기").
   *
   * 값을 읽고 곧바로 비우는 것이 요점이다: 남겨 두면 다음에 설정 모달을 열 때마다 그 섹션이
   * 다시 펴져, 사용자가 마지막에 보던 자리를 잃는다. 모르는 id 는 조용히 무시한다
   * (`SECTIONS` 에 없는 값이 오면 아무 섹션도 안 보이는 화면이 된다).
   */
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
    // **줄 하나까지** 가는 요청(팔레트의 설정 색인 — docs/log/2026-09-25-palette.md).
    // 프레임 두 개 뒤에 간다: 섹션을 갈면 위 효과가 맨 위로 되돌리고, 독이 막 열리는
    // 중이면 독의 rAF 가 `scrollToTop()` 과 상자 포커스를 한 번 더 한다(`Dock.svelte`) —
    // 둘 다 한 프레임 안에 끝나므로 그 **뒤**에 자리를 잡아야 덮이지 않는다.
    if (anchor !== null) {
      revealPendingAnchor();
    }
  });

  /**
   * 설정 줄 하나를 **보이는 자리로** — 스크롤하고, 포커스를 받을 수 있는 요소면 포커스까지.
   *
   * 찾는 순서: 그 id 의 요소(대개 컨트롤) → 그 id 를 가리키는 `<label for>`(컨트롤에 id 가
   * 없는 줄 — 볼트 상태처럼 글자와 단추뿐인 줄) → 그 id 를 `data-anchor-for`(빈칸으로 가른 목록)에 적은
   * 대신 설 자리(지금 숨어 있는 줄 — 메신저 채널이 하나도 없을 때의 규칙 줄은 채널 상자로 간다).
   * 못 찾으면 조용히 섹션 맨 위에 남는다.
   * 이 패널 안에서만 찾아 다른 화면의 요소가 선택되지 않도록 한다.
   */
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

  /**
   * 오른쪽 내용 패널 — 이 앱에서 **설정이 스크롤되는 유일한 상자**다 (섹션들은 여기 안에서
   * `hidden` 으로 갈린다). 스크롤을 되돌릴 자리가 필요해 참조를 잡아 둔다.
   */
  let panelEl = $state<HTMLElement | null>(null);

  /**
   * 섹션을 갈아 끼우면 **그 섹션의 맨 위**부터 보여 준다.
   *
   * 스크롤 상자가 섹션마다가 아니라 **하나**라, 긴 섹션을 내려 본 뒤 다른 섹션을 고르면
   * 그 위치가 그대로 남아 새 섹션이 한가운데부터 보인다 — 무엇을 보고 있는지 알 수 없는
   * 첫 화면이다.
   */
  $effect(() => {
    const section = activeTab; // 이 효과의 의존성 — 섹션이 바뀔 때만 다시 돈다
    if (section && panelEl) panelEl.scrollTop = 0;
  });

  /**
   * **지금 섹션의 맨 위로** — 독이 열릴 때(그리고 종류를 갈아 끼울 때) 부른다
   * (docs/log/2026-09-08-settings-dock.md).
   *
   * 독은 잠깐 떴다 사라지는 층이라 열릴 때마다 같은 첫 화면이어야 한다. 타일은 부르지
   * 않는다 — 그쪽은 계속 그 자리에 있는 화면이고, 포커스가 다른 타일에 갔다 오는 것만으로
   * 스크롤이 튀면 여러 항목을 이어서 만지는 일이 끊긴다.
   */
  export function scrollToTop(): void {
    if (panelEl) panelEl.scrollTop = 0;
  }

  let saving = $state(false);
  let error = $state<string | null>(null);

  // 열릴 때마다 지난 오류를 지운다
  $effect(() => {
    if (!open) return;
    error = null;
  });

  /**
   * 단축키 섹션의 손잡이 — 창 keydown 을 **먼저 물어보기** 위한 것 하나뿐이다
   * ([`KeybindingsSection`] 의 "창 keydown 은 여기서 듣지 않는다").
   */
  let keys = $state<ReturnType<typeof KeybindingsSection> | undefined>();

  /** 이 설정 패널이 속한 탭을 닫는다 (부모 PaneHost 의 `onclosepane` → `closePaneIn`) */
  function close() {
    onclose?.();
  }

  /**
   * [취소] — 마지막 **저장된** 값으로 되돌린다 (미리보기로 바꾼 것이 전부 사라진다).
   *
   * 앱 모드도 `[app] mode` 에 사는 설정이라 함께 돌아온다. 다만 그 값은 화면(`<html>` 의
   * 속성)에 이미 걸려 있으므로 `revertSettings` 만으로는 두 쪽이 어긋난다 — 되돌린 값으로
   * 다시 맞춰 준다 (보통은 모드 변경이 그 자리에서 저장돼 되돌릴 것이 없다).
   */
  function cancel() {
    revertView();
    close();
  }

  /** [취소] 의 되돌림(닫기는 빼고) — [취소] 단추와 닫기의 [저장 안 함] 이 같이 쓴다 */
  function revertView() {
    revertSettings();
    syncStoredMode();
    // 언어도 `[app] language` 에 사는 설정이라 함께 돌아온다 — 값만 되돌리면 화면은 방금
    // 고른 언어로 남으므로 같은 자리에서 다시 건다 (모드와 같은 이유·같은 모양).
    applyStoredLanguage();
    // 배경 URL 은 **화면의 설정** 이름을 따라 그려진다 — 미저장 편집 중에 모양 프로필을 적용해
    // 배경이 바뀌었다면 되돌린 이름으로 다시 그린다 (docs/log/2026-09-28-profile-cards-wallpapers.md).
    void refreshWallpaper();
    // 바깥 변경 배너도 함께 내린다 (docs/log/2026-09-05-settings-sync.md). 그 깃발은 "이
    // 창의 미저장 편집 때문에 남의 저장을 못 덮었다" 는 뜻인데, [취소] 는 바로 그 편집을
    // 버리는 조작이라 남겨 둘 이유가 없어진다. 이 창은 어차피 타일을 닫으므로 배너를 볼
    // 화면도 사라진다 — 다음에 설정을 열 때 옛 사건의 배너가 되살아나면 그때는 거짓말이다.
    settingsExternal.pending = false;
  }

  /**
   * 설정을 파일에 쓰고 토스트로 알린다 — 프로필 반영은 빼고([`save`] 가 이것 뒤에 한다).
   * 모달을 닫지 않아 보던 섹션과 스크롤 위치를 유지한다.
   *
   * **바깥 변경 배너가 뜬 채로 저장해도 막지 않는다** (docs/log/2026-09-05-settings-sync.md).
   * 규칙은 파일 하나를 여럿이 쓰는 다른 모든 자리와 같다 — **마지막 저장이 이긴다.** 여기서
   * 굳이 병합을 시도할 것이 없다: 사용자는 배너를 본 채로 [저장]을 눌렀고, 그것은 "내 값으로
   * 간다" 는 뜻이다. 저장이 끝나면 파일이 곧 이 창의 값이므로 배너는 내린다 (그리고 이
   * 저장이 쏘는 알림이 다른 창들을 이 값으로 따라오게 한다).
   */
  async function writeSettings(): Promise<boolean> {
    if (saving) return false;
    saving = true;
    error = null;
    try {
      await saveSettings();
      // 내 값이 파일을 이겼다 — 배너가 가리키던 "따라오지 못한 변경" 은 더 이상 없다.
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

  /**
   * [저장] — 묻지 않는다. 파일에 쓰고, 성공했으면 고른 테마 프로필과 모양이 다를 때 그 프로필에도 지금 모양을 반영한다(알림 한 줄 —
   * 사용자 결정 10-22). 닫기 물음의 [저장] 도 이 길이다. 순서는 `settings/settings-close.ts` 의 `saveAndReflect`.
   */
  function save(): Promise<boolean> {
    return saveAndReflect({
      write: writeSettings,
      modifiedProfile: async () => (await modifiedActiveProfile())?.id ?? null,
      reflect: overwriteProfileWithCurrent,
    });
  }

  /**
   * **설정을 떠나는 문** — 독의 닫기 · 화면 바꾸기가 먼저 묻는다(`app/dock.svelte.ts` 의 `setSettingsLeaveGuard`). 미저장 변경이
   * 없으면 그냥 떠난다. 있으면 [저장](이 화면의 [저장] 과 같은 길 — 실패면 남는다) · [저장 안 함]([취소] 의 되돌림) · 물림(닫지 않음).
   * 원격 웹 창도 같은 화면이라 같은 규칙이다.
   */
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

  /**
   * **기록 중이면 이 키는 설정의 것이다** — 담은 그릇이 먼저 물어보는 창구.
   *
   * 모달(`Dock.svelte`)의 keydown이 닫기 전에 이 함수를 부른다.
   * 기록 중 Escape는 기록만 취소하고, 삼켰으면 모달의 키 처리를 멈춘다.
   */
  export function captureIfRecording(ev: KeyboardEvent): boolean {
    if (!open) return false;
    return keys?.captureIfRecording(ev) ?? false;
  }
</script>

<!-- 설정 모달 본문 — 위치·배경·제목은 담는 쪽이 맡는다. -->
<div class="settings-view" role="region" aria-label={t("settings.title")}>
  <!--
    본문 = 좌측 내비 + 우측 패널. 내비는 카테고리 버튼 세로 목록, 패널은 독립 스크롤.
    섹션들은 언마운트하지 않고 `hidden` 으로만 숨겨 지역 상태를 지킨다 (위 SECTIONS 주석).

    **어느 섹션에도 `h3` 제목이 없다** (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md):
    왼쪽 사이드 탭에 그 이름이 이미 **눌린 채로** 보이므로, 본문 첫 줄에 같은 글자를 한 번 더
    세우면 어느 섹션에 있는지를 두 번 말하면서 정작 첫 손잡이를 그만큼 아래로 민다.
  -->
  <div class="settings-body">
    <SectionNav tabs={SECTIONS} active={activeTab} onselect={(id) => { pendingAnchor = null; activeTab = id; }} />

    <div class="settings-panel" bind:this={panelEl}>
      <section hidden={activeTab !== "theme"}>
        <!-- 아바타 하위 화면은 이 칸이 안 보이게 되면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다. 하위 화면의 목록 · 아티스트는
             그 화면을 볼 때 다시 읽는다(다른 창에서 넣은 그림 · 고친 아티스트도 보이게) -->
        <AppThemeSection bind:this={themeSection} active={open && activeTab === "theme"} />
      </section>

      <section hidden={activeTab !== "general"}>
        <GeneralSection />
      </section>

      <section hidden={activeTab !== "keys"}>
        <KeybindingsSection bind:this={keys} />
      </section>

      <section hidden={activeTab !== "terminal"}>
        <!-- 셸 목록은 이 칸을 처음 열 때 한 번만 읽는다 (`TerminalSection` 머리말) -->
        <TerminalSection active={activeTab === "terminal"} />
      </section>

      <section hidden={activeTab !== "snippets"}>
        <!-- 추가 · 편집 하위 화면은 이 칸이 안 보이게 되면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 -->
        <SnippetsSection active={open && activeTab === "snippets"} />
      </section>

      <section hidden={activeTab !== "triggers"}>
        <!-- 추가 · 편집 하위 화면은 이 칸이 안 보이게 되면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 -->
        <TriggersSection active={open && activeTab === "triggers"} />
      </section>

      <section hidden={activeTab !== "ai"}>
        <!-- AI 훅 상태는 이 섹션을 처음 볼 때 읽는다. MCP 관리는 다음 메뉴에서 다룬다. -->
        <McpSection bind:this={mcpSection} active={open && activeTab === "ai"} />
      </section>

      <section hidden={activeTab !== "mcp"}>
        <McpManager bind:this={mcpManager} active={open && activeTab === "mcp"} onloaded={revealPendingAnchor} />
      </section>
      <section hidden={activeTab !== "instructions"}>
        <InstructionsSection bind:this={instructionsSection} active={open && activeTab === "instructions"} onloaded={revealPendingAnchor} />
      </section>
      <section hidden={activeTab !== "automation"}>
        <!-- 묶음 규칙 팝업은 이 칸이 안 보이게 되면(섹션 이동 · 모달 닫힘) 닫힌다 -->
        <AutomationSection active={open && activeTab === "automation"} />
      </section>
      <section hidden={activeTab !== "notifications"}>
        <NotificationsSection />
      </section>

      <section hidden={activeTab !== "credentials"}>
        <!-- 볼트 상태는 **보이는 화면에서 이 칸을 볼 때** 읽는다 (`McpSection` 과 같은 규칙) -->
        <CredentialsSection bind:this={credentialsSection} active={open && activeTab === "credentials"} />
      </section>

      <section hidden={activeTab !== "remote"}>
        <!-- 관문 상태·기기 목록은 이 칸을 볼 때 읽고, 보는 동안 몇 초마다 다시 읽는다(`RemoteSection` 머리말) -->
        <RemoteSection bind:this={remoteSection} active={open && activeTab === "remote"} />
      </section>
    </div>
  </div>

  <!--
    바깥 변경 안내 (docs/log/2026-09-05-settings-sync.md) — **오류가 아니라 안내**다.
    이 창에 미저장 편집이 있어서 다른 창의 저장을 자동으로 덮지 않았다는 뜻이고, 무엇을
    버릴지는 사람이 고른다: [다시 읽기] 면 파일이 이기고(이 창의 편집이 사라진다),
    그냥 [저장] 하면 내 값이 이긴다.

    자리가 스크롤 패널 **밖**인 것이 중요하다 — 안에 두면 섹션을 스크롤한 상태에서 배너가
    화면 밖으로 밀려, 정작 알려야 할 순간에 안 보인다 (`.error` 와 같은 이유·같은 자리).
  -->
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

  <!--
    ⓘ 설명의 팝오버 한 벌 — 섹션들의 `InfoNote` 가 연 것을 스크롤 패널 **밖**에서 그린다
    (docs/log/2026-09-28-settings-note-popover.md). 이 화면이 안 보이게 되면 닫힌다.
  -->
  <NotePopover active={open} />

  <!-- 저장 결과는 토스트로 알린다. -->
    <div class="actions">
      <button type="button" class="btn btn-secondary" onclick={cancel}>{t("settings.actions.cancel")}</button>
      <button type="button" class="btn btn-primary" disabled={saving} onclick={save}>
        {saving ? t("settings.actions.saving") : t("settings.actions.save")}
      </button>
    </div>
</div>

<style>
  /*
    설정 모달 본문은 담는 상자를 채운다. 위치·배경은 Dock이 맡고,
    본문과 저장/취소 푸터를 세로로 쌓는다. 토큰만 쓰므로 앱 테마 변경이 즉시 보인다.

    손잡이 한 벌(`.name`·`.value`·`.srow`·`select`…)의 모양은 여기 없다 — 섹션 여덟 개가
    함께 쓰므로 `$lib/settings/settings.css` 한 자리에 있다 (그 파일 머리말).
  */
  .settings-view {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    /* 세로 스택(제목 · 본문 · 푸터). 본문만 늘어나고, 스크롤은 본문 안 패널이 맡는다 */
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: var(--space-4);
    /* 재질 글래스면 판은 독 상자(설정 모달)가 칠하고 여기는 비운다(`--glass-inner`). 평면은 모달 판과 같은 MD3 surfaceContainerLow */
    background: var(--glass-inner, var(--m3-surface-container-low));
  }

  /* 본문: 좌 내비 | 우 패널. 제목과 푸터 사이에서 남는 높이를 모두 차지한다 */
  .settings-body {
    display: flex;
    gap: var(--space-5);
    flex: 1 1 auto;
    min-height: 0; /* 자식(패널)이 넘칠 때 스크롤이 생기도록 */
  }

  /* 우측 내용 패널 — 활성 카테고리만 보이고, 넘치면 여기서만 스크롤한다.
     오른쪽 안쪽 여백은 스크롤 막대가 손잡이에 붙지 않게 하는 몫이다. */
  .settings-panel {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: 0 var(--space-2) var(--space-4) 0;
  }

  /* 내용 열 — 넓은 창에서도 줄이 640px 을 넘지 않는다. 이름과 손잡이가 화면 양 끝으로
     벌어지면 눈이 한 줄을 따라가지 못한다. */
  .settings-panel > section {
    max-width: 640px;
  }


  /* 숨긴 섹션이 확실히 이기게 한다 — display:flex/grid 섹션이 있어도 !important 로 눌린다.
     (비활성 카테고리를 언마운트하지 않고 hidden 으로만 숨겨 지역 상태를 지키는 것이 요점) */
  .settings-panel > section[hidden] {
    display: none !important;
  }

  /* 카테고리를 바꾸면 새 섹션이 살짝 떠오르며 나타난다 — `hidden` 이 풀려 display:none 에서 돌아올 때마다
     애니메이션이 다시 돈다. 끝나면 transform 이 남지 않아(채움 없음) 안의 fixed 팝오버 기준이 바뀌지 않는다.
     하위 화면(`SubViewStack`)의 가로 밀기와 같은 곡선 · 전환이 눈에 띄게 조금 길고 크게(사용자 요청 10-17) */
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

  /* 저장 실패 — 실패색의 옅은 판 (강조색 테두리가 아니다: 강조색은 [저장] 의 몫) */
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

  /*
    바깥 변경 안내 — `.error` 와 **결은 같고 톤만 낮춘** 한 줄이다. 판을 실패색이 아니라
    `--surface-hover` 로 두는 것이 그 차이의 전부다: 무언가 잘못된 것이 아니라 사용자가 고를
    것이 하나 생겼다는 뜻이라, 오류와 같은 세기로 소리치면 안 된다. 오른쪽 버튼은 보조 버튼
    (앱 안에서 "안내 한 줄 + 그 자리의 조치" 는 이 꼴이다).
  */
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
    flex: 0 0 auto; /* 푸터는 제자리 — 스크롤은 위의 패널이 맡는다 */
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line); /* 본문과 푸터 사이의 선 (예전엔 푸터 안내 줄이 그었다) */
  }

  /* MD3 알약 단추 — 모달 바닥의 [취소] · [저장]은 목업 크기(40px). 앱의 다른 `.btn` 은 밀도 그대로 28px */
  .actions > :global(.btn) {
    height: 40px;
    padding: 0 22px;
    font-size: var(--t-sm);
    font-weight: 500;
  }

  /* 하위 화면이 올린 바닥 줄 — 구분선 · 위 간격은 그 줄이 직접 긋는다(위험 강조면 선 색 · 면이 바뀌므로) */
</style>
