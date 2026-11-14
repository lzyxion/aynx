<script lang="ts">
  import Toggle from "$lib/Toggle.svelte";
  import { onDestroy, untrack } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { invoke, isRemote } from "$lib/ipc";
  import { localProjects, finishAlbumDraft } from "$lib/app/orchestration.svelte.js";
  import { albumScreens } from "$lib/app/album-screen.svelte.js";
  import { producerClis } from "$lib/app/orch-start.svelte.js";
  import { repoStatusOf } from "$lib/app/git-repo";
  import type { Project } from "$lib/projects";
  import { composerEnter } from "$lib/pane/ai-flip-keys";
  import { newProducerChatId } from "../orch-tab";
  import { createArtistLoader } from "../artist-loader.svelte.js";
  import { artistList, runSnapshot } from "../api";
  import { EFFORTS, MODEL_SUGGESTIONS, type RoleCli } from "../config";
  import { modelLabel, orderModels } from "$lib/model-order";
  import Combobox from "$lib/Combobox.svelte";
  import Dropdown from "$lib/Dropdown.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { ALBUM_LIMITS, albumDraftValid, albumStartInput, albumFailureKey, albumRiskNeeded, autoMergeOn, blankAlbumDraft, createAlbumAttempt, createAlbumDefaultsReader, mergeAlbumDefaults, pruneAlbumArtists,
    type AlbumDefaults, type AlbumStartResult } from "../album-draft";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import AlbumCard from "./AlbumCard.svelte";
  import AlbumMembers from "./AlbumMembers.svelte";
  import AlbumRisk from "./AlbumRisk.svelte";
  import AutoMergeField from "./AutoMergeField.svelte";
  import VerifyFields from "../VerifyFields.svelte";

  import type { Snippet } from "svelte";
  /** `crumb` — 판의 경로 줄(원형 ← · 라이브러리 › 새 앨범). 목업대로 오른쪽 구성 카드 맨 위에 그린다(구성 칸의 `disabled` 밖 — 시작 중에도 돌아갈 수 있게). */
  let { tabId, visible, crumb }: { tabId: string; visible: boolean; crumb?: Snippet } = $props();
  const seed = untrack(() => albumScreens[tabId]);
  const fork = seed?.fork;
  const repoLocked = !!fork || !!seed?.repoLocked;
  const chat = newProducerChatId();
  const attempt = createAlbumAttempt();
  const artists = createArtistLoader();
  const reader = createAlbumDefaultsReader((repo) => invoke<AlbumDefaults>("orchestration_album_defaults", { repo }));
  let draft = $state({ ...blankAlbumDraft(), repo: seed?.repo || "" });
  let repoProjects = $state<Project[]>([]);
  let pathExpanded = $state(false);
  let clis = $state<{ id: string; name: string }[]>([]);
  let busy = $state(false);
  let loading = $state(false);
  let ready = $state(false);
  let error = $state<string | null>(null);
  /** 저장소 기본값에 지난 구성(멤버)이 있었다 — 2절 설명 줄이 그 사실을 말한다 */
  let fromLast = $state(false);
  /** 고른 프로듀서 카드의 모델 · 강도 칸(카드 부제를 누르면 펼친다) */
  let tuneOpen = $state(false);
  let addingArtist = $state(false);
  let disposed = false;
  let loadSeq = 0;
  let remotePath = $state("");
  let keepDirs = $state("");
  let cacheKeys = $state("");
  let extraEnv = $state("");
  const lines = (v: string) => v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const risk = $derived(albumRiskNeeded(draft));
  const canSend = $derived(ready && !loading && !busy && albumDraftValid(draft, artists.list) && clis.some((c) => c.id === draft.cli));
  const repoName = $derived(repoProjects.find((p) => p.path === draft.repo)?.name ?? draft.repo.split(/[\\/]/).filter(Boolean).pop() ?? "");
  /** 표지 = 들인 아티스트 얼굴 둘을 흐리게 겹친다(아직 앨범이 아니다) */
  const coverFaces = $derived(draft.members.map((m) => artists.list.find((a) => a.id === m.artist)).filter((a) => !!a).slice(0, 2));
  const cliSub = (id: string) => draft.cli === id ? [draft.model || t("orch.new.cliDefault"), draft.effort].filter(Boolean).join(" · ") : t("orch.new.cliDefault");

  $effect(() => { if (visible) return artists.subscribe(); });
  $effect(() => {
    const projects = localProjects();
    let alive = true;
    // 프로젝트 목록에는 일반 폴더도 있다. git 저장소만 보이고 최근 앨범의 저장소를 앞세운다.
    void Promise.all([
      Promise.all(projects.map(async (project) => ({ project, status: await repoStatusOf(null, project.path) }))),
      runSnapshot().catch(() => []),
    ]).then(([checked, albums]) => {
      if (!alive || disposed) return;
      const recent = [...albums].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.repo;
      repoProjects = checked.filter(({ status }) => status?.kind === "ok" || status?.kind === "noCommit")
        .map(({ project }) => project).sort((a, b) => Number(b.path === recent) - Number(a.path === recent));
      if (!draft.repo && !fork) draft.repo = repoProjects[0]?.path || "";
    });
    return () => { alive = false; };
  });
  $effect(() => {
    void producerClis().then((all) => { if (!disposed) clis = all.filter((c) => c.id === "claude" || c.id === "codex"); })
      .catch(() => { if (!disposed) error = t("app.ai.noneEnabled"); });
  });
  const selectedRepo = $derived(draft.repo);
  $effect(() => { const repo = selectedRepo; untrack(() => void loadDefaults(repo)); });
  $effect(() => {
    const list = artists.list;
    untrack(() => {
      const next = pruneAlbumArtists(draft, list);
      if (JSON.stringify(next) !== JSON.stringify(draft)) { draft = next; edited(); }
    });
  });
  onDestroy(() => { disposed = true; ++loadSeq; reader.cancel(); });

  async function loadDefaults(repo: string) {
    const seq = ++loadSeq;
    ready = false; loading = true; error = null; edited();
    reader.cancel();
    if (!repo) { loading = false; return; }
    try {
      const [available, defaults] = await Promise.all([artistList(), reader.load(repo)]);
      if (disposed || seq !== loadSeq || draft.repo !== repo || !defaults) return;
      draft = mergeAlbumDefaults(draft, defaults, available, fork);
      // 서버가 지난 앨범에서 왔다고 밝힐 때만 — 처음 쓰는 저장소의 씨앗 기본 구성에도 멤버가 있다
      fromLast = defaults.fromLast === true;
      keepDirs = draft.verify.keepDirs.join(", "); cacheKeys = draft.verify.cacheKeyFiles.join(", "); extraEnv = draft.verify.extraEnv.join(", ");
      ready = true;
    } catch (e) { if (!disposed && seq === loadSeq) error = t(albumFailureKey(e)); }
    finally { if (!disposed && seq === loadSeq) loading = false; }
  }
  function edited() { attempt.edited(); }
  function changed() { edited(); draft.riskConfirmed = false; }
  /** 카드를 고르면 그 CLI 로 바꾸고, 이미 고른 카드를 다시 누르면 모델 · 강도 칸을 여닫는다 */
  function pickCli(cli: RoleCli) {
    if (draft.cli === cli) { tuneOpen = !tuneOpen; return; }
    draft.cli = cli; draft.model = ""; draft.effort = ""; changed();
  }
  function usePath() { draft.repo = remotePath.trim(); pathExpanded = false; }
  async function submit() {
    if (!canSend) return;
    busy = true; error = null;
    const input = albumStartInput($state.snapshot(draft), chat, attempt.key(), fork);
    try {
      const result = await invoke<AlbumStartResult>("producer_album_start", { input });
      if (!disposed) finishAlbumDraft(tabId, draft, result, input.clientId, fork);
    } catch (e) { if (!disposed) error = t(albumFailureKey(e)); }
    finally { if (!disposed) busy = false; }
  }
