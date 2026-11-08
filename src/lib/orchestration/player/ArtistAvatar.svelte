<script lang="ts">
  // **아티스트 캐릭터 동그라미 하나**(오케스트레이션 탭 ② — 노트 5-1). 그림은 `artists.ts` 의 `artistOf` 하나에서 온다(아바타
  // 라이브러리 — 프로필의 `user:<12hex>` · CLI 별 아바타, docs/log/2026-10-31-avatars.md). 48px 넘는 자리는 256px 원본을 쓴다.
  // 그림이 없는 CLI 는 이름 첫 글자. `ring` 은 겹쳐 놓을 때 바탕색 테두리(목업의 겹친 얼굴).
  import { artistOf } from "../artists";
  import type { ArtistProfile } from "../artist-form";

  let {
    cli,
    size = 22,
    ring = false,
    square = false,
    dim = false,
    profile = null,
  }: { cli: string | null | undefined; size?: number; ring?: boolean; square?: boolean; dim?: boolean; profile?: Pick<ArtistProfile, "name" | "icon"> | null } = $props();

  const art = $derived(artistOf(cli, profile, size > 48));
</script>

<span class="avatar" class:ring class:square class:dim style:width="{size}px" style:height="{size}px" title={art.name} data-artist={art.cli}>
  {#if art.icon}
    <img src={art.icon} alt={art.name} draggable="false" />
  {:else}
    <span class="letter" style:font-size="{Math.round(size * 0.45)}px" aria-label={art.name}>{art.name.slice(0, 1)}</span>
  {/if}
</span>

<style>
  .avatar {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    overflow: hidden;
    background: var(--m3-surface-container-highest, var(--surface-hover));
    box-sizing: content-box;
  }
  .avatar.square {
    border-radius: var(--radius-md, 12px);
  }
  /* 겹친 얼굴 — 바탕색 테두리로 앞 얼굴과 가른다(바탕은 놓인 판의 색을 이어받는다) */
  .avatar.ring {
    border: 2px solid var(--album-bg, var(--m3-surface-container-low, var(--bg-panel)));
  }
  .avatar.dim {
    opacity: 0.7;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
  }
  .letter {
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }
</style>
