<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { FolderScope, ScopeChip } from "$lib/folder-conversations";

  /** 칩은 포커스를 받지 않는다 — `Tab` 은 칩 사이를 도는 키가 아니라 각 화면이 듣는 범위 바꾸기 키다 */
  let {
    chips,
    current,
    registered,
    host = null,
    onpick,
  }: {
    chips: readonly ScopeChip[];
    current: FolderScope;
    /** 기준 폴더가 등록된 워크트리(주 폴더 포함)인가 — "이 워크트리" 냐 "이 폴더" 냐 */
    registered: boolean;
    /** 원격이면 그 별칭 */
    host?: string | null;
    onpick: (scope: FolderScope) => void;
  } = $props();

  function label(c: ScopeChip): string {
    if (c.scope === "here") {
      return t(registered ? "app.folderConvos.scope.worktree" : "app.folderConvos.scope.folder", { n: c.count });
    }
    if (c.scope === "project") return t("app.folderConvos.scope.project", { n: c.count });
    if (c.scope === "host") return t("app.folderConvos.scope.host", { host: host ?? "", n: c.count });
    return t("app.folderConvos.scope.all", { n: c.count });
  }
</script>

<div class="chips" role="radiogroup" aria-label={t("app.folderConvos.scope.aria")}>
  {#each chips as c (c.scope)}
    <button
      type="button"
      class="chip"
      class:on={c.scope === current}
      role="radio"
      aria-checked={c.scope === current}
      tabindex="-1"
      data-scope-chip={c.scope}
      onmousedown={(ev) => ev.preventDefault()}
      onclick={() => onpick(c.scope)}>{label(c)}</button
    >
  {/each}
</div>

<style>
  .chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    min-width: 0;
  }

  .chip {
    padding: 2px var(--space-3);
    font: inherit;
    font-size: var(--t-xs);
    line-height: 18px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .chip:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .chip.on {
    color: var(--fg-1);
    background: var(--accent-soft);
    border-color: transparent;
  }
</style>
