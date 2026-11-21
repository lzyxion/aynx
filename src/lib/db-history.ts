/** DB 연결별 접속 기록의 순수 규칙 — 값은 세션 서버(Rust `db_history.rs`)가 적고 프런트는 읽기만 한다. */
import type { Tr } from "$lib/finish-notify";
import { relativeTime } from "$lib/history-search";

/** Rust `DbHistoryEntry` 와 1:1 */
export interface DbHistoryEntry {
  last_ok_at: number | null;
  count: number;
}

export type DbHistory = Readonly<Record<string, DbHistoryEntry>>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 절대 throw 하지 않는다 — 모양이 어긋난 줄만 버린다 */
export function parseDbHistory(raw: unknown): Record<string, DbHistoryEntry> {
  const out: Record<string, DbHistoryEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (id.trim() === "" || !v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    out[id] = { last_ok_at: num(o.last_ok_at), count: num(o.count) ?? 0 };
  }
  return out;
}

/** 연결 id 는 대소문자를 가린다(볼트 열쇠와 같은 글자). 열쇠는 파일이 정하므로 `__proto__` 가 와도 원형을 읽지 않게 own 검사 */
export function dbLastOkAt(history: DbHistory, id: string): number | null {
  return Object.prototype.hasOwnProperty.call(history, id) ? (history[id]?.last_ok_at ?? null) : null;
}

export function dbTooltipLines(
  address: string,
  via: string | null,
  history: DbHistory,
  id: string,
  now: number,
  tr: Tr,
): string[] {
  const lines = [address];
  if (via !== null) lines.push(tr("app.db.dock.ssh.title", { host: via }));
  const at = dbLastOkAt(history, id);
  if (at !== null) lines.push(tr("files.host.history.ok", { when: relativeTime(at, now, tr), count: history[id]?.count ?? 0 }));
  return lines;
}
