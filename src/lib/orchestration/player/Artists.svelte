<script lang="ts" module>
  /** 다른 화면(라이브러리 아티스트 칸)이 "이 아티스트를 골라 열어 달라" 고 남기는 자리 — 화면이 목록을 받으면 한 번 고르고 걷는다 */
  let pendingPick = $state<string | null>(null);
  export function requestArtistPick(id: string) { pendingPick = id; }
  /** 새 아티스트 폼을 연 채로 열어 달라(라이브러리 칸의 [+ 새 아티스트]) */
  export function requestArtistNew() { pendingPick = NEW_ARTIST; }
  /** 아티스트 id(`a-` + 8hex)와 겹치지 않는 표지 */
  const NEW_ARTIST = "+new";
</script>

<script lang="ts">
  // 아티스트 화면(목업 V3Artists): 왼쪽 격자 카드 + 점선 [새 아티스트] · 오른쪽 편집 판(아바타 연필 → 내장 캐릭터 고르기).
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import Combobox from "$lib/Combobox.svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import { createArtistLoader } from "../artist-loader.svelte.js";
  import { artistDirty, artistFormError, artistInUseRunIds, blankArtist, type ArtistInput, type ArtistProfile } from "../artist-form";
  import { artistRemove, artistSet, runSnapshot } from "../api";
  import { artistIconChoices, isBuiltinArtistIcon } from "../artists";
  import { avatarLabel, refreshAvatars } from "$lib/avatars.svelte.js";
  import { EFFORTS, MODEL_SUGGESTIONS, type RoleCli } from "../config";
  import ArtistAvatar from "./ArtistAvatar.svelte";

  /** `crumb` — 판의 경로 줄(원형 ← · 라이브러리 › 아티스트). 목업대로 판 안 맨 위 한 줄(두 칸 위) */
  let { visible, crumb }: { visible: boolean; crumb?: Snippet } = $props();
  const artists = createArtistLoader();
  let form = $state<ArtistInput>(blankArtist());
  let original = $state<ArtistProfile | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);
  let blockedAlbums = $state<string[] | null>(null);
  let iconOpen = $state(false);
  const validation = $derived(artistFormError(form, original));
  /** 바뀐 것이 있을 때만 [저장] — 고르기만 한 기존 아티스트는 꺼 둔다 */
  const dirty = $derived(artistDirty(form, original));
  const efforts = $derived(EFFORTS[form.cli].map((value) => ({ value, label: value || t("orch.config.role.cliDefault") })));

  $effect(() => { if (visible) return artists.subscribe(); });
  $effect(() => {
    const id = pendingPick;
    if (id === NEW_ARTIST) { if (visible && !busy) { pendingPick = null; pick(null); } return; }
    const artist = id ? artists.list.find((a) => a.id === id) : undefined;
    if (!visible || !artist || busy) return;
    pendingPick = null;
    pick(artist);
  });

  function pick(artist: ArtistProfile | null) {
    if (busy) return;
    original = artist ? { ...artist } : null;
    form = artist ? { ...artist } : blankArtist();
    error = null; saved = false; blockedAlbums = null; iconOpen = false;
  }
  let pencil = $state<HTMLButtonElement | null>(null);
  /** 팝오버를 닫고 포커스를 연필로 돌려준다(팝오버 안의 포커스가 사라져 body 로 떨어지지 않게) */
  function closeIcons() { iconOpen = false; pencil?.focus(); }
  function focusFirstIcon(node: HTMLElement) { (node.querySelector<HTMLButtonElement>("button.icon.chosen") ?? node.querySelector<HTMLButtonElement>("button.icon"))?.focus(); }
  function changeCli(cli: RoleCli) {
    form.cli = cli;
    if (!EFFORTS[cli].includes(form.effort)) form.effort = "";
  }
  function cliName(cli: string) { return cli === "claude" ? "Claude" : "Codex"; }
  function meta(a: ArtistProfile) {
    return [cliName(a.cli), a.model || t("orch.artists.defaultModel"), ...(a.effort ? [t("orch.artists.effortMeta", { effort: a.effort })] : [])].join(" · ");
  }
  async function save() {
    if (busy || validation) return;
    busy = true; error = null; saved = false; blockedAlbums = null;
    try {
      const next = await artistSet({ ...form, name: form.name.trim(), model: form.model.trim(), ...(original ? { kind: original.kind } : {}) });
      original = { ...next }; form = { ...next }; saved = true;
      await artists.load();
    } catch (e) { error = String(e); }
    finally { busy = false; }
  }
  async function remove() {
    if (busy || !original) return;
    busy = true; error = null; saved = false; blockedAlbums = null;
    try {
      await artistRemove(original.id);
      original = null; form = blankArtist();
      await artists.load();
    } catch (e) {
      const ids = artistInUseRunIds(e);
      if (ids === null) error = String(e);
      else {
        const runs = await runSnapshot().catch(() => []);
        blockedAlbums = ids.map((id) => runs.find((r) => r.runId === id)?.name || id);
      }
    } finally { busy = false; }
  }
