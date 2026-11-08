import { describe, expect, it } from "vitest";
import {
  clonePane,
  leafOf,
  listPanes,
  newBranchesPane,
  newDiffPane,
  newQueryPane,
  QUERY_DRAFT_MAX,
  newAdhocSshPane,
  newAiPane,
  newDocPane,
  newLocalFsPane,
  newLocalPane,
  newSftpPane,
  newSshPane,
  newProjectStartPane,
  newStartPane,
  type PaneNode,
  type PaneSpec,
  type TabSpec,
} from "$lib/session";
import {
  TAB_FILE_VERSION,
  deserialize,
  isSavedSplit,
  parseNode,
  parseTabFile,
  pruneRetiredLeaves,
  restoreNode,
  restoreTab,
  saveNode,
  serialize,
  type SavedNode,
  type SavedSplit,
  type TabFile,
} from "$lib/tabs";

/** 분할 노드 한 줄 — 테스트 트리를 읽기 좋게 짓는다 */
function split(dir: "row" | "col", a: PaneNode, b: PaneNode, ratio = 0.5): PaneNode {
  return { type: "split", dir, ratio, a, b };
}

/** 탭 하나 (id 는 테스트가 직접 정한다 — `activeIndex` 계산을 확인해야 하므로) */
function tab(id: string, root: PaneNode, title = "작업", name?: string): TabSpec {
  return { id, title, ...(name === undefined ? {} : { name }), root };
}

/** 검증을 통과해야만 하는 파싱 — 실패하면 그 자리에서 던져 테스트가 멈춘다 */
function mustParse(json: string): TabFile {
  const file = parseTabFile(json);
  if (!file) throw new Error("parseTabFile 이 null 을 돌려줬다");
  return file;
}

/** 트리를 종류 목록으로 (잎 순서 = 왼쪽·위 우선) */
function kinds(root: PaneNode): string[] {
  return listPanes(root).map((p) => p.kind);
}

describe("saveNode / serialize — 살아 있는 트리 → 파일", () => {
  it("잎의 런타임 전용 필드는 담지 않는다 (id·restore·openDelay·deferred)", () => {
    const pane: PaneSpec = {
      ...newSshPane("web-01", 10_000),
      openDelay: 400,
      deferred: true,
      restore: { sessionId: 7, buffer: "…" },
    };
    // 이력 거울 키(`historyStreamId`)만은 런타임 전용이 아니라 저장된다 (리로드 참조 생존).
    expect(saveNode(leafOf(pane))).toEqual({
      kind: "ssh",
      alias: "web-01",
      scrollback: 10_000,
      historyStreamId: pane.historyStreamId,
    });
  });

  it("값이 없는 칸은 키 자체를 두지 않는다 (자동 저장이 문자열 비교로 변화를 잰다)", () => {
    const local = newLocalPane();
    // 세션 타일은 이력 거울 키를 늘 갖고 태어난다 — 그 하나만 실린다.
    expect(saveNode(leafOf(local))).toEqual({ kind: "local", historyStreamId: local.historyStreamId });
    // 시작 타일은 세션이 없어 거울 키도 없다.
    expect(saveNode(leafOf(newStartPane()))).toEqual({ kind: "start" });
  });

  it("localfs 의 경로와 local 의 셸·autorun 은 담는다", () => {
    const shell: PaneSpec = { ...newLocalPane("pwsh"), autorun: "claude" };
    expect(saveNode(leafOf(shell))).toEqual({
      kind: "local",
      shell: "pwsh",
      autorun: "claude",
      historyStreamId: shell.historyStreamId,
    });
    expect(saveNode(leafOf(newLocalFsPane("C:/work")))).toEqual({
      kind: "localfs",
      path: "C:/work",
    });
  });

  it("local 의 시작 폴더(cwd)도 autorun 과 나란히 담긴다", () => {
    const ai = newAiPane("claude", "C:/src/proj");
    expect(saveNode(leafOf(ai))).toMatchObject({ autorun: "claude", cwd: "C:/src/proj" });
    // 안 정한 타일에는 키가 없다 (localfs 의 `path` 와 같은 규칙).
    expect(saveNode(leafOf(newLocalPane()))).not.toHaveProperty("cwd");
  });

  it("분할은 방향·비율·양쪽 가지를 그대로 담는다", () => {
    const node = saveNode(split("col", leafOf(newStartPane()), leafOf(newStartPane()), 0.3));
    expect(node).toEqual({
      dir: "col",
      ratio: 0.3,
      a: { kind: "start" },
      b: { kind: "start" },
    });
    expect(isSavedSplit(node)).toBe(true);
  });

  it("activeIndex 는 activeId 의 위치, 못 찾으면 0", () => {
    const tabs = [tab("t1", leafOf(newStartPane())), tab("t2", leafOf(newStartPane()))];
    expect(serialize(tabs, "t2").activeIndex).toBe(1);
    expect(serialize(tabs, "없는-id").activeIndex).toBe(0);
    expect(serialize(tabs, null).activeIndex).toBe(0);
  });

  it("사용자 이름은 있을 때만 키가 생긴다 (공백뿐이면 없는 것으로 본다)", () => {
    const root = leafOf(newStartPane());
    expect(serialize([tab("t1", root, "제목", "  배포  ")], "t1").workspaces[0].name).toBe("배포");
    expect("name" in serialize([tab("t1", root, "제목", "   ")], "t1").workspaces[0]).toBe(false);
    expect("name" in serialize([tab("t1", root, "제목")], "t1").workspaces[0]).toBe(false);
  });

  it("버전을 찍는다", () => {
    expect(serialize([tab("t1", leafOf(newStartPane()))], "t1").version).toBe(
      TAB_FILE_VERSION,
    );
  });
});

