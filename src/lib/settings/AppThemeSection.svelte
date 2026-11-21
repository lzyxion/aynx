<script lang="ts">
  import {
    settings,
    setAppColorTheme,
    setOpacity,
    OPACITY_MIN,
    OPACITY_MAX,
    setTermOpacity,
    TERM_OPACITY_MIN,
    TERM_OPACITY_MAX,
    setWallpaperDim,
    setWallpaperBlur,
    setWallpaperFit,
    WALLPAPER_FITS,
    setStatusBar,
    setStatusBarStyle,
    setDockLayout,
    setMaterial,
    MATERIALS,
    STATUS_BAR_POSITIONS,
    STATUS_BAR_STYLES,
    DOCK_LAYOUTS,
    setTabStyle,
    setTiling,
    setTileHeader,
    setResourceRings,
    setUsageRings,
    setWindowControls,
    TAB_STYLES,
    TILING_MODES,
    TILE_HEADER_MODES,
    WALLPAPER_DIM_MIN,
    WALLPAPER_DIM_MAX,
    WALLPAPER_BLUR_MIN,
    WALLPAPER_BLUR_MAX,
  } from "$lib/settings.svelte.js";
  import { optionEntries, t } from "$lib/i18n/i18n.svelte.js";
  import ProfileCards from "$lib/settings/ProfileCards.svelte";
  import {
    wallpaper,
    pickWallpaper,
    randomWallpaper,
    openWallpaperSource,
    clearWallpaper,
  } from "$lib/wallpaper.svelte.js";
  import { appMode, setAppMode } from "$lib/mode.svelte.js";
  import { extractDynamicTheme, dynamicTheme } from "$lib/dynamic-theme.svelte.js";
  import { appColorFamily, selectedAppColorTheme, type AppColorThemeId } from "$lib/app-color-themes";
  import ThemeFamilyChip from "$lib/settings/ThemeFamilyChip.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import SettingRow from "$lib/settings/SettingRow.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ChoiceChips, { type ChoiceIcons } from "$lib/settings/ChoiceChips.svelte";
  import TipName, { tipOf } from "$lib/settings/TipName.svelte";
  import ValueSlider from "$lib/settings/ValueSlider.svelte";
  import { tick } from "svelte";
  import { revealAt, revealOriginFrom, revealTheme } from "$lib/theme-reveal";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import AvatarsSection from "$lib/settings/AvatarsSection.svelte";
  import { slotAvatarId } from "$lib/app/app-icons.svelte.js";
  import { BUILTIN_AVATARS, avatarLabel, avatarSrc, builtinAvatarThumb, type BuiltinAvatar } from "$lib/avatars.svelte.js";

  let { active = true }: { active?: boolean } = $props();

  const selectedTheme = $derived(selectedAppColorTheme(settings.current.app));
  // 슬라이더에는 원 퍼짐(`theme-reveal.ts`)을 쓰지 않는다 — 미는 동안 얼어붙는다
  function pickColorTheme(id: AppColorThemeId, ev: Event): void {
    void revealTheme(revealOriginFrom(ev), () => {
      dynamicTheme.error = null;
      dynamicTheme.last = null;
      setAppColorTheme(id, appMode.resolved === "dark");
    });
  }

  const WALLPAPER_FIT_ENTRIES = optionEntries(WALLPAPER_FITS);
  const STATUS_BAR_ENTRIES = optionEntries(STATUS_BAR_POSITIONS);
  const STATUS_BAR_STYLE_ENTRIES = optionEntries(STATUS_BAR_STYLES);
  const DOCK_LAYOUT_ENTRIES = optionEntries(DOCK_LAYOUTS);
  const TAB_STYLE_ENTRIES = optionEntries(TAB_STYLES);
  const MATERIAL_ENTRIES = optionEntries(MATERIALS);
  const TILING_ENTRIES = optionEntries(TILING_MODES);
  const TILE_HEADER_ENTRIES = optionEntries(TILE_HEADER_MODES);

  const WALLPAPER_FIT_ICONS: ChoiceIcons = {
    cover: "fit-cover",
    contain: "fit-contain",
    tile: "grid",
    center: "fit-center",
  };
  const STATUS_BAR_ICONS: ChoiceIcons = {
    left: "edge-left",
    top: "edge-top",
    bottom: "edge-bottom",
    right: "edge-right",
  };
  const STATUS_BAR_STYLE_ICONS: ChoiceIcons = { flat: "bar-flat", panel: "bar-panel", hug: "bar-hug" };
  const TAB_STYLE_ICONS: ChoiceIcons = { pill: "tab-pill", flat: "tab-flat" };
  const MATERIAL_ICONS: ChoiceIcons = { flat: "material-flat", glass: "material-glass" };
  /** 36×20 판 위의 칸 — `new` = 방금 연 타일, `focus` = 보던 타일 */
  type TileRect = readonly [x: number, y: number, w: number, h: number, kind?: "new" | "focus"];
  const TILING_PICTURES: Readonly<Record<string, readonly TileRect[]>> = {
    spiral: [
      [0, 0, 17, 20],
      [19, 0, 17, 9],
      [28, 11, 8, 9],
      [19, 11, 7, 9, "new"],
    ],
    focus: [
      [0, 0, 17, 9, "focus"],
      [0, 11, 17, 9, "new"],
      [19, 0, 17, 20],
    ],
  };
  const TILE_HEADER_ICONS: ChoiceIcons = {
    always: "header-always",
    multi: "header-multi",
    never: "header-never",
  };

  // ── 요약 ↔ 아바타 하위 화면 ──
  // `SubViewStack` 에 `onescape` 를 넘기지 않는다 — 그 창 캡처가 먼저 돌아 고정한 말풍선을 건너뛰고 하위 화면을 닫는다
  type View = "summary" | "avatars";
  let view = $state<View>("summary");
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let avatarsBtn = $state<HTMLButtonElement | null>(null);

  const AVATAR_ANCHORS = new Set(["ai-icon-style", "avatar-library", "app-icon", "avatar-claude", "avatar-codex"]);

  const AVATAR_SLOTS = [
    { slot: "app", name: "settings.avatars.slot.app" },
    { slot: "claude", name: "settings.avatars.slot.claude" },
    { slot: "codex", name: "settings.avatars.slot.codex" },
  ] as const;

  function avatarThumb(id: string): string {
    return ((BUILTIN_AVATARS as readonly string[]).includes(id) ? builtinAvatarThumb(id as BuiltinAvatar) : avatarSrc(id)) ?? "";
  }

  function openAvatars(): void {
    dir = "fwd";
    view = "avatars";
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  async function closeSub(returnFocus: boolean): Promise<void> {
    if (view === "summary") return;
    dir = returnFocus ? "back" : null;
    view = "summary";
    if (!returnFocus) return;
    await tick();
    avatarsBtn?.scrollIntoView({ block: "nearest" });
    avatarsBtn?.focus({ preventScroll: true });
  }

  /** `SettingsModal.revealPendingAnchor` 가 스크롤 전에 부른다 */
  export function expandForAnchor(anchor: string): void {
    if (AVATAR_ANCHORS.has(anchor)) {
      dir = null;
      view = "avatars";
      return;
    }
    void closeSub(false);
  }

  $effect(() => {
    if (!active) void closeSub(false);
  });
</script>

<!-- 설정 색인의 anchor(`theme-profile`)는 제목에 둔다 — 카드 격자는 다른 파일(`ProfileCards`)이다 -->
<SubViewStack {view} {dir} bind:root={rootEl}>
{#if view === "avatars"}
  <SettingsSubView
    title={t("settings.theme.avatars.label")}
    back={t("settings.theme.avatars.back")}
    backAria={t("settings.theme.avatars.back.aria")}
    onback={() => void closeSub(true)}
  >
    <AvatarsSection {active} onescape={() => void closeSub(true)} />
  </SettingsSubView>
{:else}
<h4 class="subhead first" id="theme-profile">{t("settings.theme.profile.heading")}</h4>

<ProfileCards />

<h4 class="subhead">{t("settings.theme.wallpaper.heading")}</h4>

<div class="wp-pick">
  {#if wallpaper.src && wallpaper.source && wallpaper.source.file === settings.wallpaperFile}
    <button
      type="button"
      class="wp-preview linked"
      style={`background-image:url("${wallpaper.src}")`}
      title={`${t("settings.theme.wallpaper.random.source")} ${wallpaper.source.url.replace(/^https:\/\//, "")}`}
      onclick={() => openWallpaperSource()}
    ></button>
  {:else}
    <div
      class="wp-preview"
      class:empty={!wallpaper.src}
      style={wallpaper.src ? `background-image:url("${wallpaper.src}")` : undefined}
      aria-hidden="true"
    >
      {#if !wallpaper.src}{t("settings.theme.wallpaper.none")}{/if}
    </div>
  {/if}
  <div class="wp-side">
    <div class="wp-actions">
      <button
        type="button"
        class="btn btn-secondary"
        disabled={wallpaper.busy}
        onclick={(ev) => void pickWallpaper(revealAt(revealOriginFrom(ev)))}
      >
        <span class="swap">
          <span class:off={wallpaper.busy && !wallpaper.fetching}>{t("settings.theme.wallpaper.pick")}</span>
          <span class:off={!(wallpaper.busy && !wallpaper.fetching)} aria-hidden={!(wallpaper.busy && !wallpaper.fetching)}
            >{t("settings.theme.wallpaper.opening")}</span
          >
        </span>
      </button>
      <button
        type="button"
        class="btn btn-secondary"
        disabled={wallpaper.busy || wallpaper.fetching}
        aria-busy={wallpaper.fetching}
        title={t("settings.theme.wallpaper.random.title")}
        onclick={(ev) => void randomWallpaper(revealAt(revealOriginFrom(ev)))}
      >
        <span class="swap">
          <span class:off={wallpaper.fetching}>{t("settings.theme.wallpaper.random")}</span>
          <span class:off={!wallpaper.fetching} aria-hidden={!wallpaper.fetching}
            >{t("settings.theme.wallpaper.random.fetching")}</span
          >
        </span>
      </button>
      <button
        type="button"
        class="btn btn-secondary danger"
        disabled={wallpaper.busy || !settings.wallpaperFile}
        onclick={(ev) => void clearWallpaper(revealAt(revealOriginFrom(ev)))}
      >
        {t("settings.theme.wallpaper.clear")}
      </button>
    </div>
    <div class="mode-options" role="group" aria-label={t("settings.theme.mode.label")}>
      <button
        id="app-mode"
        type="button"
        class="mode-option"
        class:active={appMode.resolved === "light"}
        aria-pressed={appMode.resolved === "light"}
        data-app-mode="light"
        onclick={(ev) => void revealTheme(revealOriginFrom(ev), () => setAppMode("light"))}
      >
        <UiIcon name="sun" size={22} />
        <span>{t("settings.option.mode.light")}</span>
      </button>
      <button
        type="button"
        class="mode-option"
        class:active={appMode.resolved === "dark"}
        aria-pressed={appMode.resolved === "dark"}
        data-app-mode="dark"
        onclick={(ev) => void revealTheme(revealOriginFrom(ev), () => setAppMode("dark"))}
      >
        <UiIcon name="moon" size={22} />
        <span>{t("settings.option.mode.dark")}</span>
      </button>
    </div>
  </div>
</div>

{#if wallpaper.error}
  <p class="wp-error" role="alert">{wallpaper.error}</p>
{/if}

<div
  class="opt-chips palette-chips"
  id="app-colors"
  role="group"
  aria-label={t("settings.theme.palette.heading")}
>
  <button
    id="app-dynamic"
    type="button"
    class="opt-chip"
    class:active={settings.dynamicTheme}
    aria-pressed={settings.dynamicTheme}
    aria-busy={dynamicTheme.busy}
    disabled={!wallpaper.src || dynamicTheme.busy || wallpaper.busy}
    title={!wallpaper.src ? t("settings.theme.palette.needWallpaper") : undefined}
    onclick={(ev) => void revealTheme(revealOriginFrom(ev), () => extractDynamicTheme(wallpaper.src))}
  >
    <UiIcon name="pipette" size={14} />
    <span>{t(dynamicTheme.busy ? "settings.theme.wallpaper.dynamic.busy" : "settings.theme.palette.extract")}</span>
  </button>
  <!-- 계열마다 한 줄로 적는다 — 설정 색인이 anchor(`id`)를 이 파일의 글자로 찾는다 (settings-index.test.ts) -->
  <ThemeFamilyChip id="app-color-prism" family={appColorFamily("prism")} current={selectedTheme}
    disabled={dynamicTheme.busy || wallpaper.busy} onpick={pickColorTheme} />
  <ThemeFamilyChip id="app-color-classic" family={appColorFamily("classic")} current={selectedTheme}
    disabled={dynamicTheme.busy || wallpaper.busy} onpick={pickColorTheme} />
  <ThemeFamilyChip id="app-color-mono" family={appColorFamily("mono")} current={selectedTheme}
    disabled={dynamicTheme.busy || wallpaper.busy} onpick={pickColorTheme} />
</div>
{#if dynamicTheme.error}
  <p class="wp-error" role="alert">{dynamicTheme.error}</p>
{/if}

<SettingRow id="wp-dim" label={t("settings.theme.wallpaper.dim.label")} tip={t("settings.theme.wallpaper.dim.summary")}>
  {#snippet control()}
    <ValueSlider id="wp-dim" min={WALLPAPER_DIM_MIN} max={WALLPAPER_DIM_MAX} step={5} value={settings.wallpaperDim} unit="%" disabled={!settings.wallpaperFile} onchange={setWallpaperDim} />
  {/snippet}
</SettingRow>

<SettingRow id="wp-blur" label={t("settings.theme.wallpaper.blur.label")} tip={t("settings.theme.wallpaper.blur.summary")}>
  {#snippet control()}
    <ValueSlider id="wp-blur" min={WALLPAPER_BLUR_MIN} max={WALLPAPER_BLUR_MAX} step={1} value={settings.wallpaperBlur} unit="px" disabled={!settings.wallpaperFile} onchange={setWallpaperBlur} />
  {/snippet}
</SettingRow>

<SettingRow id="wp-fit" label={t("settings.theme.wallpaper.fit.label")} tip={t("settings.theme.wallpaper.fit.summary")}>
  {#snippet control()}
    <ChoiceChips
      id="wp-fit"
      label={t("settings.theme.wallpaper.fit.label")}
      entries={WALLPAPER_FIT_ENTRIES}
      icons={WALLPAPER_FIT_ICONS}
      value={settings.wallpaperFit}
      onpick={setWallpaperFit}
      disabled={!settings.wallpaperFile}
    />
  {/snippet}
</SettingRow>

<h4 class="subhead">{t("settings.theme.color.heading")}</h4>

<SettingRow id="app-opacity" label={t("settings.theme.color.opacity.label")} tip={t("settings.theme.color.opacity.summary")}>
  {#snippet control()}
    <ValueSlider id="app-opacity" min={OPACITY_MIN} max={OPACITY_MAX} step={5} value={settings.opacity} unit="%" onchange={setOpacity} />
  {/snippet}
</SettingRow>

<SettingRow id="term-opacity" label={t("settings.theme.color.term_opacity.label")} tip={t("settings.theme.color.term_opacity.summary")}>
  {#snippet control()}
    <ValueSlider id="term-opacity" min={TERM_OPACITY_MIN} max={TERM_OPACITY_MAX} step={5} value={settings.termOpacity} unit="%" onchange={setTermOpacity} />
  {/snippet}
</SettingRow>

<!-- 아티스트 얼굴은 넣지 않는다 — 아티스트마다 따로 정하는 그림이라 층이 다르고, 수가 늘면 줄이 넘친다 -->
<h4 class="subhead">{t("settings.theme.avatars.label")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName id="avatars-open" for="avatars-open" label={t("settings.theme.avatars.label")} tip={t("settings.avatars.lead")} />
    <div class="avatar-sum">
      <span class="avatar-faces" role="list" aria-label={t("settings.theme.avatars.current")}>
        {#each AVATAR_SLOTS as s (s.slot)}
          {@const id = slotAvatarId(s.slot)}
          {@const label = `${t(s.name)} · ${avatarLabel(id) ?? id}`}
          <span role="listitem" class="avatar-face" class:square={s.slot === "app"} title={label} data-avatar-face={s.slot}>
            <img src={avatarThumb(id)} alt={label} width="26" height="26" draggable="false" />
          </span>
        {/each}
      </span>
      <button
        type="button"
        id="avatars-open"
        class="btn btn-sm btn-secondary avatars-open"
        bind:this={avatarsBtn}
        onclick={openAvatars}
      >
        {t("settings.theme.avatars.open")}
        <UiIcon name="chevron" size={12} />
      </button>
    </div>
  </div>
</div>

<h4 class="subhead">{t("settings.theme.material.label")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName
      id="material"
      label={t("settings.theme.material.label")}
      tip={t("settings.theme.material.summary")}
    />
    <ChoiceChips id="material" labelledby="material-label" entries={MATERIAL_ENTRIES} icons={MATERIAL_ICONS} value={settings.material} onpick={setMaterial} />
  </div>
</div>

<h4 class="subhead">{t("settings.theme.tabs.style.label")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName
      id="tab-style"
      label={t("settings.theme.tabs.style.label")}
      tip={t("settings.theme.tabs.summary")}
    />
    <ChoiceChips id="tab-style" labelledby="tab-style-label" entries={TAB_STYLE_ENTRIES} icons={TAB_STYLE_ICONS} value={settings.tabStyle} onpick={setTabStyle} />
  </div>

  <div class="srow">
    <TipName
      id="window-controls"
      for="window-controls"
      label={t("settings.theme.window_controls.label")}
      tip={tipOf(t("settings.theme.window_controls.summary"), t("settings.theme.window_controls.note"))}
    />
    <Toggle id="window-controls" checked={settings.windowControls} onchange={setWindowControls} />
  </div>
</div>

<h4 class="subhead">{t("settings.theme.statusbar.label")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName
      id="status-bar"
      label={t("settings.theme.statusbar.label")}
      tip={tipOf(t("settings.theme.statusbar.summary"), t("settings.theme.statusbar.note"))}
    />
    <ChoiceChips id="status-bar" labelledby="status-bar-label" entries={STATUS_BAR_ENTRIES} icons={STATUS_BAR_ICONS} value={settings.statusBar} onpick={setStatusBar} />
  </div>

  <div class="srow">
    <TipName
      id="status-bar-style"
      label={t("settings.theme.statusbar.style.label")}
      tip={t("settings.theme.statusbar.style.summary")}
    />
    <ChoiceChips id="status-bar-style" labelledby="status-bar-style-label" entries={STATUS_BAR_STYLE_ENTRIES} icons={STATUS_BAR_STYLE_ICONS} value={settings.statusBarStyle} onpick={setStatusBarStyle} />
  </div>

  <div class="srow">
    <TipName
      id="app-resource-rings"
      label={t("settings.theme.statusbar.resources.label")}
      tip={tipOf(t("settings.theme.statusbar.resources.summary"), t("settings.theme.statusbar.resources.note"))}
      for="app-resource-rings"
    />
    <Toggle id="app-resource-rings" checked={settings.resourceRings} onchange={setResourceRings} />
  </div>
  <div class="srow">
    <TipName
      id="app-usage-rings"
      label={t("settings.theme.statusbar.usage.label")}
      tip={tipOf(t("settings.theme.statusbar.usage.summary"), t("settings.theme.statusbar.usage.note"))}
      for="app-usage-rings"
    />
    <Toggle id="app-usage-rings" checked={settings.usageRings} onchange={setUsageRings} />
  </div>
</div>

<!-- `data-value` 는 `ChoiceChips` 와 같다(하네스 손잡이) -->
<h4 class="subhead">{t("settings.theme.dock.label")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName id="dock-layout" label={t("settings.theme.dock.label")} tip={t("settings.theme.dock.summary")} />
    <div class="opt-chips choice-chips" id="dock-layout" role="group" aria-labelledby="dock-layout-label">
      {#each DOCK_LAYOUT_ENTRIES as [key, text] (key)}
        {@const launcherLeft = key === "launcher-left"}
        <button
          type="button"
          class="opt-chip"
          class:active={settings.dockLayout === key}
          aria-pressed={settings.dockLayout === key}
          aria-label={t(text)}
          title={t(text)}
          data-value={key}
          onclick={() => setDockLayout(key)}
        >
          <span class="mini-win" aria-hidden="true">
            <span class="strip" class:launcher={launcherLeft}
              ><UiIcon name={launcherLeft ? "dock" : "ai"} size={11} /></span
            >
            <span class="tile"></span>
            <span class="tile"></span>
            <span class="strip" class:launcher={!launcherLeft}
              ><UiIcon name={launcherLeft ? "ai" : "dock"} size={11} /></span
            >
          </span>
        </button>
      {/each}
    </div>
  </div>
</div>

<h4 class="subhead">{t("settings.theme.tile.heading")}</h4>
<div class="rows term">
  <div class="srow">
    <TipName
      id="tiling"
      label={t("settings.theme.tile.tiling.label")}
      tip={tipOf(
        t("settings.theme.tile.tiling.summary.spiral.term") +
          t("settings.theme.tile.tiling.summary.spiral.after") +
          t("settings.theme.tile.tiling.summary.focus.term") +
          t("settings.theme.tile.tiling.summary.focus.after"),
        t("settings.theme.tile.tiling.note"),
      )}
    />
    <div class="opt-chips choice-chips" id="tiling" role="group" aria-labelledby="tiling-label">
      {#each TILING_ENTRIES as [key, text] (key)}
        <button
          type="button"
          class="opt-chip"
          class:active={settings.tiling === key}
          aria-pressed={settings.tiling === key}
          data-value={key}
          onclick={() => setTiling(key)}
        >
          <svg class="tiling-pic" viewBox="-1 -1 38 22" width="38" height="22" aria-hidden="true">
            {#each TILING_PICTURES[key] ?? [] as [x, y, w, h, kind], i (i)}
              <rect {x} {y} width={w} height={h} rx="2" class={kind ?? "plain"} />
            {/each}
          </svg>
          <span>{t(text)}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="srow">
    <TipName
      id="tile-header"
      label={t("settings.theme.tile.header.label")}
      tip={tipOf(t("settings.theme.tile.header.summary"), t("settings.theme.tile.header.note"))}
    />
    <ChoiceChips id="tile-header" labelledby="tile-header-label" entries={TILE_HEADER_ENTRIES} icons={TILE_HEADER_ICONS} value={settings.tileHeader} onpick={setTileHeader} />
  </div>
</div>

{/if}
</SubViewStack>

<style>
  /* ── 아바타 줄 ── */
  .avatar-sum {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: auto;
  }

  .avatar-faces {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .avatar-face {
    display: block;
    width: 26px;
    height: 26px;
    overflow: hidden;
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--line);
  }

  .avatar-face.square {
    border-radius: 7px;
  }

  .avatar-face img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatars-open {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .palette-chips {
    margin: var(--space-3) 0;
  }

  /* ── 월페이퍼 ───────────────────────────────────────────────────────────── */

  .wp-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: var(--space-4);
  }

  /* 어둡게 · 블러는 썸네일에 걸지 않는다 — 축소된 그림에 같은 px 블러는 실제보다 훨씬 뭉개져 거짓말이 된다 */
  .wp-preview {
    box-sizing: border-box;
    flex: 1000 1 240px;
    align-self: flex-start;
    min-width: 0;
    height: 150px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--t-xs);
    color: var(--fg-3);
    background-color: var(--surface-field);
    background-size: cover;
    background-position: center;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .wp-preview.empty {
    border-style: dashed;
  }

  .wp-preview.linked {
    padding: 0;
    cursor: pointer;
  }

  .wp-preview.linked:hover {
    border-color: var(--fg-3);
  }

  .wp-preview.linked:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .wp-side {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: var(--space-2);
  }

  .wp-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .mode-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .mode-option {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-2) var(--space-3);
    border: none;
    border-radius: var(--radius-surface-inner);
    background: var(--control-tile-bg);
    color: var(--control-fg);
    font: inherit;
    font-size: var(--t-sm);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }

  .mode-option:not(.active):hover {
    background: var(--control-tile-bg-hover);
  }

  .mode-option.active {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    font-weight: var(--fw-semibold);
  }

  .mode-option.active:hover {
    background: var(--control-sel-bg-hover);
  }

  .mode-option:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* ── 독 배치 ── */
  .mini-win {
    display: grid;
    grid-template-columns: 16px 1fr 1fr 16px;
    gap: 2px;
    width: 60px;
    height: 20px;
  }

  .mini-win > span {
    border-radius: 3px;
  }

  .mini-win .strip {
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, currentColor 22%, transparent);
  }

  .mini-win .strip.launcher {
    background: var(--accent);
    color: var(--on-accent);
  }

  .mini-win .tile {
    border: 1px solid color-mix(in srgb, currentColor 40%, transparent);
  }

  /* ── 타일 배치 ── */
  .tiling-pic rect {
    fill: none;
    stroke-width: 1;
  }

  .tiling-pic rect.plain {
    stroke: color-mix(in srgb, currentColor 45%, transparent);
  }

  .tiling-pic rect.focus {
    stroke: var(--accent);
    stroke-width: 1.75;
  }

  .tiling-pic rect.new {
    fill: var(--accent);
    stroke: var(--accent);
  }

  /* 두 글자를 겹쳐 두어 폭 = 긴 쪽 — 글자가 바뀌어도 썸네일 폭이 흔들리지 않는다 */
  .swap {
    display: inline-grid;
  }
  .swap > span {
    grid-area: 1 / 1;
    text-align: center;
  }
  .swap > .off {
    visibility: hidden;
  }

  .wp-error {
    margin: var(--space-2) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--err);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    word-break: keep-all;
  }

</style>
