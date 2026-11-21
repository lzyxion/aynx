<script lang="ts">
  import Toggle from "$lib/Toggle.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { nextMenuIndex } from "$lib/browser/toolbar-tools";
  import { ZOOM_PRESETS, percentOf, presetChecked } from "$lib/image/view-math";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 이미지 타일의 배율 목록. `document.body` 로 옮겨 그린다 — 부르는 곳이 타일 머리줄 안이라 `position: fixed` 의 기준이 창이 아닐 수 있다.
   * 배율 줄은 메뉴 통로(`runOnMenu`)를 지나고, 작은 지도 스위치만 닫지 않는 켬/끔이라 통로 밖에서 값만 올린다.
   * Escape · 백드롭으로 닫으면 키보드를 타일의 몸으로 돌려주고(`onclose(true)`), 포커스가 밖으로 나가 닫힐 때는 돌려주지 않는다(옮겨 간 곳의 것이다).
   */
  let {
    x,
    y,
    fit,
    scale,
    minimap,
    onpick,
    onminimap,
    onclose,
  }: {
    x: number;
    y: number;
    fit: boolean;
    scale: number;
    minimap: boolean;
    /** 고른 배율 — `"fit"` 이면 맞춤. 닫힌 뒤 불린다 */
    onpick: (choice: "fit" | number) => void;
    onminimap: (on: boolean) => void;
    onclose: (refocus: boolean) => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);
  let backdropEl = $state<HTMLButtonElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  $effect(() => {
    const at =
      menuEl?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      menuEl?.querySelector<HTMLElement>('[role="menuitemradio"]');
    at?.focus();
  });

  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    let nx = x - r.width;
    let ny = y;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  const ROWS = '[role="menuitemradio"], input[role="switch"]';

  function menuKeydown(ev: KeyboardEvent) {
    const node = menuEl;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose(true);
      return;
    }
    // 스위치는 체크박스라 Enter 를 스스로 받지 않는다 — 단추 줄처럼 Enter 로도 켜고 끈다(Space 는 체크박스가 받는다)
    if (ev.key === "Enter" && ev.target instanceof HTMLInputElement && ev.target.matches('input[role="switch"]')) {
      ev.preventDefault();
      ev.stopPropagation();
      ev.target.click();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const rows = Array.from(node.querySelectorAll<HTMLButtonElement | HTMLInputElement>(ROWS));
    const next = nextMenuIndex(
      ev.key,
      rows.indexOf(document.activeElement as HTMLButtonElement),
      rows.map((r) => r.disabled),
    );
    if (next >= 0) rows[next]?.focus();
  }
</script>

<div class="portal" use:portal>
  <button
    type="button"
    class="menu-backdrop"
    tabindex="-1"
    bind:this={backdropEl}
    aria-label={t("files.menu.close.aria")}
    onclick={() => onclose(true)}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      onclose(true);
    }}
  ></button>
  <div
    class="zoom-menu menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t("files.image.zoom")}
    data-image-zoom-menu
    style:left="{x}px"
    style:top="{y}px"
    bind:this={menuEl}
    onkeydown={menuKeydown}
    onfocusout={(ev) => {
      const to = ev.relatedTarget;
      if (to instanceof Node && menuEl?.contains(to)) return;
      // 백드롭을 눌렀다(누르는 순간 백드롭이 포커스를 받는다) — 바깥 클릭이라 몸으로 돌려준다
      onclose(to instanceof Node && backdropEl === to);
    }}
  >
    <button
      type="button"
      class="menu-row"
      class:selected={fit}
      role="menuitemradio"
      aria-checked={fit}
      data-zoom="fit"
      onclick={() => runOnMenu(() => ({ run: onpick }), () => onclose(false), (m) => m.run("fit"))}>{t("files.image.fit")}</button
    >
    {#each ZOOM_PRESETS as z (z)}
      <button
        type="button"
        class="menu-row"
        class:selected={presetChecked(fit, scale, z)}
        role="menuitemradio"
        aria-checked={presetChecked(fit, scale, z)}
        data-zoom={z}
        onclick={() => runOnMenu(() => ({ z, run: onpick }), () => onclose(false), (m) => m.run(m.z))}
        >{percentOf(z)}%{#if z === 1}<span class="menu-kbd">1:1</span>{/if}</button
      >
    {/each}
    <div class="menu-sep" role="separator"></div>
    <!-- 앱 전체에 한 번 기억하는 켬/끔(`image/minimap-pref`) — 닫지 않는다 -->
    <label class="menu-row switch-row">
      <span class="grow">{t("files.image.minimap")}</span>
      <Toggle checked={minimap} label={t("files.image.minimap")} onchange={onminimap} data-zoom-minimap />
    </label>
  </div>
</div>

<style>
  .portal {
    display: contents;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .zoom-menu {
    position: fixed;
    z-index: 106;
    min-width: 168px;
    max-width: 240px;
  }

  .menu-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-variant-numeric: tabular-nums;
  }

  .menu-kbd {
    margin-left: auto;
    color: var(--fg-3);
  }

  .switch-row {
    height: 36px;
    cursor: pointer;
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
