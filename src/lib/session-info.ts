import { invoke } from "./ipc";
import { relativeTime } from "$lib/history-search";
import type { Tr } from "$lib/session";
import type { TooltipRect } from "$lib/tooltip";

/**
 * 타일 머리줄 이름의 연결 상태 말풍선 · 카드. 첫 줄(호스트 주소)은 이 모듈이 만들지 않는다 — 머리줄이 이미 아는 사실이라
 * 여기서 다시 만들면 둘이 어긋난다. 문구는 인자로 들어온다 — vitest 가 돌리는 순수 모듈이라 룬 모듈을 값으로 들일 수 없다.
 */

/** Rust `ssh::SessionInfo` 와 1:1 (snake_case 유지) — `?` 칸은 옛 백엔드에 없다(없으면 거짓 · 0) */
export interface SessionInfo {
  server_version: string;
  /** Rust `AuthMethod` 와 같은 글자 */
  auth_method: "agent" | "key_file" | "password" | "password_vault" | "none";
  /** 키 설명(에이전트 코멘트 · 파일 키는 경로) — 키 바이트도 암호구도 비밀번호도 아니다 */
  identity: string | null;
  /** 값이 아니라 출처만 말한다 — 그 키 파일을 금고에 담긴 암호구로 열었는가 */
  identity_stored?: boolean;
  jump: string | null;
  connected_at_ms: number;
  keepalive_secs: number | null;
  /** 못 쟀으면 `null` — 0 과 다르다 */
  rtt_ms: number | null;
  shared_with?: number;
  /** 같은 연결을 빌린 쿼리 타일의 DB 연결 수 — 타일이 아니라 [`shared_with`] 에서 빠졌다 */
  db_conns?: number;
  /** 이미 서 있던 연결에 얹혔다 — `auth_method` · `identity` 는 그 연결을 세운 인증이다 */
  joined?: boolean;
  agent_forward?: boolean;
}

export async function fetchSessionInfo(sessionId: number): Promise<SessionInfo> {
  return await invoke<SessionInfo>("session_info", { id: sessionId });
}

function authLabel(method: SessionInfo["auth_method"], tr: Tr): string {
  switch (method) {
    case "agent":
      return tr("pane.header.info.auth.key");
    case "key_file":
      return tr("pane.header.info.auth.key_file");
    case "password":
      return tr("pane.header.info.auth.password");
    case "password_vault":
      return tr("pane.header.info.auth.password_vault");
    default:
      return tr("pane.header.info.auth.none");
  }
}

/** keepalive 는 꺼져 있을 때만 적는다 — 꺼져 있다는 사실이 끊김을 몇 분씩 모르고 지나는 이유가 된다 */
export function sessionInfoLines(info: SessionInfo, tr: Tr, now: number): string[] {
  const method = authLabel(info.auth_method, tr);
  const identityLine = info.identity_stored
    ? "pane.header.info.auth.with_identity.stored"
    : "pane.header.info.auth.with_identity";
  const auth = info.identity
    ? tr(identityLine, { method, identity: info.identity })
    : tr("pane.header.info.auth", { method });
  const second = [
    info.joined ? tr("pane.header.info.auth.joined", { auth }) : auth,
    ...(info.jump ? [tr("pane.header.info.jump", { jump: info.jump })] : []),
    ...(info.agent_forward ? [tr("pane.header.info.agent_forward")] : []),
  ];
  const third = [
    ...(info.server_version ? [tr("pane.header.info.server", { version: info.server_version })] : []),
    tr("pane.header.info.connected", { ago: relativeTime(info.connected_at_ms, now, tr) }),
    ...(info.rtt_ms !== null ? [tr("pane.header.info.rtt", { ms: info.rtt_ms })] : []),
    ...(info.keepalive_secs === null ? [tr("pane.header.info.keepalive.off")] : []),
  ];
  const shared =
    (info.shared_with ?? 0) > 0
      ? [tr("pane.header.info.shared", { n: info.shared_with as number })]
      : [];
  const dbs = (info.db_conns ?? 0) > 0 ? [tr("pane.header.info.db", { n: info.db_conns as number })] : [];
  return [second.join(" · "), third.join(" · "), ...shared, ...dbs];
}

// ── 연결 상태 카드 ──

/** 어림값이다 — 정밀한 경계가 아니라 "여기부터는 느리다" 는 표시 */
export const RTT_WARN_MS = 300;

