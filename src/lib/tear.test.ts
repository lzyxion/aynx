import { serialize } from "$lib/tabs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { collectTileKeys, newTabKey } from "$lib/workspaces/schema";
import {
  beginBlock,
  blocksOf,
  dropHistory,
  endBlock,
  resetHistories,
} from "$lib/block-history";
import { beginPaneTear, buildTear, claimTear, parseTear, pendingTear, registerSerialize, restoreTab } from "$lib/tear";
import { leafOf, listPanes, tabFromPane, type PaneSpec, type TabSpec } from "$lib/session";

/**
 * 이관 페이로드가 **타일에 딸린 부속 상태**까지 나르는가
 * (docs/log/2026-09-08-block-history-store.md · 설계 문서의 "소유와 이관" 절).
 *
 * 여기서 시험하는 것은 두 사례가 아니라 **하나의 결함**이다: 블록 이력도 AI 공유 옵트인도
 * `PaneSpec` 안에 없어서, 예전 페이로드(pane·sessionId·buffer)에 실리지 않았다.
 */
beforeEach(() => resetHistories());

/** 그 타일에서 명령 하나가 돌았다 — C 와 D 를 다 본 블록 하나 */
function ranCommand(paneId: string, line: string, output: string[]) {
  beginBlock(paneId, { commandLine: line, cwd: "/srv", startedAt: 100 });
  endBlock(paneId, { exit: 0, endedAt: 200, outputLines: output, outputCaptured: true });
}

const tabOf = (pane: PaneSpec): TabSpec => ({ id: "old-tab", title: "탭 3", root: leafOf(pane) });

describe("buildTear — 무엇을 싣는가", () => {
  it("블록 이력과 공유 플래그를 함께 싣는다", () => {
    const pane: PaneSpec = { id: "old-1", kind: "ssh", alias: "web-01" };
    ranCommand(pane.id, "$ ls", ["a", "b"]);
    ranCommand(pane.id, "$ pwd", ["/srv"]);

    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => 42,
      () => true,
      () => [],
    );

    expect(payload.panes).toHaveLength(1);
    const [carried] = payload.panes;
    expect(carried.sessionId).toBe(42);
    expect(carried.shared).toBe(true);
    expect(carried.history.map((b) => b.commandLine)).toEqual(["$ ls", "$ pwd"]);
    expect(carried.history[0].excerpt.head).toEqual(["a", "b"]);
  });

  it("공유가 꺼진 타일·이력이 없는 타일도 계약대로 값을 싣는다", () => {
    const pane: PaneSpec = { id: "old-1", kind: "local" };
    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => null,
      () => false,
      () => [],
    );
    expect(payload.panes[0].shared).toBe(false);
    expect(payload.panes[0].history).toEqual([]);
  });

  it("버퍼 직렬화가 실패해도 이관은 계속된다 (짐이 반쯤이라도 세션은 살아 있다)", () => {
    const pane: PaneSpec = { id: "old-1", kind: "local" };
    const off = registerSerialize(pane.id, () => {
      throw new Error("직렬화 실패");
    });
    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => 7,
      () => true,
      () => [],
    );
    off();
    expect(payload.panes[0].buffer).toBe("");
    expect(payload.panes[0].shared).toBe(true);
  });
});

