/**
 * **이 창의 세션 타일 → `ConsoleRow[]`** — 세션 카드 판(`window-cards.ts` → 세션 목록 판 · 상태바 세션 칸 · 탭 줄의
 * 워크스페이스 목록)과 작업안(`PlansView`)이 **한 함수**에서 같은 재료를 받는다. (처음엔 관제판과 상태바 호스트 칩이
 * 나눠 썼다 — 둘 다 2026-10-07 에 걷혔다.)
 *
 * 앞서는 이 조립이 `Console.svelte` 안의 `$derived.by` 하나였다. 띠의 중앙 칸이 같은 재료를
 * 쓰게 되면서 **두 벌이 될 자리**가 생겼고(관제판이 닫혀 있어도 띠는 그려야 한다), 두 벌이면
 * 한쪽만 칸을 늘리는 사고가 난다 — 그래서 몸통만 여기로 내린다.
 *
 * `.svelte.ts`(룬 모듈)가 **아니다** — 이 함수는 `$state` 를 만들지 않고 **읽기만** 한다.
 * 호출부가 `$derived.by` 안에서 부르면 그 읽기들이 그대로 의존성으로 등록되므로 반응성은
 * 예전과 같다(`blocksVersionOf()` 를 첫 줄에서 읽는 이유도 그것이다).
 */

import { auxWindowRows } from "$lib/app/workspace-status.svelte.js";
import { blocksVersionOf } from "$lib/app/console.svelte.js";
import { statusOf, stickyOf, residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { connectedAtOf, sessionOf } from "$lib/app/sessions.svelte.js";
import { paneAiReadable } from "$lib/app/delegation.svelte.js";
import { dbConns } from "$lib/app/db-conns.svelte.js";
import { hasSession, listPanes, paneName, type Tr } from "$lib/session";
import { lastBlock } from "$lib/block-history";
import { currentWindowLabel, tileCode } from "$lib/context";
import { buildRows, type ConsoleRow, type ConsoleRowInput } from "./console-rows";

/**
 * 이 창의 모든 탭·타일에서 **세션이 있는 것만** 골라 행으로 세운다. 순서는 화면에서 읽는
 * 순서(탭 순서 · 타일 왼쪽·위 우선)이다.
 */
export function windowRows(tr: Tr): ConsoleRow[] {
  blocksVersionOf(); // 블록 버전에 의존 — status 전이 때 명령·종료 코드를 다시 읽는다
  const label = currentWindowLabel();
  const inputs: ConsoleRowInput[] = [];
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (!hasSession(pane.kind)) continue; // 세션 없는 타일(settings·sftp·localfs·start) 제외
      const block = lastBlock(pane.id); // 저장소 키는 pane.id 다 (거울 키 streamId 와 다르다)
      inputs.push({
        streamId: pane.historyStreamId ?? pane.id,
        tabId: tab.id, // 클릭 점프 대상 (focusTile)
        paneId: pane.id,
        attention: stickyOf(pane.id), // 안 본 결과 — 라이브(`stickyStatus` 가 $state)
        code: tileCode(label, pane.id),
        label: paneName(pane, tr),
        status: statusOf(pane.id),
        connected: sessionOf(pane.id) !== null,
        lastCommand: block?.commandLine ?? null,
        exit: block?.exit ?? null,
        // ── 호스트별 묶음이 읽는 칸 (docs/log/2026-09-21-console-host-groups.md) ──
        kind: pane.kind === "ssh" ? "ssh" : "local",
        // 별칭 타일과 빠른 접속 타일을 **여기서** 가른다 — 빠른 접속의 `alias` 는 설정의
        // 별칭이 아니라 화면 이름(`user@host:port`)이라 같은 칸에 담으면 묶음이 섞인다
        // (`session.ts` 의 `PaneSpec.adhoc` 머리말과 같은 규칙).
        alias: pane.kind === "ssh" && !pane.adhoc ? (pane.alias ?? null) : null,
        adhoc: pane.kind === "ssh" && pane.adhoc ? (pane.alias ?? null) : null,
        // AI 에게 보이는가 — 로컬은 타일 토글, 원격은 호스트의 AI 권한 단계 (`paneAiReadable`)
        shared: paneAiReadable(pane),
        connectedAt: connectedAtOf(pane.id),
        lastActivityAt: block ? (block.endedAt ?? block.startedAt) : null,
      });
    }
  }
  return buildRows([...inputs, ...auxWindowRows()]);
}

/**
 * **작업안 대상 id(streamId) → 표시용 `{code, label}`** — 이 창의 세션 타일에서 만든다.
 *
 * 작업안의 대상은 `list_sessions` 의 id(=streamId)라, 사람이 읽는 이름을 얹으려면 이 창의
 * 타일을 훑어야 한다. 관제판의 작업안 카드와 **화면 아래 검토 카드**(`ReviewCard.svelte` ·
 * docs/log/2026-09-27-review-popup-card.md)가 같은 표를 써야 한다 — 두 자리가 같은 대상을
 * 다른 이름으로 부르면 "같은 것인가" 를 눈으로 맞출 수 없다. 못 찾으면(다른 창의 세션 ·
 * 헤드리스) 표에 없고, 부르는 쪽이 raw id 로 떨어진다.
 *
 * `windowRows` 와 같은 결 — `$state` 를 만들지 않고 읽기만 하므로 `$derived.by` 안에서 부르면
 * 탭·타일 변화가 그대로 의존성이 된다.
 */
export function windowTargetLookup(tr: Tr): Map<string, { code: string; label: string }> {
  const label = currentWindowLabel();
  const map = new Map<string, { code: string; label: string }>();
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (!hasSession(pane.kind)) continue;
      const streamId = pane.historyStreamId ?? pane.id;
      map.set(streamId, { code: tileCode(label, pane.id), label: paneName(pane, tr) });
    }
  }
  // DB 작업안의 대상(`db:<연결 id>` — 쿼리 타일 3b)은 연결 이름으로.
  for (const c of dbConns()) map.set(`db:${c.id}`, { code: "DB", label: c.name });
  return map;
}
