import { pathKey, within } from "$lib/agent-sessions";
import { listPanes, type PaneSpec, type TabSpec } from "$lib/session";

/**
 * 새로 여는 터미널이 뜰 폴더 — 셸과 AI 타일이 함께 쓰는 순수 규칙. SSH · SFTP 타일의 경로는 쓰지 않는다(이 컴퓨터에 없는 자리다).
 * 프로젝트 탭에서는 포커스 타일의 폴더가 프로젝트 폴더 안일 때만 쓴다. 없는 폴더는 가리지 않는다 — 백엔드가 홈으로 떨어뜨린다(`pty.rs` 의 `spawn_cwd`).
 */
export interface StartDirInput {
  focused: Pick<PaneSpec, "kind" | "path"> | null;
  focusedCwd?: string | null;
  tab: Pick<TabSpec, "projectFolder" | "root"> | null;
  purpose: "shell" | "ai";
  aiStartDir?: string | null;
}

export function tabProjectFolder(tab: Pick<TabSpec, "projectFolder" | "root"> | null): string | null {
  if (!tab) return null;
  const recorded = tab.projectFolder?.trim();
  if (recorded) return recorded;
  // 원격 프로젝트의 시작 화면은 뺀다 — 그 폴더는 서버의 것이다(docs/log/2026-09-27-remote-conversations.md)
  const start = listPanes(tab.root).find((p) => p.kind === "start" && p.startProject && !p.startProject.host);
  return start?.startProject?.folder.trim() || null;
}

function focusedFolder(i: StartDirInput): string | null {
  const f = i.focused;
  if (f?.kind === "local") return i.focusedCwd?.trim() || null;
  // 파일 타일의 `path` 는 시작 자리가 아니라 **지금 보는 폴더**다
  if (f?.kind === "localfs") return f.path?.trim() || null;
  return null;
}

export function startDirFor(i: StartDirInput): string | undefined {
  const here = focusedFolder(i);
  const project = tabProjectFolder(i.tab);
  if (here && (!project || within(pathKey(here), pathKey(project)))) return here;
  if (project) return project;
  if (i.purpose === "ai") return i.aiStartDir?.trim() || undefined;
  return undefined;
}