</script>

<div class="artists" data-orch-artists>
  <div class="panel">
    {#if crumb}<div class="crumb">{@render crumb()}</div>{/if}
    <section class="list">
      <header><h2>{t("orch.nav.artists")}</h2><span class="lead">· {t("orch.artists.lead")}</span></header>
      <div class="grid">
        {#each artists.list as artist (artist.id)}
          <button type="button" class="card" class:selected={original?.id === artist.id} class:judge={artist.kind === "judge"} data-artist-card={artist.id} disabled={busy} onclick={() => pick(artist)}>
            <ArtistAvatar cli={artist.cli} profile={artist} size={88} />
            <b>{artist.name}</b>
            <small>{meta(artist)}</small>
            <span class="badge" data-kind={artist.kind}>{t(artist.kind === "write" ? "orch.artists.write" : "orch.artists.judge")}</span>
          </button>
        {/each}
        <button type="button" class="card add" class:selected={original === null} data-artist-new disabled={busy} onclick={() => pick(null)}>
          <span class="plus" aria-hidden="true"><UiIcon name="plus" size={22} /></span>
          <b>{t("orch.artists.new")}</b>
        </button>
      </div>
      {#if artists.list.length === 0}<p class="lead">{t("orch.artists.empty")}</p>{/if}
      {#if artists.error}<p role="alert" class="error">{artists.error}</p>{/if}
    </section>

    <form class="editor" data-artist-editor aria-label={original ? original.name : t("orch.artists.new")} onsubmit={(e) => { e.preventDefault(); void save(); }}>
      <div class="body">
      <div class="ident">
        <!-- 팝오버가 열린 동안의 Esc 는 포커스가 연필에 남았어도(마우스로 연 뒤) 여기서 먹는다 — 창의 Esc 사슬(handleOrchEscape)로 새지 않게 -->
        <span class="face" role="presentation" onkeydown={(e) => { if (iconOpen && e.key === "Escape" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); closeIcons(); } }}>
          <ArtistAvatar cli={form.icon === "gpt" ? "codex" : form.icon} profile={{ name: form.name || form.icon, icon: form.icon }} size={56} />
          <button type="button" class="pencil" bind:this={pencil} aria-label={t("orch.artists.changeIcon")} title={t("orch.artists.changeIcon")} aria-expanded={iconOpen} data-artist-icon-toggle disabled={busy} onclick={() => { iconOpen = !iconOpen; if (iconOpen) void refreshAvatars(); }}><UiIcon name="edit" size={13} /></button>
          {#if iconOpen}
            <!-- 아바타 고르기 — 내장 낱말 뒤에 아바타 라이브러리의 사용자 그림(`user:<12hex>` — 10-31). 열리면 첫 아이콘에 포커스.
                 Esc 는 탭의 한 단계 위로가 아니라 이 팝오버만 닫는다(.face 의 keydown) -->
            <div class="icon-pop" role="dialog" aria-label={t("orch.artists.icon")} tabindex="-1" use:focusFirstIcon>
              {#each artistIconChoices() as icon (icon)}
                <!-- 사용자 그림은 설정 › 테마 › 아바타에서 붙인 이름(없으면 "사용자 N") -->
                {@const label = isBuiltinArtistIcon(icon) ? icon : (avatarLabel(icon) ?? icon)}
                <button type="button" class="icon" class:chosen={form.icon === icon} aria-label={label} title={label} aria-pressed={form.icon === icon} data-artist-icon={icon} disabled={busy} onclick={() => { form.icon = icon; closeIcons(); }}><ArtistAvatar cli={icon === "gpt" ? "codex" : icon} profile={{ name: label, icon }} size={40} /></button>
              {/each}
            </div>
          {/if}
        </span>
        <label class="name"><span>{t("orch.artists.name")}</span><input class="value" data-artist-name bind:value={form.name} disabled={busy} /></label>
      </div>

      <div class="field"><span id="artist-cli-label">{t("orch.artists.cli")}</span><div class="seg" role="group" aria-labelledby="artist-cli-label">
        {#each ["claude", "codex"] as cli (cli)}<button type="button" class="opt with-face" aria-pressed={form.cli === cli} data-artist-cli={cli} disabled={busy} onclick={() => changeCli(cli as RoleCli)}><ArtistAvatar {cli} size={22} />{cliName(cli)}</button>{/each}
      </div></div>
      <div class="field"><span id="artist-kind-label">{t("orch.artists.kind")}</span><div class="seg" role="group" aria-labelledby="artist-kind-label" title={original ? t("orch.artists.kindLocked") : undefined} data-artist-kind-locked={original ? "" : undefined}>
        {#each ["write", "judge"] as kind (kind)}<button type="button" class="opt" aria-pressed={form.kind === kind} data-artist-kind-choice={kind} disabled={busy || original !== null} onclick={() => (form.kind = kind as "write" | "judge")}>{t(kind === "write" ? "orch.artists.write.long" : "orch.artists.judge.long")}</button>{/each}
      </div></div>
      <div class="pair">
        <label><span>{t("orch.config.role.model")}</span><Combobox inputClass="value" suggestions={MODEL_SUGGESTIONS[form.cli]} placeholder={t("orch.config.role.cliDefault")} disabled={busy} openOnClick data-artist-model bind:value={form.model} /></label>
        <div class="field"><span id="artist-effort-label">{t("orch.artists.effort")}</span><span data-artist-effort><Dropdown value={form.effort} options={efforts} disabled={busy} labelledby="artist-effort-label" onchange={(v) => (form.effort = v)} /></span></div>
      </div>
      <label class="instructions"><span>{t("orch.artists.instructions")}</span><textarea class="value" rows="2" data-artist-instructions bind:value={form.instructions} disabled={busy}></textarea></label>
      <p class="notice"><UiIcon name="shield-check" size={16} /><span>{t("orch.artists.notice.a")}<b>{t("orch.artists.notice.b")}</b>{t("orch.artists.notice.c")}</span></p>
      {#if validation}<p class="error" data-artist-validation>{t(validation)}</p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if blockedAlbums !== null}<p class="error" role="alert" data-artist-in-use>{t("orch.artists.inUse", { names: blockedAlbums.join(", ") })}</p>{/if}
      {#if saved}<p class="ok" role="status" data-artist-saved>{t("orch.artists.saved")}</p>{/if}
      </div>
      <footer>
        <button type="button" class="btn danger" data-artist-remove disabled={busy || !original} onclick={() => void remove()}>{t("orch.artists.remove")}</button>
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost cancel" data-artist-cancel disabled={busy} onclick={() => pick(original)}>{t("orch.artists.cancel")}</button>
        <button type="submit" class="btn btn-primary" data-artist-save disabled={busy || validation !== null || !dirty}>{t("orch.artists.save")}</button>
      </footer>
    </form>
  </div>
</div>

<style>
  .artists { flex: 1; min-height: 0; display: flex; padding: 12px; overflow: auto; }
  .panel { flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 460px); gap: 16px; padding: 16px 24px; background: var(--bg-panel); border-radius: var(--radius-surface); }
  .panel:has(> .crumb) { grid-template-rows: auto minmax(0, 1fr); }
  .crumb { grid-column: 1 / -1; min-width: 0; }
  .list { min-width: 0; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
  header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 26px; font-weight: 800; }
  .lead { margin: 0; font-size: var(--t-xs); color: var(--fg-3); line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
  .card { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px; min-width: 0; border: 0; border-radius: 16px; background: var(--control-tile-bg); color: var(--fg-1); font: inherit; text-align: center; cursor: pointer; transition: background-color 120ms ease; }
  .card:hover:not(:disabled) { background: var(--control-tile-bg-hover); }
  .card:disabled { cursor: default; }
  .card:focus-visible, .pencil:focus-visible, .icon:focus-visible, .opt:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .card.selected { background: color-mix(in srgb, var(--control-sel-bg) 70%, var(--control-tile-bg)); box-shadow: inset 0 0 0 2px var(--accent); }
  .card b { font-size: 16px; }
  .card small { font-size: var(--t-xs); color: var(--fg-2); }
  b, small { display: block; overflow-wrap: anywhere; }
  .card.judge :global(.avatar) { box-shadow: 0 0 0 3px var(--tertiary); }
  .badge { padding: 3px 10px; border-radius: 999px; font-size: var(--t-xs); background: var(--m3-primary-container, var(--accent-soft)); color: var(--m3-on-primary-container, var(--on-accent-soft)); }
  .badge[data-kind="judge"] { background: var(--tertiary-soft); color: var(--m3-on-tertiary-container, var(--fg-1)); }
  .card.add { justify-content: center; min-height: 200px; background: transparent; border: 2px dashed var(--m3-outline-variant, var(--line-strong)); color: var(--fg-2); }
  .card.add:hover:not(:disabled) { background: var(--control-ghost-hover); }
  .card.add.selected { box-shadow: none; border-color: var(--accent); }
  .plus { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--control-bg); color: var(--fg-1); }

  /* 편집 판 */
  /* 편집 칸은 안쪽 몸만 스크롤하고 [지우기] · [취소] · [저장] 줄은 늘 판 아래에 보인다.
     높이 배분: 낮은 창(제목줄 · 재생 막대를 뺀 판 ≈ 480px)에서도 지침 칸까지는 스크롤 없이 보이게 간격을 줄이고, 남는 높이는 지침 칸이 먹는다(아래 안내는 넘치면 몸 안에서 스크롤) */
  .editor { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 10px; padding: 14px 18px; border-radius: 16px; background: var(--control-tile-bg); }
  .body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; margin: -4px; padding: 4px; }
  .body > * { flex-shrink: 0; }
  .body > .instructions { flex: 1 0 auto; }
  .instructions textarea.value { flex: 1; }
  .ident { display: flex; align-items: center; gap: 14px; }
  .face { position: relative; flex: 0 0 auto; }
  .face > :global(.avatar) { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
  .pencil { position: absolute; right: -4px; bottom: -4px; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--surface-raised-solid, var(--bg-panel)); background: var(--control-sel-bg); color: var(--control-sel-fg); display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; }
  /* 사용자 아바타가 붙으면 줄을 넘긴다(한 줄이면 알약 · 여러 줄이면 둥근 판) */
  .icon-pop { position: absolute; left: 0; top: calc(100% + 10px); z-index: 5; display: flex; flex-wrap: wrap; width: max-content; max-width: min(300px, 80vw); gap: 6px; padding: 8px; border-radius: 28px; background: var(--glass-float, var(--surface-raised-solid)); backdrop-filter: var(--glass-filter-raised, none); box-shadow: var(--shadow-raised); }
  .icon { padding: 3px; border: 0; border-radius: 50%; background: transparent; cursor: pointer; display: flex; }
  .icon.chosen { box-shadow: 0 0 0 2px var(--accent); }
  .name { flex: 1; margin: 0; }
  label, .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  label > span, .field > span:first-child { font-size: var(--t-xs); color: var(--fg-3); }
  .value, .editor :global(input.value) { box-sizing: border-box; width: 100%; height: var(--field-height); padding: 0 var(--space-3); background: var(--field-bg, var(--surface-field)); color: var(--fg-1); border: 1px solid transparent; border-radius: var(--field-radius); font: inherit; outline: none; box-shadow: var(--glass-ctl-edge, none); }
  .name .value { font-weight: var(--fw-semibold); }
  .value:hover:not(:disabled, :focus), .editor :global(input.value:hover:not(:disabled, :focus)) { background: var(--control-bg-hover); }
  .value:focus-visible, .editor :global(input.value:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  textarea.value { height: auto; min-height: 60px; padding: 10px 12px; border-radius: var(--field-radius-multi); resize: vertical; line-height: 1.5; }
  /* 알약 세그먼트(목업) — 판 우물 위 고른 칸 = secondaryContainer */
  .seg { display: inline-flex; align-self: flex-start; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 999px; background: var(--field-bg, var(--surface-field)); }
  .opt { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--control-fg); font: inherit; font-size: var(--t-xs); cursor: pointer; white-space: nowrap; }
  .opt.with-face { padding: 0 12px 0 3px; }
  .opt:hover:not(:disabled) { background: var(--control-ghost-hover); color: var(--fg-1); }
  .opt[aria-pressed="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); }
  .opt:disabled { cursor: default; }
  .opt:disabled:not([aria-pressed="true"]) { opacity: 0.5; }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .notice { display: flex; gap: 8px; margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--field-bg, var(--surface-field)); font-size: var(--t-xs); color: var(--fg-2); line-height: 1.55; }
  .notice :global(.ui-icon) { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }
  .notice b { display: inline; color: var(--fg-1); }
  .error { margin: 0; color: var(--err); font-size: var(--t-sm); overflow-wrap: anywhere; }
  .ok { margin: 0; color: var(--ok); font-size: var(--t-sm); }
  footer { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
  footer .btn { height: 40px; padding: 0 22px; font-size: var(--t-sm); font-weight: 500; }
  .danger { color: var(--err); border-color: var(--m3-outline-variant, var(--line-strong)); padding: 0 14px; }
  .danger:hover:not(:disabled) { background: color-mix(in srgb, var(--err) 10%, transparent); }
  .cancel { background: var(--control-bg); color: var(--fg-1); }
  @container (max-width: 720px) {
    .artists { padding: 8px; }
    .panel { flex: none; width: 100%; box-sizing: border-box; align-self: flex-start; grid-template-columns: minmax(0, 1fr); padding: 16px; }
    .list, .editor, .body { overflow: visible; min-height: auto; }
    .pair { grid-template-columns: minmax(0, 1fr); }
  }
</style>
