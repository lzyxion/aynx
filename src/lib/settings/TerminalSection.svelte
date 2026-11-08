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
   * **터미널** 섹션 — 이 타일에 *무엇을 띄우고* 그것이 *어떻게 보이는가*. 기본 셸 ·
   * 팔레트·글꼴·크기·WebGL·합자와, 터미널 안에서 벌어지는 입력 동작(우클릭·붙여넣기 확인·
   * 로컬 셸 통합).
   *
   * **기본 셸이 첫 줄이다** (docs/log/2026-09-17-settings-general.md). 예전에는 `[shell]` 과
   * `[terminal]` 이 `settings.toml` 에서 층이 다르다는 이유로 섹션도 둘이었는데, 그쪽 섹션의
   * 손잡이가 끝내 하나뿐이라 사이드 내비 한 칸이 거의 빈 화면을 가리키고 있었다. 사용자가
   * 찾는 자리는 어차피 "터미널" 이므로 맨 위로 접어 넣는다 — `settings.toml` 의 층은 그대로다.
   *
   * 여기 값들은 전부 **이미 열려 있는 탭에도 즉시** 반영된다 (`Terminal.svelte` 의 `$effect`
   * 구독). 예외가 기본 셸이다 — 그 값을 읽어 argv 를 정하는 쪽이 백엔드라 **다음에 여는
   * 터미널부터** 듣는다. 창 크롬 쪽 값(탭 모양·타일 배치·타일 헤더·상태바)은 **앱 테마**
   * 섹션으로 옮겼다.
   *
   * 셸 목록은 **이 섹션이 처음 열릴 때만** 읽는다. `listShells()` 는 WSL 배포판을 훑고 pwsh
   * 존재를 프로세스 하나로 확인하므로, 설정 화면을 여는 것만으로 매번 치를 비용이 아니다.
   * 그 판단을 부르는 쪽에서 가져오지 않고 여기서 하는 이유는 "언제 읽느냐" 가 이 섹션의
   * 사정이기 때문이다 — 프롭 하나(`active`)면 충분하다.
   */
  let { active = false }: { active?: boolean } = $props();

  /** 다크 묶음 → 라이트 묶음(짝 순서가 맞는다 — `termPresetGroups`). 머리글은 `Dropdown` 의 `group` */
  const PRESET_GROUPS = termPresetGroups();
  const RIGHT_CLICK_ENTRIES = optionEntries(RIGHT_CLICK_MODES);
  const CURSOR_STYLE_ENTRIES = optionEntries(CURSOR_STYLES);
  const BELL_ENTRIES = optionEntries(BELL_MODES);

  /** 고르는 칩의 앞 아이콘 — 값 키 → `UiIcon` 이름 (`ChoiceChips` 의 `icons`) */
  const CURSOR_STYLE_ICONS: ChoiceIcons = {
    block: "cursor-block",
    underline: "cursor-underline",
    bar: "cursor-bar",
  };
  const RIGHT_CLICK_ICONS: ChoiceIcons = { menu: "menu", paste: "paste" };
  const BELL_ICONS: ChoiceIcons = { visual: "bell-visual", "visual+sound": "bell-sound", off: "bell-off" };

  /** 색 테마 드롭다운 옆 견본 — 고른 팔레트의 배경 위에 글자·빨강·초록·파랑 네 점 */
  const presetDots = $derived.by((): { bg: string | undefined; dots: string[] } => {
    const th = termThemeOf(settings.presetKey, settings.dynamicTerm, settings.userTermLookup, settings.dynamicFixedTerms);
    return {
      bg: th.background,
      dots: [th.foreground, th.red, th.green, th.blue].filter((c): c is string => typeof c === "string"),
    };
  });

  /** 글꼴을 기본값으로 되돌린다 — 텍스트 칸을 비우는 것과 같은 뜻이다 */
  function resetFont() {
    setTermFontFamily("");
    setTermFontSize(undefined);
    applySettings();
  }

  // ── 기본 셸 (`[shell] default` — docs/log/2026-09-04-default-shell-close-tile.md 의 A절) ──

  let shells = $state<ShellInfo[]>([]);
  /** OS 초기 기본 셸 id (Rust 가 고른다) — 설정이 비었을 때 골라져 보일 값 */
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
   * 드롭다운에서 골라져 보일 값 = **지금의 기본 셸** (`>_` 메뉴·`Ctrl+Shift+N` 과 같은 규칙).
   *
   * **"시스템 기본" 항목은 없다** (2026-09-16 저녁). Windows 에는 OS 가 정한 셸이라는 것이
   * 없어 그 말이 무엇을 여는지 화면만 봐서는 알 수 없었다. 지금 이 드롭다운의 항목은
   * **이 기기에서 찾은 셸들뿐**이고, 아직 아무것도 고르지 않았으면 **OS 초기값**이 골라진
   * 채로 뜬다 (그 값을 고르는 자리는 Rust 의 `pty::os_default_shell_id` 하나 —
   * `list_shells` 가 목록과 함께 실어 준다).
   *
   * 저장된 id 가 지금 목록에 없으면 OS 초기값이 **표시만** 되고
   * [`settings.current.shell.default`] 는 그대로 둔다 — 지운 WSL 배포판을 다시 깔면
   * 아무것도 안 해도 원래 고른 셸로 돌아와야 하기 때문이다 (`ShellPrefs` 주석).
   * 목록을 아직 안 읽은 동안에는 `null` → `""` 라 아무것도 골라져 있지 않지만, 그동안은 항목
   * 자체가 비어 있다. **화면이 무엇을 보여 주든 저장은 [`pickShell`] 이 부를 때만** 한다.
   */
  const effectiveId = $derived(effectiveDefaultShellId(shells, settings.defaultShell, osDefaultId));

  /** 저장된 셸이 이 기기에 없다 — 줄 밑에 한 줄로 알린다 (값은 그대로 둔다) */
  const shellMissing = $derived(
    shellsLoaded &&
      shells.length > 0 &&
      !!settings.defaultShell &&
      settings.defaultShell !== effectiveId,
  );

  /**
   * 대신 열리는 셸의 표시 이름 — **그릴 때의 언어**로 고른다(`shellInfoLabel`). 목록은 처음 한 번만
   * 읽어 두므로 백엔드가 구운 `label` 을 그대로 쓰면 언어를 바꿔도 옛 이름이 남는다.
   */
  const effectiveLabel = $derived.by(() => {
    const found = shells.find((s) => s.id === effectiveId);
    return found ? shellInfoLabel(found, t) : shellLabel(effectiveId ?? undefined, t);
  });

  /**
   * 드롭다운의 줄 — 이름은 지금 언어(`shellInfoLabel`), 앞에는 셸 로고(`shellIconName` — 모르는 셸은
   * 일반 터미널 아이콘으로 떨어진다). 감지된 셸만 서므로 pwsh·WSL 배포판·Git Bash 는 있을 때만 뜬다.
   */
  const shellOptions = $derived(
    shells.map((s) => ({ value: s.id, label: shellInfoLabel(s, t), icon: iconRef(shellIconName(s.id)) })),
  );

  function pickShell(id: string) {
    setDefaultShell(id);
  }

  // ── 세션 로그 폴더 (docs/log/2026-09-17-tile-menu-flyouts.md) ──────────────
  //
  // 타일 ⋯ 메뉴에서 내려온 줄이다. 저쪽에서 뺀 이유가 곧 여기 있는 이유다 — 이 폴더는
  // **앱에 하나뿐**이라 타일마다 같은 줄이 설 일이 아니고, 로깅을 켠 사람이 "그래서 파일이
  // 어디 있나" 를 찾는 자리는 설정이다 (호스트 폼의 [폴더 열기] 와 같은 문이다).
  //
  // 경로는 섹션이 처음 열릴 때 한 번 묻는다 (앱이 사는 동안 변하지 않는다 —
  // `app/hosts/session-logs.svelte.ts` 의 `ensureLogsFolder` 와 같은 처방). 실패는 콘솔로만 삼킨다:
  // 이 값이 정하는 것은 줄에 적힐 글자뿐이고, 사람이 실제로 버튼을 누르면 같은 실패를
  // [`openFolder`] 가 다시 만나 그때 토스트로 말한다.
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