describe("스키마 v1 왕복 — 트리 구조와 패널 종류가 그대로 살아 온다", () => {
  const tree = split(
    "row",
    split("col", leafOf(newSshPane("web-01", 10_000)), leafOf(newSftpPane("pane-1", "web-01")), 0.4),
    split("row", leafOf(newLocalFsPane("C:/work")), leafOf(newStartPane())),
  );
  const tabs = [tab("t1", tree, "배포판", "배포"), tab("t2", leafOf(newStartPane()), "빈 판")];

  it("직렬화 → 검증 → 역직렬화로 같은 배치가 돌아온다", () => {
    const file = mustParse(JSON.stringify(serialize(tabs, "t2")));
    const { tabs: restored, activeId } = deserialize(file);

    expect(restored).toHaveLength(2);
    expect(restored[0].title).toBe("배포판");
    expect(restored[0].name).toBe("배포");
    expect(restored[1].title).toBe("빈 판");
    expect(activeId).toBe(restored[1].id);
    expect(kinds(restored[0].root)).toEqual(kinds(tree));
  });

  it("프로젝트 탭의 고정 제목도 돌아오고, 없는 탭(옛 파일)에는 키가 없다", () => {
    const pinned: TabSpec = { ...tab("t3", leafOf(newStartPane()), "AYNX"), pinnedTitle: "AYNX" };
    const file = mustParse(JSON.stringify(serialize([...tabs, pinned], "t1")));
    expect(file.workspaces[2].pinnedTitle).toBe("AYNX");
    expect("pinnedTitle" in file.workspaces[0]).toBe(false);
    const { tabs: restored } = deserialize(file);
    expect(restored[2].pinnedTitle).toBe("AYNX");
    expect("pinnedTitle" in restored[0]).toBe(false);
  });

  it("분할 방향·비율도 그대로다", () => {
    const file = mustParse(JSON.stringify(serialize(tabs, "t1")));
    const { tabs: restored } = deserialize(file);
    const root = restored[0].root;
    if (root.type !== "split") throw new Error("루트가 분할이 아니다");
    expect(root.dir).toBe("row");
    if (root.a.type !== "split") throw new Error("왼쪽 가지가 분할이 아니다");
    expect(root.a.dir).toBe("col");
    expect(root.a.ratio).toBeCloseTo(0.4);
  });

  it("잎의 값(별칭·경로·스크롤백)이 살아 온다", () => {
    const file = mustParse(JSON.stringify(serialize(tabs, "t1")));
    const panes = listPanes(deserialize(file).tabs[0].root);
    const ssh = panes.find((p) => p.kind === "ssh");
    const fs = panes.find((p) => p.kind === "localfs");
    expect(ssh?.alias).toBe("web-01");
    expect(ssh?.scrollback).toBe(10_000);
    expect(fs?.path).toBe("C:/work");
  });

  it("이력 거울 키(historyStreamId)가 리로드를 넘어 그대로 살아 온다 (외부 참조 생존)", () => {
    const live = leafOf(newSshPane("web-01", 10_000));
    const streamId = live.pane.historyStreamId;
    expect(streamId).toBeTruthy();
    const file = mustParse(JSON.stringify(serialize([tab("t1", live)], "t1")));
    const restored = listPanes(deserialize(file).tabs[0].root)[0];
    // 화면 인스턴스 신원(id)은 새로, 거울 키는 그대로 — 참조가 같은 스트림을 가리킨다.
    expect(restored.id).not.toBe(live.pane.id);
    expect(restored.historyStreamId).toBe(streamId);
  });

  /**
   * tmux 세션 이름도 `path`·`historyStreamId` 와 같은 무리다 — 저장되지 않으면 앱을 껐다
   * 켠 타일이 **새 번호**를 물어, 방금까지 쓰던 세션 옆에 빈 화면이 하나 더 생긴다
   * (docs/log/2026-09-16-tmux-toggle.md).
   */
  it("tmux 세션 이름이 리로드를 넘어 그대로 살아 온다 (그 자리로 돌아가는 근거)", () => {
    const live = newSshPane("web-01", null);
    live.tmux = "aynx-2";
    const file = mustParse(JSON.stringify(serialize([tab("t1", leafOf(live))], "t1")));
    const restored = listPanes(deserialize(file).tabs[0].root)[0];
    expect(restored.tmux).toBe("aynx-2");
  });

  it("tmux 가 아니던 타일은 키 자체가 없다 (직렬화 문자열이 흔들리지 않게)", () => {
    expect(saveNode(leafOf(newSshPane("web-01", null)))).not.toHaveProperty("tmux");
  });

  it("거울 키가 없는 옛 레이아웃은 복원 때 새로 발급받는다 (빈 이력으로 시작)", () => {
    // 손으로 만든(구버전) 파일 — historyStreamId 칸이 없다.
    const file = mustParse(
      JSON.stringify({
        version: TAB_FILE_VERSION,
        activeIndex: 0,
        workspaces: [{ title: "옛 배치", root: { kind: "ssh", alias: "web-01" } }],
      }),
    );
    const restored = listPanes(deserialize(file).tabs[0].root)[0];
    expect(restored.kind).toBe("ssh");
    // 없어도 무너지지 않고 새 키를 받는다 (거울에 붙을 자리가 생긴다).
    expect(restored.historyStreamId).toBeTruthy();
  });

  it("다시 직렬화하면 **글자 하나까지 같은 파일**이 나온다 (자동 저장의 변화 판정 근거)", () => {
    const once = JSON.stringify(serialize(tabs, "t1"));
    const { tabs: restored, activeId } = deserialize(mustParse(once));
    expect(JSON.stringify(serialize(restored, activeId))).toBe(once);
  });

  it("패널 id 는 새로 매겨진다 (지난 실행의 id 를 물려받지 않는다)", () => {
    const file = mustParse(JSON.stringify(serialize(tabs, "t1")));
    const before = listPanes(tree).map((p) => p.id);
    const after = listPanes(deserialize(file).tabs[0].root).map((p) => p.id);
    expect(after).toHaveLength(before.length);
    expect(after.some((id) => before.includes(id))).toBe(false);
  });
});

describe("프로젝트 시작 화면 — 주소만 저장하고 그대로 돌아온다", () => {
  it("프로젝트 id · 워크트리 폴더가 왕복한다 (대화 목록·제목은 담지 않는다)", () => {
    const start = newProjectStartPane("P1", "C:\\src\\aynx");
    const tabs = [tab("t1", split("row", leafOf(newLocalPane("pwsh")), leafOf(start)), "aynx · main")];
    const saved = serialize(tabs, "t1");
    const leafB = (saved.workspaces[0].root as SavedSplit).b;
    expect(leafB).toEqual({ kind: "start", startProject: { projectId: "P1", folder: "C:\\src\\aynx" } });
    const { tabs: restored } = deserialize(mustParse(JSON.stringify(saved)));
    const back = listPanes(restored[0].root)[1];
    expect(back.kind).toBe("start");
    expect(back.startProject).toEqual({ projectId: "P1", folder: "C:\\src\\aynx" });
    expect(back.id).not.toBe(start.id);
    expect(restored[0].title).toBe("aynx · main");
  });

  it("평범한 launcher 에는 키가 없다 · 못 쓸 주소는 그 칸만 떨어져 launcher 로 선다", () => {
    expect(saveNode(leafOf(newStartPane()))).toEqual({ kind: "start" });
    expect(parseNode({ kind: "start", startProject: { projectId: "", folder: "C:/x" } })).toEqual({ kind: "start" });
    expect(parseNode({ kind: "start", startProject: "P1" })).toEqual({ kind: "start" });
    // 시작 타일이 아닌 잎의 주소는 받지 않는다
    expect(parseNode({ kind: "local", startProject: { projectId: "P", folder: "C:/x" } })).toEqual({ kind: "local" });
  });
});

describe("브랜치 그래프 — 주소(프로젝트 id · 고른 브랜치)만 저장한다 (docs/log/2026-09-29-branch-graph.md)", () => {
  it("프로젝트 id · 고른 브랜치가 왕복하고 화면용 이름은 담지 않는다", () => {
    const g = newBranchesPane("P1", "fix-token");
    g.branchGraph = { ...g.branchGraph!, name: "api-server" };
    const tabs = [tab("t1", split("row", leafOf(newLocalPane("pwsh")), leafOf(g)), "api")];
    const saved = serialize(tabs, "t1");
    expect((saved.workspaces[0].root as SavedSplit).b).toEqual({
      kind: "branches",
      branchGraph: { projectId: "P1", branch: "fix-token" },
    });
    const { tabs: restored } = deserialize(mustParse(JSON.stringify(saved)));
    const back = listPanes(restored[0].root)[1];
    expect(back.kind).toBe("branches");
    expect(back.branchGraph).toEqual({ projectId: "P1", branch: "fix-token" });
    expect(back.id).not.toBe(g.id);
  });

  it("브랜치가 없으면 키가 없다 · 주소 없는 잎은 복원에서 빠진다(파일 전체는 산다)", () => {
    expect(saveNode(leafOf(newBranchesPane("P1")))).toEqual({ kind: "branches", branchGraph: { projectId: "P1" } });
    expect(parseNode({ kind: "branches", branchGraph: { projectId: " ", branch: "x" } })).toEqual({ kind: "branches" });
    expect(parseNode({ kind: "branches", branchGraph: "P1" })).toEqual({ kind: "branches" });
    // 브랜치 그래프가 아닌 잎의 주소는 받지 않는다
    expect(parseNode({ kind: "local", branchGraph: { projectId: "P1" } })).toEqual({ kind: "local" });
    const root = restoreNode({ dir: "row", ratio: 0.5, a: { kind: "local" }, b: { kind: "branches" } });
    expect(listPanes(root).map((p) => p.kind)).toEqual(["local"]);
    // 혼자였으면 시작 타일로
    expect(listPanes(restoreNode({ kind: "branches" })).map((p) => p.kind)).toEqual(["start"]);
  });

  it("분할 복제는 주소를 물려주되 객체를 나눠 들지 않는다 — 고른 브랜치는 통째로 새로 단다", () => {
    const g = newBranchesPane("P1", "a");
    const copy = clonePane(g);
    expect(copy.branchGraph).toEqual({ projectId: "P1", branch: "a" });
  });
});

