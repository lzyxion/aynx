// F1-b: UI/서버 없이 실제 여는 길을 부른다. 탭 저장소·전송 경계만 메모리 모형으로 둔다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listPanes, newRunPane, newTab, type OrchMark, type TabSpec } from "$lib/session";
import { orchRoot, playerPaneOf, producerLeafOf } from "./orch-tab";
import { hostBoxes, tabCanvas } from "$lib/pane/boxes";

const state = vi.hoisted(() => ({ tabs: [] as TabSpec[], active: "", remote: false, screens: {} as Record<string, { path?: OrchMark }> }));
vi.mock("$lib/app/tabs.svelte.js", () => ({
  activeTab: () => state.tabs.find((tab) => tab.id === state.active) ?? null,
  currentWorkspaceTabs: () => state.tabs.filter((tab) => tab.workspaceId === "w1"),
  residentWindowTabs: () => state.tabs,
  openTab: (tab: TabSpec) => { tab.workspaceId = "w1"; state.tabs.push(tab); state.active = tab.id; },
  pickTab: (id: string) => { state.active = id; },
  focusTile: vi.fn(), requestOrchTab: vi.fn(() => true),
  findPaneAnywhere: vi.fn(), openTabInWorkspace: vi.fn(), tabOfPane: vi.fn(),
}));
vi.mock("$lib/ipc", () => ({ get isRemote() { return state.remote; }, invoke: vi.fn() }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/app/producer-chat.svelte.js", () => ({ setProducerConvHook: vi.fn(), producerErrorText: vi.fn(), reasonIs: vi.fn() }));
vi.mock("$lib/app/agent-sessions.svelte.js", () => ({ agentLinkOf: vi.fn() }));
vi.mock("$lib/app/studio-projects.svelte.js", () => ({ studioLabel: (repo: string) => repo.split(/[\/]/).filter(Boolean).pop() ?? repo, studioProject: () => null }));
vi.mock("$lib/app/project-list.svelte.js", () => ({ projects: () => [] }));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/toast.svelte.js", () => ({ toast: { info: vi.fn() } }));
vi.mock("$lib/layout-anim.svelte.js", () => ({ withLayoutAnim: (fn: () => void) => fn() }));
vi.mock("$lib/app/diff-view.svelte.js", () => ({ openDiff: vi.fn() }));
vi.mock("$lib/app/overlays.svelte.js", () => ({ openSettingsAt: vi.fn() }));
vi.mock("$lib/app/workspaces.svelte.js", () => ({ currentWorkspaceId: () => "w1", workspaceList: () => [] }));
vi.mock("$lib/app/orch-pulse.svelte.js", () => ({ runSummaryOf: vi.fn() }));
vi.mock("$lib/app/orch-home-draft.svelte.js", () => ({ homeDraft: {}, selectHomeStudio: vi.fn() }));
vi.mock("./api", () => ({ runSnapshot: vi.fn(), runDetail: vi.fn() }));
vi.mock("./producer-api", () => ({ producerChatStatus: vi.fn() }));

// Vitest는 runes를 컴파일하지 않는다. homeDraft처럼 창 상태 경계만 메모리 모형으로 둔다.
vi.mock("$lib/app/album-screen.svelte.js", async () => {
  const { orchPath } = await import("./orch-tab");
  return { albumScreens: state.screens, orchScreenPath: (tab: TabSpec) => state.screens[tab.id]?.path ?? orchPath(tab) };
});
import { orchScreenPath } from "$lib/app/album-screen.svelte.js";
import { handleOrchEscape, reattachAlbumProducer, newProducerLeaf, navigateOrchTab, openAlbumTab, openArtists, openOrchHome, openOrchPathInNewTab, openStudio, openTrackTab, openOrchNotice } from "$lib/app/orchestration.svelte.js";
import { requestOrchTab } from "$lib/app/tabs.svelte.js";
import { runDetail, runSnapshot } from "./api";
import { producerChatStatus, type ProducerStatus } from "./producer-api";
import type { RunDetail, RunSummary } from "./model/types";

function library(): TabSpec {
  const tab = newTab();
  tab.workspaceId = "w1";
  tab.orch = { view: "library" };
  tab.root = orchRoot(null, newRunPane());
  state.tabs.push(tab);
  state.active = tab.id;
  return tab;
}

beforeEach(() => {
  state.tabs = []; state.active = ""; state.remote = false;
  vi.clearAllMocks();
  for (const id of Object.keys(state.screens)) delete state.screens[id];
  // handleOrchEscape의 instanceof 경계만 제공한다. DOM 셀렉터 동작은 하네스가 검증한다.
  vi.stubGlobal("Element", class {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("알림과 트랙 진입", () => {
  const detail = { attempts: [{ id: "시도", taskId: "트랙" }], tasks: [{ id: "트랙" }] } as RunDetail;

  it("탭이 없으면 새 트랙 경로를 만들고 기존 탭에서는 시도만 전환한다", async () => {
    await openTrackTab("앨범", "트랙", "시도");
    const tab = state.tabs[0];
    expect(tab.orch).toEqual({ view: "track", runId: "앨범", taskId: "트랙", attemptId: "시도" });
    const player = playerPaneOf(tab)?.id;
    await openTrackTab("앨범", "트랙", "검토");
    expect(state.tabs).toHaveLength(1);
    expect(tab.orch?.attemptId).toBe("검토");
    expect(playerPaneOf(tab)?.id).toBe(player);
  });

  it("알림 시도의 실제 트랙을 조회하고 해당 시도로 들어간다", async () => {
    const tab = library();
    vi.mocked(runDetail).mockResolvedValue(detail);
    await openOrchNotice({ runId: "앨범", attemptId: "시도" });
    expect(runDetail).toHaveBeenCalledWith("앨범");
    expect(tab.orch).toEqual({ view: "track", runId: "앨범", taskId: "트랙", attemptId: "시도" });
  });

  it("앨범 사건·없어진 시도·조회 실패는 앨범으로 간다", async () => {
    const tab = library();
    await openOrchNotice({ runId: "앨범" });
    expect(runDetail).not.toHaveBeenCalled();
    expect(tab.orch).toEqual({ view: "album", runId: "앨범" });
    vi.mocked(runDetail).mockResolvedValue(detail);
    await openOrchNotice({ runId: "다른앨범", attemptId: "없음" });
    expect(tab.orch).toEqual({ view: "album", runId: "다른앨범" });
    vi.mocked(runDetail).mockRejectedValue(new Error("조회 실패"));
    await openOrchNotice({ runId: "실패앨범", attemptId: "시도" });
    expect(tab.orch).toEqual({ view: "album", runId: "실패앨범" });
  });

  it("트랙이 지워진 시도는 앨범으로 열고 늦은 조회가 다른 경로를 덮지 않는다", async () => {
    const tab = library();
    vi.mocked(runDetail).mockResolvedValue({ ...detail, tasks: [] });
    await openOrchNotice({ runId: "앨범", attemptId: "시도" });
    expect(tab.orch?.view).toBe("album");
    let resolve!: (value: RunDetail) => void;
    vi.mocked(runDetail).mockReturnValue(new Promise((done) => { resolve = done; }));
    const waiting = openOrchNotice({ runId: "앨범", attemptId: "시도" });
    navigateOrchTab(tab.id, { view: "artists" });
    resolve(detail);
    await waiting;
    expect(tab.orch).toEqual({ view: "artists" });
  });

  it("원격의 기존 탭은 거울을 보존하고 이 창에만 트랙 경로를 단다", async () => {
    const tab = library(); state.remote = true;
    await openTrackTab("앨범", "트랙", "시도");
    expect(tab.orch).toEqual({ view: "library" });
    expect(orchScreenPath(tab)).toEqual({ view: "track", runId: "앨범", taskId: "트랙", attemptId: "시도" });
    expect(requestOrchTab).not.toHaveBeenCalled();
  });

  it("원격에 탭이 없으면 기존 배치 요청 뒤 도착한 거울 탭에 트랙 경로를 잇는다", async () => {
    vi.useFakeTimers(); state.remote = true;
    const waiting = openTrackTab("앨범", "트랙", "시도");
    expect(requestOrchTab).toHaveBeenCalledWith("앨범");
    const tab = library(); tab.orch = { view: "album", runId: "앨범" };
    await vi.advanceTimersByTimeAsync(100);
    await waiting;
    expect(tab.orch).toEqual({ view: "album", runId: "앨범" });
    expect(orchScreenPath(tab)).toEqual({ view: "track", runId: "앨범", taskId: "트랙", attemptId: "시도" });
  });

  it("원격 거울 대기 중 사람이 다른 경로를 고르면 나중에 온 탭을 가로채지 않는다", async () => {
    vi.useFakeTimers(); state.remote = true;
    const waiting = openTrackTab("앨범", "트랙", "시도");
    openOrchHome();
    const tab = library(); tab.orch = { view: "album", runId: "앨범" };
    await vi.advanceTimersByTimeAsync(100);
    await waiting;
    expect(orchScreenPath(tab)).toEqual({ view: "album", runId: "앨범" });
  });
});

describe("앨범으로 돌아오면 같은 서버 채팅에 재부착", () => {
  it.each(['채팅 없음', '프로듀서 끝남'])("%s: 분할을 예약하지 않고 플레이어가 전체 캔버스를 쓴다", async (reason) => {
    const tab = library(); navigateOrchTab(tab.id, { view: "album", runId: "run-a" });
    vi.mocked(runSnapshot).mockResolvedValue([{ runId: "run-a", coordinatorChat: null, producers: reason === '채팅 없음' ? [] : ['pc-closed'] } as unknown as RunSummary]);
    vi.mocked(producerChatStatus).mockResolvedValue({ open: false, gone: 'closed' } as ProducerStatus);
    await reattachAlbumProducer(tab.id, "run-a");
    const boxes = hostBoxes([tab], tab.id, () => playerPaneOf(tab)!.id);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].rect).toEqual(tabCanvas(tab));
    expect(boxes[0].shown).toBe(true);
    expect(producerLeafOf(tab)).toBeNull();
  });
  it("다른 창의 살아 있는 채팅에도 같은 id로 붙어 왼쪽 잎과 플레이어가 캔버스를 채운다", async () => {
    const tab = library(); navigateOrchTab(tab.id, { view: "album", runId: "run-a" });
    vi.mocked(runSnapshot).mockResolvedValue([{ runId: 'run-a', coordinatorChat: 'pc-other-window' } as RunSummary]);
    vi.mocked(producerChatStatus).mockResolvedValue({ open: true, snapshot: { cli: 'claude', model: 'sonnet', effort: '', repo: 'C:/repo', conversationId: 'conv-other' } } as ProducerStatus);
    await reattachAlbumProducer(tab.id, 'run-a');
    const boxes = hostBoxes([tab], tab.id, () => playerPaneOf(tab)!.id);
    expect(boxes).toHaveLength(2);
    expect(boxes.every(b => b.shown)).toBe(true);
    expect(producerLeafOf(tab)?.producer?.chatId).toBe('pc-other-window');
    expect(boxes.find(b => b.pane.kind === 'producer')?.rect.x).toEqual({ pct: 0, px: 0 });
    expect(boxes.reduce((sum, b) => sum + b.rect.w.pct, 0)).toBe(100);
  });
  it("라이브러리 복귀 뒤에도 chat·conv를 서버에서 찾아 단다", async () => {
    const tab = library(); navigateOrchTab(tab.id, { view: "album", runId: "run-a" });
    vi.mocked(runSnapshot).mockResolvedValue([{ runId: "run-a", coordinatorChat: "pc-same", producers: ["pc-same"] } as RunSummary]);
    vi.mocked(producerChatStatus).mockResolvedValue({ open: true, snapshot: { cli: "claude", model: "sonnet", effort: "high", repo: "C:/repo", life: "live", conversationId: "conv-same" } } as ProducerStatus);
    await reattachAlbumProducer(tab.id, "run-a");
    expect(producerLeafOf(tab)?.producer).toMatchObject({ chatId: "pc-same", conv: "conv-same", opened: true });
    navigateOrchTab(tab.id, { view: "library" }); expect(producerLeafOf(tab)).toBeNull();
    navigateOrchTab(tab.id, { view: "album", runId: "run-a" }); await reattachAlbumProducer(tab.id, "run-a");
    expect(producerLeafOf(tab)?.producer?.chatId).toBe("pc-same");
  });
  it("조회 중 경로를 나가면 늦은 재부착을 버린다", async () => {
    const tab = library(); navigateOrchTab(tab.id, { view: "album", runId: "run-a" });
    let resolve!: (value: RunSummary[]) => void;
    vi.mocked(runSnapshot).mockReturnValue(new Promise(r => { resolve = r; }));
    const waiting = reattachAlbumProducer(tab.id, "run-a");
    navigateOrchTab(tab.id, { view: "library" });
    resolve([{ runId: "run-a", coordinatorChat: "pc-same", producers: [] } as unknown as RunSummary]);
    await waiting; expect(producerLeafOf(tab)).toBeNull();
  });
  it("원격 트랙 경로와 거울 명세를 유지하고 같은 채팅을 창 메모리에 단다", async () => {
    const tab = library(); state.remote = true;
    navigateOrchTab(tab.id, { view: "track", runId: "run-a", taskId: "task-a" });
    vi.mocked(runSnapshot).mockResolvedValue([{ runId: "run-a", coordinatorChat: "pc-same", producers: [] } as unknown as RunSummary]);
    vi.mocked(producerChatStatus).mockResolvedValue({ open: true, snapshot: { cli: "codex", model: "", effort: "", repo: "C:/repo", life: "live", conversationId: "conv-same" } } as ProducerStatus);
    await reattachAlbumProducer(tab.id, "run-a");
    expect(orchScreenPath(tab)).toEqual({ view: "track", runId: "run-a", taskId: "task-a" });
    expect(tab.orch).toEqual({ view: "library" });
    expect(state.screens[tab.id]).toMatchObject({ producer: { chat: "pc-same", conv: "conv-same" } });
  });
  it("원격 부팅의 빈 목록 뒤 같은 거울 앨범에 재진입하면 서버 채팅을 찾고 거울은 보존한다", async () => {
    const tab = library();
    const player = playerPaneOf(tab)!;
    const leaf = newProducerLeaf({ chatId: "pc-mirror", cli: "claude", opened: true });
    tab.orch = { view: "album", runId: "run-a" };
    player.run = { runId: "run-a" };
    tab.root = orchRoot(leaf, player);
    const mirror = JSON.stringify(tab);
    state.remote = true;
    vi.mocked(runSnapshot).mockResolvedValueOnce([]);
    await reattachAlbumProducer(tab.id, "run-a");
    expect(producerChatStatus).not.toHaveBeenCalled();
    // route helper와 같은 tick 안의 라이브러리 → 같은 앨범. 효과의 재실행 자체는 check-reattach-d.mjs가 검증한다.
    openOrchHome(); openAlbumTab("run-a");
    vi.mocked(runSnapshot).mockResolvedValue([{ runId: "run-a", coordinatorChat: "pc-mirror", producers: ["pc-mirror"] } as RunSummary]);
    vi.mocked(producerChatStatus).mockResolvedValue({ open: true, snapshot: { cli: "claude", model: "haiku", effort: "low", repo: "C:/repo", conversationId: "conv-mirror" } } as ProducerStatus);
    await reattachAlbumProducer(tab.id, "run-a");
    expect(state.screens[tab.id]).toMatchObject({ path: { view: "album", runId: "run-a" }, producer: { chat: "pc-mirror", conv: "conv-mirror" } });
    expect(JSON.stringify(tab)).toBe(mirror);
    expect(producerChatStatus).toHaveBeenCalledTimes(1);
  });
});

describe("실제 경로 이동 — 표지·플레이어·탭 선택", () => {
  it("지정 id의 탭만 고치고 활성 탭이나 다른 워크스페이스를 건드리지 않는다", () => {
    const target = library();
    const other = library();
    other.workspaceId = "w2";
    navigateOrchTab(target.id, { view: "track", runId: "r", taskId: "t", attemptId: "a" });
    expect(state.active).toBe(other.id);
    expect(other.orch).toEqual({ view: "library" });
    expect(playerPaneOf(other)?.run).toBeUndefined();
    expect(target.orch).toEqual({ view: "track", runId: "r", taskId: "t", attemptId: "a" });
    expect(playerPaneOf(target)?.run).toEqual({ runId: "r" });
  });

  it("같은 앨범이 다른 탭에 있어도 현재 탭으로 이동하고 새 탭을 만들지 않는다", () => {
    const existing = library();
    navigateOrchTab(existing.id, { view: "album", runId: "r" });
    const current = library();
    navigateOrchTab(current.id, { view: "new" });
    openAlbumTab("r");
    expect(state.tabs).toHaveLength(2);
    expect(state.active).toBe(current.id);
    expect(current.orch).toEqual({ view: "album", runId: "r" });
    expect(playerPaneOf(current)?.run?.runId).toBe("r");
    expect(producerLeafOf(current)).toBeNull();
    expect(existing.orch).toEqual(current.orch);
  });

  it("보통 탭에서 열면 현재 워크스페이스의 첫 오케스트레이션 탭을 고른다", () => {
    const outside = library(); outside.workspaceId = "w2";
    const target = library();
    const normal = newTab(); normal.workspaceId = "w1";
    state.tabs.push(normal); state.active = normal.id;
    openAlbumTab("r");
    expect(state.active).toBe(target.id);
    expect(target.orch).toEqual({ view: "album", runId: "r" });
    expect(outside.orch).toEqual({ view: "library" });
    expect(normal.orch).toBeUndefined();
  });

  it("같은 앨범의 트랙 왕복은 프로듀서·제목·플레이어 id를 보존한다", () => {
    const tab = library();
    navigateOrchTab(tab.id, { view: "new" });
    expect(producerLeafOf(tab)).toBeNull();
    // F2는 시작 성공 때만 실제 채팅 잎을 붙인다.
    const producer = newProducerLeaf({ chatId: "pc-started", cli: "claude", opened: true });
    const player = playerPaneOf(tab)!;
    // start_run 뒤의 같은 탭 배치를 모형으로 만든다.
    tab.root = orchRoot(producer, player);
    tab.orch = { view: "album", runId: "r" }; player.run = { runId: "r", name: "앨범 이름" };
    navigateOrchTab(tab.id, { view: "track", runId: "r", taskId: "t", attemptId: "a" });
    expect(tab.orch?.view).toBe("track");
    expect(producerLeafOf(tab)?.id).toBe(producer.id);
    expect(playerPaneOf(tab)?.id).toBe(player.id);
    expect(tab.pinnedTitle).toBe("앨범 이름");
    navigateOrchTab(tab.id, { view: "album", runId: "r" });
    expect(tab.orch).toEqual({ view: "album", runId: "r" });
    expect(producerLeafOf(tab)?.id).toBe(producer.id);
    expect(playerPaneOf(tab)?.run).toEqual({ runId: "r", name: "앨범 이름" });
  });

  it("라이브러리·아티스트는 같은 탭의 한 잎이며 이전 new나 run 주소가 남지 않는다", () => {
    const tab = library();
    navigateOrchTab(tab.id, { view: "new" });
    openArtists();
    expect(tab.orch).toEqual({ view: "artists" });
    expect(tab.pinnedTitle).toBe("orch.nav.artists");
    expect(listPanes(tab.root).map((pane) => pane.kind)).toEqual(["run"]);
    expect(playerPaneOf(tab)?.run).toBeUndefined();
    navigateOrchTab(tab.id, { view: "album", runId: "r" });
    openOrchHome();
    expect(state.active).toBe(tab.id);
    expect(tab.orch).toEqual({ view: "library" });
    expect(playerPaneOf(tab)?.run).toBeUndefined();
  });

  it("명시한 새 탭은 같은 앨범 경로를 복제하며 원래 트랙 탭을 바꾸지 않는다", () => {
    const original = library();
    navigateOrchTab(original.id, { view: "track", runId: "r", taskId: "t" });
    openOrchPathInNewTab({ view: "album", runId: "r" });
    const copy = state.tabs.find((tab) => tab.id === state.active)!;
    expect(state.tabs).toHaveLength(2);
    expect(copy.id).not.toBe(original.id);
    expect(copy.orch).toEqual({ view: "album", runId: "r" });
    expect(playerPaneOf(copy)?.run).toEqual({ runId: "r" });
    expect(original.orch).toEqual({ view: "track", runId: "r", taskId: "t" });
    openAlbumTab("r");
    expect(state.active).toBe(copy.id);
  });

  it("옛 표지로 이동을 청하면 라이브러리로 적고 이전 플레이어 주소를 지운다", () => {
    const tab = library();
    navigateOrchTab(tab.id, { view: "album", runId: "r" });
    navigateOrchTab(tab.id, { runId: "옛 표지" });
    expect(tab.orch).toEqual({ view: "library" });
    expect(playerPaneOf(tab)?.run).toBeUndefined();
  });

  it("원격 창은 거울 명세를 보존하고 이 창의 경로만 바꾼다", () => {
    const tab = library();
    navigateOrchTab(tab.id, { view: "new" });
    state.remote = true;
    navigateOrchTab(tab.id, { view: "track", runId: "r", taskId: "t" });
    openAlbumTab("r");
    expect(tab.orch).toEqual({ view: "new" });
    expect(orchScreenPath(tab)).toEqual({ view: "album", runId: "r" });
    expect(playerPaneOf(tab)?.run).toBeUndefined();
    expect(requestOrchTab).not.toHaveBeenCalled();
    expect(state.tabs).toHaveLength(1);
    state.remote = false;
    openAlbumTab("r");
    expect(tab.orch).toEqual({ view: "album", runId: "r" });
  });
});

describe("스튜디오 경로", () => {
  const REPO = "C:/work/e2e-merge";
  const esc = () => ({ key: "Escape", target: null, preventDefault: vi.fn() } as unknown as KeyboardEvent);

  it("카드 → 스튜디오: 같은 탭 · 한 잎 · 제목 = 스튜디오 이름 · 앨범 주소 없음", () => {
    const tab = library();
    openStudio(REPO);
    expect(state.tabs).toHaveLength(1);
    expect(tab.orch).toEqual({ view: "studio", repo: REPO });
    expect(tab.pinnedTitle).toBe("e2e-merge");
    expect(listPanes(tab.root).map((pane) => pane.kind)).toEqual(["run"]);
    expect(playerPaneOf(tab)?.run).toBeUndefined();
  });

  it("스튜디오 경유 앨범: Esc = 스튜디오 → 라이브러리 → 끝", () => {
    const tab = library();
    openStudio(REPO);
    openAlbumTab("r", REPO);
    expect(tab.orch).toEqual({ view: "album", runId: "r", fromRepo: REPO });
    expect(playerPaneOf(tab)?.run?.runId).toBe("r");
    expect(handleOrchEscape(esc())).toBe(true);
    expect(tab.orch).toEqual({ view: "studio", repo: REPO });
    expect(tab.pinnedTitle).toBe("e2e-merge");
    expect(playerPaneOf(tab)?.run).toBeUndefined();
    expect(handleOrchEscape(esc())).toBe(true);
    expect(tab.orch).toEqual({ view: "library" });
    expect(handleOrchEscape(esc())).toBe(false);
  });

  it("트랙에서 Esc 는 앨범으로 · 출발 스튜디오를 잃지 않는다", () => {
    const tab = library();
    openAlbumTab("r", REPO);
    navigateOrchTab(tab.id, { view: "track", runId: "r", taskId: "t", fromRepo: REPO });
    expect(handleOrchEscape(esc())).toBe(true);
    expect(tab.orch).toEqual({ view: "album", runId: "r", fromRepo: REPO });
  });

  it("라이브러리에서 바로 든 앨범은 지금처럼 라이브러리로", () => {
    const tab = library();
    openAlbumTab("r");
    expect(tab.orch).toEqual({ view: "album", runId: "r" });
    expect(handleOrchEscape(esc())).toBe(true);
    expect(tab.orch).toEqual({ view: "library" });
  });

  it("알림으로 같은 앨범 · 트랙에 가면 출발을 잇고, 다른 앨범으로 가면 잇지 않는다", async () => {
    const tab = library();
    openAlbumTab("r", REPO);
    await openTrackTab("r", "t", "a");
    expect(tab.orch).toEqual({ view: "track", runId: "r", taskId: "t", attemptId: "a", fromRepo: REPO });
    openAlbumTab("r");
    expect(tab.orch).toEqual({ view: "album", runId: "r", fromRepo: REPO });
    openAlbumTab("다른");
    expect(tab.orch).toEqual({ view: "album", runId: "다른" });
    await openTrackTab("r", "t");
    expect(tab.orch).toEqual({ view: "track", runId: "r", taskId: "t" });
  });

  it("[새 탭으로 열기] 복제는 출발 스튜디오를 그대로 든다", () => {
    const tab = library();
    openAlbumTab("r", REPO);
    openOrchPathInNewTab(tab.orch!);
    const copy = state.tabs.find((x) => x.id === state.active)!;
    expect(copy.id).not.toBe(tab.id);
    expect(copy.orch).toEqual({ view: "album", runId: "r", fromRepo: REPO });
    expect(handleOrchEscape(esc())).toBe(true);
    expect(copy.orch).toEqual({ view: "studio", repo: REPO });
    expect(tab.orch).toEqual({ view: "album", runId: "r", fromRepo: REPO });
  });

  it("원격 창 — 거울 명세는 그대로, 이 창의 경로에만 적는다", () => {
    const tab = library(); state.remote = true;
    openStudio(REPO);
    expect(tab.orch).toEqual({ view: "library" });
    expect(orchScreenPath(tab)).toEqual({ view: "studio", repo: REPO });
    openAlbumTab("r", REPO);
    expect(orchScreenPath(tab)).toEqual({ view: "album", runId: "r", fromRepo: REPO });
    expect(handleOrchEscape(esc())).toBe(true);
    expect(orchScreenPath(tab)).toEqual({ view: "studio", repo: REPO });
    expect(tab.orch).toEqual({ view: "library" });
  });
});

describe("실제 Esc 이동", () => {
  it("트랙 → 앨범 → 라이브러리로 같은 탭을 이동시키고 라이브러리에서는 끝난다", () => {
    const tab = library();
    navigateOrchTab(tab.id, { view: "track", runId: "r", taskId: "t" });
    const event = { key: "Escape", target: null, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(handleOrchEscape(event)).toBe(true);
    expect(tab.orch).toEqual({ view: "album", runId: "r" });
    expect(handleOrchEscape(event)).toBe(true);
    expect(tab.orch).toEqual({ view: "library" });
    expect(handleOrchEscape(event)).toBe(false);
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });

  it.each(["isComposing", "defaultPrevented", "ctrlKey", "altKey", "shiftKey", "metaKey"])("%s 중에는 표지와 플레이어를 보존한다", (flag) => {
    const tab = library();
    navigateOrchTab(tab.id, { view: "track", runId: "r", taskId: "t" });
    const event = { key: "Escape", target: null, [flag]: true, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(handleOrchEscape(event)).toBe(false);
    expect(tab.orch).toEqual({ view: "track", runId: "r", taskId: "t" });
    expect(playerPaneOf(tab)?.run?.runId).toBe("r");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
