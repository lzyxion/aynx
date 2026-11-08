// **폰의 "새 탭에 열기" 시트 · 둘러보기 화면의 재료**(원격 웹 R5 · 10-20) — 순수 모듈.
//
// - 새 타일 칸: 데스크톱 독의 실행 단추(`DockLaunch`)와 **같은 출처** — 지금의 기본 셸(`effectiveDefaultShellId`) · 켠 AI CLI 마다
//   (`offeredAiClis`) · 로컬 파일. 목록을 여기서 지어내지 않고 부르는 쪽이 그 셋을 넘긴다(여기는 칸의 모양 · 순서만).
// - 최근 호스트 · 프로젝트: 데스크톱과 같은 기록(`recentHosts` — 접속 이력의 마지막 성공 · `recentOpens` — 최근 연 프로젝트)에서
//   몇 줄. "연결됨" 점은 이 창의 타일 트리에 그 별칭의 SSH 타일 · 그 프로젝트의 탭이 있는가다(거울이라 원격도 같다).

/** 새 타일 칸 하나 */
export type LaunchItem =
  | { kind: "shell"; key: string; shellId: string | null; name: string }
  | { kind: "ai"; key: string; id: string; command: string; name: string }
  | { kind: "localfs"; key: "localfs"; name: string };

export interface LaunchInput {
  /** 지금의 기본 셸 id(감지가 비면 `null` — 셸을 정하지 않고 연다) */
  shellId: string | null;
  shellName: string;
  /** 켠 AI CLI(`offeredAiClis` 의 답 — 순서 그대로) */
  ai: readonly { id: string; command: string; name: string }[];
  filesName: string;
}

/** **새 타일 칸들** — 기본 셸 · AI 마다 · 로컬 파일(데스크톱 독 실행 단추의 1줄 + 로컬 파일 칸과 같은 순서). */
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

/** 최근 줄 수(시트 · 둘러보기 화면 "최근") */
export const RECENT_ROWS = 3;

/** 타일 트리의 잎 하나에서 필요한 칸만 */
export interface LeafLike {
  kind: string;
  alias?: string;
  /** 빠른 접속 타일이면 무언가(대상) — 있으면 뺀다 */
  adhoc?: unknown;
}

/** **열린 SSH 별칭들**(소문자) — 설정의 호스트로 연 SSH 타일만(빠른 접속 타일은 뺀다) */
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
  /** 마지막 성공 접속(ms) — 모르면 `null` */
  at: number | null;
}

/**
 * **최근 호스트 줄** — `recent` 는 이미 늦은 순으로 고른 호스트(`recentHosts`), `lastOk` 는 별칭 → 마지막 성공 시각. 앞에서
 * `limit` 줄.
 */
export function recentHostRows(
  recent: readonly { name: string }[],
  lastOk: (alias: string) => number | null,
  open: ReadonlySet<string>,
  limit = RECENT_ROWS,
): RecentHostRow[] {
  return recent.slice(0, limit).map((h) => ({ name: h.name, connected: open.has(h.name.toLowerCase()), at: lastOk(h.name) }));
}

/**
 * **최근 프로젝트 id** — 최근 연 기록(늦은 순 · 워크트리 줄 포함)에서 프로젝트를 한 번씩, 지금 목록에 있는 것만 앞에서
 * `limit` 개. 시각은 그 프로젝트의 가장 늦은 기록.
 */
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
