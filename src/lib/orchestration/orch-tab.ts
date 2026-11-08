/**
 * **오케스트레이션 탭의 순수 판정**(2026-10-29 — docs/log/2026-10-29-orchestration-player-tab.md D1 · D2 · D3 · D11 · 0-3 Q1=B).
 *
 * 오케스트레이션 탭 = 평범한 `TabSpec` + 경로 표지 `orch` + **앱이 쥔 고정 배치**:
 *
 * | 모양 | `orch` | 트리 |
 * | --- | --- | --- |
 * | 라이브러리·아티스트 | `{view:library|artists}` | 플레이어 한 잎 |
 * | 스튜디오 | `{view:studio,repo}` | 플레이어 한 잎 |
 * | 준비 중 | `{view:new}` | 기존 새 앨범 칸 + 플레이어(F2가 초안을 이어받음) |
 * | 앨범·트랙 | `{view:album|track,runId,taskId?,attemptId?,fromRepo?}` | 프로듀서 잎이 있으면 좌우 분할, 없으면 플레이어 한 잎 |
 *
 * 프로듀서 채팅 잎의 서버 연결은 기존 것을 쓴다. 옛 표지는 복구하지 않고 라이브러리로 버린다.
 *
 * 재생 막대는 타일이 아니라 탭 캔버스 아래 띠다 — 타일 사각형은 [`ORCH_CANVAS`](아래 [`ORCH_BAR_PX`] 를 뺀 캔버스) 안에서 편다.
 * 이 파일은 상태를 보지 않는다(시험 `orch-tab.test.ts`) — 탭을 고치는 것은 `app/orchestration.svelte.ts` · 탭 모양 맞추기는
 * `app/orch-tab-repair.svelte.ts`.
 */

import type { Rect } from "$lib/layout";
import type { OrchMark, PaneNode, PaneSpec, ProducerSpec, TabSpec } from "$lib/session/spec";
import { listPanes } from "$lib/session/tree";

/** 재생 막대 띠의 높이(px) — 거터(8px)를 포함한다(띠의 카드는 그 안에서 `GAP` 만큼 띄운다 — 카드 96px = 목업 `TransportBar`) */
export const ORCH_BAR_PX = 104;

/**
 * 프로듀서 칸(왼쪽)의 폭 = 캔버스 폭 × `PRODUCER_SHARE` + `PRODUCER_PX`(분할의 고정 px 몫 — `PaneSplit.px`). 앨범 · 트랙 화면은 같은 분할 하나라
 * 채팅 폭은 두 화면에서 늘 같다. 1400 창에서 약 360(목업 V3AlbumSideLive · V3TrackSide 340~360 — 그래야 앨범 판의 오른쪽 세부 칸이 선다),
 * 620 창에서도 약 215(예전 비율 0.36 과 같은 폭 — 좁은 창에서 채팅이 무너지지 않는다) · 1600 약 400 · 1000 약 290(10-31).
 * 비율 하나로는 둘을 다 못 맞춘다(0.26 이면 1400 은 360 이지만 620 은 150 — 채팅 머리 · 안내가 넘친다).
 */
export const PRODUCER_SHARE = 0.185;
export const PRODUCER_PX = 108;

/** 오케스트레이션 탭의 타일 캔버스 — 탭 캔버스에서 아래 막대 띠를 뺀 사각형(`computeLayout` 의 뿌리) */
export const ORCH_CANVAS: Rect = {
  x: { pct: 0, px: 0 },
  y: { pct: 0, px: 0 },
  w: { pct: 100, px: 0 },
  h: { pct: 100, px: -ORCH_BAR_PX },
};

export type OrchShape = "home" | "preparing" | "album";

/** 오케스트레이션 탭인가 */
export function isOrchTab(tab: Pick<TabSpec, "orch"> | null | undefined): boolean {
  return !!tab?.orch;
}

/** 프로듀서 채팅 id 머리(서버 `ID_PREFIX`) — 사이드 채팅 id 와 섞이지 않는다 */
export const PRODUCER_CHAT_PREFIX = "pc-";

