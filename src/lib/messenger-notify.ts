/**
 * **메신저 알림을 보낼 것인가 · 무엇을 적을 것인가** — 순수 모듈
 * (docs/log/2026-09-27-discord-notify.md · docs/log/2026-09-28-messenger-channels.md).
 *
 * OS 알림 옆의 두 번째 **내보내는 곳**이다. OS 알림이 "창이 뒤에 있다" 를 맡는다면 이것은 "사람이 PC 앞을
 * 떠났다" 를 맡는다 — 그래서 창 포커스·타일 가시성 표(`$lib/finish-notify` · `$lib/agent-notify`)와
 * **독립**이다. 같은 사건(턴 끝 · 권한 물음 · 긴 명령 · 프로그램 알림)을 받되, 보낼지는 여기 표 하나가 정한다.
 *
 * 긴 명령 알림과 같은 나눔이다: 여기는 값을 받아 값을 주고, 사실을 모으고 실제로 보내는 쪽은
 * `app/messenger.ts` 다. 룬도 DOM 도 Tauri 도 없어 vitest 로 그대로 돈다(`messenger-notify.test.ts`).
 * 문구는 **`tr` 로 받는다**(사전을 들여오지 않는다 — `$lib/finish-notify` 머리말).
 *
 * ## 서식은 여기 없다 — 평문만 만든다 (2026-09-28)
 *
 * 여기서 만드는 글자(사건 한 토막 · 둘째 줄)는 **평문**이다 — 마크다운도 이스케이프도 없다. 알림 한 통은
 * `{ app, label, event, second }` 구조로 Rust 에 넘어가고, 채널마다의 서식(Discord 마크다운 등)과 남의 글자
 * 걷기(원격이 바꾼 타일 이름 · OSC 본문 · 명령 줄이 가린 링크를 만들지 못하게)는 Rust 한 층
 * (`src-tauri/src/messenger.rs` 의 `Channel::render`)이 맡는다. 그래서 이 모듈은 채널의 서식을 모른다 — 아는 것은
 * "어느 채널이 켜져 있는가"([`messengerChannels`]) 하나다. 사건 규칙은 채널이 **함께** 쓴다.
 *
 * ## 기본은 최소한만 싣는다
 *
 * 한 통은 `aynx · <탭/타일 이름>` 과 `<사건>` 이다. 끝난 명령의 **명령 줄**은 `include_command` 를 켠
 * 사람에게만 싣는다 — 명령 줄에는 비밀(토큰·암호가 든 인자)이 섞일 수 있고, 그 글자가 메신저 서버로 간다.
 * 프로그램 알림(OSC 9·777)의 본문은 싣는다: 프로그램이 **알림으로 쓰라고** 보낸 글자다(이미 다듬어져 온다 —
 * `$lib/osc-notify` 의 `sanitizeNotifyText`).
 *
 * ## 에이전트 알림의 둘째 줄 — 맥락이지 대화가 아니다 (2026-09-27 덧붙임)
 *
 * 에이전트 알림은 첫 줄의 이름을 **프로젝트 · 워크트리**로 적고(`app/agent-notify.ts` 의 `messengerLabel`), 둘째 줄에
 * `12분 30초 · 도구 23회 · 파일 4개 변경` 을 싣는다([`agentStatsLine`]) — 걸린 시간 · 이번 턴의 도구 사용
 * (훅 `tool-done` 수) · 이번 턴에 바뀐 파일 수(로컬 타일만 — 턴 시작과 끝의 git 도장을 견준다). 모르는 칸은 뺀다.
 * 전부 **대화 밖**의 사실이라 기본으로 싣는다.
 *
 * 대화에서 나온 글자(대화 제목 · 에이전트 마지막 답 앞부분 · 권한을 묻는 도구)는 `include_conversation` 을
 * 켠 사람에게만, 그리고 **프런트를 지나지 않는다** — 여기는 대화의 가리킴만 넘기고 Rust 가 대화 파일에서 읽어
 * 몸통에 붙인다(`src-tauri/src/messenger.rs`).
 */

import { blockOutcomeLabel, formatDuration, shortCommand, type Tr } from "$lib/finish-notify";

/** 보낼 만한 사건들 */
export type MessengerKind =
  | "agent-stop"
  | "agent-permission"
  | "command-finish"
  | "osc"
  | "operation-result"
  | "operation-pending";

/** 언제 보내나 — `settings.toml` 의 `[messenger] when` 값(키는 바꾸지 않는다) */
export type MessengerWhen = "away" | "always";

/** 후보 표 — 키는 저장 값, 값은 문구 키 (`TAB_STYLES` 와 같은 모양) */
export const MESSENGER_WHENS = {
  away: "settings.messenger.when.away",
  always: "settings.messenger.when.always",
} as const;

