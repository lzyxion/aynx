import type { SheetBadge } from "$lib/console/session-sheet";
import type { Tr } from "$lib/session";

export function canDeleteWorkspace(count: number): boolean {
  return count > 1;
}

export function reorderWorkspaceIds(ids: string[], from: string, before: string | null): string[] {
  if (from === before || !ids.includes(from) || (before !== null && !ids.includes(before))) return ids;
  const rest = ids.filter((id) => id !== from);
  const at = before === null ? rest.length : rest.indexOf(before);
  const next = [...rest.slice(0, at), from, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? ids : next;
}

export function workspaceDropBefore(
  rows: readonly { id: string; top: number; height: number }[],
  y: number,
): string | null {
  return rows.find((row) => y < row.top + row.height / 2)?.id ?? null;
}

export function stepWorkspaceId(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0 || ids.length < 2) return null;
  return ids[(at + step + ids.length) % ids.length];
}

export function workspaceRowTip(tr: Tr, name: string, badge: SheetBadge | null, away: boolean): string {
  if (badge?.kind === "input") return tr("app.workspaces.cell.waiting", { name, n: badge.n });
  if (badge?.kind === "fail") return tr("app.workspaces.cell.fail", { name, n: badge.n });
  if (badge?.kind === "running") return tr("app.workspaces.cell.running", { name, n: badge.n });
  return away ? tr("app.workspaces.cell.away", { name }) : name;
}
