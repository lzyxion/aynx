import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneSpec } from "$lib/session";

// `openConversationInChat` 의 두 번 누름 — 실제 저장 모듈에 탭 · 서버 API 만 모형으로 둔다.
const h = vi.hoisted(() => {
  const id = <T>(value: T) => value;
  vi.stubGlobal("$state", Object.assign(id, { raw: id }));
  return { tabs: [] as { id: string; root: { type: "leaf"; pane: PaneSpec } }[] };
});
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "C:/Users/u") }));
vi.mock("$lib/context", () => ({
  agentConversationLaunched: vi.fn(),
  agentConversationLinks: vi.fn(async () => []),
  agentSessionDelete: vi.fn(),
  agentSessionLaunchSpec: vi.fn(),
  agentSessionRename: vi.fn(),
  agentSessionsList: vi.fn(),
}));
vi.mock("$lib/app/project-list.svelte.js", () => ({ projects: () => [] }));
vi.mock("$lib/app/worktrees.svelte.js", () => ({ loadWorktrees: vi.fn(), worktreesOf: () => [] }));
vi.mock("$lib/app/tabs.svelte.js", () => ({
  activeTabId: () => null,
  focusTile: vi.fn(),
  openInNewTab: vi.fn((pane: PaneSpec) => h.tabs.push({ id: `t${h.tabs.length + 1}`, root: { type: "leaf", pane } })),
  openPaneBeside: vi.fn(() => false),
  openPaneInTab: vi.fn(),
  replaceTile: vi.fn(() => false),
  tabOfPane: (paneId: string) => h.tabs.find((t) => t.root.pane.id === paneId) ?? null,
  findPaneAnywhere: () => null,
  currentWorkspaceTabs: () => h.tabs,
  residentWindowTabs: () => h.tabs,
}));
vi.mock("$lib/app/notice", () => ({ showNotice: vi.fn() }));
vi.mock("$lib/toast.svelte.js", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("$lib/app/tile-glow.svelte.js", () => ({ glowTile: vi.fn() }));
vi.mock("$lib/app/agent-usage.svelte.js", () => ({ loadUsage: vi.fn(), loadUsageSummary: vi.fn(), scheduleLimitsRefresh: vi.fn(), usageSummary: () => null }));
vi.mock("$lib/app/confirm-dialog.svelte.js", () => ({ askConfirm: vi.fn(async () => false) }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
vi.mock("$lib/settings.svelte.js", () => ({ settings: { chatTile: true } }));
vi.mock("$lib/project-start", () => ({ conversationTarget: () => ({ kind: "new" }), shouldShowStartScreen: () => false }));
vi.mock("$lib/app/recent-worktrees.svelte.js", () => ({ noteFolderOpened: vi.fn() }));
vi.mock("$lib/app/workspace-status.svelte.js", () => ({ focusAuxStream: vi.fn(() => false) }));
vi.mock("$lib/app/side-chats.svelte.js", () => ({ sideChatConvMarkOf: () => null }));
vi.mock("$lib/chat-tile/chat-tile-api", () => ({ chatTileOpen: vi.fn() }));
vi.mock("$lib/chat-tile/chat-tile-text", () => ({ chatTileErrorText: (e: unknown) => String(e) }));
vi.mock("$lib/remote-conversations", () => ({ isRemoteConversation: () => false }));

import { chatTileOpen } from "$lib/chat-tile/chat-tile-api";
import { focusTile, openInNewTab } from "$lib/app/tabs.svelte.js";
import { openConversationInChat } from "./agent-sessions.svelte.js";
import type { AgentConversation } from "$lib/agent-sessions";

const CONV = "1B4E28BA-2FA1-11D2-883F-0016D3CCA427";
const convo = (over: Partial<AgentConversation> = {}): AgentConversation => ({
  agent: "claude", id: CONV, cwd: "C:/src/proj", branch: null, title: "t", titleSource: "prompt",
  startedAt: null, updatedAt: 0, model: null, forkedFrom: null, cwdExists: true, ...over,
});

function deferredOpen() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  vi.mocked(chatTileOpen).mockImplementation(() => new Promise((ok, no) => ((resolve = ok), (reject = no))) as never);
  return { resolve: (cwd = "C:/src/proj") => resolve({ cwd }), reject: (e: unknown) => reject(e) };
}

beforeEach(() => {
  h.tabs.length = 0;
  vi.mocked(chatTileOpen).mockReset();
  vi.mocked(openInNewTab).mockClear();
  vi.mocked(focusTile).mockClear();
});
afterAll(() => vi.unstubAllGlobals());

describe("[채팅으로 열기] 두 번 누름", () => {
  it("열기가 끝나기 전의 두 번째 누름은 chat_tile_open 을 다시 부르지 않는다 · 잎 하나", async () => {
    const open = deferredOpen();
    const s = convo();
    const a = openConversationInChat(s);
    const b = openConversationInChat({ ...s, id: s.id.toLowerCase() });
    expect(b).toBe(a);
    open.resolve();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(vi.mocked(chatTileOpen)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(openInNewTab)).toHaveBeenCalledTimes(1);
  });

  it("끝난 뒤의 누름은 연 잎으로 간다(open 없음)", async () => {
    const open = deferredOpen();
    const s = convo();
    const a = openConversationInChat(s);
    open.resolve();
    await a;
    vi.mocked(focusTile).mockClear();
    expect(await openConversationInChat(s)).toBe(true);
    expect(vi.mocked(chatTileOpen)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(focusTile)).toHaveBeenCalledWith("t1", h.tabs[0].root.pane.id);
  });

  it("거절 뒤에는 다시 누르면 다시 연다", async () => {
    const open = deferredOpen();
    const s = convo();
    const a = openConversationInChat(s);
    open.reject(new Error("[conversation-busy] busy"));
    expect(await a).toBe(false);
    const again = deferredOpen();
    const b = openConversationInChat(s);
    again.resolve();
    expect(await b).toBe(true);
    expect(vi.mocked(chatTileOpen)).toHaveBeenCalledTimes(2);
  });

  it("다른 대화는 따로 연다", async () => {
    vi.mocked(chatTileOpen).mockResolvedValue({ cwd: "C:/src/proj" } as never);
    const a = openConversationInChat(convo());
    const b = openConversationInChat(convo({ id: "2c4e28ba-2fa1-11d2-883f-0016d3cca427" }));
    expect(b).not.toBe(a);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(vi.mocked(chatTileOpen)).toHaveBeenCalledTimes(2);
  });
});
