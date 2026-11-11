import { describe, expect, it } from "vitest";
import {
  adoptTab,
  borrowsSession,
  clonePane,
  migrateFileView,
  closePane,
  countPanes,
  DEFAULT_RATIO,
  defaultTabNumber,
  deferredSshPaneIds,
  effectiveDefaultShellId,
  findDocPane,
  findPaneByStream,
  insertSubtree,
  leafOf,
  listPanes,
  newAdhocSshPane,
  newAiPane,
  newDiffPane,
  newDocPane,
  newBranchesPane,
  newLocalFsPane,
  newLocalPane,
  loneTileTitle,
  newProjectStartPane,
  newSftpPane,
  newSshPane,
  newTab,
  nextHistoryStreamId,
  paneName,
  restoredTab,
  tabFromPane,
  tabDisplayTitle,
  tabFixedTitle,
  tabsToClose,
  planDocOpen,
  replacePane,
  spiralInsert,
  tabTitleLabel,
  tiledSubtree,
  usesHostAlias,
  type PaneLeaf,
  type PaneNode,
  type PaneSpec,
  type ShellInfo,
  type TabSpec,
} from "$lib/session";
import { computeLayout, toPx } from "$lib/layout";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/session";
import { expectSameTiles, leaf, leafNodes, shape, spec, split } from "../test/pane-tree";

// ---------------------------------------------------------------------------
// 도우미 — 트리를 짓고 읽는 말은 `src/test/pane-tree.ts` 에 있다 (`tree-ops.test.ts` 와 공용).
// 여기 남은 것은 이 파일에서만 쓰는 하나뿐이다.
// ---------------------------------------------------------------------------

/** 명목 1000×1000 캔버스에서 잰 타일 중심 (문서의 `p6(689,626)` 과 같은 눈금) */
function centerOf(root: PaneNode, id: string): { x: number; y: number } {
  const found = computeLayout(root).panes.find((p) => p.pane.id === id);
  if (!found) throw new Error(`${id} 를 배치에서 찾지 못했다`);
  const { rect } = found;
  return {
    x: Math.round(toPx(rect.x, 1000) + toPx(rect.w, 1000) / 2),
    y: Math.round(toPx(rect.y, 1000) + toPx(rect.h, 1000) / 2),
  };
}

// ---------------------------------------------------------------------------

describe("tiledSubtree — 균형 격자로 묶기", () => {
  const panes = (n: number): PaneSpec[] =>
    Array.from({ length: n }, (_, i) => spec(`p${i + 1}`));

  it("잎이 하나면 분할하지 않는다", () => {
    const one = spec("p1");
    const tree = tiledSubtree([one], "row");

    expect(tree.type).toBe("leaf");
    expect(countPanes(tree)).toBe(1);
    // 명세를 복사하지 않는다 (`leafOf` 의 규칙).
    expect(listPanes(tree)[0]).toBe(one);
  });

  it("2칸은 준 방향으로 한 번만 자른다", () => {
    expect(shape(tiledSubtree(panes(2), "row"))).toBe("(p1 | p2)");
    expect(shape(tiledSubtree(panes(2), "col"))).toBe("(p1 / p2)");
  });

  it("3칸은 앞쪽이 한 칸 더 많다 — (1/2) | 3", () => {
    const tree = tiledSubtree(panes(3), "row");
    expect(shape(tree)).toBe("((p1 / p2) | p3)");
    expect(countPanes(tree)).toBe(3);
  });

  it("4칸은 2×2 격자다 — (1/2) | (3/4)", () => {
    const tree = tiledSubtree(panes(4), "row");
    expect(shape(tree)).toBe("((p1 / p2) | (p3 / p4))");
    expect(countPanes(tree)).toBe(4);
  });

  it("6칸은 대략 2×3 이다 — ((1|2)/3) | ((4|5)/6)", () => {
    const tree = tiledSubtree(panes(6), "row");
    expect(shape(tree)).toBe("(((p1 | p2) / p3) | ((p4 | p5) / p6))");
    expect(countPanes(tree)).toBe(6);
  });

  it("하위 호출의 방향이 번갈아 뒤집혀 줄이 아니라 격자가 된다", () => {
    // 한 방향으로만 잘렸다면 4칸이 세로 띠 넷(`row` 만 세 번)이 됐을 것이다.
    const tree = tiledSubtree(panes(4), "row");
    expect(tree.type).toBe("split");
    if (tree.type !== "split") return;
    expect(tree.dir).toBe("row");
    expect(tree.a.type === "split" && tree.a.dir).toBe("col");
    expect(tree.b.type === "split" && tree.b.dir).toBe("col");
    expect(tree.ratio).toBe(DEFAULT_RATIO);
  });

  it("잎 순서는 왼쪽·위 우선으로 보존된다", () => {
    for (const n of [2, 3, 4, 6]) {
      const given = panes(n);
      expect(listPanes(tiledSubtree(given, "row"))).toEqual(given);
    }
  });
});

describe("insertSubtree — 삽입의 유일한 원시 연산", () => {
  it("대상 잎이 split 이 되고, 서브트리는 복사 없이 그대로 붙는다", () => {
    const target = leaf("A");
    const sub = split("col", leaf("X"), leaf("Y"));
    const next = insertSubtree(target, "A", "row", sub, "after");

    expect(shape(next)).toBe("(A | (X / Y))");
    expect(next.type).toBe("split");
    if (next.type !== "split") return;
    expect(next.ratio).toBe(DEFAULT_RATIO);
    expect(next.a).toBe(target); // 원래 잎 노드 그대로
    expect(next.b).toBe(sub); // 서브트리도 객체째
  });

  it("side 가 before 면 앞쪽에 선다", () => {
    const target = leaf("A");
    const sub = leaf("X");
    const next = insertSubtree(target, "A", "col", sub, "before");

    expect(shape(next)).toBe("(X / A)");
    if (next.type !== "split") return;
    expect(next.a).toBe(sub);
    expect(next.b).toBe(target);
  });

  it("깊은 곳의 잎에도 끼운다 — 바뀌지 않은 가지는 재사용한다", () => {
    const kept = split("col", leaf("C"), leaf("D"));
    const root = split("row", split("col", leaf("A"), leaf("B")), kept);
    const next = insertSubtree(root, "B", "row", leaf("X"), "after");

    expect(shape(next)).toBe("((A / (B | X)) | (C / D))");
    if (next.type !== "split") return;
    expect(next.b).toBe(kept); // 손대지 않은 가지는 참조까지 그대로
  });

  it("대상을 못 찾으면 트리를 참조까지 그대로 돌려준다", () => {
    const root = split("row", leaf("A"), leaf("B"));
    expect(insertSubtree(root, "없는-패널", "row", leaf("X"), "after")).toBe(root);
  });
});

