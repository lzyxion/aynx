// 오케스트레이션 탭 틀(2026-10-29 — docs/log/2026-10-29-orchestration-player-tab.md D1 · D2 · D3 · D10 · D11 · 0-3 Q1=B · Q3).
import { describe, expect, it } from "vitest";
import { listPanes, newLocalPane, newProducerPane, newRunPane, newStartPane, type PaneSpec, type TabSpec } from "$lib/session";
import { deserialize, parseTabFile, serialize } from "$lib/tabs";
import { dropPlan, type DropTarget } from "$lib/pane/drop-rules";
import { hostBoxes, tabCanvas } from "$lib/pane/boxes";
import { FULL_RECT } from "$lib/layout";
import { adoptTab } from "$lib/session";
import { buildSnapshot, parseSnapshot } from "$lib/mirror/snapshot";
import { startedAlbumPath,
  ORCH_BAR_PX,
  ORCH_CANVAS,
  albumRunId,
  orchPath,
  orchNavigationTab,
  parentOrchPath,
  albumParentPath,
  keepAlbumOrigin,
  orchEscapeAllowed,
  findAlbumTab,
  findHomeTab,
  isOrchTab,
  newProducerChatId,
  orchBroken,
  orchRoot,
  orchShape,
  parseOrchMark,
  playerPaneOf,
  producerLeafOf,
  saveOrchMark,
  tabOfProducerChat,
} from "./orch-tab";

let seq = 0;

