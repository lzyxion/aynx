<script module lang="ts">
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";

  /** [⋯] 메뉴 한 줄 — 모양 + 고르면 할 일 */
  export type AlbumMenuItem = ToolbarMenuRow & { run: () => void };
</script>

<script lang="ts">
  // ---------------------------------------------------------------------------
  // **앨범 머리**(목업 `V3AlbumClosed` 의 위 판). 커버(참여 아티스트 얼굴을 겹친 둥근 사각) · "ALBUM · 진행 중" · 큰 제목(호버 때 연필) ·
  // 한 줄 메타(📁 저장소 · 트랙 · 수락 · 통합 커밋) · 참여 아티스트(얼굴 + 이름) · 오른쪽 아래 [🛡 앨범 권한] [브랜치로 내보내기] [⋯].
  // 목업에 없는 정보(프로듀서 · 누가 열었나 · 경과/조율 한도 · 검증 명령 · 검토 남음 · 프로듀서 세대)는 [⋯] 메뉴의 [앨범 정보]를 켰을 때만 보조 줄로 보인다.
  // ← · [새 탭으로 열기] 는 판 맨 위 경로 줄(`OrchBreadcrumb`)이 쥔다 — 경로 줄이 없는 옛 앨범 잎에서만 여기 선다(`onback` · `onnewtab`).
  // 동작은 콜백(부모 `RunBoard` 의 공통 `act`) — 이 조각은 조회 · 구독이 없다.
  // ---------------------------------------------------------------------------
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";
  import {
    RUN_STATE_KEY,
    shownRunState,
    keyText,
    shortOid,
    integrationChip,
    detailStatusIcon,
    trackCountText,
    type RunDetail,
  } from "$lib/orchestration/model";
  import StatusIcon from "../StatusIcon.svelte";
  import { shortPath } from "../board/format";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import { albumFaces, albumMembers } from "./album-faces";
  import UiIcon from "$lib/UiIcon.svelte";
  import { invoke } from "$lib/ipc";
  import { albumFailureKey } from "../album-draft";
  import { createArtistLoader } from "../artist-loader.svelte.js";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";

  let {
    detail,
    producerCli,
    elapsed,
    coordLimit,
    busy,
    onexport,
    onback,
    onnewtab,
    onpermissions,
    permissionsOpen = false,
    ended = false,
    onlog,
    menuItems,
  }: {
    detail: RunDetail;
    /** 이 탭의 프로듀서 타일이 돌리는 CLI(`claude` · `codex`) — 없으면 `null`(프로듀서 없음) */
    producerCli: string | null;
    elapsed: string;
    coordLimit: string;
    busy: boolean;
    onexport: () => void;
    /** 경로 줄이 없을 때만(옛 앨범 잎) — 라이브러리로 */
    onback?: () => void;
    /** 경로 줄이 없을 때만 — 같은 앨범을 새 탭에 */
    onnewtab?: () => void;
    onpermissions: () => void;
    permissionsOpen?: boolean;
    /** 끝난 앨범(서버 이어받기 판정 `ended`) — 단추 줄에 [프로듀서 대화 기록]이 선다(목업 V3AlbumDone) */
    ended?: boolean;
    /** [프로듀서 대화 기록] — 그 대화를 이 기기에서 알 때만(없으면 단추가 없다) */
    onlog?: () => void;
    /** [⋯] 메뉴의 줄들 — 앨범 상태에 맞는 사람 동작을 판(`RunBoard`)이 짓는다 */
    menuItems: readonly AlbumMenuItem[];
  } = $props();

  // [⋯] 메뉴. 실행은 `runOnMenu`(스냅샷 → 닫기 → 실행).
  let moreBtn = $state<HTMLButtonElement | null>(null);
  let menuOpen = $state(false);
  function pick(key: string): void {
    runOnMenu(() => menuItems.find((m) => m.key === key)?.run, () => (menuOpen = false), (fn) => fn());
  }
  function closeMenu(back: boolean): void {
    menuOpen = false;
    if (back) moreBtn?.focus();
  }

  const profiles = createArtistLoader();
  $effect(() => profiles.subscribe());
  const artists = $derived(albumMembers(detail, profiles.list));
  let renaming = $state(false);
  let name = $state("");
  let savingName = $state(false);
  let renameError = $state<string | null>(null);
  async function rename() {
    if (savingName || !name.trim() || [...name.trim()].length > 80) return;
    savingName = true; renameError = null;
    try { await invoke("orchestration_rename_album", { runId: detail.runId, name: name.trim() }); renaming = false; }
    catch (e) { renameError = t(albumFailureKey(e)); }
    finally { savingName = false; }
  }
  const integ = $derived(integrationChip(detail));
  const accepted = $derived(detail.tasks.filter((x) => x.state === "accepted").length);
  /** 앨범 상태 낱말 앞의 그림(10-30) */
  const stateIcon = $derived(detailStatusIcon(detail));
  /** 커버 얼굴 — 참여 아티스트(없으면 프로듀서) 둘까지(목업: 왼쪽 위 큰 얼굴 · 오른쪽 아래 작은 얼굴) */
  const faces = $derived(albumFaces(artists, producerCli));
