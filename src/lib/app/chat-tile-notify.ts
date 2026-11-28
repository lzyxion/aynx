import type { SideChatEv } from "$lib/side-chat-api";
import { agentNotifyMessage, shouldNotifyAgentStop } from "$lib/agent-notify";
import type { BannerKind } from "$lib/agent-banners";
import { chatTileResolvedBy, chatTileTurnNotifyKind } from "$lib/chat-tile/chat-tile-status";
import { t } from "$lib/i18n/i18n.svelte.js";
import { aiDisplayName } from "$lib/pane-icons";
import { settings } from "$lib/settings.svelte.js";
import { activeTabId, findPaneAnywhere, focusedPane, tabOfPane } from "$lib/app/tabs.svelte.js";
import { veilVisible } from "$lib/app/veil.svelte.js";
import { clearAgentUnseen, markAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
import { chatTileBannerSignal, pushAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { scopeOf, tileLabel } from "$lib/app/messenger-label";
import { agentAlertGroup } from "$lib/dock-alert-groups";

/**
 * 채팅 잎의 턴 끝 · 권한 물음 알림 — 터미널 AI 타일과 같은 표면 · 같은 설정이고, 메신저로는 보내지 않는다(채팅 타일은 다리 대상이 아니다).
 * 이 모듈은 메신저 모듈 · 터미널 알림 함수를 부르지 않는다 — 시험이 소스를 훑는다.
 * 일반 기록(`recordNotification`)에는 적지 않는다 — 배너 저장소가 지난 알림을 쥔다.
 */

const startedAt = new Map<string, number>();

function notifyChatTile(paneId: string, cli: "claude" | "codex", kind: BannerKind, turnMs: number | null): void {
  const pane = findPaneAnywhere(paneId);
  if (!pane) return;
  const where = shouldNotifyAgentStop({
    enabled: kind === "permission" ? settings.notifyPermission : settings.notifyTurnEnd,
    windowFocused: windowFocused(),
    focusedTile: focusedPane()?.id === paneId,
    turnMs,
    focusedAfterMs: settings.notifyFocusedAfterSecs * 1000,
  });
  if (where === "none") return;
  const agent = aiDisplayName(cli);
  const label = tileLabel(pane);
  const msg =
    kind === "failed"
      ? { toast: t("app.agent.failed.toast", { name: label, agent: agent ?? cli }), body: t("app.agent.failed.body", { agent: agent ?? cli }) }
      : agentNotifyMessage(kind, label, t, agent);
  pushAgentBanner({
    paneId,
    kind,
    agent,
    logo: cli,
    label,
    text: msg.toast,
    short: msg.body,
    bornFocused: where === "focused",
    group: agentAlertGroup({ paneId, host: null, tileLabel: label, logo: cli, scope: scopeOf(pane) }),
  });
  if (where === "os") void notifyOs(`${APP} · ${label}`, msg.body).catch(() => {});
}

/** 사건 적용에서만 부른다 — 스냅숏으로 다시 맞춘 지난 일은 알리지 않는다 */
export function noteChatTileEvent(
  paneId: string,
  cli: "claude" | "codex",
  ev: SideChatEv,
  p: { pendingBefore: number; pendingAfter: number },
): void {
  // 알림보다 먼저 — 턴 끝의 새 알림이 곧바로 풀리지 않게
  chatTileBannerSignal(paneId, chatTileResolvedBy({ turnStarted: ev.t === "turnStarted", permissionsCleared: p.pendingBefore > 0 && p.pendingAfter === 0 }));
  if (ev.t === "turnStarted") {
    clearAgentUnseen([paneId]);
    startedAt.set(paneId, Date.now());
  }
  if (p.pendingAfter > p.pendingBefore) notifyChatTile(paneId, cli, "permission", null);
  if (ev.t === "turnEnded") {
    const kind = chatTileTurnNotifyKind(ev.outcome);
    if (kind) {
      // 가림막이 덮고 있으면 활성 탭이라도 보이지 않는다
      const tab = tabOfPane(paneId);
      if (!tab || tab.id !== activeTabId() || veilVisible()) markAgentUnseen(paneId);
      else clearAgentUnseen([paneId]);
      const at = startedAt.get(paneId);
      notifyChatTile(paneId, cli, kind, at === undefined ? null : Date.now() - at);
    }
  }
  if (ev.t === "exited") startedAt.delete(paneId);
}