describe("탭 안 경로", () => {
  it("현재 탭 우선·없으면 현재 워크스페이스의 첫 오케스트레이션 탭", () => {
    const a = album("r"); const b = home();
    expect(orchNavigationTab([a, b], b.id)).toBe(b);
    expect(orchNavigationTab([a, b], "보통 탭")).toBe(a);
    expect(orchNavigationTab([], a.id)).toBeNull();
  });
  it("트랙·시도 경로를 파싱하고 필요한 열쇠만 저장한다", () => {
    const path = { view: "track" as const, runId: " r ", taskId: " t ", attemptId: " a ", ignored: "값" };
    expect(parseOrchMark(path)).toEqual({ view: "track", runId: "r", taskId: "t", attemptId: "a" });
    expect(saveOrchMark(path)).toEqual(parseOrchMark(path));
    expect(parseOrchMark({ view: "track", runId: "r" })).toEqual({ view: "library" });
    expect(parseOrchMark({ view: "album", runId: "x".repeat(129) })).toEqual({ view: "library" });
  });
  it("옛 표지·모르는 화면·틀린 경로는 라이브러리", () => {
    for (const orch of [{ runId: "r" }, {}, { view: "future", runId: "r" }, { view: "album", runId: "" }]) {
      expect(orchPath({ orch: orch as TabSpec["orch"] })).toEqual({ view: "library" });
    }
    expect(parseOrchMark({ view: "artists", runId: "버림" })).toEqual({ view: "artists" });
  });
  it("스튜디오 경로 — 저장소는 글자 그대로(긴 경로 포함) · 없거나 틀리면 라이브러리", () => {
    const long = `C:/${"x".repeat(300)}`;
    expect(parseOrchMark({ view: "studio", repo: long, runId: "버림" })).toEqual({ view: "studio", repo: long });
    expect(saveOrchMark({ view: "studio", repo: "C:/a" })).toEqual({ view: "studio", repo: "C:/a" });
    for (const repo of [undefined, "", " ", 3, "a\nb", "x".repeat(4097)]) expect(parseOrchMark({ view: "studio", repo })).toEqual({ view: "library" });
  });
  it("출발 스튜디오 — 앨범 · 트랙만 들고 옛 값(칸 없음)은 그대로 · 틀린 칸은 버린다", () => {
    expect(parseOrchMark({ view: "album", runId: "r", fromRepo: "C:/a" })).toEqual({ view: "album", runId: "r", fromRepo: "C:/a" });
    expect(parseOrchMark({ view: "track", runId: "r", taskId: "t", attemptId: "a", fromRepo: "C:/a" })).toEqual({ view: "track", runId: "r", taskId: "t", attemptId: "a", fromRepo: "C:/a" });
    expect(parseOrchMark({ view: "album", runId: "r" })).toEqual({ view: "album", runId: "r" });
    expect(parseOrchMark({ view: "album", runId: "r", fromRepo: 3 })).toEqual({ view: "album", runId: "r" });
    expect(parseOrchMark({ view: "library", fromRepo: "C:/a" })).toEqual({ view: "library" });
    expect(parseOrchMark({ view: "new", fromRepo: "C:/a" })).toEqual({ view: "new", fromRepo: "C:/a" });
    expect(parseOrchMark({ view: "new" })).toEqual({ view: "new" });
    expect(parentOrchPath({ view: "album", runId: "r", fromRepo: 3 } as never)).toEqual({ view: "library" });
  });
  it("뒤로 — 스튜디오 경유: 트랙 → 앨범(출발 유지) → 스튜디오 → 라이브러리", () => {
    const album = parentOrchPath({ view: "track", runId: "r", taskId: "t", fromRepo: "C:/a" });
    expect(album).toEqual({ view: "album", runId: "r", fromRepo: "C:/a" });
    const studio = parentOrchPath(album);
    expect(studio).toEqual({ view: "studio", repo: "C:/a" });
    expect(parentOrchPath(studio)).toEqual({ view: "library" });
    expect(albumParentPath({ view: "album", runId: "r", fromRepo: "C:/a" })).toEqual(studio);
    expect(albumParentPath({ view: "album", runId: "r" })).toEqual({ view: "library" });
  });
  it("출발 스튜디오는 같은 앨범 안에서만 잇는다", () => {
    const here = { view: "album" as const, runId: "r", fromRepo: "C:/a" };
    expect(keepAlbumOrigin(here, "r")).toEqual({ fromRepo: "C:/a" });
    expect(keepAlbumOrigin(here, "다른")).toEqual({});
    expect(keepAlbumOrigin({ view: "album", runId: "r" }, "r")).toEqual({});
    expect(keepAlbumOrigin({ view: "studio", repo: "C:/a" }, "r")).toEqual({});
  });
  it("스튜디오 탭은 앨범이 아니고 라이브러리 탭으로 세지 않지만 홈 모양이다", () => {
    const s = tab(orchRoot(null, newRunPane()), { view: "studio", repo: "C:/a" });
    expect(albumRunId(s)).toBeNull();
    expect(orchShape(s)).toBe("home");
    expect(findHomeTab([s])).toBeNull();
    expect(saveOrchMark(s.orch)).toEqual({ view: "studio", repo: "C:/a" });
  });
  it("트랙 → 앨범 → 라이브러리, 아티스트·초안 → 라이브러리", () => {
    const album = parentOrchPath({ view: "track", runId: "r", taskId: "t", attemptId: "a" });
    expect(album).toEqual({ view: "album", runId: "r" });
    expect(parentOrchPath(album)).toEqual({ view: "library" });
    for (const view of ["library", "artists", "new"] as const) expect(parentOrchPath({ view })).toEqual({ view: "library" });
  });
  it("트랙 경로는 저장·복원·창 이관·거울에서도 그대로", () => {
    const a = album("r");
    a.orch = { view: "track", runId: "r", taskId: "t", attemptId: "a" };
    const restored = deserialize(JSON.parse(JSON.stringify(serialize([a], a.id))));
    expect(restored.tabs[0].orch).toEqual(a.orch);
    expect(adoptTab(JSON.parse(JSON.stringify(a)), () => undefined).orch).toEqual(a.orch);
    const snapshot = buildSnapshot({ source: "home", workspace: { id: "w1", name: "W" }, tabs: [{ ...a, workspaceId: "w1" }], activeTabId: a.id, focusOf: () => null });
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))?.tabs[0].orch).toEqual(a.orch);
  });
  it("프로듀서 칸 폭 = 캔버스 × 비율 + 고정 px — 1400 창 약 360 · 620 창 약 215 · 저장 · 거울 왕복에도 px 가 남는다(10-31 앨범 세부 칸)", () => {
    const a = album("r");
    // 타일 캔버스 폭(창 폭 − 좌우 여백 16) → 왼쪽 상자 폭(px)
    const chat = (t: TabSpec, canvas: number) => {
      const box = hostBoxes([t], t.id, () => "").find((b) => b.pane.kind === "producer")!;
      return (box.rect.w.pct / 100) * canvas + box.rect.w.px;
    };
    expect(Math.abs(chat(a, 1384) - 360)).toBeLessThanOrEqual(4);
    expect(Math.abs(chat(a, 604) - 215)).toBeLessThanOrEqual(4);
    expect(chat(a, 1584)).toBeGreaterThan(chat(a, 1384));
    // 플레이어 판은 1400 창에서 앨범 세부 칸 문턱(996) 이상
    const player = hostBoxes([a], a.id, () => "").find((b) => b.pane.kind === "run")!;
    expect((player.rect.w.pct / 100) * 1384 + player.rect.w.px).toBeGreaterThanOrEqual(996);
    const restored = deserialize(JSON.parse(JSON.stringify(serialize([a], a.id)))).tabs[0];
    expect(Math.abs(chat(restored, 1384) - 360)).toBeLessThanOrEqual(4);
    const snapshot = buildSnapshot({ source: "home", workspace: { id: "w1", name: "W" }, tabs: [{ ...a, workspaceId: "w1" }], activeTabId: a.id, focusOf: () => null });
    const mirrored = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))!.tabs[0].root;
    expect(mirrored.type === "split" && mirrored.px).toBe(a.root.type === "split" ? a.root.px : NaN);
  });
  it("Esc는 입력·메뉴·모달·조합·수식키가 없을 때만 이동", () => {
    const esc = { key: "Escape", code: "Escape", defaultPrevented: false, isComposing: false, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(orchEscapeAllowed(esc, false)).toBe(true);
    expect(orchEscapeAllowed(esc, true)).toBe(false);
    expect(orchEscapeAllowed({ ...esc, key: "Process" }, false)).toBe(false);
    for (const key of ["defaultPrevented", "isComposing", "ctrlKey", "altKey", "shiftKey", "metaKey"] as const) expect(orchEscapeAllowed({ ...esc, [key]: true }, false)).toBe(false);
  });
});
function tab(root: TabSpec["root"], orch?: TabSpec["orch"]): TabSpec {
  seq += 1;
  return { id: `t${seq}`, title: `탭 ${seq}`, root, ...(orch ? { orch } : {}) };
}

