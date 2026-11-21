/**
 * 탭 이관 — 탭 · 타일을 새 창으로 분리하고, 다른 창의 탭으로 합친다 (docs/log/2026-09-02-tear-out.md · 백엔드 `handoff.rs`).
 * 창은 웹뷰가 갈려 객체를 옮길 수 없다 — 세션은 `close` 대신 `detach`([`markHandoff`]) · 출력은 재부착 · 스크롤백은 직렬화해 싣는다.
 * 드래그에는 번호표(token)만 싣고 짐은 Rust 의 1회용 사서함에 맡긴다(분리는 받는 창이 아직 없다).
 */

import { serialize } from "$lib/tabs";
import { assignTileKeys, type SavedWorkspaceTab } from "$lib/workspaces/schema";
import { invoke } from "./ipc";
import { exportHistory, importHistory, type CommandBlock } from "$lib/block-history";
import { adoptTab, type PaneSpec, type TabSpec, type TermSize } from "$lib/session";
import { sanitizeAgentLink, type AgentLink } from "$lib/agent-sessions";
import { sanitizeDocDraft, type DocDraft } from "$lib/doc-draft";
import type { MarkerDistance } from "$lib/shell-integration";
import { currentZoom, screenToLogical } from "$lib/ui-scale";

// ---------------------------------------------------------------------------
// 드래그 종류
// ---------------------------------------------------------------------------

/**
 * `x-aynx-tab` 과 함께 싣는다 — 값은 사서함 번호. 받는 쪽은 `dragover` 에서 종류만 볼 수 있고 값은 못 읽는다.
 */
export const TEAR_DRAG_TYPE = "application/x-aynx-tear";

// ---------------------------------------------------------------------------
// 직렬화 레지스트리
// ---------------------------------------------------------------------------

/** 직렬화는 `dragstart` 안에서 동기로 돈다 — 상한이 없으면 큰 탭을 끄는 순간 창이 멈춘다. `DEFAULT_SCROLLBACK` 과 같은 값 */
export const TEAR_SCROLLBACK = 5000;

/** 보험 체크포인트는 출력이 흐르는 타일마다 30초마다 메인 스레드에서 동기로 돈다 — 크게 잡으면 장시간 구동에서 UI 가 주기적으로 끊긴다 */
export const CHECKPOINT_SCROLLBACK = 1000;

/**
 * 직렬화 문자열은 뜬 그 열 수에서만 줄바꿈을 재현한다 — 받는 터미널은 이 크기로 먼저 되돌린 뒤 버퍼를 쓰고,
 * 마커는 버퍼를 다 쓴 뒤 푼다. 순서가 뒤집히면 xterm 이 리플로해 줄이 밀리고 마커 거리가 어긋난다.
 */
export interface TermSnapshot extends TermSize {
  buffer: string;
  /** `buffer` 를 뜬 같은 순간의 세션 출력 오프셋(Rust 출력 꼬리 링의 축) — 재부착이 이 뒤의 꼬리를 재생한다 */
  consumed?: number;
}

export type SerializeFn = (scrollback?: number) => TermSnapshot;

const serializers = new Map<string, SerializeFn>();

/** 해제는 내가 넣은 그 함수일 때만 지운다(`registerInput` 과 같은 이유) */
export function registerSerialize(paneId: string, fn: SerializeFn): () => void {
  serializers.set(paneId, fn);
  return () => {
    if (serializers.get(paneId) === fn) serializers.delete(paneId);
  };
}

/** 실패해도 이관을 막지 않는다 — "세션은 살아 있고 이력만 비었다" 가 낫다 */
function snapshotOf(paneId: string, scrollback?: number): TermSnapshot | null {
  try {
    return serializers.get(paneId)?.(scrollback) ?? null;
  } catch {
    return null;
  }
}

export function snapshotPane(paneId: string, scrollback?: number): TermSnapshot | null {
  return snapshotOf(paneId, scrollback);
}

// ---------------------------------------------------------------------------
// 이관 중 세션 보호
// ---------------------------------------------------------------------------

/**
 * 다른 창으로 넘어가는 중인 패널 — `Terminal` 언마운트가 `close` 대신 `detach` 를 낸다.
 * 탭을 제거하기 직전에 걸고 제거가 끝나면 푼다.
 */
const handoffPanes = new Set<string>();

export function markHandoff(paneIds: readonly string[]): void {
  for (const id of paneIds) handoffPanes.add(id);
}

export function releaseHandoff(paneIds: readonly string[]): void {
  for (const id of paneIds) handoffPanes.delete(id);
}

