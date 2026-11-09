<script lang="ts">
  // 재생 막대 — 지금 곡과 사람 필요 종은 트랙 경로를 연다. 서버 동작·조회 수명은 그대로다.
  import { untrack } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { listen, type UnlistenFn } from "$lib/ipc";
  import type { TabSpec } from "$lib/session";
  import { listAiClis, offeredAiClis } from "$lib/session";
  import { settings } from "$lib/settings.svelte.js";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import { toast } from "$lib/toast.svelte.js";
  import { adoptWithNewProducer, homeDraft } from "$lib/app/orch-start.svelte.js";
  import { interruptProducer, producerLiveOf } from "$lib/app/producer-chat.svelte.js";
  import { runSummaryOf } from "$lib/app/orch-pulse.svelte.js";
  import { RUN_CHANGED_EVENT, pauseRun, resumeRun, runDetail, runSnapshot, stopRun } from "./api";
  import {
    keyText,
    albumLive,
    needsHuman,
    nowPlaying,
    orchReasonText,
    RUN_STATE_KEY,
    runActions,
    trackCountText,
    trackNo,
    toolWordKey,
    shownRunState,
    type RunDetail,
    type RunSummary,
  } from "./model";
  import { artistOf } from "./artists";
  import { navigateOrchTab } from "$lib/app/orchestration.svelte.js";
  import ArtistAvatar from "./player/ArtistAvatar.svelte";
  import { createArtistLoader } from "./artist-loader.svelte.js";
  import { albumFaces, albumMembers } from "./player/album-faces";
  import EqBars from "./EqBars.svelte";
  import { keepAlbumOrigin, producerLeafOf } from "./orch-tab";
  import { albumScreens, orchScreenPath } from "$lib/app/album-screen.svelte.js";
  import Dropdown from "$lib/Dropdown.svelte";

  let { tab, shown }: { tab: TabSpec; shown: boolean } = $props();

  const path = $derived(orchScreenPath(tab));
  const runId = $derived(path.runId ?? null);
  /** (2단계 단계 3) 프로듀서 채팅 잎(연 것만 — 홈의 "새 앨범" 칸은 아직 프로듀서가 아니다) */
  const producerChat = $derived(albumScreens[tab.id]?.producer?.chat ?? (producerLeafOf(tab)?.producer?.opened ? (producerLeafOf(tab)?.producer?.chatId ?? null) : null));
  const hasProducer = $derived(producerChat !== null);
  // (단계 5 — 이어받기 마무리) [프로듀서 열기] 는 서버 판정 `adoptable`(`adopt_verdict` — 라이브러리 · 채팅과 같은 함수)이 되찾을 수 있다는 앨범에만 —
  // 끝난 앨범 · 조정자가 다른 창에 묶인 앨범 · 되찾을 수 없는 orphaned 에는 세우지 않는다(서버가 `not-adoptable` 로 거절할 문장을 채우지 않게).
  // 목록 요약에 아직 없으면(읽기 전) 막지 않는다 — 판정은 늘 서버
  const adoptOk = $derived(runSummaryOf(runId)?.adoptable.restore ?? true);
  /** 홈 모양(프로듀서 · 앨범 없음) — 빈 막대 + 스튜디오 · 진행 중 앨범 수 */
  const isHome = $derived(path.view === "library" || path.view === "studio" || path.view === "artists" || path.view === "new");

  let detail = $state<RunDetail | null>(null);
  let busy = $state(false);
  let now = $state(Date.now());

  // 앨범 상세 — 보일 때만 읽고, 그 앨범의 변화 이벤트에 다시 읽는다.
  $effect(() => {
    const id = runId;
    if (!shown || id === null) {
      if (id === null) detail = null;
      return;
    }
    // 숨은 동안 앨범 주소가 바뀌었으면(이어받기 · 다른 앨범) 옛 앨범을 비우고 다시 읽는다 — 보이게 될 때마다 이 효과가 한 번 읽는다.
    if (untrack(() => detail)?.runId !== id) detail = null;
    let alive = true;
    const load = () =>
      runDetail(id).then(
        (d) => {
          if (alive) detail = d;
        },
        () => {
          if (alive) detail = null;
        },
      );
    void load();
    let un: UnlistenFn | null = null;
    void listen<{ runId?: string }>(RUN_CHANGED_EVENT, (ev) => {
      if (ev.payload?.runId === id) void load();
    })
      .then((f) => {
        if (alive) un = f;
        else f();
      })
      .catch(() => {});
    const clock = setInterval(() => (now = Date.now()), 1000);
    return () => {
      alive = false;
      un?.();
      clearInterval(clock);
    };
  });

  // (④) 홈의 막대 오른쪽 수 — 보일 때만 목록을 읽고, 변화 이벤트에 다시(맡기기 사본은 홈이 읽는다).
  let runs = $state<RunSummary[]>([]);
  $effect(() => {
    if (!shown || !isHome) return;
    let alive = true;
    const load = () => runSnapshot().then((l) => alive && (runs = l), () => {});
    void load();
    let un: UnlistenFn | null = null;
    void listen(RUN_CHANGED_EVENT, () => void load())
      .then((f) => {
        if (alive) un = f;
        else f();
      })
      .catch(() => {});
    return () => {
      alive = false;
      un?.();
    };
  });
  const homeCounts = $derived(isHome ? { liveCount: runs.filter(albumLive).length } : null);

  const actions = $derived(detail ? runActions(detail.state, detail.coordinatorAttached) : null);
  /** 끝난 앨범 — 가운데 단추는 꺼진 ⏸ 가 아니라 완료 표시(실기 10-31) */
  const ended = $derived(!!detail && (detail.endedAt != null || detail.state === "done" || detail.state === "stopped"));
  const barState = $derived(detail ? shownRunState(detail.state, detail.previousState) : "running");
  const profiles = createArtistLoader();
  $effect(() => profiles.subscribe());
  /** 표지 얼굴 — 앨범 머리와 같다 */
  const faces = $derived(detail ? albumFaces(albumMembers(detail, profiles.list), null) : []);

  /** 조율 시간 — 시작부터 지금까지 · 한도(조율 마감) */
  const timing = $derived.by(() => {
    if (!detail) return null;
    const start = detail.createdAt;
    const end = detail.coordinationDeadlineAt;
    const total = Math.max(1, end - start);
    const upto = detail.endedAt ?? now;
    const used = Math.min(total, Math.max(0, upto - start));
    return { used, total, pct: (used / total) * 100 };
  });

  /** 도는 작업자 수 / 동시 한도 */
  const workers = $derived.by(() => {
    if (!detail) return null;
    const live = (detail.attempts ?? []).filter((a) => a.state === "running").length;
    return { live, max: detail.limits.maxConcurrentWorkers };
  });

  /** 쓴 검토 수 / 검토 한도(맡기기의 `max_reviews` — 옛 서버면 없다) */
  const reviews = $derived.by(() => {
    const max = detail?.limits.maxReviews;
    const left = detail?.remaining?.reviews;
    if (!detail || typeof max !== "number" || typeof left !== "number" || max <= 0) return null;
    return { used: Math.max(0, max - left), max };
  });

  /** 지금 곡 — 도는 쓰기형 턴(없으면 판정형) */
  const playing = $derived(detail ? nowPlaying(detail) : null);
  /** 사람이 필요한 일 — 배지 수 · 누르면 첫 트랙 항목(없으면 판 머리)으로 */
  const needs = $derived(detail ? needsHuman(detail) : []);

  /** 지금 곡 → 그 트랙 화면(③ 에서 넘어온 것 — 판이 `artistId` 요청을 받아 연다) */
  function focusNow(): void {
    const id = runId;
    if (id === null || !playing) return;
    navigateOrchTab(tab.id, { view: "track", runId: id, taskId: playing.attempt.taskId, attemptId: playing.attempt.id, ...keepAlbumOrigin(path, id) });
  }

  function focusNeed(): void {
    const id = runId;
    if (id === null || needs.length === 0) return;
    const first = needs.find((n) => n.taskId !== null) ?? needs[0];
    navigateOrchTab(tab.id, first.taskId ? { view: "track", runId: id, taskId: first.taskId, ...keepAlbumOrigin(path, id) } : { view: "album", runId: id, ...keepAlbumOrigin(path, id) });
  }

  /** 한도 칸의 작은 막대(목업 — 8칸까지만 그린다) */
  function pips(n: number, max: number): boolean[] | null {
    if (max <= 0 || max > 8) return null;
    return Array.from({ length: max }, (_, i) => i < n);
  }

  function clock(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }

  async function act(run: () => Promise<unknown>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (e) {
      toast.error(orchReasonText(String(e), t));
    } finally {
      busy = false;
    }
  }

  async function stop(): Promise<void> {
    const id = runId;
    if (id === null) return;
    let go = false;
    try {
      go = await askConfirm(t("orch.stop.text"), {
        title: t("orch.stop.title"),
        kind: "warning",
        okLabel: t("orch.stop.ok"),
        cancelLabel: t("orch.stop.cancel"),
        danger: true,
      });
    } catch {
      return;
    }
    if (go) await act(() => stopRun(id));
  }

  /** ✕ 프로듀서 응답 끊기 — 응답만 끊고 대기열은 보류(사람 동작 · D7) */
  function interrupt(): void {
    if (producerChat) void interruptProducer(producerChat, false);
  }
  const canInterrupt = $derived(producerChat !== null && producerLiveOf(producerChat)?.state.status === "running");

  // ── 프로듀서 열기(프로듀서가 없을 때 — 홈 · 프로듀서 없는 앨범) ─────────────
  let clis = $state<{ command: string; id: string; name: string }[]>([]);
  let cliId = $state<string>("");

  $effect(() => {
    if (!shown || hasProducer) return;
    void listAiClis().then((all) => {
      clis = offeredAiClis(all, settings.disabledAgents).filter((c) => c.id === "claude" || c.id === "codex");
      if (!clis.some((c) => c.id === cliId)) cliId = clis[0]?.id ?? "";
    });
  });

  function openProducer(): void {
    const cli = clis.find((c) => c.id === cliId);
    const d = detail;
    if (!cli || !d) return;
    homeDraft.cliId = cli.id;
    void adoptWithNewProducer({ runId: d.runId, name: d.name, repo: d.repo, adoptable: runSummaryOf(d.runId)?.adoptable ?? null });
  }
