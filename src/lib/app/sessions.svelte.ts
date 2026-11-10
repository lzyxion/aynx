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
 * **패널 → 백엔드 세션 id** 한 벌 (4단계 · docs/log/2026-09-01-port-forward.md).
 *
 * 백엔드 세션 id 는 **`Terminal` 만 안다** — 재연결마다 새로 발급되기 때문이다. 그 값을
 * 쓰는 화면(포워딩·SFTP 브라우저·업로드·원격 편집)은 전부 터미널 **바깥**에 있으므로,
 * `Terminal` → `PaneHost` → 여기로 `onsession(paneId, id|null)` 을 올려 받아 이 표를
 * 유지한다. 이 표가 ⇉ 의 활성 조건이자 모달의 대상이다.
 *
 * 키가 **패널 id** 인 것이 요점이다: 패널이 탭 사이를 옮겨 다니거나 창을 넘어가도 손댈
 * 것이 없고, 표가 `$state` 라 [`sessionOf`] 를 읽는 컴포넌트는 재연결로 id 가 바뀌는 순간
 * **아무 배선 없이** 새 값을 받는다 (재연결을 알리는 이벤트를 따로 만들지 않은 이유).
 */

/** 패널 id → 그 패널이 지금 물고 있는 백엔드 SSH 세션 id (없으면 키가 없다) */
const paneSessions = $state<Record<string, number>>({});

/**
 * 패널 id → **지금 붙어 있는 세션이 붙은 시각**(epoch ms).
 *
 * 관제판의 호스트별 목록이 "경과" 한 칸과 그 말풍선("접속 {시각}")을 그린다
 * (docs/log/2026-09-21-console-host-groups.md). 이 표가 그 값을 쥐는 이유는 **재연결**
 * 때문이다: 재연결은 `noteSession` 을 새 id 로 다시 부르므로 여기서만 "방금 다시 붙었다"
 * 를 정확히 안다. Rust 거울의 `connectedAt` 은 같은 streamId 로 다시 보고돼도 바뀌지
 * 않아, 이 창의 타일에는 이쪽이 맞는 값이다(다른 창·헤드리스 세션은 거울 값을 쓴다).
 *
 * `paneSessions` 와 **같은 박자로** 산다 — 붙으면 찍고 잃으면 지운다.
 */
const paneConnectedAt = $state<Record<string, number>>({});

/** `Terminal` 이 세션을 열었거나(id) 잃었을 때(null) 부른다 */
export function noteSession(paneId: string, sessionId: number | null): void {
  if (sessionId === null) {
    delete paneSessions[paneId];
    delete paneConnectedAt[paneId];
    return;
  }
  // 같은 id 로 다시 불려도(방어) 시계를 되감지 않는다 — 새 id 일 때만 "방금 붙었다" 다.
  if (paneSessions[paneId] !== sessionId) paneConnectedAt[paneId] = Date.now();
  paneSessions[paneId] = sessionId;
  // 예전에는 여기서 "최근 접속한 호스트" 도 적었다 — 세션 id 가 붙은 순간이 곧 **실제로
  // 열린** 순간이라 기록하기에 맞는 자리였다. 그 목록을 읽던 화면(시작 화면의 최근 단)이
  // 통째로 사라지면서 저장소도 함께 지웠다 (2026-09-15 ·
  // docs/log/2026-09-15-start-page-favorites.md §6) — 아무도 읽지 않는 값을 계속 적는
  // 자리가 남으면 다음 사람이 그 목록이 어딘가에 보인다고 믿는다.
}

/**
 * 한 패널이 지금 물고 있는 세션 id (없으면 `null`).
 *
 * **SFTP 타일이 세션을 빌리는 통로**이기도 하다 (docs/log/2026-09-03-sftp-browser-tile.md).
 */
export function sessionOf(paneId: string): number | null {
  return paneSessions[paneId] ?? null;
}

/**
 * 이 패널의 세션이 **붙은 시각**(epoch ms) — 안 붙어 있으면 `null`.
 * 재연결하면 새 값이다 ([`paneConnectedAt`] 머리말).
 */
export function connectedAtOf(paneId: string): number | null {
  return paneConnectedAt[paneId] ?? null;
}

