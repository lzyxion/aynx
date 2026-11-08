// 패널 트리 **바꾸기** — 끼우기·분할·나선 배치·닫기·교체·맞바꾸기(순수 함수).
// 불변식: 입력 트리를 수정하지 않고, 바뀌지 않은 가지와 잎 객체는 참조 그대로 재사용한다(`pane.id` 유지 = 세션 유지).
// 화면 기하가 필요한 조작(이동·확장)은 여기가 아니라 `$lib/tree-ops.ts`.

import { clonePane, leafOf, paneOrder } from "./factory";
import type { PaneNode, PaneSpec, SplitDir } from "./spec";
import { DEFAULT_RATIO, findPane } from "./tree";

export type PaneSide = "before" | "after";

/**
 * `targetPaneId` 잎을 `split` 노드로 바꾸고 **주어진 서브트리 전체**를 그 옆에 끼운다.
 *
 * 삽입의 **유일한 원시 연산**이다. [`splitPaneWith`] (패널 하나 끼우기)는 잎 하나짜리
 * 서브트리를 넣는 특수화이고, 탭 병합(탭 A 의 root 를 탭 B 의 패널 옆에)은 가지째 넣는
 * 일반형이다 — 트리 입장에서는 완전히 같은 조작이라 함수가 하나면 된다.
 *
 * `side` 가 `"after"` 면 원래 패널이 a·새 서브트리가 b, `"before"` 면 그 반대다.
 * 대상을 못 찾으면 트리를 **그대로** 돌려준다 (참조까지 동일 — 호출부가 `!==` 로 판별할 수 있게).
 *
 * `subtree` 는 **복사하지 않고 그대로 붙인다.** 그것이 요점이다 — 잎 객체의 신원과
 * `pane.id` 가 유지되어야 옮겨진 터미널이 재마운트되지 않는다 (= 세션이 안 끊긴다).
 */
export function insertSubtree(
  root: PaneNode,
  targetPaneId: string,
  dir: SplitDir,
  subtree: PaneNode,
  side: PaneSide,
): PaneNode {
  if (root.type === "leaf") {
    if (root.pane.id !== targetPaneId) return root;
    return {
      type: "split",
      dir,
      ratio: DEFAULT_RATIO,
      a: side === "before" ? subtree : root,
      b: side === "before" ? root : subtree,
    };
  }
  const a = insertSubtree(root.a, targetPaneId, dir, subtree, side);
  if (a !== root.a) return { ...root, a };
  const b = insertSubtree(root.b, targetPaneId, dir, subtree, side);
  if (b !== root.b) return { ...root, b };
  return root;
}

/** 분할 방향 뒤집기 — `row` ↔ `col`. [`tiledSubtree`] 의 격자 교대에 쓴다 */
export function flipDir(dir: SplitDir): SplitDir {
  return dir === "row" ? "col" : "row";
}

/**
 * 패널 N 개를 **균형 이진 분할 트리**로 묶는다 — 순수 함수
 * (그룹 폴더 전체 열기 · docs/log/2026-09-03-group-open-tiled.md).
 *
 * 잎이 하나면 [`leafOf`], 아니면 목록을 **반으로 갈라** 양쪽을 재귀로 묶고 그 둘을
 * `ratio 0.5` 로 잇는다. 이때 하위 호출의 방향을 [`flipDir`] 로 **번갈아** 준다 — 그래야
 * 좌우로 자른 다음 칸을 상하로 자르는 식이 되어 결과가 줄이 아니라 **격자**로 읽힌다.
 * (한 방향으로만 자르면 호스트 6개가 폭 1/6짜리 세로 띠 여섯 개가 된다.)
 *
 * 순서는 왼쪽·위 우선으로 보존된다: [`listPanes`] 로 다시 펴면 넣은 그대로 나온다.
 *
 * ```
 * tiledSubtree([1,2],     "row") →  1 | 2                       (1×2)
 * tiledSubtree([1,2,3,4], "row") →  (1/2) | (3/4)  각 칸이 col 로 갈린다 = 2×2 격자
 * tiledSubtree([1,2,3],   "row") →  (1/2) | 3       (왼쪽 위아래, 오른쪽 한 칸)
 * tiledSubtree([1..6],    "row") →  ((1|2)/3) | ((4|5)/6)       대략 2×3
 * ```
 *
 * 빈 배열은 부르지 않는다 — 호출부(`openGroupTiled`)가 0개를 먼저 걸러 낸다.
 */
