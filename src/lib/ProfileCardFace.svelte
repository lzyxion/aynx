<script module lang="ts">
  /** 사본 이름은 내용 해시라 푼 URL 을 계속 쓴다 — 빈 URL 은 적지 않는다(그 이름의 사진이 나중에 생길 수 있다) */
  const resolved = new Map<string, string>();
</script>

<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { previewWallpaperFx, profilePreview } from "$lib/profile-preview";
  import type { ThemeProfile } from "$lib/theme-profiles";
  import { wallpaperUrl } from "$lib/wallpaper.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { settings } from "$lib/settings.svelte.js";

  /** 뿌리 요소가 둘(`.thumb` · `.meta`)이다 — 부르는 쪽 단추(`display: grid`) 안에 두 줄로 선다 */
  let {
    profile,
    active = false,
    modified = false,
  }: {
    profile: ThemeProfile;
    active?: boolean;
    modified?: boolean;
  } = $props();

  // ── 배경 사진 URL ────────────────────────────────────────────────────────

  let url = $state("");
  $effect(() => {
    const file = profile.appearance.wallpaper.file;
    if (!file) {
      url = "";
      return;
    }
    const known = resolved.get(file);
    if (known !== undefined) {
      url = known;
      return;
    }
    url = "";
    let live = true;
    void wallpaperUrl(file).then((u) => {
      if (u) resolved.set(file, u);
      if (live) url = u;
    });
    return () => {
      live = false;
    };
  });

  const pv = $derived(profilePreview(profile.appearance, settings.userTermLookup.themes));
  const fx = $derived(previewWallpaperFx(profile.appearance));
</script>

<span class="thumb" style:background-color={pv.bg}>
  {#if url}
    <img
      class="wp"
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      style:filter={fx.blur === "0.0px" ? undefined : `blur(${fx.blur})`}
    />
    <span class="dim" style:background={fx.dim}></span>
  {/if}
  {#if active}
    <span class="badge" class:mod={modified}>
      {modified ? t("settings.theme.profile.badge.modified") : t("settings.theme.profile.badge.active")}
    </span>
  {/if}
</span>

<span class="meta">
  <span class="name">
    {#if active}<span class="check"><UiIcon name="check" size={12} /></span>{/if}
    <span class="label">{profile.name}</span>
  </span>
</span>

<style>
  /* ── 미리 보기 ── */

  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 10;
    overflow: hidden;
  }

  .wp {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* 블러 가장자리의 번짐을 화면 밖으로 — 배경 레이어와 같은 수 */
    transform: scale(1.04);
  }

  .dim {
    position: absolute;
    inset: 0;
  }

  /* 배지는 테마가 아니라 사진 쪽 대비(검은 반투명 판 + 흰 글자) — 앱 모드와 상관없이 같은 값이다 */
  .badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 1px 7px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: #fff;
    background: rgb(0 0 0 / 0.55);
    border-radius: 999px;
    backdrop-filter: blur(4px);
  }

  .badge.mod {
    color: #f3c979;
  }

  /* ── 이름 줄 ── */

  .meta {
    display: grid;
    padding: 8px 12px 9px;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .check {
    display: inline-flex;
    flex: none;
    color: var(--accent);
  }

</style>
