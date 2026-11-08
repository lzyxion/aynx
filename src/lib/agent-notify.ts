/**
 * **에이전트(Claude Code · Codex) 턴이 끝났다 · 권한을 묻는다고 알릴 것인가** — 순수 모듈
 * (docs/log/2026-09-25-agent-stop-notify.md · docs/log/2026-09-25-shell-claude-signals.md ·
 * docs/log/2026-09-26-codex-hooks.md).
 *
 * 긴 명령 알림(`$lib/finish-notify`)과 같은 나눔이다: 여기는 값을 받아 값을 주고, 실제로
 * 토스트를 띄우고 OS 알림을 쏘는 쪽은 `app/agent-notify.ts` 다. 룬도 DOM 도 Tauri 도 없어
 * vitest 로 그대로 돈다(`agent-notify.test.ts`). 문구는 **`tr` 로 받는다**(사전을 들여오지 않는다).
 *
 * ## 무엇이 "끝남" 인가 — 훅 `stop` 하나
 *
 * 부르는 자리는 `app/agent-status.svelte.ts` 의 `agentSignal` 이고, 그중 **`stop`**(에이전트의
 * `Stop` 훅 — 턴이 끝나 프롬프트가 떴다)만 여기로 온다. 추정 신호(출력이 멎음·벨·제목)는 오지
 * 않는다 — 틀리면 알림이 거짓말을 한다.
 *
 * `waiting` 은 **범주가 `permission` 일 때만** 알린다([`agentNotifyKind`]). Claude Code 의 `Notification`
 * 훅은 `stop` 뒤 한참(약 60초) 입력이 없을 때도 울리는데(`idle`), 그것까지 받으면 한 턴에 알림이 두 번
 * 온다 — 훅 스크립트가 입력 JSON 의 `notification_type`(없으면 알림 문구)으로 범주 하나만 골라 싣는다
 * (`src-tauri/src/agent_hooks.rs` 2판). Codex 의 `PermissionRequest` 훅은 등록이 `permission` 을 인자로
 * 박는다(3판). 범주가 없는 옛 스크립트의 `waiting` 은 알리지 않는다.
 */

import type { Tr } from "$lib/finish-notify";

/**
 * 알림의 결말 네 갈래 (`$lib/finish-notify` 의 `FinishNotify` 와 같은 모양 + `"focused"`).
 *
 * - `"none"` — 알리지 않는다 (꺼 두었거나, 그 타일을 **지금 보고 있고** 턴이 짧았다).
 * - `"toast"` — 창 안 표면. 이 창을 보고 있지만 그 타일은 아니다. 이름은 역사다 — 2026-09-27 부터
 *   토스트가 아니라 위 가운데의 **에이전트 알림 배너**다(docs/log/2026-09-27-agent-banners.md).
 * - `"focused"` — **보고 있는 타일**인데 턴이 길었다(`[ai] notify_focused_after_secs`, 기본 60초). 포커스를
 *   둔 채 자리를 비웠을 수 있어 배너만 세운다 — 창이 앞에 있으니 OS 알림은 쏘지 않는다. 그 배너는 "그 타일로
 *   갔다" 로 풀리지 않고(이미 거기 있다) **그 타일을 만질 때** 풀린다(`$lib/agent-banners` 의 `bornFocused` ·
 *   docs/log/2026-09-27-agent-banners.md "보고 있는 타일도").
 * - `"os"` — OS 알림. 창이 앞에 없다. 부르는 쪽은 배너 항목도 함께 세운다(돌아왔을 때 남아 있게) —
 *   그래서 OS 알림이 못 나가도 되돌아갈 곳이 따로 필요 없다.
 */
export type AgentStopNotify = "none" | "toast" | "focused" | "os";

/** [`shouldNotifyAgentStop`] 이 보는 다섯 가지 */
export interface AgentStopNotifyInput {
  /** `[ai] notify_turn_end` (안 정했으면 켬) */
  enabled: boolean;
  /** 이 창이 지금 사람 앞에 있는가 (`app/os-notify` 의 `windowFocused()` — 최소화는 `false`) */
  windowFocused: boolean;
  /** 그 타일이 **이 창의 활성 탭에서 포커스된 타일**인가 (`app/tabs` 의 `focusedPane()`) */
  focusedTile: boolean;
  /**
   * 이번 턴이 걸린 시간(ms) — 훅 `start` 부터 이 신호(`stop` · 권한 물음)까지. 시작을 못 봤으면(새로 고침 뒤 ·
   * 옛 훅) `null` 이고, 그러면 보고 있는 타일은 알리지 않는다(길었는지 모른다).
   */
  turnMs: number | null;
  /** `[ai] notify_focused_after_secs` × 1000 — 보고 있는 타일도 알릴 턴 길이. `0` 이하 = 끔 */
  focusedAfterMs: number;
}

