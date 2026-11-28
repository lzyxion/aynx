// 채팅 타일 MCP 상태 보기의 순수 층 — 줄 거르기 · 낱말 → 문구 표 · 정렬 · 요약. 값 import 없음.
// 허용 목록: 이름 · 상태 낱말 · 인증 낱말 · 도구 수 · 출처 낱말 · Aynx 표 둘. 그 밖 칸(값 · URL · 머리글 · 명령 · 오류 글)은 받아도 버린다.
// 낱말은 아래 고정 표로만 옮긴다 — 모르는 값은 "unknown" · "other" · null(CLI 글을 그대로 싣지 않는다).

import type { Key } from "$lib/i18n/keys";
import type { McpRowView } from "$lib/side-chat-api";
import type { ChatTileMcpStatus } from "./chat-tile-api";

type McpState = McpRowView["state"];
type McpAuth = Exclude<McpRowView["auth"], null>;

const STATES: readonly McpState[] = ["connected", "connecting", "needsAuth", "failed", "disabled", "cancelled", "unknown"];
const AUTHS: readonly McpAuth[] = ["oauth", "bearer", "notLoggedIn", "none"];
const SCOPES: readonly string[] = ["user", "project", "local", "cloud", "plugin", "app", "config", "other"];
const NAME_MAX = 96;
const ROWS_MAX = 64;
const SOURCES: readonly string[] = ["init", "startup", "list"];

const STATE_KEY: Readonly<Record<McpState, Key>> = Object.freeze({
  connected: "pane.chatTile.mcp.state.connected",
  connecting: "pane.chatTile.mcp.state.connecting",
  needsAuth: "pane.chatTile.mcp.state.needsAuth",
  failed: "pane.chatTile.mcp.state.failed",
  disabled: "pane.chatTile.mcp.state.disabled",
  cancelled: "pane.chatTile.mcp.state.cancelled",
  unknown: "pane.chatTile.mcp.state.unknown",
});

const AUTH_KEY: Readonly<Record<McpAuth, Key>> = Object.freeze({
  oauth: "pane.chatTile.mcp.auth.oauth",
  bearer: "pane.chatTile.mcp.auth.bearer",
  notLoggedIn: "pane.chatTile.mcp.auth.notLoggedIn",
  none: "pane.chatTile.mcp.auth.none",
});

const SCOPE_KEY: Readonly<Record<string, Key>> = Object.freeze({
  user: "pane.chatTile.mcp.scope.user",
  project: "pane.chatTile.mcp.scope.project",
  local: "pane.chatTile.mcp.scope.local",
  cloud: "pane.chatTile.mcp.scope.cloud",
  plugin: "pane.chatTile.mcp.scope.plugin",
  app: "pane.chatTile.mcp.scope.app",
  config: "pane.chatTile.mcp.scope.config",
  other: "pane.chatTile.mcp.scope.other",
});

function pick<T extends string>(table: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (table as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** 한 줄을 허용 칸만으로 다시 짓는다 — 이름이 없으면 줄째 버린다 */
export function mcpRowOf(raw: unknown): McpRowView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, NAME_MAX) : "";
  if (name === "") return null;
  const tools = typeof r.tools === "number" && Number.isInteger(r.tools) && r.tools >= 0 ? r.tools : null;
  const out: McpRowView = {
    name,
    state: pick(STATES, r.state, "unknown"),
    auth: typeof r.auth === "string" && (AUTHS as readonly string[]).includes(r.auth) ? (r.auth as McpAuth) : null,
    tools,
    scope: pick(SCOPES, r.scope, "other"),
  };
  if (r.aynx === true) out.aynx = true;
  if (r.picked === true) out.picked = true;
  return out;
}

export function mcpRowsOf(raw: unknown): McpRowView[] {
  if (!Array.isArray(raw)) return [];
  const out: McpRowView[] = [];
  for (const x of raw) {
    const row = mcpRowOf(x);
    if (row) out.push(row);
    if (out.length >= ROWS_MAX) break;
  }
  return out;
}

