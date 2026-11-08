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

  /** 이 섹션이 지금 보이는가 — 꺼지면(섹션 이동 · 모달 닫힘) 아바타 하위 화면에서 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  // 팔레트는 즉시 미리 보고 [저장]/[취소]로 확정한다. 밝기와 이미지 선택은 기존 저장 흐름을 쓴다.
  const selectedTheme = $derived(selectedAppColorTheme(settings.current.app));
  // '사용자 색'(원천색 하나로 전체 팔레트) 칩은 걷었다(2026-10-17 사용자). 이미 그 색으로 저장된 설정은
  // 모델(`setCustomAppColor` · `selectedCustomSource`)이 그대로 읽고 밝기 전환도 따라간다 — 고르는 길만 없다.
  // 색 · 밝기 · 월페이퍼를 한 번에 바꾸는 고르기는 누른 자리에서 원으로 퍼진다(`theme-reveal.ts`). 슬라이더는 아니다(미는 동안 얼어붙는다).
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

  /** 고르는 칩의 앞 아이콘 — 값 키 → `UiIcon` 이름 (`ChoiceChips` 의 `icons`) */
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
  /**
   * 타일 배치 칩의 작은 그림(10-28 — 아이콘만으로는 차이가 안 읽혀서) — 36×20 판 위의 칸들.
   * `new` = 방금 연 타일(강조색 채움), `focus` = 지금 보던 타일(강조색 테두리), 나머지는 옅은 테두리.
   * 나선은 칸이 시계 방향으로 작아지고, 포커스는 보던 칸(왼쪽 위)만 긴 변으로 갈린다.
   */
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

  // ── 요약 ↔ 아바타 하위 화면 (2026-10-31 — docs/log/2026-10-31-avatars.md 4절) ─────────────────────
  // 예전 설정 › 아바타(왼쪽 메뉴 한 칸)가 테마 안의 하위 화면이 됐다. 요약에는 "아바타" 줄 하나 — 지금 지정된
  // 그림 셋(앱 아이콘 · Claude Code · Codex)을 작게 + [설정 ›]. 자리 · 움직임은 `SubViewStack`, 머리는 `SettingsSubView`.
  // Escape 는 `AvatarsSection` 이 창 캡처 한 곳에서 받는다(메뉴 · 이름 칸 · 팝오버 · 말풍선 고정이 먼저, 없으면 요약으로).
  // `SubViewStack` 에 `onescape` 를 넘기지 않는 이유: 그 창 캡처가 말풍선 고정의 것보다 먼저 등록돼 먼저 돌므로
  // 고정한 말풍선을 건너뛰고 하위 화면을 닫아 버린다.
  type View = "summary" | "avatars";
  let view = $state<View>("summary");
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let avatarsBtn = $state<HTMLButtonElement | null>(null);

  /** 설정 색인에서 아바타 하위 화면 안의 줄 — `expandForAnchor` 가 그 화면을 연다(나머지는 요약) */
  const AVATAR_ANCHORS = new Set(["ai-icon-style", "avatar-library", "app-icon", "avatar-claude", "avatar-codex"]);

  /** 요약 줄의 작은 그림 셋 — 지금 **그려지는** 그림(지운 그림을 가리키면 기본) */
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

  /** 요약으로 — 돌아올 때(`returnFocus`)는 [설정 ›] 에 포커스 */
  async function closeSub(returnFocus: boolean): Promise<void> {
    if (view === "summary") return;
    dir = returnFocus ? "back" : null;
    view = "summary";
    if (!returnFocus) return;
    await tick();
    avatarsBtn?.scrollIntoView({ block: "nearest" });
    avatarsBtn?.focus({ preventScroll: true });
  }

  /**
   * 설정 색인이 이 섹션의 줄로 올 때(`SettingsModal.revealPendingAnchor` 가 스크롤 전에 부른다) — 아바타 하위 화면 안의 줄이면
   * 그 화면을 **움직임 없이** 열고, 나머지는 요약으로 돌아간다(`CredentialsSection.expandForAnchor` 와 같은 꼴).
   */
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