describe("restoreTab — 받는 쪽이 다시 세운다", () => {
  it("블록 2건 + 공유 켜짐인 타일이 JSON 왕복을 거쳐도 그대로 살아난다", () => {
    const pane: PaneSpec = { id: "old-1", kind: "ssh", alias: "web-01" };
    ranCommand(pane.id, "$ cargo test", ["ok"]);
    ranCommand(pane.id, "$ git status", ["clean"]);

    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => 42,
      () => true,
      () => [],
    );
    // 실제 경로는 사서함(Rust)을 거치므로 문자열이 된다 — 그 왕복까지 포함해 시험한다.
    const wire = parseTear(JSON.stringify(payload));
    expect(wire).not.toBeNull();

    // 받는 창은 옛 타일 id 를 모른다. 이력은 **새 id 아래에** 심겨야 한다.
    dropHistory(pane.id);

    const seen: [string, boolean][] = [];
    const tab = restoreTab(wire!, (paneId, shared) => seen.push([paneId, shared]));
    const [moved] = listPanes(tab.root);

    expect(moved.id).not.toBe("old-1");
    expect(moved.restore).toEqual({ sessionId: 42, buffer: "", markers: [] });

    // ① 이력 — 새 id 아래에 두 건이 같은 순서·같은 내용으로.
    const blocks = blocksOf(moved.id);
    expect(blocks.map((b) => b.commandLine)).toEqual(["$ cargo test", "$ git status"]);
    expect(blocks.map((b) => b.paneId)).toEqual([moved.id, moved.id]);
    expect(blocks[1].excerpt.head).toEqual(["clean"]);
    expect(blocks[1].exit).toBe(0);
    // 옛 id 아래에는 아무것도 남지 않는다.
    expect(blocksOf("old-1")).toHaveLength(0);

    // ② 공유 — **새 id 로** 다시 세워진다 (이것이 예전의 "공유 플래그 이관 유실" 버그다).
    expect(seen).toEqual([[moved.id, true]]);
  });

  it("공유가 꺼진 타일은 꺼진 채로 알린다 (값 하나로 계약을 유지한다)", () => {
    const pane: PaneSpec = { id: "old-1", kind: "local" };
    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => 1,
      () => false,
      () => [],
    );
    const seen: [string, boolean][] = [];
    const tab = restoreTab(payload, (paneId, shared) => seen.push([paneId, shared]));
    const [moved] = listPanes(tab.root);
    expect(seen).toEqual([[moved.id, false]]);
  });

  it("옛 페이로드(이력·공유 없음)도 받는다 — 없는 값은 꺼짐·빈 이력이다", () => {
    // 사서함의 짐은 JSON 이라 필드가 빠져 올 수 있다 (앱 버전이 섞이는 순간).
    const legacy = parseTear(
      JSON.stringify({
        tab: { id: "old-tab", title: "탭 1", root: leafOf({ id: "old-1", kind: "local" }) },
        panes: [{ pane: { id: "old-1", kind: "local" }, sessionId: 5, buffer: "hi" }],
      }),
    );
    expect(legacy).not.toBeNull();
    const seen: [string, boolean][] = [];
    const tab = restoreTab(legacy!, (paneId, shared) => seen.push([paneId, shared]));
    const [moved] = listPanes(tab.root);
    // 마커 칸이 없는 짐은 **빈 목록**으로 온다 — 그 타일의 블록은 지금까지처럼 "밀려난 블록" 이다.
    expect(moved.restore).toEqual({ sessionId: 5, buffer: "hi", markers: [] });
    expect(blocksOf(moved.id)).toHaveLength(0);
    expect(seen).toEqual([[moved.id, false]]);
  });
});

/**
 * **버퍼를 뜬 크기도 실린다** (2026-09-09 · docs/log/2026-09-08-block-history-store.md 의
 * "폭이 다른 창으로 이관").
 *
 * 직렬화 문자열은 **뜬 그 열 수에서만** 원래의 줄바꿈을 재현한다. 폭이 다른 타일에 그대로
 * 쓰면 xterm 이 그 자리에서 리플로해 줄이 밀리고, 마커를 심기도 전에 거리가 어긋난다.
 * 여기서 시험하는 것은 그 크기가 **짐과 복원 지시서를 건너는가**다 (실제로 되돌려 쓰는
 * 순서는 `Terminal.svelte` 의 마운트 경로이고, 헤드리스에는 xterm 이 없다).
 */