/**
 * 끝난 턴 하나를 무엇으로 알릴 것인가 — **표 하나가 전부**다.
 *
 * | 설정 | 창 포커스 | 포커스된 타일인가 | 결과 | 왜 |
 * | --- | --- | --- | --- | --- |
 * | 끔 | — | — | `none` | 사람이 껐다 |
 * | 켬 | 있다 | 그 타일 · 턴 ≥ 임계(임계 > 0) | `focused` | 포커스를 둔 채 자리를 비웠을 수 있다 — 배너만(OS 알림은 없다) |
 * | 켬 | 있다 | 그 타일 · 턴이 짧다 · 모른다 · 임계 0 | `none` | **화면이 이미 말했다** — 눈앞에서 프롬프트가 떴다 |
 * | 켬 | 있다 | 다른 타일·다른 탭 | `toast` | 이 창을 보고 있으니 창 안(배너)에서 말하면 읽힌다 |
 * | 켬 | 없다 | (무관) | `os` | 앱 안에만 띄워 봐야 지금은 아무도 못 본다 (배너 항목은 함께 선다) |
 *
 * 긴 명령 알림과 다른 점은 하나다: "보인다" 가 아니라 **포커스된 타일**을 본다 — 분할된 옆
 * 타일의 에이전트는 화면에 보여도 눈은 다른 데 있다(탭 점을 활성 탭에도 찍는 이유와 같다).
 *
 * 턴 끝(`stop`)과 권한 물음(`permission`)이 **같은 표**를 쓴다 — 권한 물음도 자리를 비운 사이에 오면 놓친다.
 * 권한 물음의 "턴 길이" 는 턴 시작부터 물음까지다(부르는 쪽이 같은 `turnStarted` 로 잰다).
 */
export function shouldNotifyAgentStop(input: AgentStopNotifyInput): AgentStopNotify {
  if (!input.enabled) return "none";
  if (!input.windowFocused) return "os";
  if (!input.focusedTile) return "toast";
  const long = input.focusedAfterMs > 0 && input.turnMs !== null && input.turnMs >= input.focusedAfterMs;
  return long ? "focused" : "none";
}

/** 알릴 만한 훅 신호 두 가지 — 턴 끝 · 권한 물음 */
export type AgentNotifyKind = "stop" | "permission";

/**
 * 훅 신호 하나(`agent-signal` 의 `event`·`detail`) → 알릴 종류. 알릴 것이 아니면 `null`.
 *
 * | event | detail | 결과 |
 * | --- | --- | --- |
 * | `stop` | — | `"stop"` (턴 끝) |
 * | `waiting` | `permission` | `"permission"` (권한 물음 — 사람이 답할 때까지 일이 멈춰 있다) |
 * | `waiting` | `idle` · `other` · 없음(옛 스크립트) | `null` — 점만 "입력 대기" |
 * | 그 밖 | — | `null` |
 */
export function agentNotifyKind(event: unknown, detail: unknown): AgentNotifyKind | null {
  if (event === "stop") return "stop";
  if (event === "waiting" && detail === "permission") return "permission";
  return null;
}

/** 알림 문구 — OS 알림은 제목에 타일 이름이 있어 본문만, 토스트는 이름까지 한 줄에 */
export interface AgentStopMessage {
  /** OS 알림 본문 (제목은 `aynx · <탭 제목>`) */
  body: string;
  /** 토스트 한 줄 — 제목이 없는 표면이라 타일 이름을 앞에 붙인다 */
  toast: string;
}

/** 끝난 턴의 문구 두 벌 — 같은 사실을 같은 낱말로 (`app.agent.stop.*`) */
export function agentStopMessage(tileName: string, tr: Tr, agent?: string | null): AgentStopMessage {
  return agentNotifyMessage("stop", tileName, tr, agent);
}

/**
 * 알릴 종류별 문구 두 벌 — `app.agent.stop.*` · `app.agent.permission.*`. `agent` 는 그 타일의 에이전트
 * 이름(`aiDisplayName` — "Claude Code"·"Codex")이고, 모르면 일반 이름(`app.agent.name.generic`)이다
 * (훅이 에이전트마다 붙으므로 문구가 한 에이전트를 가정하지 않는다 — docs/log/2026-09-26-codex-hooks.md).
 */
export function agentNotifyMessage(
  kind: AgentNotifyKind,
  tileName: string,
  tr: Tr,
  agent?: string | null,
): AgentStopMessage {
  const who = agent || tr("app.agent.name.generic");
  return {
    body: tr(`app.agent.${kind}.body`, { agent: who }),
    toast: tr(`app.agent.${kind}.toast`, { name: tileName, agent: who }),
  };
}
