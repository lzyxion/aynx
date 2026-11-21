/**
 * 지난 알림의 묶음 — 순수 모듈. 열쇠는 기록하는 순간 정해 줄에 담는다(`NotificationEntry.group` · `BannerItem.group`) —
 * 타일이 닫히거나 폴더가 바뀌어도 지난 기록의 묶음은 그대로다. 열쇠 머리(`ai:` · `tile:` · `op:`)가 달라 갈래끼리 섞이지 않는다.
 */

export interface AlertGroup {
  key: string;
  label: string;
}

export interface AlertSource {
  paneId: string;
  /** 원격 타일의 호스트 별칭(빠른 접속은 `user@host:port`) — 로컬이면 `null` */
  host: string | null;
  tileLabel: string;
}

function sourceOf(src: AlertSource): AlertGroup {
  return src.host ? { key: `host:${src.host}`, label: src.host } : { key: `pane:${src.paneId}`, label: src.tileLabel };
}

export function tileAlertGroup(src: AlertSource): AlertGroup {
  const s = sourceOf(src);
  return { key: `tile:${s.key}`, label: s.label };
}

export function agentAlertGroup(src: AlertSource & { logo: string | null; scope: string | null }): AlertGroup {
  const s = src.scope ? { key: `scope:${src.scope}`, label: src.scope } : sourceOf(src);
  return { key: `ai:${src.logo ?? "?"}|${s.key}`, label: s.label };
}

/**
 * 대상 id 가 아니라 이름의 집합이다 — 세션 id 는 다시 접속할 때마다 바뀌어 같은 서버들에 돈 실행이 갈라진다.
 * 대상을 모르면(GUI 가 없던 동안 끝난 실행) `null` — 낱줄.
 */
export function operationAlertGroup(
  names: readonly string[],
  label: (first: string, rest: number) => string,
): AlertGroup | null {
  const set = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))].sort();
  if (set.length === 0) return null;
  return { key: `op:${JSON.stringify(set)}`, label: label(set[0], set.length - 1) };
}

/** 시각 순(새것이 앞)으로 들어온다 */
export interface GroupableRow {
  key: string;
  group?: AlertGroup;
}

export interface AlertGroupView<T> {
  /** 묶음은 줄이 하나든 여럿이든 같은 키다 — 칸이 바뀌면 옛 칸의 `out:` 이 지우지도 않은 줄에 돈다 */
  key: string;
  group: AlertGroup | null;
  /** 새것이 앞 */
  rows: T[];
}

/** 연속이 아니어도 같은 열쇠면 한 묶음이고, 묶음의 자리는 가장 최근 줄 자리다 */
export function groupAlertRows<T extends GroupableRow>(rows: readonly T[]): AlertGroupView<T>[] {
  const out: AlertGroupView<T>[] = [];
  const byKey = new Map<string, AlertGroupView<T>>();
  for (const row of rows) {
    const g = row.group;
    if (!g) {
      out.push({ key: row.key, group: null, rows: [row] });
      continue;
    }
    const have = byKey.get(g.key);
    if (have) {
      have.rows.push(row);
      continue;
    }
    const view: AlertGroupView<T> = { key: `grp:${g.key}`, group: g, rows: [row] };
    byKey.set(g.key, view);
    out.push(view);
  }
  return out;
}
