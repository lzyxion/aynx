// **셸 타일의 마지막 폴더**(`PaneSpec.lastCwd` — 2026-11-12) — 적을 값과 쓸 자리의 순수 규칙.
//
// 앱(과 세션 서버)이 다시 뜨면 배치는 돌아오지만 셸은 새로 뜬다 — 예전에는 시작 폴더(`cwd` — 프로젝트 · 워크트리) 또는 홈이었다.
// 셸이 알려 준 마지막 폴더(OSC 7 · 9;9)를 명세에 적어 두고, **붙을 세션이 없어 새 셸을 여는 첫 열기**(`Terminal` 의 `startFirst`)에서
// 그 폴더로 띄운다. `cwd` 는 덮지 않는다 — 그 칸은 "프로젝트 시작 폴더" 이기도 하고 분할 복제가 물려받는다.
//
// 자동 실행(`autorun`)이 있는 타일(AI 타일 · 프로젝트 명령)은 적지도 쓰지도 않는다 — 그 명령은 시작 폴더에서 돌아야 한다.
// 로컬 셸만이다: SSH 의 복원은 원격 첫 입력을 싣지 않는다(`Terminal` 의 `sshStart` 주석).

import { wslCwdToWindows } from "$lib/shell-integration";
import type { PaneSpec } from "./spec";

/**
 * 셸이 알려 준 폴더 → 명세에 적을 값(이 PC 의 경로). 적지 않을 타일이거나 다룰 값이 아니면 `null`.
 * WSL 이면 배포판 안의 POSIX 경로를 옮긴다(`wslCwdToWindows` — 셸을 띄우는 `spawn_cwd` 는 이 PC 의 폴더만 받는다 · 없는 폴더는 홈).
 * 창 이관으로 넘어와 `autorun` 이 지워진 타일은 `restart.autorun` 이 그 자리다(`adoptTab`).
 */
export function lastCwdToKeep(
  pane: Pick<PaneSpec, "kind" | "shell" | "autorun" | "restart">,
  reported: string,
): string | null {
  if (pane.kind !== "local" || pane.autorun || pane.restart?.autorun) return null;
  const path = reported.trim();
  if (path === "") return null;
  const distro = pane.shell?.startsWith("wsl:") ? pane.shell.slice("wsl:".length) : null;
  if (distro && path.startsWith("/")) return wslCwdToWindows(distro, path);
  return path;
}

/** 붙을 세션이 없어 **새 셸을 여는 첫 열기**의 시작 폴더 — 적어 둔 마지막 폴더(없으면 `undefined` = 여느 때처럼 `cwd` · 홈) */
export function freshStartCwd(pane: Pick<PaneSpec, "kind" | "autorun" | "lastCwd">): string | undefined {
  if (pane.kind !== "local" || pane.autorun) return undefined;
  const dir = pane.lastCwd?.trim();
  return dir ? dir : undefined;
}