/** 새 프로듀서 채팅 id(`pc-` + uuid — 폴더 이름 하나 · 서버 `id_ok`) */
export function newProducerChatId(): string {
  const u =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${PRODUCER_CHAT_PREFIX}${u}`;
}

/** 채팅 id 모양(서버 `id_ok` 와 같은 꼴 — `pc-` + 영숫자 · `-`) */
export function producerChatIdOk(id: unknown): id is string {
  return typeof id === "string" && id.length <= 80 && /^pc-[A-Za-z0-9-]+$/.test(id);
}

/** 짧은 낱말 칸(CLI · 모델 · 강도 — 서버 `word_ok` 근사) */
const WORD_RE = /^[A-Za-z0-9._:[\]-]{0,64}$/;

/** 저장 · 이관 · 거울의 `producer` 칸 파싱(순수) — 채팅 id 가 틀리면 `null`(복원이 새 id 로 다시 짓는다) */
export function parseProducerSpec(raw: unknown): ProducerSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!producerChatIdOk(r.chatId)) return null;
  const word = (v: unknown) => (typeof v === "string" && WORD_RE.test(v) ? v : "");
  const out: ProducerSpec = {
    chatId: r.chatId,
    cli: word(r.cli),
    model: word(r.model),
    effort: word(r.effort),
    studio: typeof r.studio === "string" && r.studio.length <= 4096 ? r.studio : "",
  };
  if (r.opened === true) out.opened = true;
  if (typeof r.conv === "string" && /^[A-Za-z0-9-]{8,80}$/.test(r.conv)) out.conv = r.conv;
  const fork = parseForkFrom(r.forkFrom);
  if (fork) out.forkFrom = fork;
  return out;
}

/** 갈라 온 원본 칸(단계 5) — `{agent: claude | codex, conv: 대화 id}` 만 · 틀리면 `null` */
function parseForkFrom(raw: unknown): { agent: string; conv: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if ((r.agent !== "claude" && r.agent !== "codex") || typeof r.conv !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(r.conv)) return null;
  return { agent: r.agent, conv: r.conv };
}

/** 저장할 모양(키 순서 고정 · 빈 선택 칸은 싣지 않는다) */
export function saveProducerSpec(p: ProducerSpec): ProducerSpec {
  const out: ProducerSpec = { chatId: p.chatId, cli: p.cli, model: p.model, effort: p.effort, studio: p.studio };
  if (p.opened === true) out.opened = true;
  if (p.conv) out.conv = p.conv;
  if (p.forkFrom) out.forkFrom = { agent: p.forkFrom.agent, conv: p.forkFrom.conv };
  return out;
}

/** 그 탭의 프로듀서 채팅 잎(첫 `kind:"producer"`) — 오케스트레이션 탭이 아니면 `null` */
export function producerLeafOf(tab: Pick<TabSpec, "orch" | "root">): PaneSpec | null {
  if (!tab.orch) return null;
  return listPanes(tab.root).find((p) => p.kind === "producer" && !!p.producer) ?? null;
}

/** 그 채팅의 프로듀서 잎을 든 탭(보드 배치 `{runId, chat}` — 채팅과 탭은 1:1) */
export function tabOfProducerChat<T extends Pick<TabSpec, "orch" | "root">>(tabs: readonly T[], chat: string): T | null {
  return tabs.find((t) => producerLeafOf(t)?.producer?.chatId === chat) ?? null;
}

/**
 * 프로듀서 잎을 더해야 하는 초안 경로인가. 라이브러리·아티스트에서는 더하지 않는다.
 */


/** 그 탭의 플레이어 잎(첫 `kind:"run"`) — 오케스트레이션 탭이 아니면 `null` */
export function playerPaneOf(tab: Pick<TabSpec, "orch" | "root">): PaneSpec | null {
  if (!tab.orch) return null;
  return listPanes(tab.root).find((p) => p.kind === "run") ?? null;
}

/** 탭이 보여 주는 앨범 — 표지의 `runId`(없으면 `null`) */
export function albumRunId(tab: Pick<TabSpec, "orch">): string | null {
  const id = orchPath(tab).runId;
  return id ? id : null;
}

/** 탭 모양(D2) — 오케스트레이션 탭이 아니면 `null` */
export function orchShape(tab: Pick<TabSpec, "orch" | "root">): OrchShape | null {
  if (!tab.orch) return null;
  if (albumRunId(tab) !== null) return "album";
  return orchPath(tab).view === "new" ? "preparing" : "home";
}

/** 고정 배치의 뿌리 — 프로듀서 채팅 잎이 있으면 좌우 분할(왼쪽 프로듀서), 없으면 플레이어 잎 하나 */
export function orchRoot(producer: PaneSpec | null, player: PaneSpec, ratio = PRODUCER_SHARE, px = PRODUCER_PX): PaneNode {
  const b: PaneNode = { type: "leaf", pane: player };
  if (producer === null) return b;
  return { type: "split", dir: "row", ratio, ...(px ? { px } : {}), a: { type: "leaf", pane: producer }, b };
}

/** 그 앨범의 탭(첫 번째 — 같은 Run 의 탭이 둘이면 여는 길은 첫 번째로 · 노트 1-4) */
export function findAlbumTab<T extends Pick<TabSpec, "orch">>(tabs: readonly T[], runId: string): T | null {
  return tabs.find((t) => albumRunId(t) === runId) ?? null;
}

/** 홈 탭(앨범도 프로듀서도 없는 오케스트레이션 탭 — 창마다 하나면 된다) */
export function findHomeTab<T extends Pick<TabSpec, "orch" | "root">>(tabs: readonly T[]): T | null {
  return tabs.find((t) => !!t.orch && orchPath(t).view === "library") ?? null;
}

/** 지금 워크스페이스 목록에서 현재 오케스트레이션 탭을 우선한다. 다른 앨범 탭으로 건너뛰지 않는다. */
export function orchNavigationTab<T extends Pick<TabSpec, "id" | "orch">>(tabs: readonly T[], currentId: string | null): T | null {
  return tabs.find((tab) => tab.id === currentId && isOrchTab(tab)) ?? tabs.find(isOrchTab) ?? null;
}

/** 보드 자동 배치 → 앨범 탭 배치의 계획(D3) */
/** 저장 · 이관 · 거울의 경로 파싱 — 표지가 없으면 null, 모르는 표지는 라이브러리. */
export function parseOrchMark(raw: unknown): OrchMark | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return { view: "library" };
  const r = raw as Record<string, unknown>;
  const id = (v: unknown) => typeof v === "string" && v.trim() && v.length <= 128 && !/[\x00-\x1f\x7f]/.test(v) ? v.trim() : null;
  // 저장소는 서버 문자열이 곧 열쇠라 다듬지 않는다(`model/library` 와 같다) · 길이는 프로듀서 칸 `studio` 와 같은 상한.
  const repoKey = (v: unknown) => typeof v === "string" && v.trim() && v.length <= 4096 && !/[\x00-\x1f\x7f]/.test(v) ? v : null;
  if (r.view === "library" || r.view === "artists") return { view: r.view };
  const fromRepo = repoKey(r.fromRepo);
  const from = fromRepo ? { fromRepo } : {};
  if (r.view === "new") return { view: "new", ...from };
  const repo = repoKey(r.repo);
  if (r.view === "studio" && repo) return { view: "studio", repo };
  const runId = id(r.runId);
  if (r.view === "album" && runId) return { view: "album", runId, ...from };
  const taskId = id(r.taskId);
  if (r.view === "track" && runId && taskId) {
    const attemptId = id(r.attemptId);
    return { view: "track", runId, taskId, ...(attemptId ? { attemptId } : {}), ...from };
  }
  return { view: "library" };
}

/** 저장할 모양(키 순서 고정 — 같은 배치면 같은 글자) */
export function saveOrchMark(m: OrchMark | undefined): OrchMark | undefined {
  if (!m) return undefined;
  return parseOrchMark(m) ?? { view: "library" };
}

/** 파싱된 현재 경로 — 옛 표지의 runId로 이동하지 않는다. */
export function orchPath(tab: Pick<TabSpec, "orch">): OrchMark {
  return parseOrchMark(tab.orch) ?? { view: "library" };
}

/** 앨범 위 화면 — 스튜디오를 거쳐 왔으면 그 스튜디오, 아니면 라이브러리 */
export function albumParentPath(path: OrchMark): OrchMark {
  const from = parseOrchMark(path)?.fromRepo;
  return from ? { view: "studio", repo: from } : { view: "library" };
}

/** 한 단계 위. 트랙의 시도 선택은 같은 단계다. 트랙 → 앨범은 출발 스튜디오를 그대로 든다. */
export function parentOrchPath(path: OrchMark): OrchMark {
  const p = parseOrchMark(path);
  if (p?.view === "track") return { view: "album", runId: p.runId, ...(p.fromRepo ? { fromRepo: p.fromRepo } : {}) };
  return p?.view === "album" || p?.view === "new" ? albumParentPath(p) : { view: "library" };
}

/**
 * 새 앨범을 시작한 뒤의 경로 — 스튜디오 화면에서 연 초안이고 **그 스튜디오에서 시작했을 때만** 출발을 잇는다.
 * 초안에서 다른 저장소로 바꿨으면 돌아갈 곳이 그 앨범의 스튜디오가 아니므로 잇지 않는다.
 */
export function startedAlbumPath(current: OrchMark, runId: string, repo: string): OrchMark {
  return { view: "album", runId, ...(current.view === "new" && current.fromRepo === repo ? { fromRepo: repo } : {}) };
}

/** 같은 앨범 안에서 움직이는 경로에 붙일 출발 스튜디오 — 다른 앨범으로 가면 잇지 않는다 */
export function keepAlbumOrigin(current: OrchMark, runId: string | null | undefined): { fromRepo?: string } {
  return runId && current.runId === runId && current.fromRepo ? { fromRepo: current.fromRepo } : {};
}

/** 입력·메뉴·대화상자와 IME의 Esc는 그 자리에서 처리한다. DOM 없이도 시험할 수 있다. */
export function orchEscapeAllowed(e: Pick<KeyboardEvent, "key" | "code" | "defaultPrevented" | "isComposing" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, blocked: boolean): boolean {
  return e.key === "Escape" && !e.isComposing && !e.defaultPrevented && !blocked && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
}

export function orchEscapeTargetBlocked(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]');
}

/**
 * 앱이 쥔 배치가 무너졌는지(사람이 플레이어를 닫음 · 손 편집) — 플레이어 잎이 없으면 표지가 뜻을 잃는다. 부르는 쪽이 표지를 걷는다
 * (탭은 보통 탭으로 — 그 안의 타일은 그대로).
 */
export function orchBroken(tab: Pick<TabSpec, "orch" | "root">): boolean {
  return !!tab.orch && playerPaneOf(tab) === null;
}
