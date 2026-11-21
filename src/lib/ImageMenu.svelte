<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import type { ImageMenuAction, ImageMenuExtra } from "$lib/image-menu";

  /**
   * 그림 우클릭 메뉴. `document.body` 로 옮겨 그린다(`portal`) — 부르는 곳이 글래스(`backdrop-filter`) · `transform` · 컨테이너 질의 상자 안이라 `position: fixed` 의 기준이 창이 아니게 된다.
   * 독(z 100) 위에 서야 해서 z 는 독 즐겨찾기 메뉴(105 · 106)와 같다. 항목은 메뉴 통로(`menu-runner`)를 지난다: 스냅샷 → 닫기 → 실행.
   */
  let {
    actions,
    x,
    y,
    onclose,
    onpick,
    before = [],
    after = [],
    onextra,
  }: {
    actions: readonly ImageMenuAction[];
    x: number;
    y: number;
    onclose: () => void;
    /** 고른 항목 — 메뉴가 닫힌 **뒤** 불린다(스냅샷은 여기서 뜬다). 부르는 쪽 상태를 읽지 않는 손잡이여야 한다 */
    onpick: (action: ImageMenuAction) => void;
    /**
     * 그림 줄 앞 · 뒤에 세울 부르는 쪽의 줄 — 고른 줄은 같은 통로로 닫힌 뒤 `onextra(id)` 로 간다.
     */
    before?: readonly ImageMenuExtra[];
    after?: readonly ImageMenuExtra[];
    onextra?: (id: string) => void;
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
    {#each before as row (row.id)}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-image-extra={row.id}
        disabled={row.disabled === true}
        onclick={() => runOnMenu(() => ({ id: row.id, run: onextra }), onclose, (m) => m.run?.(m.id))}>{row.label}</button
      >
    {/each}
    {#if before.length > 0 && actions.length > 0}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
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
    {#if after.length > 0}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
    {#each after as row (row.id)}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-image-extra={row.id}
        disabled={row.disabled === true}
        onclick={() => runOnMenu(() => ({ id: row.id, run: onextra }), onclose, (m) => m.run?.(m.id))}>{row.label}</button
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
