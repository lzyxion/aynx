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
  import { addLocal, detectedAiClis, knownAiClis, knownShellList, noteShellMenuAi, openAiPaneHere, refreshKnownAiClis } from "$lib/app/panes.svelte.js";
  import { openSettingsAt } from "$lib/app/overlays.svelte.js";
  import { runAction } from "$lib/app/keys.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { shortcutTitle } from "$lib/status-items";
  import { settings } from "$lib/settings.svelte.js";
  import { keepAwakeOn, keepAwakeSupported, toggleKeepAwake } from "$lib/app/keep-awake.svelte.js";

  /**
   * **독의 실행 단추** (2026-10-18 통합 독) — "이 탭에 연다" 의 칸들. 예전 상태바 `>_` 칸의 셸 메뉴(`ShellMenu.svelte` —
   * docs/log/2026-09-25-plus-vs-shell-menu.md) · 로컬 파일 칸 · 지난 대화 칸 · 오케스트레이션 칸이 하던 일을 이 격자가 한다.
   * 화면 잠금은 독 머리 아이콘 줄의 자물쇠 — `Dock.svelte`.
   *
   * **배치(2026-10-28 — 목업 `DQCMggdqxPkLAv6uSXXDA7` 판 E)**: 네 열 격자 `1fr 1fr 52px 52px`(틈 6px). 앞 두 열 = **글자 칸**
   * (높이 52px 알약 — 왼쪽 36px 원 배지에 로고, 그 옆 **이름만** — 설명 글자는 없다, 긴 말은 툴팁), 뒤 두 열 = **아이콘 칸**
   * (52px 원 — 보이는 글자 없음, 이름은 `title` · `aria-label`). 1줄 = 기본 셸(두 열) + 로컬 파일 · 잠자기 방지, 2줄 = AI 둘 +
   * 지난 대화 · 오케스트레이션. AI 수 · 아이콘 수가 달라도 같은 규칙(`dock-launch-layout.ts` 의 `launchLayout` — AI 는 2줄부터
   * 둘씩, 마지막 줄 외톨이는 두 열 · 아이콘은 1줄부터 둘씩 · 빈 자리는 빈다). 기본 셸 칸도 AI 칸과 같은 면이다(옛 primary 채움은
   * 걷었다 — 사용자 요청). 옛 두 줄(큰 칸 1줄 · 작은 칸 넷 2줄 — 2026-10-23)과 그 `data-launch-row` 묶음은 걷었다:
   *
   * - **기본 셸** — 이름 · 아이콘이 지금의 기본 셸(`effectiveDefaultShellId` — `Ctrl+Shift+N` · 설정 화면과 같은 규칙)을 따라간다.
   *   누르면 `new-shell` 과 같은 몸통(`runAction` → `openDefaultShell`). 칸 우클릭(· 메뉴 키 · `Shift+F10`) = 이 PC 의 셸
   *   전부 — 고른 것은 **그 한 번만 여는 일**이고 설정의 기본 셸(`[shell] default`)은 건드리지 않는다(셸 메뉴의 규칙 그대로 —
   *   기본을 정하는 자리는 설정 › 셸 하나뿐).
   * - **AI CLI** — `offeredAiClis`(설치된 것 · 설정에서 끈 것은 빠짐 · 감지가 비면 claude 한 줄 폴백)마다 한 칸(우클릭 메뉴 없음).
   *   하나면 두 열을 다 쓰고, 다 끄면 글자 칸은 셸 한 줄만 남는다(줄 수는 아이콘 칸이 정한다).
   * - **이 폴더의 지난 대화**(`folder-conversations`) · **오케스트레이션**(칸 id 는 저장된 배치 때문에 `orchestration-start` 그대로 —
   *   2026-10-29 부터 누르면 **오케스트레이션 탭 홈**(`orchestration-board` 동작 — `openOrchHome`)) — 단축키 · 팔레트와 같은 몸통
   *   (`runAction`). 아이콘 칸이라 툴팁 · 접근성 이름만 있다 — 긴 이름(팔레트 · 단축키 설정의 "이 폴더의 지난 대화 (조합)" · "오케스트레이션").
   * - **로컬 파일** — `open-localfs` 와 같은 몸통. 그림은 **열린 폴더**(프로젝트 칸의 닫힌 폴더와 갈린다).
   * - **잠자기 방지**(☕ — `away`, 메신저 알림 설정과 나눠 쓴다) — **토글**이다(`app/keep-awake` → Rust `keep_awake.rs`: 시스템만
   *   깨움 · 앱 시작 때 늘 꺼짐 · GUI 가 끝나면 풀림). 켜진 동안 on 면(`--control-on-*` 쌍) · `aria-pressed`.
   *   누르면 독을 **닫지 않는다** — 바뀐 상태를 그 자리에서 보게(닫을 것이 없으니 메뉴 통로의 스냅샷 → 닫기 순서와 부딪히지
   *   않는다). 이 OS 에 없으면(`supported: false`) 칸을 세우지 않는다 — 프런트는 OS 를 모른다.
   *
   * 셸 목록은 기본 셸 칸의 **우클릭 메뉴** 하나다(`.menu-surface` · `position: fixed` — 2026-10-23 인라인 펼침 · 구석 ▾ 를 걷고
   * 칸 우클릭 메뉴 하나로: 펼침은 아래 줄을 밀었고, ▾ 옆 팝오버는 사용자가 원치 않았다). 우클릭이면 포인터 자리, 키(메뉴 키 ·
   * `Shift+F10`)면 그 칸 위(칸 가운데를 포인터로 친다)에 선다 — 자리는 타일 ⋯ 옆목록과 같은 셈(`placeFlyout` — 오른쪽이
   * 넘치면 왼쪽으로, 아래가 넘치면 끌어올린다). 메뉴 · 백드롭은 독 **안**의 DOM 이다
   * (`DockFavorites` 와 같은 이유 — 독의 바깥 누르기 감지가 메뉴 줄을 누르는 순간 독을 접지 않게). 독은 쉬는 동안 `transform` 이
   * 없고 흐림도 `::before` 에만 걸려(`theme.css`) 안쪽 `fixed` 의 기준 상자가 창 그대로다 — 독의 `overflow: hidden` 에 잘리지 않는다.
   * 항목은 전부 메뉴 통로(`runOnMenu` · `runAfterClose`)를 지난다 — 스냅샷 → (메뉴와 독) 닫기 → 실행 (docs/conventions.md).
   * 독을 닫는 것은 연 것이 곧 새 타일 · 새 목록이라서다(런처는 "찾아서 열고 나오는" 층).
   */
  let {
    onclose,
  }: {
    /** 독을 닫는다 — 항목이 실행 **전에** 부른다(메뉴 통로) */
    onclose: () => void;
  } = $props();

  /** 글자 칸 배지(36px 원) 안의 로고 · 아이콘 한 변 — 단색 로고는 칠한 면이라 선 아이콘과 같은 크기로 둔다 */
  const LOGO_PX = 20;
  /** 아이콘 칸(52px 원)의 선 아이콘 */
  const ICON_PX = 22;

  /** 이 기기의 셸들 — `null` 은 아직 감지가 안 왔다는 뜻이다(그동안 기본 셸 칸은 이름 없는 셸로 선다) */
  let shells = $state<ShellInfo[] | null>(null);
  let osDefaultId = $state<string | null>(null);
  /** AI CLI 감지 — `null` 은 아직 안 왔다(그동안 AI 칸을 세우지 않는다 · "설치" 칸이 번쩍이지 않게) */
  /** 감지 값은 설정 › AI 에이전트와 한 벌 — 거기서 다시 본 값(CLI 를 지운 뒤 포함)이 여기에도 곧장 보인다 */
  const clis = $derived(detectedAiClis());

  /** 셸 목록 · AI 감지는 `Ctrl+Shift+N` · launcher 와 **같은 캐시**다 — 두 번째부터는 곧장 온다 */
  $effect(() => {
    let alive = true;
    void knownAiClis();
    void knownShellList().then((list) => {
      if (!alive) return;
      osDefaultId = list.default_id;
      shells = list.shells;
    });
    // 캐시는 앱이 켜질 때의 감지다 — 창으로 돌아올 때 다시 본다(앱을 켜 둔 채 CLI 를 깐 사람 — 2026-11-03). 독은 늘 붙어 있으므로
    // **깔리지 않은 CLI 가 있을 때만 · 30초에 한 번까지**(감지 = CLI 마다 `--version` 프로세스 하나 — 다 깔린 보통 사용자는 비용이 없다)
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
  /** 기본 셸이 맨 위, 나머지는 감지 순서 — 셸 메뉴 · launcher 의 셸 단과 같은 줄세움(상한만 없다) */
  const ordered = $derived(shells ? shellColumn(shells, defaultId, shells.length).shells : []);
  /**
   * AI 칸 = **설치된** CLI 가운데 설정에서 끄지 않은 것(`offeredAiClis` — 2026-11-03 사용자 결정 B안 · 깔지 않은 CLI 는 칸이 없다).
   * 하나도 깔리지 않았으면 그 자리에 "AI CLI 설치" 칸 하나(설정 › AI 에이전트).
   */
  const aiItems = $derived(clis ? offeredAiClis(clis, settings.disabledAgents) : []);
  const noAiInstalled = $derived(clis !== null && noneInstalled(clis));

  /** 아이콘 칸의 순서(2026-10-28 목업 E) — 잠자기 방지가 없는 OS 면 그 칸만 빠지고 뒤가 당겨진다 */
  const iconKeys = $derived(
    keepAwakeSupported()
      ? ["localfs", "keep-awake", "folder-conversations", "orchestration-start"]
      : ["localfs", "folder-conversations", "orchestration-start"],
  );
  const layout = $derived(launchLayout(noAiInstalled ? 1 : aiItems.length, iconKeys.length));
  /** 아이콘 칸 하나의 자리 — 목록에 없으면(그 칸을 세우지 않는다) 첫 자리로 둔다(그릴 일이 없다) */
  function iconAt(key: string): LaunchCell {
    return layout.icons[iconKeys.indexOf(key)] ?? { row: 1, col: 3, span: 1 };
  }
  const filesAt = $derived(iconAt("localfs"));
  const awakeAt = $derived(iconAt("keep-awake"));
  const convAt = $derived(iconAt("folder-conversations"));
  const orchAt = $derived(iconAt("orchestration-start"));

  /**
   * 떠 있는 셸 메뉴 — 연 자리(창 좌표 — 우클릭은 포인터, 키는 칸 가운데)와 키로 열었는가(`keyed` — 바깥 누르기로 닫아도 칸으로
   * 포커스를 돌려준다). 없으면 닫힘.
   */
  let menu = $state<{ x: number; y: number; keyed: boolean } | null>(null);
  /** 잰 자리 — 그린 뒤 크기를 재야 하므로 붙은 직후는 `null`(0,0 — 자리 effect 가 그리기 전에 곧장 채운다. 숨기면 첫 줄 포커스가 빗나간다) */
  let menuPos = $state<{ left: number; top: number } | null>(null);
  let menuEl = $state<HTMLElement | null>(null);
  let tileEl = $state<HTMLButtonElement | null>(null);

  /** 이 액션에 지금 걸린 조합이 붙은 툴팁 (없으면 이름만 — `shortcutTitle`) */
  function tip(name: string, action: string): string {
    const combo = effectiveCombo(action, settings.current.keybindings);
    return shortcutTitle(name, combo ? displayCombo(combo) : null);
  }

  /** 메뉴를 닫고 독을 닫는다 — 메뉴 통로의 "닫기" 자리 */
  function close(): void {
    menu = null;
    onclose();
  }

  /**
   * 메뉴를 닫는다 — 닫은 것이 있으면 `true`. 독의 Escape 가 **먼저** 묻는다(한 겹씩 벗는다 — 메뉴 → 독). 독이 닫힐 때도 부른다.
   * `focusTo` 면 포커스를 기본 셸 칸으로 되돌린다(Escape — 메뉴가 사라지면 포커스가 몸통으로 떨어진다. 우클릭으로 연 것도 칸으로).
   */
  export function collapse(focusTo = false): boolean {
    if (menu === null) return false;
    menu = null;
    if (focusTo) void tick().then(() => tileEl?.focus());
    return true;
  }

  /** 메뉴를 연다(이미 열려 있으면 자리만 옮긴다) — 뜨면 첫 줄로 포커스 */
  function openMenu(next: NonNullable<typeof menu>): void {
    menu = next;
    menuPos = null;
    void tick().then(() => menuEl?.querySelector<HTMLElement>("button[role='menuitem']")?.focus({ preventScroll: true }));
  }

  /** 기본 셸 칸 우클릭 — 포인터 자리. `preventDefault` 했으니 창 전역 차단(`shouldBlockNativeContextMenu`)은 앱 메뉴로 친다 */
  function onTileContext(ev: MouseEvent): void {
    ev.preventDefault();
    openMenu({ x: ev.clientX, y: ev.clientY, keyed: false });
  }

  /** 기본 셸 칸의 메뉴 키 · `Shift+F10` — 그 칸 위(가운데)에 연다(즐겨찾기 칸과 같은 키 · 우클릭과 같은 자리 셈) */
  function onTileKey(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key !== "ContextMenu" && !(ev.key === "F10" && ev.shiftKey)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    openMenu({ x: r.left + r.width / 2, y: r.top + r.height / 2, keyed: true });
  }

  /**
   * 자리 — 그린 뒤 실제 크기로 잰다. 연 자리를 폭 0 상자로 넘겨 `placeFlyout` 하나로 셈한다(오른쪽 우선 · 넘치면 왼쪽 ·
   * 세로는 창 안으로).
   */
  $effect(() => {
    const node = menuEl;
    const m = menu;
    if (!node || !m) return;
    const win = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: node.offsetWidth, height: node.offsetHeight };
    const at: RectLike = { left: m.x, right: m.x, top: m.y };
    menuPos = placeFlyout(at, at, size, win);
  });

  /** 창 크기가 바뀌면 닫는다 — 잰 자리가 낡는다(파일 타일 도구줄 메뉴와 같은 규칙) */
  $effect(() => {
    if (!menu) return;
    const onResize = () => collapse();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  function openDefault(): void {
    runAfterClose(close, () => runAction("new-shell"));
  }

  /** 셸 한 줄 — 이 탭에 한 번만 연다. `null`(감지가 빈 기기)은 셸을 지정하지 않고 열어 백엔드 폴백에 맡긴다 */
  function pickShell(shell: ShellInfo | null): void {
    runOnMenu(() => ({ shell }), close, (s) => void addLocal(s.shell ?? undefined));
  }

  /** "AI CLI 설치" 칸 — 설정 › AI 에이전트(설치 여부 · 안내가 있는 곳) */
  function openAiSettings(): void {
    runOnMenu(() => true, close, () => openSettingsAt("ai"));
  }

  function pickAi(cli: { command: string; id: string }): void {
    runOnMenu(() => cli, close, (c) => {
      // 블록 넘기기의 "새로 열기" 기본값이 이것을 읽는다 (docs/log/2026-09-28-ask-ai-block.md)
      noteShellMenuAi(c.id);
      void openAiPaneHere(c);
    });
  }

  /** 단축키 · 팔레트와 **같은 몸통**(`runAction`) — 띠에서 연 것과 키로 연 것의 규칙이 갈리지 않는다 */
  function act(action: string): void {
    runAfterClose(close, () => runAction(action));
  }

  /** 메뉴 줄 — ↑↓·Home/End 로 돈다(Escape 는 받지 않는다 — 독으로 올라가 독이 먼저 이 메뉴를 닫는다 — `collapse`) */
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

  /** 포인터가 올라간 줄로 포커스 — 골라진 줄과 손이 가리키는 줄이 하나로 선다(셸 메뉴와 같은 규칙) */
  function hover(ev: PointerEvent): void {
    const b = ev.currentTarget;
    if (b instanceof HTMLButtonElement && document.activeElement !== b) b.focus({ preventScroll: true });
  }

  const shellTip = $derived(tip(defaultName, "new-shell"));
  /** 기본 셸 칸의 말 — 이름(+ 조합) 아래에 "우클릭: 다른 셸"(구석 ▾ 를 걷어 메뉴가 보이지 않는다 — 여는 길을 말로 남긴다) */
  const shellHint = $derived(t("app.dock.launch.otherShells"));
  const shellTitle = $derived(`${shellTip}\n${shellHint}`);
  const shellAria = $derived(`${shellTip} — ${shellHint}`);
  /** 지난 대화 칸 — 툴팁 · 접근성 이름은 단축키 설정 · 팔레트의 긴 이름 + 지금 걸린 조합(아이콘 칸이라 보이는 글자는 없다) */
  const convTip = $derived(tip(t("settings.keybinding.folder-conversations"), "folder-conversations"));
  /** 오케스트레이션 칸 — 오케스트레이션 탭 홈(2026-10-29). 팔레트 전용 id 라 조합이 없다 */
  /** (⑤) 오케스트레이션 칸의 배지 — 앨범 목록 요약에서(`orch-pulse` · 로고는 늘 헤드폰) */
  const orchPulse = $derived(dockRunPulse());
  const orchTip = $derived(
    orchPulse.live > 0 ? `${t("orch.palette.board")} · ${t("orch.dock.live", { n: orchPulse.live })}` : t("orch.palette.board"),
  );
  const filesName = $derived(t("app.dock.launch.localfs"));
  const filesTip = $derived(tip(filesName, "open-localfs"));
  /** 잠자기 방지 칸 — 접근성 이름은 이름, 툴팁은 지금 상태("잠자기 방지 켜짐/꺼짐"). 켜짐은 `aria-pressed` 도 말한다 */
  const awakeName = $derived(t("app.keepAwake.label"));
  const awakeTip = $derived(t(keepAwakeOn() ? "app.keepAwake.on" : "app.keepAwake.off"));
</script>

<div class="launch" role="group" aria-label={t("app.dock.launch.aria")} data-dock-launch>
  <!-- 글자 칸 — 기본 셸(우클릭 = 이 PC 의 셸 전부 — 떠 있는 메뉴, 1줄 두 열) · AI CLI 마다 한 칸(2줄부터 둘씩). 자리는 `launchLayout` -->
  <button type="button" class="tile text" data-launch="shell" data-shell-id={defaultId ?? ""} title={shellTitle}
    aria-label={shellAria} bind:this={tileEl} onclick={openDefault} oncontextmenu={onTileContext} onkeydown={onTileKey}
    style:grid-row={layout.shell.row} style:grid-column={gridColumn(layout.shell)}>
    <span class="badge"><HostIcon icon={iconRef(shellIconName(defaultId))} size={LOGO_PX} mono /></span>
    <span class="lbl">{defaultName}</span>
  </button>

  <!-- AI CLI 마다 한 칸 — 모르는 CLI 는 아이콘 없이(지어낸 로고를 붙이지 않는다). 우클릭 메뉴는 없다(지난 대화 · 오케스트레이션은 제 아이콘 칸) -->
  {#each aiItems as cli, i (cli.id)}
    {@const logo = aiIconName(cli.id)}
    {@const at = layout.ais[i]}
    <button type="button" class="tile text" data-launch="ai" data-ai-id={cli.id} title={cli.name} aria-label={cli.name}
      onclick={() => pickAi(cli)} style:grid-row={at?.row} style:grid-column={at ? gridColumn(at) : undefined}>
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

  <!--
    아이콘 칸(52px 원 — 이름은 툴팁 · 접근성 이름만): 로컬 파일(열린 폴더 — 꽉 찬 그림) · 잠자기 방지(☕ 토글 — 독을 닫지 않는다) ·
    지난 대화(옛 상태바 `folder-conversations` 칸과 같은 몸통) · 오케스트레이션(칸 id `orchestration-start` — 누르면 오케스트레이션 탭 홈).
  -->
  <button type="button" class="tile icon" data-launch="localfs" title={filesTip} aria-label={filesTip}
    onclick={() => act("open-localfs")} style:grid-row={filesAt.row} style:grid-column={gridColumn(filesAt)}>
    <span class="ico"><UiIcon name="folder-open" size={ICON_PX} filled /></span>
  </button>
  {#if keepAwakeSupported()}
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
  <button type="button" class="tile icon" data-launch="orchestration-start" title={orchTip} aria-label={orchTip}
    onclick={() => act("orchestration-board")} style:grid-row={orchAt.row} style:grid-column={gridColumn(orchAt)}>
    <!-- 로고 = 헤드폰 — 상태로 바꾸지 않는다(2026-10-31 사용자 결정 · 목업 V3DockLogo). 상태는 개수 배지만(산 앨범 수 · 사람 필요 또는 조율 멈춤이면 호박 · `orch-pulse`) -->
    <span class="ico"><UiIcon name="orchestra" size={ICON_PX} /></span>
    {#if orchPulse.live > 0}
      <span class="orch-badge" class:attention={orchPulse.attention} data-orch-badge={orchPulse.live} aria-hidden="true">{orchPulse.live}</span>
    {/if}
  </button>
</div>

{#if menu}
  <!--
    셸 메뉴 — 우클릭 자리(키면 칸 위)에 떠 있다. 백드롭이 바깥 누르기 · 우클릭을 받아 메뉴만 닫는다(독은 그대로 — 둘 다 독 안의
    DOM · 키로 열었으면 칸으로 포커스). Escape 는 독이 받는다(`collapse(true)` — 메뉴만 닫고 칸으로 포커스).
  -->
  <!-- 닫기는 click 에서 — mousedown 에서 닫으면 그 아래 칸이 이어지는 click 을 받아 셸을 연다 -->
  <div class="launch-menu-backdrop" role="presentation" onclick={() => collapse(menu?.keyed)}
    oncontextmenu={(ev) => { ev.preventDefault(); collapse(menu?.keyed); }}></div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="launch-menu menu-surface menu-keyed" role="menu" tabindex="-1" aria-label={t("app.shellmenu.here")} data-launch-menu="shell"
    bind:this={menuEl} onkeydown={onMenuKey}
    style:left={(menuPos?.left ?? 0) + "px"} style:top={(menuPos?.top ?? 0) + "px"}>
    <p class="menu-title">{t("app.shellmenu.here")}</p>
    <div class="scroll">
      {#if ordered.length === 0}
        <!-- 감지가 비었다 — 셸을 지정하지 않는 한 줄로 남긴다(단축키와 같은 폴백) -->
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

<style>
  /*
   * MD3 실행 타일(2026-10-28 — 목업 `DQCMggdqxPkLAv6uSXXDA7` 판 E): 판 surfaceContainerHigh(`--control-tile-bg`) · 알약 / 원(모서리 26px —
   * 높이 52px 의 반) · 글자 onSurface. 기본 셸 칸도 AI 칸과 **같은 면**이다(옛 primary 채움 `.tile.primary` 는 걷었다 — 사용자 요청).
   * 글자 칸의 로고는 왼쪽 36px 원 배지(옅은 강조색 판 · 그림 primary), 아이콘 칸은 그림만 가운데. 셸 · AI 로고는 단색 실루엣
   * (`HostIcon mono` — 칠 = 아이콘 색, 안쪽 무늬 구멍 = 그 아래 판 색 `--mono-cut`). 호버는 MD3 상태 층.
   */
  .launch {
    flex: 0 0 auto;
    padding: 0 var(--space-3) var(--space-3);
    display: grid;
    /* 글자 칸 둘 · 아이콘 칸 둘 — 자리(줄 · 열)는 칸마다 인라인으로(`launchLayout`) */
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 52px 52px;
    grid-auto-rows: 52px;
    gap: 6px;
  }

  .tile {
    /* 판 색 — 배지 판과 무늬 구멍이 이 위에 섞인다(호버면 호버 판) */
    --tile-face: var(--control-tile-bg);
    /* 오케스트레이션 칸의 개수 배지(`.orch-badge`)가 기댄다 */
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
    /* 글래스면 흰 고리 + 빛 선(theme.css 재질 절의 부품 가장자리) — 평면은 없음 */
    box-shadow: var(--glass-ctl-edge, none);
    cursor: pointer;
    --mono-cut: var(--tile-face);
  }

  .tile:hover {
    --tile-face: var(--control-tile-bg-hover);
  }

  /* 포커스 링은 중성 그대로 — 칸 밖(틈 6px 안)에 둔다. 모양(알약 · 원)을 따라 둥글다 */
  .tile:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* 글자 칸 — 배지 · 이름 한 줄(좁은 독이면 말줄임 — 온전한 이름은 툴팁) */
  .tile.text {
    gap: 10px;
    padding: 0 var(--space-3) 0 8px;
    text-align: start;
  }

  /* 배지 — 36px 원, 옅은 강조색 판(판 위에 섞어 불투명하게 — 단색 로고의 무늬 구멍이 같은 색으로 메워진다) · 그림 primary */
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

  /* "AI CLI 설치" 칸 — 판 없이 점선 테두리(아직 없는 자리 · 2026-11-03 목업 B안) */
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

  /* 아이콘 칸 — 52px 원, 그림만 가운데(이름은 툴팁 · 접근성 이름) */
  .tile.icon {
    justify-content: center;
    padding: 0;
  }

  .ico {
    display: inline-flex;
    line-height: 0;
    color: var(--accent);
  }

  /* 켜진 토글(잠자기 방지) — on 면(primary 채움 + onPrimary 그림) */
  .tile.on {
    --tile-face: var(--control-on-bg);
    box-shadow: var(--glass-on-edge, none);
  }

  .tile.on:hover {
    --tile-face: var(--control-on-bg-hover);
  }

  /* (⑤) 산 앨범 수 배지 — 칸 오른쪽 위(목업 V3DockLogo). 사람이 필요하거나 조율이 멈춘 앨범이 있으면 호박 */
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

  /*
   * 셸 메뉴 — 전역 메뉴 한 벌(`.menu-surface` · `.menu-row` · `.menu-title` · `.menu-mark` · `.menu-kbd`). 자리 · 쌓임 · 폭만 여기 —
   * 즐겨찾기 칸 메뉴와 같은 겹(독 안 · 백드롭 105 · 메뉴 106). 긴 목록은 **안쪽 상자가 굴린다**(바깥이 굴리면 글래스 흐림 층이
   * 함께 굴러간다 — `theme.css` 의 `.md3-scroll` 주석).
   */
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
    /* 단색 로고의 무늬 구멍 = 메뉴 판의 불투명 색(글래스 판은 반투명이라 구멍만 불투명으로 남는다 — 14px 라 받아들인다) */
    --mono-cut: var(--surface-raised-solid);
  }

  .scroll {
    max-height: 40vh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* 줄 = 셸 로고 · 이름 · (기본) 꼬리표 — 플렉스라야 꼬리표(`.menu-kbd`)가 끝으로 밀린다. 칠은 `.menu-keyed` 가 포커스 하나에만 */
  .row {
    display: flex;
    align-items: center;
  }

  /* 줄의 셸 로고 — 칸과 같은 단색 실루엣(primary) */
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
