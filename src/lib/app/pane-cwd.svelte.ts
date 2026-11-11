import type { PaneSpec } from "$lib/session";
import { wslCwdToWindows } from "$lib/shell-integration";
import type { PathLinkPlace } from "$lib/path-links";

/**
 * **셸이 알려 준 폴더의 반응형 사본** — 타일 id → 그 셸이 마지막으로 알려 준 폴더(OSC 7 · OSC 9;9)
 * (docs/log/2026-09-27-folder-conversations.md).
 *
 * 원본은 `shell-integration.ts` 의 터미널별 변수이고 반응형이 아니다(프롬프트마다 오므로 거기서 렌더를 부르지
 * 않는다 — 그 파일의 OSC 7 주석). 고르는 목록의 기준 폴더는 셸이 `cd` 한 곳이어야
 * 하고(떠 있는 동안에도 따라간다) 그 값은 타일 id 로 찾아야 하므로, 값이 **바뀔 때만** 여기로 올린다(`BlockSink.oncwd`) — `cd` 는 드물어 렌더 비용이 없다.
 *
 * 화면 전용 값이다: 저장하지 않고 이관 짐에도 싣지 않는다(받는 창의 셸이 다음 프롬프트에 다시 알려 준다).
 * 타일이 사라지면(`Terminal` 의 언마운트) 지운다.
 */

const cwds = $state<Record<string, string>>({});

/** 셸이 새 폴더를 알려 왔다 — 같은 값이면 아무것도 하지 않는다 */
export function noteReportedCwd(paneId: string, cwd: string): void {
  if (cwds[paneId] !== cwd) cwds[paneId] = cwd;
}

/** 그 타일의 터미널이 사라졌다 */
export function forgetReportedCwd(paneId: string): void {
  delete cwds[paneId];
}

/** 그 타일의 셸이 마지막으로 알려 준 폴더(없으면 `null`) — 반응형 */
export function reportedCwd(paneId: string): string | null {
  return cwds[paneId] ?? null;
}

/**
 * 로컬 셸이 알려 준 폴더를 **이 PC 의 경로로** — WSL 이면 옮긴다(`folder-conversations` 와 같은 규칙). 모르면 `null`.
 * 독의 에이전트 점(`app/dock-dots`)과 워크트리 변경 배지의 턴 끝 갱신(`app/worktrees`)이 같은 자리를 본다. 반응형
 */
export function localReportedFolder(pane: PaneSpec): string | null {
  const reported = reportedCwd(pane.id)?.trim();
  if (!reported) return null;
  const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
  if (distro && reported.startsWith("/")) return wslCwdToWindows(distro, reported);
  return reported;
}

/**
 * 그 타일에서 **경로 링크를 풀 자리**(`path-links.ts` 의 [`PathLinkPlace`]) — SSH 는 원격, 로컬은 WSL 이면 배포판 옮김을 단 자리 ·
 * 아니면 이 PC. 터미널 · 셸 타일이 아니면 `null`(링크를 걸지 않는다). `cwd` 는 그 셸이 알려 준 폴더(배포판 안의 POSIX 그대로).
 * 터미널 글자의 경로(`Terminal.svelte` 의 `pathPlace`)와 AI 타일 대화 면의 경로(`pane/AiFlip`)가 같이 쓴다.
 */
export function pathLinkPlace(pane: Pick<PaneSpec, "kind" | "shell">, cwd: string | null): PathLinkPlace | null {
  if (pane.kind === "ssh") return { kind: "remote", cwd };
  if (pane.kind !== "local") return null;
  const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
  if (distro) return { kind: "wsl", cwd, toLocal: (p) => wslCwdToWindows(distro, p) };
  return { kind: "local", cwd };
}
