<script lang="ts">
  import { tick } from "svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { dockRunPulse } from "$lib/app/orch-pulse.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { placeFlyout, type RectLike } from "$lib/menu-flyout";
  import { iconRef } from "$lib/host-icons";
  import { aiIconName, shellIconName } from "$lib/pane-icons";
  import { shellColumn } from "$lib/launcher";
  import { gridColumn, launchLayout, type LaunchCell } from "$lib/dock-launch-layout";
  import { effectiveDefaultShellId, offeredAiClis, shellInfoLabel, shellLabel, type AiCli, type ShellInfo } from "$lib/session";
  import { noneInstalled } from "$lib/app/ai-none-notice";
  import { addLocal, detectedAiClis, knownAiClis, knownShellList, noteShellMenuAi, openAiPaneHere, openChatTileHere, refreshKnownAiClis } from "$lib/app/panes.svelte.js";
  import { chatTileCli, launchFormFor, type AiLaunchForm } from "$lib/ai-launch-pick";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { runAction } from "$lib/app/keys.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { shortcutTitle } from "$lib/status-items";
  import { settings } from "$lib/settings.svelte.js";
  import { keepAwakeOn, keepAwakeSupported, toggleKeepAwake } from "$lib/app/keep-awake.svelte.js";

  /**
   * 독의 실행 단추 — 항목은 전부 메뉴 통로(`runOnMenu` · `runAfterClose`)를 지난다: 스냅샷 → (메뉴와 독) 닫기 → 실행(docs/conventions.md).
   * 셸 메뉴에서 고른 셸은 그 한 번만 연다 — 설정의 기본 셸(`[shell] default`)은 건드리지 않는다.
   * 셸 메뉴 · 백드롭은 독 안의 DOM 이다 — 밖이면 독의 바깥 누르기 감지가 메뉴 줄을 누르는 순간 독을 접는다. 독이 쉬는 동안
   * `transform` 이 없고 흐림은 `::before` 에만 걸려(`theme.css`) 안쪽 `fixed` 의 기준은 창 그대로다.
   * 채팅 모양 실험 설정이 켜지면 Claude Code · Codex 칸의 누르기는 `[ai] launch_form` 모양 · 우클릭 = 두 모양 메뉴 — 꺼지면 예전 그대로다.
   */
  let {
    onclose,
  }: {
    /** 항목이 실행 전에 부른다(메뉴 통로) */
    onclose: () => void;
  } = $props();

  const LOGO_PX = 20;
  const ICON_PX = 22;

  /** `null` = 아직 감지가 안 왔다 */
  let shells = $state<ShellInfo[] | null>(null);
  let osDefaultId = $state<string | null>(null);
  /** `null` 인 동안 AI 칸을 세우지 않는다 — "설치" 칸이 번쩍이지 않게 */
  const clis = $derived(detectedAiClis());

  $effect(() => {
    let alive = true;
    void knownAiClis();
    void knownShellList().then((list) => {
      if (!alive) return;
      osDefaultId = list.default_id;
      shells = list.shells;
    });
    // 감지는 CLI 마다 `--version` 프로세스 하나라 깔리지 않은 CLI 가 있을 때만 · 30초에 한 번까지 다시 본다
    let lastCheck = 0;
    const recheck = () => {
      const now = detectedAiClis();
      if (now !== null && now.every((c) => c.installed)) return;
      if (Date.now() - lastCheck < 30_000) return;
      lastCheck = Date.now();
      void refreshKnownAiClis();
    };
    window.addEventListener("focus", recheck);
    return () => {
      alive = false;
      window.removeEventListener("focus", recheck);
    };
  });

  const defaultId = $derived(shells ? effectiveDefaultShellId(shells, settings.defaultShell, osDefaultId) : null);
  const defaultShell = $derived(shells?.find((s) => s.id === defaultId) ?? null);
  const defaultName = $derived(defaultShell ? shellInfoLabel(defaultShell, t) : shellLabel(undefined, t));
  const ordered = $derived(shells ? shellColumn(shells, defaultId, shells.length).shells : []);
  const aiItems = $derived(clis ? offeredAiClis(clis, settings.disabledAgents) : []);
  const noAiInstalled = $derived(clis !== null && noneInstalled(clis));

  const iconKeys = $derived(
    keepAwakeSupported()
      ? ["localfs", "keep-awake", "folder-conversations", "orchestration-start"]
      : ["localfs", "folder-conversations", "orchestration-start"],
  );
  const layout = $derived(launchLayout(noAiInstalled ? 1 : aiItems.length, iconKeys.length));
  const chatOn = $derived(settings.chatTile && !noAiInstalled);
  /** 이 칸이 채팅 모양으로도 열린다 — 아니면 우클릭 메뉴도 없다 */
  function chatCli(id: string): boolean {
    return chatOn && chatTileCli(id);
  }
  /** 목록에 없는 칸은 그리지 않으니 첫 자리로 둔다 */
  function iconAt(key: string): LaunchCell {
    return layout.icons[iconKeys.indexOf(key)] ?? { row: 1, col: 3, span: 1 };
  }
  const filesAt = $derived(iconAt("localfs"));
  const awakeAt = $derived(iconAt("keep-awake"));
  const convAt = $derived(iconAt("folder-conversations"));
  const orchAt = $derived(iconAt("orchestration-start"));

  type LaunchAi = Pick<AiCli, "command" | "id" | "name">;
  /** `keyed` 면 바깥 누르기로 닫아도 칸으로 포커스를 돌려준다 · `ai` 가 있으면 그 CLI 의 모양 메뉴, 없으면 셸 메뉴 */
  let menu = $state<{ x: number; y: number; keyed: boolean; ai: LaunchAi | null } | null>(null);
  /** 메뉴를 연 칸 — 닫으면 포커스가 돌아간다 */
  let menuFrom: HTMLElement | null = null;
  /** 붙은 직후는 `null` — 숨기지 않는다(숨기면 첫 줄 포커스가 빗나간다) */
  let menuPos = $state<{ left: number; top: number } | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  let tileEl = $state<HTMLButtonElement | null>(null);

  function tip(name: string, action: string): string {
    const combo = effectiveCombo(action, settings.current.keybindings);
    return shortcutTitle(name, combo ? displayCombo(combo) : null);
  }

  function close(): void {
    menu = null;
    onclose();
  }

  /** 독의 Escape 가 먼저 묻는다 — 한 겹씩 벗는다(메뉴 → 독) */
  export function collapse(focusTo = false): boolean {
    if (menu === null) return false;
    menu = null;
    const back = menuFrom ?? tileEl;
    if (focusTo) void tick().then(() => back?.focus());
    return true;
  }

  function openMenu(next: NonNullable<typeof menu>, from: HTMLElement | null): void {
    menu = next;
    menuFrom = from;
    menuPos = null;
    void tick().then(() => menuEl?.querySelector<HTMLElement>("button[role='menuitem']")?.focus({ preventScroll: true }));
  }

  /** `preventDefault` 했으니 창 전역 차단(`shouldBlockNativeContextMenu`)은 앱 메뉴로 친다 */
  function onTileContext(ev: MouseEvent, ai: LaunchAi | null = null): void {
    ev.preventDefault();
    openMenu({ x: ev.clientX, y: ev.clientY, keyed: false, ai }, ev.currentTarget as HTMLElement);
  }

  function onTileKey(ev: KeyboardEvent, ai: LaunchAi | null = null): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key !== "ContextMenu" && !(ev.key === "F10" && ev.shiftKey)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const from = ev.currentTarget as HTMLElement;
    const r = from.getBoundingClientRect();
    openMenu({ x: r.left + r.width / 2, y: r.top + r.height / 2, keyed: true, ai }, from);
  }

  $effect(() => {
    const node = menuEl;
    const m = menu;
    if (!node || !m) return;
    const win = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const at: RectLike = { left: m.x, right: m.x, top: m.y };
    menuPos = placeFlyout(at, at, size, win);
  });

  /** 창 크기가 바뀌면 잰 자리가 낡으니 닫는다 */
  $effect(() => {
    if (!menu) return;
    const onResize = () => collapse();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  function openDefault(): void {
    runAfterClose(close, () => runAction("new-shell"));
  }

  /** `null`(감지가 빈 기기)은 셸을 지정하지 않고 백엔드 폴백에 맡긴다 */
  function pickShell(shell: ShellInfo | null): void {
    runOnMenu(() => ({ shell }), close, (s) => void addLocal(s.shell ?? undefined));
  }

  function openAiSettings(): void {
    runOnMenu(() => true, close, () => openSettingsAt("ai"));
  }

  function openAiAs(c: { command: string; id: string }, form: AiLaunchForm): void {
    // 블록 넘기기의 "새로 열기" 기본값이 이것을 읽는다 (docs/log/2026-09-28-ask-ai-block.md)
    noteShellMenuAi(c.id);
    void (form === "chat" ? openChatTileHere(c) : openAiPaneHere(c));
  }

  /** 칸 누르기 = 기본 모양 */
  function pickAi(cli: LaunchAi): void {
    runOnMenu(() => ({ cli: { command: cli.command, id: cli.id }, form: launchFormFor(chatCli(cli.id), settings.aiLaunchForm) }), close, (x) =>
      openAiAs(x.cli, x.form),
    );
  }

  /** 모양 메뉴 항목 — CLI 는 메뉴 상태에서 스냅샷한다 */
  function pickAiForm(form: AiLaunchForm): void {
    runOnMenu(
      () => {
        const ai = menu?.ai;
        return ai ? { cli: { command: ai.command, id: ai.id }, form: chatCli(ai.id) ? form : "terminal" } : null;
      },
      close,
      (x) => openAiAs(x.cli, x.form),
    );
  }

  const menuAiDefault = $derived<AiLaunchForm>(menu?.ai ? launchFormFor(chatCli(menu.ai.id), settings.aiLaunchForm) : "terminal");
  const AI_FORMS: readonly AiLaunchForm[] = ["terminal", "chat"];

  function act(action: string): void {
    runAfterClose(close, () => runAction(action));
  }

  /** Escape 는 받지 않는다 — 독으로 올라가 독이 먼저 이 메뉴를 닫는다(`collapse`) */
  function onMenuKey(ev: KeyboardEvent): void {
    const node = menuEl;
    if (!node || !["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button[role='menuitem']"));
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const down = ev.key === "ArrowDown";
    const next =
      ev.key === "Home"
        ? 0
        : ev.key === "End"
          ? buttons.length - 1
          : at < 0
            ? down
              ? 0
              : buttons.length - 1
            : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus({ preventScroll: true });
  }

  function hover(ev: PointerEvent): void {
    const b = ev.currentTarget;
    if (b instanceof HTMLButtonElement && document.activeElement !== b) b.focus({ preventScroll: true });
  }

  const shellTip = $derived(tip(defaultName, "new-shell"));
  /** 메뉴를 여는 단추가 보이지 않으니 여는 길을 툴팁에 말로 남긴다 */
  const shellHint = $derived(t("app.dock.launch.otherShells"));
  const shellTitle = $derived(`${shellTip}\n${shellHint}`);
  const shellAria = $derived(`${shellTip} — ${shellHint}`);
  const convTip = $derived(tip(t("settings.keybinding.folder-conversations"), "folder-conversations"));
  const orchPulse = $derived(dockRunPulse());
  const orchTip = $derived(
    orchPulse.live > 0 ? `${t("orch.palette.board")} · ${t("orch.dock.live", { n: orchPulse.live })}` : t("orch.palette.board"),
  );
  const filesName = $derived(t("app.dock.launch.localfs"));
  const filesTip = $derived(tip(filesName, "open-localfs"));
  const awakeName = $derived(t("app.keepAwake.label"));
  const awakeTip = $derived(t(keepAwakeOn() ? "app.keepAwake.on" : "app.keepAwake.off"));
</script>

<div class="launch" role="group" aria-label={t("app.dock.launch.aria")} data-dock-launch>
  <button type="button" class="tile text" data-launch="shell" data-shell-id={defaultId ?? ""} title={shellTitle}
    aria-label={shellAria} bind:this={tileEl} onclick={openDefault} oncontextmenu={onTileContext} onkeydown={onTileKey}
    style:grid-row={layout.shell.row} style:grid-column={gridColumn(layout.shell)}>
    <span class="badge"><HostIcon icon={iconRef(shellIconName(defaultId))} size={LOGO_PX} mono /></span>
    <span class="lbl">{defaultName}</span>
  </button>

  <!-- 모르는 CLI 에는 지어낸 로고를 붙이지 않는다 -->
  {#each aiItems as cli, i (cli.id)}
    {@const logo = aiIconName(cli.id)}
    {@const at = layout.ais[i]}
    {@const chat = chatCli(cli.id)}
    <button type="button" class="tile text" data-launch="ai" data-ai-id={cli.id} title={cli.name} aria-label={cli.name}
      onclick={() => pickAi(cli)} oncontextmenu={chat ? (ev) => onTileContext(ev, cli) : undefined}
      onkeydown={chat ? (ev) => onTileKey(ev, cli) : undefined}
      style:grid-row={at?.row} style:grid-column={at ? gridColumn(at) : undefined}>
      <span class="badge">{#if logo}<AiGlyph name={logo} size={LOGO_PX} mono />{:else}<UiIcon name="ai" size={LOGO_PX} />{/if}</span>
      <span class="lbl">{cli.name}</span>
    </button>
  {/each}
  {#if noAiInstalled}
    {@const at = layout.ais[0]}
    <button type="button" class="tile text add" data-launch="ai-install" title={t("app.dock.launch.installAiTip")}
      onclick={openAiSettings} style:grid-row={at?.row} style:grid-column={at ? gridColumn(at) : undefined}>
      <span class="badge"><UiIcon name="plus" size={LOGO_PX} /></span>
      <span class="lbl">{t("app.dock.launch.installAi")}</span>
    </button>
  {/if}

  <button type="button" class="tile icon" data-launch="localfs" title={filesTip} aria-label={filesTip}
    onclick={() => act("open-localfs")} style:grid-row={filesAt.row} style:grid-column={gridColumn(filesAt)}>
    <span class="ico"><UiIcon name="folder-open" size={ICON_PX} filled /></span>
  </button>
  {#if keepAwakeSupported()}
    <!-- 토글은 독을 닫지 않는다 — 바뀐 상태를 그 자리에서 보게 -->
    <button type="button" class="tile icon" class:on={keepAwakeOn()} data-launch="keep-awake" title={awakeTip}
      aria-label={awakeName} aria-pressed={keepAwakeOn()} onclick={toggleKeepAwake}
      style:grid-row={awakeAt.row} style:grid-column={gridColumn(awakeAt)}>
      <span class="ico"><UiIcon name="away" size={ICON_PX} /></span>
    </button>
  {/if}
  <button type="button" class="tile icon" data-launch="folder-conversations" title={convTip} aria-label={convTip}
    onclick={() => act("folder-conversations")} style:grid-row={convAt.row} style:grid-column={gridColumn(convAt)}>
    <span class="ico"><UiIcon name="conversations" size={ICON_PX} /></span>
  </button>
  <!-- 칸 id 는 저장된 배치 때문에 `orchestration-start` 그대로 — 누르면 `orchestration-board` -->
  <button type="button" class="tile icon" data-launch="orchestration-start" title={orchTip} aria-label={orchTip}
    onclick={() => act("orchestration-board")} style:grid-row={orchAt.row} style:grid-column={gridColumn(orchAt)}>
    <!-- 로고는 헤드폰 그대로 — 상태로 바꾸지 않는다(사용자 결정). 상태는 개수 배지만 -->
    <span class="ico"><UiIcon name="orchestra" size={ICON_PX} /></span>
    {#if orchPulse.live > 0}
      <span class="orch-badge" class:attention={orchPulse.attention} data-orch-badge={orchPulse.live} aria-hidden="true">{orchPulse.live}</span>
    {/if}
  </button>
</div>

{#if menu}
  <!-- 닫기는 click 에서 — mousedown 에서 닫으면 그 아래 칸이 이어지는 click 을 받아 셸을 연다 -->
  <div class="launch-menu-backdrop" role="presentation" onclick={() => collapse(menu?.keyed)}
    oncontextmenu={(ev) => { ev.preventDefault(); collapse(menu?.keyed); }}></div>
  {#if menu.ai}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="launch-menu menu-surface menu-keyed" role="menu" tabindex="-1" aria-label={menu.ai.name} data-launch-menu="ai"
      data-ai-id={menu.ai.id} bind:this={menuEl} onkeydown={onMenuKey}
      style:left={(menuPos?.left ?? 0) + "px"} style:top={(menuPos?.top ?? 0) + "px"}>
      <p class="menu-title">{menu.ai.name}</p>
      {#each AI_FORMS as form (form)}
        <button type="button" class="menu-row row" role="menuitem" data-launch-form={form}
          data-default={form === menuAiDefault ? "" : undefined} onpointermove={hover} onclick={() => pickAiForm(form)}>
          <span class="name">{t(form === "chat" ? "app.ai.launch.chat" : "app.ai.launch.terminal")}</span>
          {#if form === menuAiDefault}<span class="menu-kbd">{t("app.shellmenu.default")}</span>{/if}
        </button>
      {/each}
    </div>
  {:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="launch-menu menu-surface menu-keyed" role="menu" tabindex="-1" aria-label={t("app.shellmenu.here")} data-launch-menu="shell"
    bind:this={menuEl} onkeydown={onMenuKey}
    style:left={(menuPos?.left ?? 0) + "px"} style:top={(menuPos?.top ?? 0) + "px"}>
    <p class="menu-title">{t("app.shellmenu.here")}</p>
    <div class="scroll">
      {#if ordered.length === 0}
        <button type="button" class="menu-row row" role="menuitem" onpointermove={hover} onclick={() => pickShell(null)}>
          <span class="menu-mark mark"><HostIcon icon={iconRef(shellIconName(null))} size={14} mono /></span>
          <span class="name">{shellLabel(undefined, t)}</span>
        </button>
      {/if}
      {#each ordered as shell (shell.id)}
        <button type="button" class="menu-row row" role="menuitem" data-shell-id={shell.id} onpointermove={hover}
          onclick={() => pickShell(shell)}>
          <span class="menu-mark mark"><HostIcon icon={iconRef(shellIconName(shell.id))} size={14} mono /></span>
          <span class="name">{shellInfoLabel(shell, t)}</span>
          {#if shell.id === defaultId}<span class="menu-kbd">{t("app.shellmenu.default")}</span>{/if}
        </button>
      {/each}
    </div>
  </div>
  {/if}
{/if}

<style>
  /* 단색 로고(`HostIcon mono`)의 안쪽 무늬 구멍은 `--mono-cut` 색으로 메운다 — 그 아래 판 색과 같아야 한다 */
  .launch {
    flex: 0 0 auto;
    padding: 0 var(--space-3) var(--space-3);
    display: grid;
    /* `dock-launch-layout.ts` 의 열 셈과 맞춘다 */
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 52px 52px;
    grid-auto-rows: 52px;
    gap: 6px;
  }

  .tile {
    --tile-face: var(--control-tile-bg);
    /* `.orch-badge` 가 기댄다 */
    position: relative;
    box-sizing: border-box;
    min-width: 0;
    height: 52px;
    display: flex;
    align-items: center;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-weight: 500;
    color: var(--fg-1);
    background: var(--tile-face);
    border: none;
    border-radius: 26px;
    box-shadow: var(--glass-ctl-edge, none);
    cursor: pointer;
    --mono-cut: var(--tile-face);
  }

  .tile:hover {
    --tile-face: var(--control-tile-bg-hover);
  }

  .tile:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .tile.text {
    gap: 10px;
    padding: 0 var(--space-3) 0 8px;
    text-align: start;
  }

  /* 판 위에 섞어 불투명하게 — 무늬 구멍이 같은 색으로 메워진다 */
  .badge {
    --badge-face: color-mix(in srgb, var(--accent) 16%, var(--tile-face));
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    line-height: 0;
    color: var(--accent);
    background: var(--badge-face);
    --mono-cut: var(--badge-face);
  }

  .tile.add {
    --tile-face: transparent;
    color: var(--accent);
    border: 1px dashed var(--line-strong);
    box-shadow: none;
  }
  .tile.add:hover {
    --tile-face: var(--control-tile-bg);
  }
  .tile.add .badge {
    --badge-face: transparent;
  }
  .lbl {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tile.icon {
    justify-content: center;
    padding: 0;
  }

  .ico {
    display: inline-flex;
    line-height: 0;
    color: var(--accent);
  }

  .tile.on {
    --tile-face: var(--control-on-bg);
    box-shadow: var(--glass-on-edge, none);
  }

  .tile.on:hover {
    --tile-face: var(--control-on-bg-hover);
  }

  .orch-badge {
    position: absolute;
    top: 2px;
    right: 2px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent, #fff);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    pointer-events: none;
  }
  .orch-badge.attention {
    background: var(--warn);
    color: #1b1300;
  }

  .tile.on .ico {
    color: var(--control-on-fg);
  }

  /* 즐겨찾기 칸 메뉴와 같은 겹. 긴 목록은 안쪽 `.scroll` 이 굴린다 — 바깥이 굴리면 글래스 흐림 층이 함께 굴러간다 */
  .launch-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
  }

  .launch-menu {
    position: fixed;
    z-index: 106;
    min-width: 200px;
    max-width: min(320px, calc(100vw - 16px));
    /* 글래스 판은 반투명이라 구멍만 불투명으로 남는다 — 14px 라 받아들인다 */
    --mono-cut: var(--surface-raised-solid);
  }

  .scroll {
    max-height: 40vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .mark {
    color: var(--accent);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
