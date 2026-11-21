<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import { iconRef } from "$lib/host-icons";
  import { aiIconName } from "$lib/pane-icons";
  import { cliShort, type RoleCli } from "$lib/orchestration/config";

  let { cli, size = 14 }: { cli: RoleCli | null; size?: number } = $props();

  const name = $derived(cliShort(cli));
  const logo = $derived(cli ? aiIconName(cli) : null);
</script>

<span class="agent-logo" role="img" title={name} aria-label={name} data-orch-agent={cli ?? ""}>
  {#if logo}<HostIcon icon={iconRef(logo)} {size} />{:else}?{/if}
</span>

<style>
  .agent-logo {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    vertical-align: -2px;
    color: var(--fg-2);
  }
</style>
