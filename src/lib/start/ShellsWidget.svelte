<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import StartRow from "$lib/start/StartRow.svelte";
  import { iconRef } from "$lib/host-icons";
  import { shellIconName } from "$lib/pane-icons";
  import { shellInfoLabel } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

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
