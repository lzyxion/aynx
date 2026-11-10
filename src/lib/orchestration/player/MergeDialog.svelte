<script lang="ts">
  // **[병합] 확인 창**(`album_merge.rs`) — 열 때 서버 검사를 읽고(저장소를 바꾸지 않는다) 본 값(내보낸 머리 · 대상 브랜치)을 실어 병합을 청한다.
  // 서버가 실행 직전에 다시 검사한다 — 막히면 그때의 검사로 이 창을 다시 그린다. 앨범 판은 컨테이너 질의 상자라 고정 위치가 창이 아니라 판에
  // 묶인다 — 그래서 본문 아래로 옮겨 그린다(`ImageMenu` 와 같은 틀). 꼴 · 키는 `ConfirmDialog` 와 같다.
  import { onMount, tick } from "svelte";
  import { trapTab } from "$lib/focus-trap";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { orchReasonText, mergeCheckRows, mergeTracks, mergeWhyText, type MergePreview, type RunDetail } from "$lib/orchestration/model";
  import { mergeAlbum, mergePreview } from "$lib/orchestration/api";
  import { openReportDiff } from "$lib/app/orchestration.svelte.js";

  let {
    detail,
    onclose,
    onmerged,
    oncopy,
  }: { detail: RunDetail; onclose: () => void; onmerged: () => void; oncopy: (branch: string) => void } = $props();

  let preview = $state<MergePreview | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** 병합이 실패했을 때 저장소가 그대로인지 알 수 없다 */
  let unsure = $state(false);
  let dialogEl = $state<HTMLElement | null>(null);
  let firstEl = $state<HTMLButtonElement | null>(null);
  let alive = true;

  const branch = $derived(detail.integration?.exportBranch ?? "");
  const target = $derived(preview?.target ?? detail.integration?.baseBranch ?? "");
  const rows = $derived(preview ? mergeCheckRows(preview, t) : []);
  const tracks = $derived(mergeTracks(detail, t));
  const ready = $derived(preview?.state === "ready");

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  async function load(): Promise<void> {
    loading = true;
    error = null;
    try {
      const p = await mergePreview(detail.runId);
      if (!alive) return;
      preview = p;
      // 터미널에서 이미 병합했다 — 사건이 없으니 앨범 줄도 지금 다시 읽는다.
      if (p.state === "merged") onmerged();
    } catch (e) {
      if (alive) error = orchReasonText(String(e), t);
    } finally {
      if (alive) loading = false;
    }
  }

  async function merge(): Promise<void> {
    const p = preview;
    if (!p?.head || !p.target || busy) return;
    busy = true;
    error = null;
    unsure = false;
    try {
      const r = await mergeAlbum(detail.runId, p.head, p.target);
      if (!alive) return;
      if (r.merged) {
        onmerged();
        onclose();
        return;
      }
      if (r.reason) error = mergeWhyText(r.reason, r.detail, t);
      unsure = r.unchanged === false;
      if (r.preview) preview = r.preview;
      else await load();
    } catch (e) {
      if (alive) error = orchReasonText(String(e), t);
    } finally {
      if (alive) busy = false;
    }
  }

  function viewChanges(): void {
    const p = preview;
    if (!p?.mergeBase || !p.head) return;
    void openReportDiff(detail.repo, { base: p.mergeBase, tip: p.head, branch: p.branch });
    onclose();
  }

  function onKey(ev: KeyboardEvent): void {
    if (dialogEl && trapTab(ev, dialogEl)) return;
    // 앱의 전역 단축키 · 터미널이 이 창의 키를 받지 않게(창 버블 리스너보다 먼저 끊는다).
    ev.stopPropagation();
    if (ev.key === "Escape" && !busy) {
      ev.preventDefault();
      onclose();
    }
  }

  onMount(() => {
    void load();
    void tick().then(() => (firstEl ?? dialogEl)?.focus());
    return () => {
      alive = false;
    };
  });
</script>

