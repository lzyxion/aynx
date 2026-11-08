<script lang="ts">
  // 라이브러리 · 스튜디오 화면: 아티스트 열 · 필터 · 스튜디오 카드(라이브러리만) · 최근 · 앨범 목록(목업 V3Library · RPUSHv2246dDsXqVRJ37WD).
  // `studio` 이 있으면 스튜디오 화면 — 목록 · 보관함을 그 저장소로 좁히고 머리를 바꾼다. 필터 칩 값은 두 화면이 나눠 든다(카드의 수와 들어간 화면이 맞게).
  import { untrack, type Snippet } from "svelte";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { relativeTime } from "$lib/notifications";
  import { showNotice } from "$lib/app/notice";
  import { askPick } from "$lib/app/confirm-dialog.svelte.js";
  import { listen } from "$lib/ipc";
  import { mobileLayout } from "$lib/app/mobile.svelte.js";
  import { openAlbumTab, openNewAlbum, openStudio } from "$lib/app/orchestration.svelte.js";
  import { studioLabel, studioProject } from "$lib/app/studio-projects.svelte.js";
  import { albumView, setAlbumView } from "$lib/app/album-view.svelte.js";
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import { adoptWithNewProducer } from "$lib/app/orch-start.svelte.js";
  import { RUN_STATE_KEY, shownRunState, albumLive, archiveDeleteDialog, archivedRowActions, archivedRowChips, blockedCount, libraryRowActions, libraryRowChips, trackCountText, cardStatusIcon, continueKind, elapsedSplit, keyText, orchReasonText, type AlbumRowAction, type AlbumRowChip, type ArchivedAlbum, type LibraryFilter, type RunChanged, type RunDetail, type RunSummary } from "$lib/orchestration/model";
  import StatusIcon from "../StatusIcon.svelte";
  import { albumRowMeta, archivedInStudio, filterLibraryRuns, libraryRepositories, recentAlbums, studioSummary, type AlbumView } from "../model/library";
  import { RUN_CHANGED_EVENT, archivedAlbums, deleteArchived, restoreArchived, runDetail } from "../api";
  import { requestAlbumCleanup } from "./album-focus.svelte.js";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import CoverCard from "./CoverCard.svelte";
  import { albumFaces, albumMembers } from "./album-faces";
  import LibraryArtists from "./LibraryArtists.svelte";
  import { createArtistLoader } from "../artist-loader.svelte.js";

  let { list, loading, error, busy, visible, archive, refresh, studio = null, crumb }: {
    list: RunSummary[]; loading: boolean; error: string | null; busy: boolean; visible: boolean; archive: (id: string) => void;
    /** 목록을 다시 읽어 달라(줄의 남은 worktree 수는 사건 없이 낡는다 — 앱 밖에서 지운 경우) · 부모가 간격을 지킨다 */
    refresh: () => void;
    /** 스튜디오 화면이면 그 저장소(`OrchMark.repo`) */
    studio?: string | null;
    /** 판의 경로 줄(← · 라이브러리 › 스튜디오) — 스튜디오 화면의 판 맨 위에 그린다 */
    crumb?: Snippet;
  } = $props();
  let filter = $state<LibraryFilter>("all");
  let now = $state(Date.now());
  let details = $state<Record<string, RunDetail>>({});
  const profiles = createArtistLoader();
  $effect(() => { if (visible) return profiles.subscribe(); });
  let archived = $state<ArchivedAlbum[]>([]);
  const shownArchived = $derived(archivedInStudio(archived, studio));
  /** 스튜디오 카드 — 고른 필터를 지난 앨범만 센다 · 보관함이면 보관한 앨범 */
  const repos = $derived(libraryRepositories(filter === "archived" ? archived : filterLibraryRuns(list, filter, null)));
  const albums = $derived(filterLibraryRuns(list, filter, studio));
  const summary = $derived(studio === null ? null : studioSummary(list, archived, studio));
  /** 그 스튜디오의 앨범이 모두 사라졌다(보관 · 삭제) — 라이브러리로 돌아가지 않고 빈 문구만 */
  const studioEmpty = $derived(!!summary && !loading && summary.albums + summary.archived === 0);
  const recent = $derived(recentAlbums(albums));
  const cardView = $derived(albumView() === "cards");
  const ALBUM_VIEWS: [AlbumView, string, Key][] = [["rows", "list", "orch.library.view.rows"], ["cards", "grid", "orch.library.view.cards"]];
  const FILTERS: [LibraryFilter, Key][] = [["all", "orch.home.filter.all"], ["live", "orch.home.filter.live"], ["ended", "orch.home.filter.ended"]];

  function pickFilter(value: LibraryFilter): void {
    filter = value;
    refresh();
  }

  // 보관함 — 라이브러리와 다른 서버 목록. 보일 때 · 보관/복원/삭제 사건(`archive`) · 세션 서버 재연결 때만 읽는다(파일 · git 이라 사건마다 읽지 않는다).
  let archiveBusy = $state(false);
  let archiveError = $state<string | null>(null);
  let archiveSeq = 0;
  async function loadArchive(): Promise<void> {
    const seq = ++archiveSeq;
    try {
      const rows = await archivedAlbums();
      if (seq === archiveSeq) archived = rows;
    } catch {
      // 못 읽으면 지난 목록 그대로(라이브러리는 그대로 쓴다).
    }
  }
  $effect(() => {
    if (!visible) return;
    void untrack(loadArchive);
    let dead = false;
    const offs: (() => void)[] = [];
    const keep = (off: () => void) => { if (dead) off(); else offs.push(off); };
    void listen<RunChanged>(RUN_CHANGED_EVENT, (ev) => { if (ev.payload.archive) void loadArchive(); }).then(keep).catch(() => {});
    void listen("session-server-connected", () => void loadArchive()).then(keep).catch(() => {});
    return () => { dead = true; offs.forEach((off) => off()); };
  });
  async function archiveAct(fn: () => Promise<unknown>): Promise<boolean> {
    if (archiveBusy) return false;
    archiveBusy = true;
    archiveError = null;
    try {
      await fn();
      await loadArchive();
      return true;
    } catch (e) {
      archiveError = orchReasonText(String(e), t);
      return false;
    } finally {
      archiveBusy = false;
    }
  }
  // 복원 — 전부 보기로 돌아가 돌아온 앨범이 보이게 하고 알린다(다시 돌지 않는 끝난 기록이다). 스튜디오 화면이면 그 화면 그대로.
  async function restore(a: ArchivedAlbum): Promise<void> {
    if (!(await archiveAct(() => restoreArchived(a.runId)))) return;
    filter = "all";
    showNotice(t("orch.archive.restored", { name: a.name }));
  }
  async function askDelete(a: ArchivedAlbum): Promise<void> {
    const { body, ...opts } = archiveDeleteDialog(a, t);
    const answer = await askPick(body, opts);
    if (answer === "delete") void archiveAct(() => deleteArchived(a.runId));
    // 내보내기 op 는 표에 있는 앨범에만 된다 — 복원하고 그 앨범 화면을 연다(자동 내보내기가 아니다).
    else if (answer === "export" && (await archiveAct(() => restoreArchived(a.runId)))) openAlbumTab(a.runId, studio);
  }

  $effect(() => {
    if (!visible) return;
    now = Date.now();
    const id = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(id);
  });
  $effect(() => {
    if (!visible) return;
    // 보이는 앨범 전부 — 표지 얼굴이 여기서 온다(바뀐 앨범만 다시 읽는다)
    const want = albums;
    let dead = false;
    untrack(() => {
      for (const run of want) {
        if (details[run.runId]?.latestSeq === run.latestSeq) continue;
        void runDetail(run.runId).then((d) => { if (!dead) details[run.runId] = d; }, () => {});
      }
    });
    return () => { dead = true; };
  });
  // 라이브러리의 쉼은 시계로 표시한다. 목록 점처럼 보이는 idle 글리프를 상태 줄에 두지 않는다.
  function statusIcon(run: RunSummary) { const icon = cardStatusIcon(continueKind(run), run); return icon === "idle" ? "waiting" : icon; }
  /** 줄 · 카드의 상태 그림 — 끝난 앨범은 완료 · 중단됨 */
  function rowIcon(run: RunSummary) {
    const shown = shownRunState(run.state, run.previousState);
    return shown === "done" ? "done" : shown === "stopped" ? "stopped" : statusIcon(run);
  }
  /** 카드에 싣는 칩 — 정리 · 내보내기가 필요하다는 경고만(내보낸 표시는 앨범 안에서 본다) */
  function warnChips(chips: AlbumRowChip[]) { return chips.filter((c) => c.tone === "warn"); }
  // 최근 카드의 상태 줄 — 막대가 도는 동안만 "재생 중"(목업), 그 밖은 갈래 · 상태 낱말
  function cardStatus(run: RunSummary, kind: string, icon: string) {
    if (kind === "orphan") return t("orch.home.card.orphan");
    if (kind === "reattach") return t("orch.home.card.reattach");
    if (run.state === "running" && (icon === "playing" || icon === "reviewing")) return t("orch.home.card.playing");
    return keyText(RUN_STATE_KEY, shownRunState(run.state, run.previousState), t);
  }
  /** 표지 얼굴 — 앨범 머리 · 재생 막대와 같다(`album-faces`) */
  function faces(id: string) {
    const d = details[id];
    return d ? albumFaces(albumMembers(d, profiles.list), null) : [];
  }
  function elapsed(run: RunSummary) {
    const value = elapsedSplit(now - run.createdAt);
    return value.hours ? t("orch.home.card.hours", { h: value.hours, m: value.minutes }) : t("orch.home.card.minutes", { m: value.minutes });
  }
  /** 스튜디오 화면에서 들어간 앨범은 ← · Esc 가 그 화면으로 돌아온다 */
  function openAlbum(id: string) { openAlbumTab(id, studio); }
  function cleanup(id: string) { openAlbum(id); requestAlbumCleanup(id); }
  /** 폰 배치 — 줄을 세로로 쌓고 아이콘 단추를 손가락 크기로(글자는 싣지 않는다) */
  const phone = $derived(mobileLayout());
  function libraryAct(run: RunSummary, kind: AlbumRowAction["kind"]): void {
    if (kind === "cleanup") cleanup(run.runId);
    else if (kind === "archive") archive(run.runId);
  }
