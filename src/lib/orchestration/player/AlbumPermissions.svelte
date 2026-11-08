<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { invoke, isRemote } from "$lib/ipc";
  import { runDetail } from "../api";
  import type { RunDetail } from "../model/types";
  import { ALBUM_LIMITS } from "../album-draft";
  import { createArtistLoader } from "../artist-loader.svelte.js";
  import { albumChangeBody, albumPermissionFailureKey, albumPermissionRisk, albumPermissions, albumPermissionsValid, albumWidens } from "../album-permissions";
  import AlbumMembers from "./AlbumMembers.svelte";
  import AlbumRisk from "./AlbumRisk.svelte";
  import AutoMergeField from "./AutoMergeField.svelte";
  import UiIcon from "$lib/UiIcon.svelte";

  let { detail, oncancel, onapplied }: { detail: RunDetail; oncancel: () => void; onapplied: () => void } = $props();
  // 열 때의 rev를 고정한다. 방송 갱신이 미저장 편집을 덮지 않는다.
  let base = $state(untrack(() => structuredClone($state.snapshot(detail))));
  let draft = $state(untrack(() => albumPermissions(base.album!)));
  let confirmed = $state(false);
  let forceWiden = $state(false);
  let forceRisk = $state(false);
  let widenConfirmed = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let stale = $state(false);
  let disposed = false;
  const artists = createArtistLoader();
  $effect(() => artists.subscribe());
  onDestroy(() => { disposed = true; });
  const widened = $derived(forceWiden || albumWidens(base.album!, draft));
  const risk = $derived(forceRisk || albumPermissionRisk(base.album!, draft));
  const dirty = $derived(JSON.stringify(albumPermissions(base.album!)) !== JSON.stringify(draft));
  const ended = $derived(!["running", "paused"].includes(detail.state) || !["running", "paused"].includes(base.state));
  function changed() { confirmed = false; widenConfirmed = false; }
  async function reload() {
    const latest = await runDetail(base.runId);
    if (disposed) return;
    if (!latest.album) throw new Error("[not-found]");
    base = latest; draft = albumPermissions(latest.album); confirmed = false;
    forceWiden = false; forceRisk = false; widenConfirmed = false; stale = false;
  }
  async function apply() {
    if (busy || stale || ended || !dirty || !albumPermissionsValid(draft) || (risk && !confirmed) || (forceWiden && !widenConfirmed)) return;
    busy = true; error = null;
    try {
      await invoke(widened ? "orchestration_album_widen" : "orchestration_album_set", albumChangeBody(base.runId, base.album!, $state.snapshot(draft), widened, confirmed));
      if (!disposed) onapplied();
    } catch (e) {
      if (disposed) return;
      const key = albumPermissionFailureKey(e);
      error = t(key);
      if (key === "orch.perm.failure.album-changed") {
        stale = true;
        try { await reload(); } catch (readError) { if (!disposed) error = `${t(key)} ${t(albumPermissionFailureKey(readError))}`; }
      } else if (key === "orch.perm.failure.widens") {
        forceWiden = true; widenConfirmed = false; confirmed = false;
      } else if (key === "orch.perm.failure.risk-not-confirmed") {
        forceWiden = true; forceRisk = true; confirmed = false;
      }
    } finally { if (!disposed) busy = false; }
  }
  const gradeStatus = (id: string) => base.attempts?.some((a) => a.roleId === id && a.state === "running") ? t("orch.perm.working") : t("orch.perm.waiting");
</script>

