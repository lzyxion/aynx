/**
 * **DB 연결별 접속 기록** — 규칙만 담은 순수 모듈 (2026-10-20 — `host-history.ts` 와 같은 분담).
 *
 * 값은 세션 서버가 사람 쿼리 타일의 접속이 성공할 때마다 `<설정 루트>/db-history.json` 에 적고(Rust `db_history.rs` —
 * AI 전용 연결은 적지 않는다), 프런트는 **읽기만** 한다 — 사본은 `app/db-history.svelte.ts` 의 `$state` 하나다. 읽는 곳은 독 DB
 * 칸의 "최근" 정렬(`db-folders.ts` 의 `dbDockTree` · `recentOf`) · 줄 뒷글자(`2분 전`) · 줄 말풍선([`dbTooltipLines`])이다.
 *
 * 룬도 Tauri 왕복도 없다 (vitest 가 `environment: "node"` 라 `.svelte.ts` 를 못 들인다).
 */
import type { Tr } from "$lib/finish-notify";
import { relativeTime } from "$lib/history-search";

/** Rust `DbHistoryEntry` 와 1:1 */
export interface DbHistoryEntry {
  last_ok_at: number | null;
  /** 성공한 접속 수 */
  count: number;
}

/** 연결 id → 한 줄 (`db_history_list` 의 반환 그대로) */
export type DbHistory = Readonly<Record<string, DbHistoryEntry>>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * 백엔드가 준 원시 값 → 믿을 수 있는 표. **절대 throw 하지 않는다** — 모양이 어긋난 줄은 버리고 나머지는 살린다
 * (`host-history.ts` 의 `parseHistory` 와 같은 판정).
 */
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

/**
 * 연결 하나의 마지막 성공 시각 — 없으면 `null`. 연결 id 는 **대소문자를 가린다**(볼트 열쇠와 같은 글자 — 호스트 별칭과 다르다).
 * `own` 검사: 표의 열쇠는 사람이 아니라 파일이 정하므로 `__proto__` 같은 글자가 와도 원형을 읽지 않는다.
 */
export function dbLastOkAt(history: DbHistory, id: string): number | null {
  return Object.prototype.hasOwnProperty.call(history, id) ? (history[id]?.last_ok_at ?? null) : null;
}

/**
 * **독 DB 줄의 말풍선** — 호스트 줄(`HostList` 의 `rowTip`)과 같은 꼴: 첫 줄 주소, 경유면 둘째 줄 SSH 경유 호스트, 그 아래
 * 마지막 접속(호스트와 같은 문구 `files.host.history.ok` — `2분 전 · N회`). 실패는 적지 않으므로(Rust `db_history.rs`) 실패 줄이 없다.
 */
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