describe("diff 타일 — 주소(범위 · 브랜치 · 워크트리 · 커밋 · 파일 · 보기)만 저장한다 (docs/log/2026-10-05-diff-tile.md)", () => {
  it("주소가 늘 같은 키 순서로 왕복하고 화면용 이름은 담지 않는다", () => {
    const d = newDiffPane({
      projectId: "P1",
      scope: "commit",
      branch: "feat",
      worktreePath: "C:/w",
      commit: "abc1234",
      file: "src/a.ts",
      view: "split",
      name: "api",
    });
    const tabs = [tab("t1", split("row", leafOf(newLocalPane("pwsh")), leafOf(d)), "api")];
    const saved = serialize(tabs, "t1");
    const b = (saved.workspaces[0].root as SavedSplit).b;
    expect(JSON.stringify(b)).toBe(
      '{"kind":"diff","diff":{"projectId":"P1","scope":"commit","branch":"feat","worktreePath":"C:/w","commit":"abc1234","file":"src/a.ts","view":"split"}}',
    );
    const { tabs: restored } = deserialize(mustParse(JSON.stringify(saved)));
    const back = listPanes(restored[0].root)[1];
    expect(back.kind).toBe("diff");
    expect(back.diff).toEqual({
      projectId: "P1",
      scope: "commit",
      branch: "feat",
      worktreePath: "C:/w",
      commit: "abc1234",
      file: "src/a.ts",
      view: "split",
    });
  });

  it("보고 범위(range — 오케스트레이션 4단계)의 기준 · 끝 커밋도 왕복한다", () => {
    const saved = saveNode(
      leafOf(newDiffPane({ projectId: "P1", scope: "range", branch: "orch-1", worktreePath: "C:/wt", base: "aaaaaaa", tip: "bbbbbbb" })),
    );
    expect(JSON.stringify(saved)).toBe(
      '{"kind":"diff","diff":{"projectId":"P1","scope":"range","branch":"orch-1","worktreePath":"C:/wt","base":"aaaaaaa","tip":"bbbbbbb"}}',
    );
    expect(parseNode(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("한 줄 보기(기본)는 키가 없다 · 모르는 범위 · 빈 id 는 칸이 떨어지고 그 잎은 복원에서 빠진다", () => {
    expect(saveNode(leafOf(newDiffPane({ projectId: "P1", scope: "branch", branch: "x", view: "unified" })))).toEqual({
      kind: "diff",
      diff: { projectId: "P1", scope: "branch", branch: "x" },
    });
    expect(parseNode({ kind: "diff", diff: { projectId: "P1", scope: "nope" } })).toEqual({ kind: "diff" });
    expect(parseNode({ kind: "diff", diff: { projectId: " ", scope: "wip" } })).toEqual({ kind: "diff" });
    expect(parseNode({ kind: "local", diff: { projectId: "P1", scope: "wip" } })).toEqual({ kind: "local" });
    const root = restoreNode({ dir: "row", ratio: 0.5, a: { kind: "local" }, b: { kind: "diff" } });
    expect(listPanes(root).map((p) => p.kind)).toEqual(["local"]);
  });
});

describe("쿼리 타일 — 주소(연결 id · 초안)만 저장한다", () => {
  it("늘 같은 키 순서로 왕복하고 화면용 이름은 담지 않는다 · tileKey 는 워크스페이스 키로 실린다", () => {
    const q = newQueryPane({ connId: "AbCdEf123456", sql: "SELECT 1;", name: "shop · web-01" });
    q.tileKey = "tile-q";
    const local = newQueryPane({ connId: "LocalId00001" });
    const tabs = [tab("t1", split("row", leafOf(q), leafOf(local)), "db")];
    const saved = serialize(tabs, "t1");
    const root = saved.workspaces[0].root as SavedSplit;
    expect(JSON.stringify(root.a)).toContain('"query":{"connId":"AbCdEf123456","sql":"SELECT 1;"}}');
    expect(JSON.stringify(root.b)).toBe('{"kind":"query","query":{"connId":"LocalId00001"}}');
    const { tabs: restored } = deserialize(mustParse(JSON.stringify(saved)));
    const [a, b] = listPanes(restored[0].root);
    expect(a.kind).toBe("query");
    expect(a.query).toEqual({ connId: "AbCdEf123456", sql: "SELECT 1;" });
    expect(b.query).toEqual({ connId: "LocalId00001" });
    expect(saveNode(leafOf(q), true)).toMatchObject({ tileKey: "tile-q" });
  });

  it("예전(10-13 전) 저장본의 host 칸은 버리고 연결 id 로 그대로 열린다", () => {
    expect(parseNode({ kind: "query", query: { host: "web-01", connId: "AbCdEf123456", sql: "SELECT 1" } })).toEqual({
      kind: "query",
      query: { connId: "AbCdEf123456", sql: "SELECT 1" },
    });
    expect(parseNode({ kind: "query", query: { host: null, connId: "LocalId00001" } })).toEqual({
      kind: "query",
      query: { connId: "LocalId00001" },
    });
    const root = restoreNode({ kind: "query", query: { host: "web-01", connId: "AbCdEf123456" } } as never);
    expect(listPanes(root)[0].query).toEqual({ connId: "AbCdEf123456" });
  });

  it("초안이 상한을 넘으면 싣지 않는다 · 빈 초안도 없다", () => {
    const big = "x".repeat(QUERY_DRAFT_MAX + 1);
    const q = newQueryPane({ connId: "LocalId00001" });
    q.query = { ...q.query!, sql: big };
    expect(saveNode(leafOf(q))).toEqual({ kind: "query", query: { connId: "LocalId00001" } });
    expect(newQueryPane({ connId: "LocalId00001", sql: big }).query?.sql).toBeUndefined();
    expect(newQueryPane({ connId: " LocalId00001 ", sql: "  " }).query).toEqual({ connId: "LocalId00001" });
    expect(parseNode({ kind: "query", query: { connId: "LocalId00001", sql: big } })).toEqual({
      kind: "query",
      query: { connId: "LocalId00001" },
    });
  });

  it("연결 id 가 없으면 칸이 떨어지고 그 잎은 복원에서 빠진다", () => {
    expect(parseNode({ kind: "query", query: { host: "a", connId: " " } })).toEqual({ kind: "query" });
    expect(parseNode({ kind: "query" })).toEqual({ kind: "query" });
    const root = restoreNode({ dir: "row", ratio: 0.5, a: { kind: "local" }, b: { kind: "query" } });
    expect(listPanes(root).map((p) => p.kind)).toEqual(["local"]);
  });

  it("스크립트 탭(10-14) — 둘 이상이면 scripts · active 로 왕복, 하나면 예전 sql 모양", () => {
    const q = newQueryPane({
      connId: "LocalId00001",
      maxRows: 5000,
      scripts: [{ n: 1, sql: "SELECT 1" }, { n: 2, title: "정산" }],
      active: 2,
    });
    const saved = saveNode(leafOf(q));
    expect(JSON.stringify(saved)).toBe(
      '{"kind":"query","query":{"connId":"LocalId00001","maxRows":5000,"scripts":[{"n":1,"sql":"SELECT 1"},{"n":2,"title":"정산"}],"active":2}}',
    );
    expect(parseNode(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(listPanes(restoreNode(saved))[0].query?.scripts).toEqual([{ n: 1, sql: "SELECT 1" }, { n: 2, title: "정산" }]);
    const one = newQueryPane({ connId: "LocalId00001", scripts: [{ n: 1, sql: "SELECT 9" }], active: 1 });
    expect(saveNode(leafOf(one))).toEqual({ kind: "query", query: { connId: "LocalId00001", sql: "SELECT 9" } });
    // 망가진 scripts 는 옛 sql 로 물러난다
    expect(parseNode({ kind: "query", query: { connId: "LocalId00001", sql: "S", scripts: [{ n: -1 }] } })).toEqual({
      kind: "query",
      query: { connId: "LocalId00001", sql: "S" },
    });
  });

  it("행 상한은 고를 수 있는 값이 기본(1000)이 아닐 때만 실려 왕복한다", () => {
    const q = newQueryPane({ connId: "LocalId00001", sql: "SELECT 1", maxRows: 5000 });
    expect(q.query?.maxRows).toBe(5000);
    const saved = saveNode(leafOf(q));
    expect(JSON.stringify(saved)).toBe('{"kind":"query","query":{"connId":"LocalId00001","sql":"SELECT 1","maxRows":5000}}');
    expect(parseNode(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(newQueryPane({ connId: "LocalId00001", maxRows: 1000 }).query).toEqual({ connId: "LocalId00001" });
    for (const bad of [1000, 1234, "5000", -1, null]) {
      expect(parseNode({ kind: "query", query: { connId: "LocalId00001", maxRows: bad } })).toEqual({
        kind: "query",
        query: { connId: "LocalId00001" },
      });
    }
    const big = newQueryPane({ connId: "AbCdEf123456", maxRows: 10000 });
    big.tileKey = "tile-r";
    const { tabs: restored } = deserialize(mustParse(JSON.stringify(serialize([tab("t1", leafOf(big), "db")], "t1"))));
    expect(listPanes(restored[0].root)[0].query).toEqual({ connId: "AbCdEf123456", maxRows: 10000 });
  });

  it("복제는 주소 객체를 나눠 들지 않는다", () => {
    const q = newQueryPane({ connId: "LocalId00001", sql: "SELECT 1" });
    const copy = clonePane(q);
    expect(copy.query).toEqual(q.query);
    expect(copy.query).not.toBe(q.query);
  });
});

describe("걷은 작업안 타일(`plans` — 2026-10-25 채팅 독 갈래로) — 잎만 조용히 빼고 형제가 자리를 차지한다", () => {
  const plans = { kind: "plans" } as never;

  it("pruneRetiredLeaves — 분할의 한쪽이면 다른 쪽이 승격 · 깊은 곳도 · 전부면 null", () => {
    expect(pruneRetiredLeaves({ dir: "row", ratio: 0.55, a: { kind: "local" }, b: plans })).toEqual({ kind: "local" });
    const deep = pruneRetiredLeaves({
      dir: "row",
      ratio: 0.5,
      a: { dir: "col", ratio: 0.5, a: plans, b: { kind: "doc", path: "C:/a.md" } },
      b: { kind: "local" },
    });
    expect(deep).toEqual({ dir: "row", ratio: 0.5, a: { kind: "doc", path: "C:/a.md" }, b: { kind: "local" } });
    expect(pruneRetiredLeaves(plans)).toBeNull();
    const same = { dir: "row" as const, ratio: 0.5, a: { kind: "local" as const }, b: { kind: "ssh" as const, alias: "x" } };
    expect(pruneRetiredLeaves(same)).toBe(same);
  });

  it("restoreNode — 워크스페이스 v2(검증 없이 오는 트리)에서 빼고, 그 잎뿐이면 시작 타일", () => {
    const root = restoreNode({ dir: "row", ratio: 0.55, a: { kind: "local" }, b: plans });
    expect(listPanes(root).map((p) => p.kind)).toEqual(["local"]);
    expect(listPanes(restoreNode(plans)).map((p) => p.kind)).toEqual(["start"]);
  });

  it("parseNode — 탭 파일 · 프리셋에서도 파일을 버리지 않고 뺀다", () => {
    expect(parseNode({ dir: "row", ratio: 0.55, a: { kind: "local" }, b: { kind: "plans" } })).toEqual({ kind: "local" });
    expect(parseNode({ dir: "col", ratio: 0.5, a: { kind: "plans" }, b: { kind: "start" } })).toEqual({ kind: "start" });
    expect(parseNode({ kind: "plans" })).toEqual({ kind: "start" });
  });
});

describe("parseNode / parseLeaf — 모르는 값은 통째로 null", () => {
  it("아는 종류는 통과한다", () => {
    for (const kind of ["local", "ssh", "sftp", "localfs", "start", "doc"]) {
      const raw = kind === "ssh" || kind === "sftp" ? { kind, alias: "web-01" } : { kind };
      expect(parseNode(raw)).not.toBeNull();
    }
  });

  it("local 의 cwd 는 공백을 떼고, 빈 값·비문자열이면 키를 두지 않는다 (`path` 와 같은 자리)", () => {
    expect(parseNode({ kind: "local", cwd: "  C:/src/proj  " })).toMatchObject({
      cwd: "C:/src/proj",
    });
    expect(parseNode({ kind: "local", cwd: "   " })).not.toHaveProperty("cwd");
    expect(parseNode({ kind: "local", cwd: 7 })).not.toHaveProperty("cwd");
  });

  it("미지 kind 는 잎이 통째로 null 이 된다 (지워진 `hosts` 도 그 부류다)", () => {
    expect(parseNode({ kind: "quantum-terminal" })).toBeNull();
    // 2026-09-08 에 지운 호스트 타일 — 마이그레이션을 두지 않았으므로 여느 미지 값과 같다
    // (docs/log/2026-09-08-remove-hosts-tile.md). `workspaces.json` 이면 파일 전체를 버리고,
    // 배치 프리셋이면 그 한 줄만 목록에서 빠진다.
    expect(parseNode({ kind: "hosts" })).toBeNull();
    expect(parseNode({ kind: 42 })).toBeNull();
    expect(parseNode({})).toBeNull();
  });

  it("start 는 반드시 살아남는다 — 빼면 빈 탭이 파일 전체를 무너뜨린다", () => {
    expect(parseNode({ kind: "start" })).toEqual({ kind: "start" });
  });

  it("별칭 없는 ssh·sftp 잎은 되살릴 곳이 없어 null 이다", () => {
    expect(parseNode({ kind: "ssh" })).toBeNull();
    expect(parseNode({ kind: "ssh", alias: "   " })).toBeNull();
    expect(parseNode({ kind: "sftp" })).toBeNull();
  });

  it("문자열 칸은 트리밍하고, 빈 값이면 키를 두지 않는다", () => {
    expect(parseNode({ kind: "ssh", alias: "  web-01  " })).toEqual({
      kind: "ssh",
      alias: "web-01",
    });
    expect(parseNode({ kind: "local", shell: "   ", path: "  " })).toEqual({ kind: "local" });
  });

  it("범위를 벗어난 스크롤백은 잘라 맞추지 않고 통째로 버린다", () => {
    expect(parseNode({ kind: "local", scrollback: 5 })).toEqual({ kind: "local" });
    expect(parseNode({ kind: "local", scrollback: 5_000_000 })).toEqual({ kind: "local" });
    expect(parseNode({ kind: "local", scrollback: "많이" })).toEqual({ kind: "local" });
    expect(parseNode({ kind: "local", scrollback: 10_000 })).toEqual({
      kind: "local",
      scrollback: 10_000,
    });
  });

  it("분할은 방향이 row·col 이어야 하고 양쪽 가지가 다 성해야 한다", () => {
    const leaf = { kind: "start" };
    expect(parseNode({ dir: "diagonal", ratio: 0.5, a: leaf, b: leaf })).toBeNull();
    expect(parseNode({ dir: "row", ratio: 0.5, a: leaf })).toBeNull();
    expect(parseNode({ dir: "row", ratio: 0.5, a: leaf, b: { kind: "nope" } })).toBeNull();
  });

  it("비율은 범위 안으로 클램프된다 (숫자가 아니면 기본값)", () => {
    const leaf = { kind: "start" };
    const wide = parseNode({ dir: "row", ratio: 0.99, a: leaf, b: leaf });
    const none = parseNode({ dir: "row", ratio: "반쯤", a: leaf, b: leaf });
    if (!wide || !isSavedSplit(wide)) throw new Error("분할이 아니다");
    if (!none || !isSavedSplit(none)) throw new Error("분할이 아니다");
    expect(wide.ratio).toBeCloseTo(0.85);
    expect(none.ratio).toBeCloseTo(0.5);
  });

  it("원시 값·null·깊은 순환 트리에서도 던지지 않는다", () => {
    for (const raw of [null, undefined, 42, "start", true, []]) {
      expect(() => parseNode(raw)).not.toThrow();
      expect(parseNode(raw)).toBeNull();
    }
    // 깊이 상한(64) — 손으로 만든 거대·순환 트리 방어
    let deep: Record<string, unknown> = { kind: "start" };
    for (let i = 0; i < 70; i++) deep = { dir: "row", ratio: 0.5, a: deep, b: { kind: "start" } };
    expect(() => parseNode(deep)).not.toThrow();
    expect(parseNode(deep)).toBeNull();
  });
});

describe("parseTabFile — 잘못된 입력에서 던지지 않고 null", () => {
  const ok = JSON.stringify({
    version: TAB_FILE_VERSION,
    activeIndex: 0,
    workspaces: [{ title: "작업", root: { kind: "start" } }],
  });

  const bad: Array<[label: string, json: string | null | undefined]> = [
    ["null", null],
    ["undefined", undefined],
    ["빈 문자열", ""],
    ["공백뿐", "   "],
    ["깨진 JSON", "{ this is not json"],
    ["잘린 JSON", '{"version":1,"workspaces":['],
    ["최상위가 배열", "[]"],
    ["최상위가 숫자", "7"],
    ["최상위가 null 리터럴", "null"],
    ["버전 없음", '{"activeIndex":0,"workspaces":[{"title":"","root":{"kind":"start"}}]}'],
    [
      "버전 불일치 (미래)",
      '{"version":2,"activeIndex":0,"workspaces":[{"title":"","root":{"kind":"start"}}]}',
    ],
    [
      "버전 불일치 (문자열)",
      '{"version":"1","activeIndex":0,"workspaces":[{"title":"","root":{"kind":"start"}}]}',
    ],
    ["workspaces 없음", '{"version":1,"activeIndex":0}'],
    ["workspaces 가 배열이 아님", '{"version":1,"activeIndex":0,"workspaces":{}}'],
    ["빈 목록", '{"version":1,"activeIndex":0,"workspaces":[]}'],
    ["탭이 객체가 아님", '{"version":1,"activeIndex":0,"workspaces":[null]}'],
    ["빈 트리 (root 없음)", '{"version":1,"activeIndex":0,"workspaces":[{"title":"작업"}]}'],
    [
      "root 가 빈 객체",
      '{"version":1,"activeIndex":0,"workspaces":[{"title":"작업","root":{}}]}',
    ],
  ];

  for (const [label, json] of bad) {
    it(`${label} → null (던지지 않는다)`, () => {
      expect(() => parseTabFile(json)).not.toThrow();
      expect(parseTabFile(json)).toBeNull();
    });
  }

  it("성한 파일은 통과한다", () => {
    expect(parseTabFile(ok)).not.toBeNull();
  });

  // ── 계약: **부분 복구는 하지 않는다** ────────────────────────────────────
  //
  // 잎 하나의 `kind` 를 못 알아보면 `parseLeaf` 가 null 을 돌려주고, 그 null 이
  // `parseNode` → `parseTabFile` 로 연쇄해 **파일 전체가 버려진다**. 소스의 주석이
  // 이것을 의도된 결정으로 적어 두었다: 반쯤 복원된 배치는 무엇을 잃었는지 알 수 없어
  // 아무것도 복원하지 않는 것보다 나쁘다 ("파일을 의심한다").
  //
  // 아래 두 케이스가 그 계약의 양쪽 끝이다 — 망가진 것이 **다른 탭**에 있든
  // **같은 탭의 형제 잎**이든, 답은 똑같이 `null` 이다.

  it("미지 kind 가 다른 탭에 있어도 파일 전체를 버린다 (부분 복구 없음)", () => {
    const json = JSON.stringify({
      version: TAB_FILE_VERSION,
      activeIndex: 0,
      workspaces: [
        { title: "성한 판", root: { kind: "start" } },
        { title: "망가진 판", root: { kind: "quantum-terminal" } },
      ],
    });
    expect(parseTabFile(json)).toBeNull();
  });

  it("미지 kind 가 분할의 한쪽 잎이어도 파일 전체를 버린다 (부분 복구 없음)", () => {
    const json = JSON.stringify({
      version: TAB_FILE_VERSION,
      activeIndex: 0,
      workspaces: [
        { title: "성한 판", root: { kind: "start" } },
        {
          title: "섞인 판",
          root: { dir: "row", ratio: 0.5, a: { kind: "start" }, b: { kind: "quantum" } },
        },
      ],
    });
    expect(parseTabFile(json)).toBeNull();
  });

  it("activeIndex 가 범위를 벗어나면 0 으로 떨어진다", () => {
    const json = (at: unknown) =>
      JSON.stringify({
        version: TAB_FILE_VERSION,
        activeIndex: at,
        workspaces: [
          { title: "a", root: { kind: "start" } },
          { title: "b", root: { kind: "start" } },
        ],
      });
    expect(mustParse(json(1)).activeIndex).toBe(1);
    expect(mustParse(json(5)).activeIndex).toBe(0);
    expect(mustParse(json(-1)).activeIndex).toBe(0);
    expect(mustParse(json("두 번째")).activeIndex).toBe(0);
    expect(mustParse(json(1.7)).activeIndex).toBe(1); // 내림
  });

  it("title 이 문자열이 아니면 빈 제목으로, name 은 트리밍된다", () => {
    const file = mustParse(
      JSON.stringify({
        version: TAB_FILE_VERSION,
        activeIndex: 0,
        workspaces: [{ title: 7, name: "  배포  ", root: { kind: "start" } }],
      }),
    );
    expect(file.workspaces[0].title).toBe("");
    expect(file.workspaces[0].name).toBe("배포");
  });
});

describe("restoreNode — SSH 는 연결 대기로 뜬다", () => {
  it("기본값은 연결 대기(deferred)다 — 앱을 켜는 것만으로 접속하지 않는다", () => {
    const root = restoreNode({ kind: "ssh", alias: "web-01" });
    expect(listPanes(root)[0].deferred).toBe(true);
  });

  it("SSH 시작 폴더는 위치 힌트로 복원·재저장하고 접속 명령은 되살리지 않는다", () => {
    const root = restoreNode({ kind: "ssh", alias: "web-01", cwd: "~/api", autorun: "codex" });
    const pane = listPanes(root)[0];
    expect(pane.cwd).toBeUndefined();
    expect(pane.autorun).toBeUndefined();
    expect(pane.restart?.cwd).toBe("~/api");
    expect(saveNode(root, true)).toMatchObject({ cwd: "~/api" });
    expect(saveNode(root, true)).not.toHaveProperty("autorun");
  });

  it("deferSsh:false 면 대기 표시가 붙지 않는다", () => {
    const root = restoreNode({ kind: "ssh", alias: "web-01" }, { deferSsh: false });
    expect(listPanes(root)[0].deferred).toBeUndefined();
  });

  it("SSH 가 아닌 잎에는 대기 표시가 붙지 않는다", () => {
    const root = restoreNode({ dir: "row", ratio: 0.5, a: { kind: "local" }, b: { kind: "start" } });
    expect(listPanes(root).every((p) => p.deferred === undefined)).toBe(true);
  });

  it("local 의 autorun·scrollback 이 되살아난다 (Claude Code 타일의 근거)", () => {
    const pane = listPanes(
      restoreNode({ kind: "local", shell: "pwsh", autorun: "claude", scrollback: 10_000 }),
    )[0];
    expect(pane.kind).toBe("local");
    expect(pane.shell).toBe("pwsh");
    expect(pane.autorun).toBe("claude");
    expect(pane.scrollback).toBe(10_000);
  });

  it("local 의 cwd 가 되살아난다 (복원된 AI 타일이 그 프로젝트 폴더에서 뜬다)", () => {
    const pane = listPanes(restoreNode({ kind: "local", autorun: "claude", cwd: "C:/src/proj" }))[0];
    expect(pane.cwd).toBe("C:/src/proj");
    // 안 정한 타일은 "안 정함"(= 홈) 그대로다.
    expect(listPanes(restoreNode({ kind: "local" }))[0].cwd).toBeUndefined();
  });

  it("local 의 injectMcpToken(AI 타일 표식)이 저장·복원을 넘는다 (복원된 codex 인증)", () => {
    // 저장본엔 표식(boolean)만 남는다 — 토큰 자체는 파일에 없다(세션 열 때 McpState 에서 주입).
    const saved = saveNode(leafOf(newAiPane("codex")));
    expect(saved).toMatchObject({ autorun: "codex", injectMcpToken: true });
    // 복원하면 autorun 과 나란히 표식이 패널로 돌아온다 — 첫 세션에서 토큰을 주입한다.
    const pane = listPanes(restoreNode(saved))[0];
    expect(pane.autorun).toBe("codex");
    expect(pane.injectMcpToken).toBe(true);
  });

  it("대화 연결 사본(agentLink)이 저장·복원을 넘는다 · 모양이 틀리면 떨군다 · 옛 파일은 연결 없음 · 복제는 떨군다", () => {
    const id = "0123abcd-0000-4000-8000-000000000001";
    const ai = { ...newAiPane("claude"), agentLink: { agent: "claude", id } };
    const saved = saveNode(leafOf(ai));
    expect(saved).toMatchObject({ agentLink: { agent: "claude", id } });
    expect(listPanes(restoreNode(parseNode(JSON.parse(JSON.stringify(saved)))!))[0].agentLink).toEqual({ agent: "claude", id });
    // 원격 타일도
    const ssh = { ...newSshPane("dev-01"), agentLink: { agent: "codex", id } };
    expect(listPanes(restoreNode(saveNode(leafOf(ssh))))[0].agentLink).toEqual({ agent: "codex", id });
    // 모양 검사 — 모르는 에이전트 · 이상한 id 는 칸을 떨군다(대문자는 소문자로)
    expect(parseNode({ kind: "local", agentLink: { agent: "gpt", id } })).toEqual({ kind: "local" });
    expect(parseNode({ kind: "local", agentLink: { agent: "claude", id: "x;rm" } })).toEqual({ kind: "local" });
    expect(parseNode({ kind: "local", agentLink: { agent: "claude", id: id.toUpperCase() } })).toEqual({ kind: "local", agentLink: { agent: "claude", id } });
    // 옛 파일(칸 없음) = 연결 없음
    expect(listPanes(restoreNode({ kind: "local", autorun: "claude" }))[0].agentLink).toBeUndefined();
    expect(clonePane(ai).agentLink).toBeUndefined();
  });

  it("localfs 는 저장해 둔 폴더에서 시작한다", () => {
    expect(listPanes(restoreNode({ kind: "localfs", path: "C:/work" }))[0].path).toBe("C:/work");
    expect(listPanes(restoreNode({ kind: "localfs" }))[0].path).toBeUndefined();
  });

  it("파일 타일의 보기(fileView)는 왕복한다 · 고른 적 없으면 키가 없다 · 모르는 값은 버린다", () => {
    // docs/log/2026-10-07-file-tile-dolphin.md — `path` 와 같은 무리
    const local = { ...newLocalFsPane("C:/work"), fileView: "compact" as const };
    const sftp = { ...newSftpPane("p1", "web-01", "/srv"), fileView: "icons" as const };
    for (const pane of [local, sftp]) {
      const saved = saveNode(leafOf(pane));
      expect(saved).toMatchObject({ fileView: pane.fileView });
      expect(parseNode(JSON.parse(JSON.stringify(saved)))).toMatchObject({ fileView: pane.fileView });
    }
    // 되살리기 — 로컬은 홀로 선다 (SFTP 는 짝 SSH 타일이 있어야 남으므로 아래 트리로 본다)
    expect(listPanes(restoreNode({ kind: "localfs", path: "C:/w", fileView: "compact" }))[0].fileView).toBe("compact");
    const withSsh = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: "web-01" },
      b: { kind: "sftp", alias: "web-01", path: "/srv", fileView: "icons" },
    });
    expect(listPanes(withSsh).find((p) => p.kind === "sftp")?.fileView).toBe("icons");
    expect("fileView" in saveNode(leafOf(newLocalFsPane("C:/work")))).toBe(false);
    const odd = parseNode({ kind: "localfs", path: "C:/w", fileView: "grid" });
    expect(odd && "fileView" in odd).toBe(false);
  });

  it("옛 보기 값(tree · navigate)은 읽을 때 자세히(details)로 옮긴다", () => {
    for (const old of ["tree", "navigate"]) {
      expect(parseNode({ kind: "localfs", path: "C:/w", fileView: old })).toMatchObject({ fileView: "details" });
    }
  });

  it("숨김 파일 보기는 켤 때만 왕복한다 — 옛 파일(칸 없음)은 꺼짐 · sftp 도 같다", () => {
    const base = newLocalFsPane("C:/work");
    const saved = saveNode(leafOf({ ...base, fileHidden: true as const }));
    expect(saved).toMatchObject({ fileHidden: true });
    expect(listPanes(restoreNode(JSON.parse(JSON.stringify(saved))))[0].fileHidden).toBe(true);
    const plain = saveNode(leafOf(base));
    expect("fileHidden" in plain).toBe(false);
    expect(listPanes(restoreNode(JSON.parse(JSON.stringify(plain))))[0].fileHidden).toBeUndefined();
    // 원격 파일 타일 — 복원은 같은 별칭의 SSH 타일에 다시 묶는다(짝이 없으면 뺀다)
    const remote = saveNode(
      split("col", leafOf(newSshPane("web-01", 10_000)), leafOf({ ...newSftpPane("p", "web-01", "/srv"), fileHidden: true as const }), 0.4),
    );
    const panes = listPanes(restoreNode(JSON.parse(JSON.stringify(remote))));
    expect(panes.find((p) => p.kind === "sftp")?.fileHidden).toBe(true);
    const odd = parseNode({ kind: "localfs", path: "C:/w", fileHidden: "1" });
    expect(odd && "fileHidden" in odd).toBe(false);
  });

  it("아이콘 크기 단계 · 장소 패널 끔은 왕복하고, 기본값이면 키가 없다", () => {
    const pane = { ...newLocalFsPane("C:/work"), fileZoom: 3, filePlaces: false as const, filePreview: true as const };
    const saved = saveNode(leafOf(pane));
    expect(saved).toMatchObject({ fileZoom: 3, filePlaces: false, filePreview: true });
    const back = listPanes(restoreNode(JSON.parse(JSON.stringify(saved))))[0];
    expect(back.fileZoom).toBe(3);
    expect(back.filePlaces).toBe(false);
    expect(back.filePreview).toBe(true);
    const plain = saveNode(leafOf({ ...newLocalFsPane("C:/work"), fileZoom: 1 }));
    expect("fileZoom" in plain || "filePlaces" in plain).toBe(false);
    // 범위 밖·정수가 아닌 크기, `false` 가 아닌 패널 값은 버린다
    for (const bad of [9, -1, 1.5, "2"]) {
      const odd = parseNode({ kind: "localfs", path: "C:/w", fileZoom: bad, filePlaces: true, filePreview: false });
      expect(odd && ("fileZoom" in odd || "filePlaces" in odd || "filePreview" in odd)).toBe(false);
    }
  });

  it("모르는 종류가 검증을 건너뛰고 들어오면 시작 타일로 떨어진다 (마지막 방어선)", () => {
    // `parseNode` 를 지나면 여기까지 올 수 없지만, 다른 입구를 위한 기본값이다.
    const root = restoreNode({ kind: "quantum" } as unknown as SavedNode);
    expect(listPanes(root)[0].kind).toBe("start");
  });
});

describe("rebindSftp — SFTP 패널을 새 세션에 다시 묶는 규칙", () => {
  it("같은 탭 안의 같은 별칭 SSH 타일에 붙는다", () => {
    const root = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: "web-01" },
      b: { kind: "sftp", alias: "web-01" },
    });
    const panes = listPanes(root);
    const ssh = panes.find((p) => p.kind === "ssh");
    const sftp = panes.find((p) => p.kind === "sftp");
    expect(sftp?.sourcePaneId).toBe(ssh?.id);
    expect(sftp?.sourcePaneId).not.toBe("");
  });

  it("SFTP 가 SSH 보다 트리에서 앞에 있어도 묶인다 (순서 무관)", () => {
    const root = restoreNode({
      dir: "col",
      ratio: 0.5,
      a: { kind: "sftp", alias: "web-01" },
      b: { kind: "ssh", alias: "web-01" },
    });
    const panes = listPanes(root);
    expect(panes.find((p) => p.kind === "sftp")?.sourcePaneId).toBe(
      panes.find((p) => p.kind === "ssh")?.id,
    );
  });

  it("같은 별칭 SSH 가 여럿이면 **트리에서 먼저 나오는 것**(왼쪽·위)에 붙는다", () => {
    const root = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: "web-01" },
      b: {
        dir: "col",
        ratio: 0.5,
        a: { kind: "ssh", alias: "web-01" },
        b: { kind: "sftp", alias: "web-01" },
      },
    });
    const panes = listPanes(root);
    const sshIds = panes.filter((p) => p.kind === "ssh").map((p) => p.id);
    expect(sshIds).toHaveLength(2);
    expect(panes.find((p) => p.kind === "sftp")?.sourcePaneId).toBe(sshIds[0]);
  });

  it("짝이 없으면 잎을 빼고 형제를 승격시킨다 (죽은 배너 타일을 남기지 않는다)", () => {
    const root = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: "db-01" },
      b: { kind: "sftp", alias: "web-01" },
    });
    expect(kinds(root)).toEqual(["ssh"]);
    expect(root.type).toBe("leaf");
  });

  it("별칭 비교는 앞뒤 공백을 무시한다", () => {
    const root = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { kind: "ssh", alias: " web-01 " },
      b: { kind: "sftp", alias: "web-01" },
    });
    // `parseLeaf` 를 거치지 않은 원시 값이라 별칭에 공백이 남아 있어도 짝을 찾아야 한다.
    expect(kinds(root)).toEqual(["ssh", "sftp"]);
    expect(listPanes(root).find((p) => p.kind === "sftp")?.sourcePaneId).toBeTruthy();
  });

  it("탭이 SFTP 잎 하나뿐이었으면 시작 타일로 되돌린다", () => {
    const root = restoreNode({ kind: "sftp", alias: "web-01" });
    expect(kinds(root)).toEqual(["start"]);
  });

  it("짝 없는 SFTP 가 여럿이어도 전부 빠지고 나머지는 남는다", () => {
    const root = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { dir: "col", ratio: 0.5, a: { kind: "sftp", alias: "a" }, b: { kind: "local" } },
      b: { kind: "sftp", alias: "b" },
    });
    expect(kinds(root)).toEqual(["local"]);
  });

  it("SFTP 는 **자기 탭 안**에서만 짝을 찾는다 (옆 판의 같은 별칭에 붙지 않는다)", () => {
    const file = mustParse(
      JSON.stringify({
        version: TAB_FILE_VERSION,
        activeIndex: 0,
        workspaces: [
          { title: "터미널만", root: { kind: "ssh", alias: "web-01" } },
          { title: "브라우저만", root: { kind: "sftp", alias: "web-01" } },
        ],
      }),
    );
    const { tabs: restored } = deserialize(file);
    expect(kinds(restored[0].root)).toEqual(["ssh"]);
    expect(kinds(restored[1].root)).toEqual(["start"]); // 짝이 없어 빠지고 시작 타일로
  });

  it("복원된 SFTP 는 저장 때의 옛 sourcePaneId 를 물려받지 않는다", () => {
    const saved = saveNode(
      split("row", leafOf(newSshPane("web-01")), leafOf(newSftpPane("pane-999", "web-01"))),
    );
    expect(JSON.stringify(saved)).not.toContain("pane-999");
    const panes = listPanes(restoreNode(saved));
    expect(panes.find((p) => p.kind === "sftp")?.sourcePaneId).not.toBe("pane-999");
  });
});