/** 프로듀서 채팅 잎(`opened` = 연 채팅 — 준비 중 · 앨범의 프로듀서) */
function chatLeaf(opened = false): PaneSpec {
  return newProducerPane({ chatId: newProducerChatId(), cli: opened ? "claude" : "", model: "", effort: "", studio: opened ? "C:/repo" : "", ...(opened ? { opened } : {}) });
}
/** 홈 — 왼쪽 "새 앨범" 칸(안 연 채팅 잎) · 오른쪽 플레이어 */
function home(): TabSpec {
  return tab(orchRoot(null, newRunPane()), { view: "library" });
}
/** 프로듀서 잎이 없는 홈 — 플레이어 잎 하나(프로듀서 없이 연 앨범 탭이 홈으로 돌아감 — 맞추기가 채팅 잎을 더한다) */
function bareHome(): TabSpec {
  return tab(orchRoot(null, newRunPane()), { view: "library" });
}
function preparing(leaf: PaneSpec = chatLeaf(true)): TabSpec {
  return tab(orchRoot(leaf, newRunPane()), { view: "new" });
}
function album(runId: string, leaf: PaneSpec | null = chatLeaf(true)): TabSpec {
  return tab(orchRoot(leaf, newRunPane(runId)), { view: "album", runId });
}

describe("탭 모양(D2)", () => {
  it("홈 · 준비 중 · 앨범 — 보통 탭은 null", () => {
    expect(orchShape(home())).toBe("home");
    expect(orchShape(preparing())).toBe("preparing");
    expect(producerLeafOf(home())).toBeNull();
    expect(orchShape(album("run-1"))).toBe("album");
    expect(orchShape(album("run-1", null))).toBe("album");
    expect(orchShape(tab({ type: "leaf", pane: newLocalPane() }))).toBeNull();
    expect(isOrchTab(home())).toBe(true);
    expect(isOrchTab(null)).toBe(false);
  });

  it("고정 배치 — 왼쪽 프로듀서 채팅 잎 · 오른쪽 플레이어 잎", () => {
    const leaf = chatLeaf(true);
    const t = preparing(leaf);
    expect(t.root.type).toBe("split");
    if (t.root.type === "split") {
      expect(t.root.dir).toBe("row");
      expect(t.root.a.type === "leaf" && t.root.a.pane.id).toBe(leaf.id);
      expect(t.root.b.type === "leaf" && t.root.b.pane.kind).toBe("run");
    }
    expect(producerLeafOf(t)?.id).toBe(leaf.id);
    expect(playerPaneOf(t)?.kind).toBe("run");
    // 안 연 채팅 잎(홈의 "새 앨범" 칸)은 아직 준비 중이 아니다
    expect(orchShape(home())).toBe("home");
  });

  it("채팅 → 그 탭(보드 배치 `{runId, chat}` · 채팅과 탭은 1:1)", () => {
    const a = album("run-c");
    const chat = producerLeafOf(a)?.producer?.chatId ?? "";
    expect(tabOfProducerChat([home(), a], chat)?.id).toBe(a.id);
    expect(tabOfProducerChat([home()], chat)).toBeNull();
  });

  it("찾기 — 앨범 탭은 첫 번째 · 홈은 앨범도 프로듀서도 없는 탭", () => {
    const a1 = album("run-a");
    const a2 = album("run-a");
    const h = home();
    const tabs = [preparing(), a1, a2, h];
    expect(findAlbumTab(tabs, "run-a")?.id).toBe(a1.id);
    expect(findAlbumTab(tabs, "run-x")).toBeNull();
    expect(findHomeTab(tabs)?.id).toBe(h.id);
    expect(albumRunId({ orch: { view: "album", runId: "  run-b " } })).toBe("run-b");
  });

  it("플레이어가 없으면 무너진 탭 — 표지를 걷는다", () => {
    const broken = tab({ type: "leaf", pane: newLocalPane() }, {});
    expect(orchBroken(broken)).toBe(true);
    expect(orchBroken(home())).toBe(false);
  });

});