<!--
  **이 섹션의 줄에는 늘 보이는 설명 줄도 ⓘ 도 없다** — 설명(요약 + 자세히)은 **이름에 얹는
  툴팁**(`TipName.svelte`, 앱 테마 섹션과 공용)이다. 코드 조각으로 쪼개 그리던 요약은 평문으로
  잇는다. 설명이 없는 줄(글꼴·크기)은 이름만 선다. **지금의 상태**(저장된 셸이 없음)는
  도움말이 아니라서 줄 밑에 그대로 보인다.

  옛 섹션 머리말(lead)은 걷었다 — "앱 테마와 별개라 색이 달라도 정상" 은 색 테마 줄의
  툴팁으로 옮겼고, "열린 탭에도 바로 적용" 은 섹션 일반 설명이라 뺐다.
-->

<!-- 지금 고른 팔레트·글꼴·커서 모양을 그대로 입힌 라이브 미리보기 (아래 컨트롤에 즉시 반응).
     글꼴 크기는 터미널과 같은 값(UI 배율만큼 되돌린 값)이라 미리보기도 실제 터미널 크기로 보인다. -->
<TermPreview
  theme={settings.termTheme}
  fontFamily={settings.fontFamilyEffective}
  fontSize={settings.termFontSize}
  cursorStyle={settings.cursorStyle}
