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
   * 자산 프로토콜(`asset://`) 범위는 넓히지 않는다 — 아무 경로나 웹뷰가 읽게 된다. 그림은 `readPreview` 바이트를 Blob URL 로 그리고 `revokeObjectURL` 로 거둔다.
   * SVG 도 `<img>` 로만 그린다 — 그 문맥에서는 스크립트가 돌지 않는다.
   */
  let {
    backend,
    subject,
    folderName,
    folder,
    itemCountOf,
  }: {
    backend: FsBackend;
    subject: PreviewSubject;
    folderName: string;
    folder: FolderSummary;
    itemCountOf: (path: string) => number | null;
  } = $props();

  const GLYPH_ICON = { dir: "folder", dirlink: "folder-symlink", link: "file-symlink", file: "file" } as const;

  const imageTarget = $derived(subject.kind === "one" && subject.plan === "image" ? subject.entry : null);
  const imageKey = $derived(
    imageTarget
      ? `${backend.key}\u0000${imageTarget.path}\u0000${imageTarget.mtime}\u0000${imageTarget.size}`
      : null,
  );

  let url = $state<string | null>(null);
  let dims = $state<{ w: number; h: number } | null>(null);
  let error = $state<string | null>(null);
  let loading = $state(false);
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
        // 세션이 사라진 것은 타일 배너가 이미 말한다
        error = isSessionGone(message) ? null : stripReason(message);
      } finally {
        if (ticket === seq) loading = false;
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  });

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

  @container file-tile (max-width: 719px) {
    .preview {
      display: none;
    }
  }
</style>
