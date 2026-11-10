<script lang="ts" module>
  /** 메뉴 한 줄 — 항목(누르면 닫고 실행 · `hint` = 오른쪽 작은 글자) · 구분선 */
  export type GridMenuEntry = { kind: "item"; id: string; label: string; hint?: string; disabled?: boolean } | { kind: "sep" };
</script>

<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **결과 표 상태 줄 [내보내기 ▾] 의 상자**(2026-11-10). 칸 우클릭 메뉴는 타일 메뉴(`PaneMenu` — 문서 편집기 우클릭과 같은 상자 · 줄은
   * `grid-menu.ts`)로 옮겼고, 단추 아래(위)로 펼치는 이 작은 목록만 여기 남았다. 줄은 부르는 쪽(`ResultGrid`)이 `entries` 로 넘긴다.
   *
   * 상자 모양은 스키마 트리 메뉴(`TreeMenu`)와 같은 한 벌(`.menu-*`)이다. 결과 표는 컨테이너 질의 상자(`container: qgrid`) 안이라 그 안의
   * `position: fixed` 는 창이 아니라 그 상자가 기준이 된다 — 그래서 `ImageMenu` 처럼 **`document.body` 로 옮겨 그린다**(`portal`).
   * `up` 이면 `y` 가 상자의 아래 끝이다(상태 줄 단추 위로 펼친다).
   *
   * 항목 핸들러는 통로 하나를 지난다(`$lib/browser/menu-runner` · docs/conventions.md 의 "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행.
   */
  let {
    entries,
    x,
    y,
    up = false,
    ariaLabel,
    onclose,
    onpick,
  }: {
    entries: readonly GridMenuEntry[];
    x: number;
    y: number;
    up?: boolean;
    ariaLabel: string;
    onclose: () => void;
    /** 고른 항목 — 메뉴가 닫힌 **뒤** 불린다. 부르는 쪽 상태를 메뉴의 파생값으로 읽지 않는 손잡이여야 한다 */
    onpick: (id: string) => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    (menuEl?.querySelector('[role="menuitem"]:not(:disabled)') as HTMLElement | null)?.focus();
  });

  // 단추 자리에 띄우되 화면 밖으로 넘치지 않게(`TreeMenu` 와 같은 클램프)
  $effect(() => {
    if (!menuEl) return;
    void entries.length;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = up ? y - r.height - 2 : y;
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
    aria-label={ariaLabel}
    data-query-grid-menu="export"
    style:left="{x}px"
    style:top="{y}px"
    bind:this={menuEl}
    onkeydown={menuKeydown}
  >
    {#each entries as e, i (i)}
      {#if e.kind === "sep"}
        <div class="ctx-sep menu-sep" role="separator"></div>
      {:else}
        <button
          type="button"
          class="ctx-item menu-row"
          class:has-hint={e.hint !== undefined}
          role="menuitem"
          disabled={e.disabled}
          data-query-grid-action={e.id}
          onclick={() => runOnMenu(() => ({ id: e.id, run: onpick }), onclose, (m) => m.run(m.id))}
          >{#if e.hint !== undefined}<span class="lbl">{e.label}</span><span class="menu-kbd">{e.hint}</span>{:else}{e.label}{/if}</button
        >
      {/if}
    {/each}
  </div>
</div>

<style>
  .portal {
    display: contents;
  }

  /* 바깥 클릭을 받아 닫는 투명 백드롭 — `ImageMenu` 와 같은 층(독 위) */
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
    min-width: 180px;
    max-width: 300px;
  }

  .ctx-item {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ctx-item.has-hint {
    display: flex;
    align-items: center;
  }

  .lbl {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
