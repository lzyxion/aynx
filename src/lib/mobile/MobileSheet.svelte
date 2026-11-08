<!--
  **폰의 "새 탭에 열기" 시트**(원격 웹 R5 · 10-20) — 위 띠 `+` · 고르기 화면의 `+ 새 탭` 이 연다(`app/mobile-sheets`). 아래에서 올라오는 판 +
  흐린 막. 막을 누르거나 Esc 를 누르거나 하나를 고르면 닫힌다 — 고르지 않고 닫으면 아무것도 만들지 않는다.

  - 머리: "새 탭에 열기" + 흐린 이름(새 탭이 설 워크스페이스 — 시트를 연 자리가 정한다).
  - **새 타일**: 4칸 격자 — 데스크톱 독 실행 단추와 같은 출처(기본 셸 · 켠 AI CLI 마다 · 로컬 파일 — `$lib/mobile/launch`).
  - **호스트**: 최근 몇 줄(접속 이력의 마지막 성공 · 그 별칭의 SSH 타일이 있으면 초록 점) + "호스트 · 프로젝트 · DB 전체 보기 ›"(둘러보기 화면).
  - **기타**: 지난 대화(이 폴더의 지난 대화 목록 — 고른 대화는 새 탭) · 사이드 채팅(폰 덮개 — 11-01) · 작업안(검토 대기 수 배지 — 있으면 그 타일로, 없으면 새 탭) ·
    오케스트레이션(독 실행 판의 같은 칸 — 지금 탭) · 잠자기 방지(스위치 — 지원하는 OS 만). 뒤의 둘은 10-25 독에서 옮겨 왔다(폰은 독을 열지 않는다).
  - 꼬리: [설정](폰 설정 화면). 알림은 상태줄 🔔 하나로만 들어간다(10-25 — 시트에서 전체 화면으로 갈아타는 길을 줄였다).

  고른 것은 언제나 **그것 하나뿐인 새 탭**이다(폰은 타일 하나만 그려서 분할로 끼우면 보이지 않는다) — 원격 창이 이미 하던 새 탭
  요청(`openInNewTab` → 집 PC 의 `newTab`) 그대로이고 새 길은 없다. 열 때 원격 창을 대상 워크스페이스로 옮긴다(`openInTarget`).
  닫은 뒤 포커스는 터미널에 주지 않는다(폰 화면 키보드가 튀어 오른다 — 위 띠가 제 단추로 돌려받는다).
