import { invoke } from "../ipc";
import {
  agentEvent,
  agentStatsLine,
  commandFinishEvent,
  commandGrade,
  createCoalesceGate,
  messengerChannels,
  noticeGrade,
  operationGrade,
  oscEvent,
  shouldSendMessenger,
  type MessengerFacts,
  type MessengerGrade,
  type MessengerKind,
  type MessengerMessage,
} from "$lib/messenger-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { veilVisible } from "$lib/app/veil.svelte.js";
import { msSinceLastInput } from "$lib/app/idle-lock.svelte.js";
import { APP_TITLE } from "$lib/app/instance";
import type { RunOutcome } from "$lib/operation-notify";
import { noticeText, type OrchNotice } from "$lib/orchestration/model";

/** 보내기는 기다리지 않고 실패는 콘솔 한 줄이다 — 자리를 비운 사이 쌓인 실패 토스트는 돌아온 사람에게 잡음이다 */

export async function messengerConnected(): Promise<boolean> {
  const results = await Promise.all(
    messengerChannels(settings.messenger).map((channel) =>
      invoke<{ configured: boolean }>("messenger_status", { channel }).then((s) => s.configured, () => false),
    ),
  );
  return results.includes(true);
}

function facts(extra?: Pick<MessengerFacts, "durationMs">): MessengerFacts {
  return { veiled: veilVisible(), idleMs: msSinceLastInput(), ...extra };
}

/** 글자가 아니다 — Rust 가 대화 파일에서 읽어 붙인다(`messenger.rs`) */
interface ConversationRef {
  agent: string;
  id: string;
  event: "stop" | "permission";
}

/**
 * `stream` 은 서버의 `agent_state` 표 · 세션 op 와 같은 열쇠다(답장이 그 타일로 간다). `kind` 는 다리가 시작한 턴의 같은 알림을 서버가 한 번만
 * 보내게 한다. 웹훅은 둘을 보지 않는다.
 */
export interface MessengerOrigin {
  stream: string | null;
  kind?: "stop" | "permission";
}

function post(
  label: string,
  event: string,
  second = "",
  conversation: ConversationRef | null = null,
  grade: MessengerGrade | null = null,
  origin: MessengerOrigin | null = null,
): void {
  const channels = messengerChannels(settings.messenger);
  if (channels.length === 0) return;
  const message: MessengerMessage = { app: APP_TITLE, label, event, second, grade };
  const stream = origin?.stream ?? null;
  const kind = origin?.kind ?? null;
  invoke("messenger_send", { message, conversation, channels, stream, kind }).catch((e: unknown) => {
    console.warn("[messenger] 보내지 못했습니다:", e);
  });
}

function send(
  kind: MessengerKind,
  tileName: string,
  event: () => string,
  extra?: Pick<MessengerFacts, "durationMs">,
  grade: MessengerGrade | null = null,
  second: () => string = () => "",
  origin: MessengerOrigin | null = null,
): void {
  if (!shouldSendMessenger(kind, settings.messenger, facts(extra))) return;
  post(tileName, event(), second(), null, grade, origin);
}

const coalesce = createCoalesceGate();

export interface MessengerAgentInput {
  paneId: string;
  stream: string;
  label: string;
  kind: "stop" | "permission";
  agent: string | null;
  turnMs: number | null;
  tools: number | null;
  files: (() => Promise<number | null>) | null;
  conversation: { agent: string; id: string } | null;
}

/** 규칙은 사건 순간에 판정하고 파일 수는 그 뒤에 잰다(못 재면 빼고 그대로 보낸다) */
export function messengerAgent(input: MessengerAgentInput): void {
  const { kind, agent } = input;
  const extra = kind === "stop" ? { durationMs: input.turnMs } : undefined;
  if (!shouldSendMessenger(kind === "stop" ? "agent-stop" : "agent-permission", settings.messenger, facts(extra))) return;
  if (!coalesce(input.paneId, kind, Date.now())) return;
  const event = agentEvent(kind, agent, t);
  const conversation: ConversationRef | null =
    settings.messenger.includeConversation && input.conversation
      ? { agent: input.conversation.agent, id: input.conversation.id, event: kind }
      : null;
  const measure = input.files;
  void (async () => {
    const files = measure ? await measure().catch(() => null) : null;
    const second = agentStatsLine({ turnMs: input.turnMs, tools: input.tools, files }, t);
    post(input.label, event, second, conversation, kind === "permission" ? "action" : "done", { stream: input.stream, kind });
  })();
}