describe("closePane — 형제가 승격한다", () => {
  it("패널을 닫으면 부모 split 이 사라지고 형제 서브트리가 그 자리에 온다", () => {
    const sibling = split("col", leaf("B"), leaf("C"));
    const root = split("row", leaf("A"), sibling);

    const next = closePane(root, "A");
    // 형제를 **다시 만들지 않는다** — 참조까지 그 서브트리 자체다.
    expect(next).toBe(sibling);
    expect(shape(next as PaneNode)).toBe("(B / C)");
    expect(countPanes(next as PaneNode)).toBe(2);
  });

  it("남은 잎 객체의 신원이 보존된다", () => {
    const a = leaf("A");
    const b = leaf("B");
    const c = leaf("C");
    const root = split("row", a, split("col", b, c));

    const next = closePane(root, "A") as PaneNode;
    expect(leafNodes(next)).toEqual([b, c]);
    expect(leafNodes(next)[0]).toBe(b);
    expect(leafNodes(next)[1]).toBe(c);
    expect(listPanes(next)[0]).toBe(b.pane);
  });

  it("깊은 곳의 잎을 닫으면 그 가지만 새로 만든다", () => {
    const left = split("col", leaf("A"), leaf("B"));
    const c = leaf("C");
    const root = split("row", left, split("col", c, leaf("D")));

    const next = closePane(root, "D") as PaneNode;
    expect(shape(next)).toBe("((A / B) | C)");
    if (next.type !== "split") return;
    expect(next.a).toBe(left); // 반대쪽 가지는 그대로
    expect(next.b).toBe(c); // 형제가 그대로 승격
  });

  it("마지막 하나였으면 null (호출부는 '탭을 닫아라' 로 읽는다)", () => {
    expect(closePane(leaf("A"), "A")).toBeNull();
  });

  it("없는 id 면 트리를 참조까지 그대로", () => {
    const root = split("row", leaf("A"), leaf("B"));
    expect(closePane(root, "없는-패널")).toBe(root);
  });

  it("insertSubtree 로 넣었다가 closePane 으로 빼면 원래 모양으로 돌아온다", () => {
    const root = split("row", leaf("A"), leaf("B"));
    const grown = insertSubtree(root, "B", "col", leaf("X"), "after");
    expect(shape(grown)).toBe("(A | (B / X))");

    const back = closePane(grown, "X") as PaneNode;
    expect(shape(back)).toBe("(A | B)");
    expectSameTiles(root, back);
  });
});

describe("replacePane — 그 자리에서 갈아 끼운다 (프로젝트 시작 화면)", () => {
  // ((A|B)/(C|D))
  const build = () =>
    split("col", split("row", leaf("A"), leaf("B")), split("row", leaf("C"), leaf("D")));

  it("그 잎만 바뀌고 트리 모양·비율은 그대로다", () => {
    const root = build();
    const fresh = newAiPane("claude", "C:/src/aynx");
    const next = replacePane(root, "C", fresh);
    const panes = listPanes(next);
    expect(panes[2]).toBe(fresh); // 새 객체를 그대로 심는다
    expect(panes.map((p) => p.id)).toEqual(["A", "B", fresh.id, "D"]);
    expect(countPanes(next)).toBe(4);
    expect(shape(replacePane(next, fresh.id, listPanes(root)[2]))).toBe(shape(root));
  });

  it("다른 가지는 참조까지 그대로 · 대상이 없으면 트리 그대로", () => {
    const root = build();
    const next = replacePane(root, "A", newAiPane("codex"));
    if (next.type !== "split" || root.type !== "split") throw new Error("분할이 아니다");
    expect(next.b).toBe(root.b);
    expect(replacePane(root, "nope", newAiPane("codex"))).toBe(root);
  });

  it("잎 하나짜리 트리도", () => {
    const start = newProjectStartPane("P1", "C:/src/aynx");
    const fresh = newAiPane("claude");
    expect(replacePane(leafOf(start), start.id, fresh)).toEqual({ type: "leaf", pane: fresh });
  });
});

describe("spiralInsert — 가장 최근 칸을 시계 방향으로 쪼갠다", () => {
  // docs/log/2026-09-04-spiral-tiling.md 3절. id 는 `pane-N` 꼴이라 기본 `seqOf`(= paneOrder)가
  // 그대로 **생성 순번**으로 읽힌다.
  const p = (n: number): PaneSpec => spec(`pane-${n}`);

  it("6칸까지 차례로 넣으면 오른쪽 → 아래 → 왼쪽 → 위 → 오른쪽 으로 감긴다", () => {
    let tree: PaneNode = leafOf(p(1));
    expect(shape(tree)).toBe("pane-1");

    tree = spiralInsert(tree, p(2)); // d=0 → row/after (오른쪽)
    expect(shape(tree)).toBe("(pane-1 | pane-2)");

    tree = spiralInsert(tree, p(3)); // d=1 → col/after (아래)
    expect(shape(tree)).toBe("(pane-1 | (pane-2 / pane-3))");

    tree = spiralInsert(tree, p(4)); // d=2 → row/before (왼쪽)
    expect(shape(tree)).toBe("(pane-1 | (pane-2 / (pane-4 | pane-3)))");

    tree = spiralInsert(tree, p(5)); // d=3 → col/before (위)
    expect(shape(tree)).toBe("(pane-1 | (pane-2 / ((pane-5 / pane-4) | pane-3)))");

    tree = spiralInsert(tree, p(6)); // d=4 → 다시 row/after (오른쪽)
    expect(shape(tree)).toBe("(pane-1 | (pane-2 / (((pane-5 | pane-6) / pane-4) | pane-3)))");
    expect(countPanes(tree)).toBe(6);
  });

  it("문서가 적어 둔 중심 좌표대로 실제로 감겨 들어간다 (1000×1000 캔버스)", () => {
    let tree: PaneNode = leafOf(p(1));
    for (let n = 2; n <= 6; n += 1) tree = spiralInsert(tree, p(n));

    expect(centerOf(tree, "pane-1")).toEqual({ x: 248, y: 500 });
    expect(centerOf(tree, "pane-2")).toEqual({ x: 752, y: 248 });
    expect(centerOf(tree, "pane-3")).toEqual({ x: 878, y: 752 });
    expect(centerOf(tree, "pane-4")).toEqual({ x: 626, y: 878 });
    expect(centerOf(tree, "pane-5")).toEqual({ x: 563, y: 626 });
    expect(centerOf(tree, "pane-6")).toEqual({ x: 689, y: 626 });
  });

  it("비율은 언제나 DEFAULT_RATIO 이고 기존 트리는 재사용한다", () => {
    const kept = leafOf(p(1));
    const next = spiralInsert(kept, p(2));

    expect(next.type).toBe("split");
    if (next.type !== "split") return;
    expect(next.ratio).toBe(DEFAULT_RATIO);
    expect(next.a).toBe(kept); // 새 잎만 만들고 나머지는 그대로
  });

  it("깊이가 같으면 생성 순번이 큰 쪽 — seqOf 순번만 뒤집으면 대상도 뒤집힌다", () => {
    // 두 잎이 같은 깊이(1)에 나란히 선 트리. 기본 순번이면 pane-2 가 마지막 칸이다.
    const root = split("row", leafOf(p(1)), leafOf(p(2)));

    const byDefault = spiralInsert(root, p(3));
    expect(shape(byDefault)).toBe("(pane-1 | (pane-2 / pane-3))");

    // 순번만 뒤집으면(큰 번호가 먼저 놓인 셈) 대상이 pane-1 로 뒤집힌다.
    const reversed = spiralInsert(root, p(3), (pane) => -Number(pane.id.slice("pane-".length)));
    expect(shape(reversed)).toBe("((pane-1 / pane-3) | pane-2)");
  });
});