describe("표지 저장 · 파싱", () => {
  it("옛 표지 읽기는 입력을 고치지 않지만 저장·파일 파싱·복원은 라이브러리로 정규화한다", () => {
    const a = album("남은 플레이어 주소");
    a.orch = { runId: "옛 표지" };
    expect(orchPath(a)).toEqual({ view: "library" });
    expect(a.orch).toEqual({ runId: "옛 표지" });
    const file = serialize([a], a.id);
    expect(file.workspaces[0].orch).toEqual({ view: "library" });
    // 디스크에 옛 값이 직접 남은 경우도 파싱 경계에서 버린다.
    file.workspaces[0].orch = { runId: "옛 표지" };
    const parsed = parseTabFile(JSON.stringify(file))!;
    expect(parsed.workspaces[0].orch).toEqual({ view: "library" });
    const restored = deserialize(parsed).tabs[0];
    expect(restored.orch).toEqual({ view: "library" });
    expect(albumRunId(restored)).toBeNull();
    expect(adoptTab(JSON.parse(JSON.stringify(a)), () => undefined).orch).toEqual({ view: "library" });
    const snapshot = buildSnapshot({ source: "home", workspace: { id: "w1", name: "W" }, tabs: [{ ...a, workspaceId: "w1" }], activeTabId: a.id, focusOf: () => null });
    expect(snapshot.tabs[0].orch).toEqual({ view: "library" });
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))?.tabs[0].orch).toEqual({ view: "library" });
  });

  it.each(["library", "new", "artists"] as const)("%s 경로의 불필요한 run·task·attempt 주소는 저장과 파일 파싱에 남기지 않는다", (view) => {
    const a = album("r");
    a.orch = { view, runId: "r", taskId: "t", attemptId: "a" };
    const file = serialize([a], a.id);
    expect(file.workspaces[0].orch).toEqual({ view });
    file.workspaces[0].orch = a.orch;
    expect(parseTabFile(JSON.stringify(file))?.workspaces[0].orch).toEqual({ view });
  });

  it("모양 — runId 는 다듬고, 틀리면 칸만 버린다", () => {
    expect(parseOrchMark({ view: "album", runId: " r1 " })).toEqual({ view: "album", runId: "r1" });
    expect(parseOrchMark({ runId: "r1" })).toEqual({ view: "library" });
    expect(parseOrchMark({})).toEqual({ view: "library" });
    expect(parseOrchMark({ runId: 3 })).toEqual({ view: "library" });
    expect(parseOrchMark(null)).toBeNull();
    expect(parseOrchMark("x")).toEqual({ view: "library" });
    expect(parseOrchMark([])).toEqual({ view: "library" });
    expect(saveOrchMark(undefined)).toBeUndefined();
    expect(saveOrchMark({ runId: " " })).toEqual({ view: "library" });
  });

  it("배치 파일 왕복 — orch 칸 · 플레이어 주소 · 프로듀서 채팅 잎", () => {
    const a = album("run-9");
    const h = home();
    const file = serialize([a, h, tab({ type: "leaf", pane: newLocalPane() })], a.id);
    expect(file.workspaces[0].orch).toEqual({ view: "album", runId: "run-9" });
    expect(file.workspaces[1].orch).toEqual({ view: "library" });
    expect("orch" in file.workspaces[2]).toBe(false);
    const back = deserialize(JSON.parse(JSON.stringify(file)));
    expect(back.tabs[0].orch).toEqual({ view: "album", runId: "run-9" });
    expect(orchShape(back.tabs[0])).toBe("album");
    expect(playerPaneOf(back.tabs[0])?.run?.runId).toBe("run-9");
    expect(producerLeafOf(back.tabs[0])?.producer?.chatId).toBe(producerLeafOf(a)?.producer?.chatId);
    expect(orchShape(back.tabs[1])).toBe("home");
    expect(back.tabs[2].orch).toBeUndefined();
  });

  it("창 이관 짐(adoptTab) · 원격 거울에 따라간다", () => {
    const a = album("run-5");
    const moved = adoptTab(JSON.parse(JSON.stringify(a)) as TabSpec, () => undefined);
    expect(moved.orch).toEqual({ view: "album", runId: "run-5" });
    const snap = buildSnapshot({
      source: "home",
      workspace: { id: "w1", name: "W" },
      tabs: [{ ...a, workspaceId: "w1" }],
      activeTabId: a.id,
      focusOf: () => null,
    });
    expect(snap.tabs[0].orch).toEqual({ view: "album", runId: "run-5" });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed?.tabs[0].orch).toEqual({ view: "album", runId: "run-5" });
  });
});

