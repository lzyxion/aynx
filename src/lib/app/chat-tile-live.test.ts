import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Channel, invoke } from "$lib/ipc";
import type { ChatTileEvent, ChatTileSnapshot } from "$lib/chat-tile/chat-tile-api";
import type { ChatTileSpec, PaneSpec } from "$lib/session/spec";

// 실제 상태 모듈 · API 를 부른다 — 반응성 렌더링 대신 구독 수명 · 다시 세우기 · 명세 쓰기를 본다.
const state = vi.hoisted(() => {
  vi.stubGlobal("$state", <T>(value: T) => value);
  return { remote: false, handoff: new Set<string>(), panes: new Map<string, PaneSpec>() };
});
vi.mock("$lib/ipc", async (orig) => {
  const real = await orig<typeof import("$lib/ipc")>();
  return { ...real, get isRemote() { return state.remote; } };
});
vi.mock("$lib/tear", () => ({ isHandoff: (id: string) => state.handoff.has(id) }));
vi.mock("$lib/app/tabs.svelte.js", () => ({
  findPaneAnywhere: (id: string) => state.panes.get(id) ?? null,
  tabOfPane: (id: string) => (state.panes.has(id) ? { id: "tab-1" } : null),
  replaceTile: vi.fn(() => true),
}));
vi.mock("$lib/app/agent-sessions.svelte.js", () => ({ noteChatTileConversation: vi.fn(), unlinkAgentSession: vi.fn() }));
vi.mock("$lib/app/chat-tile-notify", () => ({ noteChatTileEvent: vi.fn() }));
vi.mock("$lib/app/agent-banners.svelte.js", () => ({ dropAgentBanner: vi.fn() }));

import { noteChatTileConversation, unlinkAgentSession } from "$lib/app/agent-sessions.svelte.js";
import { replaceTile } from "$lib/app/tabs.svelte.js";
import { chatTileBusy } from "$lib/app/chat-tile-busy";
import { noteChatTileEvent } from "$lib/app/chat-tile-notify";
import { dropAgentBanner } from "$lib/app/agent-banners.svelte.js";
import { chatTileStatusOf } from "$lib/app/chat-tile-status.svelte.js";
import {
  askMcpStatus,
  askRewind,
  chatTileModelNow,
  chatTileTierNow,
  chatTileTierOptions,
  goalChatTile,
  reviewChatTile,
  awaitingTurn,
  cancelRewind,
  changeRewindScope,
  confirmRewind,
  chatTileLiveOf,
  chatTileWorking,
  compactChatTile,
  decideChatTile,
  newChatInPlace,
  observeChatTile,
  releaseChatTile,
  retuneChatTile,
  sendChatTile,
  setChatTilePermMode,
  type ChatTileTarget,
} from "./chat-tile-live.svelte.js";

