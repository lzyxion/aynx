/**
 * 오케스트레이션 탭 = 평범한 `TabSpec` + 경로 표지 `orch` + 앱이 쥔 고정 배치(앨범 · 트랙은 프로듀서 잎이 있으면 좌우 분할). 상태는 보지 않는다.
 * 옛 표지는 복구하지 않고 라이브러리로 버린다. 재생 막대는 타일이 아니라 탭 캔버스 아래 띠이고 타일은 `ORCH_CANVAS` 안에서 편다.
 */

import type { Rect } from "$lib/layout";
import type { OrchMark, PaneNode, PaneSpec, ProducerSpec, TabSpec } from "$lib/session/spec";
import { listPanes } from "$lib/session/tree";

/** 거터(8px)를 포함한다 — 띠의 카드는 그 안에서 `GAP` 만큼 띄운다 */
export const ORCH_BAR_PX = 104;

/** 비율 하나로는 넓은 창과 좁은 창의 채팅 폭을 다 못 맞춘다 — 비율 + 고정 px(`PaneSplit.px`) */
export const PRODUCER_SHARE = 0.185;
export const PRODUCER_PX = 108;

export const ORCH_CANVAS: Rect = {
  x: { pct: 0, px: 0 },
  y: { pct: 0, px: 0 },
  w: { pct: 100, px: 0 },
  h: { pct: 100, px: -ORCH_BAR_PX },
};

export type OrchShape = "home" | "preparing" | "album";

export function isOrchTab(tab: Pick<TabSpec, "orch"> | null | undefined): boolean {
  return !!tab?.orch;
}

/** 서버 `ID_PREFIX` 와 같은 값 — 사이드 채팅 id 와 섞이지 않는다 */
export const PRODUCER_CHAT_PREFIX = "pc-";

