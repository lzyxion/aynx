/**
 * 메신저 알림을 보낼지 · 무엇을 적을지 정하는 순수 모듈 — 창 포커스 · 타일 가시성(OS 알림의 표)은 보지 않는다.
 * 여기 글자는 평문이다 — 채널 서식과 남의 글자 걷기는 Rust `messenger.rs` 의 `Channel::render` 한 층이 맡는다.
 * 명령 줄은 `include_command` 를 켠 사람에게만 — 비밀이 든 인자가 메신저 서버로 갈 수 있다.
 * 대화에서 나온 글자는 프런트를 지나지 않는다 — 대화의 가리킴만 넘기고 Rust 가 대화 파일에서 읽어 붙인다.
 */

import { blockOutcomeLabel, formatDuration, shortCommand, type Tr } from "$lib/finish-notify";

export type MessengerKind =
  | "agent-stop"
  | "agent-permission"
  | "command-finish"
  | "osc"
  | "operation-result"
  | "operation-pending"
  | "orchestration";

/** 표시 · 낱말은 Rust `messenger.rs` 의 `Grade` 가 그린다 */
export type MessengerGrade = "action" | "done" | "failed";

export const AGENT_STOP_MIN_MS = 60_000;

export const MESSENGER_COALESCE_MS = 30_000;

/** 표는 Rust `orchestration/notice.rs` 의 `messenger_grade` 와 같아야 한다(창이 없으면 세션 서버가 보낸다) */
export function noticeGrade(kind: string): MessengerGrade | null {
  switch (kind) {
    case "verify-approval":
    case "verify-needs-human":
    case "worker-blocked":
    case "auto-merge-stopped":
    case "repo-identity-changed":
    case "commit-rejected":
    case "limit":
    case "coordinator-exited":
      return "action";
    case "run-ended":
      return "done";
    case "verify-failed":
    case "spawn-failed":
    case "worker-exited":
    case "reviewer-exited":
      return "failed";
    default:
      return null;
  }
}

export function commandGrade(exit: number | null): MessengerGrade {
  return typeof exit === "number" && exit !== 0 ? "failed" : "done";
}

export function operationGrade(tone: "good" | "bad" | "plain"): MessengerGrade | null {
  return tone === "good" ? "done" : tone === "bad" ? "failed" : null;
}

export function createCoalesceGate(windowMs = MESSENGER_COALESCE_MS): (key: string, kind: string, now: number) => boolean {
  const last = new Map<string, number>();
  return (key, kind, now) => {
    const k = `${key}\u0000${kind}`;
    const at = last.get(k);
    if (at !== undefined && now - at < windowMs) return false;
    last.set(k, now);
    if (last.size > 200) {
      for (const [x, t] of last) if (now - t >= windowMs) last.delete(x);
    }
    return true;
  };
}

