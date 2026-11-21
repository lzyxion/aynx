/**
 * 사용량 화면의 출처 칩(순수 층). 붙은 SSH 타일이 없는 호스트는 마지막으로 읽은 값을 흐리게 둔다 — 자동으로 접속하지 않는다.
 */
import type { AgentConversation } from "$lib/agent-sessions";
import type { RemoteConversation, RemoteHostState } from "$lib/remote-conversations";

export type SourceKey = "local" | "all" | `host:${string}`;

export const LOCAL: SourceKey = "local";
export const ALL: SourceKey = "all";

export function hostKey(alias: string): SourceKey {
  return `host:${alias.trim().toLowerCase()}`;
}

export interface SourceChip {
  key: SourceKey;
  kind: "local" | "host" | "all";
  alias: string | null;
  /** 모르면 `null`(이 PC 목록을 아직 못 읽었다) */
  count: number | null;
  /** 그 호스트에 붙은 SSH 타일이 이 창에 있다 */
  live: boolean;
  /** 이 PC 의 epoch ms */
  readAt: number | null;
  loading: boolean;
}

export interface SourceHost {
  alias: string;
  state: RemoteHostState;
  live: boolean;
}

/** 대화를 읽은 적 있는 호스트가 하나도 없으면 빈 목록 — 칩 줄은 서지 않는다 */
export function sourceChips(localCount: number | null, hosts: readonly SourceHost[]): SourceChip[] {
  const withData = hosts
    .filter((h) => h.state.rows !== null)
    .sort((a, b) => a.alias.localeCompare(b.alias));
  if (withData.length === 0) return [];
  const chips: SourceChip[] = [
    { key: LOCAL, kind: "local", alias: null, count: localCount, live: true, readAt: null, loading: false },
  ];
  for (const h of withData) {
    chips.push({
      key: hostKey(h.alias),
      kind: "host",
      alias: h.alias,
      count: h.state.rows?.length ?? 0,
      live: h.live,
      readAt: h.state.readAt,
      loading: h.state.loading,
    });
  }
  const sum = withData.reduce((n, h) => n + (h.state.rows?.length ?? 0), localCount ?? 0);
  chips.push({ key: ALL, kind: "all", alias: null, count: sum, live: true, readAt: null, loading: false });
  return chips;
}

export function resolveSource(picked: SourceKey, chips: readonly SourceChip[]): SourceKey {
  return chips.some((c) => c.key === picked) ? picked : LOCAL;
}

export function sourceScope(key: SourceKey, chips: readonly SourceChip[]): { local: boolean; hosts: string[] } {
  if (key === LOCAL) return { local: true, hosts: [] };
  if (key === ALL) return { local: true, hosts: chips.filter((c) => c.kind === "host").map((c) => c.alias ?? "") };
  const chip = chips.find((c) => c.key === key);
  return { local: false, hosts: chip?.alias ? [chip.alias] : [] };
}

/** 붙은 세션이 있는 호스트만 — 자동으로 접속하지 않는다 */
export function hostsToRefresh(key: SourceKey, chips: readonly SourceChip[]): string[] {
  const hosts = chips.filter((c) => c.kind === "host" && c.live && c.alias !== null);
  if (key === ALL) return hosts.map((c) => c.alias as string);
  return hosts.filter((c) => c.key === key).map((c) => c.alias as string);
}

/** 원격 줄은 호스트가 붙는다 — 같은 id 가 두 서버에 있어도 목록 열쇠가 겹치지 않게 */
export function rowKey(s: AgentConversation): string {
  const host = (s as Partial<RemoteConversation>).host;
  return typeof host === "string" ? `${host.toLowerCase()}|${s.agent}:${s.id}` : `${s.agent}:${s.id}`;
}

export function readMinutes(readAt: number | null, now: number): number | null {
  if (readAt === null) return null;
  return Math.max(0, Math.floor((now - readAt) / 60_000));
}

// ---------------------------------------------------------------------------
// 사용량 칸의 원격 덮개
// ---------------------------------------------------------------------------

export interface RemoteUsageRead {
  running: boolean;
  doneBytes: number;
  totalBytes: number;
  pending: number;
  complete: boolean;
  error: string | null;
}

/** Rust `RemoteCoverage` 에서 이 줄이 쓰는 칸만 */
export interface CoverageLike {
  host: string;
  counted: number;
  pendingClaude: number;
  pendingCodex: number;
  pendingBytes: number;
}

export interface CoverageLine {
  host: string;
  kind: "running" | "error" | "offline" | "pendingClaude" | "pending" | "done";
  /** 남은 대화 수(`done` 이면 센 대화 수) */
  n: number;
  bytes: number;
  canRead: boolean;
}

export function coverageLine(cov: CoverageLike, read: RemoteUsageRead | null, live: boolean): CoverageLine | null {
  const n = cov.pendingClaude + cov.pendingCodex;
  const base = { host: cov.host, n, bytes: cov.pendingBytes };
  if (read?.running) return { ...base, kind: "running", canRead: false };
  if (read?.error) return { ...base, kind: "error", canRead: live && n > 0 };
  if (n === 0) return read?.complete ? { ...base, kind: "done", n: cov.counted, canRead: false } : null;
  if (!live) return { ...base, kind: "offline", canRead: false };
  return { ...base, kind: cov.pendingCodex === 0 ? "pendingClaude" : "pending", canRead: true };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}
