/**
 * 탭 이관 — 탭을 **새 창으로 분리**하고, 창을 **다른 창의 탭으로 합친다**.
 * (docs/log/2026-09-02-tear-out.md · 백엔드는 `src-tauri/src/handoff.rs`)
 *
 * 배치 모델의 마지막 겹이다: **패널 ⊂ 탭 ⊂ 창**. 앞의 두 겹은 트리 하나를 옮기면 끝났지만
 * (`session.ts` 의 `insertSubtree`), 창은 **웹뷰가 갈린다** — xterm 인스턴스도 탭 상태도
 * 창마다 별개라 "객체를 그대로 옮겨" 가 성립하지 않는다.
 *
 * 그래서 창을 넘길 때 지켜야 할 것이 셋이다.
 *
 * 1. **세션을 죽이지 않는다.** 세션은 Rust 전역이라 창과 무관하게 살아 있는데, 소스 창의
 *    `Terminal` 이 언마운트되면서 `session.close()` 를 부르면 그 자리에서 끝난다.
 *    → [`markHandoff`] 로 표시해 두면 그 정리에서 `close` 대신 `detach` 가 나간다.
 * 2. **출력을 새 창으로 돌린다.** → `reattachSession` → Rust `reattach_output`.
 * 3. **스크롤백을 옮긴다.** 버퍼는 옛 웹뷰의 메모리에만 있으므로 직렬화해서 실어 보내고
 *    새 창에서 `term.write` 로 재생한다 → [`registerSerialize`] 레지스트리.
 *
 * 큰 페이로드는 `dataTransfer` 로 나르지 않는다 — 드래그에는 **번호표(token)** 만 싣고
 * 짐은 Rust 의 1회용 사서함에 맡긴다 (분리는 받는 창이 **아직 없다**는 점에서도 그렇다).
 */

import { serialize } from "$lib/tabs";
import { assignTileKeys, type SavedWorkspaceTab } from "$lib/workspaces/schema";
import { invoke } from "./ipc";
import { exportHistory, importHistory, type CommandBlock } from "$lib/block-history";
import { adoptTab, type PaneSpec, type TabSpec, type TermSize } from "$lib/session";
import { sanitizeAgentLink, type AgentLink } from "$lib/agent-sessions";
import type { MarkerDistance } from "$lib/shell-integration";
import { currentZoom, screenToLogical } from "$lib/ui-scale";

// ---------------------------------------------------------------------------
// 드래그 종류
// ---------------------------------------------------------------------------

/**
 * 탭을 끌 때 `x-aynx-tab`(창 안 순서·병합용) 과 **함께** 싣는 종류 — 값은 사서함 번호다.
 *
 * 둘을 같이 싣는 이유: 받는 쪽은 `dragover` 에서 **종류만** 볼 수 있고 값은 못 읽는다.
 * 창 안 드랍은 지금까지처럼 `x-aynx-tab` 하나로 끝나고, 다른 창에 떨어졌을 때만
 * `x-aynx-tear` 의 번호로 사서함을 연다 — 그 판정은 "이 창에 그 탭 id 가 있는가" 다.
 */
export const TEAR_DRAG_TYPE = "application/x-aynx-tear";

// ---------------------------------------------------------------------------
// 직렬화 레지스트리 (sync.svelte.ts 의 입력 레지스트리와 같은 패턴)
// ---------------------------------------------------------------------------

/**
 * 이관 때 실어 보낼 **스크롤백 줄 수 상한** (화면에 보이는 줄은 여기에 더해 항상 간다).
 *
 * 상한을 두는 이유는 비용이다 — 직렬화는 `dragstart` 안에서 **동기로** 돌고, 결과 문자열은
 * IPC 로 한 번, 새 창의 `term.write` 로 한 번 더 지나간다. 20만 줄(`MAX_SCROLLBACK`) 짜리
 * 탭을 통째로 뜨면 드래그를 시작하는 순간 창이 눈에 띄게 멈춘다.
 *
 * 5000 은 `DEFAULT_SCROLLBACK` 과 같은 값이다 — "기본 설정으로 쓰던 사람은 하나도 잃지
 * 않는다" 는 선. 더 길게 쓰던 탭은 오래된 위쪽이 잘린다 (docs/log/2026-09-02-tear-out.md).
 */
export const TEAR_SCROLLBACK = 5000;

/**
 * **보험 체크포인트**(30초 주기 · 창이 가려질 때)의 스크롤백 줄 수 상한 — 크래시·강제 종료에서만 쓰인다.
 *
 * 이관·떠나기(detach)는 한 번뿐이라 [`TEAR_SCROLLBACK`] 그대로 뜨지만, 보험은 출력이 흐르는 타일마다(숨은 탭 포함)
 * 30초마다 메인 스레드에서 **동기로** 돈다 — 5000줄이면 버퍼가 찰수록(몇 시간 뒤) 한 장이 수 MB · 수십~수백 ms 가 되어
 * 장시간 구동에서 UI 가 주기적으로 끊겼다. 크래시 복원은 화면과 최근 이력이면 충분하다(그 뒤는 출력 링 재생).
 */
export const CHECKPOINT_SCROLLBACK = 1000;

