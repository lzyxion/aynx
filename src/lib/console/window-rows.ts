/**
 * 이 창의 세션 타일 → `ConsoleRow[]` — 세션 카드 판과 작업안이 한 함수에서 받는다(두 벌이면 한쪽만 칸을 늘리는 사고가 난다).
 * `$state` 를 만들지 않고 읽기만 한다 — `$derived.by` 안에서 불러야 반응한다.
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

export function windowRows(tr: Tr): ConsoleRow[] {
  blocksVersionOf(); // 의존성으로 읽는다 — 빼면 status 전이 때 명령 · 종료 코드가 낡는다
  const label = currentWindowLabel();
  const inputs: ConsoleRowInput[] = [];
  for (const tab of residentWindowTabs()) {
    for (const pane of listPanes(tab.root)) {
      if (!hasSession(pane.kind)) continue;
      const block = lastBlock(pane.id); // 저장소 키는 pane.id 다 (거울 키 streamId 와 다르다)
      inputs.push({
        streamId: pane.historyStreamId ?? pane.id,
        tabId: tab.id,
        paneId: pane.id,
        attention: stickyOf(pane.id),
        code: tileCode(label, pane.id),
        label: paneName(pane, tr),
        status: statusOf(pane.id),
        connected: sessionOf(pane.id) !== null,
        lastCommand: block?.commandLine ?? null,
        exit: block?.exit ?? null,
        kind: pane.kind === "ssh" ? "ssh" : "local",
        // 빠른 접속의 `alias` 는 설정의 별칭이 아니라 화면 이름이라 같은 칸에 담으면 묶음이 섞인다
        alias: pane.kind === "ssh" && !pane.adhoc ? (pane.alias ?? null) : null,
        adhoc: pane.kind === "ssh" && pane.adhoc ? (pane.alias ?? null) : null,
        shared: paneAiReadable(pane),
        connectedAt: connectedAtOf(pane.id),
        lastActivityAt: block ? (block.endedAt ?? block.startedAt) : null,
      });
    }
  }
  return buildRows([...inputs, ...auxWindowRows()]);
}

/**
 * 작업안 대상 id(streamId) → 표시용 `{code, label}`. 작업안 카드와 검토 카드가 같은 표를 써야 한다 — 같은 대상을 다른 이름으로 부르지 않게.
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
  for (const c of dbConns()) map.set(`db:${c.id}`, { code: "DB", label: c.name });
  return map;
}
