import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "$lib/ipc";

// 실제 상태 모듈 · API 를 부른다 — 독의 붙기 효과가 실패 쓰기마다 다시 도는 것을 "틱마다 join" 으로 흉내 낸다.
vi.hoisted(() => {
  vi.stubGlobal("$state", <T>(value: T) => value);
});
vi.mock("$lib/app/side-chat-notify", () => ({ notifySideChat: vi.fn() }));
vi.mock("$lib/app/agent-banners.svelte.js", () => ({ sideChatBannerSignal: vi.fn() }));
vi.mock("$lib/app/side-chats.svelte.js", () => ({ noteSideChatConversation: vi.fn(), setSideChatTiles: vi.fn(), sideChats: () => [] }));
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));

import { closeSideChatLive, joinSideChat, setShownSideChat, sideChatLiveOf, type SideChatTarget } from "./side-chat-live.svelte.js";

const CONV = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
let n = 0;
function target(over: Partial<SideChatTarget> = {}): SideChatTarget {
  n += 1;
  return { id: `sc-${n}`, cli: "claude", model: "", effort: "", conversation: CONV, fork: null, links: [], ...over };
}

/** `side_chat_attach` 는 표에 없음 · `side_chat_open` 은 늘 같은 거절 */
function server(openError: string) {
  vi.mocked(invoke).mockImplementation(async (cmd) => {
    switch (cmd) {
      case "side_chat_subscribe":
        return null;
      case "side_chat_attach":
        throw new Error("[session-gone] no such side chat");
      case "side_chat_open":
        throw new Error(openError);
      case "side_chat_close":
        return true;
      default:
        throw new Error(`unexpected invoke: ${cmd}`);
    }
  });
}

const opens = () => vi.mocked(invoke).mock.calls.filter(([c]) => c === "side_chat_open").length;

/** 독 효과 — 사본이 바뀔 때마다 다시 join 한다고 보고 틱마다 부른다 */
async function ticks(tg: SideChatTarget, count: number) {
  for (let i = 0; i < count; i++) {
    await joinSideChat(tg);
    await new Promise((r) => setTimeout(r, 0));
  }
}

const made: string[] = [];
function track(tg: SideChatTarget) {
  made.push(tg.id);
  return tg;
}

afterEach(async () => {
  setShownSideChat(null);
  for (const id of made.splice(0)) await closeSideChatLive(id);
  vi.mocked(invoke).mockReset();
  vi.restoreAllMocks();
});
afterAll(() => vi.unstubAllGlobals());

describe("붙기 실패 — open 을 되풀이하지 않는다", () => {
  it("[conversation-in-chat-tile] 은 틱이 지나도 open 한 번 · 오류 줄", async () => {
    server("[conversation-in-chat-tile] this conversation is open in a chat tile");
    const tg = track(target());
    await ticks(tg, 20);
    expect(opens()).toBe(1);
    expect(sideChatLiveOf(tg.id)?.error).toBe("app.chatDock.err.inChatTile");
    expect(sideChatLiveOf(tg.id)?.attached).toBe(false);
  });

  it("저절로 풀리지 않는 거절은 시간이 지나도 다시 열지 않는다 · 떠났다 오면 한 번 더", async () => {
    server("[wrong-chat-kind] a side chat id must not start with ct-");
    const tg = track(target());
    const now = Date.now();
    await ticks(tg, 5);
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    await ticks(tg, 5);
    expect(opens()).toBe(1);
    setShownSideChat(tg.id);
    setShownSideChat("sc-other");
    await ticks(tg, 5);
    expect(opens()).toBe(2);
  });

  it("그 밖의 실패는 간격을 두고만 다시 연다", async () => {
    server("session server is not connected");
    const tg = track(target());
    const now = Date.now();
    await ticks(tg, 10);
    expect(opens()).toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(now + 3_500);
    await ticks(tg, 10);
    expect(opens()).toBe(2);
  });

  it("뜻이 바뀌면(다른 CLI) 곧바로 다시 연다", async () => {
    server("[conversation-in-chat-tile] this conversation is open in a chat tile");
    const tg = track(target());
    await ticks(tg, 3);
    await ticks({ ...tg, cli: "codex" }, 3);
    expect(opens()).toBe(2);
  });
});
