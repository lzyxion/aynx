import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaneSpec } from "$lib/session";

const state = vi.hoisted(() => ({
  settings: { notifyPermission: true, notifyTurnEnd: true, notifyFocusedAfterSecs: 0 },
  active: "tab-a" as string | null,
  panes: new Map<string, { pane: PaneSpec; tab: string }>(),
  focused: null as string | null,
  veil: false,
  windowFocused: true,
}));

vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? `${key}:${JSON.stringify(p)}` : key) }));
vi.mock("$lib/settings.svelte.js", () => ({ settings: state.settings }));
vi.mock("$lib/app/tabs.svelte.js", () => ({
  activeTabId: () => state.active,
  findPaneAnywhere: (id: string) => state.panes.get(id)?.pane ?? null,
  focusedPane: () => (state.focused ? (state.panes.get(state.focused)?.pane ?? null) : null),
  tabOfPane: (id: string) => {
    const r = state.panes.get(id);
    return r ? { id: r.tab } : null;
  },
}));
vi.mock("$lib/app/veil.svelte.js", () => ({ veilVisible: () => state.veil }));
vi.mock("$lib/app/agent-unseen.svelte.js", () => ({ markAgentUnseen: vi.fn(), clearAgentUnseen: vi.fn() }));
vi.mock("$lib/app/agent-banners.svelte.js", () => ({ pushAgentBanner: vi.fn(), chatTileBannerSignal: vi.fn() }));
vi.mock("$lib/app/os-notify", () => ({ APP: "Aynx", notifyOs: vi.fn(async () => true), windowFocused: () => state.windowFocused }));
vi.mock("$lib/app/messenger-label", () => ({ tileLabel: () => "proj", scopeOf: () => null }));

import { clearAgentUnseen, markAgentUnseen } from "$lib/app/agent-unseen.svelte.js";
import { chatTileBannerSignal, pushAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { noteChatTileEvent } from "./chat-tile-notify";

const PANE = "pane-chat";
function place(tab: string): void {
  const pane = { id: PANE, kind: "chat", chat: { chatId: "ct-x", cli: "claude", model: "", effort: "", cwd: "C:/src/proj" } } as unknown as PaneSpec;
  state.panes.set(PANE, { pane, tab });
}
const NO = { pendingBefore: 0, pendingAfter: 0 };
const banners = () => vi.mocked(pushAgentBanner).mock.calls.map(([b]) => b);

afterEach(() => {
  state.settings.notifyPermission = true;
  state.settings.notifyTurnEnd = true;
  state.active = "tab-a";
  state.panes.clear();
  state.focused = null;
  state.veil = false;
  state.windowFocused = true;
  vi.mocked(pushAgentBanner).mockClear();
  vi.mocked(chatTileBannerSignal).mockClear();
  vi.mocked(markAgentUnseen).mockClear();
  vi.mocked(clearAgentUnseen).mockClear();
});

describe("소스 — 메신저 다리에 닿지 않는다", () => {
  const src = readFileSync(fileURLToPath(new URL("./chat-tile-notify.ts", import.meta.url)), "utf8");
  it("메신저 모듈 · 터미널 알림 모듈을 부르지 않는다", () => {
    expect(src).not.toContain('$lib/app/messenger"');
    expect(src).not.toContain("$lib/app/agent-notify");
    expect(src).not.toContain("messengerAgent");
    expect(src).not.toContain("messengerBotLabel");
    expect(src).not.toContain("notifyAgent(");
  });
});

describe("noteChatTileEvent", () => {
  it("권한 카드가 늘면 permission 배너(paneId)", () => {
    place("tab-b");
    noteChatTileEvent(PANE, "claude", { t: "permission", requestId: "r1", kind: "command", title: "Bash", detail: "ls", toolName: "Bash" }, { pendingBefore: 0, pendingAfter: 1 });
    expect(banners()).toEqual([expect.objectContaining({ paneId: PANE, kind: "permission", logo: "claude", label: "proj" })]);
  });

  it("활성이 아닌 탭에서 turnEnded ok → 안 봄 + stop 배너", () => {
    place("tab-b");
    noteChatTileEvent(PANE, "claude", { t: "turnStarted", turn: "t1" }, NO);
    noteChatTileEvent(PANE, "claude", { t: "turnEnded", turn: "t1", outcome: "ok", message: null }, NO);
    expect(markAgentUnseen).toHaveBeenCalledWith(PANE);
    expect(banners()).toEqual([expect.objectContaining({ paneId: PANE, kind: "stop" })]);
  });

  it("보고 있는 탭이면 안 봄을 지운다 · 가림막이 덮으면 안 봄", () => {
    place("tab-a");
    noteChatTileEvent(PANE, "claude", { t: "turnEnded", turn: "t1", outcome: "ok", message: null }, NO);
    expect(markAgentUnseen).not.toHaveBeenCalled();
    expect(clearAgentUnseen).toHaveBeenCalledWith([PANE]);
    state.veil = true;
    noteChatTileEvent(PANE, "claude", { t: "turnEnded", turn: "t2", outcome: "ok", message: null }, NO);
    expect(markAgentUnseen).toHaveBeenCalledWith(PANE);
  });

  it("interrupted → 배너 · 안 봄 없음 · error → failed 배너", () => {
    place("tab-b");
    noteChatTileEvent(PANE, "codex", { t: "turnEnded", turn: "t1", outcome: "interrupted", message: null }, NO);
    expect(banners()).toEqual([]);
    expect(markAgentUnseen).not.toHaveBeenCalled();
    noteChatTileEvent(PANE, "codex", { t: "turnEnded", turn: "t2", outcome: "error", message: "boom" }, NO);
    expect(banners()).toEqual([expect.objectContaining({ kind: "failed", logo: "codex", text: expect.stringContaining("app.agent.failed.toast") })]);
  });

  it("turnStarted → 셋 풀기 + 안 봄 지움 · 대기 카드가 0 이 되면 권한 풀기", () => {
    place("tab-b");
    noteChatTileEvent(PANE, "claude", { t: "turnStarted", turn: "t1" }, NO);
    expect(chatTileBannerSignal).toHaveBeenLastCalledWith(PANE, ["stop", "failed", "permission"]);
    expect(clearAgentUnseen).toHaveBeenCalledWith([PANE]);
    noteChatTileEvent(PANE, "claude", { t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" }, { pendingBefore: 1, pendingAfter: 0 });
    expect(chatTileBannerSignal).toHaveBeenLastCalledWith(PANE, ["permission"]);
  });

  it("설정 끔 → 배너 없음 (안 봄은 그대로 선다)", () => {
    place("tab-b");
    state.settings.notifyPermission = false;
    state.settings.notifyTurnEnd = false;
    noteChatTileEvent(PANE, "claude", { t: "permission", requestId: "r1", kind: "command", title: "Bash", detail: "ls", toolName: "Bash" }, { pendingBefore: 0, pendingAfter: 1 });
    noteChatTileEvent(PANE, "claude", { t: "turnEnded", turn: "t1", outcome: "ok", message: null }, NO);
    expect(banners()).toEqual([]);
    expect(markAgentUnseen).toHaveBeenCalledWith(PANE);
  });

  it("잎이 이 창에 없으면 배너 없음", () => {
    noteChatTileEvent(PANE, "claude", { t: "permission", requestId: "r1", kind: "command", title: "Bash", detail: "ls", toolName: "Bash" }, { pendingBefore: 0, pendingAfter: 1 });
    expect(banners()).toEqual([]);
  });
});