export function tiledSubtree(panes: PaneSpec[], dir: SplitDir): PaneNode {
  if (panes.length <= 1) return leafOf(panes[0]);
  // 홀수면 앞쪽이 한 칸 더 많다 (왼쪽·위가 먼저 채워진다 = 읽는 순서와 같다).
  const mid = Math.ceil(panes.length / 2);
  const inner = flipDir(dir);
  return {
    type: "split",
    dir,
    ratio: DEFAULT_RATIO,
    a: tiledSubtree(panes.slice(0, mid), inner),
    b: tiledSubtree(panes.slice(mid), inner),
  };
}

/**
 * `targetPaneId` 잎을 `split` 노드로 바꾸고 **주어진 명세의 새 패널**을 그 옆에 끼운다.
 *
 * [`insertSubtree`] 에 잎 하나짜리 서브트리를 넘기는 특수화다. 버튼 분할([`splitPane`])은
 * "같은 spec 의 새 패널을 after 로", 사이드바 드랍은 다른 호스트의 [`newSshPane`] 을
 * 네 방향 중 하나로 — 둘 다 여기를 지난다.
 */
export function splitPaneWith(
  root: PaneNode,
  targetPaneId: string,
  dir: SplitDir,
  newPane: PaneSpec,
  side: PaneSide,
): PaneNode {
  return insertSubtree(root, targetPaneId, dir, leafOf(newPane), side);
}