<!--
  **이 섹션의 줄에는 늘 보이는 설명 줄도 ⓘ 도 없다** — 설명(요약 + 자세히)은 **이름에 얹는
  툴팁**이다(`TipName.svelte` — 터미널 섹션과 공용). `SettingRow` 는 `tip` 프롭으로, 손으로
  적는 `.srow` 는 `TipName` 을 직접 둔다. 슬라이더 값은 손잡이 위 말풍선(`ValueSlider.svelte`)이
  보이므로 툴팁에 값을 적지 않는다.
-->

<!--
  고르는 칸은 select 대신 **칩 줄**(`ChoiceChips.svelte`)이다 — 색 테마 칩과 같은 모양(`.opt-chip`,
  `settings.css`). `id` 는 묶음에 붙는다(설정 색인 anchor).
-->

<!--
  **섹션에 `h3` 제목이 없다** (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md):
  왼쪽 사이드 탭에 그 이름이 이미 눌린 채로 보이므로 본문 첫 줄에 같은 글자를 한 번 더 세우면
  어느 섹션인지를 두 번 말하면서 정작 첫 손잡이를 그만큼 아래로 민다. 섹션 **안의**
  소제목(`h4.subhead`)은 그대로다 — 그쪽은 사이드 탭이 대신 말해 주지 않는 이름이다.
-->

<!--
  프로필 — 월페이퍼+테마 한 벌을 이름 붙여 두고 통째로 갈아 끼운다
  (docs/log/2026-09-15-theme-profiles.md). 예전의 select 는 카드 격자가 됐다 — 카드마다 그
  벌의 사진과 색으로 그린 작은 창 (`ProfileCards.svelte`, docs/log/2026-09-28-profile-cards-wallpapers.md).

  **섹션의 맨 앞자리**다: 아래 손잡이를 하나씩 만지기 전에 "한 벌을 통째로 고르는" 길이
  먼저 보여야 한다. 고르면 **즉시 적용되고 저장된다** (다만 이 화면에 다른 미저장 변경이 있으면
  앞지르지 않고 같은 [저장] 을 기다린다). 모드 전환 · 앱 아이콘과 달리 곧바로 저장하는 길이다(`theme-profiles.svelte.ts`).
-->
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

<!--
  월페이퍼 — 창 **전체**의 배경 이미지 (docs/log/2026-09-04-wallpaper.md).

  프로필 바로 다음, **손잡이들 중에서는 첫 자리**다. 앱 테마를 손보는 순서가 실제로
  그렇기 때문이다 — 먼저 배경을 깔아야 그 위에서 색을 뽑고(아래 "월페이퍼에서 색 뽑기"),
  색과 투명도를 무엇에 맞출지가 정해진다.

  [이미지 선택…] 은 다른 설정과 달리 **누르는 즉시 파일에 쓴다**: 원본을 앱 폴더로
  복사하는 되돌릴 수 없는 작업이라 "저장되지 않은 변경" 으로 들고 있을 수가 없다.
  아래 세 손잡이는 평범한 설정이라 [저장] 을 눌러야 파일에 남는다 (화면에는 즉시 반영).
-->
<h4 class="subhead">{t("settings.theme.wallpaper.heading")}</h4>