/** 알림 판정과 무관하게 신호마다 부른다 — 마지막 값을 기억해 건너뛰면 서버가 다시 떠 표가 비었을 때 다시 알릴 길이 없다 */
export function messengerBotLabel(stream: string, label: string): void {
  const m = settings.messenger;
  if (!(m.telegramChat || m.discordChat || m.slackChat) || !stream || !label.trim()) return;
  invoke("messenger_bot_label", { stream, label }).catch(() => {});
}

export function messengerCommandFinish(
  label: string,
  block: { commandLine: string; durationMs: number; exit: number | null },
  stream: string | null = null,
): void {
  send(
    "command-finish",
    label,
    () => commandFinishEvent({ ...block, includeCommand: settings.messenger.includeCommand }, t),
    { durationMs: block.durationMs },
    commandGrade(block.exit),
    undefined,
    { stream },
  );
}

export function messengerProgramNotice(tileName: string, text: string, fromAgent: boolean, stream: string | null = null): void {
  // AI 타일의 프로그램 알림은 턴 끝 · 권한 물음과 같은 순간 두 통이 되므로 보내지 않는다.
  if (fromAgent) return;
  send("osc", tileName, () => oscEvent(text, t), undefined, null, undefined, { stream });
}

/**
 * 글은 짓지 않고 id 만 넘긴다 — Rust 가 아직 사람을 기다리는지 다시 보고 짓는다(`operations/notify.rs` `pending_message`). 승인 단추 · 링크는 어느 채널에도 없다.
 */
export function messengerOperationPending(operationId: string): void {
  if (!shouldSendMessenger("operation-pending", settings.messenger, facts())) return;
  const channels = messengerChannels(settings.messenger);
  if (channels.length === 0) return;
  setTimeout(() => {
    const message: MessengerMessage = { app: APP_TITLE, label: "", event: "", second: "" };
    invoke("messenger_send", { message, conversation: null, channels, operation: operationId }).catch((e: unknown) => {
      console.warn("[messenger] 승인 대기를 보내지 못했습니다:", e);
    });
  }, PENDING_GRACE_MS);
}

/** 서버의 자동 승인 훑기(2초 — `operations/auto.rs`)가 지나갈 만큼 — Rust `notify::PENDING_GRACE` 와 같은 값 */
export const PENDING_GRACE_MS = 5_000;

/** 앱 창이 없을 때는 같은 칸(`[messenger] operation_results`)을 보고 Rust 가 보낸다 */
export function messengerOperationResult(
  outcome: Pick<RunOutcome, "headline" | "auto" | "approveAll" | "result" | "details" | "duration" | "tone">,
): void {
  const name = outcome.headline.trim();
  const label = name ? t("app.messenger.plan", { name }) : t("app.messenger.plan.none");
  send(
    "operation-result",
    label,
    () => {
      const head = outcome.approveAll ? `${t("app.opnotify.all")} · ` : outcome.auto ? `${t("app.opnotify.auto")} · ` : "";
      return `${head}${outcome.result}`;
    },
    undefined,
    operationGrade(outcome.tone),
    () => [...outcome.details, ...(outcome.duration ? [outcome.duration] : [])].join(" · "),
  );
}

/** 창이 없을 때 일어난 사건은 세션 서버가 이미 보냈다(`server/ai.rs`) — 꺼내 보이기(`drain`)에서는 부르지 않는다 */
export function messengerOrchNotice(n: OrchNotice): void {
  const grade = noticeGrade(n.kind);
  if (grade === null) return;
  const name = n.runName?.trim() ?? "";
  const label = name ? t("app.messenger.album", { name }) : t("app.messenger.album.none");
  send(
    "orchestration",
    label,
    () => {
      const text = noticeText(n, t);
      const pre = `${t("orch.notice.prefix", { run: n.runName })} — `;
      return text.startsWith(pre) ? text.slice(pre.length) : text;
    },
    undefined,
    grade,
  );
}
