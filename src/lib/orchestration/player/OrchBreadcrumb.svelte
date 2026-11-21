<script lang="ts">
  // 라이브러리 루트에는 그리지 않는다(부르는 쪽이 판정). ← 는 이 줄 하나만 가진다.
  // `host` 판 안에 놓이면 판의 지금 안쪽 여백만큼 바깥으로 물러나 가장자리에 붙는다(여백이 폭 문턱에서 바뀌어도 크기 관찰로 따라간다).
  import type { Snippet } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { OrchMark } from "$lib/session/spec";
  import type { RunDetail } from "../model/types";
  import { parentOrchPath } from "../orch-tab";
  import { studioLabel } from "$lib/app/studio-projects.svelte.js";
  let { path, detail, onnavigate, end, host }: {
    path: OrchMark; detail: RunDetail | null; onnavigate: (path: OrchMark) => void; end?: Snippet;
    host?: string;
  } = $props();
  let nav = $state<HTMLElement | null>(null);
  let pad = $state({ top: 0, left: 0, right: 0 });
  $effect(() => {
    const el = nav;
    const box = host && el ? el.parentElement?.closest<HTMLElement>(host) : null;
    if (!box) { pad = { top: 0, left: 0, right: 0 }; return; }
    const read = () => { const cs = getComputedStyle(box); pad = { top: parseFloat(cs.paddingTop) || 0, left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0 }; };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  });
  const task = $derived(detail?.tasks.find((task) => task.id === path.taskId));
  const no = $derived(detail ? detail.tasks.findIndex((task) => task.id === path.taskId) + 1 : 0);
  const backTitle = $derived(path.view === "track" ? t("orch.artist.back.title") : t("orch.nav.back"));
</script>

<nav class="path" data-orch-path={path.view} aria-label={t("orch.home.library")} bind:this={nav} style:margin="{-pad.top}px {-pad.right}px 0 {-pad.left}px">
  {#if path.view !== "library"}<button type="button" class="back" aria-label={backTitle} title={backTitle} data-orch-back onclick={() => onnavigate(parentOrchPath(path))}
      ><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"></path></svg></button
    >{/if}
  <span class="crumbs">
    <button type="button" class="crumb" data-orch-crumb="library" aria-current={path.view === "library" ? "page" : undefined} onclick={() => onnavigate({ view: "library" })}>{t("orch.home.library")}</button>
    {#if path.view === "studio" && path.repo}<span class="sep" aria-hidden="true">›</span><span class="here" aria-current="page" data-orch-crumb="studio" title={path.repo}>{studioLabel(path.repo)}</span>{/if}
    {#if path.fromRepo}<span class="sep" aria-hidden="true">›</span><button type="button" class="crumb" data-orch-crumb="studio" title={path.fromRepo} onclick={() => onnavigate({ view: "studio", repo: path.fromRepo })}>{studioLabel(path.fromRepo)}</button>{/if}
    {#if path.runId}<span class="sep" aria-hidden="true">›</span>{#if path.view === "album"}<span class="here" aria-current="page" data-orch-crumb="album">{detail?.name || path.runId}</span>{:else}<button type="button" class="crumb" data-orch-crumb="album" onclick={() => onnavigate(parentOrchPath(path))}>{detail?.name || path.runId}</button>{/if}{/if}
    {#if path.view === "track"}<span class="sep" aria-hidden="true">›</span><span class="here" aria-current="page" data-orch-crumb="track">{t("orch.nav.track", { no, name: task?.title || path.taskId || "" })}</span>{/if}
    {#if path.view === "artists" || path.view === "new"}<span class="sep" aria-hidden="true">›</span><span class="here" aria-current="page">{t(path.view === "artists" ? "orch.nav.artists" : "orch.tab.preparing")}</span>{/if}
  </span>
  {#if end}<span class="end">{@render end()}</span>{/if}
</nav>

<style>
  /* 높이 고정 — 오른쪽 끝 단추가 화면마다 달라도 줄 높이 · 글자 자리는 같다 */
  .path { display: flex; align-items: center; gap: 8px; min-width: 0; height: 46px; box-sizing: border-box; padding: 14px 24px 0; color: var(--fg-2);
    font-size: 12.5px; font-weight: 400; line-height: 1.4; flex: 0 0 auto; }
  .crumbs { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; overflow: hidden; white-space: nowrap; }
  .crumb { font: inherit; color: var(--fg-2); background: none; border: 0; padding: 0; cursor: pointer; flex: 0 4 auto; min-width: 2.5em; overflow: hidden; text-overflow: ellipsis; }
  .crumb:hover { color: var(--fg-1); text-decoration: underline; }
  .here { color: var(--fg-1); flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .sep { flex: 0 0 auto; color: var(--fg-3); }
  .back { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; padding: 0; border: 0; display: inline-flex; align-items: center; justify-content: center;
    color: var(--fg-1); background: var(--control-bg, var(--surface-hover)); cursor: pointer; }
  .back:hover { background: var(--control-bg-hover, var(--surface-hover)); }
  .back:focus-visible, .crumb:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
  .end { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; }
</style>