<!-- 앨범 판 오른쪽에 붙는 세 번째 칸(목업 V3Album) — 방패 제목 · 원형 ✕ · 한 줄 안내 · 아티스트 행(B 의 공용 조각) · 검증 한 줄 · 기타(늘 보임) · 고정 한도 칩 · 아래 [취소][적용] -->
<form class="panel" data-album-permissions aria-label={t("orch.perm.title")} onsubmit={(e) => { e.preventDefault(); void apply(); }}>
  <header>
    <span class="shield"><UiIcon name="shield-check" size={18} /></span>
    <h2>{t("orch.perm.title")}</h2>
    <button type="button" class="close" disabled={busy} aria-label={t("orch.new.renameCancel")} title={t("orch.new.renameCancel")} onclick={oncancel}><UiIcon name="close" size={12} /></button>
  </header>
  <div class="body">
    <p class="lead">{t("orch.perm.lead")}</p>
    <fieldset disabled={busy || stale || ended}>
      <AlbumMembers bind:members={draft.members} bind:accept={draft.accept} artists={artists.list} original={base.album} tag="perm" onchange={changed} status={gradeStatus} />
      <!-- 검증 — 명령 글자는 시작 때 고정(한 줄), 방식(사람 확인 ↔ 자동 실행)만 바꾼다 -->
      <div class="verify" class:changed={draft.verifyAuto !== base.album?.verifyAuto} title={t("orch.perm.verifyFixed")}>
        <span>{t("orch.new.verify")} <code data-perm-verify-command>{base.verify?.command || t("orch.perm.noVerify")}</code> · {t(draft.verifyAuto ? "orch.new.auto" : "orch.new.confirm")} — {t("orch.perm.fixedAtStart")}</span>
        {#if base.verify?.command}<label class="toggle"><input type="checkbox" data-perm-verify-auto bind:checked={draft.verifyAuto} onchange={changed} />{t("orch.new.auto")}</label>{/if}
      </div>
      <div class:changed={!!draft.autoMerge !== !!base.album?.autoMerge} class="auto-merge"><AutoMergeField tag="perm" enabled={!!base.verify?.command} bind:checked={draft.autoMerge} onchange={changed} /></div>
      <!-- 기타(작업안 도구 · 깨움 상한)는 늘 보이는 칸, 시작 때 고정된 한도는 늘 보이는 작은 칩(목업 V3FoldA — ▶ 펼침 없음) -->
      <div class="more" data-perm-more>
        <span class="group">{t("orch.new.other")}</span>
        <label class="row" class:changed={draft.planTools !== base.album?.planTools}><input type="checkbox" data-perm-plan-tools bind:checked={draft.planTools} onchange={changed} />{t("orch.new.planTools")}</label>
        <label class="row" class:changed={draft.wakeMax !== base.album?.wakeMax}>{t("orch.new.wakeLabel")}<input class="field" type="number" min="0" max="200" data-perm-wake bind:value={draft.wakeMax} oninput={changed} /></label>
      </div>
      <div class="more" data-perm-fixed>
        <span class="group">{t("orch.new.limits")} · {t("orch.perm.fixed")}</span>
        <ul class="fixed">
          {#each ALBUM_LIMITS as l}<li data-perm-fixed-limit={l.key}>{t(l.label)} <b>{base.limits[l.key] ?? "—"}</b></li>{/each}
          <li>{t("orch.perm.verifyTimeout", { n: base.verify?.timeoutMinutes ?? 0 })}</li>
          {#if base.verify?.keepDirs?.length}<li>{t("orch.field.verify.keepDirs")} <code>{base.verify.keepDirs.join(", ")}</code></li>{/if}
          {#if base.verify?.cacheKeyFiles?.length}<li>{t("orch.field.verify.cacheKeys")} <code>{base.verify.cacheKeyFiles.join(", ")}</code></li>{/if}
          {#if base.verify?.extraEnvNames?.length}<li>{t("orch.field.verify.extraEnv")} <code>{base.verify.extraEnvNames.join(", ")}</code></li>{/if}
        </ul>
      </div>
      {#if risk}<AlbumRisk full={draft.members.some((m) => m.grade === "full")} verify={draft.verifyAuto} planTools={draft.planTools} autoMerge={!!draft.autoMerge} bind:confirmed tag="perm" />{/if}
      {#if forceWiden}<label class="row" data-perm-widen-confirm><input type="checkbox" bind:checked={widenConfirmed} />{t("orch.perm.widenConfirm")}</label>{/if}
    </fieldset>
    {#if artists.error}<p role="alert">{artists.error}</p>{/if}
    {#if ended}<p role="status">{t("orch.perm.failure.run-stopped")}</p>{/if}
    {#if error}<p role="alert" data-perm-error>{error}</p>{/if}
    {#if stale}<button type="button" class="btn btn-secondary" disabled={busy} onclick={() => void reload().catch((e) => (error = t(albumPermissionFailureKey(e))))}>{t("orch.new.reload")}</button>{/if}
  </div>
  <footer>
    <p class="note">{#if isRemote}<span data-perm-remote>{t("orch.perm.remote")}</span>{:else}{t("orch.perm.remoteShort")}{/if}</p>
    <div class="buttons">
      <span class="mode" data-perm-mode={widened ? "widen" : "set"} class:widen={widened}>{t(widened ? "orch.perm.widen" : "orch.perm.set")}</span>
      <button type="button" class="pill" disabled={busy} data-perm-cancel onclick={oncancel}>{t("orch.new.renameCancel")}</button>
      <button type="submit" class="pill primary" data-perm-apply disabled={busy || stale || ended || !dirty || !albumPermissionsValid(draft) || (risk && !confirmed) || (forceWiden && !widenConfirmed)}>{t("orch.perm.apply")}</button>
    </div>
  </footer>
</form>

<style>
  .panel { width: 100%; min-width: 0; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 18px;
    background: color-mix(in srgb, var(--accent) 5%, var(--m3-surface-container, var(--bg-panel))); border-left: 1px solid var(--line-faint, var(--line)); color: var(--fg-1); }
  header { display: flex; align-items: center; gap: 8px; }
  .shield { display: inline-flex; color: var(--accent); }
  header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 700; }
  .close { width: 30px; height: 30px; flex: 0 0 auto; border: 0; border-radius: 50%; padding: 0; display: inline-flex; align-items: center; justify-content: center; color: var(--fg-1); background: var(--control-bg, var(--surface-hover)); cursor: pointer; }
  .close:hover:not(:disabled) { background: var(--control-bg-hover, var(--surface-hover)); }
  /* 안내 줄을 머리에 붙이는 -6px 은 스크롤 칸 바깥(이 칸)이 진다 — 안쪽 음수 여백은 글자 윗부분이 잘렸다(실기 10-31) */
  .body { flex: 1; min-height: 0; overflow: hidden auto; display: flex; flex-direction: column; gap: 14px; margin: -6px -4px 0; padding: 0 4px; }
  .lead { margin: 0; font-size: var(--t-xs); color: var(--fg-3); line-height: 1.5; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
  p, code { font-size: var(--t-xs); line-height: 1.6; overflow-wrap: anywhere; }
  p { margin: 0; color: var(--fg-2); }
  code { font-family: var(--font-mono); color: var(--fg-2); }
  .verify { display: flex; flex-direction: column; align-items: flex-start; gap: 6px 10px; padding: 4px 6px; margin: 0 -6px; border-radius: var(--radius-md); font-size: var(--t-xs); color: var(--fg-3); line-height: 1.5; }
  
  .auto-merge { padding: 4px 6px; margin: 0 -6px; border-radius: var(--radius-md); }
  .toggle, .row { display: flex; align-items: center; gap: 8px; font-size: var(--t-xs); color: var(--fg-2); }
  .more { font-size: var(--t-xs); color: var(--fg-3); display: flex; flex-direction: column; gap: 4px; }
  .group { font-size: 11.5px; font-weight: 700; color: var(--fg-3); }
  .fixed { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px 6px; }
  .fixed li { padding: 3px 10px; border-radius: 999px; background: var(--control-bg, var(--surface-hover)); color: var(--fg-3); font-size: 11.5px; line-height: 1.5; overflow-wrap: anywhere; }
  .fixed b { color: var(--fg-1); }
  .row { padding: 4px 6px; border-radius: var(--radius-md); }
  .changed { background: var(--warn-soft); box-shadow: inset 0 0 0 1px var(--warn); }
  .field { width: 72px; height: 26px; box-sizing: border-box; padding: 0 8px; font: inherit; background: var(--surface-field, var(--field-bg)); color: var(--fg-1); border: 1px solid var(--line); border-radius: 999px; text-align: center; }
  footer { display: flex; flex-direction: column; gap: 8px; }
  .note { font-size: 11.5px; color: var(--fg-3); }
  .buttons { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  .mode { flex: 1; min-width: 0; font-size: var(--t-xs); color: var(--fg-3); }
  .mode.widen { color: var(--warn); }
  .pill { font: inherit; font-size: var(--t-sm); border: 0; border-radius: 999px; padding: 8px 16px; color: var(--fg-1); background: var(--control-bg, var(--surface-hover)); cursor: pointer; }
  .pill:hover:not(:disabled) { background: var(--control-bg-hover, var(--surface-hover)); }
  .pill.primary { font-weight: 700; color: var(--on-accent); background: var(--accent); }
  .pill.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--on-accent) 8%, var(--accent)); }
  .pill:disabled { opacity: 0.5; cursor: default; }
  .pill:focus-visible, .close:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
</style>