const CONV = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
let n = 0;
function target(over: Partial<ChatTileTarget> = {}): ChatTileTarget {
  n += 1;
  return { paneId: `pane-${n}`, chat: `ct-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, cli: "claude", model: "", effort: "", cwd: "C:/src/proj", conv: null, permMode: null, ...over };
}

type Sub = { channel: Channel<unknown>; gen: number };
let subs: Sub[] = [];
let seq = 0;
let gone = false;
let snapExtra: Partial<ChatTileSnapshot> = {};

function snap(chat: string): ChatTileSnapshot {
  return { chat, cli: "claude", model: "", effort: null, cwd: "C:/src/proj", epoch: 1, seq, status: "ready", conversationId: null, mcpServers: [], liveTurn: [], pending: [], ...snapExtra };
}

function server() {
  subs = []; seq = 0; gone = false; snapExtra = {};
  vi.mocked(invoke).mockImplementation(async (cmd, raw) => {
    const a = raw as { chat: string; channel: Channel<unknown>; subGen: number };
    switch (cmd) {
      case "chat_tile_subscribe": {
        if (gone) throw new Error("[session-gone] chat tile not found");
        const sub = { channel: a.channel, gen: subs.length + 1 };
        subs.push(sub);
        return { subGen: sub.gen, snapshot: snap(a.chat) };
      }
      case "chat_tile_open":
        gone = false;
        return snap(a.chat);
      case "chat_tile_send":
      case "chat_tile_rewind":
      case "chat_tile_review":
      case "chat_tile_goal_start":
      case "chat_tile_goal_stop":
        return { epoch: 1 };
      case "chat_tile_unsubscribe":
      case "chat_tile_close":
      case "chat_tile_set_model":
      case "chat_tile_set_effort":
      case "chat_tile_set_perm_mode":
      case "chat_tile_decide":
      case "chat_tile_compact":
      case "chat_tile_set_tier":
      case "chat_tile_mcp_status":
        return true;
      default:
        throw new Error(`unexpected invoke: ${cmd}`);
    }
  });
}

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, a]) => a as Record<string, unknown>);

function emit(sub: Sub, chat: string, ev: ChatTileEvent["ev"], s = ++seq) {
  sub.channel.onmessage({ chat, epoch: 1, seq: s, ev, subs: [{ conn: 1, window: "main", subGen: sub.gen }] });
}

const releases: (() => void)[] = [];
function observe(tg: ChatTileTarget) {
  const r = observeChatTile(tg);
  releases.push(r);
  return r;
}

afterEach(() => {
  for (const r of releases.splice(0)) r();
  state.remote = false;
  state.handoff.clear();
  state.panes.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(noteChatTileConversation).mockClear();
  vi.mocked(unlinkAgentSession).mockClear();
  vi.mocked(noteChatTileEvent).mockClear();
  vi.mocked(dropAgentBanner).mockClear();
  vi.mocked(replaceTile).mockClear();
});
afterAll(() => vi.unstubAllGlobals());

describe("붙기 — 서버 표에 없으면 다시 세운다", () => {
  it("subscribe → [session-gone] → open(fresh{cwd}) → subscribe", async () => {
    server();
    gone = true;
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(vi.mocked(invoke).mock.calls.map(([c]) => c)).toEqual(["chat_tile_subscribe", "chat_tile_open", "chat_tile_subscribe"]);
    expect(calls("chat_tile_open")[0]).toEqual({ chat: tg.chat, cli: "claude", model: "", effort: null, mode: { kind: "fresh", cwd: "C:/src/proj" }, permMode: null, tier: null });
    expect(calls("chat_tile_send")).toEqual([]);
  });

  it("conv 가 있으면 resume · 폴더가 비면 홈(null)", async () => {
    server();
    gone = true;
    const a = target({ conv: CONV });
    observe(a);
    await vi.waitFor(() => expect(chatTileLiveOf(a.chat)?.subGen).toBeTypeOf("number"));
    expect(calls("chat_tile_open")[0].mode).toEqual({ kind: "resume", conv: CONV });
    gone = true;
    const b = target({ cwd: "" });
    observe(b);
    await vi.waitFor(() => expect(chatTileLiveOf(b.chat)?.subGen).toBeTypeOf("number"));
    expect(calls("chat_tile_open")[1].mode).toEqual({ kind: "fresh", cwd: null });
  });

  it("open 이 실패하면 gone · 서버 글 그대로 error", async () => {
    server();
    gone = true;
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_open") throw new Error("[conversation-busy] conversation is open elsewhere");
      return base(cmd, a);
    });
    const tg = target({ conv: CONV });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.gone).toBe(true));
    expect(chatTileLiveOf(tg.chat)?.error).toBe("[conversation-busy] conversation is open elsewhere");
  });

  it("거절이 이어져도 open 을 되풀이하지 않는다 — 다시 여는 것은 사람의 보내기 · [다시 시도] 뿐", async () => {
    server();
    gone = true;
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_open") throw new Error("[conversation-in-side-chat] this conversation is held by a side chat");
      return base(cmd, a);
    });
    const tg = target({ conv: CONV });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.gone).toBe(true));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect([calls("chat_tile_open").length, calls("chat_tile_subscribe").length]).toEqual([1, 1]);
    expect(sendChatTile(tg, "안녕")).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    expect([calls("chat_tile_open").length, calls("chat_tile_send").length]).toEqual([2, 0]);
    expect(chatTileLiveOf(tg.chat)?.gone).toBe(true);
  });
});

describe("사건 — seq 빈틈 · 옛 통로", () => {
  it("빈틈이면 다시 구독하고 옛 subGen 을 푼다", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "textDelta", item: "a", text: "하나" });
    seq += 1; // 하나를 건너뛴다
    emit(subs[0], tg.chat, { t: "textDelta", item: "a", text: "셋" });
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(2));
    expect(calls("chat_tile_unsubscribe")).toEqual([{ chat: tg.chat, subGen: 1 }]);
    expect(chatTileLiveOf(tg.chat)?.seq).toBe(seq);
  });

  it("다시 구독한 뒤 옛 Channel 의 늦은 사건은 섞이지 않는다", async () => {
    server();
    const tg = target();
    const release = observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    release();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(2));
    emit(subs[0], tg.chat, { t: "textDelta", item: "x", text: "옛 통로" }, 1);
    expect(chatTileLiveOf(tg.chat)?.seq).toBe(0);
    emit(subs[1], tg.chat, { t: "textDelta", item: "x", text: "새 통로" }, 1);
    expect(chatTileLiveOf(tg.chat)?.state.entries).toEqual([expect.objectContaining({ kind: "text", text: "새 통로" })]);
  });

  it("권한 요청의 입력 · 바쁨 표 — 턴 중 · 카드 대기면 참", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(chatTileBusy(tg.paneId)).toBe(false);
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    expect(chatTileBusy(tg.paneId)).toBe(true);
    const input = { file_path: "C:/src/proj/a.ts", old_string: "a", new_string: "b" };
    emit(subs[0], tg.chat, { t: "permission", requestId: "r1", kind: "fileChange", title: "Edit", detail: "a.ts", toolName: "Edit", input });
    expect(chatTileLiveOf(tg.chat)?.permInputs).toEqual({ r1: input });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t1", outcome: "ok", message: null });
    expect(chatTileBusy(tg.paneId)).toBe(true); // 카드가 아직 기다린다
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" });
    expect(chatTileBusy(tg.paneId)).toBe(false);
  });
});

describe("대화 id — 턴이 선 뒤에만 · 메인 PC 창만", () => {
  it("ready 의 id 는 적지 않고 turnStarted 뒤에 적는다", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "ready", cli: "claude", version: "2.1", model: null, models: [], efforts: {}, conversationId: CONV });
    expect(noteChatTileConversation).not.toHaveBeenCalled();
    expect(chatTileLiveOf(tg.chat)?.historyConv).toBeNull();
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    expect(noteChatTileConversation).toHaveBeenCalledWith(tg.paneId, "claude", CONV);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t1", outcome: "ok", message: null });
    expect(chatTileLiveOf(tg.chat)?.historyConv).toBe(CONV);
  });

  it("원격 창은 연결 표 · 명세를 고치지 않는다", async () => {
    state.remote = true;
    server();
    const tg = target();
    const spec: ChatTileSpec = { chatId: tg.chat, cli: "claude", model: "", effort: "", cwd: tg.cwd };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: spec });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "ready", cli: "claude", version: null, model: null, models: [], efforts: {}, conversationId: CONV });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    expect(noteChatTileConversation).not.toHaveBeenCalled();
    expect(await retuneChatTile(tg, { model: "opus" })).toBe(true);
    expect(state.panes.get(tg.paneId)?.chat).toBe(spec);
    expect(spec.model).toBe("");
  });

  it("메인 PC 창의 모델 바꾸기는 명세를 새 객체로 갈음한다", async () => {
    server();
    const tg = target();
    const spec: ChatTileSpec = { chatId: tg.chat, cli: "claude", model: "", effort: "", cwd: tg.cwd };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: spec });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(await retuneChatTile(tg, { model: "opus", effort: "high" })).toBe(true);
    expect(calls("chat_tile_set_model")[0]).toEqual({ chat: tg.chat, epoch: 1, model: "opus" });
    expect(calls("chat_tile_set_effort")[0]).toEqual({ chat: tg.chat, epoch: 1, effort: "high" });
    const now = state.panes.get(tg.paneId)?.chat;
    expect(now).not.toBe(spec);
    expect(now).toEqual({ ...spec, model: "opus", effort: "high" });
  });
});

describe("보내기", () => {
  it("낙관 표시 뒤 지금 세대로 보낸다 · 빈 글은 보내지 않는다", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(sendChatTile(tg, "   ")).toBe(false);
    expect(sendChatTile(tg, "안녕")).toBe(true);
    expect(chatTileLiveOf(tg.chat)?.state.entries).toEqual([expect.objectContaining({ kind: "user", text: "안녕", accepted: false })]);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    const sent = calls("chat_tile_send")[0];
    expect(sent).toMatchObject({ chat: tg.chat, epoch: 1, text: "안녕" });
    expect(typeof sent.clientId).toBe("string");
  });

  it("보내기를 받은 순간부터 턴이 끝날 때까지 바쁨 — 띄우는 중 · 턴이 서기 전에도(닫기 물음 · 둘째 글 막기)", async () => {
    server();
    let release!: () => void;
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_send") await new Promise<void>((r) => (release = r)); // 서버가 CLI 를 띄우는 동안
      return base(cmd, a);
    });
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(chatTileBusy(tg.paneId)).toBe(false);
    expect(sendChatTile(tg, "첫 말")).toBe(true);
    expect(chatTileBusy(tg.paneId)).toBe(true);
    await vi.waitFor(() => expect(calls("chat_tile_send")).toHaveLength(1));
    release();
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    // 보내기는 끝났지만 턴은 아직 서지 않았다(Claude 는 몇 초)
    const l = chatTileLiveOf(tg.chat)!;
    expect(awaitingTurn(l.state)).toBe(true);
    expect(chatTileWorking(l)).toBe(true);
    expect(chatTileBusy(tg.paneId)).toBe(true);
    expect(sendChatTile(tg, "둘째 말")).toBe(false);
    emit(subs[0], tg.chat, { t: "userAccepted", clientId: null, text: "첫 말" });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    expect(chatTileBusy(tg.paneId)).toBe(true);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t1", outcome: "ok", message: null });
    expect(chatTileBusy(tg.paneId)).toBe(false);
    expect(awaitingTurn(chatTileLiveOf(tg.chat)!.state)).toBe(false);
  });

  it("보내기 실패 · 턴 전에 CLI 가 끝나면 바쁨이 풀린다", async () => {
    server();
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_send") throw new Error("[start-timeout] slow");
      return base(cmd, a);
    });
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(sendChatTile(tg, "a")).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    expect(chatTileBusy(tg.paneId)).toBe(false);

    vi.mocked(invoke).mockImplementation(base);
    expect(sendChatTile(tg, "b")).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    expect(chatTileBusy(tg.paneId)).toBe(true);
    emit(subs[0], tg.chat, { t: "exited", code: 1, reason: "exit" });
    expect(chatTileBusy(tg.paneId)).toBe(false);
  });
});

describe("모델 칩 · 끊긴 턴의 본 글", () => {
  it("칩은 고른 값(pick) — CLI 가 알린 실효 이름 · ready 의 모델로 바뀌지 않는다", async () => {
    server();
    snapExtra = { model: "haiku" };
    const tg = target({ model: "haiku" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(chatTileLiveOf(tg.chat)?.pick).toBe("haiku");
    emit(subs[0], tg.chat, { t: "ready", cli: "claude", version: "2.1.332", model: "claude-haiku-5-5", models: [], efforts: {}, conversationId: null });
    emit(subs[0], tg.chat, { t: "modelChanged", model: "claude-haiku-5-5" });
    expect(chatTileLiveOf(tg.chat)?.pick).toBe("haiku");
    expect(await retuneChatTile(tg, { model: "fable" })).toBe(true);
    expect(chatTileLiveOf(tg.chat)?.pick).toBe("fable");
  });

  it("끊긴 턴은 사람 말 · 흘러나온 글을 남긴다 — 끝난 턴 · 글 없는 끊김은 남기지 않는다", async () => {
    server();
    const tg = target({ cli: "codex" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    sendChatTile(tg, "1부터 2000까지");
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    emit(subs[0], tg.chat, { t: "textDelta", item: "m1", text: "1\n2\n" });
    emit(subs[0], tg.chat, { t: "textDelta", item: "m1", text: "3" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t1", outcome: "interrupted", message: null });
    expect(chatTileLiveOf(tg.chat)?.partials).toMatchObject([{ userText: "1부터 2000까지", texts: ["1\n2\n3"] }]);
    sendChatTile(tg, "OK");
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t2" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t2", outcome: "interrupted", message: null });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t3" });
    emit(subs[0], tg.chat, { t: "text", item: "m3", text: "끝" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t3", outcome: "ok", message: null });
    expect(chatTileLiveOf(tg.chat)?.partials).toHaveLength(1);
  });
});

describe("첨부 보내기", () => {
  it("그림은 images · 나머지는 files · 말풍선에 파일 이름", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    const shot = { path: "C:/data/attachments/aa/shot.png", name: "shot.png" };
    const code = { path: "C:/data/attachments/bb/main.ts", name: "main.ts" };
    expect(sendChatTile(tg, "이거 봐 줘", [shot, code])).toBe(true);
    expect(chatTileLiveOf(tg.chat)?.state.entries).toEqual([expect.objectContaining({ kind: "user", files: ["shot.png", "main.ts"] })]);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    expect(calls("chat_tile_send")[0]).toMatchObject({ text: "이거 봐 줘", images: [shot.path], files: [code.path] });
  });

  it("빈 글 + 첨부는 보낸다 · 빈 글 + 첨부 없음은 거짓", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(sendChatTile(tg, "  ", [])).toBe(false);
    expect(sendChatTile(tg, "", [{ path: "C:/data/attachments/cc/notes.md", name: "notes.md" }])).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    expect(calls("chat_tile_send")[0]).toMatchObject({ text: "", images: [], files: ["C:/data/attachments/cc/notes.md"] });
  });
});

describe("탭 점 · 알림 재료", () => {
  it("사건 적용은 noteChatTileEvent 를 부르고(대기 카드 앞뒤) · 스냅숏 반영은 부르지 않는다", async () => {
    server();
    snapExtra = { status: "running", pending: [{ t: "permission", requestId: "r0", kind: "command", title: "Bash", detail: "ls", toolName: "Bash" }] };
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(noteChatTileEvent).not.toHaveBeenCalled();
    expect(chatTileStatusOf(tg.paneId)).toBe("permission");
    emit(subs[0], tg.chat, { t: "permission", requestId: "r1", kind: "command", title: "Bash", detail: "pwd", toolName: "Bash" });
    expect(noteChatTileEvent).toHaveBeenLastCalledWith(tg.paneId, "claude", expect.objectContaining({ t: "permission", requestId: "r1" }), { pendingBefore: 1, pendingAfter: 2 });
  });

  it("실행 점 · 걷기에서 dropChatTileStatus · 배너 걷기", async () => {
    server();
    const tg = target();
    const release = observeChatTile(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(chatTileStatusOf(tg.paneId)).toBeNull();
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    expect(chatTileStatusOf(tg.paneId)).toBe("running");
    release();
    expect(chatTileStatusOf(tg.paneId)).toBeNull();
    expect(dropAgentBanner).toHaveBeenCalledWith(tg.paneId);
  });
});

describe("권한 모드 · 늘 허용 · 질문 답", () => {
  function mainSpec(tg: ChatTileTarget, over: Partial<ChatTileSpec> = {}): ChatTileSpec {
    const spec: ChatTileSpec = { chatId: tg.chat, cli: tg.cli, model: "", effort: "", cwd: tg.cwd, ...over };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: spec });
    return spec;
  }
  const specOf = (tg: ChatTileTarget) => state.panes.get(tg.paneId)?.chat;

  it("스냅숏 cliMode · permMode — 메인 PC 명세를 새 객체로 · 같으면 그대로", async () => {
    server();
    snapExtra = { permMode: "acceptEdits", cliMode: { mode: "acceptEdits", choices: ["default", "acceptEdits", "plan"] } };
    const tg = target();
    const spec = mainSpec(tg);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.cliMode).toEqual({ mode: "acceptEdits", choices: ["default", "acceptEdits", "plan"] });
    expect(l.permMode).toBe("acceptEdits");
    expect(specOf(tg)).not.toBe(spec);
    expect(specOf(tg)).toEqual({ ...spec, permMode: "acceptEdits" });
    const now = specOf(tg);
    emit(subs[0], tg.chat, { t: "cliMode", mode: "acceptEdits", choices: ["default", "acceptEdits", "plan"], chosen: "acceptEdits" });
    expect(specOf(tg)).toBe(now);
  });

  it("옛 서버 스냅숏(칸 없음)은 명세의 모드를 지우지 않는다 · 스냅숏 null 이면 지운다", async () => {
    server();
    const tg = target({ permMode: "plan" });
    const spec = mainSpec(tg, { permMode: "plan" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(specOf(tg)).toBe(spec);
    expect(chatTileLiveOf(tg.chat)?.permMode).toBe("plan");
    expect(chatTileLiveOf(tg.chat)?.cliMode).toBeNull();

    snapExtra = { permMode: null, cliMode: null };
    const tg2 = target({ permMode: "plan" });
    mainSpec(tg2, { permMode: "plan" });
    observe(tg2);
    await vi.waitFor(() => expect(chatTileLiveOf(tg2.chat)?.subGen).toBeTypeOf("number"));
    expect(specOf(tg2)).not.toHaveProperty("permMode");
  });

  it("사건 cliMode — chosen 이 있으면 명세 갈음 · 없으면 permMode 그대로 · 칩 밖 값은 명세에 쓰지 않는다", async () => {
    server();
    const tg = target();
    const spec = mainSpec(tg);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "cliMode", mode: "default", choices: ["default", "acceptEdits", "plan"] });
    expect(chatTileLiveOf(tg.chat)?.cliMode).toEqual({ mode: "default", choices: ["default", "acceptEdits", "plan"] });
    expect(chatTileLiveOf(tg.chat)?.permMode).toBeNull();
    expect(specOf(tg)).toBe(spec);
    emit(subs[0], tg.chat, { t: "cliMode", mode: "plan", choices: ["default", "acceptEdits", "plan"], chosen: "plan" });
    expect(chatTileLiveOf(tg.chat)?.permMode).toBe("plan");
    expect(specOf(tg)).toEqual({ ...spec, permMode: "plan" });
    expect(specOf(tg)).not.toBe(spec);
    emit(subs[0], tg.chat, { t: "cliMode", mode: "bypassPermissions", choices: ["default"], chosen: "bypassPermissions" });
    expect(specOf(tg)).not.toHaveProperty("permMode");
  });

  it("원격 창은 명세를 쓰지 않는다 — 사본만", async () => {
    state.remote = true;
    server();
    snapExtra = { permMode: "auto", cliMode: { mode: "auto", choices: ["readOnly", "auto", "plan"] } };
    const tg = target({ cli: "codex" });
    const spec = mainSpec(tg);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "cliMode", mode: "plan", choices: ["readOnly", "auto", "plan"], chosen: "plan" });
    expect(await setChatTilePermMode(tg, "readOnly")).toBe(true);
    expect(chatTileLiveOf(tg.chat)?.permMode).toBe("readOnly");
    expect(specOf(tg)).toBe(spec);
    expect(spec).not.toHaveProperty("permMode");
  });

  it("setChatTilePermMode — 거짓 답(표에만 적음)도 성공 · 명세 · 바쁨 표 · 칩 밖 값은 보내지 않는다", async () => {
    server();
    const base = vi.mocked(invoke).getMockImplementation()!;
    let busyDuring: boolean | undefined;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_set_perm_mode") {
        busyDuring = chatTileLiveOf((a as { chat: string }).chat)?.modeBusy;
        return false;
      }
      return base(cmd, a);
    });
    const tg = target();
    const spec = mainSpec(tg);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(await setChatTilePermMode(tg, "acceptEdits")).toBe(true);
    expect(busyDuring).toBe(true);
    expect(calls("chat_tile_set_perm_mode")).toEqual([{ chat: tg.chat, epoch: 1, mode: "acceptEdits" }]);
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ permMode: "acceptEdits", modeBusy: false });
    expect(specOf(tg)).toEqual({ ...spec, permMode: "acceptEdits" });
    for (const bad of ["bypassPermissions", "dontAsk", "readOnly", ""]) expect(await setChatTilePermMode(tg, bad)).toBe(false);
    expect(calls("chat_tile_set_perm_mode")).toHaveLength(1);
  });

  it("setChatTilePermMode — [stale-chat] 이면 다시 붙은 뒤 한 번 더 · 다른 실패는 error", async () => {
    server();
    const base = vi.mocked(invoke).getMockImplementation()!;
    let first = true;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_set_perm_mode") {
        if (first) {
          first = false;
          throw new Error("[stale-chat] old epoch");
        }
        if ((a as { mode: string }).mode === "plan") throw new Error("[bad-mode] this permission mode cannot be chosen here");
        return true;
      }
      return base(cmd, a);
    });
    const tg = target();
    mainSpec(tg);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(await setChatTilePermMode(tg, "acceptEdits")).toBe(true);
    expect(calls("chat_tile_set_perm_mode")).toHaveLength(2);
    expect(calls("chat_tile_subscribe")).toHaveLength(2);
    expect(await setChatTilePermMode(tg, "plan")).toBe(false);
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ permMode: "acceptEdits", modeBusy: false, error: "[bad-mode] this permission mode cannot be chosen here" });
    expect(specOf(tg)?.permMode).toBe("acceptEdits");
  });

  it("permSessions — 권한 사건 · 스냅숏 대기에서 쌓고 답하면 지운다", async () => {
    server();
    snapExtra = {
      pending: [{ t: "permission", requestId: "r0", kind: "tool", title: "Edit", detail: "a", toolName: "Edit", sessionAllow: { kind: "mode", detail: "acceptEdits" } }],
    };
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(chatTileLiveOf(tg.chat)?.permSessions).toEqual({ r0: { kind: "mode", detail: "acceptEdits" } });
    emit(subs[0], tg.chat, { t: "permission", requestId: "r1", kind: "tool", title: "Bash", detail: "x", toolName: "Bash", sessionAllow: { kind: "rules", detail: "npm test:*" } });
    emit(subs[0], tg.chat, { t: "permission", requestId: "r2", kind: "tool", title: "Read", detail: "y", toolName: "Read" });
    expect(Object.keys(chatTileLiveOf(tg.chat)!.permSessions).sort()).toEqual(["r0", "r1"]);
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" });
    expect(chatTileLiveOf(tg.chat)?.permSessions).toEqual({ r0: { kind: "mode", detail: "acceptEdits" } });
  });

  it("답이 닿으면 계획(본 글 · 결과 · 이 창의 고칠 점)과 이 창의 늘 허용 흔적을 남긴다 — 답 글은 담지 않는다", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    const plan = (id: string, text: string) =>
      emit(subs[0], tg.chat, { t: "permission", requestId: id, kind: "tool", title: "ExitPlanMode", detail: text, toolName: "ExitPlanMode", input: { plan: text, planFilePath: "C:/u/.claude/plans/p.md" } });
    plan("p1", "# 첫 계획");
    await decideChatTile(tg.chat, "p1", "deny", { message: "c 대신 d" });
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "p1", decision: "deny", by: "human" });
    plan("p2", "# 고친 계획");
    await decideChatTile(tg.chat, "p2", "allow");
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "p2", decision: "allow", by: "human" });
    plan("p3", "# 다른 창이 답함");
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "p3", decision: "deny", by: "human" });
    plan("p4", "# 거둬짐");
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "p4", decision: null, by: "cli" });
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.plans.map((p) => [p.plan, p.file, p.outcome, p.feedback])).toEqual([
      ["# 첫 계획", "C:/u/.claude/plans/p.md", "kept", "c 대신 d"],
      ["# 고친 계획", "C:/u/.claude/plans/p.md", "approved", null],
      ["# 다른 창이 답함", "C:/u/.claude/plans/p.md", "kept", null],
      ["# 거둬짐", "C:/u/.claude/plans/p.md", "cancelled", null],
    ]);
    expect(l.plans.every((p) => typeof p.at === "number")).toBe(true);
    // 늘 허용 — 이 창에서 누른 것만 · 보통 허용 · 다른 창의 답은 흔적 없음
    const ask = (id: string) =>
      emit(subs[0], tg.chat, { t: "permission", requestId: id, kind: "tool", title: "Bash", detail: "x", toolName: "Bash", sessionAllow: { kind: "rules", detail: "Bash(npm test:*)" } });
    ask("s1");
    await decideChatTile(tg.chat, "s1", "allowSession");
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "s1", decision: "allow", by: "human" });
    ask("s2");
    await decideChatTile(tg.chat, "s2", "allow");
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "s2", decision: "allow", by: "human" });
    ask("s3");
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "s3", decision: "allow", by: "human" });
    ask("q1");
    await decideChatTile(tg.chat, "q1", "answer", { answers: { "Which?": "Red" } });
    emit(subs[0], tg.chat, { t: "permissionResolved", requestId: "q1", decision: "allow", by: "human" });
    const after = chatTileLiveOf(tg.chat)!;
    expect(after.traces.map((x) => [x.requestId, x.allow])).toEqual([["s1", { kind: "rules", detail: "Bash(npm test:*)" }]]);
    expect(after.decided).toEqual({});
    expect(JSON.stringify(after.traces) + JSON.stringify(after.plans)).not.toContain("Red");
  });

  it("decideChatTile — 결정 낱말 · 글 · 답만 싣는다 · 다시 보내지 않는다", async () => {
    server();
    const tg = target();
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    await decideChatTile(tg.chat, "r1", "allow");
    await decideChatTile(tg.chat, "r2", "allowSession");
    await decideChatTile(tg.chat, "r3", "deny", { message: "x" });
    await decideChatTile(tg.chat, "r4", "answer", { answers: { "Which color?": "Red" } });
    expect(calls("chat_tile_decide")).toEqual([
      { chat: tg.chat, epoch: 1, requestId: "r1", decision: "allow", message: null, answers: null },
      { chat: tg.chat, epoch: 1, requestId: "r2", decision: "allowSession", message: null, answers: null },
      { chat: tg.chat, epoch: 1, requestId: "r3", decision: "deny", message: "x", answers: null },
      { chat: tg.chat, epoch: 1, requestId: "r4", decision: "answer", message: null, answers: { "Which color?": "Red" } },
    ]);
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_decide") throw new Error("[no-session-allow] x");
      return base(cmd, a);
    });
    await decideChatTile(tg.chat, "r5", "allowSession");
    expect(calls("chat_tile_decide")).toHaveLength(5);
    expect(chatTileLiveOf(tg.chat)?.error).toBe("[no-session-allow] x");
  });

  it("다시 세우기(open)에 명세의 permMode 를 싣는다", async () => {
    server();
    gone = true;
    const tg = target({ cli: "codex", permMode: "plan" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(calls("chat_tile_open")[0]).toMatchObject({ cli: "codex", permMode: "plan" });
  });
});

describe("놓기", () => {
  it("이관 중이면 구독만 푼다 — 서버 close · 연결 풀기 없음", async () => {
    server();
    const tg = target();
    const release = observeChatTile(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    state.handoff.add(tg.paneId);
    release();
    releaseChatTile(tg, true);
    expect(calls("chat_tile_unsubscribe")).toEqual([{ chat: tg.chat, subGen: 1 }]);
    expect(calls("chat_tile_close")).toEqual([]);
    expect(unlinkAgentSession).not.toHaveBeenCalled();
    expect(chatTileLiveOf(tg.chat)).toBeNull();
  });

  it("원격 창의 닫기도 구독만 푼다", async () => {
    state.remote = true;
    server();
    const tg = target();
    const release = observeChatTile(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    releaseChatTile(tg, true);
    release();
    expect(calls("chat_tile_close")).toEqual([]);
    expect(calls("chat_tile_unsubscribe")).toEqual([{ chat: tg.chat, subGen: 1 }]);
  });

  it("메인 PC 창에서 사람이 닫으면 서버 close + 연결 풀기 + 사본 지우기", async () => {
    server();
    const tg = target();
    const release = observeChatTile(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    expect(chatTileBusy(tg.paneId)).toBe(true);
    releaseChatTile(tg, true);
    release();
    expect(calls("chat_tile_close")).toEqual([{ chat: tg.chat }]);
    expect(unlinkAgentSession).toHaveBeenCalledWith(tg.paneId);
    expect(chatTileLiveOf(tg.chat)).toBeNull();
    expect(chatTileBusy(tg.paneId)).toBe(false);
  });
});

describe("`/` 메뉴 재료 · 맥락 사용량 · 압축", () => {
  const COMMANDS = { commands: [{ name: "compact", description: "Free up context", hint: "<instructions>", kind: "builtin" as const, aliases: [] }], terminal: ["doctor"] };

  it("스냅숏의 셋을 받는다 · 처음엔 셋 다 null", async () => {
    server();
    const empty = target({ cwd: "C:/src/snap-empty" });
    observe(empty);
    await vi.waitFor(() => expect(chatTileLiveOf(empty.chat)?.subGen).toBe(1));
    expect(chatTileLiveOf(empty.chat)).toMatchObject({ commands: null, context: null, lastCompaction: null, compactBusy: false });
    snapExtra = {
      commands: COMMANDS,
      context: { used: 36149, window: 1000000, source: "turn" },
      lastCompaction: { trigger: "manual", preTokens: 36241, postTokens: 8335 },
    };
    const tg = target({ cwd: "C:/src/snap-full" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBeTypeOf("number"));
    expect(chatTileLiveOf(tg.chat)).toMatchObject({
      commands: COMMANDS,
      context: { used: 36149, window: 1000000, source: "turn" },
      lastCompaction: { trigger: "manual", preTokens: 36241, postTokens: 8335 },
    });
  });

  it("사건 셋 · 꼬리에는 압축 알림만", async () => {
    server();
    const tg = target({ cwd: "C:/src/events" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "commands", ...COMMANDS });
    emit(subs[0], tg.chat, { t: "contextUsage", used: 4800, window: null, source: "tokenUsage" });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    emit(subs[0], tg.chat, { t: "compaction", phase: "started", trigger: "manual", preTokens: null, postTokens: null });
    expect(chatTileLiveOf(tg.chat)?.lastCompaction).toBeNull();
    emit(subs[0], tg.chat, { t: "compaction", phase: "done", trigger: "manual", preTokens: 36241, postTokens: 8335 });
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.commands).toEqual(COMMANDS);
    expect(l.context).toEqual({ used: 4800, window: null, source: "tokenUsage" });
    expect(l.lastCompaction).toEqual({ trigger: "manual", preTokens: 36241, postTokens: 8335 });
    expect(l.state.entries).toEqual([expect.objectContaining({ kind: "notice", code: "compacted", detail: "36241>8335" })]);
    // 다음 턴이 꼬리를 걷어도 압축 끝 줄은 타일이 떠 있는 동안 남는다
    expect(l.compactions).toEqual([expect.objectContaining({ detail: "36241>8335" })]);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    const m = chatTileLiveOf(tg.chat)!;
    expect(m.state.entries.some((e) => e.kind === "notice" && e.code === "compacted")).toBe(false);
    expect(m.compactions.map((c) => c.detail)).toEqual(["36241>8335"]);
  });

  it("캐시 — 같은 cli + cwd 의 새 항목이 목록을 받고 · 다른 cwd · 다른 cli 는 아니다", async () => {
    server();
    const a = target({ cwd: "C:\\src\\cache\\" });
    observe(a);
    await vi.waitFor(() => expect(chatTileLiveOf(a.chat)?.subGen).toBe(1));
    emit(subs[0], a.chat, { t: "commands", ...COMMANDS });
    const b = target({ cwd: "c:/src/cache" });
    observe(b);
    await vi.waitFor(() => expect(chatTileLiveOf(b.chat)?.subGen).toBe(2));
    expect(chatTileLiveOf(b.chat)?.commands).toEqual(COMMANDS);
    const other = target({ cwd: "C:/src/cache-other" });
    observe(other);
    await vi.waitFor(() => expect(chatTileLiveOf(other.chat)?.subGen).toBe(3));
    expect(chatTileLiveOf(other.chat)?.commands).toBeNull();
    snapExtra = { cli: "codex" };
    const codex = target({ cli: "codex", cwd: "C:/src/cache" });
    observe(codex);
    await vi.waitFor(() => expect(chatTileLiveOf(codex.chat)?.subGen).toBe(4));
    expect(chatTileLiveOf(codex.chat)?.commands).toBeNull();
  });

  it("compactChatTile — 바쁨 → turnStarted 에 풂 · chatTileWorking 이 본다 · 빈 지침은 null", async () => {
    server();
    const tg = target({ cwd: "C:/src/compact" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    expect(await compactChatTile(tg, "  ")).toBe(true);
    expect(calls("chat_tile_compact")).toEqual([{ chat: tg.chat, epoch: 1, instructions: null }]);
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.compactBusy).toBe(true);
    expect(chatTileWorking(l)).toBe(true);
    expect(chatTileBusy(tg.paneId)).toBe(true);
    // 바쁜 동안은 다시 보내지 않는다
    expect(await compactChatTile(tg, "x")).toBe(false);
    expect(sendChatTile(tg, "안녕")).toBe(false);
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    expect(chatTileLiveOf(tg.chat)?.compactBusy).toBe(false);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    expect(chatTileWorking(chatTileLiveOf(tg.chat)!)).toBe(false);
    expect(await compactChatTile(tg, "인증 흐름만")).toBe(true);
    expect(calls("chat_tile_compact")[1]).toEqual({ chat: tg.chat, epoch: 1, instructions: "인증 흐름만" });
  });

  it("턴이 서지 않으면 잠시 뒤 바쁨을 푼다", async () => {
    server();
    const tg = target({ cwd: "C:/src/compact-wait" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    vi.useFakeTimers();
    try {
      expect(await compactChatTile(tg)).toBe(true);
      expect(chatTileLiveOf(tg.chat)?.compactBusy).toBe(true);
      vi.advanceTimersByTime(10_000);
      expect(chatTileLiveOf(tg.chat)?.compactBusy).toBe(false);
      expect(chatTileBusy(tg.paneId)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("실패 → error · 바쁨 풂 · [stale-chat] 뒤 한 번 더", async () => {
    server();
    const tg = target({ cwd: "C:/src/compact-fail" });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_compact") throw new Error("[not-started] the CLI is not running — send a message first");
      return base(cmd, a);
    });
    expect(await compactChatTile(tg)).toBe(false);
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ compactBusy: false, error: "[not-started] the CLI is not running — send a message first" });
    let stale = true;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_compact" && stale) {
        stale = false;
        throw new Error("[stale-chat] old epoch");
      }
      return base(cmd, a);
    });
    expect(await compactChatTile(tg)).toBe(true);
    expect(calls("chat_tile_compact").length).toBe(3);
    expect(chatTileLiveOf(tg.chat)?.error).toBeNull();
  });

  it("sendChatTile 의 skills — Codex 는 싣고 · Claude 는 [] · 경로 없음", async () => {
    server();
    snapExtra = { cli: "codex" };
    const codex = target({ cli: "codex", cwd: "C:/src/skills" });
    observe(codex);
    await vi.waitFor(() => expect(chatTileLiveOf(codex.chat)?.subGen).toBe(1));
    expect(sendChatTile(codex, "$docx 표", [], ["docx"])).toBe(true);
    await vi.waitFor(() => expect(calls("chat_tile_send")).toHaveLength(1));
    expect(calls("chat_tile_send")[0]).toMatchObject({ text: "$docx 표", skills: ["docx"] });
    snapExtra = {};
    const claude = target({ cwd: "C:/src/skills-claude" });
    observe(claude);
    await vi.waitFor(() => expect(chatTileLiveOf(claude.chat)?.subGen).toBe(2));
    expect(sendChatTile(claude, "/docs 표", [], ["docs"])).toBe(true);
    await vi.waitFor(() => expect(calls("chat_tile_send")).toHaveLength(2));
    expect(calls("chat_tile_send")[1]).toMatchObject({ text: "/docs 표", skills: [] });
  });

  it("newChatInPlace — 새 chatId · 같은 cli/model/effort/cwd · permMode · conv 없음 · 일하는 중이면 false", async () => {
    server();
    const tg = target({ cli: "codex", model: "gpt-5", effort: "high", cwd: "C:/src/new", conv: CONV, permMode: "plan" });
    snapExtra = { cli: "codex" };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: { chatId: tg.chat, cli: "codex", model: "gpt-5", effort: "high", cwd: "C:/src/new", conv: CONV, permMode: "plan" } });
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    expect(newChatInPlace(tg)).toBe(false);
    expect(replaceTile).not.toHaveBeenCalled();
    emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    // 원격 창은 명세를 쓰지 않는다 — 스스로 거절한다
    state.remote = true;
    try {
      expect(newChatInPlace(tg)).toBe(false);
    } finally {
      state.remote = false;
    }
    expect(replaceTile).not.toHaveBeenCalled();
    expect(newChatInPlace(tg)).toBe(true);
    const [tabId, paneId, pane] = vi.mocked(replaceTile).mock.calls[0];
    expect([tabId, paneId]).toEqual(["tab-1", tg.paneId]);
    expect(pane.kind).toBe("chat");
    expect(pane.id).not.toBe(tg.paneId);
    expect(pane.chat).toEqual({ chatId: expect.stringMatching(/^ct-/), cli: "codex", model: "gpt-5", effort: "high", cwd: "C:/src/new" });
    expect(pane.chat?.chatId).not.toBe(tg.chat);
    // 잎이 없으면(다른 창 · 닫힘) 아무것도 안 한다
    expect(newChatInPlace(target())).toBe(false);
  });
});

describe("되감기 — 묻기 · 미리 보기 · 실행 · 흔적", () => {
  const A = "30b5bc5c-33b6-47d1-802c-c06d0d28a93a";
  const OTHER = "a3bb189e-8bf9-4888-9912-ace4e6543002";
  type RewindEv = Extract<ChatTileEvent["ev"], { t: "rewind" }>;
  const rw = (phase: RewindEv["phase"], scope: RewindEv["scope"], over: Partial<RewindEv> = {}): RewindEv => ({
    t: "rewind",
    phase,
    anchor: A,
    scope,
    can: phase !== "failed",
    files: [],
    moreFiles: 0,
    insertions: null,
    deletions: null,
    turns: null,
    skippedLinks: null,
    error: null,
    ...over,
  });
  const req = (over: Partial<Parameters<typeof askRewind>[1]> = {}) => ({ anchor: A, text: "고쳐 줘\n둘째 줄", localTurns: 2, localFiles: null, ...over });
  const rewinds = () => calls("chat_tile_rewind");

  async function opened(over: Partial<ChatTileTarget> = {}, extra: Partial<ChatTileSnapshot> = {}) {
    server();
    snapExtra = extra;
    const tg = target(over);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    return tg;
  }

  it("스냅숏 rewind · rewindGen — 처음 null · 0 · 작은 값으로 줄지 않는다", async () => {
    const empty = await opened({ cwd: "C:/src/rw-empty" });
    expect(chatTileLiveOf(empty.chat)).toMatchObject({ rewindCaps: null, rewindGen: 0, rewindAsk: null, rewinds: [], composerFill: null });
    const tg = await opened({ cwd: "C:/src/rw-snap" }, { rewind: { files: true, conversation: true }, rewindGen: 3 });
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ rewindCaps: { files: true, conversation: true }, rewindGen: 3 });
    snapExtra = { rewind: { files: false, conversation: true }, rewindGen: 1 };
    // 빈틈 → 다시 붙기 — 스냅숏의 작은 gen 은 받지 않는다
    emit(subs[0], tg.chat, { t: "text", item: null, text: "x" }, seq + 5);
    await vi.waitFor(() => expect(subs.length).toBe(2));
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.rewindCaps).toEqual({ files: false, conversation: true }));
    expect(chatTileLiveOf(tg.chat)?.rewindGen).toBe(3);
    emit(subs[1], tg.chat, { t: "rewindCaps", files: true, conversation: false });
    expect(chatTileLiveOf(tg.chat)?.rewindCaps).toEqual({ files: true, conversation: false });
  });

  it("Claude 기본 both → 미리 보기 op(dryRun) · 카드 loading · 몸에는 다섯 칸뿐", async () => {
    const tg = await opened({ cwd: "C:/src/rw-ask" });
    expect(askRewind(tg, req())).toBe(true);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(1));
    expect(rewinds()[0]).toEqual({ chat: tg.chat, epoch: 1, anchor: A, scope: "both", dryRun: true });
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ anchor: A, scope: "both", quote: "고쳐 줘", text: "고쳐 줘\n둘째 줄", phase: "loading", preview: null, error: null });
    // 카드가 이미 있으면 또 묻지 않는다
    expect(askRewind(tg, req())).toBe(false);
    expect(chatTileWorking(chatTileLiveOf(tg.chat)!)).toBe(false);
  });

  it("범위 — 파일 캡 없으면 Claude 는 conversation · Codex 는 늘 conversation · 범위 없음 → false · 고른 범위가 없으면 기본", async () => {
    const a = await opened({ cwd: "C:/src/rw-scope-a" }, { rewind: { files: false, conversation: true } });
    expect(askRewind(a, req())).toBe(true);
    expect(chatTileLiveOf(a.chat)?.rewindAsk?.scope).toBe("conversation");
    const b = await opened({ cli: "codex", cwd: "C:/src/rw-scope-b" }, { cli: "codex" });
    expect(askRewind(b, req({ scope: "both" }))).toBe(true);
    expect(chatTileLiveOf(b.chat)?.rewindAsk?.scope).toBe("conversation");
    const c = await opened({ cwd: "C:/src/rw-scope-c" }, { rewind: { files: false, conversation: false } });
    expect(askRewind(c, req())).toBe(false);
    const d = await opened({ cwd: "C:/src/rw-scope-d" });
    expect(askRewind(d, req({ scope: "files" }))).toBe(true);
    expect(chatTileLiveOf(d.chat)?.rewindAsk?.scope).toBe("files");
    await vi.waitFor(() => expect(rewinds().map((x) => x.scope)).toEqual(["conversation", "conversation", "files"]));
  });

  it("일하는 중이면 묻지 않는다", async () => {
    const tg = await opened({ cwd: "C:/src/rw-busy" });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    expect(askRewind(tg, req())).toBe(false);
    expect(rewinds()).toEqual([]);
  });

  it("다른 창의 미리 보기 → 카드 없음 · 같은 기준점 · 범위 preview{can:true} → ready → 실행(dryRun:false) · applying 은 일하는 중", async () => {
    const tg = await opened({ cwd: "C:/src/rw-flow" });
    emit(subs[0], tg.chat, rw("preview", "both", { files: ["src/a.ts"] }));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toBeNull();
    expect(confirmRewind(tg)).toBe(false);
    askRewind(tg, req());
    await vi.waitFor(() => expect(rewinds()).toHaveLength(1));
    // 다른 기준점 · 다른 범위의 미리 보기는 버린다
    emit(subs[0], tg.chat, rw("preview", "both", { anchor: OTHER }));
    emit(subs[0], tg.chat, rw("preview", "files"));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk?.phase).toBe("loading");
    expect(confirmRewind(tg)).toBe(false);
    emit(subs[0], tg.chat, rw("preview", "both", { files: ["src/a.ts", "README.md"], insertions: 12, deletions: 3 }));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "ready", preview: { files: ["src/a.ts", "README.md"] }, error: null });
    expect(confirmRewind(tg)).toBe(true);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    expect(rewinds()[1]).toEqual({ chat: tg.chat, epoch: 1, anchor: A, scope: "both", dryRun: false });
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.rewindAsk?.phase).toBe("applying");
    expect(chatTileWorking(l)).toBe(true);
    expect(chatTileBusy(tg.paneId)).toBe(true);
    expect(sendChatTile(tg, "안녕")).toBe(false);
    // 실행 중에는 닫지 않고 · 두 번 보내지 않는다
    cancelRewind(tg.chat);
    expect(confirmRewind(tg)).toBe(false);
    expect(chatTileLiveOf(tg.chat)?.rewindAsk?.phase).toBe("applying");
    expect(rewinds()).toHaveLength(2);
  });

  it("can:false 면 실행 없음 · 미리 보기가 끝나기 전에도 없음", async () => {
    const tg = await opened({ cwd: "C:/src/rw-cannot" });
    askRewind(tg, req({ scope: "files" }));
    expect(confirmRewind(tg)).toBe(false);
    emit(subs[0], tg.chat, rw("preview", "files", { can: false, error: "No file checkpoint found for this message." }));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "ready", preview: { can: false }, error: null });
    expect(confirmRewind(tg)).toBe(false);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(1));
    expect(rewinds().every((x) => x.dryRun === true)).toBe(true);
  });

  it("범위를 바꾸면 미리 보기를 다시 — 옛 범위의 미리 보기로는 실행하지 않는다", async () => {
    const tg = await opened({ cwd: "C:/src/rw-change" });
    askRewind(tg, req());
    // loading 중에는 바꾸지 않는다(서버가 [rewind-running] 으로 거절한다)
    expect(changeRewindScope(tg, "files")).toBe(false);
    emit(subs[0], tg.chat, rw("preview", "both", { files: ["a"] }));
    expect(changeRewindScope(tg, "both")).toBe(false);
    expect(changeRewindScope(tg, "conversation")).toBe(true);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    expect(rewinds()[1]).toMatchObject({ scope: "conversation", dryRun: true });
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ scope: "conversation", phase: "loading", preview: null });
    expect(confirmRewind(tg)).toBe(false);
    // 늦게 온 옛 범위 답은 버린다
    emit(subs[0], tg.chat, rw("preview", "both", { files: ["a"] }));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk?.phase).toBe("loading");
    emit(subs[0], tg.chat, rw("preview", "conversation"));
    expect(confirmRewind(tg)).toBe(true);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(3));
    expect(rewinds()[2]).toMatchObject({ scope: "conversation", dryRun: false });
  });

  it("done{files} → 흔적 · rewindGen 그대로 · 입력 칸 넣기 없음 · 카드 닫힘", async () => {
    const tg = await opened({ cwd: "C:/src/rw-files" }, { context: { used: 10, window: 100, source: "turn" } });
    askRewind(tg, req({ scope: "files" }));
    emit(subs[0], tg.chat, rw("preview", "files", { files: ["a", "b"], moreFiles: 1 }));
    confirmRewind(tg);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    emit(subs[0], tg.chat, rw("done", "files", { skippedLinks: 0 }));
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.rewindAsk).toBeNull();
    expect(l.rewinds).toEqual([expect.objectContaining({ scope: "files", quote: "고쳐 줘", files: 3, skippedLinks: 0 })]);
    expect(l.rewindGen).toBe(0);
    expect(l.context).toEqual({ used: 10, window: 100, source: "turn" });
    expect(l.composerFill).toBeNull();
    expect(chatTileWorking(l)).toBe(false);
  });

  it("done{conversation} → rewindGen+1 · 맥락 · 마지막 압축 비움 · 물은 창만 입력 칸 넣기(보내지 않음)", async () => {
    const tg = await opened(
      { cli: "codex", cwd: "C:/src/rw-convo" },
      { cli: "codex", rewindGen: 2, context: { used: 10, window: 100, source: "turn" }, lastCompaction: { trigger: "manual", preTokens: 9, postTokens: 1 } },
    );
    askRewind(tg, req());
    emit(subs[0], tg.chat, rw("preview", "conversation", { turns: 4 }));
    confirmRewind(tg);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    emit(subs[0], tg.chat, rw("done", "conversation", { turns: 4 }));
    const l = chatTileLiveOf(tg.chat)!;
    expect(l).toMatchObject({ rewindGen: 3, context: null, lastCompaction: null, rewindAsk: null, composerFill: { text: "고쳐 줘\n둘째 줄", gen: 3 } });
    expect(l.rewinds).toEqual([expect.objectContaining({ scope: "conversation", quote: "고쳐 줘", turns: 4 })]);
    expect(calls("chat_tile_send")).toEqual([]);
    // 다른 창의 대화 되감기 — 흔적 · 다시 읽기만, 입력 칸은 건드리지 않는다
    const other = await opened({ cli: "codex", cwd: "C:/src/rw-other" }, { cli: "codex" });
    emit(subs[0], other.chat, rw("done", "conversation"));
    const o = chatTileLiveOf(other.chat)!;
    expect(o).toMatchObject({ rewindGen: 1, composerFill: null });
    expect(o.rewinds).toEqual([expect.objectContaining({ scope: "conversation", quote: "", files: null })]);
  });

  it("both — 파일 뒤 대화까지 끝나면 흔적 하나(both) · gen+1", async () => {
    const tg = await opened({ cwd: "C:/src/rw-both" });
    askRewind(tg, req());
    emit(subs[0], tg.chat, rw("preview", "both", { files: ["a"] }));
    confirmRewind(tg);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    emit(subs[0], tg.chat, rw("done", "files", { skippedLinks: 1 }));
    let l = chatTileLiveOf(tg.chat)!;
    expect(l.rewindAsk).toMatchObject({ phase: "applying", filesDone: true });
    expect(l.rewinds).toEqual([]);
    emit(subs[0], tg.chat, rw("done", "conversation"));
    l = chatTileLiveOf(tg.chat)!;
    expect(l.rewindAsk).toBeNull();
    expect(l.rewinds).toEqual([expect.objectContaining({ scope: "both", files: 1, skippedLinks: 1 })]);
    expect(l.rewindGen).toBe(1);
    expect(l.composerFill).toEqual({ text: "고쳐 줘\n둘째 줄", gen: 1 });
  });

  it("both — 파일만 되고 대화가 실패하면 반쪽 실패로 말한다 · 파일 흔적 · gen 그대로 · 다시 실행 없음", async () => {
    const tg = await opened({ cwd: "C:/src/rw-partial" });
    askRewind(tg, req());
    emit(subs[0], tg.chat, rw("preview", "both", { files: ["a", "b"] }));
    confirmRewind(tg);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    emit(subs[0], tg.chat, rw("done", "files", { skippedLinks: 0 }));
    emit(subs[0], tg.chat, rw("failed", "conversation", { error: "stale_target" }));
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.rewindAsk).toMatchObject({ phase: "ready", preview: null, filesDone: true, error: "stale_target" });
    expect(l.rewinds).toEqual([expect.objectContaining({ scope: "files", files: 2 })]);
    expect(l.rewindGen).toBe(0);
    expect(confirmRewind(tg)).toBe(false);
    expect(rewinds()).toHaveLength(2);
  });

  it("failed → error(CLI 글 · 없으면 [rewind-failed]) · 다른 기준점의 failed 는 버림", async () => {
    const tg = await opened({ cli: "codex", cwd: "C:/src/rw-failed" }, { cli: "codex" });
    askRewind(tg, req());
    emit(subs[0], tg.chat, rw("preview", "conversation"));
    confirmRewind(tg);
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    emit(subs[0], tg.chat, rw("failed", "conversation", { anchor: OTHER, error: "x" }));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk?.phase).toBe("applying");
    emit(subs[0], tg.chat, rw("failed", "conversation", { error: "thread/revert only supports paginated threads" }));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "ready", preview: null, error: "thread/revert only supports paginated threads" });
    cancelRewind(tg.chat);
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toBeNull();
    askRewind(tg, req());
    emit(subs[0], tg.chat, rw("failed", "conversation"));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk?.error).toBe("[rewind-failed]");
  });

  it("30초 안에 사건이 없으면 [rewind-timeout] — 실행 쪽은 미리 보기를 버린다(다시 보내지 않는다)", async () => {
    const tg = await opened({ cwd: "C:/src/rw-timeout" });
    vi.useFakeTimers();
    try {
      askRewind(tg, req({ scope: "files" }));
      await vi.waitFor(() => expect(rewinds()).toHaveLength(1));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      vi.advanceTimersByTime(30_000);
      expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "ready", error: "[rewind-timeout]" });
      expect(changeRewindScope(tg, "files")).toBe(true);
      emit(subs[0], tg.chat, rw("preview", "files", { files: ["a"] }));
      expect(confirmRewind(tg)).toBe(true);
      await vi.waitFor(() => expect(rewinds()).toHaveLength(3));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      vi.advanceTimersByTime(30_000);
      expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "ready", error: "[rewind-timeout]", preview: null });
      expect(confirmRewind(tg)).toBe(false);
      expect(chatTileWorking(chatTileLiveOf(tg.chat)!)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turnStarted · 스냅숏 running → [turn-running] · 카드는 열린 채 실행 없음", async () => {
    const tg = await opened({ cwd: "C:/src/rw-turn" });
    askRewind(tg, req({ scope: "files" }));
    emit(subs[0], tg.chat, rw("preview", "files", { files: ["a"] }));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "ready", preview: null, error: "[turn-running]" });
    expect(confirmRewind(tg)).toBe(false);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    cancelRewind(tg.chat);
    askRewind(tg, req({ scope: "files" }));
    snapExtra = { status: "running" };
    emit(subs[0], tg.chat, { t: "text", item: null, text: "x" }, seq + 5);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.rewindAsk?.error).toBe("[turn-running]"));
  });

  it("미리 보기 뒤 프로세스 세대가 바뀌면 그 미리 보기로 실행하지 않는다", async () => {
    const tg = await opened({ cwd: "C:/src/rw-epoch" });
    askRewind(tg, req({ scope: "files" }));
    emit(subs[0], tg.chat, rw("preview", "files", { files: ["a"] }));
    subs[0].channel.onmessage({ chat: tg.chat, epoch: 2, seq: ++seq, ev: { t: "ready", model: null, conversationId: null } as unknown as ChatTileEvent["ev"] });
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ preview: null, error: "[preview-first]" });
    expect(confirmRewind(tg)).toBe(false);
  });

  it("미리 보기 [stale-chat] → 다시 붙은 뒤 한 번 더 · 실행은 다시 보내지 않는다", async () => {
    const tg = await opened({ cwd: "C:/src/rw-stale" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    let stale = 1;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_rewind" && stale > 0) {
        stale -= 1;
        throw new Error("[stale-chat] old epoch");
      }
      return base(cmd, a);
    });
    askRewind(tg, req({ scope: "files" }));
    await vi.waitFor(() => expect(rewinds()).toHaveLength(2));
    expect(rewinds().map((x) => x.dryRun)).toEqual([true, true]);
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ phase: "loading", error: null });
    emit(subs[subs.length - 1], tg.chat, rw("preview", "files", { files: ["a"] }));
    stale = 1;
    expect(confirmRewind(tg)).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.rewindAsk?.phase).toBe("ready"));
    expect(rewinds().map((x) => x.dryRun)).toEqual([true, true, false]);
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ preview: null, error: "[stale-chat] old epoch" });
  });

  it("미리 보기 op 실패 → error · ready · 실행 없음", async () => {
    const tg = await opened({ cwd: "C:/src/rw-opfail" });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_rewind") throw new Error("[nothing-to-rewind] no turn has finished in this conversation yet");
      return base(cmd, a);
    });
    askRewind(tg, req({ scope: "files" }));
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.rewindAsk?.phase).toBe("ready"));
    expect(chatTileLiveOf(tg.chat)?.rewindAsk).toMatchObject({ preview: null, error: "[nothing-to-rewind] no turn has finished in this conversation yet" });
    expect(confirmRewind(tg)).toBe(false);
  });

  it("압축을 안 뒤 물으면 compacted", async () => {
    const tg = await opened({ cwd: "C:/src/rw-compacted" }, { lastCompaction: { trigger: "manual", preTokens: 9, postTokens: 1 } });
    askRewind(tg, req());
    expect(chatTileLiveOf(tg.chat)?.rewindAsk?.compacted).toBe(true);
  });
});

describe("검토 · 목표 · 속도 · MCP 상태", () => {
  const TIERS = { byModel: { "gpt-6.2-sol": [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }], "gpt-mini": [] }, thread: "default" };
  const GOAL = { objective: "모든 시험이 지날 때까지", status: "active", tokensUsed: 81230, tokenBudget: 500000, secondsUsed: 312, auto: false };

  async function opened(over: Partial<ChatTileTarget> = {}, extra: Partial<ChatTileSnapshot> = {}) {
    server();
    snapExtra = extra;
    const tg = target(over);
    observe(tg);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.subGen).toBe(1));
    return tg;
  }
  const codex = (over: Partial<ChatTileTarget> = {}, extra: Partial<ChatTileSnapshot> = {}) => opened({ cli: "codex", ...over }, { cli: "codex", ...extra });

  it("스냅숏 넷 — 처음엔 null · 칸째 다시 짓는다(허용 칸 밖은 버린다)", async () => {
    const empty = await codex();
    expect(chatTileLiveOf(empty.chat)).toMatchObject({ mcpStatus: null, goal: null, tiers: null, tier: null, reviewBusy: false, mcpAsk: null });
    const tg = await codex(
      {},
      {
        mcpStatus: {
          source: "init",
          stale: true,
          servers: [{ name: "aynx-sessions", state: "connected", auth: null, tools: 14, scope: "app", aynx: true, picked: false, url: "https://SECRET" } as never],
        },
        goal: { ...GOAL, threadId: "T" } as never,
        tier: "priority",
        tiers: TIERS,
      },
    );
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.mcpStatus).toEqual({ source: "init", stale: true, servers: [{ name: "aynx-sessions", state: "connected", auth: null, tools: 14, scope: "app", aynx: true }] });
    expect(l.goal).toEqual(GOAL);
    expect(l.tier).toBe("priority");
    expect(l.tiers).toEqual(TIERS);
    expect(chatTileTierOptions(l)).toEqual([]);
    l.pick = "gpt-6.2-sol";
    expect(chatTileTierOptions(l).map((x) => x.id)).toEqual(["priority"]);
  });

  it("다시 붙은 뒤 — CLI 기본 모델의 등급도 스냅숏 cliModel 로 그대로 · 턴이 지나도 · 사건 ready 도 열쇠", async () => {
    const tg = await codex({ cwd: "C:/src/tier-reload" }, { model: "", tier: "priority", tiers: TIERS, cliModel: "gpt-6.2-sol" });
    const l = chatTileLiveOf(tg.chat)!;
    expect([l.pick, chatTileModelNow(l), chatTileTierOptions(l).map((x) => x.id), chatTileTierNow(l)]).toEqual(["", "gpt-6.2-sol", ["priority"], TIERS.byModel["gpt-6.2-sol"][0]]);
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t1", outcome: "ok", message: null });
    expect(chatTileTierNow(chatTileLiveOf(tg.chat)!)?.id).toBe("priority");
    emit(subs[0], tg.chat, { t: "ready", cli: "codex", version: "0.172.0", model: "gpt-mini", models: [], efforts: {}, conversationId: null });
    expect(chatTileModelNow(chatTileLiveOf(tg.chat)!)).toBe("gpt-mini");
  });

  it("고른 등급은 목록을 몰라도 숨기지 않는다 — 이름은 다른 모델이 알린 것 · 없으면 id · 고른 것이 없거나 Claude 면 null", async () => {
    const unknown = await codex({ cwd: "C:/src/tier-unknown" }, { model: "", tier: "priority" });
    const l = chatTileLiveOf(unknown.chat)!;
    expect([chatTileTierOptions(l), chatTileTierNow(l)]).toEqual([[], { id: "priority", name: "priority", description: "" }]);
    const named = await codex({ cwd: "C:/src/tier-named" }, { model: "", tier: "priority", tiers: TIERS });
    expect(chatTileTierNow(chatTileLiveOf(named.chat)!)).toEqual({ id: "priority", name: "Fast", description: "" });
    const none = await codex({ cwd: "C:/src/tier-none" }, { tiers: TIERS, cliModel: "gpt-6.2-sol" });
    expect(chatTileTierNow(chatTileLiveOf(none.chat)!)).toBeNull();
    const claude = await opened({ cwd: "C:/src/tier-claude" });
    expect(chatTileTierNow(chatTileLiveOf(claude.chat)!)).toBeNull();
  });

  it("알림 — mcp-status-failed 는 묻는 중을 곧바로 실패로 · review-failed 는 검토 바쁨을 곧바로 푼다", async () => {
    const tg = await codex({ cwd: "C:/src/notice-clear" });
    expect(await askMcpStatus(tg)).toBe(true);
    emit(subs[0], tg.chat, { t: "notice", code: "mcp-status-failed", detail: null });
    expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBe("failed");
    expect(await askMcpStatus(tg)).toBe(true);
    expect(await reviewChatTile(tg, { type: "uncommittedChanges" })).toBe(true);
    expect(chatTileLiveOf(tg.chat)?.reviewBusy).toBe(true);
    emit(subs[0], tg.chat, { t: "notice", code: "review-failed", detail: "no thread" });
    const l = chatTileLiveOf(tg.chat)!;
    expect([l.reviewBusy, chatTileWorking(l)]).toEqual([false, false]);
  });

  it("검토 끝 표지 — 이 창이 본 것만 흔적으로 남는다(마침 · 중지)", async () => {
    const tg = await codex({ cwd: "C:/src/review-trace" });
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "B" });
    emit(subs[0], tg.chat, { t: "review", phase: "started", label: "current changes", text: null });
    expect(chatTileLiveOf(tg.chat)?.reviews).toEqual([]);
    emit(subs[0], tg.chat, { t: "review", phase: "stopped", label: "current changes", text: null });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "B", outcome: "interrupted", message: null });
    emit(subs[0], tg.chat, { t: "review", phase: "done", label: "main", text: null });
    expect(chatTileLiveOf(tg.chat)?.reviews.map((r) => [r.code, r.label])).toEqual([
      ["review-stopped", "current changes"],
      ["reviewed", "main"],
    ]);
  });

  it("끊긴 턴의 부분 답 — 이 턴의 보낸 말만 싣는다 · 사람 말 없이 선 턴은 null · 끊긴 때 · 선 때", async () => {
    const tg = await codex({ cwd: "C:/src/partials" });
    expect(sendChatTile(tg, "다음 일")).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t1" });
    emit(subs[0], tg.chat, { t: "text", item: "m1", text: "하던 글" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t1", outcome: "interrupted", message: null });
    // 목표가 연 턴 — 사람 말이 없다(앞 턴의 말을 붙이지 않는다)
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "t2" });
    emit(subs[0], tg.chat, { t: "text", item: "m2", text: "자동 턴 글" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "t2", outcome: "interrupted", message: null });
    const ps = chatTileLiveOf(tg.chat)!.partials;
    expect(ps.map((p) => [p.userText, p.texts])).toEqual([
      ["다음 일", ["하던 글"]],
      [null, ["자동 턴 글"]],
    ]);
    for (const p of ps) {
      expect(typeof p.at).toBe("number");
      expect(typeof p.start).toBe("number");
      expect(p.start!).toBeLessThanOrEqual(p.at);
    }
  });

  it("`/` 명령의 턴 — 보낸 때 · 출력이 남는다(도구가 낀 턴도) · 보통 말은 남기지 않는다", async () => {
    const tg = await opened({ cwd: "C:/src/locals" });
    const before = Date.now();
    expect(sendChatTile(tg, "/code-review low")).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    emit(subs[0], tg.chat, { t: "toolStarted", item: "x", name: "Task", summary: "review", input: null });
    emit(subs[0], tg.chat, { t: "text", item: null, text: "(none)" });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    expect(sendChatTile(tg, "안녕")).toBe(true);
    await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
    emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
    emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    const ls = chatTileLiveOf(tg.chat)!.locals;
    expect(ls.map((x) => [x.userText, x.texts])).toEqual([["/code-review low", ["(none)"]]]);
    expect(ls[0].at).toBeGreaterThanOrEqual(before);
  });

  it("사건 넷 — mcpStatus 는 aynx · picked 를 물려받고 칸 밖은 버린다 · goal · serviceTiers 는 갈음 · review 는 꼬리 알림", async () => {
    const tg = await codex({}, { mcpStatus: { source: "init", stale: false, servers: [{ name: "aynx-sessions", state: "connecting", auth: null, tools: null, scope: "app", aynx: true }, { name: "github", state: "connecting", auth: null, tools: null, scope: "config", picked: true }] } });
    emit(subs[0], tg.chat, {
      t: "mcpStatus",
      source: "startup",
      servers: [
        { name: "aynx-sessions", state: "connected", auth: null, tools: 14, scope: "app" },
        { name: "github", state: "failed", auth: "oauth", tools: null, scope: "config", error: "SECRET-err", config: { headers: { Authorization: "SECRET-h" } } } as never,
      ],
    });
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.mcpStatus?.servers).toEqual([
      { name: "aynx-sessions", state: "connected", auth: null, tools: 14, scope: "app", aynx: true },
      { name: "github", state: "failed", auth: "oauth", tools: null, scope: "config", picked: true },
    ]);
    expect(JSON.stringify(l.mcpStatus)).not.toContain("SECRET");
    expect(l.mcpStatus?.stale).toBe(false);
    emit(subs[0], tg.chat, { t: "goal", goal: GOAL });
    expect(chatTileLiveOf(tg.chat)?.goal).toEqual(GOAL);
    emit(subs[0], tg.chat, { t: "goal", goal: null });
    expect(chatTileLiveOf(tg.chat)?.goal).toBeNull();
    emit(subs[0], tg.chat, { t: "serviceTiers", byModel: TIERS.byModel, thread: "default" });
    expect(chatTileLiveOf(tg.chat)?.tiers).toEqual(TIERS);
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "B" });
    emit(subs[0], tg.chat, { t: "review", phase: "started", label: "current changes", text: null });
    expect(chatTileLiveOf(tg.chat)?.state.entries.at(-1)).toMatchObject({ kind: "notice", code: "reviewing", detail: "current changes" });
  });

  it("검토 — reviewBusy → turnStarted 에 풂 · 꼴 밖 열쇠는 싣지 않는다 · Claude · 틀린 대상 · 일하는 중은 보내지 않는다", async () => {
    const tg = await codex();
    const loose = { type: "baseBranch", branch: "main", extra: "x" } as never;
    expect(await reviewChatTile(tg, loose)).toBe(true);
    expect(calls("chat_tile_review")).toEqual([{ chat: tg.chat, epoch: 1, target: { type: "baseBranch", branch: "main" } }]);
    const l = chatTileLiveOf(tg.chat)!;
    expect(l.reviewBusy).toBe(true);
    expect(chatTileWorking(l)).toBe(true);
    expect(await reviewChatTile(tg, { type: "uncommittedChanges" })).toBe(false);
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "B" });
    expect(chatTileLiveOf(tg.chat)?.reviewBusy).toBe(false);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "A", outcome: "ok", message: null });
    expect(await reviewChatTile(tg, { type: "baseBranch", branch: "-x" })).toBe(false);
    expect(await reviewChatTile(tg, { type: "commit", sha: "zz" })).toBe(false);
    expect(calls("chat_tile_review")).toHaveLength(1);

    const claude = await opened({ cwd: "C:/src/review-claude" });
    expect(await reviewChatTile(claude, { type: "uncommittedChanges" })).toBe(false);
    expect(calls("chat_tile_review").filter((a) => a.chat === claude.chat)).toEqual([]);
  });

  it("검토 실패 → error · 바쁨 풂 · 다시 보내지 않는다 · 턴이 서지 않으면 15초 뒤 푼다", async () => {
    const tg = await codex();
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_review") throw new Error("[bad-review-target] the review target is not valid");
      return base(cmd, a);
    });
    expect(await reviewChatTile(tg, { type: "uncommittedChanges" })).toBe(false);
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ reviewBusy: false, error: "[bad-review-target] the review target is not valid" });
    expect(calls("chat_tile_review")).toHaveLength(1);
    vi.mocked(invoke).mockImplementation(base);
    vi.useFakeTimers();
    try {
      expect(await reviewChatTile(tg, { type: "uncommittedChanges" })).toBe(true);
      expect(chatTileLiveOf(tg.chat)?.reviewBusy).toBe(true);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(chatTileLiveOf(tg.chat)?.reviewBusy).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("일하는 중 판정 — 목표가 active 인 것만으로는 아니다", async () => {
    const tg = await codex({}, { goal: GOAL });
    expect(chatTileWorking(chatTileLiveOf(tg.chat)!)).toBe(false);
  });

  it("목표 — set · resume 은 시작 명령 · pause · clear 는 멈춤 명령 · 한도는 다섯 값만 · 글 · Claude 는 보내지 않는다", async () => {
    const tg = await codex();
    expect(await goalChatTile(tg, "set", "모든 시험이 지날 때까지 ", 500_000)).toBe(true);
    for (const bad of [123, 499_999, 3_000_000, undefined]) expect(await goalChatTile(tg, "set", "x", bad)).toBe(false);
    expect(await goalChatTile(tg, "set", "   ", 500_000)).toBe(false);
    expect(await goalChatTile(tg, "set", "가".repeat(4001), 500_000)).toBe(false);
    expect(calls("chat_tile_goal_start")).toEqual([{ chat: tg.chat, epoch: 1, action: "set", objective: "모든 시험이 지날 때까지", tokenBudget: 500_000 }]);
    expect(await goalChatTile(tg, "pause")).toBe(true);
    expect(await goalChatTile(tg, "resume")).toBe(true);
    expect(await goalChatTile(tg, "clear")).toBe(true);
    expect(calls("chat_tile_goal_stop")).toEqual([
      { chat: tg.chat, epoch: 1, action: "pause" },
      { chat: tg.chat, epoch: 1, action: "clear" },
    ]);
    expect(calls("chat_tile_goal_start")[1]).toEqual({ chat: tg.chat, epoch: 1, action: "resume", objective: null, tokenBudget: null });
    expect(await goalChatTile(tg, "bogus" as never)).toBe(false);

    const claude = await opened({ cwd: "C:/src/goal-claude" });
    expect(await goalChatTile(claude, "set", "x", 500_000)).toBe(false);
    expect(await goalChatTile(claude, "pause")).toBe(false);
    const mine = (cmd: string) => calls(cmd).filter((a) => a.chat === claude.chat).length;
    expect([mine("chat_tile_goal_start"), mine("chat_tile_goal_stop")]).toEqual([0, 0]);
  });

  it("목표 — 턴 중에는 멈춤 · 지우기만 · 원격 재확인 거절은 error 로 두고 다시 보내지 않는다", async () => {
    const tg = await codex();
    emit(subs[0], tg.chat, { t: "turnStarted", turn: "B" });
    expect(await goalChatTile(tg, "set", "x", 100_000)).toBe(false);
    expect(await goalChatTile(tg, "resume")).toBe(false);
    expect(await goalChatTile(tg, "pause")).toBe(true);
    expect(await goalChatTile(tg, "clear")).toBe(true);
    expect([calls("chat_tile_goal_start").length, calls("chat_tile_goal_stop").length]).toEqual([0, 2]);
    emit(subs[0], tg.chat, { t: "turnEnded", turn: "B", outcome: "ok", message: null });
    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_goal_start") throw new Error("마스터 암호를 다시 확인해야 합니다 — 다시 시도하세요");
      return base(cmd, a);
    });
    expect(await goalChatTile(tg, "set", "x", 100_000)).toBe(false);
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ error: "마스터 암호를 다시 확인해야 합니다 — 다시 시도하세요", goalBusy: false });
    expect(calls("chat_tile_goal_start")).toHaveLength(1);
  });

  it("Claude `/goal <조건>` 을 보내면 안내 한 줄 — `/goal` · `/goal clear` · Codex 는 없음 · 보내기는 막지 않는다", async () => {
    const tg = await opened({ cwd: "C:/src/goal-note" });
    const sendAndEnd = async (text: string) => {
      expect(sendChatTile(tg, text)).toBe(true);
      await vi.waitFor(() => expect(chatTileLiveOf(tg.chat)?.sending).toBe(false));
      emit(subs[0], tg.chat, { t: "turnStarted", turn: null });
      emit(subs[0], tg.chat, { t: "turnEnded", turn: null, outcome: "ok", message: null });
    };
    await sendAndEnd("/goal 시험이 다 지날 때까지");
    expect(calls("chat_tile_send").map((a) => a.text)).toEqual(["/goal 시험이 다 지날 때까지"]);
    expect(chatTileLiveOf(tg.chat)?.goalNotes).toHaveLength(1);
    await sendAndEnd("/goal");
    await sendAndEnd("/goal clear");
    expect(chatTileLiveOf(tg.chat)?.goalNotes).toHaveLength(1);
    expect(calls("chat_tile_send")).toHaveLength(3);
  });

  it("MCP 읽기 — 한 번만 묻는다 · 답(list) 이 오면 풂 · 거짓 → lastTurn · 거절 → mcpError", async () => {
    const tg = await codex();
    const p = askMcpStatus(tg);
    expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBe("asking");
    expect(await askMcpStatus(tg)).toBe(false);
    expect(await p).toBe(true);
    expect(calls("chat_tile_mcp_status")).toEqual([{ chat: tg.chat, epoch: 1 }]);
    emit(subs[0], tg.chat, { t: "mcpStatus", source: "startup", servers: [] });
    expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBe("asking");
    emit(subs[0], tg.chat, { t: "mcpStatus", source: "list", servers: [{ name: "a", state: "connected", auth: "bearer", tools: 2, scope: "config" }] });
    expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBeNull();

    const base = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, a) => (cmd === "chat_tile_mcp_status" ? false : base(cmd, a)));
    expect(await askMcpStatus(tg)).toBe(false);
    expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBe("lastTurn");
    vi.mocked(invoke).mockImplementation(async (cmd, a) => {
      if (cmd === "chat_tile_mcp_status") throw new Error("[mcp-status-busy] the MCP status was asked a moment ago");
      return base(cmd, a);
    });
    expect(await askMcpStatus(tg)).toBe(false);
    expect(chatTileLiveOf(tg.chat)).toMatchObject({ mcpAsk: null, mcpError: "[mcp-status-busy] the MCP status was asked a moment ago", error: null });
    expect(calls("chat_tile_mcp_status")).toHaveLength(3);
  });

  it("MCP 읽기 — 5초 넘으면 slow · 15초 넘으면 timeout · 다시 묻지 않는다", async () => {
    const tg = await codex();
    vi.useFakeTimers();
    try {
      expect(await askMcpStatus(tg)).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBe("slow");
      await vi.advanceTimersByTimeAsync(10_000);
      expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBe("timeout");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls("chat_tile_mcp_status")).toHaveLength(1);
      emit(subs[0], tg.chat, { t: "mcpStatus", source: "list", servers: [] });
      expect(chatTileLiveOf(tg.chat)?.mcpAsk).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("속도 — 그 모델 목록의 id 만 · 명세에 남김 · \"\" = CLI 기본(칸 지움) · Claude 값은 거절", async () => {
    const tg = await codex({ model: "gpt-6.2-sol" }, { model: "gpt-6.2-sol", tiers: TIERS });
    const spec: ChatTileSpec = { chatId: tg.chat, cli: "codex", model: "gpt-6.2-sol", effort: "", cwd: tg.cwd };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: spec });
    expect(await retuneChatTile(tg, { tier: "flex" })).toBe(false);
    expect(calls("chat_tile_set_tier")).toEqual([]);
    expect(await retuneChatTile(tg, { tier: "priority" })).toBe(true);
    expect(calls("chat_tile_set_tier")).toEqual([{ chat: tg.chat, epoch: 1, tier: "priority" }]);
    expect(chatTileLiveOf(tg.chat)?.tier).toBe("priority");
    expect(state.panes.get(tg.paneId)?.chat).toEqual({ ...spec, tier: "priority" });
    expect(await retuneChatTile(tg, { tier: "" })).toBe(true);
    expect(calls("chat_tile_set_tier")[1]).toEqual({ chat: tg.chat, epoch: 1, tier: null });
    expect(state.panes.get(tg.paneId)?.chat).not.toHaveProperty("tier");

    const claude = await opened({ cwd: "C:/src/tier-claude" });
    expect(await retuneChatTile(claude, { tier: "priority" })).toBe(false);
    expect(calls("chat_tile_set_tier").filter((a) => a.chat === claude.chat)).toEqual([]);
  });

  it("속도 — 모델을 바꿔 그 모델에 없는 등급이면 CLI 기본으로 되돌린다", async () => {
    const tg = await codex({ model: "gpt-6.2-sol", tier: "priority" }, { model: "gpt-6.2-sol", tiers: TIERS, tier: "priority" });
    const spec: ChatTileSpec = { chatId: tg.chat, cli: "codex", model: "gpt-6.2-sol", effort: "", cwd: tg.cwd, tier: "priority" };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: spec });
    expect(await retuneChatTile(tg, { model: "gpt-mini" })).toBe(true);
    expect(calls("chat_tile_set_tier")).toEqual([{ chat: tg.chat, epoch: 1, tier: null }]);
    expect(chatTileLiveOf(tg.chat)?.tier).toBeNull();
    expect(state.panes.get(tg.paneId)?.chat).toEqual({ chatId: tg.chat, cli: "codex", model: "gpt-mini", effort: "", cwd: tg.cwd });
  });

  it("속도 — 원격 창은 산 값만 바꾸고 명세를 쓰지 않는다", async () => {
    state.remote = true;
    const tg = await codex({ model: "gpt-6.2-sol" }, { model: "gpt-6.2-sol", tiers: TIERS });
    const spec: ChatTileSpec = { chatId: tg.chat, cli: "codex", model: "gpt-6.2-sol", effort: "", cwd: tg.cwd };
    state.panes.set(tg.paneId, { id: tg.paneId, kind: "chat", chat: spec });
    expect(await retuneChatTile(tg, { tier: "priority" })).toBe(true);
    expect(calls("chat_tile_set_tier")).toEqual([{ chat: tg.chat, epoch: 1, tier: "priority" }]);
    expect(chatTileLiveOf(tg.chat)?.tier).toBe("priority");
    expect(state.panes.get(tg.paneId)?.chat).toBe(spec);
    expect(spec).not.toHaveProperty("tier");
  });

  it("다시 세울 때 명세의 tier 를 싣는다(Codex 만) · 새 채팅도 물려받는다", async () => {
    server();
    gone = true;
    const tg = target({ cli: "codex", tier: "priority" });
    observe(tg);
    await vi.waitFor(() => expect(calls("chat_tile_open")).toHaveLength(1));
    expect(calls("chat_tile_open")[0]).toMatchObject({ cli: "codex", tier: "priority" });
    gone = true;
    const claude = target({ tier: "priority" });
    observe(claude);
    await vi.waitFor(() => expect(calls("chat_tile_open")).toHaveLength(2));
    expect(calls("chat_tile_open")[1]).toMatchObject({ cli: "claude", tier: null });

    const cur = await codex({ tier: "priority", cwd: "C:/src/new-in-place" });
    state.panes.set(cur.paneId, { id: cur.paneId, kind: "chat", chat: { chatId: cur.chat, cli: "codex", model: "", effort: "", cwd: cur.cwd, tier: "priority" } });
    expect(newChatInPlace(cur)).toBe(true);
    const fresh = vi.mocked(replaceTile).mock.calls.at(-1)![2] as PaneSpec;
    expect(fresh.chat).toMatchObject({ cli: "codex", tier: "priority" });
    expect(fresh.chat?.chatId).not.toBe(cur.chat);
  });
});
