import { SvelteMap, SvelteSet } from "svelte/reactivity";
import {
  composeTabTitle,
  paneName,
  type PaneSpec,
  type TabSpec,
} from "$lib/session";
import { aiOf, localPaneIdentity, remotePaneName, type LocalPaneSignals, type PaneIdentity } from "$lib/pane-identity";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **타일에 보여 줄 이름** — 순수 트리(`PaneSpec.shell`)는 건드리지 않는 표시 전용 층이다.
 *
 * 세션·트리는 `session.ts` 가 순수하게 쥐고, 여기는 그 위에 **런타임 신호**(셸이 OSC 0/2 로
 * 바꾼 창 제목 · 백엔드가 해석한 셸 id · 지금 도는 명령)를 얹어 헤더·탭에 띄우는 이름만
 * 계산한다. 그래서 이 모듈은 `$lib/*` 순수 모듈에서만 가져오고(`app/*` 를 안 봐서 순환이
 * 없다) 지속성엔 관여하지 않는다 — 앱을 껐다 켜면 `PaneSpec.shell` 은 여전히 `null`(기본).
 *
 * 표시 규칙(`displayName`):
 *  - **SSH 타일** → 별칭 그대로. OSC 제목은 무시한다 — 사용자는 어느 호스트인지 이미 안다.
 *  - **로컬 타일** → [`localPaneIdentity`] 가 아이콘과 **한 답**으로 정한다. 그 순서는
 *    `pane-identity.ts` 머리말의 표에 있다: ① `autorun` 이 AI CLI → 그 이름("Claude Code"·
 *    "Codex") · ② **지금 도는 명령**이 AI CLI → 그 이름(PowerShell 에서 손으로 `claude` 를
 *    친 경우) · ③ OSC 제목에 "Claude Code" → claude · ④ 의미 있는 OSC 제목 ‖ 해석된 셸 이름
 *    (절대 뭉뚱그린 "로컬" 이 아니다 — `ssh user@host` 를 로컬 셸에서 돌리면 원격 제목이
 *    그대로 뜬다).
 *  - 그 외(settings/sftp/localfs/start) → `paneName` 그대로.
 *
 * 규칙 자체는 **순수 모듈**(`$lib/pane-identity`)에 있고 여기는 신호를 모아 넘기는 자리다 —
 * `PaneIcon.svelte` 가 아이콘을 뽑을 때 **같은 함수**를 지나므로 아이콘과 이름이 어긋나지
 * 않는다 (잡음 제목 거르기 `isMeaningfulTitle` 도 그쪽으로 옮겼다).
 */

// 셀이 OSC 0/2 로 바꾼 창 제목 (paneId → 제목). SvelteMap 이라 키를 set/delete 하면 아래
// getter 를 읽는 컴포넌트가 저절로 다시 계산된다 (`tabs.svelte.ts` 와 같은 패턴).
const oscTitles = new SvelteMap<string, string>();
// 백엔드가 로컬 열림에서 해석해 준 셸 id (paneId → "pwsh"·"powershell"·"gitbash"·"wsl:…").
const resolvedShells = new SvelteMap<string, string>();
/**
 * **지금 그 타일에서 도는 명령 한 줄** (paneId → 명령문). 프롬프트로 돌아오면 키가 지워진다.
 *
 * 출처는 OSC 133 `C`(시작·명령문)와 `D`(끝·`null`) 뿐이다 — 셸 통합이 없는 세션(cmd.exe ·
 * 주입 실패 · tmux 안)에는 키가 아예 생기지 않고, 그 타일은 지금까지와 똑같이 셸 이름으로
 * 남는다. **없는 정보를 지어내지 않는다.**
 */
const runningCommands = new SvelteMap<string, string>();
/**
 * **autorun 에이전트가 끝난 타일** — 셸 프롬프트가 돌아왔다(`app/agent-status` 의
 * `agentPromptReturned` 가 적는다 · 2026-09-24 실기 ②). 신원 규칙 ①(autorun) 을 건너뛰게 하는
 * 표식이다: 없으면 `/exit` 뒤의 평범한 셸이 계속 "Claude Code" 로 불린다. 세션이 갈리면 지운다.
 */
const endedAgents = new SvelteSet<string>();

