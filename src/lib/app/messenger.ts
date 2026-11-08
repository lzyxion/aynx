import { invoke } from "../ipc";
import {
  agentEvent,
  agentStatsLine,
  commandFinishEvent,
  messengerChannels,
  oscEvent,
  shouldSendMessenger,
  type MessengerFacts,
  type MessengerKind,
  type MessengerMessage,
} from "$lib/messenger-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { veilVisible } from "$lib/app/veil.svelte.js";
import { msSinceLastInput } from "$lib/app/idle-lock.svelte.js";
import { APP_TITLE } from "$lib/app/instance";
import type { RunOutcome } from "$lib/operation-notify";

/**
 * **메신저 알림을 보낸다** — 바깥 사실을 모으고 `messenger_send` 를 부른다
 * (docs/log/2026-09-27-discord-notify.md · docs/log/2026-09-28-messenger-channels.md).
 *
 * 규칙(보낼 것인가 · 무엇을 적을 것인가)은 순수 모듈 `$lib/messenger-notify` 에 있다. 여기 있는 것은
 * 그 규칙이 필요로 하는 **바깥 사실**(가림막 · 마지막 입력)과 부작용뿐이다 — `app/finish-notify.ts` 와 같은
 * 나눔이다. 넘기는 것은 **서식 없는 구조**(`{ app, label, event, second }`)와 켜진 채널 목록이고, 채널마다
 * 그리는 일은 Rust 가 한다(`src-tauri/src/messenger.rs`). 켜진 채널이 없으면 부르지 않는다.
 *
 * 부르는 자리는 셋이고, 전부 **기존 알림이 정해지는 바로 그 자리**다 — `app/agent-notify.ts`(턴 끝 · 권한
 * 물음) · `app/finish-notify.ts`(긴 명령) · `app/osc-notify.ts`(프로그램 알림). 창 포커스·타일 가시성 판정
 * **앞에서** 부르므로 OS 알림을 쏘든 말든 제 표대로 간다. 세 사건 모두 그 타일을 쥔 창에만 오므로 한 사건에
 * **한 번** 나간다.
 *
 * ## 기다리지 않는다 · 실패는 콘솔에만
 *
 * 보내기는 fire-and-forget 이다 — 알림 하나가 다른 일을 붙잡으면 안 된다. 실패(연결 오류 · 429)는
 * `console.warn` 한 줄이고 토스트를 세우지 않는다: 자리를 비운 사이에 쌓인 실패 토스트는 돌아온 사람에게
 * 잡음이다. 웹훅이 등록 안 된 채널은 백엔드가 조용히 건너뛴다. 확인은 설정 화면의 "테스트 보내기" 가 그
 * 자리에서 결과를 보여 준다. 오류 문구에 URL 은 없다(백엔드가 뗀다 — `src-tauri/src/messenger.rs`).
 */

/** 켜진 채널 가운데 웹훅이 등록된 것이 있는가 — 던지지 않는다(못 읽으면 없음) */
export async function messengerConnected(): Promise<boolean> {
  const results = await Promise.all(
    messengerChannels(settings.messenger).map((channel) =>
      invoke<{ configured: boolean }>("messenger_status", { channel }).then((s) => s.configured, () => false),
    ),
  );
  return results.includes(true);
}

/** 이 창의 지금 사실 — 가림막 · 마지막 입력 뒤 지난 시간 */
function facts(extra?: Pick<MessengerFacts, "durationMs">): MessengerFacts {
  return { veiled: veilVisible(), idleMs: msSinceLastInput(), ...extra };
}

/** `messenger_send` 의 대화 가리킴 — 글자가 아니다(Rust 가 대화 파일에서 읽어 붙인다 · `messenger.rs`) */
interface ConversationRef {
  agent: string;
  id: string;
  event: "stop" | "permission";
}

/** 켜진 채널로 보낸다 — 던지지 않는다. 켜진 채널이 없으면 부르지 않는다. 실패는 콘솔 한 줄 */
function post(label: string, event: string, second = "", conversation: ConversationRef | null = null): void {
  const channels = messengerChannels(settings.messenger);
  if (channels.length === 0) return;
  const message: MessengerMessage = { app: APP_TITLE, label, event, second };
  invoke("messenger_send", { message, conversation, channels }).catch((e: unknown) => {
    console.warn("[messenger] 보내지 못했습니다:", e);
  });
}

/** 규칙을 지나면 한 통을 보낸다 — 던지지 않는다 */
function send(kind: MessengerKind, tileName: string, event: () => string, extra?: Pick<MessengerFacts, "durationMs">): void {
  if (!shouldSendMessenger(kind, settings.messenger, facts(extra))) return;
  post(tileName, event());
}

/** [`messengerAgent`] 가 받는 것 — `app/agent-notify.ts` 가 모아 온다 */
export interface MessengerAgentInput {
  /** 첫 줄의 이름 — 프로젝트 · 워크트리(모르면 탭·타일 이름) */
  label: string;
  kind: "stop" | "permission";
  /** 에이전트 이름(모르면 `null`) */
  agent: string | null;
  /** 이번 턴이 이 신호까지 걸린 시간 */
  turnMs: number | null;
  /** 이번 턴의 도구 사용 수 */
  tools: number | null;
  /** 이번 턴에 바뀐 파일 수를 재는 함수(로컬 git 폴더만) — 보낼 때만 부른다 */
  files: (() => Promise<number | null>) | null;
  /** 이 타일의 대화 — `include_conversation` 일 때만 Rust 로 넘긴다 */
  conversation: { agent: string; id: string } | null;
}

