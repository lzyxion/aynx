import { invoke } from "./ipc";
import { relativeTime } from "$lib/history-search";
import type { Tr } from "$lib/session";
import type { TooltipRect } from "$lib/tooltip";

/**
 * **연결 상태 한 장** — 타일 머리줄의 이름에 걸리는 말풍선
 * (docs/log/2026-09-17-connect-diagnostics.md).
 *
 * ```text
 * web-01 — deploy@10.0.0.9:22
 * 인증: 키 (~/.ssh/id_ed25519) · 경유: bastion
 * 서버: OpenSSH_9.6 · 접속 12분 전 · 지연 38ms
 * ```
 *
 * 첫 줄은 **이 모듈이 만들지 않는다** — 머리줄이 이미 호스트 항목에서 알고 있는 사실이라
 * (`pane.header.title.host`), 여기서 다시 만들면 둘이 어긋난다. 이 파일이 만드는 것은
 * 아래 두 줄이다.
 *
 * 문구는 **인자로** 들어온다 (`forward.ts` 와 같은 규칙) — vitest 가 그대로 돌리는 순수
 * 모듈이라 룬 모듈(`i18n.svelte.ts`)을 값으로 들일 수 없다.
 */

/** Rust `ssh::SessionInfo` 와 1:1 (snake_case 유지) */
export interface SessionInfo {
  /** 서버 배너 (`OpenSSH_9.6p1 …`). 못 읽었으면 빈 문자열 */
  server_version: string;
  /**
   * Rust `AuthMethod` 와 같은 글자. `key_file` 은 2026-09-19 에 늘었다 — 앱이 `IdentityFile`
   * 을 그 자리에서 읽어 서명한 경우다(에이전트가 먼저인 것은 그대로라, 이 값이 보이면
   * "에이전트에 없는 키로 붙었다" 는 뜻이다).
   */
  auth_method: "agent" | "key_file" | "password" | "password_vault" | "none";
  /**
   * 키 설명 — 에이전트면 그 코멘트, 파일 키면 **경로**(`~` 표기).
   * **키 바이트도 암호구도 비밀번호도 아니다.**
   */
  identity: string | null;
  /**
   * 그 키 파일을 **금고에 담긴 암호구로** 열었는가 (2026-09-19 ② ·
   * docs/log/2026-09-19-vault.md). 값이 아니라 **출처**만 말한다 — 말풍선은 "(저장됨)"
   * 한 마디를 덧붙일 뿐이다. 옛 백엔드에는 없던 칸이라 없으면 거짓으로 읽는다.
   */
  identity_stored?: boolean;
  jump: string | null;
  connected_at_ms: number;
  keepalive_secs: number | null;
  /** 물어본 그 순간 잰 왕복 시간 (ms). 못 쟀으면 `null` — 0 과 다르다 */
  rtt_ms: number | null;
  /**
   * **같은 연결을 쓰는 다른 타일 수** (혼자면 0) — 연결 공유
   * (docs/log/2026-09-23-ssh-connection-sharing.md). 옛 백엔드에는 없던 칸이라 없으면 0.
   */
  shared_with?: number;
  /**
   * **같은 연결을 빌린 쿼리 타일의 DB 연결 수**(쿼리 타일 9단계) — 타일이 아니라 [`shared_with`] 에서 빠졌고 카드가 줄 하나로
   * 따로 보인다(0 이면 없다). 옛 백엔드에는 없던 칸이라 없으면 0.
   */
  db_conns?: number;
  /**
   * **이미 서 있던 연결에 얹혔다.** 위의 `auth_method`·`identity` 는 그 연결을 세운
   * 인증이라, 말풍선이 그 줄 앞에 한 마디를 붙여 출처를 밝힌다.
   */
  joined?: boolean;
  /**
   * **이 세션이 에이전트 포워딩을 청했다** (docs/log/2026-09-23-agent-forwarding.md).
   * 옛 백엔드에는 없던 칸이라 없으면 거짓으로 읽는다.
   */
  agent_forward?: boolean;
}

/** 살아 있는 SSH 세션 하나의 연결 상태를 묻는다 (RTT 는 이 호출이 그 자리에서 잰다) */
export async function fetchSessionInfo(sessionId: number): Promise<SessionInfo> {
  return await invoke<SessionInfo>("session_info", { id: sessionId });
}

