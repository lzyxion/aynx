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
 * 에이전트 턴 끝 · 권한 물음을 띄운다 — 이벤트는 모든 창에 방송되지만 그 타일을 쥔 창만 여기까지 와 알림은 한 번 뜬다.
 * 창이 앞에 없어 OS 알림을 쏠 때도 배너 항목을 만든다 — 돌아왔을 때 남아 있게. 일반 기록(`recordNotification`)에는 적지 않는다.
 */

export interface AgentNotifyExtra extends TurnCount {
  /** 켠 사람에게만 Rust 가 제목 · 발췌를 붙인다 */
  conversation: AgentLink | null;
}

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
  if (pane.kind === "local") messengerBotLabel(sessionStreamOf(pane), bridgeLabel(pane, agent));
  // 메신저는 아래 표면 판정과 독립이다(제 켬/끔 · 자리 비움 표)
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
    // 묶음은 알린 순간 정한다
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