describe("소스 터미널 크기 — 버퍼와 한 봉투로 간다", () => {
  const pane: PaneSpec = { id: "old-1", kind: "local" };
  const build = () =>
    buildTear(
      tabOf(pane),
      [pane],
      () => 9,
      () => false,
      () => [],
    );

  it("직렬화한 그 순간의 cols·rows 를 함께 싣는다", () => {
    const off = registerSerialize(pane.id, () => ({ buffer: "hello", cols: 203, rows: 51 }));
    const payload = build();
    off();
    expect(payload.panes[0].buffer).toBe("hello");
    expect(payload.panes[0].size).toEqual({ cols: 203, rows: 51 });
  });

  it("버퍼를 못 뜨면 크기도 없다 (없는 버퍼의 크기는 뜻이 없다)", () => {
    const off = registerSerialize(pane.id, () => {
      throw new Error("직렬화 실패");
    });
    const payload = build();
    off();
    expect(payload.panes[0].buffer).toBe("");
    expect(payload.panes[0].size).toBeUndefined();
    // 등록 자체가 없는 타일(아직 마운트 전)도 같다.
    expect(build().panes[0].size).toBeUndefined();
  });

  it("JSON 왕복 뒤 새 타일의 복원 지시서에 그대로 실린다", () => {
    const off = registerSerialize(pane.id, () => ({ buffer: "hi", cols: 120, rows: 40 }));
    const wire = parseTear(JSON.stringify(build()));
    off();
    const [moved] = listPanes(restoreTab(wire!, () => {}).root);
    expect(moved.restore).toEqual({
      sessionId: 9,
      buffer: "hi",
      markers: [],
      size: { cols: 120, rows: 40 },
    });
  });

  it("말이 안 되는 크기는 걸러 낸다 — 그러면 지금까지처럼 타일 크기에서 쓴다", () => {
    const nonsense = [
      { cols: 0, rows: 24 }, // 0 열
      { cols: 80, rows: 1 }, // 한 줄짜리는 리플로가 뜻을 잃는다
      { cols: 4000, rows: 24 }, // 실기에 없는 값
      { cols: 80.5, rows: 24 }, // 정수가 아니다
      { cols: "80", rows: 24 }, // 글자다
      { rows: 24 }, // 열이 없다
      null,
      "80x24",
    ];
    for (const size of nonsense) {
      const legacy = parseTear(
        JSON.stringify({
          tab: { id: "old-tab", title: "탭 1", root: leafOf({ id: "old-1", kind: "local" }) },
          panes: [{ pane: { id: "old-1", kind: "local" }, sessionId: 5, buffer: "hi", size }],
        }),
      );
      const [moved] = listPanes(restoreTab(legacy!, () => {}).root);
      expect(moved.restore?.size, JSON.stringify(size)).toBeUndefined();
    }
  });
});

/**
 * **출력 오프셋도 실린다** (R02 — 이관 틈의 출력 재생). 버퍼와 같은 스냅숏에서 뜬 `consumed` 가
 * 짐을 건너 복원 지시서로 내려가야 받는 창의 재부착이 그 뒤 꼬리를 재생한다(`reattachSession`).
 */
describe("출력 오프셋 — 버퍼와 한 봉투로 간다", () => {
  const pane: PaneSpec = { id: "old-1", kind: "ssh" };
  const build = () =>
    buildTear(
      tabOf(pane),
      [pane],
      () => 9,
      () => false,
      () => [],
    );

  it("직렬화한 그 순간의 consumed 를 싣고 JSON 왕복 뒤 복원 지시서에 내린다", () => {
    const off = registerSerialize(pane.id, () => ({ buffer: "hi", cols: 80, rows: 24, consumed: 12345 }));
    const payload = build();
    const wire = parseTear(JSON.stringify(payload));
    off();
    expect(payload.panes[0].consumed).toBe(12345);
    const [moved] = listPanes(restoreTab(wire!, () => {}).root);
    expect(moved.restore?.consumed).toBe(12345);
  });

  it("모르면(옛 짐·뜨지 못함) 싣지 않는다 — 재생 없이 재그림에 맡긴다", () => {
    const off = registerSerialize(pane.id, () => ({ buffer: "hi", cols: 80, rows: 24 }));
    expect("consumed" in build().panes[0]).toBe(false);
    off();
    for (const consumed of [-1, 1.5, "7", null]) {
      const legacy = parseTear(
        JSON.stringify({
          tab: { id: "old-tab", title: "탭 1", root: leafOf({ id: "old-1", kind: "ssh" }) },
          panes: [{ pane: { id: "old-1", kind: "ssh" }, sessionId: 5, buffer: "hi", consumed }],
        }),
      );
      const [moved] = listPanes(restoreTab(legacy!, () => {}).root);
      expect(moved.restore?.consumed, JSON.stringify(consumed)).toBeUndefined();
    }
  });
});

/**
 * **마커 자리도 실린다** (2026-09-09 · docs/log/2026-09-08-block-history-store.md 의
 * "이관 뒤 마커 복원").
 *
 * 이력만 실었을 때 남던 반쪽이다: 새 창에서 `#` 검색이 블록을 찾기는 하는데 고르면 "화면에서
 * 밀려난 블록입니다" 가 떴다 — OSC 133 은 직렬화에 실리지 않아 `lineOfBlock` 이 줄을 모른다.
 * 여기서 시험하는 것은 **짐의 계약**이다(거리를 싣고, 복원 지시서로 내려 준다). 그 거리로
 * 마커를 되심는 쪽은 `shell-integration.test.ts` 가 본다.
 */