describe("문서 타일 — 저장과 복원 (docs/log/2026-09-27-doc-tile.md)", () => {
  it("로컬 문서는 경로만 담고 그대로 돌아온다 (별칭 없음 = 로컬)", () => {
    const saved = saveNode(leafOf(newDocPane("C:/work/README.md")));
    expect(saved).toEqual({ kind: "doc", path: "C:/work/README.md" });
    const parsed = parseNode(JSON.parse(JSON.stringify(saved)));
    expect(parsed).toEqual({ kind: "doc", path: "C:/work/README.md" });
    const [pane] = listPanes(restoreNode(parsed!));
    expect(pane.kind).toBe("doc");
    expect(pane.path).toBe("C:/work/README.md");
    expect(pane.alias).toBeUndefined();
    expect(pane.sourcePaneId).toBeUndefined();
  });

  it("원격 문서는 별칭만 담고(`sourcePaneId` 는 담지 않는다) 같은 별칭의 SSH 타일에 다시 묶인다", () => {
    const saved = saveNode(
      split(
        "row",
        leafOf(newSshPane("web-01")),
        leafOf(newDocPane("/etc/nginx/nginx.conf", { paneId: "pane-999", alias: "web-01" })),
      ),
    );
    expect(JSON.stringify(saved)).not.toContain("pane-999");
    const panes = listPanes(restoreNode(parseNode(JSON.parse(JSON.stringify(saved)))!));
    const ssh = panes.find((p) => p.kind === "ssh");
    const doc = panes.find((p) => p.kind === "doc");
    expect(doc?.alias).toBe("web-01");
    expect(doc?.path).toBe("/etc/nginx/nginx.conf");
    expect(doc?.sourcePaneId).toBe(ssh?.id);
  });

  it("짝 SSH 가 없는 원격 문서는 빠지고 나머지는 남는다 (SFTP 와 같은 규칙)", () => {
    const root = restoreNode({
      dir: "row",
      ratio: 0.5,
      a: { kind: "local" },
      b: { kind: "doc", alias: "web-01", path: "/srv/app.py" },
    });
    expect(kinds(root)).toEqual(["local"]);
    // 혼자였으면 시작 타일로 돌아간다
    expect(kinds(restoreNode({ kind: "doc", alias: "web-01", path: "/x" }))).toEqual(["start"]);
  });

  it("경로 없는 문서 잎은 **그 잎만** 빠진다 — 파일 전체를 버리지 않는다", () => {
    const file = mustParse(
      JSON.stringify({
        version: TAB_FILE_VERSION,
        activeIndex: 0,
        workspaces: [
          { title: "작업", root: { dir: "row", ratio: 0.5, a: { kind: "local" }, b: { kind: "doc" } } },
          { title: "문서", root: { kind: "doc", path: "C:/a.md" } },
        ],
      }),
    );
    const { tabs: restored } = deserialize(file);
    expect(kinds(restored[0].root)).toEqual(["local"]);
    expect(kinds(restored[1].root)).toEqual(["doc"]);
  });

  it("보기(`docMode`)는 기본(rendered)이 아닐 때만 저장된다", () => {
    const source = { ...newDocPane("C:/a.md"), docMode: "source" as const };
    const rendered = { ...newDocPane("C:/a.md"), docMode: "rendered" as const };
    expect(saveNode(leafOf(source))).toEqual({ kind: "doc", path: "C:/a.md", docMode: "source" });
    expect(saveNode(leafOf(rendered))).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md", docMode: "source" }))[0].docMode).toBe("source");
  });

  it("못 쓸 보기 값은 **그 칸만** 떨어진다 (잎은 산다) · 문서가 아닌 잎에는 싣지 않는다", () => {
    expect(parseNode({ kind: "doc", path: "C:/a.md", docMode: "wysiwyg" })).toEqual({
      kind: "doc",
      path: "C:/a.md",
    });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docMode: "rendered" })).toEqual({
      kind: "doc",
      path: "C:/a.md",
    });
    expect(parseNode({ kind: "localfs", path: "C:/w", docMode: "source" })).not.toHaveProperty("docMode");
  });

  it("미리 보기 표식(`docPreview`)은 참일 때만 저장되고 되살아난다 · 없으면 붙박이", () => {
    const pv = { ...newDocPane("C:/a.md"), docPreview: true as const };
    expect(saveNode(leafOf(pv))).toEqual({ kind: "doc", path: "C:/a.md", docPreview: true });
    expect(saveNode(leafOf(newDocPane("C:/a.md")))).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md", docPreview: true }))[0].docPreview).toBe(true);
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md" }))[0]).not.toHaveProperty("docPreview");
  });

  it("못 쓸 미리 보기 값은 **그 칸만** 떨어진다 · 문서가 아닌 잎에는 싣지 않는다", () => {
    expect(parseNode({ kind: "doc", path: "C:/a.md", docPreview: "yes" })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docPreview: false })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docPreview: true })).toEqual({
      kind: "doc",
      path: "C:/a.md",
      docPreview: true,
    });
    expect(parseNode({ kind: "localfs", path: "C:/w", docPreview: true })).not.toHaveProperty("docPreview");
  });

  it("목차 패널(`docOutline`)은 켤 때만 저장되고 되살아난다 · `true` 밖과 문서가 아닌 잎은 떨어진다", () => {
    const on = { ...newDocPane("C:/a.md"), docOutline: true as const };
    expect(saveNode(leafOf(on))).toEqual({ kind: "doc", path: "C:/a.md", docOutline: true });
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md", docOutline: true }))[0].docOutline).toBe(true);
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md" }))[0]).not.toHaveProperty("docOutline");
    expect(parseNode({ kind: "doc", path: "C:/a.md", docOutline: "yes" })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "localfs", path: "C:/w", docOutline: true })).not.toHaveProperty("docOutline");
  });

  it("글자 크기(`docZoom`)는 100 이 아닐 때만 저장 · 되살아나고 단계 밖 값은 가까운 단계로 · 문서가 아닌 잎은 떨어진다", () => {
    const pane = { ...newDocPane("C:/a.md"), docZoom: 125 };
    expect(saveNode(leafOf(pane))).toEqual({ kind: "doc", path: "C:/a.md", docZoom: 125 });
    expect(saveNode(leafOf({ ...newDocPane("C:/a.md"), docZoom: 100 }))).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md", docZoom: 150 }))[0].docZoom).toBe(150);
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md" }))[0]).not.toHaveProperty("docZoom");
    expect(parseNode({ kind: "doc", path: "C:/a.md", docZoom: 130 })).toEqual({ kind: "doc", path: "C:/a.md", docZoom: 125 });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docZoom: 100 })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docZoom: "big" })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "localfs", path: "C:/w", docZoom: 150 })).not.toHaveProperty("docZoom");
  });

  it("편집 중 보기(`docEditView`) · 나란히 비율(`docSplit`)은 기본이 아닐 때만 저장 · 모르는 값은 떨어지고 비율은 묶인다", () => {
    const pane = { ...newDocPane("C:/a.md"), docEditView: "preview" as const, docSplit: 0.3 };
    expect(saveNode(leafOf(pane))).toEqual({ kind: "doc", path: "C:/a.md", docEditView: "preview", docSplit: 0.3 });
    const back = listPanes(restoreNode({ kind: "doc", path: "C:/a.md", docEditView: "source", docSplit: 0.7 }))[0];
    expect(back.docEditView).toBe("source");
    expect(back.docSplit).toBe(0.7);
    expect(listPanes(restoreNode({ kind: "doc", path: "C:/a.md" }))[0]).not.toHaveProperty("docEditView");
    expect(parseNode({ kind: "doc", path: "C:/a.md", docEditView: "split", docSplit: 0.5 })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docEditView: "both", docSplit: "x" })).toEqual({ kind: "doc", path: "C:/a.md" });
    expect(parseNode({ kind: "doc", path: "C:/a.md", docSplit: 0.95 })).toEqual({ kind: "doc", path: "C:/a.md", docSplit: 0.8 });
    const fs = parseNode({ kind: "localfs", path: "C:/w", docEditView: "preview", docSplit: 0.3 });
    expect(fs).not.toHaveProperty("docEditView");
    expect(fs).not.toHaveProperty("docSplit");
  });
});

