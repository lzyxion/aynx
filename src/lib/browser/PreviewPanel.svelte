<script lang="ts">
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { FsBackend } from "$lib/fs-backend";
  import { formatMode, formatMtime, formatSize, glyphOf, isDirLike, isSessionGone } from "$lib/sftp-browser";
  import { stripReason } from "$lib/error-reason";
  import { folderSummaryText, type FolderSummary } from "$lib/browser/file-view";
  import { imageMime, PREVIEW_DELAY_MS, PREVIEW_MAX_BYTES, type PreviewSubject } from "$lib/browser/preview";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **미리 보기 패널** — 목록 오른쪽 기둥 (docs/log/2026-10-07-file-tile-dolphin.md "10" — Dolphin 의 정보 패널).
   *
   * - 하나를 골랐으면: 그림 파일은 맞춤 크기 그림 + 해상도, 그 밖(폴더 · 링크 · 다른 파일)은 큰 글리프. 아래에 크기 ·
   *   수정한 날짜 · 권한 · 경로. 폴더는 항목 수를 알면(펼쳐 읽은 적 있으면) 적는다.
   * - 여럿이면 "N개 선택 · 총 크기", 없으면 지금 폴더 요약.
   *
   * ## 그림을 어떻게 가져오나
   *
   * 자산 프로토콜(`asset://`)의 허용 범위는 앱 설정 폴더뿐이고 **넓히지 않는다**(보안 — 아무 경로나 웹뷰가 읽게 되면
   * 안 된다). 대신 백엔드의 `readPreview`(Rust 가 원시 바이트를 돌려준다 — 로컬 · 원격 같은 길)로 받아 **Blob URL** 로
   * 그리고, 그림이 바뀌거나 패널이 사라지면 `revokeObjectURL` 한다. 선택이 빨리 바뀌면 [`PREVIEW_DELAY_MS`] 기다렸다
   * 읽고, 늦게 온 옛 응답은 번호(`seq`)로 버린다. SVG 도 **`<img>` 로만** 그린다 — 그 문맥에서는 스크립트가 돌지 않는다.
   *
   * 타일이 좁으면(컨테이너 `file-tile` 720px 아래) 숨는다 — 장소 패널(168)과 이 패널(240)을 빼고도 목록에 300px 남짓이
   * 남는 선이다.
   */
  let {
    backend,
    subject,
    /** 지금 폴더의 이름(빵부스러기 마지막 조각)과 요약 — 고른 게 없을 때 */
    folderName,
    folder,
    /** 폴더의 항목 수 — 읽은 적이 있으면(캐시) 숫자, 아니면 `null` */
    itemCountOf,
  }: {
    backend: FsBackend;
    subject: PreviewSubject;
    folderName: string;
    folder: FolderSummary;
    itemCountOf: (path: string) => number | null;
  } = $props();

  const GLYPH_ICON = { dir: "folder", dirlink: "folder-symlink", link: "file-symlink", file: "file" } as const;

  /** 지금 그려야 할 그림 파일 (아니면 `null`) */
  const imageTarget = $derived(subject.kind === "one" && subject.plan === "image" ? subject.entry : null);
  /** 그 그림의 키 — 백엔드 · 경로 · 시각 · 크기가 같으면 같은 그림이다(목록을 다시 읽어도 다시 받지 않는다) */
  const imageKey = $derived(
    imageTarget
      ? `${backend.key}\u0000${imageTarget.path}\u0000${imageTarget.mtime}\u0000${imageTarget.size}`
      : null,
  );

  let url = $state<string | null>(null);
  let dims = $state<{ w: number; h: number } | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
  /** 마지막으로 시작한 읽기의 번호 — 늦게 온 옛 답을 버린다(화면이 읽지 않으므로 `$state` 가 아니다) */
  let seq = 0;

  function dropUrl() {
    if (url) URL.revokeObjectURL(url);
    url = null;
  }

  $effect(() => {
    const key = imageKey;
    const ticket = ++seq;
    untrack(() => {
      dropUrl();
      dims = null;
      error = null;
      loading = key !== null;
    });
    if (key === null) return;
    const entry = untrack(() => imageTarget);
    const be = untrack(() => backend);
    if (!entry) return;
    const timer = setTimeout(async () => {
      try {
        const bytes = await be.readPreview(entry.path);
        if (ticket !== seq) return;
        url = URL.createObjectURL(new Blob([bytes], { type: imageMime(entry.name) ?? "" }));
      } catch (e) {
        if (ticket !== seq) return;
        const message = e instanceof Error ? e.message : String(e);
        // 세션이 사라진 것은 타일 배너가 이미 말한다 — 여기서 한 번 더 빨갛게 적지 않는다
        error = isSessionGone(message) ? null : stripReason(message);
      } finally {
        if (ticket === seq) loading = false;
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  });

  // 패널이 사라질 때 남은 Blob URL 을 거둔다
  $effect(() => () => untrack(dropUrl));

  function onImageLoad(ev: Event) {
    const img = ev.currentTarget as HTMLImageElement;
    dims = { w: img.naturalWidth, h: img.naturalHeight };
  }

  function onImageError() {
    error = t("files.preview.broken");
  }
</script>

<aside class="preview" aria-label={t("files.preview.aria")}>
  {#if subject.kind === "one"}
    {@const entry = subject.entry}
    {@const glyph = glyphOf(entry)}
    {@const count = isDirLike(entry) ? itemCountOf(entry.path) : null}
    <div class="stage">
      {#if subject.plan === "image" && url}
        <img class="pic" src={url} alt={entry.name} onload={onImageLoad} onerror={onImageError} />
      {:else}
        <span class="big" class:folder-ink={glyph === "dir" || glyph === "dirlink"} class:dim={loading}>
          <UiIcon name={GLYPH_ICON[glyph]} size={64} filled={glyph === "dir"} />
        </span>
      {/if}
    </div>
    <div class="name">{entry.name}</div>
    {#if subject.plan === "too-large"}
      <p class="note">{t("files.preview.toolarge", { limit: formatSize(PREVIEW_MAX_BYTES) })}</p>
    {/if}
    {#if error}
      <p class="note err">{error}</p>
    {/if}
    <dl class="props">
      {#if dims}
        <dt>{t("files.preview.resolution")}</dt>
        <dd>{dims.w} × {dims.h}</dd>
      {/if}
      <dt>{t("files.col.size")}</dt>
      <dd>
        {#if isDirLike(entry)}
          {count === null ? t("files.status.folder") : t("files.preview.items", { count })}
        {:else}
          {formatSize(entry.size)}
        {/if}
      </dd>
      <dt>{t("files.col.mtime")}</dt>
      <dd>{formatMtime(entry.mtime)}</dd>
      {#if entry.mode !== null}
        <dt>{t("files.col.mode")}</dt>
        <dd class="mono">{formatMode(entry.mode)}</dd>
      {/if}
      <dt>{t("files.preview.path")}</dt>
      <dd class="mono path">{entry.path}</dd>
      {#if entry.symlinkTarget}
        <dt>{t("files.preview.target")}</dt>
        <dd class="mono path">{entry.symlinkTarget}</dd>
      {/if}
    </dl>
  {:else if subject.kind === "many"}
    <div class="stage">
      <span class="big"><UiIcon name="select-all" size={56} /></span>
    </div>
    <div class="name">{t("files.browser.selected", { count: subject.count })}</div>
    {#if subject.bytes > 0}
      <p class="sub">{formatSize(subject.bytes)}</p>
    {/if}
  {:else}
    <div class="stage">
      <span class="big folder-ink"><UiIcon name="folder" size={64} filled /></span>
    </div>
    <div class="name">{folderName}</div>
    <p class="sub">{folderSummaryText(folder, t, formatSize)}</p>
  {/if}
</aside>

<style>
  .preview {
    flex: 0 0 auto;
    width: var(--preview-w);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-2);
    overflow-y: auto;
    border-left: 1px solid var(--line);
    font-size: var(--row-font);
    color: var(--fg);
  }

  /* 그림 자리 — 높이는 패널 폭만큼까지, 그림은 비율을 지켜 맞춤 */
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 96px;
    max-height: var(--preview-w);
  }

  .pic {
    display: block;
    max-width: 100%;
    max-height: var(--preview-w);
    object-fit: contain;
    border-radius: var(--radius-sm);
    /* 투명 그림이 패널 면에 묻히지 않게 옅은 바둑판 대신 칩 면 한 장 */
    background: var(--bg-chip);
  }

  .big {
    display: flex;
    color: var(--fg-3);
  }

  .big.folder-ink {
    color: var(--folder);
  }

  .big.dim {
    opacity: 0.5;
  }

  .name {
    font-weight: 600;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .sub {
    margin: 0;
    text-align: center;
    color: var(--fg-muted);
  }

  .note {
    margin: 0;
    font-size: 11px;
    text-align: center;
    color: var(--fg-muted);
  }

  .note.err {
    color: var(--err);
    overflow-wrap: anywhere;
  }

  .props {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 3px var(--space-2);
    margin: 0;
    font-size: 11px;
  }

  .props dt {
    color: var(--fg-muted);
  }

  .props dd {
    margin: 0;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .path {
    overflow-wrap: anywhere;
  }

  /* 좁은 타일 — 목록에 자리를 준다 (켜 둔 상태는 그대로라 넓히면 돌아온다) */
  @container file-tile (max-width: 719px) {
    .preview {
      display: none;
    }
  }
</style>