/** 기본값 — Rust `MessengerPrefs` 의 "안 정함" 이 가리키는 값 (그쪽은 보관만 한다) */
export const DEFAULT_MESSENGER_WHEN: MessengerWhen = "away";
/** 긴 명령의 기본 하한(초) — 5분. OS 알림(10초)보다 훨씬 길다: 폰에 울리는 것은 자리를 비울 만한 일뿐이어야 한다 */
export const DEFAULT_MESSENGER_COMMAND_MIN_SECS = 300;
/** 자리 비움으로 치는 기본 무입력 시간(분) */
export const DEFAULT_MESSENGER_AWAY_AFTER_MIN = 5;
/** 무입력 시간의 상한(분) — Rust 의 `MAX_IDLE_LOCK_MIN` 과 같은 값 */
export const MESSENGER_AWAY_MAX_MIN = 240;

/** 규칙이 보는 설정 — 기본값이 채워진 모양 ([`resolveMessengerRules`]) */
export interface MessengerRules {
  when: MessengerWhen;
  agentStop: boolean;
  agentPermission: boolean;
  /** `0` = 긴 명령은 보내지 않는다 */
  commandMinSecs: number;
  osc: boolean;
  /** 작업안 실행 결과(③-4 — 앱 창이 없을 때는 GUI·세션 서버의 Rust 가 같은 칸을 보고 보낸다) */
  operationResults: boolean;
  /**
   * 작업안 승인 대기(승인 요약 — docs/log/2026-10-21-approval-summary.md) — 글은 Rust 가 짓는다(`operations/notify.rs`
   * `pending_message` · 프런트는 작업안 id 만 넘긴다). 앱 창이 없을 때는 GUI · 세션 서버의 Rust 가 같은 칸을 보고 보낸다.
   */
  operationPending: boolean;
  /** 승인 대기 알림에 AI 가 쓴 설명을 싣는가 — 칸은 Rust 가 보낼 때 다시 읽는다 */
  includeSummary: boolean;
  includeCommand: boolean;
  /** 에이전트 알림에 대화 제목·마지막 답 앞부분을 싣는가 — 글자는 Rust 가 붙인다(머리말) */
  includeConversation: boolean;
  /** `0` = 입력 시계는 보지 않는다 (가림막만) */
  awayAfterMin: number;
  /** Discord 채널로 보내는가 (웹훅이 등록돼 있을 때) — 안 정하면 켬 */
  discord: boolean;
  /** Slack 채널로 보내는가 (웹훅이 등록돼 있을 때) — 안 정하면 켬 */
  slack: boolean;
}

/** `settings.toml` 의 `[messenger]` 한 칸씩 — 안 정한 칸은 `undefined` (Rust `MessengerPrefs` 와 1:1) */
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
}

/** 안 정한 칸에 기본값을 채운다 — 설정 화면과 규칙이 같은 값을 보게 */
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
    includeConversation: r.include_conversation ?? false,
    awayAfterMin: r.away_after_min ?? DEFAULT_MESSENGER_AWAY_AFTER_MIN,
    discord: r.discord ?? true,
    slack: r.slack ?? true,
  };
}

/** 보낼 수 있는 채널 — Rust `messenger::Channel` 의 소문자 이름. 칸 이름(`[messenger] <채널>`)과 같다 */
export type MessengerChannel = "discord" | "slack";

/** 채널 전부 — 화면·목록의 순서 */
export const MESSENGER_CHANNELS: readonly MessengerChannel[] = ["discord", "slack"];

/**
 * 켜진 채널 목록 — `messenger_send` 의 `channels`. 비면 부르지 않는다. 등록 여부는 Rust 가 본다(등록 안 된
 * 채널은 거기서 조용히 건너뛴다) — 프런트는 등록 상태를 들고 다니지 않는다.
 */
export function messengerChannels(rules: Pick<MessengerRules, MessengerChannel>): MessengerChannel[] {
  return MESSENGER_CHANNELS.filter((c) => rules[c]);
}

/** 부르는 쪽이 모아 오는 바깥 사실 */
export interface MessengerFacts {
  /** 이 창에 가림막이 걸려 있는가 (`app/veil` 의 `veilVisible()`) */
  veiled: boolean;
  /** 이 창에서 마지막 입력 뒤 지난 시간(ms) (`app/idle-lock` 의 `msSinceLastInput()`) */
  idleMs: number;
  /** 긴 명령만 — 그 명령이 걸린 시간(ms) */
  durationMs?: number | null;
}

/**
 * 사람이 자리를 비웠나 — **가림막이 걸렸거나** 입력이 `awayAfterMin` 분 넘게 없었다.
 *
 * 가림막은 무입력 자동 잠금(`[app] idle_lock_min`)이든 손으로 건 `Ctrl+Shift+B` 든 "자리를 비운다" 는
 * 뜻이다. 입력 시계는 자동 잠금과 **같은 시계**다(`app/idle-lock`) — 잠금을 꺼 둔 사람도 자리 비움은 판정된다.
 */
export function isAway(rules: Pick<MessengerRules, "awayAfterMin">, facts: MessengerFacts): boolean {
  if (facts.veiled) return true;
  const min = rules.awayAfterMin;
  return Number.isFinite(min) && min > 0 && facts.idleMs >= min * 60_000;
}