describe("adoptTab — 창 이관의 id 재부여(2패스)", () => {
  it("트리를 훑으며 id 를 새로 매기고, 원본을 가리키던 참조를 새 id 로 옮긴다", () => {
    // SFTP 브라우저가 트리에서 **원본 터미널보다 먼저** 나온다 — 한 번에 못 고치는 그 배치다.
    const browser: PaneSpec = {
      id: "old-sftp",
      kind: "sftp",
      alias: "web-01",
      sourcePaneId: "old-term",
    };
    const terminal: PaneSpec = { id: "old-term", kind: "ssh", alias: "web-01" };
    const shell: PaneSpec = { id: "old-shell", kind: "local", autorun: "claude", openDelay: 300 };
    const tab: TabSpec = {
      id: "old-tab",
      title: "탭 7",
      name: "배포",
      root: split("row", leafOf(browser), split("col", leafOf(terminal), leafOf(shell))),
    };

    const asked: string[] = [];
    const next = adoptTab(tab, (originalPaneId) => {
      asked.push(originalPaneId);
      return originalPaneId === "old-term" ? { sessionId: 42, buffer: "hello" } : undefined;
    });

    // 트리 모양과 이름은 그대로, id 는 전부 새것이다.
    const [newBrowser, newTerminal, newShell] = listPanes(next.root);
    expect(next.id).not.toBe(tab.id);
    expect(next.title).toBe("탭 7");
    expect(next.name).toBe("배포");
    expect(shape(next.root)).toBe(
      `(${newBrowser.id} | (${newTerminal.id} / ${newShell.id}))`,
    );

    const oldIds = ["old-sftp", "old-term", "old-shell"];
    const newIds = [newBrowser.id, newTerminal.id, newShell.id];
    for (const id of newIds) expect(oldIds).not.toContain(id);
    expect(new Set(newIds).size).toBe(3);

    // 2패스의 요점 — 브라우저가 먼저 나왔는데도 참조가 새 터미널 id 로 이어졌다.
    expect(newBrowser.sourcePaneId).toBe(newTerminal.id);
    // 세션을 여는 종류에만 복원 지시서를 묻는다 (sftp·설정·호스트는 묻지 않는다).
    expect(asked).toEqual(["old-term", "old-shell"]);
    expect(newTerminal.restore).toEqual({ sessionId: 42, buffer: "hello" });
    expect(newShell.restore).toBeUndefined();
    // 1회용 값은 떨군다.
    expect(newShell.autorun).toBeUndefined();
    expect(newShell.openDelay).toBeUndefined();

    // 입력 트리는 손대지 않는다 (순수 함수).
    expect(browser.id).toBe("old-sftp");
    expect(browser.sourcePaneId).toBe("old-term");
    expect(shell.autorun).toBe("claude");
    expect(listPanes(tab.root)).toEqual([browser, terminal, shell]);
  });

  it("함께 넘어오지 않은 원본을 가리키던 참조는 지운다 (낡은 번호를 남기지 않는다)", () => {
    const orphan: PaneSpec = {
      id: "old-sftp",
      kind: "sftp",
      alias: "db-01",
      sourcePaneId: "저쪽-창에-남은-터미널",
    };
    const tab: TabSpec = { id: "old-tab", title: "탭 1", root: leafOf(orphan) };

    const next = adoptTab(tab, () => undefined);
    const moved = listPanes(next.root)[0];

    expect(moved.id).not.toBe("old-sftp");
    expect(moved.sourcePaneId).toBeUndefined();
    expect("sourcePaneId" in moved).toBe(false);
    // 타일 자체는 살아남는다 — 사용자가 만든 타일을 말없이 지우지 않는다.
    expect(countPanes(next.root)).toBe(1);
    expect(moved.kind).toBe("sftp");
    expect(moved.alias).toBe("db-01");
    // 원본은 그대로.
    expect(orphan.sourcePaneId).toBe("저쪽-창에-남은-터미널");
  });

  it("historyStreamId 를 보존한다 (이관 뒤에도 AI 외부 참조가 같은 스트림을 가리킨다)", () => {
    const term: PaneSpec = { id: "old-term", kind: "ssh", alias: "web-01", historyStreamId: "stream-abc" };
    const tab: TabSpec = { id: "old-tab", title: "탭 1", root: leafOf(term) };
    const moved = listPanes(adoptTab(tab, () => undefined).root)[0];
    // 화면 신원(id)은 새로 매기지만 거울 키는 그대로 — sessionId 를 보존하는 것과 같은 자리다.
    expect(moved.id).not.toBe("old-term");
    expect(moved.historyStreamId).toBe("stream-abc");
    // 입력 트리는 손대지 않는다 (순수 함수).
    expect(term.historyStreamId).toBe("stream-abc");
  });
});