describe("마커 거리 — 짐에 싣고 복원 지시서로 내린다", () => {
  const distances = [
    { blockId: 1, promptFromBottom: 12 },
    { blockId: 2, promptFromBottom: 3 },
  ];

  it("타일마다 자기 마커 거리를 싣는다", () => {
    const pane: PaneSpec = { id: "old-1", kind: "ssh", alias: "web-01" };
    ranCommand(pane.id, "$ ls", ["a"]);
    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => 42,
      () => true,
      (paneId) => (paneId === "old-1" ? distances : []),
    );
    expect(payload.panes[0].markers).toEqual(distances);
  });

  it("JSON 왕복 뒤 **새 타일의 복원 지시서**에 그대로 실린다 (블록 번호는 그대로)", () => {
    const pane: PaneSpec = { id: "old-1", kind: "local" };
    const payload = buildTear(
      tabOf(pane),
      [pane],
      () => 7,
      () => false,
      () => distances,
    );
    const wire = parseTear(JSON.stringify(payload));
    const tab = restoreTab(wire!, () => {});
    const [moved] = listPanes(tab.root);
    // 타일 id 는 새로 매겨지지만 `blockId` 는 타일 안의 번호라 손대지 않는다.
    expect(moved.id).not.toBe("old-1");
    expect(moved.restore?.markers).toEqual(distances);
  });

  it("망가진 항목은 걸러 낸다 — 받는 쪽은 숫자만 믿고 범위만 본다", () => {
    const legacy = parseTear(
      JSON.stringify({
        tab: { id: "old-tab", title: "탭 1", root: leafOf({ id: "old-1", kind: "local" }) },
        panes: [
          {
            pane: { id: "old-1", kind: "local" },
            sessionId: 5,
            buffer: "hi",
            markers: [
              { blockId: 1, promptFromBottom: 4 },
              { blockId: "2", promptFromBottom: 4 }, // 번호가 글자다
              { blockId: 3, promptFromBottom: -1 }, // 커서보다 아래는 없다
              { blockId: 4 }, // 거리가 없다
              null,
            ],
          },
        ],
      }),
    );
    const tab = restoreTab(legacy!, () => {});
    const [moved] = listPanes(tab.root);
    expect(moved.restore?.markers).toEqual([{ blockId: 1, promptFromBottom: 4 }]);
  });
});

describe("대화 연결도 건너간다 (docs/log/2026-09-26-agent-sessions.md \"연결의 수명 = 세션\")", () => {
  const U = "11111111-2222-4333-8444-000000000001";
  const pane: PaneSpec = { id: "old-1", kind: "local" };
  const build = (sessionId: number | null, link: unknown) =>
    parseTear(
      JSON.stringify(
        buildTear(
          tabOf(pane),
          [pane],
          () => sessionId,
          () => false,
          () => [],
          () => link as { agent: string; id: string } | null,
        ),
      ),
    )!;

  it("산 세션을 데려온 타일은 새 id 로 연결을 다시 세운다", () => {
    const seen: [string, unknown][] = [];
    const tab = restoreTab(build(42, { agent: "claude", id: U }), undefined, (id, l) => seen.push([id, l]));
    const [moved] = listPanes(tab.root);
    expect(seen).toEqual([[moved.id, { agent: "claude", id: U }]]);
  });

  it("세션이 없는 짐 · 연결이 없는 짐 · 망가진 연결 · 옛 짐은 아무것도 세우지 않는다", () => {
    const seen: unknown[] = [];
    const on = (id: string, l: unknown) => seen.push([id, l]);
    restoreTab(build(null, { agent: "claude", id: U }), undefined, on);
    restoreTab(build(7, null), undefined, on);
    restoreTab(build(7, { agent: "claude", id: "not-a-uuid" }), undefined, on);
    const legacy = parseTear(
      JSON.stringify({
        tab: { id: "old-tab", title: "탭 1", root: leafOf({ id: "old-1", kind: "local" }) },
        panes: [{ pane: { id: "old-1", kind: "local" }, sessionId: 5, buffer: "" }],
      }),
    );
    restoreTab(legacy!, undefined, on);
    expect(seen).toEqual([]);
  });
});

