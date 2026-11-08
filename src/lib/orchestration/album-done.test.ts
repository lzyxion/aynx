// 끝난 앨범 화면(10-31 — 목업 V3AlbumDone): 채팅 잎 없이 플레이어 전체 폭 · [프로듀서 대화 기록]은 왼쪽 같은 자리 · 같은 폭 · 서버에 열지 않는다.
// orch-navigation.test.ts 와 같은 메모리 모형(탭 저장소 · 전송 경계만 흉내).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newRunPane, newTab, type OrchMark, type TabSpec } from "$lib/session";
import { PRODUCER_SHARE, orchRoot, playerPaneOf, producerLeafOf } from "./orch-tab";

const state = vi.hoisted(() => ({ tabs: [] as TabSpec[], active: "", screens: {} as Record<string, { path?: OrchMark }>, summaries: [] as unknown[] }));
vi.mock("$lib/app/tabs.svelte.js", () => ({
  activeTab: () => state.tabs.find((tab) => tab.id === state.active) ?? null,
  currentWorkspaceTabs: () => state.tabs,
  residentWindowTabs: () => state.tabs,
  openTab: (tab: TabSpec) => { state.tabs.push(tab); state.active = tab.id; },
  pickTab: (id: string) => { state.active = id; },
  focusTile: vi.fn(), requestOrchTab: vi.fn(() => true),
  findPaneAnywhere: vi.fn(), openTabInWorkspace: vi.fn(), tabOfPane: vi.fn(),
}));
vi.mock("$lib/ipc", () => ({ isRemote: false, invoke: vi.fn() }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/app/producer-chat.svelte.js", () => ({ setProducerConvHook: vi.fn(), producerErrorText: vi.fn(), reasonIs: vi.fn() }));
vi.mock("$lib/app/agent-sessions.svelte.js", () => ({ agentLinkOf: vi.fn() }));
vi.mock("$lib/app/studio-projects.svelte.js", () => ({ studioLabel: (repo: string) => repo.split(/[\/]/).filter(Boolean).pop() ?? repo, studioProject: () => null }));
vi.mock("$lib/app/project-list.svelte.js", () => ({ projects: () => [] }));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/app/diff-view.svelte.js", () => ({ openDiff: vi.fn() }));
vi.mock("$lib/app/workspaces.svelte.js", () => ({ currentWorkspaceId: () => "w1", workspaceList: () => [] }));
vi.mock("$lib/app/orch-pulse.svelte.js", () => ({ runSummaryOf: (id: string) => state.summaries.find((s) => (s as { runId: string }).runId === id) ?? null }));
vi.mock("./api", () => ({ runSnapshot: vi.fn(async () => state.summaries), runDetail: vi.fn() }));
vi.mock("./producer-api", () => ({ producerChatStatus: vi.fn() }));
vi.mock("$lib/app/album-screen.svelte.js", async () => {
  const { orchPath } = await import("./orch-tab");
  return { albumScreens: state.screens, orchScreenPath: (tab: TabSpec) => state.screens[tab.id]?.path ?? orchPath(tab) };
});
import { albumProducerLog, closeProducerLog, handleOrchEscape, navigateOrchTab, newProducerLeaf, openProducerLog, reattachAlbumProducer } from "$lib/app/orchestration.svelte.js";
import { lastProducerOf, rememberProducer } from "$lib/app/producer-record";
import { invoke } from "$lib/ipc";
import { producerChatStatus, type ProducerStatus } from "./producer-api";
import { endedByHuman, finalePreview } from "./model/producer";

const ENDED = { restore: false, autoResume: false, why: "ended" };
const LIVE = { restore: false, autoResume: false, why: null };
function summary(runId: string, adoptable: object, producers = ["pc-a"]) {
  return { runId, state: adoptable === ENDED ? "done" : "running", adoptable, coordinatorChat: adoptable === ENDED ? null : "pc-a", producers };
}

function albumTab(runId: string, leaf = false): TabSpec {
  const tab = newTab();
  tab.workspaceId = "w1";
  tab.orch = { view: "album", runId };
  const player = newRunPane(runId);
  tab.root = orchRoot(leaf ? newProducerLeaf({ chatId: "pc-a", cli: "claude", model: "opus", opened: true, conv: "conv-aaaa1111" }) : null, player);
  state.tabs.push(tab);
  state.active = tab.id;
  return tab;
}

let store: Record<string, string> = {};
beforeEach(() => {
  state.tabs = []; state.active = ""; state.summaries = [];
  vi.clearAllMocks();
  store = {};
  vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
  vi.stubGlobal("Element", class { closest(sel: string) { return sel === "[data-producer-leaf]" ? this : null; } });
});
afterEach(() => vi.unstubAllGlobals());

describe("끝난 앨범 — 채팅 잎 없이 플레이어 전체 폭", () => {
  it("다시 열면 서버 채팅이 열려 있어도 잎을 세우지 않고 채팅 상태도 묻지 않는다", async () => {
    const tab = albumTab("run-d");
    state.summaries = [summary("run-d", ENDED)];
    vi.mocked(producerChatStatus).mockResolvedValue({ open: true, snapshot: { cli: "claude", model: "", effort: "", repo: "C:/r", conversationId: "conv-x" } } as ProducerStatus);
    await reattachAlbumProducer(tab.id, "run-d");
    expect(producerLeafOf(tab)).toBeNull();
    expect(producerChatStatus).not.toHaveBeenCalled();
  });

  it("복원된 끝난 앨범의 잎은 처음 맞출 때 걷고 그 대화를 이 기기에 적어 둔다", async () => {
    const tab = albumTab("run-d", true);
    state.summaries = [summary("run-d", ENDED)];
    await reattachAlbumProducer(tab.id, "run-d");
    expect(producerLeafOf(tab)).toBeNull();
    expect(lastProducerOf("run-d")).toMatchObject({ chat: "pc-a", conv: "conv-aaaa1111", cli: "claude" });
  });

  it("보는 동안 앨범이 끝나면 잎을 걷지 않는다(트랙 왕복 포함) · 다른 경로를 다녀오면 전체 폭", async () => {
    const tab = albumTab("run-l", true);
    state.summaries = [summary("run-l", LIVE)];
    await reattachAlbumProducer(tab.id, "run-l");
    expect(producerLeafOf(tab)).not.toBeNull();
    state.summaries = [summary("run-l", ENDED)];
    navigateOrchTab(tab.id, { view: "track", runId: "run-l", taskId: "t1" });
    await reattachAlbumProducer(tab.id, "run-l");
    navigateOrchTab(tab.id, { view: "album", runId: "run-l" });
    await reattachAlbumProducer(tab.id, "run-l");
    expect(producerLeafOf(tab)?.producer?.chatId).toBe("pc-a");
    navigateOrchTab(tab.id, { view: "library" });
    navigateOrchTab(tab.id, { view: "album", runId: "run-l" });
    await reattachAlbumProducer(tab.id, "run-l");
    expect(producerLeafOf(tab)).toBeNull();
  });

  it("진행 중 앨범은 예전처럼 서버 채팅을 왼쪽에 다시 단다(회귀)", async () => {
    const tab = albumTab("run-l");
    state.summaries = [summary("run-l", LIVE)];
    vi.mocked(producerChatStatus).mockResolvedValue({ open: true, snapshot: { cli: "claude", model: "", effort: "", repo: "C:/r", conversationId: "conv-live1234" } } as ProducerStatus);
    await reattachAlbumProducer(tab.id, "run-l");
    expect(producerLeafOf(tab)?.producer?.chatId).toBe("pc-a");
  });
});

describe("[프로듀서 대화 기록] — 왼쪽 같은 자리 · 같은 폭 · 읽기만", () => {
  it("기록이 있으면 진행 중 앨범과 같은 비율의 왼쪽 잎을 대화 id 와 함께 세우고, 서버에 아무것도 부르지 않는다", () => {
    const tab = albumTab("run-d");
    state.summaries = [summary("run-d", ENDED)];
    rememberProducer("run-d", { cli: "codex", model: "gpt", effort: "high", chat: "pc-a", conv: "conv-bbbb2222" });
    expect(openProducerLog(tab.id, "run-d", "C:/repo")).toBe(true);
    const leaf = producerLeafOf(tab);
    expect(leaf?.producer).toMatchObject({ chatId: "pc-a", cli: "codex", conv: "conv-bbbb2222", opened: true, studio: "C:/repo" });
    expect(tab.root.type === "split" && tab.root.ratio).toBe(PRODUCER_SHARE);
    expect(tab.root.type === "split" && tab.root.a.type === "leaf" && tab.root.a.pane.kind).toBe("producer");
    expect(invoke).not.toHaveBeenCalled();
    expect(producerChatStatus).not.toHaveBeenCalled();
    closeProducerLog(tab.id);
    expect(producerLeafOf(tab)).toBeNull();
    expect(playerPaneOf(tab)?.run?.runId).toBe("run-d");
  });

  it("이 앨범의 프로듀서가 아닌 채팅 · 대화 id 없는 기록은 쓰지 않는다", () => {
    const tab = albumTab("run-d");
    state.summaries = [summary("run-d", ENDED, ["pc-other"])];
    rememberProducer("run-d", { cli: "claude", model: "", effort: "", chat: "pc-a", conv: "conv-cccc3333" });
    expect(albumProducerLog("run-d")).toBeNull();
    expect(openProducerLog(tab.id, "run-d")).toBe(false);
    expect(producerLeafOf(tab)).toBeNull();
    rememberProducer("run-e", { cli: "claude", model: "", effort: "", chat: "pc-a" });
    expect(albumProducerLog("run-e")).toBeNull();
  });

  it("다른 채팅을 적으면 옛 대화 id 를 버린다 · 채팅 없이 적으면 알던 대화를 둔다", () => {
    rememberProducer("run-d", { cli: "claude", model: "", effort: "", chat: "pc-a", conv: "conv-dddd4444" });
    rememberProducer("run-d", { cli: "claude", model: "opus", effort: "" });
    expect(lastProducerOf("run-d")).toMatchObject({ chat: "pc-a", conv: "conv-dddd4444", model: "opus" });
    rememberProducer("run-d", { cli: "claude", model: "", effort: "", chat: "pc-b" });
    expect(lastProducerOf("run-d")?.chat).toBe("pc-b");
    expect(lastProducerOf("run-d")?.conv).toBeUndefined();
  });

  it("Esc 는 끝난 앨범의 대화 기록 잎 안에서 먼저 잎을 걷고 경로는 그대로 둔다", () => {
    const tab = albumTab("run-d", true);
    state.summaries = [summary("run-d", ENDED)];
    const target = new (globalThis.Element as unknown as new () => Element)();
    const ev = { key: "Escape", target, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    expect(handleOrchEscape(ev)).toBe(true);
    expect(producerLeafOf(tab)).toBeNull();
    expect(tab.orch).toEqual({ view: "album", runId: "run-d" });
    expect(handleOrchEscape(ev)).toBe(true);
    expect(tab.orch).toEqual({ view: "library" });
  });
});

describe("프로듀서 마무리 카드의 글", () => {
  it("마지막 어시스턴트 말 · 마크다운 표시를 걷고 공백을 접는다 · 없으면 null", () => {
    const items = [
      { role: "user", text: "해 줘", at: 1 },
      { role: "assistant", text: "## 정리\n- **TODO 넷** 처리\n- 브랜치 `orch-7c1e-int`", at: 2 },
      { role: "tool", text: "x", at: 3 },
    ];
    expect(finalePreview(items)).toEqual({ text: "정리 TODO 넷 처리 브랜치 orch-7c1e-int", at: 2 });
    expect(finalePreview([{ role: "user", text: "a", at: null }])).toBeNull();
    expect(finalePreview([{ role: "assistant", text: "가".repeat(10), at: null }], 4)?.text).toBe("가가가가…");
  });

  it("endedByHuman — 끝 기록의 주체 · 뒤따르는 정리 기록은 건너뛴다 · 못 찾으면 false", () => {
    const row = (actor: string, action: string) => ({ actor, action });
    expect(endedByHuman([row("human", "human_resumed"), row("human", "run_done"), row("human", "run_cleaned")])).toBe(true);
    expect(endedByHuman([row("human", "human_paused"), row("coordinator", "run_done"), row("human", "run_cleaned")])).toBe(false);
    expect(endedByHuman([row("human", "human_stopped"), row("server", "run_ended")])).toBe(true);
    expect(endedByHuman([row("human", "human_paused")])).toBe(false);
    expect(endedByHuman(undefined)).toBe(false);
  });
});