/** 스냅숏 칸 — 모양이 틀리면 null */
export function mcpStatusOf(raw: unknown): ChatTileMcpStatus | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return { servers: mcpRowsOf(r.servers), source: pick(SOURCES, r.source, "list"), stale: r.stale === true };
}

/** 사건의 줄에는 `aynx` · `picked` 가 없다 — 앞 값의 같은 이름에서 물려받는다(다음 스냅숏이 고친다) */
export function mcpRowsInherit(rows: readonly McpRowView[], prev: readonly McpRowView[] | null): McpRowView[] {
  const before = new Map((prev ?? []).map((r) => [r.name, r]));
  return rows.map((r) => {
    const p = before.get(r.name);
    const out: McpRowView = { name: r.name, state: r.state, auth: r.auth, tools: r.tools, scope: r.scope };
    if (r.aynx ?? p?.aynx) out.aynx = true;
    if (r.picked ?? p?.picked) out.picked = true;
    return out;
  });
}

const RANK: Readonly<Record<McpState, number>> = Object.freeze({
  needsAuth: 1,
  failed: 1,
  connecting: 2,
  connected: 3,
  disabled: 4,
  cancelled: 4,
  unknown: 4,
});

/** 꺼져 있고 도구가 없는 줄 — 맨 뒤 · 흐리게 */
export function mcpRowIdle(r: McpRowView): boolean {
  return r.state === "disabled" && !r.tools;
}

/** 줄 순서: aynx → 문제(needsAuth · failed) → connecting → connected → 그 밖 → 꺼지고 도구 없는 줄 · 같은 무리는 이름 */
export function mcpRowsSorted(rows: readonly McpRowView[]): McpRowView[] {
  const rank = (r: McpRowView) => (r.aynx ? 0 : mcpRowIdle(r) ? 5 : (RANK[r.state] ?? 4));
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** 미터 풍선 한 줄 재료 — 줄이 없으면 null */
export function mcpSummary(rows: readonly McpRowView[]): { total: number; trouble: number; connecting: number } | null {
  if (rows.length === 0) return null;
  return {
    total: rows.length,
    trouble: rows.filter((r) => r.state === "needsAuth" || r.state === "failed").length,
    connecting: rows.filter((r) => r.state === "connecting").length,
  };
}

export function mcpStateKey(state: string): Key {
  return STATE_KEY[pick(STATES, state, "unknown")];
}

export function mcpAuthKey(auth: string | null): Key | null {
  return auth !== null && (AUTHS as readonly string[]).includes(auth) ? AUTH_KEY[auth as McpAuth] : null;
}

export function mcpScopeKey(scope: string): Key {
  return SCOPE_KEY[pick(SCOPES, scope, "other")];
}

/**
 * 로그인이 필요한 줄 — 밑에 "터미널 모양으로 열어 주세요"(`mcp.loginTerminal`) · 로그인은 채팅 모양에서 하지 않는다.
 * 연결된 줄은 인증 낱말이 "로그인 안 됨" 이어도 아니다(로그인 없이 붙는 서버).
 */
export function mcpNeedsLogin(r: McpRowView): boolean {
  return r.state === "needsAuth" || (r.state === "failed" && r.auth === "notLoggedIn");
}

/** 사람이 연 읽기의 진행 — 묻는 중 · 오래 걸림(Codex 는 몇 초 걸린다) · 시한 넘음 · 물을 길 없음(받은 것만) · CLI 가 읽기를 거절함 */
export type McpAsk = "asking" | "slow" | "timeout" | "lastTurn" | "failed";

/** 풍선의 흐린 줄 — 묻는 중(회전 표)은 null */
export function mcpAskKey(ask: McpAsk | null, stale: boolean): Key | null {
  switch (ask) {
    case "slow":
      return "pane.chatTile.mcp.slow";
    case "timeout":
      return "pane.chatTile.mcp.timeout";
    case "lastTurn":
      return "pane.chatTile.mcp.lastTurn";
    case "failed":
      return "pane.chatTile.mcp.failed";
    default:
      return ask === null && stale ? "pane.chatTile.mcp.stale" : null;
  }
}
