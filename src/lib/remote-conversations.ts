/**
 * 읽기는 Rust `agent_sessions_remote.rs` 가 살아 있는 세션의 exec 로 한다 — 새 접속을 열지 않는다.
 * 제목은 사용자 글자일 수 있어(첫 프롬프트) 화면으로만 간다 — 저장 · 로그 · MCP 어디에도 싣지 않는다.
 */
import { pathKey, type AgentConversation } from "$lib/agent-sessions";
import { expandRemotePath, type Project } from "$lib/projects";
import type { ScopeChip } from "$lib/folder-conversations";
import { newSshPane, type PaneSpec } from "$lib/session";

/** 원격 대화 한 줄 — Rust `RemoteSession`(로컬 줄의 칸 + 호스트 · 토큰) */
export interface RemoteConversation extends AgentConversation {
  host: string;
  /** Codex 의 누적 토큰(입력 + 출력) — Claude 는 `null`(원격 파일 전체를 읽지 않는다) */
  tokens: number | null;
}

/** 한 번 부른 답 — Rust `RemoteSessionList` */
export interface RemoteConversationReply {
  host: string;
  sessions: RemoteConversation[];
  total: number;
  done: number;
  complete: boolean;
  /** 이 PC 의 epoch ms */
  readAt: number;
  home: string | null;
}

export function isRemoteConversation(s: AgentConversation): s is RemoteConversation {
  return typeof (s as Partial<RemoteConversation>).host === "string";
}

export interface RemoteHostState {
  rows: RemoteConversation[] | null;
  loading: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** 그 호스트에 붙은 타일 세션이 이 창에 없다 — 읽지 않았다(새 접속을 열지 않는다) */
  offline: boolean;
  /** 이 PC 의 epoch ms */
  readAt: number | null;
  home: string | null;
  complete: boolean;
}

export function emptyRemoteHost(): RemoteHostState {
  return { rows: null, loading: false, progress: null, error: null, offline: false, readAt: null, home: null, complete: false };
}

/** Rust 도 같은 시간 동안 목록을 다시 뽑지 않는다. 고르는 목록의 F5 는 이것을 건너뛴다 */
export const REMOTE_FRESH_MS = 60_000;

export function remoteFresh(h: RemoteHostState, now: number): boolean {
  return h.rows !== null && h.complete && h.error === null && h.readAt !== null && now - h.readAt < REMOTE_FRESH_MS;
}

export function dedupeRemote(rows: readonly RemoteConversation[]): RemoteConversation[] {
  const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set<string>();
  const out: RemoteConversation[] = [];
  for (const s of sorted) {
    const k = `${s.agent}:${s.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** 줄은 답의 것이 전부다(Rust 가 캐시 전체를 준다) */
export function applyReply(prev: RemoteHostState, r: RemoteConversationReply): RemoteHostState {
  return {
    ...prev,
    rows: dedupeRemote(r.sessions),
    progress: r.complete ? null : { done: r.done, total: r.total },
    error: null,
    offline: false,
    readAt: r.readAt,
    home: r.home ?? prev.home,
    complete: r.complete,
  };
}

// ---------------------------------------------------------------------------
// 기준 폴더 · 범위
// ---------------------------------------------------------------------------

function remoteKey(path: string, home: string | null): string {
  return pathKey(expandRemotePath(path, home));
}

export function sshScopeFolder(reported: string | null | undefined, startDir: string | null | undefined): {
  folder: string | null;
  source: "tile" | "start" | "none";
} {
  const r = reported?.trim() ?? "";
  if (r !== "") return { folder: r, source: "tile" };
  const s = startDir?.trim() ?? "";
  if (s !== "") return { folder: s, source: "start" };
  return { folder: null, source: "none" };
}

export function remoteHere(
  rows: readonly RemoteConversation[] | null,
  folder: string | null,
  home: string | null,
): RemoteConversation[] {
  if (!rows || folder === null) return [];
  const k = remoteKey(folder, home);
  if (k === "") return [];
  return rows.filter((s) => remoteKey(s.cwd, home) === k);
}

export function remoteScopeChips(hasFolder: boolean, here: number, all: number): ScopeChip[] {
  return hasFolder
    ? [
        { scope: "here", count: here },
        { scope: "host", count: all },
      ]
    : [{ scope: "host", count: all }];
}

export function minutesSince(readAt: number | null, now: number): number | null {
  if (readAt === null) return null;
  return Math.max(0, Math.floor((now - readAt) / 60_000));
}

// ---------------------------------------------------------------------------
// 재개 타일
// ---------------------------------------------------------------------------

export function remoteProjectFor(
  projects: readonly Project[],
  alias: string,
  cwd: string,
  home: string | null,
): Project | null {
  const want = alias.trim().toLowerCase();
  const k = remoteKey(cwd, home);
  let best: { p: Project; len: number } | null = null;
  for (const p of projects) {
    if (!p.host || p.host.trim().toLowerCase() !== want) continue;
    const pk = remoteKey(p.path, home);
    if (pk === "" || !(k === pk || k.startsWith(pk.endsWith("/") ? pk : `${pk}/`))) continue;
    if (!best || pk.length > best.len) best = { p, len: pk.length };
  }
  return best?.p ?? null;
}

/** MCP 토큰은 싣지 않는다 — 원격 타일은 신호 전용 토큰만(Rust 가 정한다) */
export function remoteConversationPane(
  alias: string,
  spec: { cwd: string; command: string },
  project: Project | null,
  scrollback?: number | null,
): PaneSpec {
  const pane = newSshPane(alias, scrollback);
  pane.cwd = spec.cwd;
  pane.autorun = spec.command;
  if (project) {
    if (project.tmux) pane.forceTmux = true;
    else pane.noTmux = true;
  }
  return pane;
}
