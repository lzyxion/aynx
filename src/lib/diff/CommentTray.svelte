<script lang="ts">
  /**
   * **코멘트 트레이**(2단계 — 칩 · 받을 곳 · 넘기기/복사) — `DiffView.svelte` 에서 뗀 표시 조각. 코멘트 목록 · 받을 곳 · 넘기기
   * (`handOver` — 붙여 넣기만, Enter 는 사람)는 부모가 쥔다. 받을 곳 고르개가 열렸는가(`targetMenu`)만 `bind:` — 바깥 클릭 · Esc 는
   * 부모가 닫는다. 메뉴 줄은 `runOnMenu`(스냅샷 → 닫기 → 실행) 통로 그대로.
   */
  import Keys from "$lib/Keys.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import { displayCombo } from "$lib/keybindings";
  import { fileName, type DiffComment } from "$lib/diff-comments";
  import type { DiffTargetList } from "$lib/app/diff-view.svelte.js";

  type Tile = DiffTargetList["tiles"][number];

  let {
    comments,
    composer,
    targets,
    target,
    unsent,
    askCombo,
    targetMenu = $bindable(),
    jumpTo,
    clearSent,
    closeTargetMenu,
    pickTarget,
    handOver,
  }: {
    comments: DiffComment[];
    composer: { path: string; label: string } | null;
    targets: DiffTargetList | null;
    target: Tile | null;
    unsent: DiffComment[];
    askCombo: string | null;
    targetMenu: boolean;
    jumpTo: (c: DiffComment) => void;
    clearSent: () => void;
    closeTargetMenu: () => void;
    pickTarget: (tile: { paneId: string }) => void;
    handOver: () => Promise<void>;
  } = $props();
</script>

<div class="tray" data-diff-tray>
  <span class="tcount">{t("app.diff.tray.count", { n: comments.length })}</span>
  <div class="tchips">
    {#each comments as c (c.id)}
      <button
        type="button"
        class="tchip"
        class:sent={c.sent}
        data-diff-chip={c.id}
        onclick={() => jumpTo(c)}>{fileName(c.path)} {c.label}</button
      >
    {/each}
    {#if composer}
      <span class="tchip writing" data-diff-chip-writing
        >{fileName(composer.path)} {composer.label} {t("app.diff.tray.writing")}</span
      >
    {/if}
  </div>
  <span class="thint">{t("app.diff.tray.hint")}</span>
  <span class="sp"></span>
  {#if comments.some((c) => c.sent)}
    <button type="button" class="tbtn" title={t("app.diff.tray.clearTitle")} data-diff-clear onclick={clearSent}
      >{t("app.diff.tray.clear")}</button
    >
  {/if}
  {#if targets && target}
    <div class="tpick">
      <button
        type="button"
        class="tbtn"
        aria-expanded={targetMenu}
        aria-label={t("app.diff.tray.targetAria")}
        data-diff-target={target.paneId}
        onclick={() => (targetMenu = !targetMenu)}
        >{t("app.diff.tray.target", { name: `${target.name} · ${targets.sub.get(target.paneId) ?? ""}` })} ▾</button
      >
      {#if targetMenu}
        <div class="menu-surface pop up" role="menu" aria-label={t("app.diff.tray.targetAria")} data-diff-target-menu>
          {#each targets.tiles as tile (tile.paneId)}
            <button
              type="button"
              class="menu-row trow"
              class:selected={tile.paneId === target.paneId}
              role="menuitem"
              data-diff-target-item={tile.paneId}
              onclick={() => runOnMenu(() => tile, closeTargetMenu, pickTarget)}
            >
              <span>{tile.name}</span>
              <span class="tsub">{targets.sub.get(tile.paneId) ?? ""}</span>
              {#if targets.same.has(tile.paneId)}<span class="menu-kbd">{t("app.diff.tray.same")}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button
      type="button"
      class="tbtn primary"
      disabled={unsent.length === 0}
      title={unsent.length === 0 ? t("app.diff.tray.sendNone") : undefined}
      data-diff-send
      onclick={() => void handOver()}
      >{t("app.diff.tray.send")}{#if askCombo}<Keys combo={displayCombo(askCombo)} size="sm" />{/if}</button
    >
  {:else}
    <button
      type="button"
      class="tbtn primary"
      disabled={unsent.length === 0}
      title={t("app.diff.tray.copyTitle")}
      data-diff-copy
      onclick={() => void handOver()}>{t("app.diff.tray.copy")}</button
    >
  {/if}
</div>

<style>
  .sp {
    flex: 1 1 auto;
  }

  /* 고르개 — 범위 단추 아래 · 좁은 모드 파일 단추 아래 */
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    max-height: 320px;
    overflow: auto;
    min-width: 280px;
    max-width: min(520px, 90cqw);
  }

  /* 아래 트레이 — 코멘트 칩 · 받을 곳 · 넘기기 */
  .tray {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    flex: 0 0 auto;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--surface-raised);
    font-size: 12px;
  }

  .tcount {
    font-weight: 600;
    white-space: nowrap;
  }

  .tchips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
  }

  .tchip {
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-field);
    color: var(--fg-2);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }

  .tchip.sent {
    opacity: 0.55;
  }

  .tchip.writing {
    border-style: dashed;
    cursor: default;
  }

  .thint {
    font-size: 11px;
    color: var(--fg-3);
  }

  .tpick {
    position: relative;
  }

  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-field);
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .tbtn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .tbtn.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }

  .tbtn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  /* 강조색 단추 위의 단축키 칩 — 불투명 판 대신 단추 글자색을 옅게 섞은 판 · 선 */
  .tbtn.primary {
    --keycap-fg: var(--on-accent);
    --keycap-bg: color-mix(in srgb, var(--on-accent) 14%, transparent);
    --keycap-line: color-mix(in srgb, var(--on-accent) 32%, transparent);
  }

  .tbtn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .tbtn:focus-visible,
  .tchip:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }

  /* 받을 곳 고르개 — 트레이 위로 연다 */
  .pop.up {
    top: auto;
    bottom: calc(100% + 4px);
    right: 0;
    left: auto;
  }

  .trow {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tsub {
    color: var(--fg-3);
    font-size: 12px;
  }
</style>