/**
 * 이 세션 id 를 아직 어느 패널이 물고 있는가 — SFTP 모달이 열려 있는 동안 대상이 살아
 * 있는지 보는 값이다 (재연결은 **새 id** 를 만들므로 옛 id 는 여기서 사라진다).
 */
export function liveSession(sessionId: number): boolean {
  return Object.values(paneSessions).includes(sessionId);
}

/** 활성 탭의 활성 패널이 물고 있는 SSH 세션 id (없으면 null = 포워딩 모달을 열 수 없다) */
export function activeSessionId(): number | null {
  const tab = activeTab();
  if (!tab) return null;
  const paneId = paneOf(tab);
  const pane = findPane(tab.root, paneId);
  if (!pane || pane.kind !== "ssh") return null;
  return paneSessions[paneId] ?? null;
}

/**
 * 이 창이 사라질 때 그 창의 세션을 **직접** 정리한다 (창 닫기 · 페이지 언로드).
 *
 * 창을 X 로 닫거나 페이지가 다시 로드되면 웹뷰가 통째로 사라져 `Terminal` 의 언마운트
 * 정리가 돌지 않는다. 그런데 세션은 Rust **전역**이라 창과 함께 죽지 않으므로, 아무도 안
 * 치우면 셸 프로세스와 SSH 연결이 그대로 남는다.
 *
 * 부르는 곳은 **창 닫힘**(`onCloseRequested`) 하나다 (`app/boot.svelte.ts`) — 분리 창 전용이다. 메인 창은
 * 프로세스 자체가 끝난다. 확실한 정리는 백엔드의 창 파괴 그물이 한다(Rust `reap.rs` — 멱등이라 겹쳐도 무해하다).
 *
 * **페이지 언로드(`pagehide`)는 2026-10-08 부터 이 길이 아니다** — 리로드는 세션을 닫지 않고 손을 놓는다
 * ([`leaveWindowSessions`] · 세션 코어 ② — 로컬·SSH). 이 함수는 여전히 **닫는다**(창이 사라진다).
 *
 * 이관으로 비어서 자동으로 닫히는 경우에는 탭이 이미 없으므로 아무 일도 하지 않는다 —
 * **넘겨 준 세션을 여기서 죽이는 일은 없다.** 아직 트리에 남아 있는 채 이관 표시만 걸린
 * 찰나(`markHandoff` ~ 탭 제거 사이)를 위해 [`isHandoff`] 도 함께 본다.
 */
export function closeWindowSessions(): void {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      // 설정·호스트 패널은 세션이 없다 — paneSessions 에 애초에 없지만 kind 도 좁혀 준다.
      const sid = paneSessions[pane.id];
      if (!hasSession(pane.kind) || sid === undefined) continue;
      // 이관 중인 패널의 세션은 **다른 창이 이어받는다** — 여기서 죽이면 받는 창에는
      // 버퍼만 남은 빈 껍데기 타일이 뜬다 (`tear.ts` 의 `handoffPanes` 와 같은 예외다).
      if (isHandoff(pane.id)) continue;
      void closeSessionById(pane.kind, sid);
    }
  }
}

/**
 * 이 창이 세션을 쥔 타일 명세 전부(탭의 타일) — 떠나기 · 체크포인트 · 복원이 데려간 스트림은 이것을 돈다. 사이드 채팅은 v2 부터 PTY 세션이
 * 아니다(세션 서버의 채팅 프로세스 — `app/side-chat-live`) — 여기 들지 않는다.
 */
function windowPanes(): PaneSpec[] {
  return residentWindowTabs().flatMap((tab) => listPanes(tab.root));
}

/**
 * 패널 하나의 **체크포인트**(화면 + 크기 + 그 화면의 출력 오프셋) — 오프셋을 모르면(아직 첫 출력 전 · 옛 채널)
 * 체크포인트도 없다: 화면과 오프셋이 한 순간이어야 재생이 겹치지도 비지도 않는다(이관 짐과 같은 규칙).
 */
function checkpointOf(
  paneId: string,
  scrollback?: number,
): { buffer: string; cols: number; rows: number; consumed: number } | null {
  const snap = snapshotPane(paneId, scrollback);
  if (!snap || typeof snap.consumed !== "number") return null;
  return { buffer: snap.buffer, cols: snap.cols, rows: snap.rows, consumed: snap.consumed };
}