describe("타일 이름 신호도 건너간다 (docs/log/2026-09-30-tear-title-and-agent-handoff.md)", () => {
  // 로컬 타일의 이름·아이콘(과 여러 타일 탭의 합성 제목)은 패널 id 로 쥔 런타임 신호로 정해진다. id 가 새로
  // 매겨지는 창 이관에서 그 신호를 안 실으면 받는 창에서는 "PowerShell 7 · Claude Code" 탭이 "로컬 · 로컬" 이 됐다.
  const pane: PaneSpec = { id: "old-1", kind: "local" };
  const build = (sessionId: number | null, titles: unknown) =>
    parseTear(
      JSON.stringify(
        buildTear(
          tabOf(pane),
          [pane],
          () => sessionId,
          () => false,
          () => [],
          () => null,
          () => titles as never,
        ),
      ),
    )!;

  it("산 세션을 데려온 타일은 새 id 로 셸 이름 · OSC 제목 · 도는 명령을 다시 심는다", () => {
    const seen: [string, unknown][] = [];
    const titles = { resolvedShell: "pwsh", oscTitle: "✳ Claude Code", runningCommand: "claude" };
    const tab = restoreTab(build(42, titles), undefined, undefined, (id, s) => seen.push([id, s]));
    const [moved] = listPanes(tab.root);
    expect(seen).toEqual([[moved.id, titles]]);
  });

  it("모양이 틀린 칸은 버리고 맞는 칸만 심는다", () => {
    const seen: unknown[] = [];
    restoreTab(
      build(3, { resolvedShell: "gitbash", oscTitle: 7, runningCommand: "   " }),
      undefined,
      undefined,
      (_id, s) => seen.push(s),
    );
    expect(seen).toEqual([{ resolvedShell: "gitbash" }]);
  });

  it("세션이 없는 짐 · 신호가 없는 짐 · 옛 짐은 아무것도 심지 않는다", () => {
    const seen: unknown[] = [];
    const on = (id: string, s: unknown) => seen.push([id, s]);
    restoreTab(build(null, { resolvedShell: "pwsh" }), undefined, undefined, on);
    restoreTab(build(7, null), undefined, undefined, on);
    restoreTab(build(7, { oscTitle: "" }), undefined, undefined, on);
    const legacy = parseTear(
      JSON.stringify({
        tab: { id: "old-tab", title: "탭 1", root: leafOf({ id: "old-1", kind: "local" }) },
        panes: [{ pane: { id: "old-1", kind: "local" }, sessionId: 5, buffer: "" }],
      }),
    );
    restoreTab(legacy!, undefined, undefined, on);
    expect(seen).toEqual([]);
  });

  it("탭 제목 · 사람이 붙인 이름 · 프로젝트 고정 제목은 글자 그대로 건너간다 (번호를 새로 매기지 않는다)", () => {
    const named: TabSpec = {
      id: "old-tab",
      title: "탭 7",
      name: "배포",
      pinnedTitle: "AYNX · feat",
      projectFolder: "C:/src/aynx",
      root: leafOf(pane),
    };
    const wire = parseTear(JSON.stringify(buildTear(named, [pane], () => 1, () => false, () => [])));
    const tab = restoreTab(wire!);
    expect(tab.title).toBe("탭 7");
    expect(tab.name).toBe("배포");
    expect(tab.pinnedTitle).toBe("AYNX · feat");
    expect(tab.projectFolder).toBe("C:/src/aynx");
  });
});

