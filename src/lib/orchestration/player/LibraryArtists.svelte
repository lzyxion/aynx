<script lang="ts">
  // 라이브러리 왼쪽 아티스트 칸 — 머리의 [+ 새 아티스트] 알약 + 카드 줄. 누르면 아티스트 화면으로 간다(편집은 거기서만).
  // 접으면 아바타만 있는 좁은 세로 띠(툴팁 = 이름 · CLI · 종류). 접힘은 이 브라우저 · 이 창의 편의라 localStorage(창 라벨별 · 막히면 이 페이지 동안만).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { currentWindowLabel } from "$lib/context";
  import { openArtists } from "$lib/app/orchestration.svelte.js";
  import { createArtistLoader } from "../artist-loader.svelte.js";
  import type { ArtistProfile } from "../artist-form";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import { requestArtistNew, requestArtistPick } from "./Artists.svelte";
  let { visible }: { visible: boolean } = $props();
  const artists = createArtistLoader();
  $effect(() => { if (visible) return artists.subscribe(); });

  // 창마다 따로 — 창 라벨을 키에 붙인다(다른 창에서 접어도 이 창은 그대로 · 같은 라벨로 다시 켜면 기억 · 창 API 없는 곳은 "main")
  const COLLAPSED_KEY = `aynx:orch:artists-collapsed:${currentWindowLabel()}`;
  function readCollapsed() { try { return localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { return false; } }
  let collapsed = $state(readCollapsed());
  function toggle() {
    collapsed = !collapsed;
    try { if (collapsed) localStorage.setItem(COLLAPSED_KEY, "1"); else localStorage.removeItem(COLLAPSED_KEY); } catch { /* 막힌 저장소 — 이 페이지 동안만 */ }
  }
  function cliName(cli: string) { return cli === "claude" ? "Claude" : "Codex"; }
  function kindName(a: ArtistProfile) { return t(a.kind === "write" ? "orch.artists.write" : "orch.artists.judge"); }
  /** 그 아티스트를 고른 채로 아티스트 화면을 연다 */
  function open(a: ArtistProfile) { requestArtistPick(a.id); openArtists(); }
  /** 새 아티스트 폼을 연 채로 아티스트 화면을 연다 */
  function create() { requestArtistNew(); openArtists(); }
  const toggleLabel = $derived(t(collapsed ? "orch.library.artistsExpand" : "orch.library.artistsCollapse"));
</script>

<aside class="artists glass-mid" class:collapsed data-library-artists data-collapsed={collapsed ? "" : undefined} aria-label={t("orch.nav.artists")}>
  {#snippet toggleButton()}
    <button type="button" class="toggle" aria-expanded={!collapsed} aria-label={toggleLabel} title={toggleLabel} data-library-artists-toggle onclick={toggle}>
      <UiIcon name={collapsed ? "chevron" : "chevron-left"} size={16} />
    </button>
  {/snippet}
  {#if collapsed}
    {@render toggleButton()}
    {#each artists.list as artist (artist.id)}
      {@const tip = t("orch.library.artistTip", { name: artist.name, cli: cliName(artist.cli), kind: kindName(artist) })}
      <button type="button" class="face" class:judge={artist.kind === "judge"} aria-label={tip} title={tip} data-library-artist={artist.id} onclick={() => open(artist)}>
        <ArtistAvatar cli={artist.cli} profile={artist} size={44} />
      </button>
    {/each}
    <button type="button" class="round add" aria-label={t("orch.artists.new")} title={t("orch.artists.new")} data-artists-create onclick={create}><UiIcon name="plus" size={18} /></button>
  {:else}
    <header><h3>{t("orch.nav.artists")}</h3><span class="head-end"><button type="button" class="btn btn-primary new-pill" data-artists-create onclick={create}><UiIcon name="plus" size={14} />{t("orch.artists.new")}</button>{@render toggleButton()}</span></header>
    {#each artists.list as artist (artist.id)}
      <button type="button" class="card" class:judge={artist.kind === "judge"} data-library-artist={artist.id} onclick={() => open(artist)}>
        <ArtistAvatar cli={artist.cli} profile={artist} size={44} />
        <span class="text"><b>{artist.name}</b><small>{cliName(artist.cli)} · {artist.model || t("orch.artists.defaultModelShort")} · {kindName(artist)}</small></span>
      </button>
    {:else}<p class="lead">{t("orch.artists.empty")}</p>{/each}
  {/if}
  {#if artists.error}<p role="alert" class="lead">{artists.error}</p>{/if}
</aside>

<style>
  /* 폭은 칸 자신이 쥔다(라이브러리 격자는 `auto` 열) — 접힘 ↔ 펼침이 폭 전환 하나로 움직인다 */
  .artists { box-sizing: border-box; width: 300px; padding: 20px; border-radius: var(--radius-surface); background: var(--bg-panel); overflow: hidden auto; min-height: 0; display: flex; flex-direction: column; gap: 14px; }
  .artists.collapsed { width: 76px; padding: 14px 0; align-items: center; gap: 10px; }
  @media (prefers-reduced-motion: no-preference) { .artists { transition: width var(--edge-dock-dur) var(--edge-dock-ease), padding var(--edge-dock-dur) var(--edge-dock-ease); } }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .head-end { display: flex; align-items: center; gap: 2px; }
  h3 { margin: 0; font-size: 17px; font-weight: var(--fw-semibold); white-space: nowrap; }
  /* [+ 새 아티스트] — 알약(라이브러리 [새 앨범]과 같은 강조 계열, 한 단계 작게) */
  .new-pill { flex: 0 0 auto; height: 30px; padding: 0 12px 0 10px; gap: 5px; font-size: var(--t-xs); white-space: nowrap; }
  .toggle { flex: 0 0 auto; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: transparent; color: var(--fg-2); cursor: pointer; }
  .toggle:hover { background: var(--control-ghost-hover); color: var(--fg-1); }
  .card { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 14px; background: var(--control-tile-bg); color: var(--fg-1); font: inherit; text-align: left; cursor: pointer; transition: background-color 120ms ease; }
  .card:hover { background: var(--control-tile-bg-hover); }
  .card:focus-visible, .toggle:focus-visible, .face:focus-visible, .round:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  /* 검토형 = 3차 색 고리(목업) */
  .card.judge :global(.avatar), .face.judge :global(.avatar) { box-shadow: 0 0 0 2px var(--tertiary); }
  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  b, small { display: block; overflow-wrap: anywhere; }
  small { font-size: var(--t-xs); color: var(--fg-2); }
  .add { background: transparent; border: 1px dashed var(--m3-outline-variant, var(--line-strong)); color: var(--fg-2); }
  .add:hover { background: var(--control-ghost-hover); color: var(--fg-1); }
  /* 접힌 띠 — 아바타 · 원형 + */
  .face { flex: 0 0 auto; padding: 2px; border: 0; border-radius: 50%; background: transparent; display: flex; cursor: pointer; }
  .face:hover { background: var(--control-ghost-hover); }
  .round { flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: inherit; cursor: pointer; }
  .round.add { border-width: 1px; }
  /* 좁은 폭 — 칸이 라이브러리 위로 쌓인다. 접힘은 아바타 가로 줄, 화살표는 위(접기) · 아래(펼치기) */
  @container (max-width: 720px) {
    .artists { width: auto; overflow: visible; }
    .artists.collapsed { flex-direction: row; flex-wrap: wrap; padding: 10px 14px; }
    .toggle :global(.ui-icon) { transform: rotate(90deg); }
    .collapsed .toggle { order: 1; margin-left: auto; }
  }
</style>