export function isHandoff(paneId: string): boolean {
  return handoffPanes.has(paneId);
}

// ---------------------------------------------------------------------------
// 이관 페이로드
// ---------------------------------------------------------------------------

/** 타일에 딸린 부속 상태(이력 · 마커 · 공유 · 대화 연결 · 이름 신호 · 초안)도 실어야 한다 — 빠지면 받는 창에서 말없이 사라진다 */
export interface TearPane {
  /** `id` 는 소스 창의 것 — 받는 쪽이 새로 매긴다 */
  pane: PaneSpec;
  sessionId: number | null;
  buffer: string;
  size?: TermSize;
  consumed?: number;
  history: CommandBlock[];
  /** 줄 번호가 아니라 거리다 — 받는 창의 버퍼는 잘리거나 크기가 달라 절대 줄이 그대로일 수 없다 */
  markers: MarkerDistance[];
  shared: boolean;
  agentLink?: AgentLink | null;
  titles?: PaneTitleSignals | null;
  /** 명세(`pane`)가 아니라 여기다 — 명세는 배치 파일에 적히고 초안은 사서함과 받는 창의 메모리에만 산다 */
  docDraft?: DocDraft | null;
}

/** 패널 id 가 창을 건너며 새로 매겨져 `app/titles` 의 값이 받는 창에 안 보인다 — 그래서 짐에 싣는다 */
export interface PaneTitleSignals {
  oscTitle?: string;
  resolvedShell?: string;
  runningCommand?: string;
}

export function sanitizeTitleSignals(raw: unknown): PaneTitleSignals | null {
  if (!raw || typeof raw !== "object") return null;
  const out: PaneTitleSignals = {};
  for (const key of ["oscTitle", "resolvedShell", "runningCommand"] as const) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

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

/** `dragstart` 안에서 불리므로 동기여야 한다 — 직렬화 비용이 그대로 드래그 시작 지연이다 */
export function buildTear(
  tab: TabSpec,
  panes: readonly PaneSpec[],
  sessionOf: (paneId: string) => number | null,
  sharedOf: (paneId: string) => boolean,
  markersOf: (paneId: string) => MarkerDistance[],
  agentLinkOf?: (paneId: string) => AgentLink | null,
  titlesOf?: (paneId: string) => PaneTitleSignals | null,
  draftOf?: (paneId: string) => DocDraft | null,
): TearPayload {
  return {
    ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {}),
    tab,
    panes: panes.map((pane) => {
      // 버퍼 · 크기 · 출력 오프셋은 한 스냅숏에서 — 사이에 리사이즈 · 출력이 끼면 짐 안에서 어긋난다.
      const snap = snapshotOf(pane.id);
      return {
        pane,
        sessionId: sessionOf(pane.id),
        buffer: snap?.buffer ?? "",
        ...(snap ? { size: { cols: snap.cols, rows: snap.rows } } : {}),
        ...(snap && typeof snap.consumed === "number" ? { consumed: snap.consumed } : {}),
        // 반응형 저장소의 값은 함수로 받는다 — 이 파일이 svelte 런타임 · 터미널에 얽히면 순수 모듈 테스트에서 못 부른다.
        history: exportHistory(pane.id),
        shared: sharedOf(pane.id),
        markers: markersOf(pane.id),
        agentLink: agentLinkOf?.(pane.id) ?? null,
        titles: titlesOf?.(pane.id) ?? null,
        ...draftField(draftOf?.(pane.id) ?? null),
      };
    }),
  };
}

export function parseTear(raw: string): TearPayload | null {
  try {
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== "object") return null;
    const { tab, panes } = o as { tab?: unknown; panes?: unknown };
    if (!tab || typeof tab !== "object" || !Array.isArray(panes)) return null;
    const t = tab as TabSpec;
    if (typeof t.id !== "string" || !t.root) return null;
    const meta = o as TearPayload;
    return { tab: t, panes: (panes as TearPane[]).map(sanitizePaneDraft), workspaceId: meta.workspaceId, workspace: meta.workspace };
  } catch {
    return null;
  }
}

function draftField(draft: DocDraft | null): { docDraft?: DocDraft } {
  return draft ? { docDraft: draft } : {};
}

function sanitizePaneDraft(rec: TearPane): TearPane {
  if (!rec || typeof rec !== "object" || !("docDraft" in rec)) return rec;
  const { docDraft, ...rest } = rec;
  const draft = rest.pane?.kind === "doc" ? sanitizeDocDraft(docDraft) : null;
  return { ...rest, ...draftField(draft) };
}

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

