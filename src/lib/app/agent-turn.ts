import { invoke } from "../ipc";
import { changedFilesBetween } from "$lib/messenger-notify";
import { settings } from "$lib/settings.svelte.js";
import type { PaneSpec } from "$lib/session";
import { messengerConnected } from "$lib/app/messenger";
import { reportedCwd } from "$lib/app/pane-cwd.svelte.js";
import { tabOfPane } from "$lib/app/tabs.svelte.js";
import { tabProjectFolder } from "$lib/start-dir";

/**
 * **에이전트 턴 하나의 셈** — 메신저(Discord) 알림 둘째 줄의 재료(docs/log/2026-09-27-discord-notify.md
 * "둘째 줄 — 맥락"): 이번 턴의 도구 사용 수와, 로컬 타일이면 턴 시작 때의 **변경 도장**(Rust `git_change_snapshot`).
 *
 * 훅 신호를 받는 자리(`app/agent-status.svelte.ts` 의 `agentSignal`)가 부른다 — `start` → [`turnBegan`],
 * `tool-done` → [`turnTool`], `stop` → [`turnEnded`], 권한 물음 → [`turnSoFar`]. 화면에 그리지 않으므로 반응형이
 * 아니다. 타일마다 하나이고 창마다 따로다(신호 저장소와 같은 규칙).
 *
 * 도장은 **메신저가 켜져 있고 턴 끝 알림이 켜져 있을 때만** 찍는다 — 쓰지 않는 사람의 PC 에서 턴마다 git 을
 * 돌리지 않는다. 끝의 도장은 보낼 때 한 번(`files()` 를 부른 때)만 찍는다.
 */

interface Turn {
  tools: number;
  folder: string | null;
  /** 턴 시작 때의 도장(찍지 않았으면 `null`) */
  before: Promise<string[] | null> | null;
}

const turns = new Map<string, Turn>();

/** 이 타일이 도는 **이 컴퓨터의 폴더** — 로컬 타일만(셸이 알려 준 폴더 → 시작 폴더 → 탭의 프로젝트 폴더) */
export function localFolderOf(pane: PaneSpec): string | null {
  if (pane.kind !== "local") return null;
  return reportedCwd(pane.id) || pane.cwd?.trim() || tabProjectFolder(tabOfPane(pane.id)) || null;
}

/** 변경 도장 — 실패는 `null`(그 칸을 뺀다) */
function snapshot(dir: string): Promise<string[] | null> {
  return invoke<string[] | null>("git_change_snapshot", { dir }).catch(() => null);
}

/** 훅 `start` — 새 턴. 지난 턴의 셈은 버린다 */
export function turnBegan(pane: PaneSpec): void {
  const folder = localFolderOf(pane);
  // 파일 수는 메신저 둘째 줄에만 쓴다 — 연결된 채널이 없으면 턴마다 git 을 돌리지 않는다
  const before = settings.messenger.agentStop && folder
    ? messengerConnected().then((ok) => (ok ? snapshot(folder) : null))
    : null;
  turns.set(pane.id, { tools: 0, folder, before });
}

/** 훅 `tool-done` — 도구 하나가 끝났다(`start` 를 못 본 턴은 세지 않는다) */
export function turnTool(paneId: string): void {
  const t = turns.get(paneId);
  if (t) t.tools++;
}

/** 이번 턴의 셈 — `tools` 는 `start` 를 못 봤으면 `null`. `files` 는 부를 때 끝 도장을 찍어 견준다(없으면 `null`) */
export interface TurnCount {
  tools: number | null;
  files: (() => Promise<number | null>) | null;
}

/** 권한 물음 — 턴은 이어진다(셈을 지우지 않는다). 파일은 세지 않는다 */
export function turnSoFar(paneId: string): TurnCount {
  const t = turns.get(paneId);
  return { tools: t ? t.tools : null, files: null };
}

/** 훅 `stop` — 턴 끝. 셈을 꺼내고 지운다 */
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

/** 새 세션 · 새 명령 · 타일이 사라졌다 — 셈을 버린다 */
export function dropTurn(paneId: string): void {
  turns.delete(paneId);
}