/**
 * 에이전트 턴 끝(`"stop"`) · 권한 물음(`"permission"`) — 첫 줄 · 둘째 줄(`12분 30초 · 도구 23회 · 파일 4개 변경`)
 * · 켠 사람에게만 대화 가리킴. 규칙은 **사건 순간**에 판정하고, 파일 수는 그 뒤에 잰다(못 재면 뺀다 — 보내기는
 * 그대로 간다).
 */
export function messengerAgent(input: MessengerAgentInput): void {
  const { kind, agent } = input;
  if (!shouldSendMessenger(kind === "stop" ? "agent-stop" : "agent-permission", settings.messenger, facts())) return;
  const event = agentEvent(kind, agent, t);
  const conversation: ConversationRef | null =
    settings.messenger.includeConversation && input.conversation
      ? { agent: input.conversation.agent, id: input.conversation.id, event: kind }
      : null;
  const measure = input.files;
  void (async () => {
    const files = measure ? await measure().catch(() => null) : null;
    const second = agentStatsLine({ turnMs: input.turnMs, tools: input.tools, files }, t);
    post(input.label, event, second, conversation);
  })();
}

/** 끝난 명령 — 명령 줄은 `[messenger] include_command` 일 때만 실린다 */
export function messengerCommandFinish(
  tileName: string,
  block: { commandLine: string; durationMs: number; exit: number | null },
): void {
  send(
    "command-finish",
    tileName,
    () => commandFinishEvent({ ...block, includeCommand: settings.messenger.includeCommand }, t),
    { durationMs: block.durationMs },
  );
}

/** 프로그램 알림(OSC 9·777) — `text` 는 이미 다듬어진 본문(`programNotifyText`) */
export function messengerProgramNotice(tileName: string, text: string): void {
  send("osc", tileName, () => oscEvent(text, t));
}

/**
 * **작업안이 사람의 승인을 기다린다**(승인 요약 — docs/log/2026-10-21-approval-summary.md) — 규칙(켬 · 이 종류 · 자리 비움)은
 * **사건 순간**에 판정하고, 글은 짓지 않는다: 작업안 id 만 `messenger_send{operation}` 으로 넘기면 Rust 가 서버 목록에서 그 작업안이
 * **아직 사람을 기다리는지** 다시 보고(자동 승인 · 거절 · 만료로 떠났으면 보내지 않는다) 설정 파일의 칸(AI 설명 싣기 · 명령 줄 싣기)을
 * 다시 본 뒤 한 통을 짓는다(`operations/notify.rs` `pending_message`). 서버의 자동 승인 훑기(2초)가 지나가도록 [`PENDING_GRACE_MS`]
 * 뒤에 넘긴다. 승인 단추 · 링크는 어느 채널에도 없다.
 */
export function messengerOperationPending(operationId: string): void {
  if (!shouldSendMessenger("operation-pending", settings.messenger, facts())) return;
  const channels = messengerChannels(settings.messenger);
  if (channels.length === 0) return;
  setTimeout(() => {
    // `message` 는 앱 이름만 쓰인다 — 글은 Rust 가 짓는다(`messenger_send` 의 `operation`).
    const message: MessengerMessage = { app: APP_TITLE, label: "", event: "", second: "" };
    invoke("messenger_send", { message, conversation: null, channels, operation: operationId }).catch((e: unknown) => {
      console.warn("[messenger] 승인 대기를 보내지 못했습니다:", e);
    });
  }, PENDING_GRACE_MS);
}

/** 서버의 사전 정책 자동 승인 훑기(2초 — `operations/auto.rs`)가 지나갈 만큼 — Rust `notify::PENDING_GRACE` 와 같은 값 */
export const PENDING_GRACE_MS = 5_000;

/**
 * 작업안 실행이 끝났다(③-4) — 이름표는 그 실행의 머리줄(제목 · 명령문 전문이 아니다 — `headlineOf`), 사건은 결과 토막과
 * 곁 토막. 앱 창이 없을 때는 같은 칸(`[messenger] operation_results`)을 보고 Rust 가 보낸다(트레이 — GUI, GUI 없음 — 세션 서버).
 */
export function messengerOperationResult(
  outcome: Pick<RunOutcome, "headline" | "auto" | "approveAll" | "result" | "details" | "duration">,
): void {
  send("operation-result", outcome.headline, () => {
    const parts = [outcome.result, ...outcome.details, ...(outcome.duration ? [outcome.duration] : [])];
    const head = outcome.approveAll ? `${t("app.opnotify.all")} · ` : outcome.auto ? `${t("app.opnotify.auto")} · ` : "";
    return `${t("app.opnotify.title")} — ${head}${parts.join(" · ")}`;
  });
}