/** 이 값은 받는 창에서 곧바로 `term.resize()` 의 인자가 된다 */
function sanitizeSize(raw: unknown): TermSize | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { cols, rows } = raw as TermSize;
  const sane = (n: number) => Number.isInteger(n) && n >= 2 && n <= 1000;
  return sane(cols) && sane(rows) ? { cols, rows } : undefined;
}

/**
 * 부속 상태는 `adoptTab` 이 id 를 다 매긴 뒤(`옛 id → 새 id`), 타일이 마운트되기 전에 심는다 —
 * 늦으면 `Terminal` 이 마운트 때 `optedIn:false` 로 보고해 서버가 그 타일의 공유 데이터를 지운다.
 * 대화 연결 · 이름 신호는 산 세션을 데려온 타일(`sessionId` 있음)에만 넘긴다.
 */
export function restoreTab(
  payload: TearPayload,
  onShared?: (paneId: string, shared: boolean) => void,
  onAgentLink?: (paneId: string, link: AgentLink) => void,
  onTitles?: (paneId: string, titles: PaneTitleSignals) => void,
  onDocDraft?: (paneId: string, draft: DocDraft) => void,
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
        // 마커는 버퍼를 다 쓴 뒤에야 풀 수 있다(`Terminal.svelte` 의 `t.write` 콜백).
        markers: sanitizeMarkers(rec.markers),
        // 크기는 받는 터미널이 버퍼를 쓰기 전에 쓴다.
        ...(size ? { size } : {}),
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
        onShared?.(newId, rec.shared === true);
        const link = typeof rec.sessionId === "number" ? sanitizeAgentLink(rec.agentLink) : null;
        if (link) onAgentLink?.(newId, link);
        const titles = typeof rec.sessionId === "number" ? sanitizeTitleSignals(rec.titles) : null;
        if (titles) onTitles?.(newId, titles);
        if (rec.docDraft && rec.pane?.kind === "doc") onDocDraft?.(newId, rec.docDraft);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// 사서함 (Rust `handoff.rs`)
// ---------------------------------------------------------------------------

/** 프런트가 만든다 — `dragstart` 는 동기라 백엔드에서 발급받아 실을 수 없다. 겹치면 Rust 가 거절한다 */
function newToken(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
    // 0 은 "번호 없음" 자리로 비워 둔다.
    if (buf[0] !== 0) return buf[0];
  }
  return Math.floor(Math.random() * 0xffff_fffe) + 1;
}

/** 실패해도 throw 하지 않는다 — 드래그는 계속돼야 한다 */
export async function stashHandoff(token: number, payload: TearPayload): Promise<boolean> {
  try {
    await invoke("stash_handoff", { token, payload: JSON.stringify(payload) });
    return true;
  } catch (e) {
    console.error("[aynx] 이관 페이로드를 맡기지 못했습니다:", e);
    return false;
  }
}

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

/** `x` · `y` 는 페이지의 `screenX/Y` — UI 크기(웹뷰 확대)로 나뉘어 오므로 Rust 의 OS 논리 좌표로 되돌려 넘긴다 */
export async function openTearWindow(token: number, x: number, y: number): Promise<void> {
  const f = currentZoom();
  await invoke("open_tear_window", { token, x: screenToLogical(x, f), y: screenToLogical(y, f) });
}

// ---------------------------------------------------------------------------
// 드래그 한 판의 상태 (창 하나에 하나)
// ---------------------------------------------------------------------------

export interface PendingTear {
  token: number;
  /** 타일 티어아웃이면 그 자리에서 지어낸 임시 탭이다 */
  tabId: string;
  /**
   * 타일 하나만 떼는 드래그면 그 타일 id — `dragend` 의 "내 예약인가" 열쇠다
   * (타일은 `PaneHost`, 탭은 `Tabs` 가 정리한다 — 남의 예약을 집으면 엉뚱한 것이 떨어져 나간다).
   */
  paneId?: string;
  stashed: Promise<boolean>;
}

let pending: PendingTear | null = null;

/**
 * 이 창이 내놓은 짐들 — `dragend` 는 대상 창의 workspace release ACK 보다 언제나 먼저라, `pending` 으로 물으면
 * 소스 창이 넘겨 준 탭을 그대로 들고 남는다. 지우는 것은 [`claimTear`] 하나 · 아니면 시한에 삭는다.
 */
const offers = new Map<number, { at: number; tear: PendingTear }>();

/** Rust 사서함의 TTL(5분)과 같은 값 */
const OFFER_TTL_MS = 300_000;