/**
 * **훅 신호가 밝힌 CLI** (paneId → `"claude"`·`"codex"`) — 신원 규칙 ③′(`pane-identity.ts`). 분류되지 않은 타일에
 * `cli` 를 실은 신호가 오면 `app/agent-status` 의 `agentSignal` 이 적는다(2026-10-08 — tmux 안에서 손으로 띄운 `codex`).
 * 이 자리에 두는 이유: 신원의 재료(`signalsOf`)가 여기서 모이고, 이 모듈은 `app/*` 를 보지 않는다(`endedAgents` 와 같은 꼴).
 * 지우는 곳: 세션 종료(`agentExit`) · 새 세션(`agentSessionStart`) · 셸 프롬프트 복귀(`agentPromptReturned`) ·
 * 세션 id 가 `null`(`clearPaneTitle`). **이관 짐에 싣지 않는다** — 넘어간 창에는 다음 신호가 다시 붙인다.
 */
const attestedAgents = new SvelteMap<string, string>();

/**
 * **집 PC 가 거울로 알려 준 CLI**(원격 창만 · paneId → `"claude"`·`"codex"` — 10-16 모바일 라벨). 원격은 `autorun` 을 받지 않아
 * AI 타일을 셸 이름으로 부르게 되므로, 집 PC 가 이미 그리는 판정(`PaneView.ai`)을 신원 규칙 ③′ 자리에 함께 넣는다(훅 신호가 먼저).
 * 쓰는 곳은 `app/mirror` 의 환원 한 곳이고 거울을 받을 때마다 통째로 갈아 끼운다.
 */
const mirroredAgents = new SvelteMap<string, string>();

/** 거울이 알려 준 CLI 표를 갈아 끼운다(원격 pane id → CLI) — 바뀐 칸만 건드린다 */
export function setMirroredAgents(next: ReadonlyMap<string, string>): void {
  for (const id of [...mirroredAgents.keys()]) if (!next.has(id)) mirroredAgents.delete(id);
  for (const [id, cli] of next) if (mirroredAgents.get(id) !== cli) mirroredAgents.set(id, cli);
}

/** 훅 신호가 이 타일의 CLI 를 밝혔다 */
export function markSignalAttested(paneId: string, cli: string): void {
  if (attestedAgents.get(paneId) !== cli) attestedAgents.set(paneId, cli);
}

/** 그 표식을 지운다 — 세션이 끝났거나 갈렸다 */
export function clearSignalAttested(paneId: string): void {
  attestedAgents.delete(paneId);
}

/** 이 타일의 autorun 에이전트가 끝났다 — 이제 신원은 셸(또는 손으로 친 명령)이 정한다 */
export function markAgentEnded(paneId: string): void {
  endedAgents.add(paneId);
}

/** 이 타일의 autorun 에이전트가 끝났는가 — 반응형 getter */
export function agentEndedOf(paneId: string): boolean {
  return endedAgents.has(paneId);
}

/** OSC 0/2 창 제목 보고 — `Terminal.onTitleChange` 가 부른다 */
export function reportOscTitle(paneId: string, title: string): void {
  oscTitles.set(paneId, title);
}

/** 해석된 셸 id 보고 — 로컬 세션이 열린 직후 한 번 부른다 (SSH 는 부르지 않는다) */
export function reportResolvedShell(paneId: string, shell: string): void {
  resolvedShells.set(paneId, shell);
}

/**
 * **지금 도는 명령 보고** — `C`(명령문)와 `D`(`null`)에서 터미널이 부른다.
 *
 * 값이 `null` 이면 키를 지운다("도는 명령이 없다" 와 "빈 명령" 을 가르지 않는다 — 둘 다
 * 프롬프트로 돌아온 상태다).
 */
export function reportRunningCommand(paneId: string, command: string | null): void {
  const line = command?.trim() ?? "";
  if (line === "") runningCommands.delete(paneId);
  else runningCommands.set(paneId, line);
}

/**
 * 타일/세션을 닫을 때 셋 다 지운다 — 재사용된 id 가 옛 제목을 물려받지 않게.
 *
 * 부르는 자리는 `+page` 의 `onsession`(세션 id 가 `null` 이 됐다 = 종료·닫힘·이관 언마운트)
 * 하나다. 세션이 갈리면 **도는 명령도 모르는 것**이 되므로 여기에 함께 실린다 (터미널은
 * 재연결·이관에서 `resetSource` 와 같은 자리에서 한 번 더 `null` 을 올린다).
 */
