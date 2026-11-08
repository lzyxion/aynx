// 패널 트리 **읽기** — 비율 상수·잎 찾기·부모/경로 찾기. 전부 순수 함수이고 입력 트리를 수정하지 않는다.
// 트리를 **바꾸는** 조작은 `tree-edit.ts`.

import type { PaneKind, PaneNode, PaneSpec, TabSpec } from "./spec";

// ---------------------------------------------------------------------------
// 패널 트리 조작 — 전부 **순수 함수** 다.
//
// 입력 트리를 절대 수정하지 않고 새 트리를 돌려준다. 다만 바뀌지 않은 가지는
// **그대로 재사용**한다 (얕은 복사) — 잎 객체의 신원이 유지되어야 렌더 쪽에서
// "이 패널은 그대로다" 를 값싸게 판단할 수 있고, 무엇보다 `pane.id` 가 유지되므로
// 터미널 인스턴스가 살아남는다.
// ---------------------------------------------------------------------------

/** 분할선 기본 위치 — 정확히 반 */
export const DEFAULT_RATIO = 0.5;
/** 분할선을 끌 수 있는 범위. 한쪽이 0 이 되어 터미널이 사라지는 것을 막는다 */
export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * 이 잎이 **`~/.ssh/config` 의 별칭 `alias` 로 붙는 SSH 타일**인가 — 호스트 이름 변경이
 * 따라가야 할 자리를 가르는 판정 하나 (docs/log/2026-09-17-host-rename-fanout.md).
 *
 * 규칙 셋이 여기 모여 있다.
 *
 * 1. **`kind:"ssh"` 만**이다. `sftp` 타일도 [`alias`] 칸을 쓰지만 그것은 자기를 연 터미널의
 *    이름을 **베껴 둔 표시용 글자**라(그 칸의 주석) 접속에 쓰이지 않는다.
 * 2. **[`adhoc`] 이 있으면 거짓**이다. 빠른 접속 타일의 `alias` 는 설정의 별칭이 아니라
 *    화면에 보이는 이름(`user@host:port`)이고, 그 글자가 우연히 어떤 호스트의 별칭과 같아도
 *    그 타일은 config 를 보지 않는다 — 고쳐 주면 이름만 거짓말이 된다.
 * 3. **대소문자를 무시한다** — 별칭 비교의 기준이 저장소 전체에서 그렇다.
 *
 * 인자를 `PaneSpec` 이 아니라 **필요한 세 칸의 구조**로 받는 이유는 저장된 잎
 * (`tabs.ts` 의 `SavedLeaf`)이 같은 질문을 하기 때문이다. 판정이 두 벌이 되면 살아 있는
 * 타일과 파일 속 타일이 서로 다른 답을 내기 시작한다.
 */
export function usesHostAlias(
  leaf: { kind: PaneKind; alias?: string; adhoc?: unknown },
  alias: string,
): boolean {
  if (leaf.kind !== "ssh" || leaf.adhoc) return false;
  const key = alias.trim().toLowerCase();
  return key !== "" && (leaf.alias ?? "").trim().toLowerCase() === key;
}

/** 트리를 순회하며 잎을 왼쪽(=a 우선) 순서로 모은다 */
export function listPanes(node: PaneNode): PaneSpec[] {
  if (node.type === "leaf") return [node.pane];
  return [...listPanes(node.a), ...listPanes(node.b)];
}

/**
 * **아직 붙지 않은 복원 SSH 타일들**의 패널 id — 활성 탭이 먼저다.
 *
 * 배치를 복원하면 SSH 타일은 `deferred` 로 뜬다 (`tabs.ts` 의 결정 — 켜자마자
 * 서버 스무 대를 두드리지 않는다). 그것들을 한꺼번에 붙이는 두 자리 — 시작 직후의
 * 자동 재접속과 `reconnect-all` 단축키 — 가 **같은 순서**를 봐야 하므로 계산이 여기 하나다.
 *
 * 활성 탭을 앞에 세우는 이유는 기다리는 느낌 때문이다: 지금 보고 있는 화면이
 * 가장 먼저 살아나야 "붙는 중" 이 눈에 보인다 (계단식이라 뒤쪽은 몇 초 뒤에 붙는다).
 */
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

/** 패널 개수 (분할선 개수 = 이 값 - 1) */
export function countPanes(node: PaneNode): number {
  return node.type === "leaf" ? 1 : countPanes(node.a) + countPanes(node.b);
}

/** 가장 왼쪽·위 패널. 탭 아이콘·툴팁·포커스 폴백에 쓴다 (트리는 비지 않으므로 항상 있다) */
export function findFirstPane(node: PaneNode): PaneSpec {
  return node.type === "leaf" ? node.pane : findFirstPane(node.a);
}

export function findPane(node: PaneNode, paneId: string): PaneSpec | null {
  if (node.type === "leaf") return node.pane.id === paneId ? node.pane : null;
  return findPane(node.a, paneId) ?? findPane(node.b, paneId);
}

/**
 * **스트림 id**(Rust 거울 키 = `historyStreamId ?? id`)로 패널을 찾는다 — 없으면 `null`.
 *
 * 창 밖에서 타일을 가리키는 이름은 이것뿐이다(`pane.id` 는 창마다 새로 매겨진다). 에이전트 훅
 * 신호(`AYNX_STREAM` → `agent-signal`)가 자기 타일을 찾는 길이다
 * (docs/log/2026-09-24-agent-hook-signals.md).
 */
export function findPaneByStream(node: PaneNode, stream: string): PaneSpec | null {
  if (node.type === "leaf") return (node.pane.historyStreamId ?? node.pane.id) === stream ? node.pane : null;
  return findPaneByStream(node.a, stream) ?? findPaneByStream(node.b, stream);
}
