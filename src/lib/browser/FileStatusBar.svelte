<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { formatMtime, formatSize, isDirLike } from "$lib/sftp-browser";
  import type { DiskSpace } from "$lib/fs-backend";
  import { FILE_ZOOM_MAX } from "$lib/session";
  import {
    folderSummaryText,
    LOW_SPACE_RATIO,
    usedRatio,
    type FolderSummary,
    type SelectionSummary,
  } from "$lib/browser/file-view";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **파일 타일의 상태 줄** — 타일 맨 아래 한 줄 (docs/log/2026-10-07-file-tile-dolphin.md — Dolphin 의 상태 표시줄).
   *
   *     폴더 3개, 파일 12개 (4.1 MB) · 숨김 2개          128 GB 남음 / 476 GB ▬▬▬    🔍 ━━○━━
   *
   * - 왼쪽 글: 아무것도 안 골랐으면 **지금 폴더** 요약(뿌리 한 층 — 펼친 하위는 세지 않는다), 골랐으면 **선택** 요약
   *   (하나면 이름 · 크기 · 날짜, 여럿이면 "N개 선택 · 크기"). 예전에 빵부스러기 줄 끝에 서던 "N개 선택" 배지가 여기로 왔다.
   * - **남은 공간** — 백엔드가 알려 줄 때만(`FsBackend.freeSpace` — 로컬은 지금 Windows 만, 원격은 서버가
   *   `statvfs@openssh.com` 을 알릴 때만). 모르면 칸째 없다.
   * - **아이콘 크기** 슬라이더 — 아이콘 보기에서만 움직인다(`Ctrl+휠` 과 같은 단계).
   *
   * 좁은 타일(520px 아래)에서는 막대와 슬라이더를 접고 글만 남긴다.
   */
  let {
    folder,
    selection,
    space = null,
    /** 아이콘 보기인가 — 슬라이더가 이때만 산다 */
    iconsView = false,
    zoom,
    onzoom,
  }: {
    folder: FolderSummary;
    selection: SelectionSummary;
    space?: DiskSpace | null;
    iconsView?: boolean;
    zoom: number;
    onzoom: (level: number) => void;
  } = $props();

  /** 지금 폴더 요약 한 줄 — 폴더 · 파일(크기) · 숨김. 비었으면 "비어 있음" (미리 보기 패널과 같은 글) */
  const folderText = $derived(folderSummaryText(folder, t, formatSize));

  const used = $derived(space ? usedRatio(space) : 0);
  const low = $derived(space !== null && space.free / Math.max(1, space.total) < LOW_SPACE_RATIO);
</script>

<div class="status" role="status">
  <span class="txt">
    {#if selection.single}
      {@const one = selection.single}
      <b>{one.name}</b> · {isDirLike(one) ? t("files.status.folder") : formatSize(one.size)} · {formatMtime(one.mtime)}
    {:else if selection.count > 1}
      <b>{t("files.browser.selected", { count: selection.count })}</b>{selection.bytes > 0
        ? ` · ${formatSize(selection.bytes)}`
        : ""}
    {:else}
      {folderText}
    {/if}
  </span>
  {#if space}
    <span
      class="free"
      class:low
      title={t("files.space.of", { free: formatSize(space.free), total: formatSize(space.total) })}
    >
      <span class="free-txt">{t("files.space.of", { free: formatSize(space.free), total: formatSize(space.total) })}</span>
      <span class="free-bar" aria-hidden="true"><i style:width="{Math.round(used * 100)}%"></i></span>
    </span>
  {/if}
  <label class="zoom" class:off={!iconsView} title={t("files.status.zoom")}>
    <UiIcon name="grid" size={12} />
    <input
      type="range"
      min="0"
      max={FILE_ZOOM_MAX}
      step="1"
      value={zoom}
      disabled={!iconsView}
      aria-label={t("files.status.zoom")}
      oninput={(ev) => onzoom(Number((ev.currentTarget as HTMLInputElement).value))}
    />
  </label>
</div>

<style>
  .status {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    height: var(--file-status-h);
    box-sizing: border-box;
    padding: 0 8px 0 10px;
    font-size: 11px;
    color: var(--fg-muted);
    font-variant-numeric: tabular-nums;
    border-top: 1px solid var(--line);
  }

  .txt {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .txt b {
    color: var(--fg);
    font-weight: 600;
  }

  .free {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .free-bar {
    width: 70px;
    height: 5px;
    overflow: hidden;
    background: var(--bg-chip);
    border-radius: 3px;
  }

  .free-bar i {
    display: block;
    height: 100%;
    background: var(--fg-muted);
  }

  .free.low {
    color: var(--warn);
  }

  .free.low .free-bar i {
    background: var(--warn);
  }

  .zoom {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .zoom.off {
    opacity: 0.4;
  }

  .zoom input {
    width: 74px;
    margin: 0;
    accent-color: var(--accent);
  }

  /* 좁은 타일 — 막대·슬라이더를 접고 글만 (남은 공간 글은 말풍선으로도 읽힌다) */
  @container file-tile (max-width: 519px) {
    .free-bar,
    .zoom {
      display: none;
    }
  }

  @container file-tile (max-width: 399px) {
    .free {
      display: none;
    }
  }
</style>
