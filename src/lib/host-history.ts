import type { HostEntry } from "$lib/hosts";
import type { HostRow } from "$lib/host-folders";
import type { Tr } from "$lib/finish-notify";
import { OPEN_CAUSES, type OpenCause } from "$lib/session";
import { relativeTime } from "$lib/history-search";
import { compareNames, compareRecent } from "$lib/list-order";

/**
 * **호스트별 접속 이력** — 규칙만 담은 순수 모듈 (docs/log/2026-09-23-host-history.md).
 *
 * 값은 Rust 가 `<config_dir>/aynx/history.json` 에 적고(`host_history.rs`), 프런트는 **읽기만**
 * 한다 — 사본은 `app/host-history.svelte.ts` 의 `$state` 하나다. 여기 있는 것은 그 사본으로
 * 무엇을 그릴지 정하는 함수들뿐이다: 호스트 목록의 "최근" 정렬 · 호스트 줄 말풍선 · 명령
 * 팔레트의 "최근" 묶음.
 *
 * 룬도 Tauri 왕복도 없다 (vitest 가 `environment: "node"` 라 `.svelte.ts` 를 못 들인다 —
 * `favorites.ts` 와 같은 분담).
 */

/** Rust `HostHistoryEntry` 와 1:1 */
export interface HostHistoryEntry {
  last_ok_at: number | null;
  last_fail_at: number | null;
  /** Rust `OpenCause` 의 snake_case (모르는 글자일 수도 있다 — 옛/새 백엔드) */
  last_fail_cause: string | null;
  last_fail_message: string | null;
  /** 성공한 접속 수 */
  count: number;
}

/** 별칭 → 한 줄 (`host_history_list` 의 반환 그대로) */
export type HostHistory = Readonly<Record<string, HostHistoryEntry>>;

/** 명령 팔레트 "최근" 묶음의 줄 수 */
export const RECENT_LIMIT = 5;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * 백엔드가 준 원시 값 → 믿을 수 있는 표. **절대 throw 하지 않는다** — 모양이 어긋난 줄은
 * 버리고 나머지는 살린다 (`parseFavorites` 와 같은 판정).
 */
export function parseHistory(raw: unknown): Record<string, HostHistoryEntry> {
  const out: Record<string, HostHistoryEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [alias, v] of Object.entries(raw as Record<string, unknown>)) {
    if (alias.trim() === "" || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[alias] = {
      last_ok_at: num(o.last_ok_at),
      last_fail_at: num(o.last_fail_at),
      last_fail_cause: str(o.last_fail_cause),
      last_fail_message: str(o.last_fail_message),
      count: num(o.count) ?? 0,
    };
  }
  return out;
}

/**
 * 별칭으로 한 줄을 찾는다 — **대소문자를 무시한다** (별칭 비교의 기준이 저장소 전체에서
 * 그렇다 — `favorites.ts` 의 `withRenamedHost`).
 */
export function historyOf(history: HostHistory, alias: string): HostHistoryEntry | null {
  const exact = history[alias];
  if (exact) return exact;
  const key = alias.trim().toLowerCase();
  for (const [k, v] of Object.entries(history)) {
    if (k.toLowerCase() === key) return v;
  }
  return null;
}

/** 소문자 별칭 → 마지막 성공 시각 (없으면 표에 없다) */
function okTimes(history: HostHistory): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(history)) {
    if (v.last_ok_at !== null) out.set(k.toLowerCase(), v.last_ok_at);
  }
  return out;
}

/**
 * "최근" 순서 — 마지막 **성공** 시각이 늦은 것부터, 한 번도 안 붙은 것은 맨 뒤, 같으면 이름순.
 *
 * 실패는 순서에 들이지 않는다: 어제 안 붙은 서버가 맨 위로 올라오면 "최근" 이 "최근에 속
 * 썩인" 이 된다. 새 배열을 돌려준다 (입력은 건드리지 않는다).
 */
export function recentOrder<T extends { name: string }>(hosts: readonly T[], history: HostHistory): T[] {
  const ok = okTimes(history);
  return [...hosts].sort(
    (a, b) =>
      compareRecent(ok.get(a.name.toLowerCase()) ?? null, ok.get(b.name.toLowerCase()) ?? null) ||
      compareNames(a.name, b.name),
  );
}