/**
 * 패널 한 장을 뜬 것 — ANSI 문자열(= `SerializeAddon.serialize()`)과 **그것이 유효한 크기**.
 *
 * 둘을 한 봉투에 담는 이유가 이 값의 전부다: 직렬화 문자열은 **뜬 그 열 수에서만** 원래의
 * 줄바꿈을 재현한다. 폭이 다른 창에 그대로 쓰면 xterm 이 그 자리에서 리플로해 줄이 밀리고,
 * 아직 심지 않은 마커 거리가 통째로 어긋난다 (docs/log/2026-09-08-block-history-store.md).
 */
export interface TermSnapshot extends TermSize {
  buffer: string;
  /**
   * [`buffer`] 를 뜬 **같은 순간** 화면에 반영돼 있던 세션 출력 오프셋 (Rust 출력 꼬리 링의 축 — R02).
   * 받는 창의 재부착이 이 뒤의 꼬리(이관 틈에 옛 채널로 가 사라진 출력)를 재생한다. 모르면 없다.
   */
  consumed?: number;
}

/** 패널의 현재 화면+스크롤백을 [`TermSnapshot`] 으로 — `scrollback` 을 주지 않으면 [`TEAR_SCROLLBACK`] */
export type SerializeFn = (scrollback?: number) => TermSnapshot;

/**
 * 살아 있는 패널들의 직렬화 함수. `$state` 가 아니다 — 렌더가 아니라 드래그 시작
 * 한순간에만 호출된다.
 */
const serializers = new Map<string, SerializeFn>();

/**
 * 패널의 직렬화 함수를 등록한다 (터미널 마운트 시 1회).
 * 돌려주는 함수를 언마운트 정리에서 부르면 해제된다.
 *
 * 해제는 **내가 넣은 그 함수일 때만** 지운다 (`registerInput` 과 같은 이유).
 */
export function registerSerialize(paneId: string, fn: SerializeFn): () => void {
  serializers.set(paneId, fn);
  return () => {
    if (serializers.get(paneId) === fn) serializers.delete(paneId);
  };
}

/**
 * 패널 하나를 뜬다. 등록이 없거나(아직 마운트 전) 직렬화가 실패하면 `null` 이다 —
 * 이관 자체를 실패시키지 않는다. 최악이라도 "세션은 살아 있고 이력만 비었다" 가 낫다.
 * (그때는 크기도 없다 — 없는 버퍼의 크기는 뜻이 없다.)
 */
function snapshotOf(paneId: string, scrollback?: number): TermSnapshot | null {
  try {
    return serializers.get(paneId)?.(scrollback) ?? null;
  } catch {
    return null;
  }
}

/**
 * 패널 하나를 뜬다 — 이관 밖의 쓰임(페이지 리로드 **체크포인트** — `app/sessions.svelte.ts` 의
 * `leaveWindowSessions`·`stashWindowCheckpoints`). 이관 짐과 **같은 직렬화**다(설계 4.3 "체크포인트").
 * 보험 체크포인트는 `scrollback` 에 [`CHECKPOINT_SCROLLBACK`] 을 준다.
 */
export function snapshotPane(paneId: string, scrollback?: number): TermSnapshot | null {
  return snapshotOf(paneId, scrollback);
}

// ---------------------------------------------------------------------------
// 이관 중 세션 보호
// ---------------------------------------------------------------------------

/**
 * **지금 다른 창으로 넘어가는 중인** 패널들.
 *
 * `Terminal` 의 언마운트 정리는 원래 `session.close()` 를 부른다 (탭을 닫는 유일한 경로가
 * 그것이므로 옳다). 이관은 같은 언마운트를 일으키지만 뜻이 정반대다 — 세션은 새 창이
 * 이어받아야 한다. 그 한 가지 예외를 여기 이름표로 둔다.
 *
 * 표시는 **탭을 제거하기 직전에** 걸고 제거가 끝나면 푼다. 그 밖의 어떤 경로에서도
 * 켜지지 않으므로, 평소의 탭 닫기는 지금까지와 완전히 같다.
 */
const handoffPanes = new Set<string>();

export function markHandoff(paneIds: readonly string[]): void {
  for (const id of paneIds) handoffPanes.add(id);
}

export function releaseHandoff(paneIds: readonly string[]): void {
  for (const id of paneIds) handoffPanes.delete(id);
}

/** 이 패널의 언마운트가 "이관" 인가 (= 세션을 죽이면 안 되는가) */
export function isHandoff(paneId: string): boolean {
  return handoffPanes.has(paneId);
}

// ---------------------------------------------------------------------------
// 이관 페이로드
// ---------------------------------------------------------------------------

