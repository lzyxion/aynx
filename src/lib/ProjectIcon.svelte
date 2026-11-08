<script lang="ts">
  import HostIcon from "$lib/HostIcon.svelte";
  import type { Project } from "$lib/projects";

  /**
   * **프로젝트의 얼굴** 한 칸 (docs/log/2026-09-29-folder-project-icons.md).
   *
   * 사람이 고른 아이콘(`Project.icon`)이 있으면 그것을 `HostIcon` 으로 — 호스트·폴더와 같은 규칙이다(단색 선
   * 아이콘은 `Project.color` 를 입고, 컬러 로고·이모지는 제 색). 없으면 **호스트 독 폴더와 똑같은 기본 폴더**
   * (`HostIcon` 의 `fallback="folder"` — 꽉 찬 폴더 · 테마 색 `--folder`)이고, 색을 골라 뒀으면 그 색을 입는다.
   *
   * 기본 그림은 모든 자리에서 하나다 — 프로젝트 독 · 명령 팔레트 · 시작 페이지(즐겨찾기 칩 · 프로젝트 칸) · 프로젝트
   * 시작 화면 머리. 예전에는 자리마다 달랐다(독 `project` · 팔레트 `folder-open` · 머리와 시작 페이지 칸은 없음).
   */
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
