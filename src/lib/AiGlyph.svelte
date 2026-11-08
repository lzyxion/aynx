<script lang="ts">
  // **AI 하나를 그리는 한 자리** — 로고 이름(`aiIconName` 의 답 — `claude` · `codex`)을 받아, 설정 "AI 아이콘 모양"
  // (`[ai] icon_style`)이 아바타면 그 CLI 에 매핑된 아바타 그림을, 아니면 지금까지의 브랜드 로고(`iconRef` → `HostIcon`)를 그린다
  // (docs/log/2026-10-31-avatars.md). 탭 · 타일 머리줄 · 상태바 후미단(`PaneIcon`) · 독/런처 · 채팅 독 · 앱 안 알림이 이것을 지난다 —
  // 판정은 `$lib/avatars.svelte` 의 `aiAvatarSrc` 하나다(로딩 덮개 `term/AiVeil` 도 같은 함수를 큰 그림으로 부른다).
  //
  // 아바타는 **동그라미**로 그린다(아티스트 얼굴과 같다 — 원본의 둥근 사각은 앱 아이콘 칸에만 보인다, 2026-10-31 사용자). `mono`(단색 로고 자리)는 로고에만 듣는다 — 아바타는 그림이다.
  // **장식이다** — 옆 글자가 이름을 읽어 주므로 `aria-hidden`(HostIcon 과 같다).
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
    /* 동그라미 — 오케스트레이션 아티스트 얼굴(`ArtistAvatar`)과 같은 모양. 둥근 사각은 앱 아이콘에만 남는다(2026-10-31 사용자) */
    border-radius: 50%;
    user-select: none;
  }
</style>
