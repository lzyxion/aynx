import { SvelteMap, SvelteSet } from "svelte/reactivity";
import {
  composeTabTitle,
  paneName,
  type PaneSpec,
  type TabSpec,
} from "$lib/session";
import { aiOf, localPaneIdentity, remotePaneName, type LocalPaneSignals, type PaneIdentity } from "$lib/pane-identity";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 타일에 보여 줄 이름 — 런타임 신호를 얹는 표시 전용 층이다. 저장되지 않고 `PaneSpec.shell` 도 건드리지 않는다.
 * 이름과 `PaneIcon` 의 아이콘은 같은 `paneIdentity` 를 지나야 어긋나지 않는다.
 */

const oscTitles = new SvelteMap<string, string>();
const resolvedShells = new SvelteMap<string, string>();
/** 출처는 OSC 133 `C`/`D` 뿐 — 셸 통합이 없는 세션에는 키가 생기지 않는다(없는 정보를 지어내지 않는다). */
const runningCommands = new SvelteMap<string, string>();
/** autorun 에이전트가 끝난 타일 — 없으면 `/exit` 뒤의 평범한 셸이 계속 "Claude Code" 로 불린다. */
const endedAgents = new SvelteSet<string>();

/** 훅 신호가 밝힌 CLI — 이관 짐에 싣지 않는다(넘어간 창에는 다음 신호가 다시 붙인다). */
const attestedAgents = new SvelteMap<string, string>();

/** 메인 PC 가 거울로 알려 준 CLI(원격 창만 — 원격은 `autorun` 을 받지 않는다). 훅 신호가 먼저다. */
const mirroredAgents = new SvelteMap<string, string>();

export function setMirroredAgents(next: ReadonlyMap<string, string>): void {
  for (const id of [...mirroredAgents.keys()]) if (!next.has(id)) mirroredAgents.delete(id);
  for (const [id, cli] of next) if (mirroredAgents.get(id) !== cli) mirroredAgents.set(id, cli);
}

export function markSignalAttested(paneId: string, cli: string): void {
  if (attestedAgents.get(paneId) !== cli) attestedAgents.set(paneId, cli);
}

export function clearSignalAttested(paneId: string): void {
  attestedAgents.delete(paneId);
}

export function markAgentEnded(paneId: string): void {
  endedAgents.add(paneId);
}

export function agentEndedOf(paneId: string): boolean {
  return endedAgents.has(paneId);
}

export function reportOscTitle(paneId: string, title: string): void {
  oscTitles.set(paneId, title);
}

export function reportResolvedShell(paneId: string, shell: string): void {
  resolvedShells.set(paneId, shell);
}

export function reportRunningCommand(paneId: string, command: string | null): void {
  const line = command?.trim() ?? "";
  if (line === "") runningCommands.delete(paneId);
  else runningCommands.set(paneId, line);
}

/** 세션 id 가 `null` 이 될 때 전부 지운다 — 재사용된 id 가 옛 제목을 물려받지 않게. */
export function clearPaneTitle(paneId: string): void {
  oscTitles.delete(paneId);
  resolvedShells.delete(paneId);
  runningCommands.delete(paneId);
  endedAgents.delete(paneId);
  attestedAgents.delete(paneId);
}

export function oscTitleOf(id: string): string | undefined {
  return oscTitles.get(id);
}

export function resolvedShellOf(id: string): string | undefined {
  return resolvedShells.get(id);
}

export function runningCommandOf(id: string): string | undefined {
  return runningCommands.get(id);
}

function signalsOf(pane: PaneSpec): LocalPaneSignals {
  return {
    autorun: pane.autorun ?? null,
    agentEnded: endedAgents.has(pane.id),
    runningCommand: runningCommandOf(pane.id) ?? null,
    oscTitle: oscTitleOf(pane.id) ?? null,
    signalAttested: attestedAgents.get(pane.id) ?? mirroredAgents.get(pane.id) ?? null,
    shell: resolvedShellOf(pane.id) ?? pane.shell ?? null,
  };
}

/** `PaneIcon.svelte` 도 이 문을 지난다 — 그래야 아이콘과 이름이 다른 말을 하지 않는다. */
export function paneIdentity(pane: PaneSpec): PaneIdentity {
  return localPaneIdentity(signalsOf(pane), t);
}

export function paneAi(pane: PaneSpec): string | null {
  return aiOf(signalsOf(pane));
}

/** 화면에 뜨는 이름만 — 트리 · 저장처럼 안정된 이름이 필요한 곳은 `paneName` 을 쓴다. */
export function displayName(pane: PaneSpec): string {
  if (pane.kind === "ssh") return remotePaneName(paneName(pane, t), paneAi(pane));
  if (pane.kind === "local") return paneIdentity(pane).name;
  return paneName(pane, t);
}

/** 탭 이름 변경의 초깃값은 탭 바와 같은 글자여야 해서 이 함수를 쓴다(`Tabs.svelte`). */
export function displayTabTitle(tab: TabSpec): string {
  return composeTabTitle(tab, displayName, t);
}
