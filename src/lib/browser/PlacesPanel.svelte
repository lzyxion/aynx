<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { formatSize } from "$lib/sftp-browser";
  import type { DiskSpace } from "$lib/fs-backend";
  import type { PlaceItem, PlaceSection } from "$lib/browser/places";
  import { LOW_SPACE_RATIO, usedRatio } from "$lib/browser/file-view";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **장소 패널** — 파일 타일 왼쪽에 서는 바로 가기 기둥 (docs/log/2026-10-07-file-tile-dolphin.md — Dolphin 의 Places).
   *
   * 무리는 셋이다. 무엇을 담을지는 타일(`SftpBrowser`)이 백엔드에게 물어 정하고, 여기는 **그리기만** 한다:
   *
   * - **장소** — 로컬은 홈 · 바탕 화면 · 문서 · 다운로드(OS 가 알려 주는 자리 — Rust `local_places`), 원격은 `~` · `/`.
   * - **프로젝트** — 이 앱에 등록한 프로젝트 중 이 백엔드의 것(로컬 = 호스트 없음 · 원격 = 같은 별칭).
   * - **장치** — 로컬 드라이브. 남은 공간을 알면 짧은 막대를 단다(모르면 막대가 없다).
   *
   * 타일 폭에 따라 접힌다 — 560px 아래면 **아이콘만**, 400px 아래면 **숨김**. 판정 · 폭은 `pane/head-span` 의 `filePlacesLayout` 한 곳이고
   * (머리줄의 경로 칸이 이 패널 경계에 맞춰 서므로 — 2026-10-20) 타일이 `mini` · `width` 로 내려 준다(숨김이면 타일이 그리지 않는다).
   * 예전의 CSS 컨테이너 쿼리는 걷었다(몸과 머리줄이 따로 판정하면 접히는 순간이 어긋난다).
   * 줄은 폴더 줄처럼 **드롭 대상**이기도 하다 — 끌어다 놓으면 그 폴더로 옮긴다/복사한다.
   */
  let {
    sections,
    current,
    width,
    mini = false,
    dropTarget = null,
    disabled = false,
    onpick,
    ondragover,
    ondragleave,
    ondrop,
  }: {
    sections: readonly PlaceSection[];
    /** 지금 폴더 — 같은 경로의 줄이 눌린 채로 선다 */
    current: string;
    /** 상자 폭(px — `filePlacesLayout` 의 `boxW`) */
    width: number;
    /** 아이콘만(좁은 타일 — 이름 · 무리 제목 · 막대는 말풍선이 말한다) */
    mini?: boolean;
    dropTarget?: string | null;
    disabled?: boolean;
    onpick: (path: string) => void;
    ondragover?: (ev: DragEvent, path: string) => void;
    ondragleave?: (path: string) => void;
    ondrop?: (ev: DragEvent, path: string) => void;
  } = $props();

  const nameOf = (item: PlaceItem) => (item.labelKey ? t(item.labelKey) : (item.label ?? item.path));

  /** 말풍선 — 경로, 장치면 남은 공간 한 줄을 더한다 */
  function titleOf(item: PlaceItem): string {
    if (!item.space) return item.path;
    return `${item.path}\n${t("files.space.of", { free: formatSize(item.space.free), total: formatSize(item.space.total) })}`;
  }

  /** 막대의 채운 몫 — 쓴 만큼 (0…1) · 남은 몫이 적으면 경고 색 (상태 줄과 같은 선) */
  const usedOf = (s: DiskSpace) => usedRatio(s);
  const lowOf = (s: DiskSpace) => 1 - usedRatio(s) < LOW_SPACE_RATIO;
</script>

<nav class="places" class:mini style:width="{width}px" aria-label={t("files.places.aria")}>
  {#each sections as section (section.id)}
    {#if section.items.length > 0}
      <div class="section">
        <h4 class="head">{t(section.titleKey)}</h4>
        {#each section.items as item (item.id)}
          {@const space = item.space ?? null}
          <button
            type="button"
            class="place"
            class:on={item.path === current}
            class:drop-over={dropTarget === item.path}
            title={titleOf(item)}
            aria-label={nameOf(item)}
            aria-current={item.path === current ? "location" : undefined}
            {disabled}
            data-place={item.path}
            onclick={() => onpick(item.path)}
            ondragover={(ev) => ondragover?.(ev, item.path)}
            ondragleave={() => ondragleave?.(item.path)}
            ondrop={(ev) => ondrop?.(ev, item.path)}
          >
            <UiIcon name={item.icon} size={14} />
            <span class="nm">{nameOf(item)}</span>
            {#if space}
              <span class="cap" class:low={lowOf(space)} aria-hidden="true"
                ><i style:width="{Math.round(usedOf(space) * 100)}%"></i></span
              >
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/each}
</nav>

<style>
  .places {
    flex: 0 0 auto;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 6px 4px;
    overflow-y: auto;
    /* 목록과는 선이 아니라 **아주 옅은 면 차이**로 갈린다(2026-10-20 타일 제목줄 개편 — 머리줄 · 몸 사이 선을 걷은 것과 같은 결) */
    background: color-mix(in srgb, var(--fg) 3%, transparent);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .head {
    margin: 0;
    padding: 0 8px 2px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-muted);
  }

  .place {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 4px 8px;
    font-family: var(--font-ui);
    font-size: var(--row-font);
    color: var(--fg-2);
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .place:hover:not(:disabled) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  .place:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .place:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .place.on {
    color: var(--fg);
    background: var(--accent-soft);
  }

  .place.drop-over {
    color: var(--fg);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 남은 공간 막대 — 쓴 만큼 칠한다. 조금 남으면(`LOW_SPACE_RATIO`) 경고 색 */
  .cap {
    flex: 0 0 auto;
    width: 34px;
    height: 4px;
    overflow: hidden;
    background: var(--bg-chip);
    border-radius: 2px;
  }

  .cap i {
    display: block;
    height: 100%;
    background: var(--fg-muted);
  }

  .cap.low i {
    background: var(--warn);
  }

  /* 좁은 타일 — 아이콘만 (이름·무리 제목·막대는 말풍선이 말한다) */
  .places.mini .head,
  .places.mini .nm,
  .places.mini .cap {
    display: none;
  }
  .places.mini .place {
    justify-content: center;
    padding: 6px 0;
  }
</style>
