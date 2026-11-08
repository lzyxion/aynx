<script lang="ts">
  import ProjectIcon from "$lib/ProjectIcon.svelte";
  import AgentStatusGlyph from "$lib/AgentStatusGlyph.svelte";
  import StartRow from "$lib/start/StartRow.svelte";
  import { isRemote } from "$lib/projects";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LaunchItem, LaunchRowHandlers } from "$lib/start/launch-item";

  /**
   * **프로젝트 위젯** (docs/log/2026-09-27-launcher-worktrees.md) — 프로젝트 줄과 최근 연 워크트리 줄을 시각 순으로 섞고, 에이전트
   * 점이 붙은 줄이 먼저(권한 대기 → 완료 → 실행 중). 줄은 `StartPage` 가 `launcherProjectRows` 로 위젯 높이만큼 세운다. 누르면
   * 독의 프로젝트 열기(`openProject` · 워크트리는 `openProjectWorktree`), `Ctrl+Enter` 는 이 탭에(`StartPage` 의 키).
   */
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
    <!-- 독과 같은 판정 · 같은 글리프(12px — `.ico` 14px 칸 안). 프로젝트 줄은 주 폴더 자리, 워크트리 줄은 그 워크트리. 없으면 같은 크기의 빈 자리 -->
    <span class="ico">
      <AgentStatusGlyph
        state={row.dot?.state ?? null}
        data-agent-dot={row.dot?.state ?? "none"}
        title={row.dot?.label}
      />
    </span>
    <!-- 프로젝트의 얼굴 — 고른 아이콘, 없으면 호스트 독 폴더와 같은 기본 폴더(워크트리 줄은 제 프로젝트의 것) -->
    <span class="picon"><ProjectIcon {project} size={14} /></span>
    <span class="name">{row.kind === "worktree" ? row.title : project.name}</span>
    <span class="meta">{isRemote(project) ? project.host : t("app.projects.badge.local")}</span>
  </StartRow>
{/each}