function remember(tear: PendingTear): void {
  const now = Date.now();
  for (const [token, o] of offers) if (now - o.at >= OFFER_TTL_MS) offers.delete(token);
  offers.set(tear.token, { at: now, tear });
}

/** 1회용 — 같은 번호로 두 번 정리하면 이미 남에게 넘어간 탭을 한 번 더 빼려 든다 */
export function claimTear(token: number): PendingTear | null {
  const o = offers.get(token);
  if (!o) return null;
  offers.delete(token);
  if (pending?.token === token) pending = null;
  return o.tear;
}

/**
 * 다른 창에서 온 드래그일 때만 번호를 돌려준다 — 탭 · 타일 id 는 창마다 카운터가 따로라 같은 글자일 수 있어 가르지 못한다.
 */
export function foreignTearToken(dt: DataTransfer | null | undefined): number | null {
  const raw = dt?.getData(TEAR_DRAG_TYPE) ?? "";
  if (raw === "") return null;
  const token = Number(raw);
  if (!Number.isSafeInteger(token) || token <= 0) return null;
  return pendingTear()?.token === token ? null : token;
}

/** `false` = 다른 창이 이미 가져갔다(곧 workspace release ACK 이 와 원본을 뺀다) — 실패가 아니다 */
export async function discardStash(token: number): Promise<boolean> {
  return (await takeHandoff(token)) !== null;
}

export function beginTear(
  tab: TabSpec,
  panes: readonly PaneSpec[],
  sessionOf: (paneId: string) => number | null,
  sharedOf: (paneId: string) => boolean,
  markersOf: (paneId: string) => MarkerDistance[],
  agentLinkOf?: (paneId: string) => AgentLink | null,
  titlesOf?: (paneId: string) => PaneTitleSignals | null,
  workspace?: Omit<TearWorkspace, "savedTab">,
  draftOf?: (paneId: string) => DocDraft | null,
): number {
  const token = newToken();
  const payload = buildTear(tab, panes, sessionOf, sharedOf, markersOf, agentLinkOf, titlesOf, draftOf);
  if (workspace) {
    const saved = serialize([tab], tab.id).workspaces[0];
    payload.workspace = { ...workspace, savedTab: { ...saved, tabKey: tab.tabKey!, placement: { kind: "main" }, root: assignTileKeys(saved.root) } };
  }
  pending = { token, tabId: tab.id, stashed: stashHandoff(token, payload) };
  remember(pending);
  return token;
}

/** 짐의 모양은 탭 티어아웃과 같다 — 부르는 쪽이 그 타일만 담은 임시 탭을 넘긴다 */
export function beginPaneTear(
  tab: TabSpec,
  pane: PaneSpec,
  sessionOf: (paneId: string) => number | null,
  sharedOf: (paneId: string) => boolean,
  markersOf: (paneId: string) => MarkerDistance[],
  agentLinkOf?: (paneId: string) => AgentLink | null,
  titlesOf?: (paneId: string) => PaneTitleSignals | null,
  workspace?: Omit<TearWorkspace, "savedTab">,
  draftOf?: (paneId: string) => DocDraft | null,
): number {
  const token = newToken();
  const payload = buildTear(tab, [pane], sessionOf, sharedOf, markersOf, agentLinkOf, titlesOf, draftOf);
  if (workspace) {
    const saved = serialize([tab], tab.id).workspaces[0];
    // 원래 탭은 sourceTabKey로 찾고, savedTab은 같은 tileKey를 담은 새 탭으로 옮긴다.
    payload.workspace = { ...workspace, savedTab: { ...saved, tabKey: tab.tabKey!, placement: { kind: "main" }, root: assignTileKeys(saved.root) } };
  }
  pending = { token, tabId: tab.id, paneId: pane.id, stashed: stashHandoff(token, payload) };
  remember(pending);
  return token;
}

export function pendingTear(): PendingTear | null {
  return pending;
}

/** 예약 기록([`offers`])은 지우지 않는다 — release ACK 이 이보다 늦게 온다 */
export function endTear(): void {
  pending = null;
}

/** 탭 바와 타일 헤더가 같은 판정을 써야 한다 — `dropEffect === "none"` 만으로는 창 안 실패와 구분되지 않는다 */
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
 * 1순위는 Rust 가 초기화 스크립트로 심는 `__TEAR_TOKEN__` — URL 로 실으면 `WebviewUrl::App` 이 `#` 를 `%23` 로 인코딩해 404 흰 화면이 된다.
 * 해시는 예비 경로. 읽는 즉시 지운다.
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
