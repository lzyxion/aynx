/**
 * **대시보드의 "어디서"** — 사용량 칸의 출처 칩 (docs/log/2026-09-27-remote-conversations.md "2단계").
 *
 * 칩은 "이 PC · N" · 원격 대화를 한 번이라도 읽은 호스트마다 하나("dev-01 · M") · "모두". 원격 호스트의 값은 원격 대화
 * 저장소(`app/remote-conversations`)의 캐시다 — **이 창에 붙은 SSH 타일이 있으면** 칩을 고를 때 다시 읽고(1분 캐시), 없으면
 * 마지막으로 읽은 값을 **흐리게** 둔다("12분 전 읽음 · 연결 없음" — 자동으로 접속하지 않는다). 원격을 읽은 적이 없으면 칩 줄은
 * 서지 않는다(예전 그대로 — 이 PC 만).
 *
 * 순수 층이다 — 저장소는 `app/dashboard-source.svelte.ts`, 그림은 `console/SourceChips.svelte`.
 */
import type { AgentConversation } from "$lib/agent-sessions";
import type { RemoteConversation, RemoteHostState } from "$lib/remote-conversations";

/** 고른 출처 — 이 PC · 호스트 하나(`host:<별칭>`) · 모두 */
export type SourceKey = "local" | "all" | `host:${string}`;

export const LOCAL: SourceKey = "local";
export const ALL: SourceKey = "all";

export function hostKey(alias: string): SourceKey {
  return `host:${alias.trim().toLowerCase()}`;
}

/** 칩 하나 */
export interface SourceChip {
  key: SourceKey;
  kind: "local" | "host" | "all";
  /** 호스트 칩의 별칭(보이는 글자) */
  alias: string | null;
  /** 대화 수 — 모르면 `null`(이 PC 목록을 아직 못 읽었다) */
  count: number | null;
  /** 그 호스트에 붙은 SSH 타일이 이 창에 있다 — 없으면 흐리게(마지막으로 읽은 값) */
  live: boolean;
  /** 마지막으로 읽은 때(이 PC 의 epoch ms) */
  readAt: number | null;
  loading: boolean;
}

/** 칩을 짓는 데 드는 호스트 하나 — 저장소의 상태와 붙은 세션이 있나 */
export interface SourceHost {
  alias: string;
  state: RemoteHostState;
  live: boolean;
}

/**
 * 칩들 (**순수 함수**). 대화를 읽은 적 있는 호스트(`rows !== null`)만 칩이 되고, 하나도 없으면 빈 목록 — 칩 줄은 서지 않는다.
 * 순서: 이 PC → 호스트(이름순) → 모두.
 */
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

/** 고른 것이 칩에 없으면(호스트가 사라졌다 · 칩 줄이 없다) 이 PC */
export function resolveSource(picked: SourceKey, chips: readonly SourceChip[]): SourceKey {
  return chips.some((c) => c.key === picked) ? picked : LOCAL;
}

/** 출처 → Rust 요약에 넘길 몫(이 PC 를 넣나 · 원격 별칭들) */
export function sourceScope(key: SourceKey, chips: readonly SourceChip[]): { local: boolean; hosts: string[] } {
  if (key === LOCAL) return { local: true, hosts: [] };
  if (key === ALL) return { local: true, hosts: chips.filter((c) => c.kind === "host").map((c) => c.alias ?? "") };
  const chip = chips.find((c) => c.key === key);
  return { local: false, hosts: chip?.alias ? [chip.alias] : [] };
}

/** 그 출처를 고르면 다시 읽을 호스트들 — 붙은 세션이 있는 것만(없으면 마지막 값 그대로 — 자동으로 접속하지 않는다) */
export function hostsToRefresh(key: SourceKey, chips: readonly SourceChip[]): string[] {
  const hosts = chips.filter((c) => c.kind === "host" && c.live && c.alias !== null);
  if (key === ALL) return hosts.map((c) => c.alias as string);
  return hosts.filter((c) => c.key === key).map((c) => c.alias as string);
}

/** 줄의 열쇠 — 원격 줄은 호스트가 붙는다(같은 id 가 두 서버에 있을 일은 드물지만 목록 열쇠가 겹치지 않게) */
export function rowKey(s: AgentConversation): string {
  const host = (s as Partial<RemoteConversation>).host;
  return typeof host === "string" ? `${host.toLowerCase()}|${s.agent}:${s.id}` : `${s.agent}:${s.id}`;
}

/** 흐린 호스트 칩의 풀이 — "12분 전 읽음" 의 N(1분이 안 됐으면 0) · 읽은 적 없으면 `null` */
export function readMinutes(readAt: number | null, now: number): number | null {
  if (readAt === null) return null;
  return Math.max(0, Math.floor((now - readAt) / 60_000));
}

// ---------------------------------------------------------------------------
// 사용량 칸의 원격 덮개 — "아직 세지 못한 큰 대화" 한 줄과 [전체 사용량 읽기]
// ---------------------------------------------------------------------------

/** 호스트 하나의 전체 읽기 상태 — 진행은 바이트(다 읽은 몫 / 대화 파일 전체). 저장소는 `app/remote-conversations` */
export interface RemoteUsageRead {
  running: boolean;
  doneBytes: number;
  totalBytes: number;
  pending: number;
  complete: boolean;
  error: string | null;
}

/** 덮개의 모양 — Rust `RemoteCoverage` 에서 이 줄이 쓰는 칸만 */
export interface CoverageLike {
  host: string;
  counted: number;
  pendingClaude: number;
  pendingCodex: number;
  pendingBytes: number;
}

/** 사용량 칸의 호스트 한 줄 */
export interface CoverageLine {
  host: string;
  /**
   * `running` 읽는 중 · `error` 멈춤 · `offline` 남았는데 붙은 타일이 없다 · `pendingClaude` Claude 만 남았다 ·
   * `pending` 남았다(Codex 도) · `done` 방금 다 셌다
   */
  kind: "running" | "error" | "offline" | "pendingClaude" | "pending" | "done";
  /** 남은 대화 수(`done` 이면 센 대화 수) */
  n: number;
  /** 남은 바이트 */
  bytes: number;
  /** [전체 사용량 읽기] 를 세울까 — 붙은 세션이 있고 읽는 중이 아니다 */
  canRead: boolean;
}

/**
 * 덮개 + 전체 읽기 상태 + 붙은 세션 → 한 줄 (**순수 함수**). 남은 것이 없고 방금 다 읽은 것도 아니면 `null`(줄이 서지 않는다).
 */
export function coverageLine(cov: CoverageLike, read: RemoteUsageRead | null, live: boolean): CoverageLine | null {
  const n = cov.pendingClaude + cov.pendingCodex;
  const base = { host: cov.host, n, bytes: cov.pendingBytes };
  if (read?.running) return { ...base, kind: "running", canRead: false };
  if (read?.error) return { ...base, kind: "error", canRead: live && n > 0 };
  if (n === 0) return read?.complete ? { ...base, kind: "done", n: cov.counted, canRead: false } : null;
  if (!live) return { ...base, kind: "offline", canRead: false };
  return { ...base, kind: cov.pendingCodex === 0 ? "pendingClaude" : "pending", canRead: true };
}

/** 바이트 → 짧은 글자(`980 B` · `12 KB` · `3.4 MB` · `1.2 GB`) */
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
