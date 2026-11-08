<script lang="ts">
  // 트랙 플레이어의 가사 칸 — 고정 대화 꼬리·필터·따라가기를 쥔다.
  import { tick, untrack, onDestroy } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { TranscriptItem } from "$lib/context";
  import {
    LYRIC_FILTER_KEY,
    LYRIC_PAGE,
    GRADE_KEY,
    keyText,
    filterLyrics,
    formatDuration,
    isReviewer,
    lyricLines,
    lyricStep,
    mergeTail,
    nowDoing,
    orchReasonText,
    turnRunning,
    type AttemptView,
    type LyricFilter,
    type ReportView,
    type RunDetail,
    type WorkerActivity,
    type TrackPresentationKey,
  } from "$lib/orchestration/model";
  import { workerTranscript } from "$lib/orchestration/api";
  import { artistOf } from "../artists";
  import { clock } from "../board/format";
  import EqBars from "../EqBars.svelte";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import type { ArtistProfile } from "../artist-form";

  let {
    a,
    detail,
    activity,
    now,
    visible,
    titles,
    ensureFiles,
    stateKey,
    trackNo = 0,
    attemptNo = 1,
    profile = null,
    items = $bindable([]),
  }: {
    a: AttemptView;
    detail: RunDetail;
    activity: Record<string, WorkerActivity>;
    now: number;
    visible: boolean;
    titles: Map<string, string>;
    /** 보고 파일 목록 캐시(보고 id → 목록 · 읽는 중 · 오류 — 부모의 [파일 목록] 과 같은 것) */
    ensureFiles: (taskId: string, reportId: string) => void;
    stateKey: TrackPresentationKey;
    /** 트랙 화면 순번(머리 "TRACK n") */
    trackNo?: number;
    /** 이 트랙에서 몇 번째 시도인가(부제 "시도 n") */
    attemptNo?: number;
    /** 이 시도의 아티스트 프로필(이름 · 아이콘 — 없으면 띄울 때의 이름 사본 · CLI) */
    profile?: ArtistProfile | null;
    items: TranscriptItem[];
  } = $props();

  const judge = $derived(isReviewer(a) || a.kind === "judge");
  const art = $derived(artistOf(a.cli));
  const playing = $derived(detail.state !== "orphaned" && turnRunning(a));
  /** 아티스트 이름 — 지금 프로필 → 띄울 때의 이름 사본 → CLI 캐릭터 */
  const artistName = $derived(profile?.name || a.roleName?.trim() || (judge ? t("orch.attempt.role.reviewer") : art.name));
  const lastTurnOf = $derived((a.turns ?? []).length > 0 ? a.turns![a.turns!.length - 1] : null);
  const roleOf = $derived((detail.roles ?? []).find((r) => r.id === a.roleId) ?? null);
  /** 한 줄 부제(목업 "구현가 · Claude sonnet · 편집 자동 · 시도 2 · 턴 1") — 종류 · 강도는 툴팁 */
  const subParts = $derived.by(() => {
    const last = lastTurnOf;
    const model = last?.model ?? last?.args?.model ?? (roleOf?.model || null);
    const grade = last?.args?.grade ?? null;
    const parts = [artistName, model ? `${art.name} ${model}` : art.name];
    if (grade) parts.push(keyText(GRADE_KEY, grade, t));
    else if (roleOf?.permission) parts.push(roleOf.permission);
    parts.push(t("orch.player.attempt", { n: attemptNo }));
    if (last) parts.push(t("orch.turn.no", { n: last.n }));
    return parts;
  });
  const subTitle = $derived.by(() => {
    const effort = lastTurnOf?.args?.effort ?? (roleOf?.effort || null);
    const kind = t(judge ? "orch.kind.judge" : "orch.kind.write");
    return effort ? `${kind} · ${t("orch.artist.effort", { effort })}` : kind;
  });
  /** 곁 카드의 보고 — 판정형은 검토 대상, 쓰기형은 제 보고(늦은 것은 뒤로) */
  const report = $derived.by<ReportView | null>(() => {
    const reports = detail.reports ?? [];
    if (judge) return reports.find((r) => r.reportId === a.reviewOf?.reportId) ?? null;
    return reports.find((r) => r.attemptId === a.id && !r.late) ?? reports.find((r) => r.attemptId === a.id) ?? null;
  });

  // ── 가사(대화 끝 쪽) ───────────────────────────────────────────────────────
  let alive = true;
  onDestroy(() => { alive = false; });
  let older = $state(false);
  let readErr = $state<string | null>(null);
  let filter = $state<LyricFilter>("all");
  let follow = $state(true);
  let scroller = $state<HTMLDivElement | null>(null);
  let readFor = "";
  let readAt = 0;
  let reading = false;
  let readAgain = false;
  let readLater: ReturnType<typeof setTimeout> | null = null;

  async function readTail(): Promise<void> {
    const id = untrack(() => a.id);
    const run = untrack(() => detail.runId);
    if (!untrack(() => a.conversationId)) return;
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    readAt = Date.now();
    try {
      const page = await workerTranscript(run, id, null, LYRIC_PAGE);
      if (!alive || untrack(() => a.id) !== id) return;
      items = mergeTail(readFor === id ? untrack(() => items) : [], page.items ?? []);
      readFor = id;
      older = page.cursor !== null && page.cursor !== undefined;
      readErr = null;
    } catch (e) {
      if (alive && untrack(() => a.id) === id) readErr = orchReasonText(String(e), t);
    } finally {
      reading = false;
      if (readAgain) {
        readAgain = false;
        schedule();
      }
    }
  }

  /** 신호가 몰려도 0.5초 모아 한 번 · 앞 읽기에서 1.5초 뒤까지는 미룬다 */
  function schedule(): void {
    if (!alive || readLater !== null) return;
    const wait = Math.max(500, 1500 - (Date.now() - readAt));
    readLater = setTimeout(() => {
      readLater = null;
      void readTail();
    }, wait);
  }

  // 아티스트가 바뀌면 가사를 비우고 곧바로 읽는다(보일 때만). 판을 다시 읽으면 `a` 는 새 객체다 — id 값이 바뀔 때만(파생 값 비교).
  const aid = $derived(a.id);
  $effect(() => {
    void aid;
    untrack(() => {
      items = [];
      readFor = "";
      older = false;
      readErr = null;
      follow = true;
      if (visible) void readTail();
    });
  });

  // 다시 읽기 신호 — 판이 이미 받는 것만(F4 진행 칸 · 대화 증가 시각 · 최근 활동의 증가 시각 · 턴 수 · 대화 고정). 새 타이머 없음.
  const signal = $derived.by(() => {
    const turns = a.turns ?? [];
    const last = turns.length > 0 ? turns[turns.length - 1] : null;
    return [
      a.conversationId ?? "",
      turns.length,
      last?.outcome ?? "",
      last?.tools ?? 0,
      last?.lastTool ?? "",
      detail.transcripts?.[a.id]?.lastGrowthAt ?? 0,
      activity[a.id]?.lastGrowthAt ?? 0,
      (detail.reports ?? []).length,
    ].join("|");
  });
  let seenSignal = "";
  $effect(() => {
    const s = signal;
    if (!visible) return;
    untrack(() => {
      if (s === seenSignal) return;
      const first = seenSignal === "";
      seenSignal = s;
      // 첫 값은 아티스트 효과가 이미 읽는다 — 바뀔 때만.
      if (!first) schedule();
    });
  });

  // 숨었다 보이면 한 번(가려진 동안 놓친 증가).
  let wasVisible = untrack(() => visible);
  $effect(() => {
    const v = visible;
    untrack(() => {
      if (v && !wasVisible) void readTail();
      wasVisible = v;
    });
  });

  $effect(() => {
    return () => {
      if (readLater !== null) clearTimeout(readLater);
    };
  });

  // 보고 파일 목록(쓰기형 보고 뒤 · 판정형 검토 대상) — 부모 캐시로 한 번.
  $effect(() => {
    const r = report;
    if (r) untrack(() => ensureFiles(r.taskId, r.reportId));
  });

  const lines = $derived(lyricLines(items, a, detail.reports ?? [], t));
  const shown = $derived(filterLyrics(lines, filter));
  const doing = $derived(playing ? nowDoing(lines, a, now) : null);
  const lastLine = $derived(shown.length > 0 ? shown[shown.length - 1] : null);
  /** 마지막 줄이 곧 지금 도구면 아래 줄은 경과만 */
  const doingSame = $derived(!!doing && !!lastLine && lastLine.kind === "tool" && lastLine.pending && lastLine.text === doing.text);

  // 따라가기 — 맨 아래를 지키다가 사람이 위로 굴리면 멈춘다.
  function onScroll(): void {
    const el = scroller;
    if (!el) return;
    follow = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  function toLatest(): void {
    follow = true;
    void tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  $effect(() => {
    void shown.length;
    void lastLine?.key;
    void doing?.text;
    void filter;
    if (!untrack(() => follow)) return;
    void tick().then(() => {
      if (scroller && untrack(() => follow)) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  const FILTERS: LyricFilter[] = ["all", "tools", "says"];

</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
<div
  class="artist"
  data-artist-detail={a.id}
  data-artist-kind={judge ? "judge" : "write"}
  data-artist-playing={playing ? "1" : "0"}
>
  <section class="main">
    <div class="who">
      <span class="face" class:live={playing} class:judge><ArtistAvatar cli={a.cli} {profile} size={104} /></span>
      <div class="who-text">
        <span class="kicker" data-track-status-note title={t(stateKey)}>{t("orch.player.kicker", { no: trackNo, state: t(stateKey).split(" · ")[0] })}</span>
        <span class="title" title={titles.get(a.taskId) ?? a.taskId}>{titles.get(a.taskId) ?? a.taskId}</span>
        <span class="sub" data-artist-sub title={subTitle}>{subParts.join(" · ")}</span>
      </div>
    </div>

    <!-- 걸러 보기 — 목업에 없는 기능이라 가사 칸 오른쪽 위의 흐린 글자 단추로 -->

    <div class="filters" role="group" aria-label={t("orch.artist.lyrics.filter")}>
      {#each FILTERS as f (f)}
        <button type="button" class="fchip" class:on={filter === f} aria-pressed={filter === f} data-lyric-filter={f} onclick={() => (filter = f)}
          >{t(LYRIC_FILTER_KEY[f])}</button
        >
      {/each}
    </div>

    <div class="lyrics" bind:this={scroller} onscroll={onScroll} aria-label={t("orch.artist.lyrics.label")} data-artist-lyrics data-follow={follow ? "1" : "0"}>
      <ol class="lines">
        {#if older && filter === "all"}
          <li class="older">{t("orch.artist.lyrics.older")}</li>
        {/if}
        {#if shown.length === 0}
          <li class="empty" data-lyrics-empty>{readErr ?? t("orch.artist.lyrics.empty")}</li>
        {/if}
        {#each shown as l, i (l.key)}
          {@const isNow = playing && i === shown.length - 1}
          <li
            class="line"
            class:now={isNow}
            data-kind={l.kind}
            data-step={lyricStep(i, shown.length)}
            data-pending={l.pending ? "1" : "0"}
            class:error={l.error}
            title={l.full ?? undefined}
          >
            <span class="at mono">{l.at === null ? "" : clock(l.at)}</span>
            <span class="text"
              >{l.text}{#if isNow}<span class="eq"><EqBars state={judge ? "reviewing" : "playing"} size={20} /></span>{/if}</span
            >
          </li>
        {/each}
        {#if doing}
          <li class="doing mono" data-artist-doing>
            {#if doingSame}
              {doing.sinceMs === null ? "" : t("orch.artist.elapsed", { elapsed: formatDuration(doing.sinceMs) })}
            {:else}
              {doing.sinceMs === null ? doing.text : t("orch.artist.since", { text: doing.text, elapsed: formatDuration(doing.sinceMs) })}
            {/if}
          </li>
        {/if}
      </ol>
    </div>
    {#if !follow}
      <button type="button" class="latest" data-artist-latest onclick={toLatest}>{t("orch.artist.follow")} ↓</button>
    {/if}
  </section>

</div>

<style>
  .artist {
    outline: none;
    flex: 1;
    min-height: 0;
    display: flex;
    padding: 0;
    box-sizing: border-box;
  }
  .main {
    flex: 1;
    position: relative;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
  }
  .kicker { font-size: var(--t-xs); color: var(--accent); font-weight: 700; letter-spacing: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .who {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-top: 18px;
    min-width: 0;
  }
  .face {
    flex: 0 0 auto;
    display: inline-flex;
    border-radius: 50%;
  }
  .face.live {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .face.live.judge {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--tertiary, var(--accent)) 18%, transparent);
  }
  .who-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-size: 26px;
    font-weight: 900;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    color: var(--fg-2);
    font-size: var(--t-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .filters {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    margin-top: 10px;
  }
  .fchip {
    font: inherit;
    font-size: 11.5px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 0;
    background: transparent;
    color: var(--fg-3);
    cursor: pointer;
  }
  .fchip:hover {
    color: var(--fg-2);
  }
  .fchip.on {
    background: var(--control-bg, var(--surface-hover));
    color: var(--fg-1);
  }
  .lyrics {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 12px 0 28px;
    scrollbar-width: thin;
  }
  .lines {
    margin: auto 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .line {
    display: flex;
    gap: 14px;
    font-size: 14px;
    color: var(--fg-3);
    line-height: 1.45;
    animation: lyric-in 0.28s ease-out;
  }
  /*
   * (⑤ 다듬기) 위로 갈수록 작고 흐리게 — 목업 `WorkerDetail` 의 단계(지금 줄 28px 굵게 · 바로 위 17 · 16 · 15 · 15px, 색은 한 단계마다 옅게).
   * 가장 옛 단계는 글자색을 판 쪽으로 섞어(투명 섞기) 밝은 · 어두운 테마 모두 배경으로 가라앉는다. 정적 스타일이라 움직임 줄이기와 무관.
   */
  .line[data-step="4"] {
    font-size: 15px;
    color: color-mix(in srgb, var(--fg-3) 55%, transparent);
  }
  .line[data-step="3"] {
    font-size: 15px;
    color: color-mix(in srgb, var(--fg-3) 78%, transparent);
  }
  .line[data-step="2"] {
    font-size: 16px;
    color: var(--fg-3);
  }
  .line[data-step="1"] {
    font-size: 17px;
    color: var(--fg-2);
  }
  .line[data-step="0"] {
    font-size: 17px;
    color: var(--fg-1);
  }
  .line[data-kind="turn"],
  .line[data-kind="end"] {
    font-size: var(--t-sm);
    letter-spacing: 0.3px;
  }
  .line[data-kind="denied"],
  .line.error {
    color: var(--warn);
  }
  .line[data-kind="report"] {
    color: var(--ok);
  }
  .line[data-kind="report"].error {
    color: var(--warn);
  }
  .line.now {
    font-size: 28px;
    font-weight: 900;
    color: var(--fg-1);
    line-height: 1.3;
  }
  .line.now .at {
    color: var(--accent);
    padding-top: 10px;
  }
  .at {
    flex: 0 0 64px;
    font-size: 12px;
    font-weight: 400;
    padding-top: 3px;
    color: var(--fg-3);
  }
  .text {
    min-width: 0;
    word-break: break-word;
  }
  .eq {
    display: inline-flex;
    vertical-align: middle;
    margin-left: 8px;
  }
  .doing {
    margin-left: 78px;
    font-size: var(--t-sm);
    color: var(--accent);
  }
  .older,
  .empty {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .latest {
    position: absolute;
    right: 24px;
    bottom: 16px;
    font: inherit;
    font-size: var(--t-xs);
    font-weight: 700;
    padding: 6px 14px;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  @keyframes lyric-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .line {
      animation: none;
    }
  }
  /* 좁은 판 — 곁 카드를 아래로(판 `.board` 가 크기 컨테이너) */
  @container (max-width: 720px) {
    .face :global(.avatar) {
      width: 72px !important;
      height: 72px !important;
    }
    .title {
      font-size: 20px;
    }
    .line.now {
      font-size: 20px;
    }
  }
</style>