describe("nextHistoryStreamId / clonePane — 이력 거울 키", () => {
  it("매번 다른 값을 낸다 (crypto 난수)", () => {
    const a = nextHistoryStreamId();
    const b = nextHistoryStreamId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("clonePane 은 새 스트림 키를 발급한다 (복제 = 새 셸 계보)", () => {
    const src = newSshPane("web-01");
    expect(src.historyStreamId).toBeTruthy();
    const copy = clonePane(src);
    expect(copy.id).not.toBe(src.id);
    expect(copy.historyStreamId).toBeTruthy();
    expect(copy.historyStreamId).not.toBe(src.historyStreamId);
  });

  it("세션 없는 타일의 복제는 스트림 키를 만들지 않는다 (원본에 없으니 undefined 그대로)", () => {
    const start: PaneSpec = { id: "pane-9", kind: "start" };
    const copy = clonePane(start);
    expect(copy.historyStreamId).toBeUndefined();
  });
});

describe("newAiPane / injectMcpToken — AI 타일과 토큰 주입 표식(Stage B)", () => {
  it("newAiPane(command) 은 그 명령을 autorun 으로 넣고 토큰 주입을 켠다", () => {
    const claude = newAiPane("claude");
    expect(claude.kind).toBe("local");
    expect(claude.autorun).toBe("claude");
    expect(claude.injectMcpToken).toBe(true);

    // CLI 를 갈아도 같은 표식 — codex 도 주입을 켠다(그래야 환경변수로 인증한다).
    const codex = newAiPane("codex");
    expect(codex.autorun).toBe("codex");
    expect(codex.injectMcpToken).toBe(true);
  });

  it("newAiPane(command, cwd) 는 시작 폴더를 담고, 없거나 공백뿐이면 키를 두지 않는다", () => {
    expect(newAiPane("claude", "C:/src/proj").cwd).toBe("C:/src/proj");
    // 앞뒤 공백은 떼고, 공백뿐이면 "안 정함"(= 홈)이라 키 자체를 두지 않는다.
    expect(newAiPane("claude", "  C:/src/proj  ").cwd).toBe("C:/src/proj");
    expect(newAiPane("claude", "   ").cwd).toBeUndefined();
    expect(newAiPane("claude").cwd).toBeUndefined();
  });

  it("clonePane 은 주입 표식을 물려준다 (분할하면 새 AI 셸도 인증한다)", () => {
    const copy = clonePane(newAiPane("codex"));
    expect(copy.autorun).toBe("codex");
    expect(copy.injectMcpToken).toBe(true);
  });

  it("clonePane 은 시작 폴더도 물려준다 (분할한 AI 셸이 같은 프로젝트에서 뜬다)", () => {
    expect(clonePane(newAiPane("claude", "C:/src/proj")).cwd).toBe("C:/src/proj");
  });

  it("adoptTab 은 autorun 처럼 주입 표식을 떨군다 (넘어간 세션은 저쪽에서 이미 열렸다)", () => {
    const tab: TabSpec = {
      id: "old-tab",
      title: "탭 1",
      root: leafOf(newAiPane("codex")),
    };
    const [adopted] = listPanes(adoptTab(tab, () => undefined).root);
    expect(adopted.autorun).toBeUndefined();
    expect(adopted.injectMcpToken).toBeUndefined();
  });

  it("adoptTab 은 시작 폴더도 떨군다 (저쪽 창이 이미 그 폴더에서 셸을 열었다)", () => {
    const tab: TabSpec = {
      id: "old-tab",
      title: "탭 1",
      root: leafOf(newAiPane("claude", "C:/src/proj")),
    };
    const [adopted] = listPanes(adoptTab(tab, () => undefined).root);
    expect(adopted.cwd).toBeUndefined();
  });
});

describe("deferredSshPaneIds — 재접속을 기다리는 복원 타일들", () => {
  /** `deferred` 표시가 붙은 SSH 잎 (배치 복원이 만드는 모양) */
  const ssh = (id: string, deferred = true): PaneLeaf =>
    leafOf({ id, kind: "ssh", alias: id, ...(deferred ? { deferred: true } : {}) });

  const tab = (id: string, root: PaneNode): TabSpec => ({ id, title: id, root });

  it("`deferred` 인 SSH 잎만 고른다 (붙은 것·다른 종류는 뺀다)", () => {
    const t = tab("w1", split("row", ssh("a"), split("row", ssh("b", false), leaf("local"))));
    expect(deferredSshPaneIds([t], "w1")).toEqual(["a"]);
  });

  it("**활성 탭이 먼저**다 — 보고 있는 화면이 가장 먼저 살아난다", () => {
    const t1 = tab("w1", ssh("a"));
    const t2 = tab("w2", split("row", ssh("b"), ssh("c")));
    expect(deferredSshPaneIds([t1, t2], "w2")).toEqual(["b", "c", "a"]);
    expect(deferredSshPaneIds([t1, t2], "w1")).toEqual(["a", "b", "c"]);
  });

  it("활성 id 가 없거나 목록에 없으면 그냥 목록 순서다", () => {
    const t1 = tab("w1", ssh("a"));
    const t2 = tab("w2", ssh("b"));
    expect(deferredSshPaneIds([t1, t2], null)).toEqual(["a", "b"]);
    expect(deferredSshPaneIds([t1, t2], "없는-탭")).toEqual(["a", "b"]);
  });

  it("기다리는 것이 없으면 빈 배열 (던지지 않는다)", () => {
    expect(deferredSshPaneIds([], null)).toEqual([]);
    expect(deferredSshPaneIds([tab("w1", leaf("local"))], "w1")).toEqual([]);
  });
});

describe("clonePane / adoptTab — 파일 타일의 보기(fileView)", () => {
  // docs/log/2026-09-25-file-tree-view.md — `path` 와 같은 무리: 복제도 이관도 물려준다
  const view = (): PaneSpec => ({ id: "F", kind: "localfs", path: "C:/w", fileView: "compact", fileZoom: 3, filePlaces: false });

  it("clonePane · adoptTab 둘 다 물려준다 (아이콘 크기 · 장소 패널도)", () => {
    expect(clonePane(view())).toMatchObject({ fileView: "compact", fileZoom: 3, filePlaces: false });
    const tab: TabSpec = { id: "old-tab", title: "탭 1", root: leafOf(view()) };
    expect(listPanes(adoptTab(tab, () => undefined).root)[0]).toMatchObject({ fileView: "compact", fileZoom: 3, filePlaces: false });
  });

  it("migrateFileView — 옛 두 값은 details, 모르는 값은 null", () => {
    expect(migrateFileView("tree")).toBe("details");
    expect(migrateFileView("navigate")).toBe("details");
    expect(migrateFileView("icons")).toBe("icons");
    expect(migrateFileView("grid")).toBeNull();
    expect(migrateFileView(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tmux 세션 이름 — 복제는 떨구고 창 이관은 물려준다
// (docs/log/2026-09-16-tmux-toggle.md)
// ---------------------------------------------------------------------------

describe("clonePane / adoptTab — tmux 세션 이름", () => {
  const tmuxPane = (): PaneSpec => ({ id: "P", kind: "ssh", alias: "web-01", tmux: "aynx-1" });

  it("clonePane 은 떨군다 — 물려주면 두 타일이 같은 tmux 세션을 서로 빼앗는다", () => {
    const copy = clonePane(tmuxPane());
    expect(copy.tmux).toBeUndefined();
    // 나머지는 그대로다 — 같은 호스트로 다시 붙되 **새 번호**를 받는다(백엔드가 고른다).
    expect(copy.alias).toBe("web-01");
    expect(copy.id).not.toBe("P");
  });

  it("adoptTab 은 물려준다 — 같은 타일이 창만 옮기면 자기 자리로 돌아가야 한다", () => {
    const tab: TabSpec = { id: "old-tab", title: "탭 1", root: leafOf(tmuxPane()) };
    const [adopted] = listPanes(adoptTab(tab, () => undefined).root);
    expect(adopted.tmux).toBe("aynx-1");
  });

  it("tmux 가 아니던 타일에는 키가 생기지 않는다", () => {
    expect(clonePane({ id: "P", kind: "ssh", alias: "web-01" }).tmux).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 빠른 접속 타일 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
// ---------------------------------------------------------------------------

describe("newAdhocSshPane — 설정에 없는 대상의 타일", () => {
  it("화면 이름은 `user@host:port` 이고 대상은 따로 실린다", () => {
    const pane = newAdhocSshPane({ user: "deploy", host: "example.com", port: 2222 });
    expect(pane.kind).toBe("ssh");
    expect(pane.alias).toBe("deploy@example.com:2222");
    expect(pane.adhoc).toEqual({ user: "deploy", host: "example.com", port: 2222 });
    // 세션을 여는 타일이므로 이력 거울 키를 받는다 (`newSshPane` 과 같다).
    expect(pane.historyStreamId).toBeTruthy();
  });

  it("22 번은 이름에 적지 않는다", () => {
    expect(newAdhocSshPane({ host: "example.com" }).alias).toBe("example.com");
  });

  it("대상 객체를 복사해 둔다 — 부르는 쪽이 나중에 고쳐도 타일이 흔들리지 않는다", () => {
    const target = { host: "example.com" };
    const pane = newAdhocSshPane(target);
    target.host = "other.example";
    expect(pane.adhoc?.host).toBe("example.com");
  });
});

describe("clonePane / adoptTab — 빠른 접속 대상은 `alias` 와 한 벌이다", () => {
  const adhocPane = (): PaneSpec => ({
    id: "P",
    kind: "ssh",
    alias: "deploy@example.com:2222",
    adhoc: { user: "deploy", host: "example.com", port: 2222 },
  });

  it("clonePane 은 물려준다 — 복제의 '같은 것' 은 곧 그 서버다", () => {
    const copy = clonePane(adhocPane());
    expect(copy.adhoc).toEqual({ user: "deploy", host: "example.com", port: 2222 });
    expect(copy.alias).toBe("deploy@example.com:2222");
  });

  it("adoptTab 도 물려준다 — 없으면 새 창에서 '설정에 없는 별칭' 으로 두드린다", () => {
    const tab: TabSpec = { id: "old-tab", title: "탭 1", root: leafOf(adhocPane()) };
    const [adopted] = listPanes(adoptTab(tab, () => undefined).root);
    expect(adopted.adhoc?.host).toBe("example.com");
    expect(adopted.alias).toBe("deploy@example.com:2222");
  });

  it("평범한 SSH 타일에는 키가 생기지 않는다", () => {
    expect(clonePane({ id: "P", kind: "ssh", alias: "web-01" }).adhoc).toBeUndefined();
  });
});

describe("closePane — 분할이 접히면", () => {
  it("형제를 참조까지 그대로 올린다", () => {
    const inner = split("row", leaf("B"), leaf("C"));
    const root = split("col", leaf("A"), inner);
    expect(closePane(root, "A")).toBe(inner);
  });
});

describe("effectiveDefaultShellId — 설정값과 OS 초기값을 합치는 규칙 하나", () => {
  // 이 규칙을 `Ctrl+Shift+N`(`app/panes`)·`+` 메뉴(`Tabs`)·설정 화면이 **같이** 부른다.
  // 세 자리가 각자 해석하던 "시스템 기본" 을 없앤 것이 2026-09-16 저녁의 변경이다.
  const shells: ShellInfo[] = [
    { id: "pwsh", label: "PowerShell 7" },
    { id: "cmd", label: "명령 프롬프트" },
  ];

  it("설정값이 이 기기에 있으면 그것이 기본이다", () => {
    expect(effectiveDefaultShellId(shells, "cmd", "pwsh")).toBe("cmd");
  });

  it("아직 아무것도 안 골랐으면 OS 초기값 — 새로 깐 기기에서도 구체적인 셸이 열린다", () => {
    expect(effectiveDefaultShellId(shells, undefined, "pwsh")).toBe("pwsh");
    expect(effectiveDefaultShellId(shells, null, "pwsh")).toBe("pwsh");
  });

  it("저장된 셸이 이 기기에 없으면(설정을 다른 PC 에서 가져왔다) OS 초기값으로 떨어진다", () => {
    expect(effectiveDefaultShellId(shells, "wsl:ubuntu", "pwsh")).toBe("pwsh");
  });

  it("목록이 아직 안 왔거나 감지가 실패하면 null — 그때는 셸을 지정하지 않고 연다", () => {
    expect(effectiveDefaultShellId([], "cmd", null)).toBeNull();
    expect(effectiveDefaultShellId(shells, undefined, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 자동 탭 제목 — **저장은 한 가지 형태, 화면은 지금 언어**
//
// `TabSpec.title` 은 레이아웃 파일에 그대로 적히는 값이라 만드는 자리에서 번역하지 않는다
// (docs/log/2026-09-17-i18n.md). 대신 그리는 자리가 번호를 되읽어 `app.tabs.default` 로
// 옮긴다 — 그 되읽기가 `defaultTabNumber` 다.
// ---------------------------------------------------------------------------

describe("defaultTabNumber — 자동 탭 제목의 번호를 되읽는다", () => {
  it("지금 형태(`탭 N`)", () => {
    expect(defaultTabNumber("탭 1")).toBe(1);
    expect(defaultTabNumber("탭 42")).toBe(42);
  });

  it("영어로 저장됐던 것(`Tab N`)과 옛 이름(`워크스페이스 N`)도 같은 문으로 읽는다", () => {
    expect(defaultTabNumber("Tab 3")).toBe(3);
    expect(defaultTabNumber("워크스페이스 7")).toBe(7);
  });

  it("앞뒤 공백은 떼고 본다", () => {
    expect(defaultTabNumber("  탭 2  ")).toBe(2);
  });

  it("사용자가 붙인 제목은 건드리지 않는다", () => {
    expect(defaultTabNumber("배포")).toBeNull();
    expect(defaultTabNumber("탭")).toBeNull();
    expect(defaultTabNumber("탭 2 배포")).toBeNull();
    expect(defaultTabNumber("Tab")).toBeNull();
    expect(defaultTabNumber("web-01 · db-01")).toBeNull();
    expect(defaultTabNumber("")).toBeNull();
  });
});

describe("tabTitleLabel — 자동 제목만 옮기고 나머지는 글자 그대로", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);
  const en: Tr = (key, params) => translate("en", key, params);

  it("자동 제목은 지금 언어로 선다", () => {
    // 화면에는 번호 없이 "새 탭" 이다 (저장 형태 `탭 N` 은 그대로)
    expect(tabTitleLabel("탭 5", ko)).toBe("새 탭");
    expect(tabTitleLabel("탭 5", en)).toBe("New tab");
    // 영어로 저장됐던 탭도 한국어 화면에서는 한국어로 돌아온다
    expect(tabTitleLabel("Tab 5", ko)).toBe("새 탭");
  });

  it("사용자 제목은 두 언어에서 똑같다", () => {
    expect(tabTitleLabel("배포", ko)).toBe("배포");
    expect(tabTitleLabel("배포", en)).toBe("배포");
  });
});

describe("newTab / restoredTab — 저장되는 제목은 번역하지 않는다", () => {
  it("새 탭의 제목은 언제나 한국어 기준형이다 (레이아웃 파일 호환)", () => {
    const tab = newTab();
    expect(defaultTabNumber(tab.title)).not.toBeNull();
    expect(tab.title).toBe(`탭 ${defaultTabNumber(tab.title)}`);
  });

  it("복원은 저장된 제목을 그대로 들고, 자동 제목이면 번호만 읽어 카운터를 밀어 올린다", () => {
    const restored = restoredTab(leafOf(spec("p-1")), "탭 900");
    expect(restored.title).toBe("탭 900");
    // 바로 뒤에 만든 새 탭은 같은 번호를 다시 받지 않는다
    expect(defaultTabNumber(newTab().title)).toBeGreaterThan(900);
  });

  it("사용자 제목은 그대로 남는다", () => {
    expect(restoredTab(leafOf(spec("p-2")), "배포").title).toBe("배포");
  });
});

describe("tabDisplayTitle — 타일 하나뿐인 탭", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);
  const lone = (pane: PaneSpec, title = newTab().title): TabSpec => ({ id: "t", title, root: leafOf(pane) });

  it("자동 제목이면 그 타일의 이름 — 로컬 셸 · SSH", () => {
    expect(tabDisplayTitle(lone(newLocalPane("pwsh")), ko)).toBe("PowerShell 7");
    expect(tabDisplayTitle(lone(newSshPane("web-01")), ko)).toBe("web-01");
    // 옛 꼴(`Tab N` · `워크스페이스 N`)도 자동 제목이다
    expect(tabDisplayTitle(lone(newSshPane("web-01"), "Tab 3"), ko)).toBe("web-01");
  });

  it("시작 타일 하나(빈 탭)는 지금처럼 '새 탭'", () => {
    const tab = newTab();
    expect(listPanes(tab.root)[0].kind).toBe("start");
    expect(tabDisplayTitle(tab, ko)).toBe("새 탭");
    expect(tabDisplayTitle(lone(newProjectStartPane("P", "C:/w")), ko)).toBe("새 탭");
  });

  it("일부러 적은 제목(재개 label · 프로젝트 이름)은 타일 이름보다 앞선다", () => {
    expect(tabDisplayTitle(lone(newLocalPane("pwsh"), "버그 고치기"), ko)).toBe("버그 고치기");
  });

  it("사용자 이름이 늘 앞선다", () => {
    expect(tabDisplayTitle({ ...lone(newSshPane("web-01")), name: "배포" }, ko)).toBe("배포");
  });
});

describe("pinnedTitle — 프로젝트 탭의 제목은 타일 수에 흔들리지 않는다", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);
  const two = () => split("row", leafOf(spec("p-a")), leafOf(spec("p-b")));

  it("타일이 둘 이상이어도 고정 제목이 합성 제목을 이긴다", () => {
    const tab: TabSpec = { id: "t", title: "Aynx", pinnedTitle: "Aynx · feat-message", root: two() };
    expect(tabDisplayTitle(tab, ko)).toBe("Aynx · feat-message");
  });

  it("고정 제목이 없으면 지금까지처럼 합성 제목이다 (옛 탭)", () => {
    const tab: TabSpec = { id: "t", title: "Aynx", root: two() };
    expect(tabDisplayTitle(tab, ko)).not.toBe("Aynx");
  });

  it("사용자 이름이 이기고, 비우면 고정 제목으로 돌아온다", () => {
    expect(tabFixedTitle({ name: "배포", pinnedTitle: "Aynx" })).toBe("배포");
    expect(tabFixedTitle({ name: "   ", pinnedTitle: "Aynx" })).toBe("Aynx");
    expect(tabFixedTitle({ pinnedTitle: "Aynx" })).toBe("Aynx");
    expect(tabFixedTitle({ pinnedTitle: "  " })).toBeNull();
    expect(tabFixedTitle({})).toBeNull();
  });

  it("복원과 창 이관이 고정 제목을 들고 간다", () => {
    expect(restoredTab(leafOf(spec("p-3")), "Aynx", undefined, " Aynx ").pinnedTitle).toBe("Aynx");
    expect("pinnedTitle" in restoredTab(leafOf(spec("p-4")), "Aynx")).toBe(false);
    const tab: TabSpec = { id: "t", title: "Aynx", pinnedTitle: "Aynx", root: leafOf(spec("p-5")) };
    expect(adoptTab(tab, () => undefined).pinnedTitle).toBe("Aynx");
    const plain: TabSpec = { id: "t", title: "탭 1", root: leafOf(spec("p-6")) };
    expect("pinnedTitle" in adoptTab(plain, () => undefined)).toBe(false);
  });
});

describe("usesHostAlias — 이름 변경이 따라가야 할 잎을 가르는 판정 하나", () => {
  it("설정 별칭으로 붙는 SSH 타일만 참이다", () => {
    expect(usesHostAlias(newSshPane("web-01"), "web-01")).toBe(true);
    expect(usesHostAlias(newSshPane("db-01"), "web-01")).toBe(false);
  });

  it("대소문자·앞뒤 공백은 무시한다 (별칭 비교의 기준이 저장소 전체에서 그렇다)", () => {
    expect(usesHostAlias(newSshPane(" WEB-01 "), "web-01")).toBe(true);
    expect(usesHostAlias(newSshPane("web-01"), "  Web-01  ")).toBe(true);
  });

  it("빠른 접속(adhoc)은 거짓 — 그 `alias` 는 화면에 보이는 이름이지 설정의 별칭이 아니다", () => {
    const pane = newAdhocSshPane({ host: "web-01" });
    expect(pane.alias).toBe("web-01"); // 글자는 같아질 수 있다
    expect(usesHostAlias(pane, "web-01")).toBe(false);
  });

  it("SSH 가 아닌 타일은 거짓 — SFTP 의 `alias` 는 베껴 둔 표시용 글자다", () => {
    expect(usesHostAlias({ kind: "sftp", alias: "web-01" }, "web-01")).toBe(false);
    expect(usesHostAlias({ kind: "local" }, "web-01")).toBe(false);
  });

  it("빈 별칭끼리는 맞지 않는다 (가리키는 것이 없다)", () => {
    expect(usesHostAlias({ kind: "ssh", alias: "" }, "")).toBe(false);
    expect(usesHostAlias({ kind: "ssh" }, "web-01")).toBe(false);
  });
});

// docs/log/2026-09-24-agent-hook-signals.md — 훅 신호(`AYNX_STREAM`)가 자기 타일을 찾는 길
describe("findPaneByStream", () => {
  it("historyStreamId 로 찾고, 없는 패널은 id 로 견준다", () => {
    const a: PaneSpec = { id: "a", kind: "local", historyStreamId: "s-a" };
    const b: PaneSpec = { id: "b", kind: "local" };
    const root: PaneNode = { type: "split", dir: "row", ratio: 0.5, a: leafOf(a), b: leafOf(b) };
    expect(findPaneByStream(root, "s-a")).toBe(a);
    expect(findPaneByStream(root, "b")).toBe(b);
    expect(findPaneByStream(root, "a")).toBeNull(); // 스트림이 있으면 id 로는 찾지 않는다
    expect(findPaneByStream(root, "nope")).toBeNull();
  });
});

describe("문서 타일 (docs/log/2026-09-27-doc-tile.md)", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);

  it("newDocPane — 로컬이면 별칭·원본이 없고, 원격이면 빌리는 터미널과 별칭을 든다", () => {
    const local = newDocPane("C:\\work\\README.md");
    expect(local.kind).toBe("doc");
    expect(local).not.toHaveProperty("alias");
    expect(local).not.toHaveProperty("sourcePaneId");
    const remote = newDocPane("/srv/app.py", { paneId: "pane-3", alias: "web-01" });
    expect(remote).toMatchObject({ kind: "doc", path: "/srv/app.py", sourcePaneId: "pane-3", alias: "web-01" });
  });

  it("borrowsSession — SFTP 와 원격 문서만 참 (로컬 문서·터미널은 거짓)", () => {
    expect(borrowsSession(newSftpPane("p1", "web-01"))).toBe(true);
    expect(borrowsSession(newDocPane("/a", { paneId: "p1", alias: "web-01" }))).toBe(true);
    expect(borrowsSession(newDocPane("C:/a"))).toBe(false);
    expect(borrowsSession(newSshPane("web-01"))).toBe(false);
  });

  it("paneName — 파일 이름, 원격이면 별칭이 붙는다", () => {
    expect(paneName(newDocPane("C:\\work\\README.md"), ko)).toBe("README.md");
    expect(paneName(newDocPane("/etc/nginx/nginx.conf", { paneId: "p", alias: "web-01" }), ko)).toBe(
      "nginx.conf · web-01",
    );
    expect(paneName(newDocPane(""), ko)).toBe("문서");
  });

  it("paneName — diff 타일은 '변경 · <브랜치>'(분리 HEAD 면 화면용 이름 · 없으면 '변경')", () => {
    expect(paneName(newDiffPane({ projectId: "P", scope: "branch", branch: "feat-retry", name: "df-lab" }), ko)).toBe(
      "변경 · feat-retry",
    );
    expect(paneName(newDiffPane({ projectId: "P", scope: "wip", worktreePath: "/w", name: "df-lab" }), ko)).toBe("변경 · df-lab");
    expect(paneName(newDiffPane({ projectId: "P", scope: "wip", worktreePath: "/w" }), ko)).toBe("변경");
  });

  it("tabDisplayTitle — diff 타일 하나뿐인 탭은 연 때 단 자동 제목, 사용자 이름이 있으면 그것", () => {
    const d = newDiffPane({ projectId: "P", scope: "branch", branch: "feat-retry" });
    const tab: TabSpec = { ...newTab(), root: leafOf(d), title: paneName(d, ko) };
    expect(tabDisplayTitle(tab, ko)).toBe("변경 · feat-retry");
    expect(tabDisplayTitle({ ...tab, name: "리뷰" }, ko)).toBe("리뷰");
  });

  it("loneTileTitle — 주소가 곧 이름인 타일만 빈 탭의 제목을 준다", () => {
    const bg = newBranchesPane("P");
    bg.branchGraph = { projectId: "P", name: "df-lab" };
    expect(loneTileTitle(bg, ko)).toBe("브랜치 · df-lab");
    expect(loneTileTitle(newDiffPane({ projectId: "P", scope: "branch", branch: "feat-retry" }), ko)).toBe("변경 · feat-retry");
    expect(loneTileTitle(newDocPane("C:\\w\\README.md"), ko)).toBe("README.md");
    expect(loneTileTitle(newLocalFsPane(), ko)).toBe("내 PC");
    expect(loneTileTitle(newSftpPane("p1", "web-01"), ko)).toBe("web-01");
    expect(loneTileTitle(newLocalPane("pwsh"), ko)).toBeNull();
    expect(loneTileTitle(newSshPane("web-01"), ko)).toBeNull();
  });

  it("findDocPane — 같은 경로 + 같은 원본(로컬끼리 · 같은 터미널·별칭끼리)만 같다", () => {
    const local = newDocPane("C:/a.md");
    const remote = newDocPane("/a.md", { paneId: "p1", alias: "web-01" });
    const root = split("row", leafOf(local), leafOf(remote));
    expect(findDocPane(root, "C:/a.md")).toBe(local);
    expect(findDocPane(root, "/a.md", { paneId: "p1", alias: "web-01" })).toBe(remote);
    // 같은 경로라도 원본이 다르면 다른 문서다
    expect(findDocPane(root, "/a.md")).toBeNull();
    expect(findDocPane(root, "/a.md", { paneId: "p2", alias: "web-01" })).toBeNull();
    expect(findDocPane(root, "C:/a.md", { paneId: "p1", alias: "web-01" })).toBeNull();
    expect(findDocPane(root, "C:/b.md")).toBeNull();
  });

  it("clonePane 은 보기(`docMode`) · 목차(`docOutline`) · 편집 보기(`docEditView` · `docSplit`) · 글자 크기(`docZoom`)와 빌림을 그대로 물려준다", () => {
    const pane = {
      ...newDocPane("/a.md", { paneId: "p1", alias: "web-01" }),
      docMode: "source" as const,
      docOutline: true as const,
      docEditView: "preview" as const,
      docSplit: 0.3,
      docZoom: 150,
    };
    const copy = clonePane(pane);
    expect(copy.id).not.toBe(pane.id);
    expect(copy).toMatchObject({ kind: "doc", path: "/a.md", sourcePaneId: "p1", alias: "web-01", docMode: "source", docOutline: true, docEditView: "preview", docSplit: 0.3, docZoom: 150 });
  });

  it("clonePane 은 미리 보기 표식을 떨군다 (복사본은 붙박이) · adoptTab 은 그대로 옮긴다", () => {
    const pane: ReturnType<typeof newDocPane> = { ...newDocPane("C:/a.md"), docPreview: true };
    expect(clonePane(pane)).not.toHaveProperty("docPreview");
    const moved = adoptTab({ ...newTab(), root: leafOf(pane) }, () => undefined);
    expect(listPanes(moved.root)[0].docPreview).toBe(true);
  });
});

describe("planDocOpen — 미리 보기 타일 재사용 (docs/log/2026-09-27-doc-tile.md)", () => {
  const preview = (path: string, source?: { paneId: string; alias: string }) => ({
    ...newDocPane(path, source),
    docPreview: true as const,
  });

  it("같은 파일이 이미 열려 있으면 그리로 — 미리 보기가 따로 있어도 정확히 맞는 쪽이 이긴다", () => {
    const kept = newDocPane("C:/a.md");
    const pv = preview("C:/b.md");
    const root = split("row", leafOf(kept), leafOf(pv));
    expect(planDocOpen(root, "C:/a.md")).toEqual({ kind: "focus", paneId: kept.id });
    // 미리 보기 자신이 그 파일이면 갈아 끼우지 않고 포커스만
    expect(planDocOpen(root, "C:/b.md")).toEqual({ kind: "focus", paneId: pv.id });
  });

  it("다른 파일이면 미리 보기 자리를 갈아 끼운다 — 원본이 달라도(로컬 → 원격)", () => {
    const pv = preview("C:/b.md");
    const root = split("row", leafOf(newSftpPane("p1", "web-01")), leafOf(pv));
    expect(planDocOpen(root, "C:/c.md")).toEqual({ kind: "replace", paneId: pv.id });
    expect(planDocOpen(root, "/srv/x.py", { paneId: "p1", alias: "web-01" })).toEqual({
      kind: "replace",
      paneId: pv.id,
    });
  });

  it("저장 안 한 미리 보기는 갈아 끼우지 않는다 — 옆에 새로 (docs/log/2026-09-27-doc-edit.md F2)", () => {
    const pv = preview("C:/b.md");
    const root = split("row", leafOf(newSftpPane("p1", "web-01")), leafOf(pv));
    expect(planDocOpen(root, "C:/c.md", undefined, (id) => id === pv.id)).toEqual({ kind: "beside" });
    // 같은 파일이면 저장 안 한 것이어도 그리로 포커스(글을 잃지 않는다)
    expect(planDocOpen(root, "C:/b.md", undefined, (id) => id === pv.id)).toEqual({
      kind: "focus",
      paneId: pv.id,
    });
  });

  it("붙박이 문서는 절대 갈아 끼우지 않는다 — 미리 보기가 없으면 옆에 새로", () => {
    const root = split("row", leafOf(newSftpPane("p1", "web-01")), leafOf(newDocPane("C:/b.md")));
    expect(planDocOpen(root, "C:/c.md")).toEqual({ kind: "beside" });
  });

  it("트리(탭) 밖의 미리 보기는 보지 않는다", () => {
    const other = leafOf(preview("C:/b.md"));
    const mine = leafOf(newSftpPane("p1", "web-01"));
    expect(planDocOpen(mine, "C:/c.md")).toEqual({ kind: "beside" });
    expect(planDocOpen(other, "C:/c.md").kind).toBe("replace");
  });
});

describe("tabsToClose — 다른 탭 닫기 · 오른쪽 탭 닫기가 닫을 탭", () => {
  const bar = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("대상이 맨 앞이면 others 는 나머지 전부, right 도 나머지 전부", () => {
    expect(tabsToClose(bar, "a", "others")).toEqual(["b", "c", "d"]);
    expect(tabsToClose(bar, "a", "right")).toEqual(["b", "c", "d"]);
  });

  it("가운데면 others 는 양쪽(탭 바 순서), right 는 뒤쪽만", () => {
    expect(tabsToClose(bar, "b", "others")).toEqual(["a", "c", "d"]);
    expect(tabsToClose(bar, "b", "right")).toEqual(["c", "d"]);
  });

  it("맨 뒤면 right 는 비어 있다 (메뉴 항목이 꺼진다)", () => {
    expect(tabsToClose(bar, "d", "others")).toEqual(["a", "b", "c"]);
    expect(tabsToClose(bar, "d", "right")).toEqual([]);
  });

  it("탭이 하나뿐이면 둘 다 비어 있다", () => {
    expect(tabsToClose([{ id: "a" }], "a", "others")).toEqual([]);
    expect(tabsToClose([{ id: "a" }], "a", "right")).toEqual([]);
  });

  it("모르는 id 면 아무것도 닫지 않는다", () => {
    expect(tabsToClose(bar, "zz", "others")).toEqual([]);
    expect(tabsToClose(bar, "zz", "right")).toEqual([]);
  });
});

describe("tabFromPane — 떼어 낸 타일의 새 탭은 원래 탭의 제목을 잇는다 (docs/log/2026-09-30-tear-title-and-agent-handoff.md)", () => {
  // 예전에는 순수 `paneName` 으로 제목을 지어, 셸 id 가 안 실린 로컬 타일(화면에는 "PowerShell 7" · "Claude Code")을
  // 떼면 새 탭이 "로컬" 이 됐다.
  const local: PaneSpec = { id: "pane-9", kind: "local", autorun: "claude" };

  it("자동 제목은 글자 그대로 — 번호를 새로 매기지 않고 타일 이름으로 바꾸지도 않는다", () => {
    const t = tabFromPane(local, { title: "탭 3" });
    expect(t.title).toBe("탭 3");
    expect(t.name).toBeUndefined();
    expect(listPanes(t.root).map((p) => p.id)).toEqual(["pane-9"]); // 같은 패널 객체 (id 유지 = 세션 유지)
  });

  it("사람이 붙인 이름 · 프로젝트 고정 제목과 그 폴더도 함께 잇는다", () => {
    const t = tabFromPane(local, {
      title: "탭 4",
      name: "배포",
      pinnedTitle: "Aynx · feat",
      projectFolder: "C:/src/aynx",
    });
    expect(t).toMatchObject({ title: "탭 4", name: "배포", pinnedTitle: "Aynx · feat", projectFolder: "C:/src/aynx" });
  });

  it("공백뿐인 이름·고정 제목은 없는 것으로 본다", () => {
    const t = tabFromPane(local, { title: "탭 5", name: "  ", pinnedTitle: "", projectFolder: " " });
    expect("name" in t).toBe(false);
    expect("pinnedTitle" in t).toBe(false);
    expect("projectFolder" in t).toBe(false);
  });
});
