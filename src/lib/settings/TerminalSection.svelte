<script lang="ts">
  import {
    TERM_PRESETS,
    termPresetGroups,
    termThemeOf,
    DYNAMIC_DARK_TERM_KEY,
    DYNAMIC_FIXED_TERM_LABEL,
    DYNAMIC_LIGHT_TERM_KEY,
    userTermKey,
    isUserTermKey,
    userTermId,
  } from "$lib/theme";
  import { openTermThemeImport, openTermThemeManage } from "$lib/app/term-themes.svelte.js";
  import {
    settings,
    applySettings,
    setTermPreset,
    setTermFontFamily,
    setTermFontSize,
    setWebgl,
    setLigatures,
    setRightClick,
    setConfirmMultilinePaste,
    setOsc52Clipboard,
    setInlineImages,
    setInlineSnippets,
    setLocalShellIntegration,
    setCursorStyle,
    setDefaultShell,
    setMarkAfterSecs,
    setBell,
    RIGHT_CLICK_MODES,
    CURSOR_STYLES,
    BELL_MODES,
    DEFAULT_FONT_FAMILY,
    DEFAULT_FONT_SIZE,
    DEFAULT_MARK_AFTER_SECS,
    FONT_SIZE_MIN,
    FONT_SIZE_MAX,
    NOTIFY_AFTER_MAX_SECS,
  } from "$lib/settings.svelte.js";
  import { effectiveDefaultShellId, listShells, shellInfoLabel, shellLabel, type ShellInfo } from "$lib/session";
  import { shellIconName } from "$lib/pane-icons";
  import { iconRef } from "$lib/host-icons";
  import Dropdown from "$lib/Dropdown.svelte";
  import { logsDir, openLogsFolder } from "$lib/session-logs";
  import { isRemote } from "$lib/ipc";
  import { toast } from "$lib/toast.svelte.js";
  import { optionEntries, t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import { comboText } from "$lib/settings/combo";
  import TermPreview from "$lib/settings/TermPreview.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";
  import HeaderChipsSetting from "$lib/settings/HeaderChipsSetting.svelte";

  /**
   * 기본 셸 · 로컬 셸 통합은 백엔드가 argv 를 정해 다음에 여는 셸부터 듣는다(나머지는 열린 탭에도 즉시).
   * 셸 목록은 이 섹션이 처음 열릴 때만 읽는다 — `listShells()` 는 WSL 배포판을 훑고 프로세스를 띄워 비싸다.
   */
  let { active = false }: { active?: boolean } = $props();

  const PRESET_GROUPS = termPresetGroups();
  const RIGHT_CLICK_ENTRIES = optionEntries(RIGHT_CLICK_MODES);
  const CURSOR_STYLE_ENTRIES = optionEntries(CURSOR_STYLES);
  const BELL_ENTRIES = optionEntries(BELL_MODES);

  const CURSOR_STYLE_ICONS: ChoiceIcons = {
    block: "cursor-block",
    underline: "cursor-underline",
    bar: "cursor-bar",
  };
  const RIGHT_CLICK_ICONS: ChoiceIcons = { menu: "menu", paste: "paste" };
  const BELL_ICONS: ChoiceIcons = { visual: "bell-visual", "visual+sound": "bell-sound", off: "bell-off" };

  const presetDots = $derived.by((): { bg: string | undefined; dots: string[] } => {
    const th = termThemeOf(settings.presetKey, settings.dynamicTerm, settings.userTermLookup, settings.dynamicFixedTerms);
    return {
      bg: th.background,
      dots: [th.foreground, th.red, th.green, th.blue].filter((c): c is string => typeof c === "string"),
    };
  });

  function resetFont() {
    setTermFontFamily("");
    setTermFontSize(undefined);
    applySettings();
  }

  // ── 기본 셸 ──

  let shells = $state<ShellInfo[]>([]);
  /** OS 초기 기본 셸 id (Rust `pty::os_default_shell_id` 가 고른다) */
  let osDefaultId = $state<string | null>(null);
  let shellsLoaded = $state(false);

  $effect(() => {
    if (!active || shellsLoaded) return;
    shellsLoaded = true;
    void listShells().then((list) => {
      shells = list.shells;
      osDefaultId = list.default_id;
    });
  });

  /**
   * "시스템 기본" 항목은 두지 않는다 — Windows 에는 OS 가 정한 셸이 없어 무엇을 여는지 알 수 없다.
   * 저장된 id 가 목록에 없어도 설정값은 그대로 둔다(지운 WSL 배포판을 다시 깔면 돌아와야 한다) — 저장은 `pickShell` 이 부를 때만.
   */
  const effectiveId = $derived(effectiveDefaultShellId(shells, settings.defaultShell, osDefaultId));

  const shellMissing = $derived(
    shellsLoaded &&
      shells.length > 0 &&
      !!settings.defaultShell &&
      settings.defaultShell !== effectiveId,
  );

  /** 백엔드가 구운 `label` 을 쓰면 언어를 바꿔도 옛 이름이 남는다 — 목록은 처음 한 번만 읽는다 */
  const effectiveLabel = $derived.by(() => {
    const found = shells.find((s) => s.id === effectiveId);
    return found ? shellInfoLabel(found, t) : shellLabel(effectiveId ?? undefined, t);
  });

  const shellOptions = $derived(
    shells.map((s) => ({ value: s.id, label: shellInfoLabel(s, t), icon: iconRef(shellIconName(s.id)) })),
  );

  function pickShell(id: string) {
    setDefaultShell(id);
  }

  // ── 세션 로그 폴더 ──
  // 실패는 콘솔로만 삼킨다 — 버튼을 누르면 `openFolder` 가 같은 실패를 만나 토스트로 말한다.
  let logsFolder = $state<string | null>(null);

  $effect(() => {
    if (!active || logsFolder !== null) return;
    void logsDir()
      .then((dir) => {
        logsFolder = dir;
      })
      .catch((e: unknown) => {
        console.error("[aynx] 로그 폴더 경로를 받지 못했습니다", e);
      });
  });

  async function openFolder(): Promise<void> {
    const failure = await openLogsFolder();
    if (failure !== null) toast.error(failure);
  }
</script>

<TermPreview
  theme={settings.termTheme}
  fontFamily={settings.fontFamilyEffective}
  fontSize={settings.termFontSize}
  cursorStyle={settings.cursorStyle}
/>

<div class="rows term">
  <div class="srow">
    <TipName
      id="default-shell"
      for="default-shell"
      label={t("settings.terminal.shell.label")}
      tip={tipOf(
        t("settings.terminal.shell.summary.before") + ">_" + t("settings.terminal.shell.summary.after"),
        comboText("new-shell", settings.keybindings) + t("settings.terminal.shell.note"),
      )}
    />
    <!-- `id="default-shell"` 이 이름의 `<label for>` 과 설정 색인 anchor 를 함께 받는다 -->
    <div class="shell-pick">
      <Dropdown
        id="default-shell"
        value={effectiveId ?? ""}
        options={shellOptions}
        labelledby="default-shell-label"
        onchange={pickShell}
      />
    </div>

    <!-- 지금의 상태라 툴팁에 숨기지 않는다 — 숨기면 왜 다른 셸이 열리는지 알 수 없다 -->
    {#if shellMissing}
      <p class="footnote" role="status">
        {t("settings.terminal.shell.missing.before")}<code>{settings.defaultShell}</code>{t(
          "settings.terminal.shell.missing.after",
          { shell: effectiveLabel },
        )}. {t("settings.terminal.shell.missing.note")}
      </p>
    {/if}
  </div>

  <div class="srow">
    <TipName
      id="term-preset"
      for="term-preset"
      label={t("settings.terminal.theme.label")}
      tip={t("settings.terminal.theme.summary")}
    />
    <div class="size-row">
      <span class="preset-swatch" style:background={presetDots.bg} aria-hidden="true">
        {#each presetDots.dots as color, i (i)}<i style:background={color}></i>{/each}
      </span>
      <span class="preset-pick"><Dropdown
        id="term-preset"
        value={settings.presetKey}
        options={[
          ...PRESET_GROUPS.dark.map((key) => ({
            value: key,
            label: t(TERM_PRESETS[key].labelKey),
            group: t("settings.terminal.theme.group.dark"),
          })),
          ...PRESET_GROUPS.light.map((key) => ({
            value: key,
            label: t(TERM_PRESETS[key].labelKey),
            group: t("settings.terminal.theme.group.light"),
          })),
          // 내 테마(가져온 색 구성 — `<설정 루트>/terminal-themes/`)는 다크 · 라이트 다음 묶음. 모드를 바꿔도 갈아 끼우지 않는다.
          ...settings.userTermThemes.map((u) => ({
            value: userTermKey(u.id),
            label: u.name,
            group: t("settings.terminal.theme.group.user"),
          })),
          // 고른 내 테마의 파일이 없으면(지웠거나 다른 PC 의 설정) 빈 손잡이 대신 그 사실을 한 줄로 — 그리는 것은 같은 모드의 Aynx
          ...(isUserTermKey(settings.presetKey) && !settings.userTermLookup.themes[userTermId(settings.presetKey)]
            ? [{
                value: settings.presetKey,
                label: t("settings.terminal.theme.userMissing"),
                group: t("settings.terminal.theme.group.user"),
              }]
            : []),
          // 같은 색 테마의 고정 밝기 둘(`dynamic-dark` · `dynamic-light`) — 앱 밝기를 바꿔도 그대로. 풀 수 있는 쪽만
          // (뽑아낸 팔레트가 있을 때만 — 앱 테마 칸에서 켠다). 앱 밝기를 따르는 칸은 두지 않는다(2026-11-08).
          ...(settings.dynamicFixedTerms.dark
            ? [{ value: DYNAMIC_DARK_TERM_KEY as string, label: t(DYNAMIC_FIXED_TERM_LABEL.dark) }]
            : []),
          ...(settings.dynamicFixedTerms.light
            ? [{ value: DYNAMIC_LIGHT_TERM_KEY as string, label: t(DYNAMIC_FIXED_TERM_LABEL.light) }]
            : []),
        ]}
        onchange={(v) => setTermPreset(v)}
      /></span>
      <button
        type="button"
        class="btn btn-sm btn-ghost icon"
        onclick={openTermThemeImport}
        title={t("settings.terminal.import.open")}
        aria-label={t("settings.terminal.import.open")}
      >
        <UiIcon name="file-down" size={13} />
      </button>
      {#if settings.userTermThemes.length}
        <button
          type="button"
          class="btn btn-sm btn-ghost icon"
          onclick={openTermThemeManage}
          title={t("settings.terminal.import.manage")}
          aria-label={t("settings.terminal.import.manage")}
        >
          <UiIcon name="edit" size={13} />
        </button>
      {/if}
    </div>
  </div>

  <div class="srow">
    <label class="name" for="term-font">{t("settings.terminal.font.label")}</label>
    <input
      id="term-font"
      class="value"
      value={settings.current.terminal.font_family ?? ""}
      placeholder={DEFAULT_FONT_FAMILY}
      autocomplete="off"
      spellcheck="false"
      oninput={(e) => setTermFontFamily(e.currentTarget.value)}
    />
  </div>

  <div class="srow">
    <label class="name" for="term-size">{t("settings.terminal.size.label")}</label>
    <div class="size-row">
      <input
        id="term-size"
        class="value size"
        type="number"
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        value={settings.current.terminal.font_size ?? ""}
        placeholder={String(DEFAULT_FONT_SIZE)}
        oninput={(e) => setTermFontSize(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{FONT_SIZE_MIN}–{FONT_SIZE_MAX} px</span>
      <button
        type="button"
        class="btn btn-sm btn-ghost icon"
        disabled={!settings.current.terminal.font_family && !settings.current.terminal.font_size}
        onclick={resetFont}
        title={t("settings.terminal.font.reset")}
        aria-label={t("settings.terminal.font.reset")}
      >
        <UiIcon name="reset" size={13} />
      </button>
    </div>
  </div>

  <!-- 값은 `[app]` 층이지만 사람이 찾는 자리는 "터미널" 이다 -->
  <HeaderChipsSetting id="header-chips" />

  <div class="srow">
    <TipName id="cursor-style" label={t("settings.terminal.cursor.label")} tip={t("settings.terminal.cursor.summary")} />
    <ChoiceChips
      id="cursor-style"
      labelledby="cursor-style-label"
      entries={CURSOR_STYLE_ENTRIES}
      icons={CURSOR_STYLE_ICONS}
      value={settings.cursorStyle}
      onpick={setCursorStyle}
    />
  </div>

  <div class="srow">
    <TipName
      id="term-webgl"
      for="term-webgl"
      label={t("settings.terminal.webgl.label")}
      tip={tipOf(t("settings.terminal.webgl.summary"), t("settings.terminal.webgl.note"))}
    />
    <div class="size-row">
      <Toggle id="term-webgl" checked={settings.webgl} onchange={setWebgl} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="term-ligatures"
      for="term-ligatures"
      label={t("settings.terminal.ligatures.label")}
      tip={tipOf(
        t("settings.terminal.ligatures.summary.before") + "-> => !=" + t("settings.terminal.ligatures.summary.after"),
        t("settings.terminal.ligatures.note"),
      )}
    />
    <div class="size-row">
      <Toggle id="term-ligatures" checked={settings.ligatures} onchange={setLigatures} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="term-inline-images"
      for="term-inline-images"
      label={t("settings.terminal.inline_images.label")}
      tip={tipOf(t("settings.terminal.inline_images.summary"), t("settings.terminal.inline_images.note"))}
    />
    <div class="size-row">
      <Toggle id="term-inline-images" checked={settings.inlineImages} onchange={setInlineImages} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="right-click"
      label={t("settings.terminal.right_click.label")}
      tip={tipOf(
        t("settings.terminal.right_click.summary.menu") +
          t("settings.terminal.right_click.summary.menu_desc") +
          t("settings.terminal.right_click.summary.paste") +
          t("settings.terminal.right_click.summary.paste_desc"),
        t("settings.terminal.right_click.note.combo") + t("settings.terminal.right_click.note.after"),
      )}
    />
    <ChoiceChips
      id="right-click"
      labelledby="right-click-label"
      entries={RIGHT_CLICK_ENTRIES}
      icons={RIGHT_CLICK_ICONS}
      value={settings.rightClick}
      onpick={setRightClick}
    />
  </div>

  <div class="srow">
    <TipName
      id="paste-confirm"
      for="paste-confirm"
      label={t("settings.terminal.paste_confirm.label")}
      tip={t("settings.terminal.paste_confirm.summary")}
    />
    <div class="size-row">
      <Toggle
        id="paste-confirm"
        checked={settings.confirmMultilinePaste}
        onchange={setConfirmMultilinePaste}
      />
    </div>
  </div>

  <div class="srow">
    <!-- 셸 통합 묶음보다 위에 둔다 — OSC 52 는 셸 통합과 무관하게 돈다 -->
    <TipName
      id="osc52-clipboard"
      for="osc52-clipboard"
      label={t("settings.terminal.osc52.label")}
      tip={tipOf(
        t("settings.terminal.osc52.summary"),
        t("settings.terminal.osc52.note.before") + "set -g set-clipboard on" + t("settings.terminal.osc52.note.after"),
      )}
    />
    <div class="size-row">
      <Toggle id="osc52-clipboard" checked={settings.osc52Clipboard} onchange={setOsc52Clipboard} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="local-shell-integration"
      for="local-shell-integration"
      label={t("settings.terminal.shell_integration.label")}
      tip={tipOf(t("settings.terminal.shell_integration.summary"), t("settings.terminal.shell_integration.note"))}
    />
    <div class="size-row">
      <Toggle
        id="local-shell-integration"
        checked={settings.localShellIntegration}
        onchange={setLocalShellIntegration}
      />
    </div>
  </div>

  <div class="srow">
    <!-- 이 아래로는 전부 셸 통합 훅(OSC 133) 위에 선 값이다 — 훅을 끄면 함께 조용해진다 -->
    <TipName
      id="inline-snippets"
      for="inline-snippets"
      label={t("settings.terminal.inline_snippets.label")}
      tip={tipOf(
        t("settings.terminal.inline_snippets.summary"),
        "↓" + t("settings.terminal.inline_snippets.note.pick") + "Tab·Enter" + t("settings.terminal.inline_snippets.note.insert"),
      )}
    />
    <div class="size-row">
      <Toggle id="inline-snippets" checked={settings.inlineSnippets} onchange={setInlineSnippets} />
    </div>
  </div>

  <div class="srow">
    <TipName
      id="mark-after"
      for="mark-after"
      label={t("settings.terminal.mark.label")}
      tip={tipOf(
        t("settings.terminal.mark.summary.before") + t("settings.terminal.mark.summary.time"),
        t("settings.terminal.mark.note"),
      )}
    />
    <div class="size-row">
      <input
        id="mark-after"
        class="value size"
        type="number"
        min="0"
        max={NOTIFY_AFTER_MAX_SECS}
        value={settings.markAfterSecs}
        placeholder={String(DEFAULT_MARK_AFTER_SECS)}
        oninput={(e) => setMarkAfterSecs(e.currentTarget.valueAsNumber)}
      />
      <span class="hint">{t("settings.terminal.seconds_hint")}</span>
    </div>
  </div>

  <div class="srow">
    <TipName
      id="bell"
      label={t("settings.terminal.bell.label")}
      tip={tipOf(
        t("settings.terminal.bell.summary.before") + "\\a" + t("settings.terminal.bell.summary.after"),
        t("settings.terminal.bell.note"),
      )}
    />
    <ChoiceChips
      id="bell"
      labelledby="bell-label"
      entries={BELL_ENTRIES}
      icons={BELL_ICONS}
      value={settings.bell}
      onpick={setBell}
    />
  </div>

  <div class="srow">
    <!-- 설정 색인 anchor(`logs-folder`)는 손잡이 묶음에 둔다 — 이름의 id 는 `TipName` 이 정한다 -->
    <TipName
      id="logs-folder"
      label={t("settings.terminal.logs_folder.label")}
      tip={tipOf(t("settings.terminal.logs_folder.summary"), t("settings.terminal.logs_folder.note"))}
    />
    <div class="size-row" id="logs-folder">
      <code class="path" title={logsFolder ?? undefined}
        >{logsFolder ?? t("settings.terminal.logs_folder.pending")}</code
      >
      <!-- [폴더 열기] 는 메인 PC 의 탐색기라 원격 창에는 없다 -->
      {#if !isRemote}
        <button type="button" class="btn btn-sm btn-secondary" disabled={logsFolder === null} onclick={() => void openFolder()}>
          <UiIcon name="folder-open" size={13} />{t(
            "settings.terminal.logs_folder.open",
          )}
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .shell-pick {
    width: 14em;
    max-width: 100%;
  }

  /* `.swatch` 는 색 선택기 이름이라 피한다 */
  .preset-swatch {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 30px;
    height: 16px;
    border: 1px solid var(--line);
    border-radius: 3px;
  }

  .preset-swatch i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
  }
</style>
