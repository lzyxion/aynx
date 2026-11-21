import {
  closeSessionById,
  detachSession,
  findPane,
  hasSession,
  listPanes,
  sessionStreamOf,
  stashCheckpoint,
} from "$lib/session";
import { CHECKPOINT_SCROLLBACK, isHandoff, snapshotPane } from "$lib/tear";
import type { FsDrag } from "$lib/fs-drag";
import { fsDropRoute, hostIdentity, type FsDropRoute } from "$lib/fs-drop-route";
import type { PaneSpec } from "$lib/session/spec";
import { QUERY_STREAM_PREFIX } from "$lib/session/detached";
import {
  activeTab,
  findPaneAnywhere,
  paneOf,
  residentWindowTabs,
} from "$lib/app/tabs.svelte.js";

/**
 * 패널 id → 백엔드 세션 id. 세션 id 는 재연결마다 새로 발급되고 `Terminal` 만 안다 — 키가 패널 id 라 탭 · 창을 옮겨도
 * 손댈 것이 없고, `$state` 라 읽는 쪽이 재연결 이벤트 없이 새 id 를 받는다.
 */
const paneSessions = $state<Record<string, number>>({});

/**
 * 재연결 때 새로 찍힌다 — Rust 거울의 `connectedAt` 은 같은 streamId 로 다시 보고돼도 바뀌지 않아 이 창의 타일에는 이쪽이 맞다.
 */
const paneConnectedAt = $state<Record<string, number>>({});

export function noteSession(paneId: string, sessionId: number | null): void {
  if (sessionId === null) {
    delete paneSessions[paneId];
    delete paneConnectedAt[paneId];
    return;
  }
  if (paneSessions[paneId] !== sessionId) paneConnectedAt[paneId] = Date.now();
  paneSessions[paneId] = sessionId;
}

export function sessionOf(paneId: string): number | null {
  return paneSessions[paneId] ?? null;
}

/** epoch ms */
export function connectedAtOf(paneId: string): number | null {
  return paneConnectedAt[paneId] ?? null;
}

export function liveSession(sessionId: number): boolean {
  return Object.values(paneSessions).includes(sessionId);
}

export function activeSessionId(): number | null {
  const tab = activeTab();
  if (!tab) return null;
  const paneId = paneOf(tab);
  const pane = findPane(tab.root, paneId);
  if (!pane || pane.kind !== "ssh") return null;
  return paneSessions[paneId] ?? null;
}

/**
 * 창 닫기 전용 — 세션을 닫는다. 리로드(`pagehide`)는 이 길이 아니다(닫지 않고 손을 놓는다 — [`leaveWindowSessions`]).
 * 확실한 정리는 Rust 창 파괴 그물(`reap.rs`)이 한다 — 멱등이라 겹쳐도 무해하다.
 */
export function closeWindowSessions(): void {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      const sid = paneSessions[pane.id];
      if (!hasSession(pane.kind) || sid === undefined) continue;
      // 이관 중인 세션은 다른 창이 이어받는다 — 죽이면 받는 창에 빈 껍데기 타일이 뜬다(`tear.ts` 의 `handoffPanes` 와 같은 예외)
      if (isHandoff(pane.id)) continue;
      void closeSessionById(pane.kind, sid);
    }
  }
}

function windowPanes(): PaneSpec[] {
  return residentWindowTabs().flatMap((tab) => listPanes(tab.root));
}

/** 오프셋을 모르면 체크포인트도 없다 — 화면과 오프셋이 한 순간이어야 재생이 겹치지도 비지도 않는다 */
function checkpointOf(
  paneId: string,
  scrollback?: number,
): { buffer: string; cols: number; rows: number; consumed: number } | null {
  const snap = snapshotPane(paneId, scrollback);
  if (!snap || typeof snap.consumed !== "number") return null;
  return { buffer: snap.buffer, cols: snap.cols, rows: snap.rows, consumed: snap.consumed };
}

/**
 * 페이지가 떠날 때(`pagehide`) — 세션은 닫지 않고 손을 놓는다(detach). 이 호출이 못 닿아도 Rust 페이지 로드 그물과 부팅의
 * `reapWindowSessions` 가 같은 떨어뜨리기를 한다 — 잃는 것은 이번 체크포인트뿐이다.
 * 창 닫기 뒤의 `pagehide` 가 와도 무해하다 — 같은 임대의 닫기는 떨어진 세션도 닫는다.
 */
export function leaveWindowSessions(): Promise<void> {
  // 한 번의 `pagehide` 에 같은 detach 가 두 번 닿은 적이 있다 — 같은 세션은 한 번만 놓는다
  const seen = new Set<string>();
  const sent: Promise<void>[] = [];
  for (const pane of windowPanes()) {
    const sid = paneSessions[pane.id];
    if (!hasSession(pane.kind) || sid === undefined) continue;
    if (isHandoff(pane.id) || seen.has(`${pane.kind}:${sid}`)) continue;
    seen.add(`${pane.kind}:${sid}`);
    sent.push(detachSession(pane.kind, sid, checkpointOf(pane.id)));
  }
  // `pagehide` 는 기다리지 않는다(언로드 중) — 앱 종료(quitAll)는 이것을 기다린 뒤 끊는다(`leaveSessions` 창 요청).
  return Promise.all(sent).then(() => {});
}

/** 웹뷰가 크래시해도 새 페이지가 이 화면부터 그린다 — 세션은 그대로다 */
export function stashWindowCheckpoints(): void {
  const seen = new Set<string>();
  for (const pane of windowPanes()) {
    const sid = paneSessions[pane.id];
    if (!hasSession(pane.kind) || sid === undefined || isHandoff(pane.id)) continue;
    if (seen.has(`${pane.kind}:${sid}`)) continue;
    seen.add(`${pane.kind}:${sid}`);
    // 보험(크래시용)이라 짧게 — 떠나기(detach)·이관은 전체를 뜬다(`CHECKPOINT_SCROLLBACK` 주석)
    const cp = checkpointOf(pane.id, CHECKPOINT_SCROLLBACK);
    if (cp) stashCheckpoint(pane.kind, sid, cp);
  }
}

/**
 * `restoreDoneSessions` 의 "데려간 것" — 여기 빠진 스트림은 서버가 떨어진 세션 목록에 올린다. 아직 붙지 않은 타일과
 * 쿼리 타일의 DB 연결 열쇠도 들어가야 한다.
 */
export function windowSessionStreams(): string[] {
  const panes = windowPanes();
  return [
    ...panes.filter((pane) => hasSession(pane.kind)).map((pane) => sessionStreamOf(pane)),
    ...panes.filter((pane) => pane.kind === "query" && pane.tileKey).map((pane) => `${QUERY_STREAM_PREFIX}${pane.tileKey}`),
  ];
}

/** 로컬 PTY 세션은 번호 공간이 달라 보지 않는다 */
export function hostOfSession(session: number): string | null {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.kind === "ssh" && paneSessions[pane.id] === session) return hostIdentity(pane);
    }
  }
  return null;
}

/** 드롭 오버레이와 놓은 뒤의 몸통이 같은 답을 보도록 한 곳에 둔다 */
export function fsDropRouteTo(pane: PaneSpec, drag: FsDrag, sameWindow: boolean): FsDropRoute {
  if (!hasSession(pane.kind)) return "foreign";
  const target = { kind: pane.kind, session: sessionOf(pane.id), host: hostIdentity(pane) };
  return fsDropRoute(drag.backendKey, sameWindow, target, hostOfSession);
}
