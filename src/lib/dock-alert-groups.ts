/**
 * **지난 알림의 묶음** — 순수 모듈. 독 알림 칸(`DockAlerts.svelte`)의 "지난 알림" 에서 같은 출처의 줄을
 * 카드 한 장으로 접는다(가장 최근 줄 + 개수 · 펼치면 나머지).
 *
 * 묶음 열쇠는 **기록하는 순간** 정해 줄에 담는다(`NotificationEntry.group` · `BannerItem.group`) — 타일이 닫히거나
 * 폴더가 바뀌어도 지난 기록의 묶음은 그대로다. 열쇠가 없는 줄(옛 기록 · 전송 · 오케스트레이션)은 낱줄이다.
 *
 * | 갈래 | 열쇠 |
 * | --- | --- |
 * | AI 알림(끝남 · 권한) | 같은 로고 + 프로젝트 범위(`<프로젝트> · <워크트리>`) → 없으면 원격은 호스트, 로컬은 타일 |
 * | 명령 끝남 · 프로그램 알림 | 원격은 호스트, 로컬은 타일 |
 * | 작업안 실행 | 같은 대상 이름의 집합(2026-11-02) — 대상을 모르면 낱줄 |
 *
 * 갈래끼리는 섞지 않는다(열쇠 머리가 `ai:` · `tile:` · `op:` 로 다르다). 룬도 DOM 도 Tauri 도 없다(`dock-alert-groups.test.ts`).
 */

/** 줄에 담는 묶음 열쇠 — `label` 은 묶음 카드에 보일 출처 이름 */
export interface AlertGroup {
  key: string;
  label: string;
}

/** 출처의 재료 — 부르는 쪽이 그 순간의 타일에서 모아 온다 */
export interface AlertSource {
  paneId: string;
  /** 원격(ssh) 타일의 호스트 별칭(빠른 접속은 `user@host:port`) — 로컬이면 `null` */
  host: string | null;
  /** 타일 이름(탭 제목 등) — 호스트도 범위도 없을 때의 이름 */
  tileLabel: string;
}

/** 출처 갈래 — 원격이면 호스트, 아니면 타일 */
function sourceOf(src: AlertSource): AlertGroup {
  return src.host ? { key: `host:${src.host}`, label: src.host } : { key: `pane:${src.paneId}`, label: src.tileLabel };
}

/** 명령 끝남 · 프로그램 알림의 열쇠 */
export function tileAlertGroup(src: AlertSource): AlertGroup {
  const s = sourceOf(src);
  return { key: `tile:${s.key}`, label: s.label };
}

/** AI 알림의 열쇠 — 같은 로고 + 프로젝트 범위(없으면 호스트 · 타일). 로고를 모르면 `?` 하나로 모인다 */
export function agentAlertGroup(src: AlertSource & { logo: string | null; scope: string | null }): AlertGroup {
  const s = src.scope ? { key: `scope:${src.scope}`, label: src.scope } : sourceOf(src);
  return { key: `ai:${src.logo ?? "?"}|${s.key}`, label: s.label };
}

/**
 * 작업안 실행의 열쇠 — **같은 대상 묶음**(사람이 읽는 대상 이름의 집합 — 순서 · 중복 무관). 대상 id 가 아니라 이름인 것은
 * 세션 id 가 다시 접속할 때마다 바뀌어 같은 서버들에 돈 실행이 갈라지기 때문이다. 대상을 모르면(GUI 가 없던 동안 끝난 실행)
 * `null` — 낱줄. `label` 은 부르는 쪽이 첫 이름과 나머지 수로 짓는다(문구는 사전에 있다).
 */
export function operationAlertGroup(
  names: readonly string[],
  label: (first: string, rest: number) => string,
): AlertGroup | null {
  const set = [...new Set(names.map((n) => n.trim()).filter((n) => n !== ""))].sort();
  if (set.length === 0) return null;
  return { key: `op:${JSON.stringify(set)}`, label: label(set[0], set.length - 1) };
}

/** 묶을 줄 — 시각 순(새것이 앞)으로 들어온다 */
export interface GroupableRow {
  key: string;
  group?: AlertGroup;
}

/**
 * 목록 한 칸 — 열쇠 없는 줄은 `group` 이 `null` 이고 `rows` 는 하나다. 열쇠 있는 줄은 하나뿐이어도 묶음 칸이다 —
 * 그리는 쪽이 `rows.length === 1` 이면 낱줄 모양으로 그린다.
 */
export interface AlertGroupView<T> {
  /**
   * 목록 키 — 열쇠 없는 줄은 그 줄의 키, 묶음은 `grp:<열쇠>`. 묶음은 줄이 하나든 여럿이든 **같은 키**다 — 둘째 줄이
   * 들어오거나 하나로 줄 때 칸이 바뀌면 옛 칸의 `out:`(밀려 나감)이 지우지도 않은 줄에 돈다.
   */
  key: string;
  group: AlertGroup | null;
  /** 새것이 앞 — `rows[0]` 이 카드에 그릴 최근 줄 */
  rows: T[];
}

/**
 * 시각 순(새것이 앞)의 줄을 묶음 목록으로 — 묶음의 자리는 그 묶음의 가장 최근 줄 자리이고, 연속이 아니어도 같은
 * 열쇠면 한 묶음이다. 묶음 안 줄 순서도 새것이 앞(들어온 순서 그대로).
 */
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