/**
 * 사건 하나를 보낼 것인가 — **표 하나가 전부**다.
 *
 * | 조건 | 결과 |
 * | --- | --- |
 * | 켜진 채널 없음 | 안 보낸다 |
 * | 그 사건의 칸이 꺼짐 (긴 명령은 하한 `0` · 하한 미만) | 안 보낸다 |
 * | `when = always` | 보낸다 |
 * | `when = away` · 자리를 비웠다 ([`isAway`]) | 보낸다 |
 * | `when = away` · 자리에 있다 | 안 보낸다 — 화면·OS 알림이 이미 말한다 |
 *
 * 창 포커스·타일 가시성은 **보지 않는다** — 그것은 OS 알림의 표다. 긴 명령의 하한도 제 칸
 * (`command_min_secs`)이지 OS 알림의 `notify_after_secs` 가 아니다. 하한은 **넘거나 같으면** 친다(`>=`).
 */
export function shouldSendMessenger(kind: MessengerKind, rules: MessengerRules, facts: MessengerFacts): boolean {
  if (messengerChannels(rules).length === 0) return false;
  switch (kind) {
    case "agent-stop":
      if (!rules.agentStop) return false;
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

// ---------------------------------------------------------------------------
// 문구
// ---------------------------------------------------------------------------

/** 알림 한 통 — `messenger_send` 의 `message`. 전부 **평문**이다(서식은 Rust 의 채널이 입힌다 · 머리말) */
export interface MessengerMessage {
  /** 앱 이름(창 제목) */
  app: string;
  /** 탭·타일 이름 또는 프로젝트 · 워크트리 */
  label: string;
  /** 사건 한 토막 — 아래 `*Event` 함수들이 만든다 */
  event: string;
  /** 둘째 줄 — 없으면 빈 글자 */
  second: string;
}

/** 에이전트 턴 끝 · 권한 물음 — OS 알림 본문과 같은 낱말(`app.agent.*.body`) */
export function agentEvent(kind: "stop" | "permission", agent: string | null, tr: Tr): string {
  const who = agent || tr("app.agent.name.generic");
  return tr(`app.agent.${kind}.body`, { agent: who });
}

/** 에이전트 알림 둘째 줄의 재료 — 모르는 칸은 `null` (그 토막을 뺀다) */
export interface AgentTurnStats {
  /** 이번 턴이 이 신호까지 걸린 시간(ms) — 훅 `start` 를 못 봤으면 `null` */
  turnMs: number | null;
  /** 이번 턴의 도구 사용 수(훅 `tool-done`) — `start` 를 못 봤으면 `null`, `0` 도 뺀다(그 훅이 없는 에이전트일 수 있다) */
  tools: number | null;
  /** 이번 턴에 바뀐 파일 수 — 로컬 git 폴더에서만, 못 쟀으면 `null` */
  files: number | null;
}

/**
 * 둘째 줄 — `12분 30초 · 도구 23회 · 파일 4개 변경`. 토막이 하나도 없으면 빈 글자(줄을 싣지 않는다).
 * 시간 문구는 거터 표식·토스트와 같은 [`formatDuration`] 이다.
 */
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

/**
 * 두 변경 도장(Rust `git_change_snapshot` — 줄 `"<XY>\t<mtime>\t<경로>"`)의 차이 = **그사이 바뀐 파일 수**.
 * 한쪽에만 있는 줄의 경로를 센다: 새로 더러워진 · 깨끗해진 · 다시 고친(mtime 이 바뀐) 파일이 한 번씩.
 * 어느 쪽이든 없으면 `null`(모름).
 */
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

/** [`commandFinishEvent`] 가 보는 것 */
export interface CommandFinishEventInput {
  commandLine: string;
  durationMs: number;
  exit: number | null;
  /** `[messenger] include_command` — 거짓이면 명령 줄은 한 글자도 싣지 않는다 */
  includeCommand: boolean;
}

/**
 * 끝난 명령 — 성패·걸린 시간은 거터 표식·토스트와 **같은 자리**(`blockOutcomeLabel`)에서 나온다.
 * 명령 줄은 `includeCommand` 일 때만(40자로 접는다 — 서식 걷기는 Rust 가).
 */
export function commandFinishEvent(input: CommandFinishEventInput, tr: Tr): string {
  const { toast } = blockOutcomeLabel({ durationMs: input.durationMs, exit: input.exit }, tr);
  const command = input.includeCommand ? shortCommand(input.commandLine) : "";
  if (command === "") return tr("app.messenger.command", { outcome: toast });
  return tr("pane.block.notify", { command, outcome: toast });
}

/** 프로그램 알림(OSC 9·777) — 본문은 이미 다듬어져 온다(`programNotifyText`) */
export function oscEvent(text: string, tr: Tr): string {
  return tr("app.messenger.osc", { text });
}
