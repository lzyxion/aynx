<script lang="ts" module>
  /** `hint` = 오른쪽 작은 글자 */
  export type GridMenuEntry = { kind: "item"; id: string; label: string; hint?: string; disabled?: boolean } | { kind: "sep" };
</script>

<script lang="ts">
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 결과 표 상태 줄 [내보내기 ▾] 의 상자. 결과 표는 컨테이너 질의 상자 안이라 그 안의 `position: fixed` 는 그 상자가 기준이 된다 —
   * 그래서 `document.body` 로 옮겨 그린다(`portal`). `up` 이면 `y` 가 상자의 아래 끝이다.
   * 항목 핸들러는 통로 하나를 지난다(docs/conventions.md 의 "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행.
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
    /** 메뉴가 닫힌 **뒤** 불린다 — 부르는 쪽 상태를 메뉴의 파생값으로 읽지 않는 손잡이여야 한다 */
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

  /* `ImageMenu` 와 같은 층(독 위) */
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
