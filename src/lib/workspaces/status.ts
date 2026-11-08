// workspace 점은 창의 resident 탭만 접으며 활성 탭을 제외하는 표시 query를 받지 않는다.
import { foldTabDots, type TabDot, type TabDotAgent, type TabDotCommand } from "$lib/tab-dot";
import type { TabSpec, Tr } from "$lib/session";

export function workspaceDots(
  tabs: readonly TabSpec[],
  commands: Readonly<Record<string, TabDotCommand>>,
  agents: Readonly<Record<string, TabDotAgent[]>>,
  activity: Readonly<Record<string, boolean>>,
  tr: Tr,
): Record<string, TabDot | null> {
  const ids = new Set(tabs.map((tab) => tab.workspaceId).filter((id): id is string => id !== undefined));
  return Object.fromEntries([...ids].map((id) => [id, foldTabDots(
    tabs.filter((tab) => tab.workspaceId === id).map((tab) => ({
      active: false, command: commands[tab.id], agents: agents[tab.id], activity: activity[tab.id],
    })), tr,
  )]));
}

// 창 사이에는 접힌 원시 점만 넘긴다. 타일 이름/경로/명령문/공유 여부는 필요 없다.
export type RawWorkspaceDot =
  | { source: "agent"; state: "permission" | "finished" | "running" }
  | { source: "command"; state: "fail" | "running" | "ok" }
  | { source: "activity" };
export function rawWorkspaceDots(dots: Readonly<Record<string, TabDot | null>>): Record<string, RawWorkspaceDot | null> {
  return Object.fromEntries(Object.entries(dots).map(([id, dot]) => {
    const f = dot?.winner;
    const raw: RawWorkspaceDot | null = !f ? null : f.source === "agent"
      ? { source: "agent", state: f.state } : f.source === "command"
        ? { source: "command", state: f.state } : { source: "activity" };
    return [id, raw];
  }));
}
export function mergeWorkspaceDots(
  local: Readonly<Record<string, TabDot | null>>,
  reports: readonly Readonly<Record<string, RawWorkspaceDot | null>>[],
  tr: Tr,
): Record<string, TabDot | null> {
  const ids = new Set([...Object.keys(local), ...reports.flatMap((report) => Object.keys(report))]);
  return Object.fromEntries([...ids].map((id) => {
    const facts = [local[id]?.winner, ...reports.map((report) => report[id])].filter((fact) => fact != null);
    return [id, foldTabDots(facts.map((fact) => ({
      active: false,
      ...(fact.source === "agent" ? { agents: [{ name: "", state: fact.state }] }
        : fact.source === "command" ? { command: { name: "", state: fact.state, others: 0 } }
        : { activity: true }),
    })), tr)];
  }));
}
