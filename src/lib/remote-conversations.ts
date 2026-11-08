/**
 * **원격 지난 대화** — 순수 규칙 (docs/log/2026-09-27-remote-conversations.md).
 *
 * SSH 로 붙은 서버에 남은 Claude Code · Codex 대화를 로컬과 같은 두 자리(프로젝트 시작 화면 · 이 폴더의 지난 대화)에
 * 보이는 판정들이다: 줄 모양 · 캐시가 아직 싱싱한가 · 기준 폴더(SSH 타일의 지금 폴더) · 범위(이 폴더 / 그 서버 전체) ·
 * 재개 타일의 명세. 읽기는 Rust `agent_sessions_remote.rs`(살아 있는 세션의 exec — 새 접속 없음), 저장소는
 * `app/remote-conversations.svelte.ts`.
 *
 * 제목은 사용자 글자일 수 있어(첫 프롬프트) 화면으로만 간다 — 저장 · 로그 · MCP 어디에도 싣지 않는다.
 */
import { pathKey, type AgentConversation } from "$lib/agent-sessions";
import { expandRemotePath, type Project } from "$lib/projects";
import type { ScopeChip } from "$lib/folder-conversations";
import { newSshPane, type PaneSpec } from "$lib/session";

/** 원격 대화 한 줄 — Rust `RemoteSession`(로컬 줄의 칸 + 호스트 · 토큰) */
export interface RemoteConversation extends AgentConversation {
  /** 그 세션이 붙은 별칭 */
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
  /** 목록을 뽑은 때(이 PC 의 epoch ms) */
  readAt: number;
  /** 서버의 `$HOME` — `~/…` 를 편다 */
  home: string | null;
}

/** 원격 줄인가 — 두 화면이 같은 줄 모양을 받으므로 호스트 칸으로 가른다 */
export function isRemoteConversation(s: AgentConversation): s is RemoteConversation {
  return typeof (s as Partial<RemoteConversation>).host === "string";
}

/** 호스트 하나의 읽은 상태 — 저장소가 별칭마다 하나 든다 */
export interface RemoteHostState {
  /** 읽은 줄(최신순 · 같은 대화 한 번) — 아직 한 번도 못 읽었으면 `null` */
  rows: RemoteConversation[] | null;
  loading: boolean;
  /** 읽는 중의 진행 — "(12 / 31)" */
  progress: { done: number; total: number } | null;
  /** 마지막 읽기의 실패(짧은 한 줄) */
  error: string | null;
  /** 그 호스트에 붙은 타일 세션이 이 창에 없다 — 읽지 않았다(새 접속을 열지 않는다) */
  offline: boolean;
  /** 마지막으로 다 읽은 때(목록을 뽑은 때 · 이 PC 의 epoch ms) */
  readAt: number | null;
  home: string | null;
  /** 마지막 읽기가 끝까지 갔나 */
  complete: boolean;
}

export function emptyRemoteHost(): RemoteHostState {
  return { rows: null, loading: false, progress: null, error: null, offline: false, readAt: null, home: null, complete: false };
}

/**
 * 캐시를 다시 쓰는 시간 — 같은 호스트를 1분 안에 다시 열면 읽지 않는다(Rust 도 같은 시간 동안 목록을 다시 뽑지 않는다).
 * 고르는 목록의 F5 는 이것을 건너뛴다.
 */
export const REMOTE_FRESH_MS = 60_000;

/** 다시 읽지 않아도 되나 — 끝까지 읽었고 실패가 없고 1분이 안 지났다 */
export function remoteFresh(h: RemoteHostState, now: number): boolean {
  return h.rows !== null && h.complete && h.error === null && h.readAt !== null && now - h.readAt < REMOTE_FRESH_MS;
}

/** 같은 대화(에이전트 · id)는 한 번 — 가장 최근 것이 남는다. 최신순 */
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

/** 답 하나를 상태에 얹는다 — 줄은 답의 것이 전부다(Rust 가 캐시 전체를 준다). 끝났으면 읽은 시각이 선다 */
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

/** 원격 경로 둘을 맞댄다 — `~` 는 서버의 홈으로 펴고 끝 `/` 를 뗀다 */
function remoteKey(path: string, home: string | null): string {
  return pathKey(expandRemotePath(path, home));
}

/**
 * **SSH 타일의 기준 폴더** — 셸이 알려 준 폴더(OSC 7 — 서버에 셸 통합이 있을 때) → 그 타일의 시작 폴더(원격 프로젝트 ·
 * 재개가 연 타일의 `cwd`) → 없음(그 서버 전체).
 */
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

/** 그 폴더에서 시작한 대화 — 로컬의 `conversationsInFolder` 와 같은 규칙(같은 폴더만 · 하위 폴더는 아니다) */
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

/** 원격 범위 칩 — 기준 폴더가 있으면 "이 폴더 · N" 과 "<호스트> 전체 · M", 없으면 "<호스트> 전체" 하나 */
export function remoteScopeChips(hasFolder: boolean, here: number, all: number): ScopeChip[] {
  return hasFolder
    ? [
        { scope: "here", count: here },
        { scope: "host", count: all },
      ]
    : [{ scope: "host", count: all }];
}

/** "N분 전에 읽음" 의 N — 1분이 안 됐으면 0 */
export function minutesSince(readAt: number | null, now: number): number | null {
  if (readAt === null) return null;
  return Math.max(0, Math.floor((now - readAt) / 60_000));
}

// ---------------------------------------------------------------------------
// 재개 타일
// ---------------------------------------------------------------------------

/** 그 폴더를 품은 **가장 깊은** 원격 프로젝트(같은 별칭 · 대소문자 무시) — tmux 토글을 물려받는다 */
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

/**
 * 재개 · 새 대화로 계속이 여는 **SSH 타일** — 그 별칭(공유 전송로에 얹힌다), 대화의 폴더(`cwd`)에서 Rust 가 지은 명령
 * (`autorun` — 원격 프로젝트가 명령을 돌리는 그 길: 첫 입력 한 줄). tmux 는 그 폴더를 품은 원격 프로젝트의 토글을 따르고,
 * 프로젝트 밖이면 호스트 설정 그대로다. MCP 토큰은 싣지 않는다(원격 타일은 신호 전용 토큰만 — Rust 가 정한다).
 */
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
