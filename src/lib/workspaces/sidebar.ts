import type { SheetBadge } from "$lib/console/session-sheet";
import type { Tr } from "$lib/session";

// 탭 줄 워크스페이스 목록·팔레트가 같은 삭제 가능 여부를 쓰고, 끌기 미리보기와 저장이 같은 순서를 쓴다.
export function canDeleteWorkspace(count: number): boolean {
  return count > 1;
}

/** 탭·상태바와 같은 계약: before는 그 id 앞, null은 맨 뒤. 제자리면 원본 배열이다. */
export function reorderWorkspaceIds(ids: string[], from: string, before: string | null): string[] {
  if (from === before || !ids.includes(from) || (before !== null && !ids.includes(before))) return ids;
  const rest = ids.filter((id) => id !== from);
  const at = before === null ? rest.length : rest.indexOf(before);
  const next = [...rest.slice(0, at), from, ...rest.slice(at)];
  return next.every((id, i) => id === ids[i]) ? ids : next;
}

/** 칸 가운데를 기준으로 앞뒤를 가른다. 칸 사이 틈도 같은 삽입 위치로 이어진다. */
export function workspaceDropBefore(
  rows: readonly { id: string; top: number; height: number }[],
  y: number,
): string | null {
  return rows.find((row) => y < row.top + row.height / 2)?.id ?? null;
}

/**
 * 이전·다음 워크스페이스 단축키(`prev-workspace` · `next-workspace`)의 대상 — 목록 순서(상태바·전환기에 보이는
 * 순서, 끌어서 바꾼 순서)에서 `step` 칸 옆. 끝에서 처음으로 돈다(순환). 하나뿐이거나 지금 것을 모르면 `null`.
 */
export function stepWorkspaceId(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
  const at = current === null ? -1 : ids.indexOf(current);
  if (at < 0 || ids.length < 2) return null;
  return ids[(at + step + ids.length) % ids.length];
}

/**
 * 워크스페이스 목록 줄의 이름 — 툴팁 · 스크린 리더. 배지(`sheetBadge` — 가장 급한 것 하나)의 뜻을 뒤에 붙이고, 배지가 없고
 * 다른 창에 열려 있으면 그 사실을 붙인다. 2026-10-13 에 하단 독의 워크스페이스 칸에서 탭 줄 목록(`Tabs.svelte`)으로 옮겼다.
 */
export function workspaceRowTip(tr: Tr, name: string, badge: SheetBadge | null, away: boolean): string {
  if (badge?.kind === "input") return tr("app.workspaces.cell.waiting", { name, n: badge.n });
  if (badge?.kind === "fail") return tr("app.workspaces.cell.fail", { name, n: badge.n });
  if (badge?.kind === "running") return tr("app.workspaces.cell.running", { name, n: badge.n });
  return away ? tr("app.workspaces.cell.away", { name }) : name;
}