export interface InfoRow {
  key:
    | "auth"
    | "jump"
    | "connected"
    | "rtt"
    | "server"
    | "shared"
    | "db"
    | "forward"
    | "agent"
    | "shell"
    | "folder"
    | "state"
    | "engine"
    | "conn"
    | "database"
    | "tls"
    | "mode"
    | "ai";
  label: string;
  value: string;
  tone: "normal" | "warn";
}

/** 타일 상자 밖에서 `PaneHost` 가 그린다 — 상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일에 덮인다 */
export interface SessionCardView {
  name: string;
  code: string;
  address: string;
  color: string | null;
  icon?: string | null;
  card: InfoCard;
  /** 뷰포트 좌표 */
  anchor: TooltipRect;
}

export interface InfoCard {
  rows: InfoRow[];
  warnings: string[];
}

const CARD_LABEL = {
  auth: "pane.header.info.card.auth",
  jump: "pane.header.info.card.jump",
  connected: "pane.header.info.card.connected",
  rtt: "pane.header.info.card.rtt",
  server: "pane.header.info.card.server",
  shared: "pane.header.info.card.shared",
  db: "pane.header.info.card.db",
  forward: "pane.header.info.card.forward",
  agent: "pane.header.info.card.agent",
  shell: "pane.header.info.card.shell",
  folder: "pane.header.info.card.folder",
  state: "pane.header.info.card.state",
  engine: "pane.header.info.card.engine",
  conn: "pane.header.info.card.conn",
  database: "pane.header.info.card.database",
  tls: "pane.header.info.card.tls",
  mode: "pane.header.info.card.mode",
  ai: "pane.header.info.card.ai",
} as const satisfies Record<InfoRow["key"], Parameters<Tr>[0]>;

export function sessionInfoCard(info: SessionInfo, tr: Tr, now: number): InfoCard {
  const method = authLabel(info.auth_method, tr);
  let auth = info.identity ? tr("pane.header.info.card.auth.identity", { method, identity: info.identity }) : method;
  if (info.identity_stored) auth = tr("pane.header.info.card.auth.stored", { auth });
  if (info.joined) auth = tr("pane.header.info.card.auth.joined", { auth });

  const rows: InfoRow[] = [];
  const push = (key: InfoRow["key"], value: string, tone: InfoRow["tone"] = "normal"): void => {
    rows.push({ key, label: tr(CARD_LABEL[key]), value, tone });
  };
  push("auth", auth);
  if (info.jump) push("jump", info.jump);
  push("connected", relativeTime(info.connected_at_ms, now, tr));
  if (info.rtt_ms !== null) {
    push("rtt", tr("pane.header.info.card.rtt.value", { ms: info.rtt_ms }), info.rtt_ms >= RTT_WARN_MS ? "warn" : "normal");
  }
  if (info.server_version) push("server", info.server_version);
  if ((info.shared_with ?? 0) > 0) {
    push("shared", tr("pane.header.info.card.shared.value", { n: info.shared_with as number }));
  }
  if ((info.db_conns ?? 0) > 0) push("db", tr("pane.header.info.card.db.value", { n: info.db_conns as number }));
  if (info.agent_forward) push("forward", tr("pane.header.info.card.forward.agent"));

  const warnings = info.keepalive_secs === null ? [tr("pane.header.info.keepalive.off")] : [];
  return { rows, warnings };
}

/** AI 이름 줄은 두지 않는다 — 카드 머리 이름과 같은 말이 겹친다 */
export function localInfoCard(
  facts: { ai: string | null; shell: string; folder: string | null },
  tr: Tr,
): InfoCard {
  const rows: InfoRow[] = [];
  const push = (key: InfoRow["key"], value: string): void => {
    rows.push({ key, label: tr(CARD_LABEL[key]), value, tone: "normal" });
  };
  push("shell", facts.shell);
  if (facts.folder !== null) push("folder", facts.folder);
  return { rows, warnings: [] };
}

export function infoRow(key: InfoRow["key"], value: string, tr: Tr, tone: InfoRow["tone"] = "normal"): InfoRow {
  return { key, label: tr(CARD_LABEL[key]), value, tone };
}

export function infoCardText(head: string, card: InfoCard): string {
  return [head, ...card.rows.map((r) => `${r.label}: ${r.value}`), ...card.warnings].join("\n");
}
