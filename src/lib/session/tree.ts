// 패널 트리 읽기 — 순수 함수이고 입력 트리를 수정하지 않는다.

import type { PaneKind, PaneNode, PaneSpec, TabSpec } from "./spec";

export const DEFAULT_RATIO = 0.5;
/** 한쪽이 0 이 되어 터미널이 사라지는 것을 막는다 */
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * `~/.ssh/config` 별칭으로 붙는 SSH 타일인가 — 호스트 이름 변경이 따라갈 자리.
 * `sftp` 의 `alias` 는 표시용 사본 · 빠른 접속(`adhoc`)의 `alias` 는 화면 이름이라 고치면 안 된다.
 * 저장된 잎(`tabs.ts` 의 `SavedLeaf`)도 같은 판정을 쓴다 — 두 벌로 나누지 않는다.
 */
export function usesHostAlias(
  leaf: { kind: PaneKind; alias?: string; adhoc?: unknown },
  alias: string,
): boolean {
  if (leaf.kind !== "ssh" || leaf.adhoc) return false;
  const key = alias.trim().toLowerCase();
  return key !== "" && (leaf.alias ?? "").trim().toLowerCase() === key;
}

export function listPanes(node: PaneNode): PaneSpec[] {
  if (node.type === "leaf") return [node.pane];
  return [...listPanes(node.a), ...listPanes(node.b)];
}

/** 시작 직후 자동 재접속과 `reconnect-all` 단축키가 같은 순서(활성 탭 먼저)를 봐야 한다 */
export function deferredSshPaneIds(
  tabs: readonly TabSpec[],
  activeId: string | null,
): string[] {
  const active = tabs.find((t) => t.id === activeId);
  const ordered = active ? [active, ...tabs.filter((t) => t.id !== active.id)] : tabs;
  const out: string[] = [];
  for (const tab of ordered) {
    for (const pane of listPanes(tab.root)) {
      if (pane.kind === "ssh" && pane.deferred) out.push(pane.id);
    }
  }
  return out;
}

export function countPanes(node: PaneNode): number {
  return node.type === "leaf" ? 1 : countPanes(node.a) + countPanes(node.b);
}

export function findFirstPane(node: PaneNode): PaneSpec {
  return node.type === "leaf" ? node.pane : findFirstPane(node.a);
}

export function findPane(node: PaneNode, paneId: string): PaneSpec | null {
  if (node.type === "leaf") return node.pane.id === paneId ? node.pane : null;
  return findPane(node.a, paneId) ?? findPane(node.b, paneId);
}

/** 스트림 id(Rust 거울 키 = `historyStreamId ?? id`)로 찾는다 — 창 밖에서 타일을 가리키는 이름은 이것뿐이다(`pane.id` 는 창마다 새로 매겨진다) */
export function findPaneByStream(node: PaneNode, stream: string): PaneSpec | null {
  if (node.type === "leaf") return (node.pane.historyStreamId ?? node.pane.id) === stream ? node.pane : null;
  return findPaneByStream(node.a, stream) ?? findPaneByStream(node.b, stream);
}
