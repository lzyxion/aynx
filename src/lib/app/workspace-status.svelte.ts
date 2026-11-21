import type { OpenLocation } from "$lib/project-locations";
import { invoke, emit, emitTo, isRemote, listen } from "../ipc";
import type { AgentStatus } from "$lib/agent-status";
import type { AgentTileInput } from "$lib/agent-board";
import { currentWindowLabel, tileCode } from "$lib/context";
import { workspaceList, workspaceMainWindow } from "./workspaces.svelte.js";
import { rawWorkspaceDots, type RawWorkspaceDot } from "$lib/workspaces/status";
import type { TabDot } from "$lib/tab-dot";
import type { ConsoleRowInput } from "$lib/console/console-rows";
import { requestWindow } from "$lib/workspaces/window-events";

export interface TileAgent {
  kind: string;
  status: AgentStatus | null;
}

interface StatusReport {
  label: string;
  locations?: OpenLocation[];
  dots: Record<string, RawWorkspaceDot | null>;
  tiles: { workspaceId: string; streamId: string; tabId: string; paneId: string; status: ConsoleRowInput["status"]; connected: boolean; kind?: "local" | "ssh"; alias?: string | null; agent?: TileAgent | null; folder?: string | null; tileKey?: string; tabKey?: string; projectId?: string; focusedAt?: number }[];
}
let reports = $state<Record<string, StatusReport>>({});
let latest: StatusReport | null = null;
let latestJson = "";

export function auxWorkspaceStatuses(): Readonly<Record<string, RawWorkspaceDot | null>>[] {
  return workspaceMainWindow() ? Object.values(reports).map((report) => report.dots) : [];
}
export function publishWorkspaceStatus(
  dots: Record<string, TabDot | null>,
  tiles: StatusReport["tiles"],
  locations: OpenLocation[] = [],
): void {
  // 원격 창은 보조 창이 아니다 — 관문이 이 이벤트를 원격에서 거절한다(`remote/deny.rs`).
  if (workspaceMainWindow() || isRemote) return;
  const report = { label: currentWindowLabel(), dots: rawWorkspaceDots(dots), tiles, locations };
  const json = JSON.stringify(report);
  if (json === latestJson) return;
  latestJson = json;
  latest = report;
  void emitTo("main", "workspace-status", report);
}
export function auxWindowRows(): ConsoleRowInput[] {
  if (!workspaceMainWindow()) return [];
  return Object.values(reports).flatMap((report) => report.tiles.map((tile) => ({
    streamId: tile.streamId,
    tabId: report.label + ":" + tile.tabId,
    paneId: report.label + ":" + tile.paneId,
    code: tileCode(report.label, tile.paneId),
    label: workspaceList().find((w) => w.id === tile.workspaceId)?.name ?? tileCode(report.label, tile.paneId),
    kind: tile.kind, alias: tile.alias, attention: tile.status === "running" ? null : tile.status,
    status: tile.status, connected: tile.connected,
    lastCommand: null, exit: null,
  })));
}
export function auxProjectLocations(): OpenLocation[] {
  return Object.values(reports).flatMap<OpenLocation>((report) => report.locations?.length ? report.locations.map((location) => ({
    ...location, tabId: report.label + ":" + location.tabId, paneId: report.label + ":" + location.paneId, aux: true,
  })) : report.tiles.map((tile) => ({
    workspaceId: tile.workspaceId, tabId: report.label + ":" + tile.tabId,
    paneId: report.label + ":" + tile.paneId, tileKey: tile.tileKey, tabKey: tile.tabKey,
    host: tile.kind === "ssh" ? tile.alias ?? null : null, folder: tile.folder ?? null,
    projectId: tile.projectId, focusedAt: tile.focusedAt, aux: true,
  })));
}
export function focusAuxTile(paneId: string): boolean {
  if (!workspaceMainWindow()) return false;
  for (const report of Object.values(reports)) {
    const tile = report.tiles.find((tile) => report.label + ":" + tile.paneId === paneId);
    if (!tile) {
      const location = report.locations?.find((location) => report.label + ":" + location.paneId === paneId);
      if (!location) continue;
      void invoke("focus_window", { label: report.label }).then(() =>
        requestWindow(report.label, { kind: "focus", paneId: location.paneId })).catch(() => {});
      return true;
    }
    void invoke("focus_window", { label: report.label }).then(() =>
      requestWindow(report.label, { kind: "focus", streamId: tile.streamId })).catch(() => {});
    return true;
  }
  return false;
}
export function focusAuxStream(streamId: string): boolean {
  if (!workspaceMainWindow()) return false;
  for (const report of Object.values(reports)) {
    if (!report.tiles.some((tile) => tile.streamId === streamId)) continue;
    void invoke("focus_window", { label: report.label }).then(() =>
      requestWindow(report.label, { kind: "focus", streamId })).catch(() => {});
    return true;
  }
  return false;
}
export async function listenWorkspaceStatus(): Promise<() => void> {
  const unStatus = await listen<StatusReport>("workspace-status", (event) => {
    reports[event.payload.label] = event.payload;
  }, { target: { kind: "WebviewWindow", label: currentWindowLabel() } });
  const unGone = await listen<string>("workspace-window-gone", (event) => { delete reports[event.payload]; });
  const unRequest = await listen("workspace-status-request", () => {
    if (latest) void emitTo("main", "workspace-status", latest);
  });
  return () => { unStatus(); unGone(); unRequest(); };
}
export function requestWorkspaceStatus(): void { if (!isRemote) void emit("workspace-status-request"); }

/** 보조 창 타일(`라벨:paneId`) → 워크스페이스 id */
export function auxPaneWorkspaces(): Map<string, string> {
  const owners = new Map<string, string>();
  if (!workspaceMainWindow()) return owners;
  for (const report of Object.values(reports)) for (const tile of report.tiles) owners.set(report.label + ":" + tile.paneId, tile.workspaceId);
  return owners;
}
/** 보조 창은 한 워크스페이스에만 묶이므로 그 창 보고의 `dots` 열쇠가 곧 그 워크스페이스다. */
export function auxWorkspaceWindow(workspaceId: string): string | null {
  if (!workspaceMainWindow()) return null;
  return Object.values(reports).find((report) => workspaceId in report.dots)?.label ?? null;
}
export function auxAgentTiles(): Map<string, AgentTileInput> {
  const agents = new Map<string, AgentTileInput>();
  if (!workspaceMainWindow()) return agents;
  for (const report of Object.values(reports)) for (const tile of report.tiles) {
    if (!tile.agent) continue;
    const paneId = report.label + ":" + tile.paneId;
    agents.set(paneId, { paneId, status: tile.agent.status, ai: tile.agent.kind,
      signals: null, turnStartedAt: null, place: { project: null, worktree: null },
      tabTitle: workspaceList().find((w) => w.id === tile.workspaceId)?.name ?? tileCode(report.label, tile.paneId) });
  }
  return agents;
}