/** `agent`·`password`·`none` → 사람이 읽는 한 마디 */
function authLabel(method: SessionInfo["auth_method"], tr: Tr): string {
  switch (method) {
    case "agent":
      return tr("pane.header.info.auth.key");
    case "key_file":
      return tr("pane.header.info.auth.key_file");
    case "password":
      return tr("pane.header.info.auth.password");
    // 금고에서 꺼낸 비밀번호로 붙었다 — 사람이 방금 친 것과 **다른 사실**이라 다른 말을
    // 쓴다 ("왜 안 묻지?" 의 답이 여기 있어야 한다).
    case "password_vault":
      return tr("pane.header.info.auth.password_vault");
    default:
      return tr("pane.header.info.auth.none");
  }
}

/**
 * 말풍선의 **둘째·셋째 줄**을 만든다 — 값이 없는 칸은 줄에서 통째로 빠진다.
 *
 * `·` 로 잇는 조각들이지 문장이 아니라서, 사전은 조각 하나씩 쥔다(어순을 타지 않는다).
 * `now` 를 인자로 받는 것은 테스트 때문이다 — "12분 전" 은 시계에 기대는 값이다.
 *
 * **keepalive 는 꺼져 있을 때만 적는다.** 30초라는 기본값을 늘 적으면 셋째 줄만 길어지고
 * 아무도 안 읽지만, "꺼져 있다" 는 사실은 끊김을 몇 분씩 모르고 지나는 이유가 된다.
 */
export function sessionInfoLines(info: SessionInfo, tr: Tr, now: number): string[] {
  const method = authLabel(info.auth_method, tr);
  // 키 파일을 **금고의 암호구로** 열었으면 그 사실을 한 마디로 덧붙인다 — 그래야
  // "암호구가 걸린 키인데 왜 안 물었지" 의 답이 같은 줄에 있다.
  const identityLine = info.identity_stored
    ? "pane.header.info.auth.with_identity.stored"
    : "pane.header.info.auth.with_identity";
  const auth = info.identity
    ? tr(identityLine, { method, identity: info.identity })
    : tr("pane.header.info.auth", { method });
  const second = [
    // **얹혀 붙은 타일**은 자기가 인증한 것이 아니다 — 위의 한 줄은 이 연결을 세운
    // 타일의 인증이므로, 그 사실을 같은 줄 앞머리에서 밝힌다 ("왜 안 물었지?" 의 답).
    info.joined ? tr("pane.header.info.auth.joined", { auth }) : auth,
    ...(info.jump ? [tr("pane.header.info.jump", { jump: info.jump })] : []),
    // 인증과 같은 축이다 — "이 연결로 내 에이전트가 무엇을 할 수 있나". 켰을 때만 적는다.
    ...(info.agent_forward ? [tr("pane.header.info.agent_forward")] : []),
  ];
  const third = [
    ...(info.server_version ? [tr("pane.header.info.server", { version: info.server_version })] : []),
    tr("pane.header.info.connected", { ago: relativeTime(info.connected_at_ms, now, tr) }),
    ...(info.rtt_ms !== null ? [tr("pane.header.info.rtt", { ms: info.rtt_ms })] : []),
    ...(info.keepalive_secs === null ? [tr("pane.header.info.keepalive.off")] : []),
  ];
  // 연결 공유는 **줄 하나**를 따로 받는다 — 둘째 줄에 `·` 로 매달면 인증 조각과 섞여
  // "이 연결이 몇 타일의 것인가" 라는 다른 축의 사실이 묻힌다 (혼자면 아예 없다).
  const shared =
    (info.shared_with ?? 0) > 0
      ? [tr("pane.header.info.shared", { n: info.shared_with as number })]
      : [];
  const dbs = (info.db_conns ?? 0) > 0 ? [tr("pane.header.info.db", { n: info.db_conns as number })] : [];
  return [second.join(" · "), third.join(" · "), ...shared, ...dbs];
}

// ── 연결 상태 카드 (docs/log/2026-09-28-tile-header-tooltips.md "SSH 이름 카드") ──────────
//
// 위의 `sessionInfoLines` 는 `·` 로 이은 **글자 두세 줄**이다 — 접근성 설명(스크린 리더)이 그대로 쓴다.
// 눈으로 읽는 카드는 같은 사실을 **라벨 | 값** 두 칸 격자로 편다. 사실은 같고 자르는 모양만 다르다.

/**
 * 지연이 이만큼(ms) 이상이면 값을 경고색으로 칠한다. 대화형 셸에서 타이핑 되울림이 눈에 띄게 늦어지기
 * 시작하는 어림값이다 — 정밀한 경계가 아니라 "여기부터는 느리다" 는 표시다.
 */
export const RTT_WARN_MS = 300;

/** 카드의 한 줄 — `tone` 이 `"warn"` 이면 값을 경고색으로 쓴다 */
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
    // 쿼리 타일(10-14 — `query/info-card`)
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