/** 메신저 다리의 타일 이름표 — 서버 대체 이름(`messenger_bridge/logic.rs` 의 `fallback_label`)과 같은 꼴이어야 한다 */
export function bridgeLabelText(agent: string | null, scope: string | null, folder: string | null): string {
  const range = scope?.trim()
    ? scope.split(" · ").join(" / ")
    : (folder ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop()?.trim() || null;
  return [agent?.trim() || null, range].filter((x): x is string => !!x).join(" · ");
}

/** `settings.toml` 의 `[messenger] when` 값 — 글자 그대로 남는다, 바꾸지 않는다 */
export type MessengerWhen = "away" | "always";

export const MESSENGER_WHENS = {
  away: "settings.messenger.when.away",
  always: "settings.messenger.when.always",
} as const;

export const DEFAULT_MESSENGER_WHEN: MessengerWhen = "away";
export const DEFAULT_MESSENGER_COMMAND_MIN_SECS = 300;
export const DEFAULT_MESSENGER_AWAY_AFTER_MIN = 5;
/** Rust `settings/normalize.rs` 의 `MAX_IDLE_LOCK_MIN` 과 같은 값 */
export const MESSENGER_AWAY_MAX_MIN = 240;

export interface MessengerRules {
  when: MessengerWhen;
  agentStop: boolean;
  agentPermission: boolean;
  /** `0` = 긴 명령은 보내지 않는다 */
  commandMinSecs: number;
  osc: boolean;
  operationResults: boolean;
  operationPending: boolean;
  includeSummary: boolean;
  includeCommand: boolean;
  includeConversation: boolean;
  /** `0` = 입력 시계는 보지 않는다 (가림막만) */
  awayAfterMin: number;
  discord: boolean;
  slack: boolean;
  telegram: boolean;
  /** 메신저에서 AI 타일에 말하기 — 보내기 규칙이 아니다. 세션 서버가 글마다 설정 파일을 다시 읽고, 원격 창은 켜지 못한다(`remote/deny.rs`) */
  telegramChat: boolean;
  discordChat: boolean;
  slackChat: boolean;
}

/** `settings.toml` 의 `[messenger]` 칸 — Rust `MessengerPrefs` 와 1:1 */
export interface MessengerPrefsRaw {
  when?: string | null;
  agent_stop?: boolean | null;
  agent_permission?: boolean | null;
  command_min_secs?: number | null;
  osc?: boolean | null;
  operation_results?: boolean | null;
  operation_pending?: boolean | null;
  include_summary?: boolean | null;
  include_command?: boolean | null;
  include_conversation?: boolean | null;
  away_after_min?: number | null;
  discord?: boolean | null;
  slack?: boolean | null;
  telegram?: boolean | null;
  telegram_chat?: boolean | null;
  discord_chat?: boolean | null;
  slack_chat?: boolean | null;
}

export function resolveMessengerRules(raw: MessengerPrefsRaw | undefined): MessengerRules {
  const r = raw ?? {};
  return {
    when: r.when === "always" || r.when === "away" ? r.when : DEFAULT_MESSENGER_WHEN,
    agentStop: r.agent_stop ?? true,
    agentPermission: r.agent_permission ?? true,
    commandMinSecs: r.command_min_secs ?? DEFAULT_MESSENGER_COMMAND_MIN_SECS,
    osc: r.osc ?? true,
    operationResults: r.operation_results ?? true,
    operationPending: r.operation_pending ?? true,
    includeSummary: r.include_summary ?? true,
    includeCommand: r.include_command ?? false,
    // Rust `messenger_include_conversation` 과 같은 기본값
    includeConversation: r.include_conversation ?? true,
    awayAfterMin: r.away_after_min ?? DEFAULT_MESSENGER_AWAY_AFTER_MIN,
    discord: r.discord ?? true,
    slack: r.slack ?? true,
    telegram: r.telegram ?? true,
    telegramChat: r.telegram_chat ?? false,
    discordChat: r.discord_chat ?? false,
    slackChat: r.slack_chat ?? false,
  };
}

/** Rust `messenger::Channel` 의 소문자 이름 · `[messenger] <채널>` 칸 이름과 같다 */
export type MessengerChannel = "discord" | "slack" | "telegram";

export const MESSENGER_CHANNELS: readonly MessengerChannel[] = ["discord", "slack", "telegram"];

/** 등록 여부는 Rust 가 본다 — 프런트는 등록 상태를 들고 다니지 않는다 */
export function messengerChannels(rules: Pick<MessengerRules, MessengerChannel>): MessengerChannel[] {
  return MESSENGER_CHANNELS.filter((c) => rules[c]);
}

export interface MessengerFacts {
  veiled: boolean;
  idleMs: number;
  /** 모르면 `null` — 그때는 거르지 않는다 */
  durationMs?: number | null;
}

export function isAway(rules: Pick<MessengerRules, "awayAfterMin">, facts: MessengerFacts): boolean {
  if (facts.veiled) return true;
  const min = rules.awayAfterMin;
  return Number.isFinite(min) && min > 0 && facts.idleMs >= min * 60_000;
}

export function shouldSendMessenger(kind: MessengerKind, rules: MessengerRules, facts: MessengerFacts): boolean {
  if (messengerChannels(rules).length === 0) return false;
  switch (kind) {
    case "agent-stop": {
      if (!rules.agentStop) return false;
      const ms = facts.durationMs;
      if (typeof ms === "number" && Number.isFinite(ms) && ms < AGENT_STOP_MIN_MS) return false;
      break;
    }
    case "orchestration":
      break;
    case "agent-permission":
      if (!rules.agentPermission) return false;
      break;
    case "osc":
      if (!rules.osc) return false;
      break;
    case "operation-result":
      if (!rules.operationResults) return false;
      break;
    case "operation-pending":
      if (!rules.operationPending) return false;
      break;
    case "command-finish": {
      const min = rules.commandMinSecs;
      const ms = facts.durationMs;
      if (!Number.isFinite(min) || min <= 0) return false;
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < min * 1000) return false;
      break;
    }
  }
  return rules.when === "always" || isAway(rules, facts);
}

