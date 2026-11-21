<script lang="ts">
  // AI 로고 또는 아바타 한 자리 — 장식이다(옆 글자가 이름을 읽어 준다). `mono` 는 로고에만 듣는다
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { aiAvatarSrc } from "$lib/avatars.svelte.js";

  let { name, size = 16, mono = false }: { name: string; size?: number; mono?: boolean } = $props();

  const avatar = $derived(aiAvatarSrc(name, size > 48));
</script>

{#if avatar}
  <img
    class="ai-avatar"
    src={avatar}
    alt=""
    aria-hidden="true"
    draggable="false"
    width={size}
    height={size}
    style:width="{size}px"
    style:height="{size}px"
    data-ai-avatar={name}
  />
{:else}
  <HostIcon icon={iconRef(name)} {size} {mono} />
{/if}

<style>
  .ai-avatar {
    display: inline-block;
    flex: 0 0 auto;
    vertical-align: middle;
    object-fit: cover;
    /* 동그라미 — 둥근 사각은 앱 아이콘에만 쓴다(사용자 결정) */
    border-radius: 50%;
    user-select: none;
  }
</style>
