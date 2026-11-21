import { invoke } from "../ipc";
import { changedFilesBetween } from "$lib/messenger-notify";
import { settings } from "$lib/settings.svelte.js";
import type { PaneSpec } from "$lib/session";
import { messengerConnected } from "$lib/app/messenger";
import { reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { tabOfPane } from "$lib/app/tabs.svelte.js";
import { tabProjectFolder } from "$lib/start-dir";

/** 에이전트 턴 하나의 셈 — 메신저 알림 둘째 줄의 재료(도구 수 · 변경 파일 수) */

interface Turn {
  tools: number;
  folder: string | null;
  before: Promise<string[] | null> | null;
}

const turns = new Map<string, Turn>();

export function localFolderOf(pane: PaneSpec): string | null {
  if (pane.kind !== "local") return null;
  return reportedCwd(pane.id) || pane.cwd?.trim() || tabProjectFolder(tabOfPane(pane.id)) || null;
}

function snapshot(dir: string): Promise<string[] | null> {
  return invoke<string[] | null>("git_change_snapshot", { dir }).catch(() => null);
}

export function turnBegan(pane: PaneSpec): void {
  const folder = localFolderOf(pane);
  // 연결된 채널이 없으면 턴마다 git 을 돌리지 않는다
  const before = settings.messenger.agentStop && folder
    ? messengerConnected().then((ok) => (ok ? snapshot(folder) : null))
    : null;
  turns.set(pane.id, { tools: 0, folder, before });
}

export function turnTool(paneId: string): void {
  const t = turns.get(paneId);
  if (t) t.tools++;
}

/** `files` 는 부를 때 끝 도장을 찍어 견준다 */
export interface TurnCount {
  tools: number | null;
  files: (() => Promise<number | null>) | null;
}

/** 권한 물음 — 턴은 이어지므로 셈을 지우지 않는다 */
export function turnSoFar(paneId: string): TurnCount {
  const t = turns.get(paneId);
  return { tools: t ? t.tools : null, files: null };
}

export function turnEnded(paneId: string): TurnCount {
  const t = turns.get(paneId);
  turns.delete(paneId);
  if (!t) return { tools: null, files: null };
  const { before, folder } = t;
  return {
    tools: t.tools,
    files:
      before && folder
        ? async () => changedFilesBetween(await before, await snapshot(folder))
        : null,
  };
}

export function dropTurn(paneId: string): void {
  turns.delete(paneId);
}
