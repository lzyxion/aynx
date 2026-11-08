import { pathKey, within } from "$lib/agent-sessions";
import { listPanes, type PaneSpec, type TabSpec } from "$lib/session";

/**
 * **새로 여는 터미널이 뜰 폴더** — 셸과 AI 타일이 함께 쓰는 규칙 하나
 * (docs/log/2026-09-27-new-terminal-cwd.md).
 *
 * 순수 층이다. 느린 부분(로컬 셸의 지금 폴더 — OSC 7 → `local_cwd`)은 여는 자리
 * (`app/panes.svelte.ts` 의 `startDirHere`)가 먼저 풀어 [`StartDirInput.focusedCwd`] 로 넘긴다.
 *
 * 1. **포커스된 타일이 아는 이 컴퓨터의 폴더** — 로컬 셸·AI 타일은 셸의 지금 폴더(`focusedCwd`), 로컬 파일 타일은
 *    보고 있는 폴더(`path`). SSH·SFTP 는 모름이다(원격 경로는 이 컴퓨터에 없는 자리다). 셸이 폴더를 알려 주지
 *    않으면(`focusedCwd` 없음) 모름이다.
 *    - **프로젝트 탭에서는** 그 폴더가 탭의 프로젝트·워크트리 폴더 **안**일 때만 쓴다(구분자·Windows 대소문자를
 *      무시 — [`pathKey`]). 셸이 밖으로 `cd` 했으면 2 로 간다.
 * 2. **프로젝트 탭이면 그 폴더** ([`tabProjectFolder`]).
 * 3. 그 밖 — 셸은 `undefined`(= 홈, 백엔드 기본), AI 타일은 설정 `[ai] start_dir`, 그것도 없으면 홈.
 *
 * 없는 폴더는 여기서 가리지 않는다 — 백엔드가 조용히 홈으로 떨어뜨린다(`pty.rs` 의 `spawn_cwd`).
 */
export interface StartDirInput {
  /** 지금 탭의 포커스된 타일 (탭이 없으면 `null`) */
  focused: Pick<PaneSpec, "kind" | "path"> | null;
  /** 포커스된 **로컬 셸**의 지금 폴더 — 여는 자리가 풀어 둔 값. 모르면 `null`/`undefined` */
  focusedCwd?: string | null;
  /** 지금 탭 (없으면 `null`) */
  tab: Pick<TabSpec, "projectFolder" | "root"> | null;
  /** 무엇을 여는가 — 3 단계의 폴백만 다르다 */
  purpose: "shell" | "ai";
  /** 설정 `[ai] start_dir` — `purpose === "ai"` 일 때만 본다 */
  aiStartDir?: string | null;
}

/** 이 탭의 프로젝트 폴더 — 적힌 값([`TabSpec.projectFolder`]), 없으면 탭에 떠 있는 프로젝트 시작 화면의 폴더 */
export function tabProjectFolder(tab: Pick<TabSpec, "projectFolder" | "root"> | null): string | null {
  if (!tab) return null;
  const recorded = tab.projectFolder?.trim();
  if (recorded) return recorded;
  // 원격 프로젝트의 시작 화면은 뺀다 — 그 폴더는 서버의 것이다(docs/log/2026-09-27-remote-conversations.md)
  const start = listPanes(tab.root).find((p) => p.kind === "start" && p.startProject && !p.startProject.host);
  return start?.startProject?.folder.trim() || null;
}

/** 포커스된 타일이 아는 **이 컴퓨터의** 폴더 (모르면 `null`) */
function focusedFolder(i: StartDirInput): string | null {
  const f = i.focused;
  if (f?.kind === "local") return i.focusedCwd?.trim() || null;
  // 파일 타일의 `path` 는 시작 자리가 아니라 **지금 보는 폴더**다
  if (f?.kind === "localfs") return f.path?.trim() || null;
  return null;
}

/** 규칙 하나 — 위 머리말의 1 → 2 → 3. `undefined` 는 홈(백엔드 기본) */
export function startDirFor(i: StartDirInput): string | undefined {
  const here = focusedFolder(i);
  const project = tabProjectFolder(i.tab);
  if (here && (!project || within(pathKey(here), pathKey(project)))) return here;
  if (project) return project;
  if (i.purpose === "ai") return i.aiStartDir?.trim() || undefined;
  return undefined;
}
