<script lang="ts">
  // 트랙 줄을 누르면 트랙 경로로 이동한다. 시도 단추는 같은 경로의 시도를 고른다.
  import { t, locale } from "$lib/i18n/i18n.svelte.js";
  import {
    TASK_STATE_KEY,
    keyText,
    formatDuration,
    clipText,
    shortOid,
    validAccepted,
    trackNo,
    trackStatusIcon,
    toolWordKey,
    type AttemptView,
    type RunDetail,
    type TrackRow,
  } from "$lib/orchestration/model";
  import { artistOf } from "../artists";
  import type { ArtistProfile } from "../artist-form";
  import EqBars from "../EqBars.svelte";
  import StatusIcon from "../StatusIcon.svelte";
  import ArtistAvatar from "./ArtistAvatar.svelte";

  let {
    row,
    detail,
    busy,
    ontoggle,
    onverify,
    onpermissions,
    onartist,
    profiles = [],
  }: {
    row: TrackRow;
    /** 아티스트 목록(이름 · 아이콘 — 부모가 한 번 읽어 나눠 준다) */
    profiles?: readonly ArtistProfile[];
    detail: RunDetail;
    busy: boolean;
    ontoggle: () => void;
    onverify: () => void;
    onpermissions: () => void;
    /** 아티스트를 눌렀다 — 그 Attempt 의 작업자 상세로(③) */
    onartist: (attemptId: string) => void;
  } = $props();

  const statusText = $derived(row.statusKey ? t(row.statusKey, { n: row.turnNo }) : keyText(TASK_STATE_KEY, row.task.state, t));
  const label = $derived(`${trackNo(row.no)} · ${statusText}`);
  /** 시도 → 그 아티스트 프로필(이름 · 아이콘 — 지금 목록, 지운 아티스트면 띄울 때의 이름 사본) */
  const profileOf = (a: AttemptView) => (a.roleId ? profiles.find((p) => p.id === a.roleId) ?? null : null);
  const nameOf = (a: AttemptView) => profileOf(a)?.name || a.roleName?.trim() || artistOf(a.cli).name;
  const writer = $derived(row.writer ? { name: nameOf(row.writer), profile: profileOf(row.writer) } : null);
  const judge = $derived(row.judge ? { name: nameOf(row.judge), profile: profileOf(row.judge) } : null);
  const acc = $derived(validAccepted(detail, row.task.id));
  /** 상태 칸 낱말 앞의 그림(10-30 — # 칸 그림은 그대로 두고 상태 칸에도) */
  const icon = $derived(trackStatusIcon(row));

  /** 줄 머리의 아티스트 줄 — 아티스트 이름 뒤 그때의 사실 한 마디(목업 "구현가 · Edit src/log.rs" — 지어내지 않는다 · 서버 칸만) */
  const subline = $derived.by(() => {
    const parts: string[] = [];
    if (row.need === "blocked" && row.blockedNeed) {
      parts.push(t("orch.track.sub.blocked", { need: clipText(row.blockedNeed, 80).short }));
    } else if (row.need === "verify") {
      parts.push(t("orch.track.sub.verify", { command: clipText(detail.verify?.command ?? "", 40).short }));
    } else if (row.glyph === "playing") {
      if (row.lastTool) { const k = toolWordKey(row.lastTool); parts.push(k ? t(k) : row.lastTool); }
    } else if (acc) {
      parts.push(acc.integrationCommit ? t("orch.track.sub.integrated", { oid: shortOid(acc.integrationCommit) }) : t("orch.track.sub.accepted"));
    }
    return parts.join(" · ");
  });

  /** 한국어 주격 조사 — 이름 끝 글자에 받침이 있으면 "이", 없거나 한글이 아니면 "가"("검토자가 듣는 중") */
  function subjectParticle(name: string): string {
    const code = name.trim().charCodeAt(name.trim().length - 1);
    return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0 ? "이" : "가";
  }

  function pick(e: Event, id: string): void {
    e.stopPropagation();
    onartist(id);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ontoggle();
    }
  }
</script>

