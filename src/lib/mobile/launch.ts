// 폰의 "새 탭에 열기" 시트 · 둘러보기 화면의 재료 — 순수 모듈. 목록은 데스크톱 독(`DockLaunch`)과 같은 출처를 부르는 쪽이 넘긴다.

export type LaunchItem =
  | { kind: "shell"; key: string; shellId: string | null; name: string }
  | { kind: "ai"; key: string; id: string; command: string; name: string }
  | { kind: "localfs"; key: "localfs"; name: string };

export interface LaunchInput {
  /** 감지가 비면 `null` — 셸을 정하지 않고 연다 */
  shellId: string | null;
  shellName: string;
  ai: readonly { id: string; command: string; name: string }[];
  filesName: string;
}

export function launchItems(input: LaunchInput): LaunchItem[] {
  const out: LaunchItem[] = [{ kind: "shell", key: "shell", shellId: input.shellId, name: input.shellName }];
  const seen = new Set<string>();
  for (const a of input.ai) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ kind: "ai", key: `ai:${a.id}`, id: a.id, command: a.command, name: a.name });
  }
  out.push({ kind: "localfs", key: "localfs", name: input.filesName });
  return out;
}

export const RECENT_ROWS = 3;

export interface LeafLike {
  kind: string;
  alias?: string;
  adhoc?: unknown;
}

/** 소문자 · 빠른 접속 타일은 뺀다 */
export function openAliases(leaves: Iterable<LeafLike>): Set<string> {
  const out = new Set<string>();
  for (const p of leaves) {
    if (p.kind !== "ssh" || p.adhoc) continue;
    const a = p.alias?.trim().toLowerCase();
    if (a) out.add(a);
  }
  return out;
}

export interface RecentHostRow {
  name: string;
  connected: boolean;
  at: number | null;
}

/** `recent` 는 이미 늦은 순으로 고른 호스트(`recentHosts`) */
export function recentHostRows(
  recent: readonly { name: string }[],
  lastOk: (alias: string) => number | null,
  open: ReadonlySet<string>,
  limit = RECENT_ROWS,
): RecentHostRow[] {
  return recent.slice(0, limit).map((h) => ({ name: h.name, connected: open.has(h.name.toLowerCase()), at: lastOk(h.name) }));
}

export function recentProjectIds(
  opens: readonly { projectId: string; at: number }[],
  known: ReadonlySet<string>,
  limit = RECENT_ROWS,
): { id: string; at: number }[] {
  const out: { id: string; at: number }[] = [];
  const seen = new Set<string>();
  for (const o of [...opens].sort((a, b) => b.at - a.at)) {
    if (seen.has(o.projectId) || !known.has(o.projectId)) continue;
    seen.add(o.projectId);
    out.push({ id: o.projectId, at: o.at });
    if (out.length >= limit) break;
  }
  return out;
}

/** `elsewhere` — `openPane` 은 메인 PC 가 지금 보는 워크스페이스에서만 된다(주 창이 `elsewhere` 로 거절한다) */
export function sheetHereBlock(at: {
  target: string | null;
  current: string | null;
  hasTab: boolean;
  homeWorkspace: string | null;
}): "none" | "elsewhere" | null {
  if (!at.hasTab || at.current === null || (at.target !== null && at.target !== at.current)) return "none";
  if (at.homeWorkspace !== null && at.homeWorkspace !== at.current) return "elsewhere";
  return null;
}