<div class="overlay" role="presentation" use:portal onmousedown={(ev) => { if (ev.target === ev.currentTarget && !busy) onclose(); }}>
  <div class="dialog glass-raised" role="dialog" aria-modal="true" aria-labelledby="merge-dialog-title" tabindex="-1" data-merge-dialog data-merge-state={preview?.state ?? "loading"}
    bind:this={dialogEl} onkeydown={onKey}>
    <div class="glass-scroll">
    <h2 id="merge-dialog-title">{t("orch.merge.title", { branch: target })}</h2>
    <div class="route" data-merge-route><span>{branch}</span><span aria-hidden="true">→</span><b>{target || "—"}</b></div>

    {#if loading && !preview}
      <p class="foot" role="status">{t("orch.merge.loading")}</p>
    {:else if preview}
      {#if ready}
        <div class="stats" data-merge-stats>
          <div class="stat"><span>{t("orch.merge.stat.commits")}</span><b>{preview.commits}</b></div>
          <div class="stat"><span>{t("orch.merge.stat.files")}</span><b>{preview.files}</b></div>
          <div class="stat" title={t("orch.merge.stat.lines.title", { add: preview.additions, del: preview.deletions })}><span>{t("orch.merge.stat.lines")}</span><b>+{preview.additions}</b></div>
        </div>
        {#if tracks.length > 0}
          <div class="tracks" data-merge-tracks>
            {#each tracks as tr (tr.id)}<div><b>{tr.title}</b><span>{tr.status}</span></div>{/each}
          </div>
        {/if}
      {/if}
      {#if preview.state === "merged"}
        <p class="foot" data-merge-already>{t("orch.merge.already", { branch: target })}</p>
      {:else}
        <ul class="checks">
          {#each rows as r (r.id)}
            <li class:bad={!r.ok} data-merge-check={r.id} data-ok={r.ok ? "" : undefined}>
              <i aria-hidden="true">{r.ok ? "✓" : "✕"}</i>
              <span>{r.text}{#if r.fix}<small>{r.fix}</small>{/if}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    {#if error}<p class="error" role="alert" data-merge-error>{error}</p>{/if}
    {#if preview && preview.state !== "merged"}
      <p class="foot" data-merge-foot>{t(unsure ? "orch.merge.foot.unsure" : ready ? "orch.merge.foot.ready" : "orch.merge.foot.blocked")}</p>
    {/if}

    <div class="acts">
      {#if ready}
        <button type="button" class="btn btn-ghost left" data-merge-view disabled={busy || !preview?.mergeBase} onclick={viewChanges}>{t("orch.merge.view")}</button>
        <button type="button" class="btn btn-secondary" data-merge-cancel disabled={busy} bind:this={firstEl} onclick={onclose}>{t("orch.merge.cancel")}</button>
      {:else if preview?.state === "merged"}
        <button type="button" class="btn btn-secondary" data-merge-cancel bind:this={firstEl} onclick={onclose}>{t("orch.merge.close")}</button>
      {:else}
        <button type="button" class="btn btn-ghost left" data-merge-copy onclick={() => oncopy(branch)}>{t("orch.integration.merge.copy")}</button>
        <button type="button" class="btn btn-secondary" data-merge-recheck disabled={loading || busy} bind:this={firstEl} onclick={() => void load()}>{t("orch.merge.recheck")}</button>
      {/if}
      {#if preview?.state !== "merged"}
        <button type="button" class="btn btn-primary" data-merge-ok disabled={!ready || loading || busy} onclick={() => void merge()}>{t("orch.merge.btn")}</button>
      {/if}
    </div>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 112; display: grid; place-items: center; padding: var(--space-4); background: rgb(0 0 0 / 0.3); }
  .dialog {
    display: flex; flex-direction: column; width: min(460px, 100%); max-height: calc(100vh - 32px); overflow: hidden; box-sizing: border-box; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) — 흐림 층이 밑동까지 덮게 */
    background: var(--glass-raised, var(--surface-raised-solid)); border: 1px solid var(--line); border-radius: var(--radius-surface); box-shadow: var(--shadow-raised); color: var(--fg-1); outline: none;
  }
  .glass-scroll { display: grid; gap: 14px; padding: 22px 24px; }
  h2 { margin: 0; font-size: 18px; font-weight: var(--fw-semibold); }
  .route { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--t-xs); color: var(--fg-2); overflow-wrap: anywhere; }
  .route b { font-weight: 500; color: var(--accent); }
  .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .stat { display: grid; padding: 8px 12px; border-radius: var(--radius-md); background: var(--surface-hover); }
  .stat span { font-size: 11.5px; color: var(--fg-3); }
  .stat b { font-size: 17px; font-variant-numeric: tabular-nums; }
  .tracks { display: grid; gap: 6px; font-size: var(--t-sm); }
  .tracks div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
  .tracks b { flex: 1 1 130px; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
  .tracks span { font-size: var(--t-xs); color: var(--ok); }
  .checks { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--t-sm); }
  .checks li { display: flex; align-items: baseline; gap: 8px; min-width: 0; color: var(--fg-2); }
  .checks li.bad { color: var(--fg-1); }
  .checks i { flex: none; width: 14px; font-style: normal; font-weight: 700; text-align: center; color: var(--ok); }
  .checks li.bad i { color: var(--err); }
  .checks small { display: block; font-size: var(--t-xs); color: var(--fg-3); overflow-wrap: anywhere; }
  .foot { margin: 0; font-size: var(--t-xs); color: var(--fg-3); }
  .error { margin: 0; padding: var(--space-1) var(--space-2); font-size: var(--t-sm); color: var(--fg-1); background: var(--err-soft); border-radius: var(--radius-sm); user-select: text; overflow-wrap: anywhere; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
  .acts .left { margin-right: auto; }
  @media (pointer: coarse) { .acts button { min-height: 44px; padding-inline: 18px; } }
</style>