describe("workspace tear metadata and persistent restore spec", () => {
  it("타일 떼기 짐에 원래 탭 키와 같은 타일 키를 담되 받는 탭 키는 새로 싣는다", async () => {
    const pane: PaneSpec = { id: "old-1", kind: "local", tileKey: "tile-persistent" };
    const staying: PaneSpec = { id: "old-2", kind: "local", tileKey: "tile-staying" };
    const source: TabSpec = {
      id: "old-tab", title: "탭 3", workspaceId: "workspace-A", tabKey: newTabKey(),
      root: { type: "split", dir: "row", ratio: 0.5, a: leafOf(pane), b: leafOf(staying) },
    };
    const snap = { ...pane };
    const incoming = tabFromPane(snap, source);
    // startPaneTear의 ensureWorkspaceKeys와 같은 순서다 — 없는 탭 키만 새로 매긴다.
    expect(incoming.tabKey).toBeUndefined();
    expect(listPanes(incoming.root)[0].tileKey).toBe(pane.tileKey);
    incoming.workspaceId = source.workspaceId;
    incoming.tabKey = newTabKey();
    const workspace = {
      workspaceId: source.workspaceId!, workspaceName: "작업", sourceWindow: "main", sourceTabKey: source.tabKey!,
    };
    vi.mocked(invoke).mockClear();
    const token = beginPaneTear(incoming, snap, () => 42, () => false, () => [], undefined, undefined, workspace);
    const pending = pendingTear()!;
    const stashed = await pending.stashed;
    claimTear(token);

    expect(stashed).toBe(true);
    expect(pending.paneId).toBe(pane.id);
    expect(invoke).toHaveBeenCalledWith("stash_handoff", { token, payload: expect.any(String) });
    const args = vi.mocked(invoke).mock.calls[0][1] as { payload: string };
    const payload = parseTear(args.payload)!;
    expect(payload.workspaceId).toBe(source.workspaceId);
    expect(payload.workspace).toMatchObject({
      ...workspace,
      savedTab: { tabKey: incoming.tabKey, placement: { kind: "main" } },
    });
    expect(payload.workspace!.sourceTabKey).toBe(source.tabKey);
    expect(payload.workspace!.savedTab.tabKey).not.toBe(source.tabKey);
    expect(collectTileKeys(payload.workspace!.savedTab.root)).toEqual([pane.tileKey]);
    expect(listPanes(payload.tab.root).map((p) => p.tileKey)).toEqual([pane.tileKey]);
    expect(payload.panes.map((p) => p.pane.tileKey)).toEqual([pane.tileKey]);
    const adopted = restoreTab(payload);
    expect(adopted.tabKey).toBe(incoming.tabKey);
    expect(listPanes(adopted.root)[0].tileKey).toBe(pane.tileKey);
    expect(listPanes(source.root).map((p) => p.tileKey)).toEqual([pane.tileKey, staying.tileKey]);
  });
  it("round trips workspace/tab/tile keys while consuming exec options only at runtime", () => {
    const pane: PaneSpec = { id: "old-1", kind: "local", tileKey: "tile-persistent",
      autorun: "claude", cwd: "/project", injectMcpToken: true, historyStreamId: "stable-stream" };
    const tab = { ...tabOf(pane), workspaceId: "workspace-A", tabKey: "tab-persistent" };
    const payload = buildTear(tab, [pane], () => 42, () => true, () => []);
    const parsed = parseTear(JSON.stringify(payload))!;
    expect(parsed.workspaceId).toBe("workspace-A");
    const adopted = restoreTab(parsed);
    const leaf = listPanes(adopted.root)[0];
    expect(adopted.tabKey).toBe("tab-persistent");
    expect(adopted.workspaceId).toBe("workspace-A");
    expect(leaf.tileKey).toBe("tile-persistent");
    expect(leaf.autorun).toBeUndefined();
    expect(leaf.cwd).toBeUndefined();
    expect(leaf.injectMcpToken).toBeUndefined();
    expect(leaf.restart).toEqual({ autorun: "claude", cwd: "/project", injectMcpToken: true });
    expect(serialize([adopted], adopted.id).workspaces[0].root).toMatchObject({
      tileKey: "tile-persistent", autorun: "claude", cwd: "/project", injectMcpToken: true, historyStreamId: "stable-stream",
    });
    // 다시 tear해도 최초 명세가 살아 있다.
    const twice = restoreTab(buildTear(adopted, [leaf], () => 42, () => true, () => []));
    expect(serialize([twice], twice.id).workspaces[0].root).toMatchObject({ autorun: "claude", cwd: "/project" });
  });
  it("flag-off legacy adoption does not add a persistent exec spec", () => {
    const pane: PaneSpec = { id: "old-1", kind: "local", autorun: "claude", cwd: "/project" };
    const adopted = restoreTab(buildTear(tabOf(pane), [pane], () => 1, () => false, () => []));
    expect(listPanes(adopted.root)[0].restart).toBeUndefined();
  });
});