// ── 문구 ──

/** `messenger_send` 의 `message` — 전부 평문이다(서식은 Rust 의 채널이 입힌다) */
export interface MessengerMessage {
  app: string;
  label: string;
  event: string;
  second: string;
  grade?: MessengerGrade | null;
}

export function agentEvent(kind: "stop" | "permission", agent: string | null, tr: Tr): string {
  const who = agent || tr("app.agent.name.generic");
  return tr(`app.agent.${kind}.body`, { agent: who });
}

export interface AgentTurnStats {
  turnMs: number | null;
  /** `0` 도 뺀다 — `tool-done` 훅이 없는 에이전트일 수 있다 */
  tools: number | null;
  files: number | null;
}

export function agentStatsLine(stats: AgentTurnStats, tr: Tr): string {
  const parts: string[] = [];
  const { turnMs, tools, files } = stats;
  if (typeof turnMs === "number" && Number.isFinite(turnMs) && turnMs > 0) parts.push(formatDuration(turnMs, tr));
  if (typeof tools === "number" && Number.isFinite(tools) && tools > 0) {
    parts.push(tools === 1 ? tr("app.messenger.tools.one") : tr("app.messenger.tools", { n: tools }));
  }
  if (typeof files === "number" && Number.isFinite(files) && files >= 0) {
    parts.push(
      files === 0
        ? tr("app.messenger.files.none")
        : files === 1
          ? tr("app.messenger.files.one")
          : tr("app.messenger.files", { n: files }),
    );
  }
  return parts.join(" · ");
}

/** 줄 꼴은 Rust `git_change_snapshot` 의 `"<XY>\t<mtime>\t<경로>"` 와 맞춘다 */
export function changedFilesBetween(before: readonly string[] | null, after: readonly string[] | null): number | null {
  if (!before || !after) return null;
  const a = new Set(before);
  const b = new Set(after);
  const paths = new Set<string>();
  const pathOf = (line: string) => line.slice(line.indexOf("\t", line.indexOf("\t") + 1) + 1);
  for (const l of a) if (!b.has(l)) paths.add(pathOf(l));
  for (const l of b) if (!a.has(l)) paths.add(pathOf(l));
  return paths.size;
}

export interface CommandFinishEventInput {
  commandLine: string;
  durationMs: number;
  exit: number | null;
  /** 거짓이면 명령 줄은 한 글자도 싣지 않는다 */
  includeCommand: boolean;
}

export function commandFinishEvent(input: CommandFinishEventInput, tr: Tr): string {
  const { toast } = blockOutcomeLabel({ durationMs: input.durationMs, exit: input.exit }, tr);
  const command = input.includeCommand ? shortCommand(input.commandLine) : "";
  if (command === "") return tr("app.messenger.command", { outcome: toast });
  return tr("pane.block.notify", { command, outcome: toast });
}

export function oscEvent(text: string, tr: Tr): string {
  return tr("app.messenger.osc", { text });
}