describe("restoreTab / deserialize", () => {
  it("제목과 이름을 얹어 탭 하나를 만든다", () => {
    const t = restoreTab({ kind: "start" }, "배포판", "배포");
    expect(t.title).toBe("배포판");
    expect(t.name).toBe("배포");
    expect(kinds(t.root)).toEqual(["start"]);
  });

  it("제목이 비었으면 자동 제목이 붙는다", () => {
    expect(restoreTab({ kind: "start" }, "   ").title).toMatch(/^탭 \d+$/);
    expect(restoreTab({ kind: "start" }).title).toMatch(/^탭 \d+$/);
  });

  it("탭마다 새 id 를 받는다", () => {
    const file = mustParse(
      JSON.stringify({
        version: TAB_FILE_VERSION,
        activeIndex: 1,
        workspaces: [
          { title: "a", root: { kind: "start" } },
          { title: "b", root: { kind: "start" } },
        ],
      }),
    );
    const { tabs: restored, activeId } = deserialize(file);
    expect(new Set(restored.map((t) => t.id)).size).toBe(2);
    expect(activeId).toBe(restored[1].id);
  });

  it("빈 목록이면 activeId 는 null 이다 (호출부가 새 탭으로 떨어진다)", () => {
    const empty: TabFile = {
      version: TAB_FILE_VERSION,
      activeIndex: 0,
      workspaces: [],
    };
    expect(deserialize(empty)).toEqual({ tabs: [], activeId: null });
  });

  it("제거된 타일 종류는 파싱하지 않고, 검증을 거치지 않은 복원도 시작 타일로 떨어진다", () => {
    expect(parseNode({ kind: "settings" })).toBeNull();
    const removed = { kind: "settings" } as unknown as SavedNode;
    expect(kinds(restoreTab(removed).root)).toEqual(["start"]);
    const mixed = { dir: "row", ratio: 0.5, a: { kind: "local", shell: "pwsh" }, b: removed } as SavedNode;
    expect(kinds(restoreTab(mixed).root)).toEqual(["local", "start"]);
  });
});

