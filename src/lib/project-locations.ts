// 프로젝트 소속은 저장하지 않는다. host + 최선의 폴더를 등록된 가장 깊은 위치에 대응한다.
export interface ProjectFolder {
  projectId: string;
  host: string | null;
  path: string;
}
export interface OpenLocation {
  workspaceId: string;
  tabId?: string;
  paneId?: string;
  tabKey?: string;
  tileKey?: string;
  host: string | null;
  folder: string | null;
  remoteHome?: string | null;
  projectId?: string;
  focusedAt?: number;
  aux?: boolean;
}
export function normalizedLocationPath(path: string, host: string | null): string {
  const trimmed = path.trim();
  const windows = host === null && (trimmed.includes("\\") || trimmed.startsWith("//") || /^[A-Za-z]:/.test(trimmed));
  const value = windows ? trimmed.replace(/\\/g, "/").toLowerCase() : trimmed;
  return value.replace(/\/+$/, "") || (value.startsWith("/") ? "/" : "");
}
function pathAtLocation(path: string, location: Pick<OpenLocation, "host" | "remoteHome">): string {
  const home = location.host ? location.remoteHome?.replace(/\/+$/, "") : null;
  const expanded = home && (path === "~" || path.startsWith("~/")) ? home + path.slice(1) : path;
  return normalizedLocationPath(expanded, location.host);
}
function sameHost(a: string | null, b: string | null): boolean {
  return (a?.trim().toLowerCase() || null) === (b?.trim().toLowerCase() || null);
}
export function matchProjectLocation(location: Pick<OpenLocation, "host" | "folder" | "projectId" | "remoteHome">, folders: readonly ProjectFolder[]): ProjectFolder | null {
  if (!location.folder) return null; // 저장된 projectId만으로 열린 것으로 판단하지 않는다.
  const path = pathAtLocation(location.folder, location);
  let best: ProjectFolder | null = null;
  let length = -1;
  for (const folder of folders) {
    if (!sameHost(location.host, folder.host)) continue;
    const base = pathAtLocation(folder.path, location);
    if (!base || (path !== base && !path.startsWith(base === "/" ? "/" : base + "/"))) continue;
    if (base.length > length || (base.length === length && folder.projectId === location.projectId)) {
      best = folder;
      length = base.length;
    }
  }
  return best;
}
export function locationsForProject(projectId: string, locations: readonly OpenLocation[], folders: readonly ProjectFolder[], path?: string): OpenLocation[] {
  return locations.filter((location) => {
    const match = matchProjectLocation(location, folders);
    return match?.projectId === projectId && (path === undefined || pathAtLocation(match.path, location) === pathAtLocation(path, location));
  }).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0));
}
export function openLocationMarkers(locations: readonly OpenLocation[], currentId: string | null, workspaces: readonly { id: string; name: string }[]): { here: boolean; elsewhere: { id: string; name: string }[]; badge: string | null } {
  const ids = new Set(locations.map((location) => location.workspaceId));
  const elsewhere = workspaces.filter((workspace) => workspace.id !== currentId && ids.has(workspace.id));
  const badge = elsewhere.length ? elsewhere[0].name + " ↗" + (elsewhere.length > 1 ? " +" + (elsewhere.length - 1) : "") : null;
  return { here: currentId !== null && ids.has(currentId), elsewhere, badge };
}
export function openHereFirst<T>(items: readonly T[], isHere: (item: T) => boolean): T[] {
  return [...items.filter(isHere), ...items.filter((item) => !isHere(item))];
}
export function projectOpenPlan(locations: readonly OpenLocation[], currentId: string | null, lonePlainStart: boolean): { kind: "focus"; location: OpenLocation } | { kind: "reuse" | "new" } {
  const here = locations.filter((location) => location.workspaceId === currentId).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))[0];
  return here ? { kind: "focus", location: here } : { kind: lonePlainStart ? "reuse" : "new" };
}

/** 탭 하나의 타일 자리들 — 자리를 모르는 타일(빈 시작 화면 · 빠른 접속 · 브랜치 그래프 …)은 `null` */
export interface TabLocations {
  tabId: string;
  locations: readonly (Pick<OpenLocation, "host" | "folder" | "projectId" | "remoteHome"> | null)[];
}

/**
 * **워크트리를 지울 때 함께 닫을 탭** (docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md).
 *
 * 타일의 자리는 독의 "열린 곳" 과 같은 판정([`matchProjectLocation`] — 그 폴더를 품은 **가장 깊은** 등록 폴더)이고,
 * 그 답이 지울 워크트리(`target`)면 그 타일은 워크트리 안에 있다. 그래서 `fe` 와 `fe2` 는 경계로 갈리고, 워크트리
 * 안에 다른 등록 폴더가 겹쳐 있으면 그 안의 타일은 그쪽 것이다. Windows 경로는 대소문자·구분자를 가리지 않는다.
 *
 * - `close` — **모든** 타일이 그 워크트리 안인 탭. 자리를 모르는 타일이 하나라도 있으면 닫지 않는다(보수적으로).
 * - `mixed` — 그 워크트리 타일이 있지만 다른 타일이 섞인 탭의 수(남긴다 — 상자가 한 줄로 밝힌다).
 */
export function worktreeTabsVerdict(
  tabs: readonly TabLocations[],
  target: ProjectFolder,
  folders: readonly ProjectFolder[],
): { close: string[]; mixed: number } {
  const known = folders.some((f) => sameHost(f.host, target.host) && f.projectId === target.projectId && f.path === target.path)
    ? folders
    : [...folders, target];
  const inside = (loc: TabLocations["locations"][number]): boolean => {
    if (!loc) return false;
    const match = matchProjectLocation(loc, known);
    return match !== null && sameHost(match.host, target.host) && pathAtLocation(match.path, loc) === pathAtLocation(target.path, loc);
  };
  const close: string[] = [];
  let mixed = 0;
  for (const tab of tabs) {
    const hits = tab.locations.filter(inside).length;
    if (hits === 0) continue;
    if (hits === tab.locations.length) close.push(tab.tabId);
    else mixed += 1;
  }
  return { close, mixed };
}