describe("배치 · 드롭(D11)", () => {
  it("오케스트레이션 탭의 타일 캔버스 = 아래 막대 띠를 뺀 사각형", () => {
    expect(tabCanvas({ orch: {} })).toBe(ORCH_CANVAS);
    expect(tabCanvas({})).toBe(FULL_RECT);
    expect(ORCH_CANVAS.h).toEqual({ pct: 100, px: -ORCH_BAR_PX });
    const a = album("r1");
    const boxes = hostBoxes([a], a.id, () => listPanes(a.root)[0].id);
    for (const b of boxes) expect(b.rect.h.px).toBeLessThanOrEqual(-ORCH_BAR_PX);
    // 최대화도 막대 띠를 덮지 않는다
    a.zoomedPaneId = listPanes(a.root)[0].id;
    const zoomed = hostBoxes([a], a.id, () => listPanes(a.root)[0].id).find((b) => b.zoomed);
    expect(zoomed?.rect).toBe(ORCH_CANVAS);
  });

  it("오케스트레이션 탭 위에는 배치 조작을 놓지 않는다 — 파일 첨부 · 경로 붙여넣기는 그대로", () => {
    const target: DropTarget = { kind: "local", agent: true, tabId: "t", paneId: "p", orch: true };
    for (const kind of ["hosts", "tab", "pane"] as const) {
      expect(dropPlan({ kind, foreign: false, sourceTabId: "other", sourcePaneId: "x" }, target, "right").accept, kind).toBe(false);
      expect(dropPlan({ kind, foreign: true }, target, "right").accept, `${kind} foreign`).toBe(false);
    }
    expect(dropPlan({ kind: "files", foreign: false }, target, "right").outcome).toBe("attach");
    expect(dropPlan({ kind: "fsfiles", foreign: false }, target, "right").outcome).toBe("paste");
    // 보통 탭은 그대로
    expect(dropPlan({ kind: "pane", foreign: false, sourcePaneId: "x" }, { ...target, orch: false }, "right").outcome).toBe("move");
  });

  it("시작 타일 탭은 오케스트레이션 탭이 아니다", () => {
    expect(isOrchTab(tab({ type: "leaf", pane: newStartPane() }))).toBe(false);
  });
});

describe("스튜디오에서 연 새 앨범", () => {
  it("← 는 그 스튜디오 · 스튜디오 없이 열었으면 라이브러리", () => {
    expect(parentOrchPath({ view: "new", fromRepo: "C:/a" })).toEqual({ view: "studio", repo: "C:/a" });
    expect(parentOrchPath({ view: "new" })).toEqual({ view: "library" });
  });
  it("시작한 앨범은 그 스튜디오에서 시작했을 때만 출발을 잇는다", () => {
    expect(startedAlbumPath({ view: "new", fromRepo: "C:/a" }, "r", "C:/a")).toEqual({ view: "album", runId: "r", fromRepo: "C:/a" });
    expect(startedAlbumPath({ view: "new", fromRepo: "C:/a" }, "r", "C:/b")).toEqual({ view: "album", runId: "r" });
    expect(startedAlbumPath({ view: "new" }, "r", "C:/a")).toEqual({ view: "album", runId: "r" });
    expect(startedAlbumPath({ view: "library" }, "r", "C:/a")).toEqual({ view: "album", runId: "r" });
  });
});
