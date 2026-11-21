<script lang="ts">
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import StartRow from "$lib/start/StartRow.svelte";
  import { isRemote } from "$lib/projects";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  let {
    items,
    handlers,
  }: {
    items: readonly Extract<LaunchItem, { kind: "project" }>[];
    handlers: LaunchRowHandlers;
  } = $props();
</script>

{#each items as item, i (item.key)}
  {@const row = item.row}
  {@const project = row.project}
  {@const where = row.kind === "worktree" ? row.path : project.path}
  <StartRow {item} index={i} title={isRemote(project) ? `${project.host}:${where}` : where} {handlers}>
    <span class="ico">
      <AgentStatusGlyph
        state={row.dot?.state ?? null}
        data-agent-dot={row.dot?.state ?? "none"}
        title={row.dot?.label}
      />
    </span>
    <span class="picon"><ProjectIcon {project} size={14} /></span>
    <span class="name">{row.kind === "worktree" ? row.title : project.name}</span>
    <span class="meta">{isRemote(project) ? project.host : t("app.projects.badge.local")}</span>
  </StartRow>
{/each}