</script>

{#snippet rowChips(chips: AlbumRowChip[])}
  <span class="row-chips">{#each chips as c (c.kind)}<span class="status-chip {c.tone}" title={c.title} data-orch-chip={c.kind} data-orch-recent-wt={c.kind === "worktrees" ? "" : undefined} data-orch-archived-unexported={c.kind === "unexported" ? "" : undefined}><UiIcon name={c.icon} size={12} />{c.label}</span>{/each}</span>
{/snippet}

{#snippet libraryActs(run: RunSummary)}
  {#each libraryRowActions(run, t) as act (act.kind)}
    <button type="button" class="icon-btn" aria-label={act.aria} title={act.title} disabled={act.blocked || (act.kind === "archive" && busy)} data-orch-cleanup={act.kind === "cleanup" ? run.runId : undefined} data-orch-archive={act.kind === "archive" ? run.runId : undefined} onclick={() => libraryAct(run, act.kind)}><UiIcon name={act.icon} size={phone ? 20 : 16} /></button>
  {/each}
{/snippet}

{#snippet archivedActs(a: ArchivedAlbum)}
  {#each archivedRowActions(t) as act (act.kind)}
    <button type="button" class="icon-btn" class:danger={act.danger} aria-label={act.aria} title={act.title} disabled={archiveBusy} data-orch-restore={act.kind === "restore" ? a.runId : undefined} data-orch-delete={act.kind === "delete" ? a.runId : undefined} onclick={() => void (act.kind === "restore" ? restore(a) : askDelete(a))}><UiIcon name={act.icon} size={phone ? 20 : 16} /></button>
  {/each}
{/snippet}

<!-- 카드의 경고 표식 — 칩의 글자는 말풍선으로(좁아서 글자를 싣지 않는다) -->
{#snippet warnFlags(chips: AlbumRowChip[])}
  {#each chips as c (c.kind)}<span class="warn-flag" role="img" aria-label={c.title} title={c.title} data-orch-chip={c.kind}><UiIcon name={c.icon} size={15} /></span>{/each}
{/snippet}

<!-- 앨범 목록 머리 — 제목 · 줄/카드 고르기(앨범 · 보관함만 — 스튜디오는 늘 카드) -->
{#snippet listHead(title: string)}
  <div class="list-head">
    <h3>{title}</h3>
    <div class="view-pick" role="radiogroup" aria-label={t("orch.library.view")}>
      {#each ALBUM_VIEWS as [value, icon, key] (value)}<button type="button" role="radio" aria-checked={albumView() === value} aria-label={t(key)} title={t(key)} data-library-view={value} onclick={() => setAlbumView(value)}><UiIcon name={icon} size={16} /></button>{/each}
    </div>
  </div>
{/snippet}

<div class="home" class:phone data-orch-home>
  <LibraryArtists {visible} />
  <section class="library" data-orch-library aria-label={t("orch.home.library")}>
    {#if studio !== null}
      {@render crumb?.()}
      <header class="studio-head" data-studio-head>
        <span class="studio-cover" aria-hidden="true"><ProjectIcon project={studioProject(studio)} size={44} /></span>
        <div class="studio-info">
          <span class="studio-kicker">{t("orch.library.studio.kicker")}</span>
          <h2>{studioLabel(studio)}</h2>
          <span class="studio-path" data-studio-path>{studio}</span>
          <span class="studio-summary" data-studio-summary>{t("orch.library.studio.summary", { albums: summary?.albums ?? 0, live: summary?.live ?? 0 })}</span>
        </div>
        <button type="button" class="btn btn-primary new-album" data-library-new-album onclick={() => openNewAlbum(studio ?? "", undefined, false, studio ?? undefined)}><UiIcon name="plus" size={16} />{t("orch.library.newAlbum")}</button>
      </header>
    {:else}
      <header><h2>{t("orch.home.library")}</h2>
        <button type="button" class="btn btn-primary new-album" data-library-new-album onclick={() => openNewAlbum("")}><UiIcon name="plus" size={16} />{t("orch.library.newAlbum")}</button>
      </header>
    {/if}
    {#if studioEmpty}
      <p class="empty" data-studio-empty>{t("orch.library.studio.empty")}</p>
    {:else}
    <div class="filters">
      <div class="chips" role="radiogroup" aria-label={t("orch.home.filter")}>
        {#each FILTERS as [value, key] (value)}<button type="button" class="chip" role="radio" aria-checked={filter === value} data-orch-filter={value} onclick={() => pickFilter(value)}>{t(key)}</button>{/each}
        <button type="button" class="chip" role="radio" aria-checked={filter === "archived"} data-orch-filter="archived" onclick={() => pickFilter("archived")}><UiIcon name="archive" size={13} />{t("orch.archive.chip", { n: shownArchived.length })}</button>
      </div>
    </div>
    {#if studio === null && repos.length > 0}
      <!-- 스튜디오 = 앨범의 저장소(오케스트레이션 안의 화면 낱말) — 위 필터를 따른다 · 누르면 그 스튜디오 화면 -->
      <section class="block" data-library-repos>
        <h3>{t("orch.library.repoLabel")}</h3>
        <div class="tiles" role="group" aria-label={t("orch.library.repoLabel")}>
          {#each repos as r (r.repo)}
            <CoverCard name={studioLabel(r.repo)} meta={t("orch.library.studioCount", { n: r.count })} badge={r.live ? { icon: "playing", label: t("orch.library.studio.live") } : null} onopen={() => openStudio(r.repo)} title={r.repo} data-library-repo={r.repo} data-studio-live={r.live ? "" : undefined}>
              {#snippet cover(width)}<ProjectIcon project={studioProject(r.repo)} size={Math.round(width * 0.42)} />{/snippet}
            </CoverCard>
          {/each}
        </div>
      </section>
    {/if}
    {#if filter === "archived"}
      <section class="block" class:rows={!cardView} data-orch-archive-list>{@render listHead(t("orch.archive.title"))}
        <p class="archive-note">{t("orch.archive.note")}</p>
        {#if cardView && shownArchived.length > 0}
          <div class="tiles">
            {#each shownArchived as a (a.runId)}
              {@const shown = shownRunState(a.state, a.previousState)}
              {@const warn = warnChips(archivedRowChips(a, t))}
              <CoverCard name={a.name} meta={albumRowMeta(t("orch.archive.row.meta", { tracks: trackCountText(a.taskCount, t), when: relativeTime(a.archivedAt, now, t) }), a.repo, studio !== null, t, studioLabel(a.repo))} metaTitle={a.repo} badge={{ icon: shown === "done" ? "done" : "stopped", label: keyText(RUN_STATE_KEY, shown, t) }} showActions={phone} data-orch-archived-card={a.runId} data-state={shown}>
                {#snippet cover(width)}<UiIcon name="archive" size={Math.round(width * 0.4)} />{/snippet}
                {#snippet flag()}{@render warnFlags(warn)}{/snippet}
                {#snippet actions()}{@render archivedActs(a)}{/snippet}
              </CoverCard>
            {/each}
          </div>
        {:else}
        {#each shownArchived as a (a.runId)}
          <div class="album-row" data-orch-archived-row={a.runId} data-state={a.state}>
            <span class="album-name">
              <span class="row-cover" aria-hidden="true"><UiIcon name="archive" size={20} /></span>
              <span class="name-text"><b>{a.name}</b><small title={a.repo}>{albumRowMeta(t("orch.archive.row.meta", { tracks: trackCountText(a.taskCount, t), when: relativeTime(a.archivedAt, now, t) }), a.repo, studio !== null, t, studioLabel(a.repo))}</small></span>
            </span>
            <span class="cols">
              <span class="state"><StatusIcon icon={shownRunState(a.state, a.previousState) === "done" ? "done" : "idle"} size={16} />{keyText(RUN_STATE_KEY, shownRunState(a.state, a.previousState), t)}</span>
              {@render rowChips(archivedRowChips(a, t))}
              <span class="actions">{@render archivedActs(a)}</span>
            </span>
          </div>
        {:else}<p class="empty">{t("orch.archive.empty")}</p>{/each}
        {/if}
      </section>
      {#if archiveError}<p role="alert" class="empty" data-orch-archive-error>{archiveError}</p>{/if}
    {:else}
    {#if recent.length > 0}
      <section class="block" data-orch-continue><h3>{t("orch.home.recent")}</h3>
        <div class="cards">
          {#each recent as run (run.runId)}
            {@const kind = continueKind(run)}
            {@const status = rowIcon(run)}
            {@const warm = kind !== "playing"}
            {@const people = faces(run.runId)}
            <div class="album-card" class:warm data-orch-album={run.runId} data-kind={kind}>
              <button type="button" class="album-open" aria-label={t("orch.home.card.open", { name: run.name })} onclick={() => openAlbum(run.runId)}>
                <span class="cover" data-faces={people.length} aria-hidden="true">{#each people as face, i (i)}<span class="face" class:second={i === 1}><ArtistAvatar cli={face.cli} profile={face.profile} size={people.length === 1 ? 40 : i === 0 ? 34 : 28} ring /></span>{:else}<span class="cover-icon"><StatusIcon icon={status} size={24} /></span>{/each}</span>
                <span class="card-text">
                  <small class="album-status" data-card-status-icon={status}><StatusIcon icon={status} size={11} />{cardStatus(run, kind, status)}</small>
                  <b class="card-title">{run.name}</b>
                  <small class="meta">{!albumLive(run) ? albumRowMeta(t("orch.library.row.meta", { tracks: trackCountText(run.taskCount, t), when: relativeTime(run.updatedAt, now, t) }), run.repo, studio !== null, t, studioLabel(run.repo)) : studio !== null ? t("orch.home.card.meta.inStudio", { tracks: trackCountText(run.taskCount, t), accepted: run.taskStates.accepted ?? 0, elapsed: elapsed(run) }) : t("orch.home.card.meta", { studio: studioLabel(run.repo), tracks: trackCountText(run.taskCount, t), accepted: run.taskStates.accepted ?? 0, elapsed: elapsed(run) })}{#if blockedCount(run) > 0}{` · ${t("orch.home.card.blocked", { n: blockedCount(run) })}`}{/if}</small>
                  {#if run.coordinatorChat && run.state === "running" && run.running.write + run.running.judge === 0}<small class="meta" data-library-producer-waiting>{t("orch.producer.libraryWaiting")}</small>{/if}
                </span>
              </button>
              {#if kind === "orphan" || kind === "reattach"}
                {@const label = t(kind === "orphan" ? "orch.home.adopt" : "orch.home.reattach")}
                <button type="button" class="adopt" aria-label={label} title={kind === "reattach" ? `${label} — ${t("orch.home.reattach.tip")}` : label} data-orch-adopt={run.runId} data-orch-adopt-kind={kind} onclick={() => void adoptWithNewProducer({ ...run, fromRepo: studio ?? undefined })}><UiIcon name="play" size={16} filled /></button>
              {/if}
            </div>
          {/each}
        </div>
      </section>
    {/if}
    <section class="block" class:rows={!cardView} data-orch-recent data-library-albums>{@render listHead(t("orch.library.albums"))}
      {#if cardView && albums.length > 0}
        <div class="tiles" data-library-album-cards>
          {#each albums as run (run.runId)}
            {@const people = faces(run.runId)}
            {@const warn = warnChips(libraryRowChips(run, t))}
            <CoverCard name={run.name} meta={albumRowMeta(t("orch.library.row.meta", { tracks: trackCountText(run.taskCount, t), when: relativeTime(run.updatedAt, now, t) }), run.repo, studio !== null, t, studioLabel(run.repo))} metaTitle={run.repo} badge={{ icon: rowIcon(run), label: keyText(RUN_STATE_KEY, shownRunState(run.state, run.previousState), t) }} showActions={phone} onopen={() => openAlbum(run.runId)} data-orch-album-card={run.runId} data-state={shownRunState(run.state, run.previousState)}>
              {#snippet cover(width)}
                {#each people as face, i (face.id)}<span class="tile-face" class:solo={people.length === 1} class:second={i === 1}><ArtistAvatar cli={face.cli} profile={face.profile} size={Math.round(width * (people.length === 1 ? 0.6 : i === 0 ? 0.52 : 0.42))} ring={people.length > 1} /></span>{:else}<UiIcon name="orchestra" size={Math.round(width * 0.4)} />{/each}
              {/snippet}
              {#snippet flag()}{@render warnFlags(warn)}{/snippet}
              {#snippet actions()}{@render libraryActs(run)}{/snippet}
            </CoverCard>
          {/each}
        </div>
      {:else}
      {#each albums as run (run.runId)}
        {@const people = faces(run.runId)}
        <div class="album-row" data-orch-recent-row={run.runId} data-state={shownRunState(run.state, run.previousState)}>
          <button type="button" class="album-name" onclick={() => openAlbum(run.runId)}>
            <span class="row-cover" data-faces={people.length} aria-hidden="true">{#each people as face, i (face.id)}<span class="row-face" class:second={i === 1}><ArtistAvatar cli={face.cli} profile={face.profile} size={people.length === 1 ? 30 : i === 0 ? 28 : 24} ring={people.length > 1} /></span>{:else}<StatusIcon icon={statusIcon(run)} size={20} />{/each}</span>
            <span class="name-text"><b>{run.name}</b><small title={run.repo}>{albumRowMeta(t("orch.library.row.meta", { tracks: trackCountText(run.taskCount, t), when: relativeTime(run.updatedAt, now, t) }), run.repo, studio !== null, t, studioLabel(run.repo))}</small></span>
          </button>
          <span class="cols">
            <span class="state"><StatusIcon icon={rowIcon(run)} size={16} />{keyText(RUN_STATE_KEY, shownRunState(run.state, run.previousState), t)}</span>
            {@render rowChips(libraryRowChips(run, t))}
            <span class="actions">{@render libraryActs(run)}</span>
          </span>
        </div>
      {:else}<p class="empty">{loading ? t("orch.board.loading") : t("orch.library.empty")}</p>{/each}
      {/if}
    </section>
    {/if}
    {/if}
    {#if error}<p role="alert" class="empty">{error}</p>{/if}
  </section>
</div>

<style>
  .home { flex: 1; min-height: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; padding: 12px; overflow: hidden; }
  .library { container: library / inline-size; background: var(--bg-panel); border-radius: var(--radius-surface); min-height: 0; overflow: auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 20px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  h2 { margin: 0; font-size: 28px; font-weight: 800; }
  h3 { margin: 0 0 12px; font-size: 15px; font-weight: var(--fw-semibold); }
  .new-album { height: 40px; padding: 0 18px; font-size: var(--t-sm); gap: 8px; }

  /* 스튜디오 화면 머리 — 표지 면은 앨범 표지와 같은 색 */
  .studio-head { align-items: flex-end; justify-content: flex-start; gap: 16px; }
  .studio-cover { flex: none; width: 104px; height: 104px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: var(--m3-primary-container, var(--accent-soft)); color: var(--m3-on-primary-container, var(--fg-1)); }
  .studio-info { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .studio-info h2 { line-height: 1.2; overflow-wrap: anywhere; }
  .studio-kicker { font-size: var(--t-xs); font-weight: 700; letter-spacing: 0.04em; color: var(--fg-3); }
  .studio-path { font-family: var(--font-mono); font-size: var(--t-xs); color: var(--fg-3); overflow-wrap: anywhere; }
  .studio-summary { font-size: var(--t-xs); color: var(--fg-2); }

  /* 걸러보기 한 줄 — 진행 칩 | 저장소 라벨 + 폴더 칩 */
  .filters, .chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--control-bg); color: var(--control-fg); font: inherit; font-size: var(--t-xs); white-space: nowrap; cursor: pointer; box-shadow: var(--glass-ctl-edge, none); }
  /* 표지 카드 격자 — 스튜디오 · 앨범 · 보관함이 같은 칸(좁아도 한 줄에 둘) */
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(132px, calc(50% - 6px)), 1fr)); gap: 16px 12px; }
  .tile-face { position: absolute; left: 8%; top: 9%; display: flex; }
  .tile-face.second { left: 46%; top: 28%; }
  .tile-face.solo { left: 16%; top: 13%; }
  .warn-flag { width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--warn-soft); color: var(--on-warn-soft); }
  .chip:hover:not(:disabled) { background: var(--control-bg-hover); color: var(--fg-1); }
  .chip[aria-checked="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); box-shadow: var(--glass-sel-edge, none); }
  .chip:disabled { opacity: 0.45; cursor: default; }
  .chip:focus-visible, .album-open:focus-visible, .album-name:focus-visible, .adopt:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

  /* 최근 — 가로로 나란한 큰 카드 */
  .block { display: flex; flex-direction: column; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 12px; }
  .album-card {
    --card-bg: color-mix(in srgb, var(--m3-primary-container, var(--accent-soft)) 40%, var(--control-tile-bg));
    --cover-bg: var(--m3-primary-container, var(--accent-soft));
    --status-fg: var(--accent);
    display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 14px; background: var(--card-bg); min-width: 0;
  }
  .album-card.warm {
    --card-bg: color-mix(in srgb, var(--warn) 12%, var(--control-tile-bg));
    --cover-bg: color-mix(in srgb, var(--warn) 30%, var(--control-tile-bg));
    --status-fg: var(--warn);
  }
  .album-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 0; border: 0; border-radius: 12px; background: transparent; color: var(--fg-1); font: inherit; text-align: left; cursor: pointer; }
  .cover { --album-bg: var(--cover-bg); position: relative; flex: 0 0 auto; width: 64px; height: 64px; border-radius: 10px; background: var(--cover-bg); overflow: hidden; }
  .face { position: absolute; left: 4px; top: 4px; }
  .face.second { left: auto; top: auto; right: 4px; bottom: 4px; }
  .cover[data-faces="1"] .face { left: 12px; top: 12px; }
  .cover-icon { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--status-fg); opacity: 0.8; }
  .card-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .album-status { display: flex; align-items: center; gap: 6px; font-size: var(--t-xs); font-weight: var(--fw-semibold); color: var(--status-fg); }
  .card-title { font-size: 14px; font-weight: 700; }
  .meta { font-size: var(--t-xs); color: var(--fg-2); }
  .adopt { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center; background: var(--warn); color: var(--warn-soft); cursor: pointer; }
  .adopt:hover { filter: brightness(1.08); }

  /* 앨범 — 줄마다 카드(표지 · 제목 · 상태 · 동작) · 스튜디오 이름은 제목 아래 작은 글에 */
  .rows { gap: 6px; }
  .rows h3 { margin-bottom: 6px; }
  .list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .rows .list-head { margin-bottom: 6px; }
  .list-head h3 { margin: 0; }
  .view-pick { display: inline-flex; flex: none; gap: 2px; padding: 3px; border-radius: 999px; background: var(--control-bg); box-shadow: var(--glass-ctl-edge, none); }
  .view-pick button { width: 34px; height: 28px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 999px; background: transparent; color: var(--control-fg); cursor: pointer; }
  .view-pick button:hover { color: var(--fg-1); }
  .view-pick button[aria-checked="true"] { background: var(--control-sel-bg); color: var(--control-sel-fg); box-shadow: var(--glass-sel-edge, none); }
  .view-pick button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  .album-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 8px 12px; border-radius: 14px; transition: background-color 120ms ease; }
  .album-row:hover { background: var(--control-tile-bg); }
  span.album-name { cursor: default; }
  .album-name { display: flex; align-items: center; gap: 14px; min-width: 0; padding: 0; border: 0; border-radius: 10px; background: transparent; color: var(--fg-1); font: inherit; text-align: left; cursor: pointer; }
  .row-cover { width: 48px; height: 48px; flex: 0 0 auto; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--control-tile-bg); color: var(--fg-2); }
  .row-cover[data-faces="2"] { position: relative; }
  .row-cover[data-faces="2"] .row-face { position: absolute; left: 3px; top: 3px; display: flex; }
  .row-cover[data-faces="2"] .row-face.second { left: auto; top: auto; right: 3px; bottom: 3px; }
  /* 표지 면 = 앨범 머리와 같은 색(상태는 줄의 상태 칸이 말한다) */
  .row-cover[data-faces] { --album-bg: var(--m3-primary-container, var(--accent-soft)); background: var(--album-bg); }
  .name-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  /* 상태 · 칩 · 동작 세 칸 고정 폭 — 칩 · 단추 수가 달라도(빈 칸이어도) 열이 줄마다 세로로 맞는다. 칩 · 단추는 칸 오른쪽 끝에 붙는다(목업) */
  .cols { display: grid; grid-template-columns: 150px 180px 108px; align-items: center; gap: 14px; }
  .state { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: var(--fg-2); }
  .album-row[data-state="done"] .state { color: var(--ok); }
  .album-row[data-state="running"] .state { color: var(--accent); }
  .album-row[data-state="paused"] .state, .album-row[data-state="stopping"] .state { color: var(--warn); }
  .actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
  /* 원형 아이콘 단추 — 이름은 aria-label · 앱 툴팁(title) */
  .icon-btn { width: 32px; height: 32px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 50%; background: var(--control-bg); color: var(--fg-1); cursor: pointer; box-shadow: var(--glass-ctl-edge, none); }
  .icon-btn:hover:not(:disabled) { background: var(--control-bg-hover); }
  .icon-btn:disabled { opacity: 0.45; cursor: default; }
  .icon-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  /* 되돌릴 수 없는 단추 — 독의 `.tool-btn.danger` 와 같은 실패색 짝(쉴 때 면은 이웃과 같고 호버 · 포커스에 --err-soft) · 진한 위험 면은 확인 창의 [영구 삭제] 몫 */
  .icon-btn.danger { color: var(--err); }
  .icon-btn.danger:hover:not(:disabled), .icon-btn.danger:focus-visible { background: var(--err-soft); }
  /* 상태 칩 — 정보 표시(누르는 것이 아니다) · 색은 앱의 상태 알약(ExecList · SessionSheet)과 같은 톤 짝 */
  .row-chips { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; }
  .status-chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: var(--t-xs); white-space: nowrap; cursor: default; }
  .status-chip.warn { background: var(--warn-soft); color: var(--on-warn-soft); }
  .status-chip.ok { background: var(--ok-soft); color: var(--on-ok-soft); }
  .archive-note { margin: 0 0 8px; font-size: var(--t-xs); color: var(--fg-2); }
  .album-row[data-state="stopped"] .state, .album-row[data-state="orphaned"] .state { color: var(--fg-2); }
  b, small { display: block; overflow-wrap: anywhere; }
  small { font-size: var(--t-xs); color: var(--fg-2); }
  .empty { margin: 0; color: var(--fg-2); font-size: var(--t-xs); line-height: 1.6; }

  @container library (max-width: 960px) {
    .cols { grid-template-columns: 100px 170px 108px; }
  }
  @container library (max-width: 760px) {
    .album-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .cols { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-left: 62px; }
    .actions, .row-chips { justify-content: flex-start; }
    .row-chips:empty { display: none; }
  }
  /* 폰 — 폭과 무관하게 세로로 쌓고 단추를 손가락 크기로 */
  .home.phone .album-row { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .home.phone .cols { display: flex; flex-wrap: wrap; gap: 6px 14px; padding-left: 0; }
  .home.phone .actions, .home.phone .row-chips { justify-content: flex-start; }
  .home.phone .row-chips:empty { display: none; }
  .home.phone .icon-btn { width: 44px; height: 44px; }
  .home.phone .adopt { width: 44px; height: 44px; }
  @container (max-width: 720px) { .home { grid-template-columns: minmax(0, 1fr); grid-auto-rows: max-content; overflow: auto; } .library { overflow: visible; padding: 20px; } }
</style>
