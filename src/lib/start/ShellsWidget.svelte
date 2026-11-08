<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import StartRow from "$lib/start/StartRow.svelte";
  import { iconRef } from "$lib/host-icons";
  import { shellIconName } from "$lib/pane-icons";
  import { shellInfoLabel } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * **셸 위젯** — 기본 셸이 맨 위(↵ — "지금 Enter 를 치면 이것"), 나머지는 감지 순서(`shellColumn`). 목록은 `>_` 메뉴 ·
   * `Ctrl+Shift+N` 과 같은 캐시(`knownShellList`). 누르면 `>_` 메뉴의 셸 줄과 같은 함수(`addLocal` — 시작 타일을 대신한다).
   */
  let {
    items,
    handlers,
  }: {
    items: readonly Extract<LaunchItem, { kind: "shell" }>[];
    handlers: LaunchRowHandlers;
  } = $props();
</script>

{#each items as item, i (item.key)}
  <StartRow {item} index={i} {handlers}>
    <span class="ico"><HostIcon icon={iconRef(shellIconName(item.shell?.id ?? null))} size={14} /></span>
    <span class="name">{shellInfoLabel(item.shell, t)}</span>
    {#if item.isDefault}
      <span class="meta enter" title={t("app.start.shell.default")}>↵</span>
    {/if}
  </StartRow>
{/each}
