<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";

  // 독의 아이콘 렌더러를 그대로 쓰고, 아이콘을 비우면 상태바의 이름 머리글자로 돌아간다.
  let { workspace, size = 14 }: {
    workspace: { name: string; icon?: string; color?: string } | null;
    size?: number;
  } = $props();
</script>

{#if workspace?.icon}
  <HostIcon icon={workspace.icon} color={workspace.color} {size} />
{:else}
  <span style:color={workspace?.color} aria-hidden="true">{workspace?.name.slice(0, 1)}</span>
{/if}