</script>

<form class="new-album" data-new-album onsubmit={(e) => { e.preventDefault(); void submit(); }} oninput={edited} onchange={edited}>
  <fieldset class="producer" disabled={busy || loading}>
    <header class="producer-head" data-new-producer-head><b>{t("orch.bar.producer")}</b><span class="draft-pill">{t("orch.library.newAlbum")}</span></header>
    <div class="producer-body">
      <div class="intro"><h2>{t("orch.home.title")}</h2><p>{t("orch.new.lead")}</p></div>
      <div class="pick-producer">
        <span class="label" id="new-producer-{tabId}">{t("orch.home.pickProducer")}</span>
        <div class="clis" role="group" aria-labelledby="new-producer-{tabId}">
          {#each clis as c (c.id)}
            <button type="button" class="cli" aria-pressed={draft.cli === c.id} aria-expanded={draft.cli === c.id ? tuneOpen : undefined} aria-controls={draft.cli === c.id ? `new-tune-${tabId}` : undefined}
              title={draft.cli === c.id ? t("orch.new.tune", { cli: c.name }) : undefined} disabled={!!fork && c.id !== fork.agent} data-new-cli={c.id} onclick={() => pickCli(c.id as RoleCli)}>
              <ArtistAvatar cli={c.id} size={36} /><span class="cli-text"><b>{c.name}</b><span class="cli-sub">{cliSub(c.id)}{#if draft.cli === c.id}<span class="caret" aria-hidden="true">▾</span>{/if}</span></span>
            </button>
          {/each}
        </div>
        {#if !clis.length}<p>{t("app.ai.noneEnabled")}</p>{/if}
        <div class="tune" id="new-tune-{tabId}" hidden={!tuneOpen}>
          <label class="tune-model"><span>{t("orch.producer.draft.model")}</span><Combobox inputClass="tune-field" data-new-model suggestions={orderModels(MODEL_SUGGESTIONS[draft.cli])} label={modelLabel} bind:value={draft.model} disabled={busy} placeholder={t("orch.producer.model.default")} openOnClick /></label>
          <div class="tune-effort"><span id="new-effort-{tabId}">{t("orch.producer.draft.effort")}</span><span data-new-effort><Dropdown labelledby={`new-effort-${tabId}`} value={draft.effort} disabled={busy} options={EFFORTS[draft.cli].map((value) => ({ value, label: value || t("orch.producer.effort.default") }))} onchange={(value) => { draft.effort = value; edited(); }} /></span></div>
        </div>
      </div>
      <p class="memo">{t("orch.new.memory")}</p>
    </div>
    {#if loading}<p class="notice" role="status">{t("orch.board.loading")}</p>{/if}
    {#if error}<div class="notice warn" role="alert" data-new-error><span>{error}</span>{#if !ready}<button type="button" class="btn btn-secondary" data-new-reload disabled={loading || busy} onclick={() => void loadDefaults(draft.repo)}>{t("orch.new.reload")}</button>{/if}</div>{/if}
    <div class="composer">
      <label class="sr-only" for="new-first-{tabId}">{t("orch.home.first.label")}</label>
      <div class="pill">
        <textarea id="new-first-{tabId}" class="bare" rows="1" data-new-first bind:value={draft.text} placeholder={t("orch.new.firstPlaceholder")} onkeydown={(e) => { if (composerEnter(e) === "send") { e.preventDefault(); void submit(); } }}></textarea>
        <button type="submit" class="send" data-new-start disabled={!canSend} aria-label={t(busy ? "orch.new.starting" : "orch.new.start")} title={t(busy ? "orch.new.starting" : "orch.new.start")}><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"></path></svg></button>
      </div>
      {#if busy}<p class="sending" role="status">{t("orch.new.starting")}</p>{/if}
    </div>
  </fieldset>
  <section class="config-col">
  {@render crumb?.()}
  <fieldset class="config" disabled={busy || loading}>
    <div class="album-title">
      <div class="cover" aria-hidden="true">
        {#each coverFaces as a, i (a.id)}<span class="face f{i}"><ArtistAvatar cli={a.cli} profile={a} size={i === 0 ? 44 : 36} /></span>{:else}<UiIcon name="project" size={28} />{/each}
      </div>
      <div class="title-text">
        <div class="kicker"><span>{t("orch.new.kicker")}</span><span class="dash-pill">{t("orch.new.draftPill")}</span></div>
        <label><span class="sr-only">{t("orch.new.nameLabel")}</span><input class="name bare" data-new-name bind:value={draft.name} maxlength="80" placeholder={t("orch.new.name")} /></label>
      </div>
    </div>
    <div class="cards">
      <AlbumCard num={1} title={t("orch.new.repo")} hint={t("orch.new.repoHint")} data-new-repo-section>
        <div class="repo-row">
          {#each repoProjects as p (p.id)}<button type="button" class="chip" disabled={repoLocked} aria-pressed={draft.repo === p.path} data-new-repo={p.path} onclick={() => (draft.repo = p.path)}><UiIcon name="folder" size={14} />{p.name}</button>{/each}
          <button type="button" class="chip dashed" data-new-browse disabled={repoLocked} aria-expanded={pathExpanded} aria-controls={`new-repo-path-${tabId}`} onclick={() => (pathExpanded = !pathExpanded)}>{t("orch.new.browse")}</button>
          <span class="repo-path" title={draft.repo} data-new-selected-repo data-new-repo-locked={repoLocked ? "" : undefined}>{#if repoLocked}<UiIcon name="lock" size={12} /> {/if}{draft.repo || t("orch.new.pickRepo")}</span>
        </div>
        {#if !repoLocked && pathExpanded}<div class="path-row" id={`new-repo-path-${tabId}`}><label class="grow"><span class="sr-only">{t("orch.new.repoPath")}</span><input class="path-input" data-new-repo-path bind:value={remotePath} placeholder={t("orch.new.repoPath")} /></label><button type="button" class="btn btn-secondary" data-new-repo-apply disabled={!remotePath.trim()} onclick={usePath}>{t("orch.new.useRepo")}</button></div>{/if}
      </AlbumCard>
      <AlbumCard num={2} title={t("orch.new.artists")} hint={fromLast && repoName ? t("orch.new.artistsHint.last", { repo: repoName }) : t("orch.new.artistsHint.fresh")}>
        {#snippet action()}<button type="button" class="link" data-new-add aria-expanded={addingArtist} onclick={() => (addingArtist = !addingArtist)}>{t("orch.new.addArtist")}</button>{/snippet}
        <AlbumMembers bind:members={draft.members} bind:accept={draft.accept} bind:adding={addingArtist} artists={artists.list} rework={false} onchange={changed} />
        {#if ready && !draft.members.some((m) => m.grade !== "read" && artists.list.some((a) => a.id === m.artist && a.kind === "write"))}<p class="warn-line" data-new-no-worker>{t("orch.new.failure.no-usable-artist")}</p>{/if}
      </AlbumCard>
      <AlbumCard num={3} title={t("orch.new.verify")} hint={t("orch.new.verifyHint")}>
        <div oninput={() => { draft.verify.keepDirs = lines(keepDirs); draft.verify.cacheKeyFiles = lines(cacheKeys); draft.verify.extraEnv = lines(extraEnv); changed(); }}>
          <VerifyFields tag="new" inputId={`new-verify-command-${tabId}`} bind:command={draft.verify.command} bind:timeout={draft.verify.timeoutMinutes} bind:keepDirs bind:cacheKeyFiles={cacheKeys} bind:extraEnv>
            {#snippet mode()}<div class="seg" role="group" aria-label={t("orch.new.verify")}>
              <button type="button" aria-pressed={!draft.verify.auto} disabled={!draft.verify.command.trim()} data-new-verify-mode="confirm" onclick={() => { draft.verify.auto = false; changed(); }}>{t("orch.new.confirm")}</button>
              <button type="button" aria-pressed={draft.verify.auto} disabled={!draft.verify.command.trim()} data-new-verify-auto data-new-verify-mode="auto" onclick={() => { draft.verify.auto = true; changed(); }}>{t("orch.new.auto")}</button>
            </div>{/snippet}
          </VerifyFields>
        </div>
        <AutoMergeField tag="new" enabled={!!draft.verify.command.trim()} bind:checked={draft.autoMerge} onchange={changed} />
      </AlbumCard>
      <!-- 4절 한도 · 기타 — 접지 않는다(목업 V3FoldA): 작은 숫자 칸 격자가 늘 보이고 그 자리에서 고친다(요약 줄 · 펼치기 없음) -->
      <AlbumCard num={4} title={t("orch.new.limitsOther")} data-new-limits-section>
        <div class="limits">
          {#each ALBUM_LIMITS as l}<label>{t(l.label)}<input class="num-input" type="number" min="1" max={l.max} data-new-limit={l.key} bind:value={draft.limits[l.key]} /></label>{/each}
          <label>{t("orch.new.rework")}<input class="num-input" type="number" min="0" max="10" data-new-rework bind:value={draft.accept.maxRework} oninput={changed} /></label>
          <label>{t("orch.new.wakeLabel")}<input class="num-input" type="number" min="0" max="200" data-new-wake bind:value={draft.wakeMax} /></label>
        </div>
        <label class="check"><Toggle data-new-plan-tools bind:checked={draft.planTools} onchange={changed} />{t("orch.new.planTools")}</label>
      </AlbumCard>
      {#if risk}<AlbumRisk full={draft.members.some((m) => m.grade === "full")} verify={draft.verify.auto && !!draft.verify.command.trim()} planTools={draft.planTools} autoMerge={autoMergeOn(draft)} bind:confirmed={draft.riskConfirmed} />{/if}
      {#if isRemote}<p class="remote" data-new-remote><UiIcon name="shield-check" size={14} />{t("orch.new.remote")}</p>{/if}
    </div>
  </fieldset>
  </section>
</form>

<style>
  .new-album { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(280px, 440px) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); gap: 12px; padding: 12px; overflow: hidden; font-size: var(--t-sm); }
  fieldset { min-width: 0; min-height: 0; margin: 0; border: 0; border-radius: var(--radius-surface); padding: 0; background: var(--bg-panel); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  p { margin: 0; color: var(--fg-2); line-height: 1.6; overflow-wrap: anywhere; font-size: var(--t-sm); }

  /* ── 왼쪽 프로듀서 칸(목업: 머리 · 빈 가운데 · 아래쪽 안내와 CLI 카드 · 채팅 입력 알약) */
  .producer { display: flex; flex-direction: column; background: var(--surface-raised); overflow: hidden; }
  .producer-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); font-size: var(--t-sm); }
  .producer-head b { font-size: var(--t-md); }
  .draft-pill { padding: 3px 10px; border-radius: 999px; background: var(--control-bg); color: var(--fg-2); font-size: var(--t-xs); }
  /* 내용이 높이를 넘으면 위에서 시작해야 큰 제목도 스크롤로 닿는다. */
  .producer-body { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; justify-content: safe flex-end; gap: 18px; padding: 22px 18px; }
  .producer-body > * { flex-shrink: 0; }
  .intro { display: flex; flex-direction: column; gap: 8px; }
  h2 { margin: 0; font-size: 22px; font-weight: 900; line-height: 1.3; color: var(--fg-1); }
  .pick-producer { display: flex; flex-direction: column; gap: 8px; }
  .label { font-size: var(--t-xs); color: var(--fg-3); }
  .clis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .cli { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 8px; border: 2px solid transparent; border-radius: 14px; background: var(--surface-hover); color: var(--fg-1); font: inherit; text-align: left; cursor: pointer; }
  .cli:hover:not(:disabled) { background: var(--control-bg-hover); }
  .cli[aria-pressed="true"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent-soft) 45%, var(--surface-hover)); }
  .cli:disabled { opacity: .45; cursor: default; }
  .cli-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .cli-sub { font-size: var(--t-xs); color: var(--fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .caret { margin-left: 4px; font-size: 10px; color: var(--fg-3); }
  .tune { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--surface-hover); }
  .tune[hidden] { display: none; }
  .tune-model { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .tune-model > span, .tune-effort > span:first-child { font-size: var(--t-xs); color: var(--fg-3); }
  .tune-effort { display: flex; flex-direction: column; gap: 4px; }
  .tune :global(input.tune-field) { box-sizing: border-box; width: 100%; height: var(--field-height); padding: 0 var(--space-3); border: 1px solid transparent; border-radius: var(--field-radius); background: var(--field-bg); box-shadow: var(--glass-ctl-edge, none); color: var(--fg-1); font: inherit; font-size: var(--t-sm); outline: none; }
  .tune :global(input.tune-field:hover:not(:disabled, :focus)) { background: var(--control-bg-hover); }
  .tune :global(input.tune-field:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .memo { font-size: var(--t-xs); color: var(--fg-3); line-height: 1.55; }
  .notice { flex: 0 0 auto; margin: 0 14px 10px; padding: 10px 12px; border-radius: var(--radius-md); background: var(--surface-hover); color: var(--fg-2); font-size: var(--t-xs); }
  .notice.warn { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; background: var(--warn-soft); color: var(--fg-1); box-shadow: inset 0 0 0 1px var(--warn); }
  .notice.warn span { flex: 1 1 180px; }
  .composer { flex: 0 0 auto; padding: 12px 14px; border-top: 1px solid var(--line); }
  .pill { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-field); }
  .pill:focus-within { border-color: var(--focus-border); }
  .pill textarea { flex: 1; min-width: 0; max-height: 8lh; padding: 6px 0; border: 0; background: transparent; color: var(--fg-1); font: inherit; line-height: 1.5; resize: none; outline: none; field-sizing: content; border-radius: 6px; }
  .send { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--control-on-bg); color: var(--control-on-fg); cursor: pointer; }
  .send:hover:not(:disabled) { background: var(--control-on-bg-hover); }
  .send:disabled { background: var(--control-bg); color: var(--fg-3); cursor: default; }
  .sending { margin-top: 6px; padding-left: 16px; font-size: var(--t-xs); color: var(--fg-3); }

  /* ── 오른쪽 구성 판(목업: 점선 표지 · ALBUM · 큰 제목 자리 · 번호 카드 넷) */
  .config-col { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-radius: var(--radius-surface); background: var(--bg-panel); overflow: hidden; }
  .config { flex: 1; min-height: 0; overflow: auto; padding: 14px 28px 20px; border-radius: 0; background: transparent; }
  .album-title { display: flex; align-items: center; gap: 20px; padding: 4px 0 16px; }
  .cover { position: relative; flex-shrink: 0; width: 96px; height: 96px; display: flex; align-items: center; justify-content: center; border: 2px dashed var(--line-strong); border-radius: var(--radius-surface-inner); background: var(--surface-hover); color: var(--fg-3); }
  .face { position: absolute; display: flex; opacity: .55; }
  .face.f0 { left: 10px; top: 10px; }
  .face.f1 { right: 10px; bottom: 10px; }
  .face:only-child { position: static; }
  .title-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .kicker { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .kicker > span:first-child { font-size: var(--t-xs); font-weight: 700; letter-spacing: 1px; color: var(--fg-3); }
  .dash-pill { padding: 2px 10px; border: 1px dashed var(--line-strong); border-radius: 999px; color: var(--fg-2); font-size: var(--t-xs); }
  .title-text label { display: flex; }
  .name { flex: 1; min-width: 0; padding: 2px 0 6px; border: 0; border-bottom: 1px dashed var(--line-strong); border-radius: 0; background: transparent; color: var(--fg-1); font: inherit; font-size: 26px; font-weight: 900; outline: none; }
  .name:focus { border-bottom-color: var(--focus-border); }
  .name::placeholder { color: var(--fg-3); opacity: .8; }
  .cards { display: flex; flex-direction: column; gap: 10px; }
  .repo-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid transparent; border-radius: 999px; background: var(--control-bg); color: var(--fg-2); font: inherit; cursor: pointer; }
  .chip:hover:not(:disabled) { background: var(--control-bg-hover); }
  .chip[aria-pressed="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); }
  .chip.dashed { background: transparent; border: 1px dashed var(--line-strong); }
  .chip.dashed[aria-expanded="true"] { border-style: solid; }
  .chip:disabled { cursor: default; opacity: .6; }
  .chip[aria-pressed="true"]:disabled { opacity: 1; }
  .repo-path { flex: 1 1 160px; min-width: 0; text-align: right; font-family: var(--font-mono); font-size: var(--t-xs); color: var(--fg-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .path-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .grow { flex: 1; min-width: 160px; display: flex; }
  .path-row .btn { height: var(--field-height); }
  .path-input { box-sizing: border-box; flex: 1; min-width: 0; height: var(--field-height); padding: 0 var(--space-3); border: 1px solid transparent; border-radius: var(--field-radius); background: var(--field-bg); box-shadow: var(--glass-ctl-edge, none); color: var(--fg-1); font-family: var(--font-mono); font-size: var(--t-sm); outline: none; }
  .path-input:hover:not(:disabled, :focus) { background: var(--control-bg-hover); }
  .path-input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .link { padding: 2px 6px; border: 0; border-radius: 999px; background: transparent; color: var(--accent); font: inherit; font-size: var(--t-xs); cursor: pointer; }
  .link:hover { background: var(--control-ghost-hover); }
  .warn-line { font-size: var(--t-xs); color: var(--warn); }
  .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface-field); }
  .seg button { padding: 4px 12px; border: 0; border-radius: 999px; background: transparent; color: var(--fg-2); font: inherit; font-size: var(--t-xs); white-space: nowrap; cursor: pointer; }
  .seg button:hover:not(:disabled) { background: var(--control-ghost-hover); }
  .seg button[aria-pressed="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); }
  .seg button:disabled { cursor: default; opacity: .5; }
  /* 4절 — 칸마다 이름(왼쪽 · 줄임) + 작은 숫자 칸(오른쪽). 넓으면 셋 · 넷씩, 좁으면 하나씩 */
  .limits { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 14px; }
  .limits label { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; font-size: var(--t-xs); color: var(--fg-2); }
  .num-input { box-sizing: border-box; flex: 0 0 auto; width: 64px; height: var(--field-height); padding: 0 8px; border: 1px solid transparent; border-radius: var(--field-radius); background: var(--field-bg); box-shadow: var(--glass-ctl-edge, none); color: var(--fg-1); font: inherit; font-size: var(--t-sm); font-weight: 700; text-align: center; outline: none; }
  .num-input:hover:not(:disabled, :focus) { background: var(--control-bg-hover); }
  .num-input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .check { display: flex; align-items: center; gap: 8px; font-size: var(--t-xs); color: var(--fg-2); }
  .remote { display: flex; align-items: center; gap: 8px; font-size: var(--t-xs); color: var(--fg-3); }
  .remote :global(svg) { color: var(--accent); flex-shrink: 0; }
  @container (max-width: 720px) {
    .new-album { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-auto-rows: max-content; overflow: auto; }
    .config-col { overflow: visible; }
    .config { overflow: visible; padding: 16px; }
    .producer-body { flex: 0 0 auto; justify-content: flex-start; overflow: visible; }
    .album-title { gap: 14px; }
    .name { font-size: 20px; }
    .cover { width: 64px; height: 64px; }
    .face :global(.avatar) { width: 30px !important; height: 30px !important; }
    .face.f0 { left: 6px; top: 6px; }
    .face.f1 { right: 6px; bottom: 6px; }
    .repo-path { flex-basis: 100%; text-align: left; }
  }
</style>