/**
 * 목록 줄에 "최근" 정렬을 입힌다 — **폴더 줄은 제자리**, 호스트 줄만 [`recentOrder`] 로.
 *
 * 폴더까지 섞으면 "최근" 을 켜는 순간 폴더가 호스트 사이로 흩어진다. 호스트가 앉던 **자리들**
 * 을 그대로 두고 그 자리에 들어갈 호스트만 다시 고른다 — 폴더 보기(폴더 먼저·호스트 뒤)와
 * 검색(호스트만) 둘 다 같은 함수로 된다.
 */
export function sortRowsByRecent(rows: readonly HostRow[], history: HostHistory): HostRow[] {
  const hostRows = rows.filter((r): r is Extract<HostRow, { kind: "host" }> => r.kind === "host");
  if (hostRows.length < 2) return [...rows];
  const sorted = recentOrder(
    hostRows.map((r) => ({ name: r.host.name, row: r })),
    history,
  ).map((x) => x.row);
  let i = 0;
  return rows.map((r) => (r.kind === "host" ? sorted[i++] : r));
}

/**
 * 명령 팔레트 "최근" 묶음 — 한 번이라도 **성공한** 호스트를 늦은 순으로 최대 `limit` 줄.
 *
 * 즐겨찾기는 빼지 않는다: 팔레트에는 즐겨찾기 줄이 없어서 겹칠 자리가 없고, "방금 붙었던
 * 곳" 은 고정했든 안 했든 똑같이 다시 가고 싶은 곳이다. 지금 목록(`hosts`)에 없는 별칭은
 * 열 수가 없으니 빠진다(이력은 남아 있어도 설정에서 지운 호스트).
 */
export function recentHosts(
  hosts: readonly HostEntry[],
  history: HostHistory,
  limit = RECENT_LIMIT,
): HostEntry[] {
  const ok = okTimes(history);
  const seen = new Set<string>();
  const picked = hosts.filter((h) => {
    const key = h.name.toLowerCase();
    if (!ok.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return recentOrder(picked, history).slice(0, limit);
}

/** 사유 코드 → 이미 있는 접속 진단 힌트 키 (`pane.error.hint.*`). `other`·모르는 코드는 `null` */
function causeHint(cause: string | null, tr: Tr): string | null {
  if (cause === null || cause === "other") return null;
  if (!(OPEN_CAUSES as readonly string[]).includes(cause)) return null;
  return tr(`pane.error.hint.${cause as Exclude<OpenCause, "other">}`);
}

/**
 * 호스트 줄 말풍선에 붙일 줄들 (없으면 빈 배열).
 *
 *  · 성공한 적이 있으면 `마지막 접속 3분 전 · 12회`.
 *  · 마지막 실패가 마지막 성공보다 **늦으면** `마지막 실패 …` 와 그 사유 — 백엔드가 남긴 짧은
 *    한 줄이 있으면 그것, 그리고 접속 진단이 쓰는 **같은 힌트 문구**(새 문구를 만들지 않는다).
 *    성공이 더 늦으면 옛 실패는 이미 지나간 일이라 말하지 않는다.
 */
export function historyTooltipLines(entry: HostHistoryEntry | null, now: number, tr: Tr): string[] {
  if (!entry) return [];
  const lines: string[] = [];
  if (entry.last_ok_at !== null) {
    lines.push(
      tr("files.host.history.ok", {
        when: relativeTime(entry.last_ok_at, now, tr),
        count: entry.count,
      }),
    );
  }
  const failNewer =
    entry.last_fail_at !== null && (entry.last_ok_at === null || entry.last_fail_at > entry.last_ok_at);
  if (failNewer && entry.last_fail_at !== null) {
    const when = relativeTime(entry.last_fail_at, now, tr);
    const hint = causeHint(entry.last_fail_cause, tr);
    const reason = entry.last_fail_message ?? hint;
    lines.push(
      reason ? tr("files.host.history.failWith", { when, reason }) : tr("files.host.history.fail", { when }),
    );
    // 한 줄이 백엔드 문구였으면 힌트는 그 아래 따로 선다 (사실 / 제안 — 접속 오류 배너와 같은 결).
    if (entry.last_fail_message && hint) lines.push(hint);
  }
  return lines;
}
