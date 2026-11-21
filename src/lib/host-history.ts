import type { HostEntry } from "$lib/hosts";
import type { HostRow } from "$lib/host-folders";
import type { Tr } from "$lib/finish-notify";
import { OPEN_CAUSES, type OpenCause } from "$lib/session";
import { relativeTime } from "$lib/history-search";
import { compareNames, compareRecent } from "$lib/list-order";

/** 호스트별 접속 이력의 순수 규칙 — 값은 Rust `host_history.rs` 만 쓰고 프런트는 읽기만 한다 */

/** Rust `HostHistoryEntry` 와 1:1 */
export interface HostHistoryEntry {
  last_ok_at: number | null;
  last_fail_at: number | null;
  /** Rust `OpenCause` 의 snake_case — 옛/새 백엔드라 모르는 글자일 수 있다 */
  last_fail_cause: string | null;
  last_fail_message: string | null;
  count: number;
}

export type HostHistory = Readonly<Record<string, HostHistoryEntry>>;

export const RECENT_LIMIT = 5;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** throw 하지 않는다 — 모양이 어긋난 줄만 버린다 */
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

/** 대소문자를 무시한다 — 저장소 전체의 별칭 비교 기준이다 */
export function historyOf(history: HostHistory, alias: string): HostHistoryEntry | null {
  const exact = history[alias];
  if (exact) return exact;
  const key = alias.trim().toLowerCase();
  for (const [k, v] of Object.entries(history)) {
    if (k.toLowerCase() === key) return v;
  }
  return null;
}

function okTimes(history: HostHistory): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of Object.entries(history)) {
    if (v.last_ok_at !== null) out.set(k.toLowerCase(), v.last_ok_at);
  }
  return out;
}

/** 실패는 순서에 들이지 않는다 — 들이면 "최근" 이 "최근에 속 썩인" 이 된다 */
export function recentOrder<T extends { name: string }>(hosts: readonly T[], history: HostHistory): T[] {
  const ok = okTimes(history);
  return [...hosts].sort(
    (a, b) =>
      compareRecent(ok.get(a.name.toLowerCase()) ?? null, ok.get(b.name.toLowerCase()) ?? null) ||
      compareNames(a.name, b.name),
  );
}

/** 폴더 줄은 제자리, 호스트가 앉던 자리에 들어갈 호스트만 다시 고른다 */
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

function causeHint(cause: string | null, tr: Tr): string | null {
  if (cause === null || cause === "other") return null;
  if (!(OPEN_CAUSES as readonly string[]).includes(cause)) return null;
  return tr(`pane.error.hint.${cause as Exclude<OpenCause, "other">}`);
}

/** 실패 줄은 마지막 실패가 마지막 성공보다 늦을 때만 선다 */
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
    if (entry.last_fail_message && hint) lines.push(hint);
  }
  return lines;
}