export function clearPaneTitle(paneId: string): void {
  oscTitles.delete(paneId);
  resolvedShells.delete(paneId);
  runningCommands.delete(paneId);
  endedAgents.delete(paneId);
  attestedAgents.delete(paneId);
}

/** 이 타일의 OSC 제목 (없으면 `undefined`) — 반응형 getter */
export function oscTitleOf(id: string): string | undefined {
  return oscTitles.get(id);
}

/** 이 타일의 해석된 셸 id (없으면 `undefined`) — 반응형 getter */
export function resolvedShellOf(id: string): string | undefined {
  return resolvedShells.get(id);
}

/** 이 타일에서 **지금 도는 명령** (없으면 `undefined`) — 반응형 getter */
export function runningCommandOf(id: string): string | undefined {
  return runningCommands.get(id);
}

/**
 * 로컬 타일의 신호 넷을 한 묶음으로 — [`paneIdentity`] 와 `PaneIcon` 이 같은 값을 본다.
 * 셸은 **해석된 것이 먼저**이고 없으면 사용자가 고른 `PaneSpec.shell` 이다.
 */
function signalsOf(pane: PaneSpec): LocalPaneSignals {
  return {
    autorun: pane.autorun ?? null,
    agentEnded: endedAgents.has(pane.id),
    runningCommand: runningCommandOf(pane.id) ?? null,
    oscTitle: oscTitleOf(pane.id) ?? null,
    signalAttested: attestedAgents.get(pane.id) ?? mirroredAgents.get(pane.id) ?? null,
    shell: resolvedShellOf(pane.id) ?? pane.shell ?? null,
  };
}

/**
 * 로컬 타일의 **아이콘 + 이름**을 한 번에 (규칙은 `$lib/pane-identity`). 아이콘만 필요한
 * `PaneIcon.svelte` 도 이 문을 지난다 — 그래야 둘이 절대 다른 말을 하지 않는다.
 *
 * `kind:"local"` 이 아닌 타일에 불러도 답은 나오지만 뜻이 없다(신호가 전부 비어 셸 폴백).
 * 갈림은 부르는 쪽이 친다.
 */
export function paneIdentity(pane: PaneSpec): PaneIdentity {
  return localPaneIdentity(signalsOf(pane), t);
}

/**
 * 이 타일에서 **지금 도는 AI CLI**(`"claude"`·`"codex"`) — 없으면 `null`. [`paneIdentity`] 의 `ai` 와 같은 판정
 * (`$lib/pane-identity` 의 `aiOf` 한 벌)이고 이름·아이콘은 만들지 않는다. 로컬·SSH 타일이 함께 쓴다
 * (`app/agent-status` 의 `agentKindOf`) — SSH 타일의 **표시 이름**은 AI 이름이 먼저이고 서버 별칭이 뒤에 붙는다([`displayName`]).
 * 반응형이다.
 */
export function paneAi(pane: PaneSpec): string | null {
  return aiOf(signalsOf(pane));
}

/**
 * 타일에 **보여 줄** 이름. 규칙은 이 모듈 머리말 참고.
 *
 * 순수 `paneName` 과 나뉘는 이유: `paneName` 은 트리·저장·이름변경 초기값처럼 **안정된**
 * 이름이 필요한 곳에 그대로 쓰고, 이 함수는 화면에 뜨는 이름만 런타임 신호로 덮는다.
 */
export function displayName(pane: PaneSpec): string {
  // 원격 AI 타일은 AI 이름이 먼저, 뒤에 서버 별칭(`Claude Code · dev-01`)
  if (pane.kind === "ssh") return remotePaneName(paneName(pane, t), paneAi(pane));
  if (pane.kind === "local") return paneIdentity(pane).name;
  return paneName(pane, t);
}

/**
 * 탭 바에 **보여 줄** 제목 — `tabDisplayTitle` 과 같은 순서(`composeTabTitle` 한 곳 — 사용자 이름 → 고정 제목 →
 * 타일 둘 이상이면 합성 → 하나면 일부러 적은 제목 · 그 타일 이름 · "새 탭")를 타되 패널 이름을 `displayName` 으로 뽑는다.
 *
 * `tabDisplayTitle`(순수)은 팔레트·검색·이름변경 초기값에 그대로 남는다 — 그쪽을 반응형으로
 * 만들지 않으려고 표시용만 여기로 뺐다.
 */
export function displayTabTitle(tab: TabSpec): string {
  return composeTabTitle(tab, displayName, t);
}
