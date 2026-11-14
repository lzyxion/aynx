<script lang="ts">
  import Toggle from "$lib/Toggle.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { nextMenuIndex } from "$lib/browser/toolbar-tools";
  import { ZOOM_PRESETS, percentOf, presetChecked } from "$lib/image/view-math";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **이미지 타일의 배율 목록**(머리줄 `42% ▾` 를 눌러 연다 — 2026-11-14): 맞춤 · 50% · 100%(1:1) · 200% · 400% · 구분선 · [작은 지도] 스위치.
   * 좁은 타일에서는 머리줄의 [맞춤 | 1:1] 이 이 목록 안으로 들어온 것과 같다(맞춤 · 100% 줄).
   *
   * 상자 모양은 그림 메뉴(`ImageMenu`)와 같은 한 벌(`.menu-*`)이고 `document.body` 로 옮겨 그린다 — 부르는 곳이 타일 머리줄 안이라
   * 그 안에서는 `position: fixed` 의 기준이 창이 아닐 수 있다. 배율 줄은 메뉴 통로(`runOnMenu` — 스냅샷 → 닫기 → 실행)를 지난다.
   * 작은 지도 스위치는 **닫지 않는** 켬/끔이라(설정 스위치와 같은 몸짓) 통로 밖에서 값만 올린다. 상태는 부르는 쪽이 쥔다.
   * 맞춤 보기면 맞춤 줄만 체크한다(작은 그림의 맞춤이 곧 100% 여도 — `presetChecked`, 머리줄 [맞춤 | 1:1] 과 같은 규칙).
   *
   * 포커스가 목록 **밖으로** 나가면(다른 타일로 옮김 · 창을 떠남) 닫는다 — 앱 드롭다운(`Dropdown.svelte` 의 `onfocusout` · `relatedTarget`
   * 이 안쪽이면 그대로)과 같은 규칙. 바깥 클릭은 백드롭이 닫는다.
   *
   * 키보드는 앱의 다른 메뉴(`browser/ToolbarMenu` · `pane/PaneMenu`)와 같다: 뜨면 고른 줄(없으면 첫 줄)에 포커스 · ↑↓ 로 돌고(끝에서 반대편 ·
   * 흐린 줄은 건너뜀 — `nextMenuIndex` 하나) · Home/End · Enter/Space 는 줄(단추)이 받는다. [작은 지도] 스위치도 ↑↓ 가 닿는 한 줄이고 Space ·
   * Enter 로 켜고 끈다(닫지 않는다). Escape 는 닫고 키보드를 타일의 몸으로 돌려준다(`onclose(true)` — 부르는 쪽이 `.image` 에 포커스).
   * 백드롭을 눌러 닫을 때도 같다(그 클릭은 다른 곳에 닿지 않는다). 포커스가 다른 곳으로 나가 닫힐 때는 돌려주지 않는다(옮겨 간 곳의 것이다).
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
    /** 상자의 오른쪽 위가 설 자리(눌린 단추의 오른쪽 아래) */
    x: number;
    y: number;
    /** 지금 맞춤 보기인가 · 지금 배율 — 고른 줄 표시 */
    fit: boolean;
    scale: number;
    minimap: boolean;
    /** 고른 배율 — `"fit"` 이면 맞춤. 닫힌 뒤 불린다 */
    onpick: (choice: "fit" | number) => void;
    onminimap: (on: boolean) => void;
    /** 닫아 달라 — `true` 면 키보드를 타일의 몸으로 돌려준다(Escape · 백드롭) */
    onclose: (refocus: boolean) => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);
  let backdropEl = $state<HTMLButtonElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // 뜨면 고른 줄(없으면 첫 줄)에 — `ToolbarMenu` 와 같다
  $effect(() => {
    const at =
      menuEl?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]') ??
      menuEl?.querySelector<HTMLElement>('[role="menuitemradio"]');
    at?.focus();
  });

  // 눌린 단추 오른쪽 끝에 맞춰 아래로 — 화면 밖으로 넘치지 않게(`ImageMenu` 와 같은 클램프)
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

  /** ↑↓ 가 도는 줄 — 배율 줄들 + 작은 지도 스위치(안의 진짜 체크박스) */
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
