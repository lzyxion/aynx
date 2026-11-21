<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { loadUserAppIcons } from "$lib/app/app-icons.svelte.js";
  import { BUILTIN_AVATARS, avatarLabel, avatarLibrary, builtinAvatarThumb, type UserAvatar } from "$lib/avatars.svelte.js";

  /**
   * 아바타 고르기 격자 — 고르기만 한다(넣기 · 이름 · 지우기는 라이브러리 카드).
   * 사용자 썸네일은 Rust 가 만든 96px data URL(`app_icon_list`)이다 — asset 프로토콜 범위를 넓히지 않는다.
   */
  let {
    id,
    labelledby,
    value = null,
    onpick,
    square = false,
  }: {
    id: string;
    labelledby?: string;
    value?: string | null;
    onpick: (id: string, user?: UserAvatar) => void;
    square?: boolean;
  } = $props();

  onMount(() => {
    void loadUserAppIcons();
  });
</script>

<div class="avatars" class:round={!square} {id} role="group" aria-labelledby={labelledby}>
  {#each BUILTIN_AVATARS as key (key)}
    {@const label = avatarLabel(key) ?? key}
    <button
      type="button"
      class="avatar"
      class:active={value === key}
      aria-pressed={value === key}
      aria-label={label}
      title={label}
      data-value={key}
      onclick={() => onpick(key)}
    >
      <img src={builtinAvatarThumb(key)} alt="" width="44" height="44" draggable="false" />
    </button>
  {/each}
  {#each avatarLibrary.list as icon (icon.id)}
    {@const label = avatarLabel(icon.id) ?? t("settings.avatars.user", { n: "?" })}
    <button
      type="button"
      class="avatar"
      class:active={value === icon.id}
      aria-pressed={value === icon.id}
      aria-label={label}
      title={label}
      data-value={icon.id}
      onclick={() => onpick(icon.id, icon)}
    >
      <img src={icon.src} alt="" width="44" height="44" draggable="false" />
    </button>
  {/each}
</div>

<style>
  .avatars {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: var(--space-2);
  }

  .avatar {
    display: grid;
    place-items: center;
    padding: 3px;
    background: transparent;
    border: none;
    border-radius: 14px;
    cursor: pointer;
  }

  .avatar:hover {
    background: var(--surface-hover);
  }

  .avatar.active {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .avatar:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .avatar img {
    display: block;
    width: 44px;
    height: 44px;
    border-radius: 11px;
    object-fit: cover;
    user-select: none;
  }

  .avatars.round .avatar,
  .avatars.round .avatar img {
    border-radius: 50%;
  }
</style>