<!-- 왼쪽 썸네일(남는 폭 전부) | 오른쪽 열(버튼 줄 폭): 파일 버튼 줄, 그 아래 남은 높이를 채우는 밝기 버튼 둘. 좁은 패널에서는 세로로 쌓는다. -->
<div class="wp-pick">
  {#if wallpaper.src && wallpaper.source && wallpaper.source.file === settings.wallpaperFile}
    <!-- 랜덤 월페이퍼의 원본 게시물 — 그 사본이 지금 걸려 있을 때만 (저장하지 않는다). 호버 = 주소, 클릭 = 열기 -->
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
        <!-- 두 글자를 한 칸에 겹쳐 두고 하나만 보인다 — 단추 폭이 늘 긴 쪽이라 글자가 바뀌어도 썸네일 폭이 흔들리지 않는다 -->
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
    <!-- 밝기 — 제목·안내 글자 없이 큰 버튼 둘. 이름은 aria-label 이 맡는다. -->
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

<!-- 색 테마 — 제목 글자 없이 칩 줄. 설정 색인의 anchor(`app-colors`)는 이 묶음에 둔다. -->
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

<!--
  어둡게 — 이미지 위에 덮는 검정의 농도. 밝은 사진을 그대로 깔면 흐린 글자
  (`--fg-muted`)와 경계선이 곧바로 안 읽히므로, 이것이 **가독성 손잡이**다.
  살아 있는 값(`45%`)은 미는 동안 손잡이 위 말풍선이 보인다(`ValueSlider`).
-->
<SettingRow id="wp-dim" label={t("settings.theme.wallpaper.dim.label")} tip={t("settings.theme.wallpaper.dim.summary")}>
  {#snippet control()}
    <ValueSlider id="wp-dim" min={WALLPAPER_DIM_MIN} max={WALLPAPER_DIM_MAX} step={5} value={settings.wallpaperDim} unit="%" disabled={!settings.wallpaperFile} onchange={setWallpaperDim} />
  {/snippet}
</SettingRow>

<!-- 블러 — 사진의 디테일이 글자와 경쟁하지 않게 하는 두 번째 손잡이 -->
<SettingRow id="wp-blur" label={t("settings.theme.wallpaper.blur.label")} tip={t("settings.theme.wallpaper.blur.summary")}>
  {#snippet control()}
    <ValueSlider id="wp-blur" min={WALLPAPER_BLUR_MIN} max={WALLPAPER_BLUR_MAX} step={1} value={settings.wallpaperBlur} unit="px" disabled={!settings.wallpaperFile} onchange={setWallpaperBlur} />
  {/snippet}
</SettingRow>

<!--
  선택지 이름은 칩에 짧게(채움 · 맞춤 · 타일 반복 · 가운데 — 10-28), 잘림 · 여백 · 원본 크기 같은 차이는
  툴팁(`theme.wallpaper.fit.summary`)이 한 줄로 덧붙인다.
-->
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

<!--
  투명도 슬라이더 — 앱 크롬(사이드바·탭 바·독·글래스 판)과 터미널 밖 타일 면의 불투명도 %.
  낮출수록 앱 배경(월페이퍼 · 없으면 번짐)이 비친다 — 창 자체는 늘 불투명이다(10-22, 바탕화면 비침 걷음).
  theme.css 가 기저색 × --chrome-pct 로 `--bg`/`--bg-panel` 을 합성하므로 앱 테마에서
  고른 커스텀 색에도 그대로 먹는다. 터미널 타일은 이 값과 무관하다 — 바로 아래
  **터미널 투명도**가 그 칸을 따로 맡는다.
  화면 반영은 +page.svelte 의 $effect 가 한다 — 여기서는 상태만 바꾼다
  (webgl·합자와 같은 즉시 반영 계약).
-->
<SettingRow id="app-opacity" label={t("settings.theme.color.opacity.label")} tip={t("settings.theme.color.opacity.summary")}>
  {#snippet control()}
    <ValueSlider id="app-opacity" min={OPACITY_MIN} max={OPACITY_MAX} step={5} value={settings.opacity} unit="%" onchange={setOpacity} />
  {/snippet}
</SettingRow>

<!--
  터미널 투명도 — 위 크롬 슬라이더의 **짝이자 별개**다 (`[terminal] opacity`).
  바로 아래 붙여 두는 이유는 두 값을 나란히 보며 맞추는 것이 이 설정의 사용법이기
  때문이다: 크롬을 40 까지 내려도 터미널을 85 쯤에 두면 글자는 그대로 읽힌다.
  100 이면 렌더 경로가 예전과 완전히 같다 (allowTransparency 조차 켜지 않는다).
-->
<SettingRow id="term-opacity" label={t("settings.theme.color.term_opacity.label")} tip={t("settings.theme.color.term_opacity.summary")}>
  {#snippet control()}
    <ValueSlider id="term-opacity" min={TERM_OPACITY_MIN} max={TERM_OPACITY_MAX} step={5} value={settings.termOpacity} unit="%" onchange={setTermOpacity} />
  {/snippet}
</SettingRow>

<!--
  아바타 — 지금 지정된 그림 셋만 작게(앱 아이콘 = 둥근 사각 · AI CLI = 동그라미) + [설정 ›] → 아바타 하위 화면(`AvatarsSection`).
  아티스트 얼굴은 넣지 않는다 — 아티스트마다 따로 정하는 그림이라 "지정" 셋과 층이 다르고, 수가 늘면 줄이 넘친다(하위 화면에 줄이 있다).
-->
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

<!--
  재질 — 앱 크롬(탭 줄·상태바·독·떠 있는 면)을 유리(반투명 + 앱 안 흐림)로 그릴지 평면으로 그릴지
  (2026-10-11, 기본 글래스). 색과 독립된 축이라 색 테마 칸이 아니라 모양 쪽 탭 모양 위에 둔다.
-->
<h4 class="subhead">{t("settings.theme.material.label")}</h4>
<div class="rows term">
  <div class="srow">
    <!-- 소제목과 라벨이 같은 문구라 키 하나를 함께 쓴다. -->
    <TipName
      id="material"
      label={t("settings.theme.material.label")}
      tip={t("settings.theme.material.summary")}
    />
    <ChoiceChips id="material" labelledby="material-label" entries={MATERIAL_ENTRIES} icons={MATERIAL_ICONS} value={settings.material} onpick={setMaterial} />
  </div>
</div>

<!--
  탭 바 모양 — 앱 크롬의 모양이라 이 섹션(앱 테마)에 둔다. 순수 CSS 로 그리는 두 가지
  (알약·평면). 글리프 폰트에 의존하지 않으므로 어느 윈도 기기에서도
  두부(tofu)가 나지 않는다 (Tabs.svelte).
-->
<h4 class="subhead">{t("settings.theme.tabs.style.label")}</h4>
<div class="rows term">
  <div class="srow">
    <!-- 소제목과 라벨이 같은 문구라 키 하나를 함께 쓴다. -->
    <TipName
      id="tab-style"
      label={t("settings.theme.tabs.style.label")}
      tip={t("settings.theme.tabs.summary")}
    />
    <ChoiceChips id="tab-style" labelledby="tab-style-label" entries={TAB_STYLE_ENTRIES} icons={TAB_STYLE_ICONS} value={settings.tabStyle} onpick={setTabStyle} />
  </div>

  <!--
    창 단추 (2026-10-28) — `[app] window_controls`. 탭 바 오른쪽 끝의 최소화 · 최대화 · 닫기(`chrome/WindowTitlebar`). 기본 끔 —
    닫기는 독의 [끝내기…] 모달, 최대화는 탭 뒤 빈 곳 더블클릭, 최소화는 OS 단축키가 맡는다.
  -->
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

<!--
  상태바 — 앱 크롬의 얇은 띠다. `settings.toml` 에서는 `[app] status_bar`·
  `[app] status_bar_style` 인 앱 값이라 예전 터미널 섹션에서 이리로 옮겼다 (터미널 안쪽
  팔레트가 아니라 창 크롬 값이다). 자리(어느 가장자리)와 모양을 여기서 고른다.
-->
<h4 class="subhead">{t("settings.theme.statusbar.label")}</h4>
<div class="rows term">
  <!--
    상태바 자리 — 독으로 드는 마우스 진입 하나와 활성 타일의 상태 점을 담는 얇은 띠를
    어느 가장자리에 둘지 고른다 (기본 위).
  -->
  <div class="srow">
    <!-- 소제목과 라벨이 같은 문구라 키 하나를 함께 쓴다. -->
    <TipName
      id="status-bar"
      label={t("settings.theme.statusbar.label")}
      tip={tipOf(t("settings.theme.statusbar.summary"), t("settings.theme.statusbar.note"))}
    />
    <ChoiceChips id="status-bar" labelledby="status-bar-label" entries={STATUS_BAR_ENTRIES} icons={STATUS_BAR_ICONS} value={settings.statusBar} onpick={setStatusBar} />
  </div>

  <div class="srow">
    <!--
      상태바 모양 — 자리 바로 다음이다. 평면(지금까지의 띠)·둥근 패널(타일처럼 띄움) 중에
      고른다 (기본 평면).
    -->
    <TipName
      id="status-bar-style"
      label={t("settings.theme.statusbar.style.label")}
      tip={t("settings.theme.statusbar.style.summary")}
    />
    <ChoiceChips id="status-bar-style" labelledby="status-bar-style-label" entries={STATUS_BAR_STYLE_ENTRIES} icons={STATUS_BAR_STYLE_ICONS} value={settings.statusBarStyle} onpick={setStatusBarStyle} />
  </div>

  <!--
    자원 고리 (2026-10-17 — 로컬 자원 모니터) — 상태바 가운데 묶음의 CPU · 메모리 고리(이 PC 전체). 상태바 묶음의 마지막 줄이다(10-28 — 예전엔 독 배치 밑 홀로 선 줄).
    끄면 고리가 서지 않고 상태바 몫의 표본 당김도 멈춘다 — 타일 자원 칩 · 자원 화면은 그대로다.
  -->
  <div class="srow">
    <TipName
      id="app-resource-rings"
      label={t("settings.theme.statusbar.resources.label")}
      tip={tipOf(t("settings.theme.statusbar.resources.summary"), t("settings.theme.statusbar.resources.note"))}
      for="app-resource-rings"
    />
    <Toggle id="app-resource-rings" checked={settings.resourceRings} onchange={setResourceRings} />
  </div>
  <!-- 사용량 고리 (2026-11-08) — 같은 묶음의 AI CLI 사용 한도 고리. 끄면 고리만 서지 않는다(사용량 화면은 그대로). -->
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

<!--
  독 배치 (2026-10-23 — docs/log/2026-10-23-side-chat-dock.md) — `[dock] layout`. 런처 독이 선 쪽을 고르고 채팅 독은 늘 반대쪽이다.
  상태바 자리와 무관하다(예전에는 상태바가 오른쪽이면 런처가 오른쪽이었다).
  고르는 칩의 글자 자리에 **작은 창 그림**을 넣는다(10-28) — 런처 띠는 강조색, 채팅 띠는 회색, 가운데는 타일 둘.
  글자("런처 왼쪽 · 채팅 오른쪽")는 접근성 이름 · 툴팁으로만 남는다. `data-value` 는 `ChoiceChips` 와 같다(하네스 손잡이).
-->
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
    <!--
      타일 배치 (docs/log/2026-09-04-spiral-tiling.md).

      `settings.toml` 에서는 `[app] tiling` 이고, 화면에서는 **타일** 묶음의 첫 줄이다 —
      바로 아래 타일 헤더와 함께 "타일이 어떻게 보이는가" 를 정한다. 방향을 사람이 이미 고른
      길(타일 헤더 ⋯ 메뉴의 좌우/상하 분할, 끌어다 놓기 4분면)에는 어느 쪽도 끼어들지 않는다.
    -->
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
    <!-- 칩 모양은 `ChoiceChips` 와 같고, 아이콘 자리에 배치 그림(`TILING_PICTURES`)이 선다 — 글자는 그대로 둔다 -->
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
    <!--
      타일 헤더 (docs/log/2026-09-05-tile-header.md).

      타일 **배치** 바로 아래다 — 둘 다 타일 자체에 대한 값이라 나란히 읽힌다.
      여기서 고른 값은 **이미 열려 있는 타일에도 즉시** 반영된다 (배치와 다른 점).
    -->
    <TipName
      id="tile-header"
      label={t("settings.theme.tile.header.label")}
      tip={tipOf(t("settings.theme.tile.header.summary"), t("settings.theme.tile.header.note"))}
    />
    <ChoiceChips id="tile-header" labelledby="tile-header-label" entries={TILE_HEADER_ENTRIES} icons={TILE_HEADER_ICONS} value={settings.tileHeader} onpick={setTileHeader} />
  </div>
</div>

<!--
  자원 칩 켬끔은 2026-10-18 부터 설정 › 터미널의 "타일 머리줄 칩" 줄이 다른 칩과 함께 쥔다(`TerminalSection` · `HeaderChipsSetting`).
-->
{/if}
</SubViewStack>

<style>
  /* ── 아바타 줄 — 지정된 그림 셋 + [설정 ›] ── */
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

  /* 색 테마 칩 줄 — 칩 모양은 `settings.css` 의 `.opt-chips`·`.opt-chip` (고르는 칸과 공용) */
  .palette-chips {
    margin: var(--space-3) 0;
  }

  /* ── 월페이퍼 ───────────────────────────────────────────────────────────── */

  /* 썸네일(남는 폭 전부) | 오른쪽 열(버튼 줄 폭). 둘이 한 줄에 안 들어가면(썸네일 240px +
     버튼 줄) 오른쪽 열이 다음 줄로 내려가 전체 폭을 쓰고, 그래도 좁으면 버튼이 줄을 바꾼다. */
  /* stretch — 오른쪽 열이 썸네일 높이만큼 늘어나 밝기 버튼이 남은 높이를 채운다 */
  .wp-pick {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: var(--space-4);
  }

  /* 썸네일 — 오른쪽 열(버튼 줄 폭)을 뺀 나머지 폭을 전부 쓰고, 높이는 150px 고정(cover 로 자른다).
     어둡게·블러는 여기 반영하지 않는다: 축소된 그림에 같은 px 블러를 걸면 실제보다 훨씬
     뭉개져 보여 거짓말이 된다. 진짜 미리보기는 **앱 자신**이다 (모든 변경이 즉시 적용된다). */
  /* 늘이는 몫 1000 : 1 — 한 줄에 같이 있을 때 남는 폭은 사실상 전부 썸네일이 갖고, 오른쪽 열이
     혼자 다음 줄로 내려가면 그 줄의 폭을 전부 갖는다. */
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

  /* 이미지가 없을 때만 점선 — "빈 자리" 라는 것이 한눈에 보이게 */
  .wp-preview.empty {
    border-style: dashed;
  }

  /* 랜덤 월페이퍼가 걸린 썸네일 — 누르면 원본 게시물이 열린다 */
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

  /* 버튼 줄(auto) · 밝기(남은 높이 전부) */
  .wp-side {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: var(--space-2);
  }

  /* 넓을 때는 한 줄 — 이 줄의 폭(기본 크기)이 곧 오른쪽 열의 폭이다. 패널이 그보다 좁으면 줄을 바꾼다 */
  .wp-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  /* 밝기 — 큰 둥근 네모 단추 둘(아이콘 위 · 글자 아래 — 실기 피드백으로 segmented 알약에서 되돌림). 버튼 줄 폭을 반씩 채운다.
     색은 MD3: 안 고른 것 = surfaceContainerHigh + onSurfaceVariant, 고른 것 = secondaryContainer + onSecondaryContainer(아이콘 굵게) */
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

  /* 포커스 링은 중성 — 모양(18px)을 따라 둥글다 */
  .mode-option:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  /* ── 독 배치 — 칩 안의 작은 창 그림 ─────────────────────────────────────
     칩 모양은 이웃 줄과 같은 `.opt-chip`(이어 붙은 묶음 · 고른 칸은 알약), 글자 자리에 [띠 | 타일 | 타일 | 띠] 그림 하나.
     런처 띠 = 강조색(`--accent`), 채팅 띠 = 글자색 옅게 — 두 독이 색으로 갈린다. 크기는 글자 한 줄 높이에 맞춘다. */
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

  /* 띠 안에 그 독의 아이콘 — 런처 = 독(`dock`), 채팅 = AI(`ai`) */
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

  /* ── 타일 배치 — 칩 안의 배치 그림 (`TILING_PICTURES`) ── */
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

  /* 상태에 따라 글자가 바뀌는 단추 — 두 글자를 같은 칸에 겹쳐 놓고 안 쓰는 쪽은 자리만 차지한다(폭 = 긴 쪽) */
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

  /* 실패 한 줄 — 실패색의 옅은 판 (테두리 없이) */
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
