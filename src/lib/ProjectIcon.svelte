<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import type { Project } from "$lib/projects";

  let {
    project,
    size = 14,
  }: {
    project: Pick<Project, "icon" | "color"> | null | undefined;
    size?: number;
  } = $props();

  const icon = $derived(project?.icon?.trim() || null);
  const color = $derived(project?.color?.trim() || null);
</script>

<HostIcon {icon} {size} {color} fallback="folder" />
