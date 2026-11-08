<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import type { ImageMenuAction } from "$lib/image-menu";

  /**
   * **그림 우클릭 메뉴**(2026-10-24) — 문서 보기 타일 · 사이드 채팅의 그림(`MarkdownBlocks` 가 연다). 항목 판정은 `image-menu.ts`,
   * 하는 일은 `image-actions.ts`.
   *
   * 상자 모양은 스키마 트리 메뉴(`query/TreeMenu`)와 같은 한 벌(`.menu-*`)이다. 다른 점 하나 — 이 메뉴는 **`document.body` 로 옮겨
   * 그린다**(`portal`): 부르는 곳이 사이드 채팅 독(글래스 `backdrop-filter`) · 카드 뒤집기(`transform`) · 컨테이너 질의 상자 안이라
   * 그 안에서는 `position: fixed` 의 기준이 창이 아니라 그 상자가 된다. 독(z 100) 위에 서야 해서 z 도 독 즐겨찾기 메뉴(105 · 106)와 같다.
   *
   * 항목 핸들러는 통로 하나를 지난다(`$lib/browser/menu-runner` · docs/conventions.md 의 "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행.
   */
  let {
    actions,
    x,
    y,
    onclose,
    onpick,
  }: {
    actions: readonly ImageMenuAction[];
    x: number;
    y: number;
    onclose: () => void;
    /** 고른 항목 — 메뉴가 닫힌 **뒤** 불린다(스냅샷은 여기서 뜬다). 부르는 쪽 상태를 읽지 않는 손잡이여야 한다 */
    onpick: (action: ImageMenuAction) => void;
  } = $props();

  const LABEL: Record<ImageMenuAction, Key> = {
    download: "files.doc.md.image.menu.download",
    saveAs: "files.doc.md.image.menu.saveAs",
    copyImage: "files.doc.md.image.menu.copy",
    copyLink: "files.doc.md.image.menu.copyLink",
    copySvg: "files.doc.md.image.menu.copySvg",
  };

  let menuEl = $state<HTMLElement | null>(null);

  /** 이 노드를 `body` 끝으로 옮긴다(머리말의 까닭) — 사라질 때 함께 걷는다 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    (menuEl?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
  });

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게(`TreeMenu` 와 같은 클램프)
  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
    }
  }
</script>

<div class="portal" use:portal>
  <button
    type="button"
    class="menu-backdrop"
    tabindex="-1"
    aria-label={t("files.menu.close.aria")}
    onclick={onclose}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      onclose();
    }}
  ></button>
  <div
    class="ctx-menu menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t("files.doc.md.image.menu.aria")}
    data-image-menu
    style:left="{x}px"
    style:top="{y}px"
    bind:this={menuEl}
    onkeydown={menuKeydown}
  >
    {#each actions as a, i (a)}
      <!-- 무리 둘 — 저장(다운로드 · 다른 이름으로) ─ 복사(그림 · 링크/SVG 코드) -->
      {#if a === "copyImage" && i > 0}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-image-action={a}
        onclick={() => runOnMenu(() => ({ a, run: onpick }), onclose, (m) => m.run(m.a))}>{t(LABEL[a])}</button
      >
    {/each}
  </div>
</div>

<style>
  .portal {
    display: contents;
  }

  /* 바깥 클릭을 받아 닫는 투명 백드롭 — 독(z 100) 위(`DockFavorites` 의 메뉴와 같은 층) */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .ctx-menu {
    position: fixed;
    z-index: 106;
    min-width: 170px;
    max-width: 260px;
  }
</style>