/**
 * **페이지가 떠난다**(F5 · Ctrl+R · 개발 서버 전체 리로드 · 웹뷰가 다시 뜸) — `pagehide` 의 몫
 * (세션 코어 ② · docs/internal/session-server-design-2026-10-08.md 4.3 "죽이는 다섯의 새 뜻").
 *
 * - 세션(**로컬·SSH** — ②-2)은 닫지 않고 **손을 놓는다**(detach) — 화면 체크포인트를 함께 맡긴다. 새 페이지의 같은
 *   타일이 다시 붙는다(`Terminal` 의 붙기). 이 호출이 못 닿아도(언로드 중의 IPC) Rust 의 페이지 로드 그물과 부팅 첫
 *   줄의 `reapWindowSessions` 가 같은 떨어뜨리기를 한다 — 잃는 것은 이번 체크포인트뿐이다(그때는 30초 주기·창이
 *   가려질 때 맡긴 것, 없으면 링만으로 복원). SSH 는 떨어진 동안에도 채널·포워드·SFTP·신호 토큰이 그대로 산다.
 *
 * 창 **닫기**는 이 길이 아니다 — [`closeWindowSessions`](세션 종료)가 먼저 돈다(`watchWindowClose`). 그 뒤 닫히는
 * 문서의 `pagehide` 가 여기로 와도 무해하다: 닫기와 detach 가 엇갈려도 같은 임대의 닫기는 떨어진 세션도 닫고,
 * 남은 것은 창 파괴 거둠(Rust)이 닫는다.
 */
export function leaveWindowSessions(): Promise<void> {
  // 같은 세션을 두 번 놓지 않는다(실기 2026-10-08 — 한 번의 `pagehide` 에 같은 detach 가 두 번 닿았다).
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

/**
 * 이 창의 타일 화면(로컬·SSH)을 **맡겨 둔다**(체크포인트) — 창이 가려질 때 · `beforeunload`. 세션은 그대로다.
 * 웹뷰가 갑자기 죽어도(크래시) 새 페이지가 이 화면부터 그린다(설계 4.3 "맡기는 때").
 */
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
 * 이 창이 지금 그리고 있는 세션 타일들(로컬·SSH)의 스트림 — 복원이 끝났다는 알림(`restoreDoneSessions`)이 "데려간
 * 것" 으로 남겨 둘 목록이다. 아직 붙지 않은 타일(계단 지연 · SSH 연결 대기 — 마운트에서 먼저 붙어 본다)도 들어간다.
 * 쿼리 타일의 DB 연결 열쇠(`query:<tileKey>` — 영속 키가 있는 것만)도 싣는다 — 서버가 데려가지 않은 DB 연결만 떨어진 세션 목록에
 * 올린다(2026-11-09 ②).
 */
export function windowSessionStreams(): string[] {
  const panes = windowPanes();
  return [
    ...panes.filter((pane) => hasSession(pane.kind)).map((pane) => sessionStreamOf(pane)),
    ...panes.filter((pane) => pane.kind === "query" && pane.tileKey).map((pane) => `${QUERY_STREAM_PREFIX}${pane.tileKey}`),
  ];
}

/**
 * 이 SSH 세션 번호를 물고 있는 **이 창의** 원격 타일이 붙은 서버의 신원(`fs-drop-route.ts` 의 `hostIdentity`).
 * 그런 타일이 없거나 신원을 모르면 `null` — 로컬 PTY 세션은 번호 공간이 달라 보지 않는다.
 */
export function hostOfSession(session: number): string | null {
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (pane.kind === "ssh" && paneSessions[pane.id] === session) return hostIdentity(pane);
    }
  }
  return null;
}

/**
 * 파일 타일의 짐을 이 터미널 타일에 놓으면 **같은 곳인가** — 판정 표는 `fs-drop-route.ts`.
 * 드롭 오버레이(`pane/drop-controller`)와 놓은 뒤의 몸통(`app/transfer`)이 같은 답을 보도록 한 곳에 둔다.
 */
export function fsDropRouteTo(pane: PaneSpec, drag: FsDrag, sameWindow: boolean): FsDropRoute {
  if (!hasSession(pane.kind)) return "foreign";
  const target = { kind: pane.kind, session: sessionOf(pane.id), host: hostIdentity(pane) };
  return fsDropRoute(drag.backendKey, sameWindow, target, hostOfSession);
}
