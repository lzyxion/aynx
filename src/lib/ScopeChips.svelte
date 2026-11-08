<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { FolderScope, ScopeChip } from "$lib/folder-conversations";

  /**
   * **범위 칩** — "이 워크트리 · N" / "이 프로젝트 전체 · M" / "모든 대화 · N"
   * (docs/log/2026-09-27-folder-conversations.md). 이 폴더의 지난 대화(`FolderConversations`)와 프로젝트 시작 화면
   * (`ProjectStart`)이 **같은 칩**을 쓴다 — 두 화면의 범위가 같은 말로 읽히게. 칩을 고르는 키(`Tab`)는 각 화면이
   * 듣는다(여기는 누르기만). 칩은 포커스를 받지 않는다(`tabindex="-1"`) — `Tab` 이 칩 사이를 도는 것이 아니라 범위를
   * 바꾸는 키이기 때문이다.
   */
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
    /** 원격이면 그 별칭 — "<호스트> 전체 · N" 칩의 이름(docs/log/2026-09-27-remote-conversations.md) */
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

  /* 고른 범위 — 이 화면의 선택 판과 같은 `--accent-soft` */
  .chip.on {
    color: var(--fg-1);
    background: var(--accent-soft);
    border-color: transparent;
  }
</style>