/**
 * 패널 하나가 창을 건널 때 실려 가는 것.
 *
 * ## 화면 말고도 실어야 하는 것이 있다 (2026-09-08)
 *
 * 예전에는 셋(`pane`·`sessionId`·`buffer`)뿐이었고, 그것이 **같은 결함의 두 사례**를 낳았다
 * — "타일에 딸린 부속 상태가 이관 페이로드에 없다" (docs/log/2026-09-08-block-history-design.md
 * 의 "소유와 이관" 절):
 *
 * | 무엇 | 안 실으면 |
 * | --- | --- |
 * | [`history`] | 뜯어낼 때마다 블록 이력이 0 이 된다. `SerializeAddon` 이 나르는 것은 셀 내용뿐이고 OSC 133 은 애초에 셀이 된 적이 없다(라이브 스트림에서 메타데이터로 소비됐다) — 즉 이관 직후의 터미널은 다음 프롬프트까지 "OSC 133 없는 세션" 이다 |
 * | [`markers`] | 이력은 넘어오는데 **줄을 모른다** — `#` 검색이 블록을 찾고도 "밀려난 블록" 만 낸다 (2026-09-09 에 메웠다) |
 * | [`shared`] | **이미 있던 버그.** `ai.svelte.ts` 의 공유 옵트인을 `buildTear` 가 읽지 않고 `restoreTab` 이 다시 세우지 않아, 공유 중인 타일을 뜯어내면 **말없이 공유가 꺼졌다** |
 * | [`agentLink`] | 넘어간 타일에서 도는 Claude 대화가 받는 창의 지난 대화 목록에 "열림" 대신 "밖에서 열림" 으로 섰다 — 다음 훅 신호까지(2026-09-26) |
 * | [`titles`] | 넘어간 로컬 타일의 이름이 **"로컬"** 로 떨어졌다 — 셸 이름·OSC 제목·도는 명령이 모두 받는 창에 없어서, 여러 타일 탭의 합성 제목(`PowerShell 7 · Claude Code`)까지 `로컬 · 로컬` 이 됐다(2026-09-30) |
 */
export interface TearPane {
  /** 원본 명세 (`id` 는 소스 창의 것 — 받는 쪽이 새로 매긴다) */
  pane: PaneSpec;
  /** 이어붙일 **살아 있는** 백엔드 세션 id. `null` 이면 붙일 세션이 없다 */
  sessionId: number | null;
  /** `SerializeAddon.serialize()` 결과 (ANSI 포함). 빈 문자열일 수 있다 */
  buffer: string;
  /**
   * [`buffer`] 를 뜬 **소스 터미널의 크기** (2026-09-09). 뜨지 못했으면 없다.
   *
   * 받는 쪽은 이 크기로 **먼저 되돌린 뒤** 버퍼를 쓴다 — 그래야 줄바꿈이 원본 그대로
   * 재현되고 [`markers`] 의 거리가 맞는 줄에 떨어진다 ([`TermSnapshot`] 설명).
   */
  size?: TermSize;
  /**
   * [`buffer`] 와 한 봉투로 뜬 출력 오프셋 ([`TermSnapshot.consumed`]). 없으면(옛 짐·모름) 재생 없음.
   */
  consumed?: number;
  /** 이 타일의 블록 이력 (마커 제외 — `$lib/block-history`). 없으면 빈 배열 */
  history: CommandBlock[];
  /**
   * 블록 마커의 **자리**를 거리로 적은 것 ([`MarkerDistance`] · 2026-09-09).
   *
   * [`history`] 만 실었을 때 남던 반쪽을 메운다: 새 창에서 `#` 검색이 블록을 **찾기는
   * 하는데** 고르면 "화면에서 밀려난 블록입니다" 가 떴다. 마커가 없어 `lineOfBlock` 이
   * 줄을 모르기 때문이고(OSC 133 은 직렬화에 실리지 않는다), 실패 거터 표시도 같은
   * 이유로 사라졌다. 줄 번호가 아니라 **거리**를 싣는 이유는 새 창의 버퍼가 잘리거나
   * 크기가 달라 절대 줄이 그대로일 수 없기 때문이다.
   */
  markers: MarkerDistance[];
  /** 이 타일이 AI 에 공유 중이었는가 (`$lib/ai.svelte.ts`) */
  shared: boolean;
  /**
   * 이 타일 ↔ 에이전트 대화 연결 (`app/agent-sessions` — docs/log/2026-09-26-agent-sessions.md "연결의 수명 =
   * 세션"). 세션이 산 채 건너가므로 연결도 함께 간다. 없으면 없다(옛 짐도). 대화 id 와 에이전트 이름뿐 — 제목은 싣지 않는다.
   */
  agentLink?: AgentLink | null;
  /**
   * 이 타일의 **이름을 정하던 런타임 신호** ([`PaneTitleSignals`] — `app/titles` 의 표시 전용 저장소).
   * 세션이 산 채 건너가므로 신호도 함께 간다. 없으면 없다(옛 짐도).
   */
  titles?: PaneTitleSignals | null;
}

/**
 * 타일 이름을 정하는 **런타임 신호** 셋 — `app/titles.svelte.ts` 가 패널 id 로 쥐는 표시 전용 값이다
 * (docs/log/2026-09-30-tear-title-and-agent-handoff.md).
 *
 * 패널 id 는 창을 건너며 새로 매겨지므로 그 저장소의 값은 받는 창에서 **하나도 안 보인다** — 그러면 로컬
 * 타일은 규칙의 마지막 칸(`PaneSpec.shell` 없음 = "로컬")으로 떨어진다. 셸 이름(`resolvedShell`)은 로컬 새
 * 열림에서만 한 번 오고 재부착에는 없으며, OSC 제목·도는 명령은 다음 출력이 올 때까지 없다. 그래서 짐에 싣는다.
 */
export interface PaneTitleSignals {
  /** 셸이 OSC 0/2 로 바꾼 창 제목 */
  oscTitle?: string;
  /** 백엔드가 해석한 셸 id (`pwsh` · `gitbash` · `wsl:…`) */
  resolvedShell?: string;
  /** 지금 도는 명령 한 줄 (OSC 133 `C`) — AI CLI 면 타일이 그 이름으로 선다 */
  runningCommand?: string;
}

