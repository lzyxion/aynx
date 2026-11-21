import type { PaneSpec } from "$lib/session";
import { wslCwdToWindows } from "$lib/shell-integration";
import type { PathLinkPlace } from "$lib/path-links";

/**
 * 값이 바뀔 때만 올린다 — 원본(`shell-integration.ts`)은 프롬프트마다 와서 반응형이 아니다.
 * 화면 전용 — 저장하지 않고 이관 짐에도 싣지 않는다(받는 창의 셸이 다음 프롬프트에 다시 알려 준다).
 */

const cwds = $state<Record<string, string>>({});

export function noteReportedCwd(paneId: string, cwd: string): void {
  if (cwds[paneId] !== cwd) cwds[paneId] = cwd;
}

export function forgetReportedCwd(paneId: string): void {
  delete cwds[paneId];
}

export function reportedCwd(paneId: string): string | null {
  return cwds[paneId] ?? null;
}

export function localReportedFolder(pane: PaneSpec): string | null {
  const reported = reportedCwd(pane.id)?.trim();
  if (!reported) return null;
  const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
  if (distro && reported.startsWith("/")) return wslCwdToWindows(distro, reported);
  return reported;
}

/** `cwd` 는 그 셸이 알려 준 폴더(배포판 안의 POSIX 그대로) */
export function pathLinkPlace(pane: Pick<PaneSpec, "kind" | "shell">, cwd: string | null): PathLinkPlace | null {
  if (pane.kind === "ssh") return { kind: "remote", cwd };
  if (pane.kind !== "local") return null;
  const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
  if (distro) return { kind: "wsl", cwd, toLocal: (p) => wslCwdToWindows(distro, p) };
  return { kind: "local", cwd };
}