/>

<div class="rows term">
  <div class="srow">
    <!--
      기본 셸 — **이 섹션의 첫 줄**이다 (docs/log/2026-09-17-settings-general.md).
      아래 팔레트·글꼴이 "어떻게 보이는가" 라면 이 줄은 "무엇을 띄우는가" 라 순서가 먼저다.
    -->
    <TipName
      id="default-shell"
      for="default-shell"
      label={t("settings.terminal.shell.label")}
      tip={tipOf(
        t("settings.terminal.shell.summary.before") + ">_" + t("settings.terminal.shell.summary.after"),
        comboText("new-shell", settings.keybindings) + t("settings.terminal.shell.note"),
      )}
    />
    <!--
      항목은 이 기기에서 감지한 셸 — 줄 앞에 셸 로고가 서야 해서 네이티브 `<select>` 가 아니라 앱이
      그리는 고르개(`Dropdown`)다. 손잡이 `<button id="default-shell">` 이 이름의 `<label for>` 과 설정
      색인 anchor 를 함께 받는다. 저장은 사람이 고를 때만(`onchange` → `pickShell`).
    -->
    <div class="shell-pick">
      <Dropdown
        id="default-shell"
        value={effectiveId ?? ""}
        options={shellOptions}
        labelledby="default-shell-label"
        onchange={pickShell}
      />
    </div>

    <!--
      "찾지 못했습니다" 는 도움말이 아니라 **지금의 상태**라 툴팁에 숨기지 않고 줄 밑에 둔다 —
      숨기면 사용자가 왜 다른 셸이 열리는지 알 수 없다.
    -->
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
    <!-- 드롭다운 앞에 고른 팔레트의 작은 견본(배경 + 네 점). 팔레트 전체(8색)는 위 미리보기가 보여 준다. -->
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
          // 고른 내 테마의 파일이 없으면(지웠거나 다른 PC 의 설정) 빈 손잡이 대신 그 사실을 한 줄로 — 그리는 것은 같은 모드의 AYNX
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
      <!-- 가져오기(파일 · 붙여넣기)와 관리(이름 바꾸기 · 지우기) — 메뉴 없이 모달 하나(`dialogs/TermThemeDialog.svelte`).
           드롭다운에 딸린 동작이라 그 오른쪽에 아이콘 단추 둘로(글자 단추는 줄 가운데 떠 보였다) -->
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

  <!--
    타일 머리줄 칩 (2026-10-18 — 목업 E5yfAAq5XawDLGCjhSAH4U) — 켬끔 · 순서. 값은 `[app]`(머리줄 칸들이 사는 층)이지만 사람이 찾는
    자리는 "터미널" 이다(기본 셸과 같은 판단). 이 줄만은 설명이 늘 보인다 — 누르기 · 끌기 · Alt+←/→ 는 보이지 않으면 모르는 몸짓이다.
  -->
  <HeaderChipsSetting id="header-chips" />

  <div class="srow">
    <!--
      커서 모양 — 글꼴·크기 바로 아래의 타이포 취향값이다. 예전엔 Terminal.svelte 에
      하드코딩(block)이던 것을 설정으로 뺐다. 이미 열려 있는 탭에도 바로 반영된다.
    -->
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
    <!--
      합자 (ligatures) — 기본 끔. 켜면 Terminal.svelte 가 합자 애드온을 붙이고,
      사용자가 글꼴을 안 정했으면 합자 지원 스택(Cascadia Code…)으로 폴백한다.
      xterm 6 에서 합자는 WebGL 과도 함께 그려진다 (docs/verification/ligatures.md).
    -->
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
    <!--
      인라인 이미지 (docs/log/2026-09-26-osc-notify-inline-images.md) — 합자 바로 아래다: 둘 다
      "무엇을 그리는가" 의 손잡이이고, 합자처럼 **열린 타일에도 바로** 붙고 떨어진다.
    -->
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
    <!--
      터미널 우클릭 (docs/log/2026-09-05-terminal-context-menu.md).

      글꼴·합자 바로 아래다 — 여기부터는 "터미널 안에서 벌어지는 일"(우클릭·붙여넣기 확인·
      로컬 셸 통합)이다. 창 크롬 쪽 값(탭 모양·타일·상태바)은 앱 테마 섹션에 있다.
    -->
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
    <!--
      여러 줄 붙여넣기 확인 — 우클릭 설정 **바로 아래**다. 붙여넣기의 두 손잡이가 떨어져
      있으면 "우클릭으로 붙여넣었는데 왜 물어보나" 를 다른 화면에서 찾아야 한다.
    -->
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
    <!--
      원격 클립보드 쓰기 (docs/log/2026-09-23-osc52-osc8.md).

      붙여넣기 두 줄 **바로 아래**다 — 셋 다 클립보드 한 사물의 손잡이라 한자리에 모인다.
      **아래의 셸 통합 묶음보다 위**인 것이 요점이다: OSC 52 는 셸 통합과 무관하게 모든
      타일에서 도는데, 그 묶음 안에 끼면 "훅을 껐으니 이것도 안 되겠지" 로 읽힌다.
    -->
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
    <!--
      로컬 셸 통합 주입 (docs/log/2026-09-08-block-hooks.md).

      `settings.toml` 의 `[terminal] local_shell_integration`. 값을 읽어 argv 를 정하는 쪽은
      **백엔드**(`crate::pty::spawn_shell`)라 프런트에서는 이 토글이 유일한 소비자다 —
      그래서 바뀐 값은 **다음에 여는 셸부터** 듣는다.
    -->
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
    <!--
      입력 중 스니펫 제안 (docs/log/2026-09-16-snippets.md 의 "입력 중 제안").

      로컬 셸 통합 **바로 아래**다 — 이 아래로는 전부 그 훅(OSC 133) 위에 서 있는 값이라,
      훅을 끄면 함께 조용해진다. 손잡이가 떨어져 있으면 "왜 안 뜨나" 를 다른 화면에서 찾게 된다.
    -->
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
    <!--
      세션 로그 폴더 — **이 섹션의 마지막 줄**이다 (docs/log/2026-09-17-tile-menu-flyouts.md).
      위의 표식·벨이 "명령이 끝났을 때" 라면(끝남 알림은 알림 섹션으로 옮겼다) 이 줄은 "그 뒤에 남는 것" 이라 끝에 선다.
      경로를 아직 못 받았으면 자리만 지키는 한 줄을 적는다 — 줄 자체가 사라지면 설정을 연
      사람이 이 기능을 못 보고 지나간다 (호스트 폼과 다른 점: 저쪽은 로깅 칸에 딸린 부연이다).
      설정 색인 anchor(`logs-folder`)는 손잡이 묶음에 둔다 — 이름의 id 는 `TipName` 이 정한다.
    -->
    <TipName
      id="logs-folder"
      label={t("settings.terminal.logs_folder.label")}
      tip={tipOf(t("settings.terminal.logs_folder.summary"), t("settings.terminal.logs_folder.note"))}
    />
    <div class="size-row" id="logs-folder">
      <code class="path" title={logsFolder ?? undefined}
        >{logsFolder ?? t("settings.terminal.logs_folder.pending")}</code
      >
      <button type="button" class="btn btn-sm btn-secondary" disabled={logsFolder === null} onclick={() => void openFolder()}>
        <UiIcon name="folder-open" size={13} />{t(
          "settings.terminal.logs_folder.open",
        )}
      </button>
    </div>
  </div>
</div>

<style>
  /* 기본 셸 고르개의 폭 — 옛 `<select>` 의 상한(14em)과 같은 자리. 손잡이는 이 칸을 채운다 */
  .shell-pick {
    width: 14em;
    max-width: 100%;
  }

  /* 색 테마 드롭다운 앞 견본 — 팔레트 배경 판 위에 네 점 (`.swatch` 는 색 선택기 이름이라 피한다) */
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