/** 넘어온 신호를 **모양이 맞는 것만** 남긴다 (짐은 JSON — 비었거나 망가졌을 수 있다). 남는 게 없으면 `null` */
export function sanitizeTitleSignals(raw: unknown): PaneTitleSignals | null {
  if (!raw || typeof raw !== "object") return null;
  const out: PaneTitleSignals = {};
  for (const key of ["oscTitle", "resolvedShell", "runningCommand"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 탭 하나가 창을 건널 때 실려 가는 것 전부 */
export interface TearWorkspace {
  workspaceId: string;
  workspaceName: string;
  sourceWindow: string;
  sourceTabKey: string;
  savedTab: SavedWorkspaceTab;
}

export interface TearPayload {
  workspace?: TearWorkspace;
  workspaceId?: string;
  tab: TabSpec;
  panes: TearPane[];
}

/**
 * 이관 페이로드를 만든다 — **동기 함수**다.
 *
 * `dragstart` 안에서 불려야 하므로 비동기일 수 없다. 그래서 직렬화 비용이 그대로
 * 드래그 시작 지연이 된다: 패널 1개·스크롤백 5000줄이면 수 ms, 패널이 많은 탭이면
 * 그 배수다 (docs/log/2026-09-02-tear-out.md 의 "비용" 절). 대신 **드래그가 창 밖으로
 * 나갔는지** 를 기다렸다가 만들 수는 없다 — 그때는 이미 `dataTransfer` 를 못 건드린다.
 */
export function buildTear(
  tab: TabSpec,
  panes: readonly PaneSpec[],
  sessionOf: (paneId: string) => number | null,
  sharedOf: (paneId: string) => boolean,
  markersOf: (paneId: string) => MarkerDistance[],
  agentLinkOf?: (paneId: string) => AgentLink | null,
  titlesOf?: (paneId: string) => PaneTitleSignals | null,
): TearPayload {
  return {
    ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
    tab,
    panes: panes.map((pane) => {
      // 버퍼와 크기는 **한 번에** 뜬다 — 둘 사이에 창이 리사이즈되면 짐 안에서 어긋난다.
      const snap = snapshotOf(pane.id);
      return {
        pane,
        sessionId: sessionOf(pane.id),
        buffer: snap?.buffer ?? "",
        ...(snap ? { size: { cols: snap.cols, rows: snap.rows } } : {}),
        // 출력 오프셋도 같은 스냅숏에서 — 화면과 오프셋이 한 순간이어야 재생이 겹치지도 비지도 않는다.
        ...(snap && typeof snap.consumed === "number" ? { consumed: snap.consumed } : {}),
        // 이력은 이 모듈이 직접 읽는다 (저장소가 순수 모듈이라 주입할 이유가 없다). 반면
        // 공유 여부는 반응형 모듈(`ai.svelte.ts`)에 있어 **함수로 받는다** — 이 파일이
        // svelte 런타임에 얽히면 순수 모듈 테스트에서 통째로 못 부른다.
        history: exportHistory(pane.id),
        shared: sharedOf(pane.id),
        // 마커 거리도 함수로 받는다 — 값을 아는 것은 **살아 있는 xterm** 이고(`CommandApi`),
        // 그 레지스트리를 여기서 직접 두드리면 이 모듈이 터미널에 얽힌다.
        markers: markersOf(pane.id),
        // 대화 연결도 함수로 받는다 — 저장소가 반응형 모듈이라(`sharedOf` 와 같은 이유).
        agentLink: agentLinkOf?.(pane.id) ?? null,
        // 이름 신호도 함수로 받는다 — 저장소가 반응형 모듈이라(`sharedOf` 와 같은 이유).
        titles: titlesOf?.(pane.id) ?? null,
      };
    }),
  };
}

/** 페이로드를 받은 쪽이 쓰는 모양으로 되돌린다. 모양이 아니면 `null` */
export function parseTear(raw: string): TearPayload | null {
  try {
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    const { tab, panes } = o as { tab?: unknown; panes?: unknown };
    if (!tab || typeof tab !== "object" || !Array.isArray(panes)) return null;
    const t = tab as TabSpec;
    if (typeof t.id !== "string" || !t.root) return null;
    const meta = o as TearPayload;
    return { tab: t, panes: panes as TearPane[], workspaceId: meta.workspaceId, workspace: meta.workspace };
  } catch {
    return null;
  }
}

/**
 * 넘어온 마커 거리 목록을 **모양이 맞는 것만** 남긴다.
 *
 * 짐은 JSON 이라 필드가 아예 없을 수도(옛 버전의 앱이 내놓은 짐) 망가져 있을 수도 있다.
 * 걸러 내는 자리를 여기 하나로 두면 받는 쪽(`ShellIntegration.restoreMarkers`)은 값이
 * 숫자라는 것만 믿으면 된다 — 그쪽은 **범위**만 본다.
 */
function sanitizeMarkers(raw: unknown): MarkerDistance[] {
  if (!Array.isArray(raw)) return [];
  const out: MarkerDistance[] = [];
  for (const m of raw as MarkerDistance[]) {
    if (!m || typeof m !== "object") continue;
    const { blockId, promptFromBottom } = m;
    if (!Number.isInteger(blockId) || !Number.isInteger(promptFromBottom)) continue;
    if (promptFromBottom < 0) continue;
    out.push({ blockId, promptFromBottom });
  }
  return out;
}

/**
 * 소스 터미널 크기가 **말이 되는 값일 때만** 남긴다 (아니면 `undefined` = 옛 짐과 같다).
 *
 * 이 값은 새 창에서 곧바로 `term.resize()` 의 인자가 되므로 걸러 내는 자리가 필요하다.
 * 범위(2..1000)는 xterm 이 견디는 값의 넉넉한 바깥 테두리다 — 1열짜리 터미널은 리플로가
 * 뜻을 잃고, 네 자리 열은 어떤 실기 창에서도 나오지 않는다. 걸러지면 지금까지처럼
 * **타일 크기에서** 버퍼를 쓴다 (2026-09-09 이전의 동작 그대로).
 */
function sanitizeSize(raw: unknown): TermSize | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { cols, rows } = raw as TermSize;
  const sane = (n: number) => Number.isInteger(n) && n >= 2 && n <= 1000;
  return sane(cols) && sane(rows) ? { cols, rows } : undefined;
}

/**
 * 이관 페이로드 → 이 창에 꽂을 탭.
 *
 * 패널 id 를 이 창 체계로 새로 매기고([`adoptTab`]), 각 잎에 복원 지시서를 붙인다.
 * 원본 id 로 짝을 찾으므로 매기기 **전에** 표를 만들어 둔다.
 *
 * ## 부속 상태는 **id 를 다 매긴 뒤에** 옮겨 심는다
 *
 * 블록 이력과 AI 공유는 트리에 들어 있지 않고 `옛 id → 새 id` 표가 있어야 옮길 수 있다.
 * 그 표는 `adoptTab` 안에서만 완성되므로 `onAdopt` 로 받는다.
 *
 * 심는 시점이 **타일이 마운트되기 전**이라는 것이 중요하다: `Terminal.svelte` 의 공유
 * `$effect` 는 마운트 시 `isShared(pane.id)` 를 읽어 `report_session` 을 보내므로, 이
 * 시점에 값이 서 있어야 옮겨온 타일이 **공유된 채로** 서버에 등록된다 (늦게 세워도 집합이
 * 반응형이라 따라오지만, 그 사이의 한 번은 `optedIn:false` 로 나가 서버가 그 타일의 공유
 * 데이터를 지운다).
 *
 * `onShared` 는 함수로 받는다 — [`buildTear`] 의 `sharedOf` 와 같은 이유다. `onAgentLink`(대화 연결)도 같다 —
 * 그리고 **산 세션을 데려온 타일에만** 부른다: 붙일 세션이 없는 타일(`sessionId: null`)은 새 셸이라 그 대화가 없다.
 * `onTitles`(이름 신호 — [`PaneTitleSignals`])도 같은 규칙이다: 그 신호는 데려온 세션의 것이다.
 */
export function restoreTab(
  payload: TearPayload,
  onShared?: (paneId: string, shared: boolean) => void,
  onAgentLink?: (paneId: string, link: AgentLink) => void,
  onTitles?: (paneId: string, titles: PaneTitleSignals) => void,
): TabSpec {
  const byId = new Map(payload.panes.map((p) => [p.pane?.id, p]));
  return adoptTab(
    payload.tab,
    (originalId) => {
      const rec = byId.get(originalId);
      if (!rec) return undefined;
      const size = sanitizeSize(rec.size);
      return {
        sessionId: typeof rec.sessionId === "number" ? rec.sessionId : null,
        buffer: typeof rec.buffer === "string" ? rec.buffer : "",
        // 마커 거리는 **복원 지시서에 실어** 보낸다 — 버퍼를 다 쓴 뒤에야 풀 수 있는 값이라
        // (`Terminal.svelte` 의 `t.write` 콜백) 버퍼와 같은 봉투에 있는 편이 자연스럽고,
        // `adoptTab` 이 옛 id 로 짝을 찾아 새 타일에 붙여 주므로 id 재매김도 저절로 따라온다
        // (`blockId` 는 타일 안의 번호라 그대로 둔다 — 바뀌는 것은 `paneId` 뿐이다).
        markers: sanitizeMarkers(rec.markers),
        // 버퍼를 뜬 크기도 같은 봉투다 — 받는 터미널이 **버퍼를 쓰기 전에** 쓴다.
        ...(size ? { size } : {}),
        // 출력 오프셋 — 재부착이 이관 틈의 꼬리를 재생하는 근거. 모양이 아니면 버린다(= 재생 없음).
        ...(Number.isSafeInteger(rec.consumed) && (rec.consumed as number) >= 0
          ? { consumed: rec.consumed }
          : {}),
      };
    },
    (idMap) => {
      for (const [originalId, newId] of idMap) {
        const rec = byId.get(originalId);
        if (!rec) continue;
        if (Array.isArray(rec.history) && rec.history.length > 0) {
          importHistory(newId, rec.history);
        }
        // 공유는 **켤 때만** 부르지 않는다 — 끈 상태도 그대로 알려야 받는 쪽이 "이 타일은
        // 공유가 아니다" 를 확정할 수 있다 (기본값이 꺼짐이라 결과는 같지만, 계약을
        // 값 하나로 유지한다).
        onShared?.(newId, rec.shared === true);
        const link = typeof rec.sessionId === "number" ? sanitizeAgentLink(rec.agentLink) : null;
        if (link) onAgentLink?.(newId, link);
        const titles = typeof rec.sessionId === "number" ? sanitizeTitleSignals(rec.titles) : null;
        if (titles) onTitles?.(newId, titles);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// 사서함 (Rust `handoff.rs`)
// ---------------------------------------------------------------------------

/**
 * 사서함 번호를 만든다 — **프런트가 만드는 이유**는 `dragstart` 가 동기 이벤트이기
 * 때문이다. `dataTransfer.setData` 는 그 핸들러 안에서 끝나야 하는데 `invoke` 는
 * 비동기라 "백엔드에서 발급받아 싣기" 가 성립하지 않는다.
 *
 * 2³² 중 동시에 살아 있는 번호는 많아야 몇 개이므로 충돌은 사실상 없고, 그래도 겹치면
 * Rust 가 거절한다 (남의 짐을 덮어쓰는 쪽이 훨씬 나쁘다). `crypto` 가 없는 환경은
 * 이 앱에 없지만 폴백은 둔다.
 */
function newToken(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    // 0 은 "번호 없음" 자리로 비워 둔다.
    if (buf[0] !== 0) return buf[0];
  }
  return Math.floor(Math.random() * 0xffff_fffe) + 1;
}

/** 짐을 맡긴다. 성공하면 true (실패해도 throw 하지 않는다 — 드래그는 계속돼야 한다) */
export async function stashHandoff(token: number, payload: TearPayload): Promise<boolean> {
  try {
    await invoke("stash_handoff", { token, payload: JSON.stringify(payload) });
    return true;
  } catch (e) {
    console.error("[aynx] 이관 페이로드를 맡기지 못했습니다:", e);
    return false;
  }
}

/** 짐을 찾아온다 (1회용). 없거나 만료됐으면 `null` */
export async function peekHandoff(token: number): Promise<TearPayload | null> {
  const raw = await invoke<string | null>("peek_handoff", { token });
  return typeof raw === "string" ? parseTear(raw) : null;
}

export interface TearMerge { tabKey: string; tileKey: string; dir: "row" | "col"; side: "before" | "after" }

export async function takeHandoff(token: number, workspaceId?: string, merge?: TearMerge): Promise<TearPayload | null> {
  try {
    const raw = await invoke<string | null>("take_handoff", { token, workspaceId, merge });
    return typeof raw === "string" ? parseTear(raw) : null;
  } catch (e) {
    console.error("[aynx] 이관 페이로드를 찾지 못했습니다:", e);
    return null;
  }
}

/**
 * 분리 창을 연다. 실패 사유는 그대로 올린다 (호출부가 탭을 그대로 둘지 정한다).
 *
 * `x`·`y` 는 페이지가 본 화면 좌표(`screenX/Y`)다 — UI 크기(웹뷰 확대)가 걸려 있으면
 * Chromium 이 그 값을 확대로 나눠 주므로, OS 논리 좌표를 받는 Rust 로 넘기기 전에 계수를
 * 다시 곱한다 (docs/log/2026-09-25-ui-scale-font.md). 100% 면 그대로다.
 */
export async function openTearWindow(token: number, x: number, y: number): Promise<void> {
  const f = currentZoom();
  await invoke("open_tear_window", { token, x: screenToLogical(x, f), y: screenToLogical(y, f) });
}

// ---------------------------------------------------------------------------
// 드래그 한 판의 상태 (창 하나에 하나)
// ---------------------------------------------------------------------------

/** 지금 끌고 있는 탭·타일의 이관 예약 (`dragstart`~`dragend` 사이에만 값이 있다) */
export interface PendingTear {
  token: number;
  /** 실어 보낼 탭의 id — 타일 티어아웃이면 그 자리에서 지어낸 임시 탭이다 */
  tabId: string;
  /**
   * **타일 하나만** 떼는 드래그면 그 타일 id (탭 드래그면 `undefined`).
   *
   * 두 경로는 창을 여는 데까지 완전히 같고 **원본에서 무엇을 빼느냐**만 다르다 —
   * 탭이면 탭 하나를 통째로(`releaseTab`), 타일이면 그 잎만(`releasePane`).
   * `dragend` 판정에서 "이 예약이 내 것인가" 를 묻는 열쇠이기도 하다: 타일 드래그의
   * 정리는 `PaneHost` 가, 탭 드래그의 정리는 `Tabs` 가 하므로 둘이 남의 예약을
   * 집어 들면 엉뚱한 것이 떨어져 나간다.
   */
  paneId?: string;
  /** 짐 맡기기가 끝났는가 — 분리는 이것을 기다렸다가 창을 연다 */
  stashed: Promise<boolean>;
}

let pending: PendingTear | null = null;

/**
 * **이 창이 내놓은 짐들** — 번호 → 그때 무엇을 빼기로 했는가.
 *
 * `pending` 만으로는 부족하다. 드래그가 다른 창의 탭 바·타일에 떨어지면 순서가 이렇다:
 *
 * ```text
 * 대상 창: drop → take_handoff(비동기) → 화면에 꽂기 → release 요청/ACK
 * 소스 창:        dragend(여기서 `endTear`)  ······················ ▲ 한참 뒤에 도착
 * ```
 *
 * `dragend` 는 대상의 IPC 왕복보다 **언제나 먼저**다. 그래서 workspace release ACK 이 왔을 때
 * `pendingTear()` 는 이미 `null` 이고, "내 번호인가" 를 그것으로 물으면 **영영 아니다** —
 * 소스 창은 넘겨 준 탭을 그대로 들고 남는다 (docs/log/2026-09-04-tear-merge-fixes.md).
 *
 * 그래서 예약을 드래그 한 판보다 **오래 살려 둔다.** 지우는 것은 [`claimTear`] 하나이고,
 * 아무도 가져가지 않은 기록은 사서함과 같은 시한([`OFFER_TTL_MS`])에 스스로 삭는다.
 */
const offers = new Map<number, { at: number; tear: PendingTear }>();

/**
 * 아무도 찾아가지 않은 예약 기록의 수명 (ms). Rust 사서함의 TTL(5분)과 같은 값이다 —
 * 짐이 이미 폐기된 번호로 workspace release ACK 이 올 일은 없으므로 기록만 더 들고 있을 이유가 없다.
 */
const OFFER_TTL_MS = 300_000;

/** 예약 기록을 남긴다 (만료된 것은 그 김에 치운다 — Rust 사서함의 게으른 청소와 같다) */
function remember(tear: PendingTear): void {
  const now = Date.now();
  for (const [token, o] of offers) if (now - o.at >= OFFER_TTL_MS) offers.delete(token);
  offers.set(tear.token, { at: now, tear });
}

/**
 * 이 번호가 **이 창이 내놓은 짐**인가 — 맞으면 그 예약을 돌려주고 기록을 지운다 (1회용).
 *
 * 1회용인 이유는 사서함과 같다: 같은 번호로 두 번 정리하면 이미 남에게 넘어간 탭을 한 번 더
 * 빼려 든다. 진행 중인 드래그의 예약도 함께 지운다 — 그 판은 여기서 끝났다는 뜻이다.
 */
export function claimTear(token: number): PendingTear | null {
  const o = offers.get(token);
  if (!o) return null;
  offers.delete(token);
  if (pending?.token === token) pending = null;
  return o.tear;
}

/**
 * 이 드래그에 실린 이관 번호 — **다른 창에서 온 것일 때만** 돌려준다 (아니면 `null`).
 *
 * 창을 넘어왔는지는 탭 id·타일 id 로 가를 수 없다 (`tab-1`·`pane-1` 카운터가 창마다 따로
 * 돈다 — 남의 `pane-3` 이 내 `pane-3` 과 같은 글자다). 가르는 것은 이관 번호다:
 * **이 창이 시작한 드래그면 그 번호가 [`pendingTear`] 에 있다.**
 *
 * `dataTransfer` 의 값은 `drop` 에서만 읽을 수 있으므로 `dragover` 판정은 종류
 * ([`TEAR_DRAG_TYPE`])만 본다 — 두 손잡이(탭 바·타일)가 같은 규칙을 쓰도록 여기 둔다.
 */
export function foreignTearToken(dt: DataTransfer | null | undefined): number | null {
  const raw = dt?.getData(TEAR_DRAG_TYPE) ?? "";
  if (raw === "") return null;
  const token = Number(raw);
  if (!Number.isSafeInteger(token) || token <= 0) return null;
  return pendingTear()?.token === token ? null : token;
}

/**
 * 실패한 이관의 뒷정리 — 짐이 아직 사서함에 있으면 **꺼내 버리고** `true`.
 *
 * `false` 는 "다른 창이 이미 가져갔다" 는 뜻이라 그 실패는 실패가 아니다 (곧 workspace release ACK
 * 이 도착해 원본을 뺀다). 창 열기가 실패했을 때 안내 문구를 띄울지 가르는 데 쓴다.
 */
export async function discardStash(token: number): Promise<boolean> {
  return (await takeHandoff(token)) !== null;
}

/**
 * 드래그 시작 — 페이로드를 만들어 **동기로** 예약하고 번호를 돌려준다.
 * 짐 맡기기(invoke)만 비동기로 뒤따르고, 그 완료는 [`pendingTear`] 가 들고 있다.
 */
export function beginTear(
  tab: TabSpec,
  panes: readonly PaneSpec[],
  sessionOf: (paneId: string) => number | null,
  sharedOf: (paneId: string) => boolean,
  markersOf: (paneId: string) => MarkerDistance[],
  agentLinkOf?: (paneId: string) => AgentLink | null,
  titlesOf?: (paneId: string) => PaneTitleSignals | null,
  workspace?: Omit<TearWorkspace, "savedTab">,
): number {
  const token = newToken();
  const payload = buildTear(tab, panes, sessionOf, sharedOf, markersOf, agentLinkOf, titlesOf);
  if (workspace) {
    const saved = serialize([tab], tab.id).workspaces[0];
    payload.workspace = { ...workspace, savedTab: { ...saved, tabKey: tab.tabKey!, placement: { kind: "main" }, root: assignTileKeys(saved.root) } };
  }
  pending = { token, tabId: tab.id, stashed: stashHandoff(token, payload) };
  remember(pending);
  return token;
}

/**
 * **타일 하나**를 창 밖으로 끌 준비 (docs/log/2026-09-04-pane-tear-out.md).
 *
 * 짐의 모양은 탭 티어아웃과 **완전히 같다** — 받는 창은 언제나 "탭 한 개" 를 꺼내
 * 꽂을 뿐이라, 새 창 쪽 코드는 한 줄도 갈라지지 않는다. 그래서 호출부는 그 타일만 담은
 * 임시 [`TabSpec`](`tabFromPane`)을 지어 넘긴다: 새 창에서는 그 타일 하나짜리
 * 탭이 된다.
 *
 * 예약에 `paneId` 를 함께 적어 두는 것이 탭 경로와의 유일한 차이다 ([`PendingTear.paneId`]).
 */
export function beginPaneTear(
  tab: TabSpec,
  pane: PaneSpec,
  sessionOf: (paneId: string) => number | null,
  sharedOf: (paneId: string) => boolean,
  markersOf: (paneId: string) => MarkerDistance[],
  agentLinkOf?: (paneId: string) => AgentLink | null,
  titlesOf?: (paneId: string) => PaneTitleSignals | null,
  workspace?: Omit<TearWorkspace, "savedTab">,
): number {
  const token = newToken();
  const payload = buildTear(tab, [pane], sessionOf, sharedOf, markersOf, agentLinkOf, titlesOf);
  if (workspace) {
    const saved = serialize([tab], tab.id).workspaces[0];
    // 원래 탭은 sourceTabKey로 찾고, savedTab은 같은 tileKey를 담은 새 탭으로 옮긴다.
    payload.workspace = { ...workspace, savedTab: { ...saved, tabKey: tab.tabKey!, placement: { kind: "main" }, root: assignTileKeys(saved.root) } };
  }
  pending = { token, tabId: tab.id, paneId: pane.id, stashed: stashHandoff(token, payload) };
  remember(pending);
  return token;
}

/** 이번 드래그의 예약 (없으면 null) */
export function pendingTear(): PendingTear | null {
  return pending;
}

/**
 * 드래그 한 판을 끝낸다 (`dragend` · 이관 완료 · 취소 공통).
 *
 * **예약 기록([`offers`])은 지우지 않는다** — 다른 창이 짐을 가져갔다는 소식
 * (workspace release ACK)은 이 시점보다 늦게 오고, 그때 "내 번호인가" 를 물을 곳이 그 기록이다.
 * 기록을 지우는 것은 [`claimTear`] 하나뿐이고, 아무도 안 가져가면 시한에 삭는다.
 */
export function endTear(): void {
  pending = null;
}

/**
 * 커서가 **이 창 밖**에 있는가 (화면 좌표 기준) — 분리 판정의 나머지 절반이다.
 *
 * `dragend` 의 "놓을 곳이 없었다(`dropEffect === "none"`)" 만으로는 창 안에서 실패한
 * 드래그와 구분되지 않는다: 창 안 실패는 아무 일도 없어야 하고, 창 밖은 분리다.
 * `window.screenX/screenY` 는 웹뷰 컨텐츠의 화면 원점이라 제목 표시줄만큼 어긋나지만,
 * 묻는 것이 "밖이냐" 뿐이라 그 오차는 문제가 되지 않는다.
 *
 * 탭 바(`Tabs`)와 타일 헤더(`PaneHost`)가 **같은 판정**을 써야 하므로 여기 둔다 —
 * 두 손잡이가 창 경계를 다르게 읽으면 같은 동작이 어디서 시작했느냐로 갈린다.
 */
export function outsideWindow(ev: DragEvent): boolean {
  const { screenX: x, screenY: y } = ev;
  // WebView2 가 좌표를 안 주는 경우(0,0)에는 분리하지 않는다 — 실수로 창을 만드는 것보다
  // 아무 일도 안 하는 쪽이 되돌리기 쉽다.
  if (x === 0 && y === 0) return false;
  return (
    x < window.screenX ||
    y < window.screenY ||
    x > window.screenX + window.outerWidth ||
    y > window.screenY + window.outerHeight
  );
}

// ---------------------------------------------------------------------------
// 새 창 부팅
// ---------------------------------------------------------------------------

/**
 * 이 창이 **분리로 태어났는가**.
 *
 * 1순위는 Rust 가 초기화 스크립트로 심는 `window.__TEAR_TOKEN__` 이다 — URL 로 실으면
 * `WebviewUrl::App` 이 `#` 를 `%23` 로 인코딩해 SvelteKit 이 없는 라우트(404 흰 화면)를
 * 받는다 (실기에서 발견). 해시 읽기는 예비 경로로만 남긴다.
 * 읽는 즉시 지우므로 새로고침에서 같은 번호를 두 번 찾아가는 일이 없다
 * (사서함도 1회용이지만 죽은 번호를 남길 이유가 없다).
 */
export function takeTearToken(): number | null {
  if (typeof window === "undefined") return null;
  const injected = (window as { __TEAR_TOKEN__?: unknown }).__TEAR_TOKEN__;
  if (typeof injected === "number" && Number.isInteger(injected) && injected >= 0) {
    delete (window as { __TEAR_TOKEN__?: unknown }).__TEAR_TOKEN__;
    return injected;
  }
  const m = /(?:^|[#&])tear=(\d+)/.exec(location.hash);
  if (!m) return null;
  try {
    history.replaceState(null, "", location.pathname + location.search);
  } catch {
    /* 주소를 못 고쳐도 사서함이 1회용이라 무해하다 */
  }
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
