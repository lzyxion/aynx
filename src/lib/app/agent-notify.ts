import { agentNotifyMessage, shouldNotifyAgentStop, type AgentNotifyKind } from "$lib/agent-notify";
import { t } from "$lib/i18n/i18n.svelte.js";
import { aiDisplayName } from "$lib/pane-icons";
import { paneName, type PaneSpec } from "$lib/session";
import { settings } from "$lib/settings.svelte.js";
import { focusedPane, tabOfPane } from "$lib/app/tabs.svelte.js";
import { displayTabTitle } from "$lib/app/titles.svelte.js";
import { APP, notifyOs, windowFocused } from "$lib/app/os-notify";
import { pushAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { messengerAgent } from "$lib/app/messenger";
import { buildScopes, scopeLabelForPath, type AgentLink } from "$lib/agent-sessions";
import { projects } from "$lib/app/project-list.svelte.js";
import { worktreesOf } from "$lib/app/worktrees.svelte.js";
import { localFolderOf, type TurnCount } from "$lib/app/agent-turn";
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

/**
 * 알림에 적을 이름 — 그 타일이 든 **탭의 제목**(탭 바가 그리는 `displayTabTitle` 그대로, 예
 * `aynx · feat-y`). `paneName` 은 로컬 AI 타일에서 셸 라벨(`PowerShell 7`)이라 Claude 타일이 여럿이면
 * 어느 것이 끝났는지 못 가른다. 탭을 못 찾거나 제목이 비었으면 `paneName` 으로 떨어진다.
 */
function tileLabel(pane: PaneSpec): string {
  const tab = tabOfPane(pane.id);
  return (tab ? displayTabTitle(tab).trim() : "") || paneName(pane, t);
}

/**
 * 메신저(Discord) 알림에 적을 이름 — 폰에서 **어느 일**인지 읽혀야 한다(docs/log/2026-09-27-discord-notify.md
 * "둘째 줄 — 맥락"). 로컬 타일이면 그 폴더가 든 등록 범위(`<프로젝트> · <워크트리>`), 아니면 그 탭의 고정 제목
 * (`TabSpec.pinnedTitle` — 프로젝트·워크트리로 연 탭), 그것도 없으면 창 안 알림과 같은 [`tileLabel`].
 */
function messengerLabel(pane: PaneSpec): string {
  return scopeOf(pane) || tabOfPane(pane.id)?.pinnedTitle?.trim() || tileLabel(pane);
}

/** 로컬 타일의 폴더가 든 등록 범위(`<프로젝트> · <워크트리>`) — 없으면 `null`. 메신저 이름과 지난 알림 묶음이 함께 쓴다 */
function scopeOf(pane: PaneSpec): string | null {
  const folder = localFolderOf(pane);
  if (!folder) return null;
  const ready = (id: string) => {
    const w = worktreesOf(id);
    return w?.state === "ok" ? w.list : null;
  };
  return scopeLabelForPath(folder, buildScopes(projects(), ready, null, null).rows) || null;
}

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
  // 메신저(Discord) — 아래 표면 판정과 **독립**이다(제 켬/끔 · 자리 비움 표). docs/log/2026-09-27-discord-notify.md
  messengerAgent({
    label: messengerLabel(pane),
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