/**
 * **나선(dwindle) 배치** — 가장 최근에 놓인 칸을 **시계 방향으로 계속 쪼갠다**
 * (docs/log/2026-09-04-spiral-tiling.md). 순수 함수다.
 *
 * ## 대상은 포커스가 아니라 **가장 최근 칸**이다
 *
 * 기존 규칙(`autoSplitDir`)은 **포커스 타일**의 긴 변을 잘랐다. 나선은 그것과 대상 자체가
 * 다르다: 지금 보고 있는 칸이 어디든, 새 타일은 **마지막으로 놓인 칸** 안으로 들어간다.
 * 그래야 열 때마다 같은 방향으로 안쪽으로 파고드는 **하나의 나선**이 그려진다 (포커스를
 * 기준으로 삼으면 사용자가 첫 칸을 클릭하는 순간 나선이 그 자리에서 다시 시작된다 —
 * Hyprland 의 dwindle 이 그 모델이고, awesome 의 `spiral`·bspwm 의 나선 삽입이 이 모델이다).
 *
 * "가장 최근" 의 판정은 두 단계다:
 *  1. **깊이가 가장 깊은 잎** — 나선은 언제나 안으로만 파고드므로 마지막에 놓인 칸이 곧
 *     가장 깊은 칸이다.
 *  2. 깊이가 같으면 **생성 순번이 큰 쪽** (`seqOf`). 쪼갠 직후에는 원래 칸과 새 칸이 같은
 *     깊이에 나란히 서므로 이 두 번째 열쇠가 없으면 답이 흔들린다.
 *
 * `seqOf` 의 기본값은 [`paneOrder`] 다 — `pane-N` 의 N, 즉 이 창의 패널 카운터가 매긴
 * **생성 순번**이다. 따로 `seq` 필드를 두지 않은 이유는 그 값이 이미 여기 있기 때문이다:
 * 배치 복원(`tabs.ts` 의 `nodeFrom`)도 창 이관([`adoptTab`])도 트리를 a → b 순서로
 * 훑으며 id 를 새로 매기므로, 되살아난 트리의 순번은 **화면에서 읽는 순서**로 다시 붙는다
 * (= 나선이 왼쪽·위부터 다시 감긴다). 카운터를 하나 더 두면 생성자 일곱 개·`clonePane`·
 * `adoptTab`·직렬화가 전부 그 값을 따로 챙겨야 하는데, 얻는 정보는 한 글자도 없다.
 * 인자로 열어 둔 것은 테스트가 순번을 직접 지정할 수 있게 하기 위해서다.
 *
 * ## 회전 — 깊이 하나가 방향과 자리를 둘 다 정한다
 *
 * 대상 잎의 깊이 `d`(루트 = 0) 하나로 끝난다:
 *
 * | `d % 4` | `dir` | `side` | 새 타일이 가는 쪽 |
 * | --- | --- | --- | --- |
 * | 0 | `row` | `after` | 오른쪽 |
 * | 1 | `col` | `after` | 아래 |
 * | 2 | `row` | `before` | 왼쪽 |
 * | 3 | `col` | `before` | 위 |
 *
 * 즉 축은 깊이마다 번갈아 뒤집히고(`row`/`col`), 자리는 두 깊이마다 뒤집힌다 — 그 둘이
 * 겹쳐 **오른쪽 → 아래 → 왼쪽 → 위 → 오른쪽 …** 의 시계 방향 순환이 된다.
 *
 * ```
 * 1        1 | 2      1 | (2 / 3)     1 | (2 / (4 | 3))    1 | (2 / ((5 / 4) | 3))
 * ┌─────┐  ┌───┬───┐  ┌───┬───────┐   ┌───┬───────┐        ┌───┬───────┐
 * │     │  │   │   │  │   │   2   │   │   │   2   │        │   │   2   │
 * │  1  │  │ 1 │ 2 │  │ 1 ├───────┤   │ 1 ├───┬───┤        │ 1 ├───┬───┤
 * │     │  │   │   │  │   │   3   │   │   │ 4 │ 3 │        │   │ 5 │ 3 │
 * └─────┘  └───┴───┘  └───┴───────┘   └───┴───┴───┘        │   ├───┤   │
 *                                                          │   │ 4 │   │
 *   d=0 →     d=1 ↓      d=2 ←           d=3 ↑             └───┴───┴───┘
 * ```
 *
 * 비율은 언제나 [`DEFAULT_RATIO`] 다 (`insertSubtree` 가 정한다) — 나선은 "반의 반의 반" 이
 * 그 모양의 근거라 여기서 다른 값을 쓸 이유가 없다.
 *
 * 새 잎만 만들고 **기존 트리는 그대로 재사용**한다 ([`insertSubtree`] 의 규칙) — 사용자가
 * 드래그로 맞춰 둔 다른 분할선의 비율도, 살아 있는 터미널도 손대지 않는다.
 */
export function spiralInsert(
  root: PaneNode,
  newPane: PaneSpec,
  seqOf: (pane: PaneSpec) => number = (pane) => paneOrder(pane.id),
): PaneNode {
  const spot = spiralPlacement(root, seqOf);
  return insertSubtree(root, spot.paneId, spot.dir, leafOf(newPane), spot.side);
}

/** 나선이 다음에 **쪼갤 칸과 그 방향·자리** — [`spiralInsert`] 가 쓰는 답을 따로 내준다. */
export function spiralPlacement(
  root: PaneNode,
  seqOf: (pane: PaneSpec) => number = (pane) => paneOrder(pane.id),
): { paneId: string; dir: SplitDir; side: PaneSide } {
  const target = newestLeaf(root, seqOf, 0);
  const dir: SplitDir = target.depth % 2 === 0 ? "row" : "col";
  const side: PaneSide = target.depth % 4 <= 1 ? "after" : "before";
  return { paneId: target.pane.id, dir, side };
}

/**
 * 트리에서 **가장 최근에 놓인 잎**과 그 깊이 — `(깊이, 생성 순번)` 사전식 최대값.
 *
 * 각 가지에서 양쪽의 최대값을 견주기만 하면 되는 이유는 그 비교가 **전순서**이기 때문이다
 * (최대값의 최대값 = 전체 최대값).
 */
