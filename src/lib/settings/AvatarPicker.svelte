<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { loadUserAppIcons } from "$lib/app/app-icons.svelte.js";
  import { BUILTIN_AVATARS, avatarLabel, avatarLibrary, builtinAvatarThumb, type UserAvatar } from "$lib/avatars.svelte.js";

  /**
   * **아바타 고르기 격자** — 내장 썸네일 넷(기본 GPT 가 앞) 뒤에 **사용자 아바타**(넣은 순서). 설정 › 테마 › 아바타의 지정 줄 [바꾸기]
   * 팝오버(`AvatarsSection.svelte`)가 그린다(docs/log/2026-10-31-avatars.md · 옛 `AppIconPicker` — docs/log/2026-10-22-custom-app-icon.md).
   * 지금 값(`value`)이 칠해지고 누르면 `onpick(id)` — 사용자 칩이면 그 줄(`UserAvatar`)도 함께 넘긴다(앱 아이콘은 스플래시 사본에 썸네일을
   * 적는다). 넣기 · 이름 · 지우기는 라이브러리 카드가 맡는다(이 격자는 고르기만).
   *
   * 모양은 동그라미(아티스트 얼굴과 같다), `square` 면 둥근 사각 — 앱 아이콘 줄만(창 · 작업 표시줄 아이콘 모양 그대로). 내장 썸네일은
   * `scripts/gen-character-icons.py` 가 만든 96px 정적 자산이고, 사용자 썸네일은 Rust 가 만든 96px data URL(`app_icon_list` — asset
   * 프로토콜 범위를 넓히지 않는다)이다. 둘 다 `$lib/avatars.svelte` 가 쥔다. 고른 칸은 강조색 고리(목업 — 이어 붙은 `.opt-chip` 묶음이 아니다).
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
    /** 지금 고른 id */
    value?: string | null;
    onpick: (id: string, user?: UserAvatar) => void;
    /** 둥근 사각 썸네일 — 앱 아이콘 줄만. 나머지는 동그라미 */
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
  /* 여섯 칸 격자 — 팝오버 폭(약 380px)에 맞춘다 */
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

  /* 동그라미 — 칸도 그림도 원(아티스트 얼굴과 같은 모양) */
  .avatars.round .avatar,
  .avatars.round .avatar img {
    border-radius: 50%;
  }
</style>