</script>

<!-- 판 = 독과 같은 떠 있는 면(`.glass-mid` — 글래스면 흐림 · 흰 선 · 그림자, 평면이면 지금 모양 그대로 · 10-30 실기) -->
<div class="orch-bar glass-mid" data-orch-bar={tab.id}>
  <div class="left">
    {#if runId !== null && playing}
      {@const art = artistOf(playing.attempt.cli)}
      {@const toolKey = playing.tool ? toolWordKey(playing.tool) : null}
      <button type="button" class="now" data-orch-now={playing.attempt.id} data-orch-now-kind={playing.kind}
        aria-label={t("orch.bar.now.open", { name: art.name })} title={t("orch.bar.now.open", { name: art.name })} onclick={focusNow}>
        <ArtistAvatar cli={playing.attempt.cli} size={56} square />
        <div class="album">
          <span class="name" title={playing.task?.title ?? ""}>{playing.no > 0 ? `${trackNo(playing.no)} ` : ""}{playing.task?.title ?? detail?.name ?? ""}</span>
          <!-- 가운뎃점은 양옆 한 칸씩(`{" · "}` — 블록 경계의 공백은 Svelte 가 걷는다 · 실기 10-31 "Codex· 검토자·") · Codex 항목 낱말은 사람 낱말로 -->
          <span class="sub">
            <b class="who">{art.name}</b>{#if playing.attempt.roleName}{" · "}{playing.attempt.roleName}{/if}{#if playing.tool}{" · "}{#if toolKey}{t(toolKey)}{:else}<span class="mono">{playing.tool}</span>{/if}{/if}
          </span>
        </div>
        <EqBars state={playing.kind === "judge" ? "reviewing" : "playing"} size={16} />
      </button>
    {:else if runId !== null}
      <!-- 재생 중과 같은 자리 · 같은 꼴(표지 + 제목 + 한 줄) — 누르면 앨범 판. 끝난 앨범에 프로듀서가 없는 것은 정상이라 경고 색을 뺀다 -->
      <button type="button" class="now" data-orch-now-album={runId} title={t("orch.bar.album.open")} aria-label={t("orch.bar.album.open")}
        onclick={() => runId !== null && navigateOrchTab(tab.id, { view: "album", runId, ...keepAlbumOrigin(path, runId) })}>
        <span class="cover" data-faces={faces.length} aria-hidden="true">
          {#each faces as a, i (a.id)}
            <span class="face" data-i={i}><ArtistAvatar cli={a.cli} profile={a.profile} size={faces.length === 1 ? 56 : i === 0 ? 34 : 28} square={faces.length === 1} ring={faces.length > 1} /></span>
          {/each}
        </span>
        <span class="album">
          <span class="name" title={detail?.repo ?? ""}>{detail?.name ?? tab.pinnedTitle ?? ""}</span>
          <span class="sub">
            {#if detail}<b class="who">{keyText(RUN_STATE_KEY, barState, t)}</b>{" · "}{trackCountText(detail.tasks.length, t)}{/if}
            {#if !hasProducer}<span class:warn={!ended}>{" · "}{t("orch.bar.noProducer")}</span>{/if}
          </span>
        </span>
      </button>
    {:else if isHome}
      <div class="now empty" data-orch-bar-empty>
        <span class="disc" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="2.5"></circle></svg></span>
        <span class="sub">{t("orch.bar.home.empty")}</span>
      </div>
    {:else if hasProducer}
      <div class="album">
        <span class="name">{t("orch.tab.preparing")}</span>
        <span class="sub">{t("orch.bar.noAlbum")}</span>
      </div>
    {/if}
    {#if !hasProducer && !isHome && runId !== null && adoptOk}
      <div class="opener" data-orch-producer-opener>
          <span class="pick" data-orch-pick-cli>
            <Dropdown bind:value={cliId} ariaLabel={t("orch.bar.producer")} options={clis.map((c) => ({ value: c.id, label: c.name }))} />
          </span>
          <button type="button" class="btn btn-sm btn-primary" data-orch-open-producer disabled={!cliId || !detail}
            onclick={openProducer}>{t("orch.bar.openProducer")}</button>
      </div>
    {/if}
  </div>

  <div class="center">
    <div class="buttons">
      <button type="button" class="round small danger" data-orch-bar-action="stop" aria-label={t("orch.bar.stop")} title={t("orch.bar.stop")}
        disabled={busy || !actions?.stop} onclick={() => void stop()}>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"></rect></svg>
      </button>
      {#if isHome}
        <button type="button" class="round main idle" data-orch-bar-action="start" aria-label={t("orch.new.start")} title={t("orch.bar.home.empty")} disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor"></path></svg>
        </button>
      {:else if ended}
        <button type="button" class="round main idle" data-orch-bar-action="ended" aria-label={t("orch.bar.ended", { state: keyText(RUN_STATE_KEY, barState, t) })}
          title={t("orch.bar.ended", { state: keyText(RUN_STATE_KEY, barState, t) })} disabled>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>
        </button>
      {:else if actions?.resume}
        <button type="button" class="round main" data-orch-bar-action="resume" aria-label={t("orch.btn.resume")}
          title={actions.resumeBlocked ? t("orch.btn.resume.noCoordinator") : t("orch.btn.resume")}
          disabled={busy || actions.resumeBlocked} onclick={() => void act(() => resumeRun(runId!))}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor"></path></svg>
        </button>
      {:else}
        <button type="button" class="round main" data-orch-bar-action="pause" aria-label={t("orch.btn.pause")} title={t("orch.btn.pause")}
          disabled={busy || !actions?.pause} onclick={() => void act(() => pauseRun(runId!))}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"></rect><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"></rect></svg>
        </button>
      {/if}
      <button type="button" class="round small" data-orch-bar-action="interrupt" aria-label={t("orch.bar.interrupt")} title={t("orch.bar.interrupt")}
        disabled={!canInterrupt} onclick={interrupt}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"></path></svg>
      </button>
    </div>
    <div class="time" title={t("orch.bar.time")}>
      <span>{timing ? clock(timing.used) : "–:––"}</span>
      <div class="track" aria-hidden="true"><div class="fill" style:width="{timing?.pct ?? 0}%"></div></div>
      <span class="muted">{timing ? clock(timing.total) : "–:––"}</span>
    </div>
  </div>

  <div class="right">
    {#if homeCounts}
      <span class="counts" data-orch-bar-counts>{t("orch.bar.home.counts", { live: homeCounts.liveCount })}</span>
    {/if}
    {#if workers}
      {@const wp = pips(workers.live, workers.max)}
      <div class="meter">
        <span class="count" data-orch-bar-workers>{t("orch.bar.workers", { n: workers.live, max: workers.max })}</span>
        {#if wp}<span class="pips" aria-hidden="true">{#each wp as on, i (i)}<span class="pip" class:on></span>{/each}</span>{/if}
      </div>
    {/if}
    {#if reviews}
      {@const rp = pips(reviews.used, reviews.max)}
      <div class="meter judges">
        <span class="count" data-orch-bar-reviews>{t("orch.bar.reviews", { n: reviews.used, max: reviews.max })}</span>
        {#if rp}<span class="pips small" aria-hidden="true">{#each rp as on, i (i)}<span class="pip judge" class:on></span>{/each}</span>{/if}
      </div>
    {/if}
    {#if runId !== null}
      <!-- 없음일 때도 툴팁이 뜨게 `disabled` 대신 `aria-disabled`(누름은 `focusNeed` 가 없으면 아무 일 없음) -->
      <button type="button" class="needs" class:has={needs.length > 0} data-orch-bar-needs={needs.length}
        aria-label={needs.length > 0 ? t("orch.bar.needs", { n: needs.length }) : t("orch.bar.needs.none")}
        title={needs.length > 0 ? t("orch.bar.needs", { n: needs.length }) : t("orch.bar.needs.none")}
        aria-disabled={needs.length === 0 ? "true" : undefined} onclick={focusNeed}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>
        {#if needs.length > 0}<span class="badge">{needs.length}</span>{/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .orch-bar {
    position: absolute;
    inset: 0;
    display: grid;
    /* 가운데 상한은 막대 폭의 절반까지 — 고정 상한(620px)만이면 좁은 막대에서 가운데가 남는 폭을 다 먹어 양옆 칸이 0 이 되고 오른쪽 계기가 ✕ 를 덮었다(실기 b) */
    grid-template-columns: minmax(0, 1fr) minmax(240px, min(620px, 50%)) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-5, 24px);
    padding: 0 20px;
    box-sizing: border-box;
    border: 1px solid var(--tile-rim, var(--line-faint));
    border-radius: var(--radius-surface);
    background: var(--glass-mid, var(--surface-raised));
    color: var(--fg-1);
    font-size: 12.5px;
    /* 좁은 막대(실기 b 24-real-620 — 오른쪽 계기가 넘쳐 ✕ 를 덮었다)는 아래 컨테이너 질의가 오른쪽 칸을 줄인다 */
    container: orchbar / inline-size;
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    min-width: 0;
  }
  .right {
    justify-content: flex-end;
    color: var(--fg-2);
  }
  .album {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 11.5px;
    color: var(--fg-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    color: var(--warn, var(--fg-2));
  }
  .opener {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    min-width: 0;
  }
  .pick {
    min-width: 0;
    max-width: 200px;
  }
  /* 고르개 옆 [프로듀서 열기] — 고르개와 같은 높이, 글자 · 여백은 전역 `.btn` 값 */
  .opener .btn {
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-size: var(--t-sm);
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .buttons {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .round {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--line-strong, var(--line-faint));
    background: transparent;
    color: var(--fg-2);
    cursor: pointer;
    padding: 0;
  }
  .round.small {
    width: 38px;
    height: 38px;
  }
  .round.main {
    width: 50px;
    height: 50px;
    border: 0;
    background: var(--fg-1);
    color: var(--surface-raised-solid, var(--bg));
  }
  .round.danger {
    color: var(--danger, var(--fg-2));
  }
  .round.main.idle { background: var(--surface-hover); color: var(--fg-2); }
  .round:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .round:not(:disabled):hover {
    filter: brightness(1.15);
  }
  .time {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-2);
  }
  .muted {
    color: var(--fg-3);
  }
  .track {
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background: var(--surface-field-solid, var(--line-faint));
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 999px;
    background: var(--accent);
  }
  /* 지금 곡 — 캐릭터 · 트랙 · 아티스트 · 도구 · 이퀄라이저(누르면 그 아티스트 화면) */
  .now {
    font: inherit;
    color: inherit;
    text-align: left;
    background: transparent;
    border: 0;
    padding: 4px 8px 4px 4px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  button.now {
    cursor: pointer;
  }
  button.now:hover {
    background: var(--state-hover, var(--surface-hover));
  }
  button.now:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
  }
  .cover {
    position: relative;
    flex: none;
    width: 56px;
    height: 56px;
    overflow: hidden;
    border-radius: 12px;
    /* 앨범 머리와 같은 표지 면 */
    --album-bg: var(--m3-primary-container, var(--accent-soft));
    background: var(--album-bg);
  }
  .cover .face { position: absolute; display: flex; }
  .cover[data-faces="1"] .face { inset: 0; }
  .cover[data-faces="2"] .face[data-i="0"] { left: 4px; top: 4px; }
  .cover[data-faces="2"] .face[data-i="1"] { right: 4px; bottom: 4px; }
  .now.empty {
    color: var(--fg-3);
  }
  .disc {
    width: 56px;
    height: 56px;
    border-radius: 12px;
    background: var(--control-bg, var(--surface-hover));
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-3);
    flex: 0 0 auto;
  }
  .counts,
  .count {
    font-size: var(--t-xs, 12px);
    white-space: nowrap;
  }
  .who {
    color: var(--fg-1);
  }
  .mono {
    font-family: var(--font-mono, monospace);
  }
  .meter {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }
  .pips {
    display: flex;
    gap: 4px;
  }
  .pip {
    width: 18px;
    height: 6px;
    border-radius: 3px;
    background: var(--control-track, var(--line-faint));
  }
  .pips.small .pip {
    width: 10px;
  }
  .pip.on {
    background: var(--accent);
  }
  .pip.judge.on {
    background: var(--tertiary, var(--accent));
  }
  /* 사람 필요 배지 — 있으면 호박색 종 + 수(누르면 첫 트랙으로) */
  .needs {
    position: relative;
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 0;
    background: var(--control-bg, var(--surface-hover));
    color: var(--fg-3);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .needs[aria-disabled="true"] {
    cursor: default;
  }
  .needs.has {
    color: var(--warn);
    cursor: pointer;
  }
  .needs:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
    outline-offset: 2px;
  }
  .needs.has:hover {
    filter: brightness(1.15);
  }
  .badge {
    position: absolute;
    top: 3px;
    right: 3px;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 999px;
    background: var(--warn);
    color: var(--bg);
    font-size: 10.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* 좁은 막대 — 오른쪽 칸은 넘치면 가운데(재생 단추)를 덮는다(flex-end 의 넘침은 왼쪽으로 간다). 검토 계기 → 계기 전부 순서로 걷는다 · 사람 필요 종은 남긴다 */
  @container orchbar (max-width: 820px) {
    .meter.judges {
      display: none;
    }
    .right {
      gap: var(--space-2, 8px);
    }
  }
  @container orchbar (max-width: 640px) {
    .meter,
    .counts {
      display: none;
    }
    .disc {
      display: none;
    }
  }
  /* 폰 폭 — 가운데 칸의 최소 240px 가 남는 폭을 다 먹어 앨범 이름 · 상태가 "재…" 처럼 한두 글자로 줄었다(11-06 남은 것).
     가운데는 단추만(시간 줄 걷음) · 단추 · 틈을 줄여 왼쪽 칸이 남는 폭을 받는다 */
  @container orchbar (max-width: 480px) {
    .orch-bar {
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: var(--space-2, 8px);
      padding: 0 12px;
    }
    .time {
      display: none;
    }
    .buttons {
      gap: 8px;
    }
    .round.small {
      width: 32px;
      height: 32px;
    }
    .round.main {
      width: 42px;
      height: 42px;
    }
    .now {
      gap: 8px;
    }
  }
</style>