</script>

<header class="album-head" data-album-head data-run-state-word={detail.state}>
  <div class="cover" data-faces={faces.length} aria-hidden="true">
    {#each faces as a, i (a.id)}
      <span class="face" data-i={i}><ArtistAvatar cli={a.cli} profile={a.profile} size={faces.length === 1 ? 72 : i === 0 ? 62 : 50} ring /></span>
    {:else}
      <span class="cover-empty"></span>
    {/each}
  </div>

  <!-- 제목 칸은 단추 줄 위까지 판 폭을 다 쓴다(실기 10-31 — 단추 줄 옆에 끼어 넓은 판에서도 "README 와 slu…" 로 잘렸다) -->
  <div class="title-block">
    <div class="kicker">
      {#if onback}
        <button type="button" class="back" title={t("orch.board.back.title")} aria-label={t("orch.board.back.title")} data-album-back onclick={onback}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>
        </button>
      {/if}
      <span class="state-word" data-run-state data-run-state-icon={stateIcon}
        ><!-- 쉼(idle)의 그림은 회색 점이라 "ALBUM" 앞에 외톨이 점으로 보인다 — 쉬면 그림 없이 낱말만(목업) -->{#if stateIcon !== "idle"}<StatusIcon icon={stateIcon} />{/if}{t("orch.album.kicker", { state: keyText(RUN_STATE_KEY, shownRunState(detail.state, detail.previousState), t) })}</span
      >
    </div>
    {#if renaming}
      <form class="rename" onsubmit={(e) => { e.preventDefault(); void rename(); }}>
        <input class="field" aria-label={t("orch.new.rename")} data-album-name-input bind:value={name} maxlength="80" disabled={savingName} />
        <button class="btn btn-secondary" type="submit" data-album-name-save disabled={savingName || !name.trim()}>{t("orch.new.renameSave")}</button>
        <button class="btn btn-ghost" type="button" disabled={savingName} onclick={() => (renaming = false)}>{t("orch.new.renameCancel")}</button>
      </form>
    {:else}<h2 class="name" title={detail.name}><button class="rename-title" type="button" data-album-rename aria-label={`${t("orch.new.rename")}: ${detail.name}`} title={t("orch.new.rename")} disabled={busy} onclick={() => { name = detail.name; renaming = true; }}><span class="title-text">{detail.name}</span><span class="rename-icon"><UiIcon name="edit" size={16} /></span></button></h2>{/if}
    {#if renameError}<p role="alert">{renameError}</p>{/if}
  </div>

  <div class="info">
    <!-- 항목마다 앞 구분점을 함께 묶는다 — 줄이 바뀌어도 점이 앞 줄 끝에 외톨이로 남지 않는다(실기 10-31 "수락 0 •") -->
    <div class="meta">
      <span class="repo" title={detail.repo}><UiIcon name="folder" size={13} />{shortPath(detail.repo)}</span>
      <span class="item"><span class="dot" aria-hidden="true">•</span><span data-album-tracks={detail.tasks.length}>{trackCountText(detail.tasks.length, t)}</span></span>
      <span class="item"><span class="dot" aria-hidden="true">•</span><span data-album-accepted={accepted}>{t("orch.album.accepted", { n: accepted })}</span></span>
      {#if integ && detail.integration}
        {@const ip = t("orch.album.integration", { oid: "\u0000", n: integ.integrated }).split("\u0000")}
        <span class="item"><span class="dot" aria-hidden="true">•</span><span data-integration-head={detail.integration.expectedHead}
          title={`${t("orch.album.integration.count", { n: integ.integrated })} · ${t("orch.integration.chip.title", {
            ref: detail.integration.workRef,
            base: `${detail.integration.baseBranch ?? t("orch.start.base.detached")} · ${shortOid(detail.integration.baseCommit)}`,
          })}`}>{ip[0]}<span class="mono">{shortOid(integ.head)}</span>{ip[1] ?? ""}</span></span>
      {/if}
      {#if ended && elapsed}
        <span class="item"><span class="dot" aria-hidden="true">•</span><span data-album-elapsed>{elapsed}</span></span>
      {/if}
    </div>
    {#if artists.length > 0}
      <div class="artists" data-album-artists aria-label={t("orch.album.artists")}>
        {#each artists as a, i (a.id)}
          {#if i > 0}<span class="dot" aria-hidden="true">·</span>{/if}
          <span class="artist" class:judge={a.judge}><ArtistAvatar cli={a.cli} profile={a.profile} size={20} />{a.name}</span>
        {/each}
      </div>
    {/if}
    <!-- 목업에 없는 보조 정보 — [⋯] 메뉴의 [앨범 정보]를 켰을 때만(프로듀서 · 누가 열었나 · 경과 · 검증 명령 · 검토 남음 · 세대) -->
    <!-- 지금 세대가 묶여 있으면 옛 세대 표지는 내지 않는다(실기 b — 다시 붙여 이어받은 뒤에도 "조율 권한 없음" 으로 읽혔다) · 사람이 알아야 할 표지라 접지 않는다 -->
    {#if detail.gen > 1 && !detail.coordinatorAttached}
      <span class="chip faint old" title={t("orch.gen.old.title")} data-run-old-coordinator>{t("orch.gen.old")}</span>
    {/if}
  </div>

  <div class="actions">
    {#if detail.album && (detail.state === "running" || detail.state === "paused")}<button type="button" class="pill" class:on={permissionsOpen} data-album-permissions-open aria-expanded={permissionsOpen} onclick={onpermissions}
        ><UiIcon name="shield-check" size={13} />{t("orch.perm.title")}</button
      >{/if}
    <!-- 이미 지금 통합 머리를 내보냈으면 단추 대신 아래 "내보냄" 칩만(같은 머리를 다시 내보낼 일이 없다 — 뒤처졌으면 다시 선다 · 실기 10-31) -->
    <!-- orphaned(서버 재시작 뒤 읽기 전용)도 내보내기 하나는 된다(11-09 — 영구 삭제 전에 결과를 살리는 길) -->
    {#if detail.integration && integ?.exported !== "current"}
      <button type="button" class="pill" data-run-action="export" disabled={busy}
        title={t("orch.integration.export.title", { branch: detail.integration.exportBranch })} onclick={onexport}>{t("orch.integration.export")}</button>
    {/if}
    {#if onnewtab}
      <button type="button" class="pill" data-album-new-tab disabled={isRemote} title={isRemote ? t("orch.nav.remote") : undefined} onclick={onnewtab}>{t("orch.nav.newTab")}</button>
    {/if}
    {#if ended && onlog}
      <button type="button" class="pill" data-album-log onclick={onlog}><UiIcon name="orchestra" size={14} />{t("orch.album.log.open")}</button>
    {/if}
    <button type="button" class="round" data-album-more data-album-menu aria-label={t("orch.album.more")} title={t("orch.album.more")} aria-haspopup="menu"
      aria-expanded={menuOpen} bind:this={moreBtn} onclick={() => (menuOpen = !menuOpen)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="19" cy="12" r="2"></circle></svg>
    </button>
  </div>
</header>

{#if menuOpen && moreBtn}
  <ToolbarMenu label={t("orch.album.more")} rows={menuItems} trigger={moreBtn} align="right" onpick={pick} onclose={closeMenu} />
{/if}

<style>
  .rename { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .rename .btn { height: var(--field-height); }
  .field { box-sizing: border-box; height: var(--field-height); background: var(--field-bg); color: var(--fg-1); border: 1px solid transparent; border-radius: var(--field-radius); box-shadow: var(--glass-ctl-edge, none); outline: none; font: inherit; padding: 0 var(--space-3); min-width: 0; }
  .field:hover:not(:disabled, :focus) { background: var(--control-bg-hover); }
  .field:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .rename-title { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; font: inherit; color: inherit; background: transparent; border: 0; border-radius: var(--radius-md); padding: 0; cursor: text; text-align: left; overflow-wrap: anywhere; }
  /* 넘칠 때만 두 줄까지 감고 말줄임(실기 10-31) — 단추(inline-flex) 안이라 줄 제한은 글자 칸이 직접 쥔다 */
  .title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  /* 연필은 호버 · 포커스 때만(목업에는 없다 — 기능은 남긴다) */
  .rename-icon { display: inline-flex; flex: 0 0 auto; color: var(--fg-3); opacity: 0; transition: opacity 120ms; }
  .rename-title:hover .rename-icon, .rename-title:focus-visible .rename-icon { opacity: 1; }
  .rename-title:focus-visible { outline: 2px solid var(--focus-ring, var(--accent)); outline-offset: 2px; }
  /* 판과 같은 바탕 — 머리에 따로 띠를 칠하지 않는다(목업) */
  /* 격자: 표지(두 줄 높이) · 제목 칸(오른쪽 끝까지) / 메타 칸 · 단추 줄(오른쪽 아래) */
  .album-head {
    --album-bg: var(--m3-primary-container, var(--accent-soft));
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr) auto;
    grid-template-areas: "cover title title" "cover info actions";
    align-items: end;
    gap: 8px 22px;
    padding: 16px 28px 18px;
  }
  /* 커버 — 둥근 사각 판 위에 얼굴 둘(왼쪽 위 큰 것 · 오른쪽 아래 작은 것) */
  .cover {
    grid-area: cover;
    align-self: end;
    position: relative;
    flex: 0 0 auto;
    width: 120px;
    height: 120px;
    border-radius: var(--radius-lg, 16px);
    background: var(--m3-primary-container, var(--accent-soft));
    overflow: hidden;
  }
  .face {
    position: absolute;
    display: inline-flex;
  }
  .cover[data-faces="1"] .face { left: 22px; top: 22px; }
  .cover[data-faces="2"] .face[data-i="0"] { left: 10px; top: 10px; }
  .cover[data-faces="2"] .face[data-i="1"] { right: 10px; bottom: 10px; }
  .cover-empty {
    position: absolute;
    inset: 36%;
    border-radius: 50%;
    background: var(--m3-on-primary-container, var(--accent));
    opacity: 0.4;
  }
  .title-block {
    grid-area: title;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .info {
    grid-area: info;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .kicker {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    font-weight: 700;
    letter-spacing: 1px;
    color: var(--accent);
  }
  .state-word {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .back {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 50%;
    padding: 0;
    background: var(--control-bg, var(--surface-hover));
    color: var(--fg-1);
    cursor: pointer;
  }
  .back:hover {
    background: var(--control-bg-hover, var(--surface-hover));
  }
  .back:focus-visible,
  .round:focus-visible,
  .pill:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
    outline-offset: 2px;
  }
  .name {
    margin: 0;
    font-size: 30px;
    font-weight: 900;
    line-height: 1.15;
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    color: var(--fg-2);
    font-size: var(--t-sm);
  }
  .repo {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .dot {
    color: var(--fg-3);
  }
  .meta > .item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }
  .artists {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .artist {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  /* 검토형 — 얼굴 둘레 보조 강조색 고리(목업의 분홍 고리) */
  .artist.judge > :global(.avatar) {
    box-shadow: 0 0 0 2px var(--tertiary, var(--accent));
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-2);
    font-size: var(--t-xs);
    line-height: 20px;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: 999px;
    white-space: nowrap;
  }
  .chip.faint {
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line);
  }
  .chip.old {
    align-self: flex-start;
  }
  .actions {
    grid-area: actions;
    align-self: end;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--control-bg, var(--surface-hover));
    border: 0;
    border-radius: 999px;
    padding: 8px 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  .pill:hover:not(:disabled) {
    background: var(--control-bg-hover, var(--surface-hover));
  }
  /* 앨범 권한 패널이 열려 있으면 그 알약을 채운다(목업 V3Album) */
  .pill.on,
  .pill.on:hover:not(:disabled) {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  .pill:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .round {
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    border-radius: 50%;
    border: 0;
    background: var(--control-bg, var(--surface-hover));
    color: var(--fg-1);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .round:hover {
    background: var(--control-bg-hover, var(--surface-hover));
  }
  .round[aria-expanded="true"] {
    background: var(--control-sel-bg, var(--accent-soft));
    color: var(--control-sel-fg, var(--fg-1));
  }
  /* 메타 · 참여 줄은 항목 사이에서만 줄을 바꾼다 — 좁을 때 한 낱말(한 글자)씩 세로로 감기지 않게(실기 b 24-real-620) */
  .meta > span,
  .meta > .item > span,
  .kicker > span {
    white-space: nowrap;
  }
  /* 앨범 권한 패널이 열린 폭(목업 V3Album — 앨범 칸 ≈ 560px) — 104px 표지 · 26px 한 줄 제목 · 단추는 오른쪽 */
  @container album-content (max-width: 760px) {
    .album-head {
      grid-template-columns: 104px minmax(0, 1fr) auto;
      gap: 6px 18px;
      padding: 16px 24px;
    }
    .cover {
      width: 104px;
      height: 104px;
    }
    .cover[data-faces="1"] .face { left: 16px; top: 16px; }
    .cover[data-faces="2"] .face[data-i="0"] :global(.avatar) { width: 54px !important; height: 54px !important; }
    .cover[data-faces="2"] .face[data-i="1"] :global(.avatar) { width: 44px !important; height: 44px !important; }
    /* 좁은 판은 한 줄 + 줄임표(목업 V3Album · ⑬ D) — 두 줄 감기는 넓은 판에서만 */
    .name {
      font-size: 26px;
      display: block;
      white-space: nowrap;
    }
    .title-text { display: block; }
    .info, .title-block { gap: 6px; }
    .actions {
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }
  /* 단추가 제목 칸을 누르면 단추 줄을 아래로(오른쪽 정렬) — 표지는 그대로 */
  @container album-content (max-width: 600px) {
    .album-head {
      grid-template-columns: 104px minmax(0, 1fr);
      grid-template-areas: "cover title" "cover info" "actions actions";
    }
    .artists { display: none; }
    .actions {
      justify-content: flex-end;
      min-width: 0;
    }
  }
  /* 좁은 판 — 작은 표지 · 메타 한 줄 줄임표 */
  @container album-content (max-width: 480px) {
    .album-head {
      grid-template-columns: 64px minmax(0, 1fr);
      align-items: center;
      padding: 14px 16px 12px;
      gap: 10px 14px;
    }
    .cover {
      width: 64px;
      height: 64px;
    }
    .cover[data-faces="1"] .face { left: 10px; top: 10px; }
    .cover[data-faces="1"] .face :global(.avatar) { width: 40px !important; height: 40px !important; }
    .cover[data-faces="2"] .face[data-i="0"] { left: 5px; top: 5px; }
    .cover[data-faces="2"] .face[data-i="1"] { right: 5px; bottom: 5px; }
    .cover[data-faces="2"] .face[data-i="0"] :global(.avatar) { width: 32px !important; height: 32px !important; }
    .cover[data-faces="2"] .face[data-i="1"] :global(.avatar) { width: 26px !important; height: 26px !important; }
    .name {
      font-size: 22px;
    }
    .meta {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta > span { margin-right: 6px; }
    .repo { display: inline; }
    .repo > :global(.ui-icon) { display: inline-block; vertical-align: -2px; margin-right: 4px; }
  }
  /* 아주 좁은 판(앨범 판 ≈ 400px 아래 — 620px 창의 오른쪽 잎) — 커버를 숨긴다 · 제목은 한 줄 줄임표 */
  @container album-content (max-width: 400px) {
    .album-head {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "title" "info" "actions";
      align-items: stretch;
      gap: 10px;
      padding: 12px 14px;
    }
    .cover {
      display: none;
    }
    .name {
      font-size: 20px;
    }
  }
</style>