<li class="track" data-tone={row.tone} data-track={row.task.id} data-track-no={row.no} data-track-glyph={row.glyph}>
  <div class="head" role="button" tabindex="0" onclick={ontoggle} onkeydown={onKey}>
    <span class="no" title={label} aria-label={label}>
      {#if row.glyph === "playing"}
        <EqBars state="playing" size={14} />
      {:else if row.glyph === "reviewing"}
        <EqBars state="reviewing" size={14} />
      {:else if row.glyph === "attention"}
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"></rect><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"></rect></svg>
      {:else if row.glyph === "waiting"}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>
      {:else}
        <span class="num" aria-hidden="true">{row.no}</span>
      {/if}
    </span>

    <span class="main">
      <span class="title" title={row.task.goal || row.task.title}>{row.task.title}</span>
      <span class="sub">
        {#if writer || judge}
          <span class="faces">
            {#if row.writer && !row.judge}{@const id = row.writer.id}<button type="button" class="face-btn" data-track-artist={id} aria-label={t("orch.track.artist.open", { name: writer?.name ?? "" })}
                onclick={(e) => pick(e, id)}><ArtistAvatar cli={row.writer.cli} profile={writer?.profile} size={20} dim={row.tone === "done" || row.tone === "faint"} /></button
              >{/if}
            {#if row.judge}{@const id = row.judge.id}<button type="button" class="face-btn judge-face" data-track-artist={id} aria-label={t("orch.track.artist.open", { name: judge?.name ?? "" })}
                onclick={(e) => pick(e, id)}><ArtistAvatar cli={row.judge.cli} profile={judge?.profile} size={20} /></button
              >{/if}
          </span>
        {/if}
        <!-- 검토 중이면 검토자 한 사람("검토자가 듣는 중"), 아니면 쓴 아티스트 이름 · 그때의 사실(목업) — 이름을 누르면 그 시도로 -->
        <span class="sub-text">
          {#if judge && row.judge}{@const id = row.judge.id}<button type="button" class="who"
              title={t("orch.track.artist.open", { name: judge.name })} onclick={(e) => pick(e, id)}
              >{t("orch.track.sub.listening", { who: locale() === "ko" ? `${judge.name}${subjectParticle(judge.name)}` : judge.name })}</button
            >{:else if writer && row.writer}{@const id = row.writer.id}<button type="button" class="who" title={t("orch.track.artist.open", { name: writer.name })}
              onclick={(e) => pick(e, id)}>{writer.name}</button
            >{#if subline}<span class="rest">{` · ${subline}`}</span>{/if}{/if}
          {#if !writer && !judge}<span class="none">{t("orch.track.noArtist")}</span>{/if}
        </span>
      </span>
    </span>

    <span class="status" data-track-status-icon={icon}>
      <StatusIcon {icon} />
      {#if row.gate === "verify" && detail.state !== "orphaned"}
        <button type="button" class="gate" data-track-gate="verify" disabled={busy}
          onclick={(e) => {
            e.stopPropagation();
            onverify();
          }}>{t("orch.verify.approve")}</button>
      {:else if row.gate === "permissions"}
        <button type="button" class="gate warn" data-track-gate="permissions"
          onclick={(e) => {
            e.stopPropagation();
            onpermissions();
          }}>{t("orch.perm.title")}</button>
      {:else}
        <span class="status-text">{statusText}</span>
      {/if}
    </span>

    <span class="progress" title={statusText} aria-hidden="true"><span class="fill" style:width="{Math.round(row.progress * 100)}%"></span></span>

    <span class="time">{row.timeMs === null ? "—" : formatDuration(row.timeMs)}</span>
  </div>

</li>

<style>
  .track {
    list-style: none;
    border-radius: var(--radius-md, 12px);
  }
  .head {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr) 150px 160px 60px;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: 10px 12px;
    border-radius: var(--radius-md, 12px);
    cursor: pointer;
    outline: none;
  }
  .head:hover {
    background: var(--state-hover, var(--surface-hover));
  }
  .head:focus-visible {
    box-shadow: inset 0 0 0 2px var(--focus-ring, var(--accent));
  }
  /* 지금 재생 중인 줄 — 목업의 옅은 강조 판 */
  .track[data-tone="playing"] > .head {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .track[data-tone="playing"] .title {
    color: var(--accent);
  }
  /* 사람 필요(막힘 · 충돌 · 검증 실패) — 호박 판 */
  .track[data-tone="attention"] > .head {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
  }
  .no {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 18px;
    justify-self: center;
    color: var(--fg-3);
  }
  .track[data-tone="attention"] .no {
    color: var(--warn);
  }
  .track[data-tone="waiting"] .no {
    color: var(--accent);
  }
  .num {
    font-family: var(--font-mono);
    font-size: var(--t-sm);
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title {
    font-weight: 700;
    color: var(--fg-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track[data-tone="done"] .title,
  .track[data-tone="faint"] .title {
    color: var(--fg-2);
  }
  .track[data-tone="faint"] .title {
    text-decoration: line-through;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    color: var(--fg-2);
  }
  .faces {
    display: inline-flex;
    flex: 0 0 auto;
    --album-bg: var(--m3-surface-container-low, var(--bg-panel));
  }
  /* 아티스트 문 — 얼굴 · 이름 · feat. 를 누르면 작업자 상세(줄 펼침과 따로) */
  .face-btn,
  .who {
    font: inherit;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .face-btn {
    display: inline-flex;
    border-radius: 50%;
  }
  .who:hover {
    text-decoration: underline;
  }
  .face-btn:focus-visible,
  .who:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
    outline-offset: 1px;
  }
  .sub-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .who {
    color: inherit;
  }
  .none {
    color: var(--fg-3);
  }
  .status {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .status-text {
    display: block;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .track[data-tone="playing"] .status-text {
    color: var(--accent);
  }
  .track[data-tone="reviewing"] .status-text {
    color: var(--tertiary, var(--fg-2));
  }
  .track[data-tone="done"] .status-text {
    color: var(--ok);
  }
  .track[data-tone="waiting"] .status-text {
    color: var(--accent);
  }
  .track[data-tone="attention"] .status-text {
    color: var(--warn);
  }
  /* 사람 관문 단추 — 알약(검증 = 강조색 · 앨범 권한 = 호박) */
  .gate {
    font: inherit;
    font-size: var(--t-xs);
    font-weight: 700;
    border: 0;
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    background: var(--accent);
    color: var(--on-accent);
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gate.warn {
    background: var(--warn);
    color: var(--bg);
  }
  .gate:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .progress {
    position: relative;
    height: 4px;
    border-radius: 999px;
    background: var(--control-track, var(--line));
    overflow: hidden;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    background: var(--fg-3);
  }
  .track[data-tone="playing"] .fill,
  .track[data-tone="waiting"] .fill {
    background: var(--accent);
  }
  .track[data-tone="reviewing"] .fill {
    background: var(--tertiary, var(--accent));
  }
  .track[data-tone="attention"] .fill {
    background: var(--warn);
  }
  .track[data-tone="done"] .fill {
    background: var(--ok);
  }
  .time {
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }
  /* 좁은 판(판 `.board` 가 크기 컨테이너 — 열 머리와 같은 문턱) — 진행 칸을 걷고 상태 칸을 줄인다 */
  @container (max-width: 640px) {
    .head {
      grid-template-columns: 28px minmax(0, 1fr) 110px 48px;
    }
    .progress {
      display: none;
    }
  }
</style>
