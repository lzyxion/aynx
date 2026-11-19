import { agentNotifyMessage, shouldNotifyAgentStop, type AgentNotifyKind } from "$lib/agent-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { aiDisplayName } from "$lib/pane-icons";
import { sessionStreamOf, type PaneSpec } from "$lib/session";
import { settings } from "$lib/settings.svelte.js";
import { focusedPane } from "$lib/app/tabs.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { pushAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { messengerAgent, messengerBotLabel } from "$lib/app/messenger";
import { bridgeLabel, messengerLabel, scopeOf, tileLabel } from "$lib/app/messenger-label";
import { type AgentLink } from "$lib/agent-sessions";
import { type TurnCount } from "$lib/app/agent-turn";
import { agentAlertGroup } from "$lib/dock-alert-groups";

/**
 * **에이전트(Claude Code · Codex) 턴이 끝났다 · 권한을 묻는다** — 어디에 알릴지 정하고 실제로 띄운다
 * (docs/log/2026-09-25-agent-stop-notify.md · docs/log/2026-09-25-shell-claude-signals.md ·
 * docs/log/2026-09-27-agent-banners.md).
 *
 * 규칙(설정 · 창 포커스 · 포커스된 타일의 표)은 순수 모듈 `$lib/agent-notify` 에 있고, 여기
 * 있는 것은 그 규칙이 필요로 하는 **바깥 사실**과 부작용뿐이다 — `app/finish-notify.ts` 와 같은
 * 나눔이다. 부르는 자리는 `app/agent-status.svelte.ts` 의 `agentSignal` 하나(훅 `stop` · 범주가
 * `permission` 인 `waiting` — 가르는 것은 순수 층의 `agentNotifyKind`)이고,
 * 이벤트는 모든 창에 방송되지만 그 타일을 쥔 창만 여기까지 온다 — 알림은 **한 번** 뜬다.
 *
 * ## 표면 — 토스트가 아니라 배너 (2026-09-27)
 *
 * 창 안 표면은 오른쪽 위 토스트(8초)가 아니라 **창 위 가운데의 에이전트 배너**다
 * (`AgentNotifyBanners.svelte` · `app/agent-banners.svelte.ts`) — 사람이 그 타일을 보거나 에이전트가
 * 넘어갈 때까지 남는다. 창이 앞에 없으면(`"os"`) OS 알림을 쏘고 **배너 항목도 만든다** — 돌아왔을 때
 * 그 자리에 있게. 그래서 OS 알림이 못 나가도(권한 거절) 따로 되돌아갈 곳이 필요 없다.
 * 지난 알림 기록도 배너 저장소가 쥔다(해결되면 "지난 알림" 으로) — 일반 기록(`recordNotification`)에는
 * 적지 않는다.
 */

// 이름표(`tileLabel` · `scopeOf` · `messengerLabel`)는 `app/messenger-label` 에 산다 — 긴 명령 알림도 같은 이름을 쓴다(2026-11-16).

/** 메신저 둘째 줄 · 대화 가리킴의 재료 — `agentSignal` 이 모아 온다 */
export interface AgentNotifyExtra extends TurnCount {
  /** 이 타일의 대화(훅이 실어 온 id) — 켠 사람에게만 Rust 가 제목·발췌를 붙인다 */
  conversation: AgentLink | null;
}

/**
 * 에이전트 타일 하나의 턴이 끝났다(`"stop"`) · 권한을 묻는다(`"permission"`) — 알릴 것이 없으면
 * 아무 일도 하지 않는다. 표면을 고르는 표는 둘이 **같다**(그 타일을 보고 있으면 턴이 길었을 때만 배너 ·
 * 창이 앞이면 배너 · 아니면 OS + 배너). 다른 것은 켬/끔 설정과 문구뿐이다. `logo` 는 그 타일의 에이전트 로고 이름
 * (`agentKindOf` — `"claude"`·`"codex"`, 모르면 `null` → 문구가 일반 이름으로 떨어진다). `turnMs` 는 이번 턴이
 * 이 신호까지 걸린 시간(모르면 `null` — 부르는 쪽 `agentSignal` 이 `turnStarted` 로 잰다).
 *
 * `"focused"`(보고 있는 타일 · 긴 턴)는 배너만 세운다 — 창이 앞에 있으니 OS 알림은 없다. 그 항목은
 * `bornFocused` 로 서서 "그 타일로 갔다" 로 풀리지 않고, 사람이 그 타일을 만질 때 풀린다
 * (docs/log/2026-09-27-agent-banners.md "보고 있는 타일도").
 */
export function notifyAgent(
  pane: PaneSpec,
  kind: AgentNotifyKind,
  logo: string | null,
  turnMs: number | null = null,
  extra: AgentNotifyExtra | null = null,
): void {
  const agent = logo ? aiDisplayName(logo) : null;
  const name = tileLabel(pane);
  const label = messengerLabel(pane);
  // 메신저 다리(Telegram · Discord 봇)의 이름표 — 보내기 판정과 무관하게 로컬 AI 타일의 신호마다. 알림의 이름과 다르다(`<CLI> · <범위>` — `bridgeLabel`)
  if (pane.kind === "local") messengerBotLabel(sessionStreamOf(pane), bridgeLabel(pane, agent));
  // 메신저(Discord) — 아래 표면 판정과 **독립**이다(제 켬/끔 · 자리 비움 표). docs/log/2026-09-27-discord-notify.md
  messengerAgent({
    paneId: pane.id,
    stream: sessionStreamOf(pane),
    label,
    kind,
    agent,
    turnMs,
    tools: extra?.tools ?? null,
    files: extra?.files ?? null,
    conversation: extra?.conversation ?? null,
  });

  const where = shouldNotifyAgentStop({
    enabled: kind === "permission" ? settings.notifyPermission : settings.notifyTurnEnd,
    windowFocused: windowFocused(),
    focusedTile: focusedPane()?.id === pane.id,
    turnMs,
    focusedAfterMs: settings.notifyFocusedAfterSecs * 1000,
  });
  if (where === "none") return;

  const msg = agentNotifyMessage(kind, name, t, agent);
  pushAgentBanner({
    paneId: pane.id,
    kind,
    agent,
    logo,
    label: name,
    text: msg.toast,
    short: msg.body,
    bornFocused: where === "focused",
    // 지난 알림 묶음 — 같은 AI + 같은 범위(없으면 호스트 · 타일). 알린 순간 정한다
    group: agentAlertGroup({
      paneId: pane.id,
      host: pane.kind === "ssh" ? pane.alias || null : null,
      tileLabel: name,
      logo,
      scope: scopeOf(pane),
    }),
  });
  if (where === "os") void notifyOs(`${APP} · ${name}`, msg.body).catch(() => {});
}