function newestLeaf(
  node: PaneNode,
  seqOf: (pane: PaneSpec) => number,
  depth: number,
): { pane: PaneSpec; depth: number } {
  if (node.type === "leaf") return { pane: node.pane, depth };
  const a = newestLeaf(node.a, seqOf, depth + 1);
  const b = newestLeaf(node.b, seqOf, depth + 1);
  if (a.depth !== b.depth) return a.depth > b.depth ? a : b;
  return seqOf(a.pane) >= seqOf(b.pane) ? a : b;
}

/**
 * `paneId` 잎을 `split` 노드로 바꾼다 — 원래 패널이 a, **같은 종류의 새 패널**이 b.
 *
 * `fresh` 를 넘기면 그 명세로 새 패널을 만든다 (호출부가 새 id 를 미리 알아
 * 포커스를 옮길 수 있게). 없으면 [`clonePane`] 로 같은 종류를 하나 더 연다.
 * 대상을 못 찾으면 트리를 그대로 돌려준다.
 */
export function splitPane(
  root: PaneNode,
  paneId: string,
  dir: SplitDir,
  fresh?: PaneSpec,
): PaneNode {
  // `fresh` 가 없으면 대상 잎을 먼저 찾아 복제한다 — 못 찾으면 복제할 것도 없으니 그대로 둔다.
  const src = fresh ?? findPane(root, paneId);
  if (!src) return root;
  return splitPaneWith(root, paneId, dir, fresh ?? clonePane(src), "after");
}

/**
 * `paneId` 잎을 없앤다 — 형제 가지가 부모 자리로 **승격**한다 (형제의 내부 비율은 그대로).
 * 마지막 하나였으면 `null` — 호출부는 그것을 "탭을 닫아라" 로 읽는다.
 */
export function closePane(root: PaneNode, paneId: string): PaneNode | null {
  if (root.type === "leaf") return root.pane.id === paneId ? null : root;
  const a = closePane(root.a, paneId);
  if (a === null) return root.b;
  if (a !== root.a) return { ...root, a };
  const b = closePane(root.b, paneId);
  if (b === null) return root.a;
  if (b !== root.b) return { ...root, b };
  return root;
}

/**
 * `paneId` 잎의 패널을 `pane` 으로 **그 자리에서 갈아 끼운다** — 트리 모양·분할 비율은 그대로
 * (docs/log/2026-09-26-project-start-screen.md).
 *
 * 프로젝트 시작 화면이 고른 것(셸 · AI · 재개 …)으로 **바뀌는** 길이다. 시작 타일이 탭에 혼자일 때는
 * 지금까지처럼 root 를 통째로 바꿔도 되지만(`placePane` 의 교체), 시작 화면은 분할 안에도 선다(프로젝트
 * "열기" 는 지금 탭의 활성 타일 옆이다) — 그 자리에서도 옆 타일을 건드리지 않고 **그 칸만** 바뀌어야 한다.
 *
 * 새 패널 객체를 **그대로** 심는다(복사하지 않는다 — `pane.id` 가 곧 새 타일의 신원이다). 대상이 없으면
 * 트리를 참조까지 그대로 돌려준다.
 */
export function replacePane(root: PaneNode, paneId: string, pane: PaneSpec): PaneNode {
  if (root.type === "leaf") return root.pane.id === paneId ? { type: "leaf", pane } : root;
  const a = replacePane(root.a, paneId, pane);
  const b = a === root.a ? replacePane(root.b, paneId, pane) : root.b;
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

// ---------------------------------------------------------------------------
// 타일 **이동**과 **확장(삼키기)** — 키보드 타일링 (docs/log/2026-09-04-tiling-move-resize.md)
//
// 전부 순수 함수이고, 바뀔 것이 없으면 **입력 트리를 참조까지 그대로** 돌려준다.
// 호출부(`+page`)는 그 `===` 하나로 "아무 일도 없었다" 를 알아채고 대입 자체를 건너뛴다 —
// 그래야 가장자리에서 키를 계속 눌러도 배치 자동 저장이 헛되이 돌지 않는다.
// ---------------------------------------------------------------------------