/**
 * 떠 있는 카드 한 장에 필요한 전부 — 머리줄(`PaneHeader`)이 짓고, 타일 상자 **밖**에서 `PaneHost` 가 그린다
 * (`SessionInfoCard.svelte`). 상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일에 덮인다.
 */
export interface SessionCardView {
  /** 보이는 이름 (`displayName`) */
  name: string;
  /** 타일 코드(`p3` · `t7·p2`) — 이름 줄 끝에 흐리게. 칩은 ✦ 타일에서만 서므로 SSH 타일은 여기서 코드를 본다 */
  code: string;
  /** `user@host:port` (`hostLabel`) — 모르면 빈 글자 */
  address: string;
  /** 호스트 색 — 없으면 `null` */
  color: string | null;
  /** 이름 앞 아이콘(`HostIcon` 값 — 쿼리 타일의 엔진 로고, 10-14). 없으면 점(`color`)이 그 자리다 */
  icon?: string | null;
  card: InfoCard;
  /** 이름 칸의 상자 (뷰포트 좌표) */
  anchor: TooltipRect;
}

/** 카드의 몸통 — 격자 줄들 + 맨 아래 경고 한 줄씩(지금은 keepalive 꺼짐 하나뿐) */
export interface InfoCard {
  rows: InfoRow[];
  warnings: string[];
}

/** 줄 열쇠 → 왼쪽 칸 라벨의 사전 키 */
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

/**
 * 카드의 줄을 만든다 — 값이 없는 줄은 통째로 빠진다(경유·공유·포워딩은 해당할 때만, 서버는 배너를
 * 읽었을 때만, 지연은 쟀을 때만). 줄 순서: 인증 · 경유 · 접속 · 지연 · 서버 · 공유 · 포워딩.
 *
 * keepalive 는 줄이 아니다 — 켜져 있으면 말할 것이 없고, **꺼져 있을 때만** 맨 아래 경고 한 줄로 선다
 * (`sessionInfoLines` 와 같은 판단).
 */
export function sessionInfoCard(info: SessionInfo, tr: Tr, now: number): InfoCard {
  const method = authLabel(info.auth_method, tr);
  let auth = info.identity ? tr("pane.header.info.card.auth.identity", { method, identity: info.identity }) : method;
  if (info.identity_stored) auth = tr("pane.header.info.card.auth.stored", { auth });
  // 얹혀 붙은 타일 — 이 인증은 연결을 세운 타일의 것이다 (`header.info.auth.joined` 와 같은 뜻).
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
  // 같은 연결을 빌린 쿼리 타일의 DB 연결 — 타일이 아니라 공유 줄과 따로(9단계).
  if ((info.db_conns ?? 0) > 0) push("db", tr("pane.header.info.card.db.value", { n: info.db_conns as number }));
  if (info.agent_forward) push("forward", tr("pane.header.info.card.forward.agent"));

  const warnings = info.keepalive_secs === null ? [tr("pane.header.info.keepalive.off")] : [];
  return { rows, warnings };
}

/**
 * **로컬 터미널 타일의 이름 카드** 몸통 (2026-10-11) — SSH 카드와 같은 판(`SessionInfoCard.svelte`)에 싣는다.
 * 머리(이름 + 타일 코드)는 같고, 원격 전용 줄(주소 · 인증 · 접속 · 지연 …)은 없다. 앱이 이미 아는 것만 싣는다:
 *
 * - `셸` 줄(셸 이름) — 늘. 머리줄 이름이 셸이 바꾼 창 제목이거나 AI CLI 이름("Claude Code")일 때 "어느 셸 위에서
 *   도는가" 를 여기서 본다. AI 이름 줄은 두지 않는다 — 카드 머리 이름과 같은 말이 겹쳤다(2026-10-11 실기 캡처).
 * - 작업 폴더(셸이 알려 준 지금 폴더 → 시작 폴더) — 모르면 줄이 없다.
 */
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

/** 카드 한 줄 — 라벨은 줄 열쇠의 사전 키(다른 판의 카드 · `query/info-card` 가 함께 쓴다) */
export function infoRow(key: InfoRow["key"], value: string, tr: Tr, tone: InfoRow["tone"] = "normal"): InfoRow {
  return { key, label: tr(CARD_LABEL[key]), value, tone };
}

/** 카드 한 장을 **접근성 설명 글자**로 — 머리 한 줄(`이름 · p3`) 뒤에 `라벨: 값` 한 줄씩 */
export function infoCardText(head: string, card: InfoCard): string {
  return [head, ...card.rows.map((r) => `${r.label}: ${r.value}`), ...card.warnings].join("\n");
}