-->
<script lang="ts">
  import { scrimOut, sheetOut } from "$lib/mobile/motion";
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { iconRef } from "$lib/host-icons";
  import { aiIconName, shellIconName } from "$lib/pane-icons";
  import { effectiveDefaultShellId, listPanes, offeredAiClis, shellInfoLabel, shellLabel, type AiCli, type ShellInfo } from "$lib/session";
  import { settings } from "$lib/settings.svelte.js";
  import { knownAiClis, knownShellList, openAiInNewTab, openLocalFsInNewTab, openShellInNewTab } from "$lib/app/panes.svelte.js";
  import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
  import { connectInNewTab, hostCache } from "$lib/app/hosts.svelte.js";
  import { hostHistory } from "$lib/app/host-history.svelte.js";
  import { historyOf, recentHosts } from "$lib/host-history";
  import { relativeTime } from "$lib/notifications";
  import { pendingCount } from "$lib/app/pending-plans.svelte.js";
  import { openPlans } from "$lib/app/plans.svelte.js";
  import { openFolderConversations } from "$lib/app/folder-conversations.svelte.js";
  import { mirrorWorkspaces } from "$lib/app/mirror.svelte.js";
  import {
    closeMobileOverlay,
    mobileSheetTarget,
    openInTarget,
    openMobileBrowse,
    openMobileChat,
    openMobileSettings,
  } from "$lib/app/mobile-sheets.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import { runAfterClose } from "$lib/browser/menu-runner";
  import { runAction } from "$lib/app/keys.svelte.js";
  import { keepAwakeOn, keepAwakeSupported, setKeepAwake } from "$lib/app/keep-awake.svelte.js";
  import { launchItems, openAliases, recentHostRows, type LaunchItem } from "$lib/mobile/launch";

  const LOGO_PX = 22;

  let shells = $state<ShellInfo[] | null>(null);
  let osDefaultId = $state<string | null>(null);
  let clis = $state<AiCli[]>([]);

  // 셸 · AI 감지는 독 실행 단추 · `Ctrl+Shift+N` 과 같은 캐시(두 번째부터는 곧장 온다)
  $effect(() => {
    let alive = true;
    void Promise.all([knownShellList(), knownAiClis()])
      .then(([list, ai]) => {
        if (!alive) return;
        osDefaultId = list.default_id;
        clis = ai;
        shells = list.shells;
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  });

  const defaultId = $derived(shells ? effectiveDefaultShellId(shells, settings.defaultShell, osDefaultId) : null);
  const defaultShell = $derived(shells?.find((s) => s.id === defaultId) ?? null);
  const items = $derived(
    launchItems({
      shellId: defaultId,
      shellName: defaultShell ? shellInfoLabel(defaultShell, t) : shellLabel(undefined, t),
      ai: offeredAiClis(clis, settings.disabledAgents),
      filesName: t("app.dock.launch.localfs"),
    }),
  );

  const targetName = $derived.by(() => {
    const id = mobileSheetTarget();
    return mirrorWorkspaces().find((w) => w.id === id)?.name || t("app.workspaces.default");
  });

  const now = Date.now();
  const open = $derived(openAliases(residentWindowTabs().flatMap((tab) => listPanes(tab.root))));
  const recent = $derived(
    recentHostRows(recentHosts(hostCache(), hostHistory()), (a) => historyOf(hostHistory(), a)?.last_ok_at ?? null, open),
  );
  const plans = $derived(pendingCount());

  function launch(item: LaunchItem) {
    openInTarget(() => {
      if (item.kind === "shell") return openShellInNewTab(item.shellId ?? undefined);
      if (item.kind === "ai") return openAiInNewTab({ command: item.command, id: item.id });
      openLocalFsInNewTab();
    });
  }

  function connect(name: string) {
    const host = hostCache().find((h) => h.name === name);
    if (host) openInTarget(() => connectInNewTab(host));
  }

  /** 지난 대화 — 대상 워크스페이스의 지금 타일 폴더 기준 목록(고른 대화는 새 탭) */
  function conversations() {
    openInTarget(() => openFolderConversations(undefined, { newTab: true }));
  }

  /**
   * 오케스트레이션 — 독 실행 판의 같은 칸과 한 몸통(`orchestration-board`: 오케스트레이션 탭 홈 — 2026-10-29. 원격 창은 집 PC 의 그 탭으로 가거나
   * 안내 한 줄). `openInTarget` 을 타지 않고, 시트를 먼저 닫는다(메뉴 통로).
   */
  function orchestration() {
    runAfterClose(closeMobileOverlay, () => runAction("orchestration-board"));
  }
  const orchTip = $derived(t("orch.palette.board"));

  let panel = $state<HTMLElement | null>(null);
  // 열리면 판에 포커스 — 단추가 아니라 판이라 화면 키보드가 뜨지 않고, Esc 가 이 판에서 받힌다
  $effect(() => {
    panel?.focus({ preventScroll: true });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMobileOverlay();
  }
</script>

<div class="scrim" aria-hidden="true" out:scrimOut|global onclick={closeMobileOverlay}></div>
<div
  class="sheet"
  out:sheetOut|global
  role="dialog"
  aria-modal="true"
  aria-labelledby="mobile-sheet-title"
  tabindex="-1"
  bind:this={panel}
  {onkeydown}
>
  <div class="grip" aria-hidden="true"></div>
  <header class="head">
    <h2 id="mobile-sheet-title" class="title">{t("app.mobile.sheet.title")}</h2>
    <span class="muted ws">{targetName}</span>
    <button type="button" class="round" title={t("app.mobile.picker.close")} aria-label={t("app.mobile.picker.close")} onclick={closeMobileOverlay}
      ><UiIcon name="close" size={18} /></button
    >
  </header>

  <div class="body">
    <section aria-labelledby="mobile-sheet-new">
      <h3 id="mobile-sheet-new" class="label">{t("app.mobile.sheet.newTile")}</h3>
      <div class="grid">
        {#each items as item (item.key)}
          {@const logo = item.kind === "ai" ? aiIconName(item.id) : null}
          <button type="button" class="tile" data-launch={item.kind} aria-label={t("app.mobile.sheet.openNew", { name: item.name })} onclick={() => launch(item)}>
            <span class="ico" aria-hidden="true">
              {#if item.kind === "shell"}
                <HostIcon icon={iconRef(shellIconName(item.shellId))} size={LOGO_PX} mono />
              {:else if item.kind === "ai"}
                {#if logo}<AiGlyph name={logo} size={LOGO_PX} mono />{:else}<UiIcon name="ai" size={24} />{/if}
              {:else}
                <UiIcon name="folder-open" size={24} filled />
              {/if}
            </span>
            <span class="lbl">{item.name}</span>
          </button>
        {/each}
      </div>
    </section>

    <section aria-labelledby="mobile-sheet-hosts">
      <h3 id="mobile-sheet-hosts" class="label">{t("app.mobile.sheet.hosts")}</h3>
      <div class="panel">
        {#each recent as row (row.name)}
          <button type="button" class="row" aria-label={t("app.mobile.sheet.connect", { name: row.name })} onclick={() => connect(row.name)}>
            <span class="row-ico" aria-hidden="true"><UiIcon name="server" size={18} /></span>
            <span class="row-name">{row.name}</span>
            {#if row.at !== null}<span class="row-sub">{relativeTime(row.at, now, t)}</span>{/if}
            {#if row.connected}<span class="dot" title={t("app.mobile.connected")} aria-label={t("app.mobile.connected")}></span>{/if}
          </button>
        {:else}
          <p class="none">{t("app.mobile.sheet.noRecent")}</p>
        {/each}
        <button type="button" class="row all" onclick={() => openMobileBrowse("hosts")}>
          <span class="row-name">{t("app.mobile.sheet.browseAll")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
      </div>
    </section>

    <section aria-labelledby="mobile-sheet-more">
      <h3 id="mobile-sheet-more" class="label">{t("app.mobile.sheet.more")}</h3>
      <div class="panel">
        <button type="button" class="row" onclick={conversations}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="conversations" size={18} /></span>
          <span class="row-name">{t("app.mobile.sheet.conversations")}</span>
        </button>
        <!-- 사이드 채팅 — 새 탭이 아니라 폰 사이드 채팅 덮개로 연다(2026-11-01 — 상태줄 말풍선과 같은 곳) -->
        <button type="button" class="row" data-sheet="side-chat" onclick={openMobileChat}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="chat" size={18} /></span>
          <span class="row-name">{t("app.mobile.sheet.chat")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
        <!-- 작업안 — 새 탭이 아니라 폰 작업안 덮개로 연다(2026-10-25 — 작업안은 타일이 아니다 · `app/plans.svelte.ts` 원격 갈래) -->
        <button type="button" class="row" data-sheet="plans" onclick={openPlans}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="list-checks" size={18} /></span>
          <span class="row-name">{t("app.mobile.sheet.plans")}</span>
          {#if plans > 0}<span class="badge" aria-label={t("app.mobile.sheet.plansPending", { n: plans })}>{plans}</span>{/if}
          <UiIcon name="chevron" size={16} />
        </button>
        <button type="button" class="row" data-sheet="orchestration-start" title={orchTip} aria-label={orchTip} onclick={orchestration}>
          <span class="row-ico" aria-hidden="true"><UiIcon name="orchestra" size={18} /></span>
          <span class="row-name">{t("app.dock.launch.orchestration")}</span>
          <UiIcon name="chevron" size={16} />
        </button>
        {#if keepAwakeSupported()}
          <!-- 잠자기 방지 — 독 실행 판의 ☕ 칸과 같은 값(메인 PC 의 잠자기 · `app/keep-awake`). 켜고 끄는 일이라 시트를 닫지 않는다 -->
          <!-- 줄 어디를 눌러도 스위치가 바뀐다(`<label for>` — 스위치 안의 진짜 체크박스가 받는다) -->
          <label class="row" for="sheet-keep-awake" data-sheet="keep-awake">
            <span class="row-ico" aria-hidden="true"><UiIcon name="away" size={18} /></span>
            <span class="row-name">{t("app.keepAwake.label")}</span>
            <Toggle id="sheet-keep-awake" checked={keepAwakeOn()} onchange={(on) => void setKeepAwake(on)} />
          </label>
        {/if}
      </div>
    </section>
  </div>

  <footer class="foot">
    <button type="button" class="pill" onclick={openMobileSettings}>
      <UiIcon name="settings" size={18} />
      {t("app.mobile.settings.title")}
    </button>
  </footer>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    height: var(--app-h, 100dvh);
    z-index: 90;
    background: color-mix(in srgb, #000 40%, transparent);
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    /* 화면 키보드 · 주소 줄을 뺀 높이의 바닥(`--app-h`)에 붙는다 */
    top: auto;
    bottom: calc(100dvh - var(--app-h, 100dvh));
    max-height: calc(var(--app-h, 100dvh) - 48px);
    /* 고르기 화면과 같은 층 — 확인 상자(114) · 가림막 · 모달(100) 아래 */
    z-index: 90;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-surface) var(--radius-surface) 0 0;
    background: var(--m3-surface-container-low, var(--m3-surface));
    color: var(--fg-1);
    outline: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (prefers-reduced-motion: no-preference) {
    .sheet {
      animation: sheet-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .scrim {
      animation: scrim-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes sheet-in {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }
  .grip {
    flex: 0 0 auto;
    width: 32px;
    height: 4px;
    margin: 10px auto 2px;
    border-radius: 999px;
    background: var(--fg-3);
    opacity: 0.5;
  }
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3) var(--space-2) var(--space-4);
  }
  .title {
    margin: 0;
    font-size: var(--t-lg);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
  }
  .muted {
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .ws {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .round {
    flex: 0 0 auto;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    cursor: pointer;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-2);
  }
  .label {
    margin: 0 0 var(--space-2) var(--space-2);
    color: var(--accent);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    letter-spacing: 0.02em;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-2);
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    height: 76px;
    padding: 6px 4px;
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    cursor: pointer;
  }
  .ico {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    color: var(--accent);
  }
  .lbl {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    border-radius: var(--radius-surface-inner);
    background: var(--m3-surface-container);
  }
  .row {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 52px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-surface-inner);
    background: transparent;
    color: var(--fg-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-ico {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--m3-surface-container-highest);
    color: var(--fg-2);
  }
  .row-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }
  .row-sub {
    flex: 0 0 auto;
    color: var(--fg-2);
    font-size: var(--t-xs);
  }
  .row.all .row-name {
    font-weight: var(--fw-regular);
    color: var(--fg-2);
  }
  .row.all {
    color: var(--fg-2);
  }
  .none {
    margin: 0;
    padding: var(--space-3);
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ok, #3fb950);
  }
  .badge {
    flex: 0 0 auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    line-height: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .foot {
    flex: 0 0 auto;
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-3);
  }
  .pill {
    flex: 1 1 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 48px;
    border: 0;
    border-radius: 999px;
    background: var(--m3-surface-container-high);
    color: var(--fg-1);
    font: inherit;
    font-size: var(--t-md);
    cursor: pointer;
  }
  .tile:focus-visible,
  .row:focus-visible,
  .round:focus-visible,
  .pill:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