/** 폴더 이름 하나 · 서버 `id_ok` */
export function newProducerChatId(): string {
  const u =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${PRODUCER_CHAT_PREFIX}${u}`;
}

/** 서버 `id_ok` 와 같은 꼴 */
export function producerChatIdOk(id: unknown): id is string {
  return typeof id === "string" && id.length <= 80 && /^pc-[A-Za-z0-9-]+$/.test(id);
}

/** 서버 `word_ok` 근사 */
const WORD_RE = /^[A-Za-z0-9._:[\]-]{0,64}$/;

/** 채팅 id 가 틀리면 `null` — 복원이 새 id 로 다시 짓는다 */
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

function parseForkFrom(raw: unknown): { agent: string; conv: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if ((r.agent !== "claude" && r.agent !== "codex") || typeof r.conv !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(r.conv)) return null;
  return { agent: r.agent, conv: r.conv };
}

export function saveProducerSpec(p: ProducerSpec): ProducerSpec {
  const out: ProducerSpec = { chatId: p.chatId, cli: p.cli, model: p.model, effort: p.effort, studio: p.studio };
  if (p.opened === true) out.opened = true;
  if (p.conv) out.conv = p.conv;
  if (p.forkFrom) out.forkFrom = { agent: p.forkFrom.agent, conv: p.forkFrom.conv };
  return out;
}

export function producerLeafOf(tab: Pick<TabSpec, "orch" | "root">): PaneSpec | null {
  if (!tab.orch) return null;
  return listPanes(tab.root).find((p) => p.kind === "producer" && !!p.producer) ?? null;
}

/** 채팅과 탭은 1:1 */
export function tabOfProducerChat<T extends Pick<TabSpec, "orch" | "root">>(tabs: readonly T[], chat: string): T | null {
  return tabs.find((t) => producerLeafOf(t)?.producer?.chatId === chat) ?? null;
}

export function playerPaneOf(tab: Pick<TabSpec, "orch" | "root">): PaneSpec | null {
  if (!tab.orch) return null;
  return listPanes(tab.root).find((p) => p.kind === "run") ?? null;
}

export function albumRunId(tab: Pick<TabSpec, "orch">): string | null {
  const id = orchPath(tab).runId;
  return id ? id : null;
}

export function orchShape(tab: Pick<TabSpec, "orch" | "root">): OrchShape | null {
  if (!tab.orch) return null;
  if (albumRunId(tab) !== null) return "album";
  return orchPath(tab).view === "new" ? "preparing" : "home";
}

export function orchRoot(producer: PaneSpec | null, player: PaneSpec, ratio = PRODUCER_SHARE, px = PRODUCER_PX): PaneNode {
  const b: PaneNode = { type: "leaf", pane: player };
  if (producer === null) return b;
  return { type: "split", dir: "row", ratio, ...(px ? { px } : {}), a: { type: "leaf", pane: producer }, b };
}

/** 같은 Run 의 탭이 둘이면 여는 길은 첫 번째로 */
export function findAlbumTab<T extends Pick<TabSpec, "orch">>(tabs: readonly T[], runId: string): T | null {
  return tabs.find((t) => albumRunId(t) === runId) ?? null;
}

export function findHomeTab<T extends Pick<TabSpec, "orch" | "root">>(tabs: readonly T[]): T | null {
  return tabs.find((t) => !!t.orch && orchPath(t).view === "library") ?? null;
}

export function orchNavigationTab<T extends Pick<TabSpec, "id" | "orch">>(tabs: readonly T[], currentId: string | null): T | null {
  return tabs.find((tab) => tab.id === currentId && isOrchTab(tab)) ?? tabs.find(isOrchTab) ?? null;
}

export function parseOrchMark(raw: unknown): OrchMark | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return { view: "library" };
  const r = raw as Record<string, unknown>;
  const id = (v: unknown) => typeof v === "string" && v.trim() && v.length <= 128 && !/[\x00-\x1f\x7f]/.test(v) ? v.trim() : null;
  // 저장소는 서버 문자열이 곧 열쇠라 다듬지 않는다(`model/library` 와 같다) · 길이 상한은 프로듀서 칸 `studio` 와 같다.
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

/** 키 순서 고정 — 같은 배치면 같은 글자 */
export function saveOrchMark(m: OrchMark | undefined): OrchMark | undefined {
  if (!m) return undefined;
  return parseOrchMark(m) ?? { view: "library" };
}

export function orchPath(tab: Pick<TabSpec, "orch">): OrchMark {
  return parseOrchMark(tab.orch) ?? { view: "library" };
}

export function albumParentPath(path: OrchMark): OrchMark {
  const from = parseOrchMark(path)?.fromRepo;
  return from ? { view: "studio", repo: from } : { view: "library" };
}

export function parentOrchPath(path: OrchMark): OrchMark {
  const p = parseOrchMark(path);
  if (p?.view === "track") return { view: "album", runId: p.runId, ...(p.fromRepo ? { fromRepo: p.fromRepo } : {}) };
  return p?.view === "album" || p?.view === "new" ? albumParentPath(p) : { view: "library" };
}

/** 초안에서 다른 저장소로 바꿨으면 돌아갈 곳이 그 앨범의 스튜디오가 아니라 출발을 잇지 않는다 */
export function startedAlbumPath(current: OrchMark, runId: string, repo: string): OrchMark {
  return { view: "album", runId, ...(current.view === "new" && current.fromRepo === repo ? { fromRepo: repo } : {}) };
}

export function keepAlbumOrigin(current: OrchMark, runId: string | null | undefined): { fromRepo?: string } {
  return runId && current.runId === runId && current.fromRepo ? { fromRepo: current.fromRepo } : {};
}

export function orchEscapeAllowed(e: Pick<KeyboardEvent, "key" | "code" | "defaultPrevented" | "isComposing" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, blocked: boolean): boolean {
  return e.key === "Escape" && !e.isComposing && !e.defaultPrevented && !blocked && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
}

export function orchEscapeTargetBlocked(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]');
}

/** 플레이어 잎이 없으면 표지가 뜻을 잃는다 — 부르는 쪽이 표지를 걷는다(탭은 보통 탭으로 · 그 안의 타일은 그대로) */
export function orchBroken(tab: Pick<TabSpec, "orch" | "root">): boolean {
  return !!tab.orch && playerPaneOf(tab) === null;
}