describe("걷어 낸 칸 — 옛 파일의 크기 고정·잠금", () => {
  it("`fixed`·`locked`·`fixedSize` 가 남은 파일도 그대로 열리고, 그 칸은 버려진다", () => {
    const parsed = parseNode({
      dir: "row",
      ratio: 0.3,
      fixed: { size: 400, axis: "w" },
      a: { kind: "local", fixed: { size: 400, axis: "w" }, locked: true, fixedSize: 400 },
      b: { kind: "local" },
    });
    expect(parsed).toEqual({ dir: "row", ratio: 0.3, a: { kind: "local" }, b: { kind: "local" } });
  });
});

// ---------------------------------------------------------------------------
// 빠른 접속 타일 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
//
// 이 타일은 `~/.ssh/config` 에 항목이 없다 — **파일이 그 대상을 아는 유일한 자리**라,
// 저장·복원이 깨지면 껐다 켠 뒤 그 타일은 아무 데도 붙지 못한다.
// ---------------------------------------------------------------------------

describe("빠른 접속 — adhoc 대상의 저장과 복원", () => {
  const pane = (): PaneSpec =>
    newAdhocSshPane({ user: "deploy", host: "example.com", port: 2222 });

  it("대상이 저장된다 (평범한 SSH 타일에는 키가 없다)", () => {
    expect(saveNode(leafOf(pane()))).toMatchObject({
      kind: "ssh",
      alias: "deploy@example.com:2222",
      adhoc: { host: "example.com", user: "deploy", port: 2222 },
    });
    expect(saveNode(leafOf(newSshPane("web-01")))).not.toHaveProperty("adhoc");
  });

  it("왕복하면 대상과 화면 이름이 그대로 돌아온다", () => {
    const file = mustParse(JSON.stringify(serialize([tab("t1", leafOf(pane()))], "t1")));
    const [restored] = deserialize(file).tabs;
    const [leaf] = listPanes(restored.root);
    expect(leaf.alias).toBe("deploy@example.com:2222");
    expect(leaf.adhoc).toEqual({ user: "deploy", host: "example.com", port: 2222 });
    // 다른 SSH 타일과 똑같이 연결 대기로 뜬다 (켜자마자 서버를 두드리지 않는다).
    expect(leaf.deferred).toBe(true);
  });

  it("사용자·포트를 안 적은 대상도 왕복한다 (백엔드가 채울 칸이라 지어내지 않는다)", () => {
    const saved = saveNode(leafOf(newAdhocSshPane({ host: "10.0.0.7" })));
    expect(saved).toMatchObject({ alias: "10.0.0.7", adhoc: { host: "10.0.0.7" } });
    expect(saved).not.toHaveProperty("adhoc.user");
    const leaf = listPanes(restoreNode(parseNode(JSON.parse(JSON.stringify(saved))) as SavedNode))[0];
    expect(leaf.adhoc).toEqual({ host: "10.0.0.7" });
  });

  it("같은 타일은 **같은 문자열**이다 (자동 저장이 문자열 비교로 변화를 잰다)", () => {
    // 같은 패널 객체를 두 번 담는다 — 새로 만들면 `historyStreamId` 가 달라져 이 비교의
    // 뜻이 사라진다 (여기서 지키려는 것은 **키 순서**다).
    const live = pane();
    const a = JSON.stringify(serialize([tab("t1", leafOf(live))], "t1"));
    const b = JSON.stringify(serialize([tab("t1", leafOf(live))], "t1"));
    expect(a).toBe(b);
    expect(a).toContain('"adhoc":{"host":"example.com","user":"deploy","port":2222}');
  });

  it("호스트가 없는 adhoc 은 통째로 떨어진다 (타일은 남는다)", () => {
    const bad: unknown[] = [null, "example.com", 7, {}, { host: "" }, { host: "   " }];
    for (const adhoc of bad) {
      const parsed = parseNode({ kind: "ssh", alias: "deploy@example.com", adhoc });
      expect(parsed, JSON.stringify(adhoc)).not.toHaveProperty("adhoc");
      // 잎 자체는 살아 있다 — `alias` 가 있으므로 평범한 SSH 타일로 뜬다.
      expect(parsed).toMatchObject({ kind: "ssh" });
    }
  });

  it("못 쓸 포트는 **그 칸만** 떨어진다 (= 백엔드 기본 22)", () => {
    for (const port of [0, 99999, "22", 22.5, null]) {
      expect(parseNode({ kind: "ssh", alias: "x", adhoc: { host: "a", port } })).toMatchObject({
        adhoc: { host: "a" },
      });
      expect(
        (parseNode({ kind: "ssh", alias: "x", adhoc: { host: "a", port } }) as { adhoc?: object })
          .adhoc,
        String(port),
      ).not.toHaveProperty("port");
    }
  });

  it("호스트 **문법**은 여기서 검사하지 않는다 (판정은 quick-connect 와 백엔드)", () => {
    // 파일을 손으로 고친 값이어도 모양만 맞으면 통과한다 — 못 붙으면 평소의 접속 실패다.
    expect(parseNode({ kind: "ssh", alias: "x", adhoc: { host: "a b c" } })).toMatchObject({
      adhoc: { host: "a b c" },
    });
  });
});

