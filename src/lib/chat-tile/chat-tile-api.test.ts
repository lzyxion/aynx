import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "$lib/ipc";
import { EV_TAGS } from "$lib/side-chat-api";
import {
  chatTileChannel,
  chatTileClose,
  chatTileCompact,
  chatTileDecide,
  chatTileGoal,
  chatTileInterrupt,
  chatTileMcpStatus,
  chatTileReview,
  chatTileSetTier,
  chatTileOpen,
  chatTileRewind,
  chatTileSend,
  chatTileSetEffort,
  chatTileSetModel,
  chatTileSetPermMode,
  chatTileUnsubscribe,
  isChatTileEvent,
  type ChatTileEvent,
} from "./chat-tile-api";

const CHAT = "ct-0f8fad5b-d9cb-469f-a165-70867728950e";

afterEach(() => vi.mocked(invoke).mockReset());

describe("isChatTileEvent — side-chat-api 의 EV_TAGS 로 거른다", () => {
  const ev = (t: string, chat = CHAT) => ({ chat, epoch: 1, seq: 2, ev: { t }, subs: [{ conn: 1, window: "main", subGen: 3 }] });

  it("표에 있는 꼬리표는 모두 받는다", () => {
    for (const t of EV_TAGS) expect(isChatTileEvent(ev(t), CHAT)).toBe(true);
  });

  it("모르는 꼬리표 · 다른 채팅 · 모양이 틀린 몸은 버린다", () => {
    expect(isChatTileEvent(ev("woken"), CHAT)).toBe(false);
    expect(isChatTileEvent(ev("textDelta", "ct-other"), CHAT)).toBe(false);
    expect(isChatTileEvent({ chat: CHAT, epoch: "1", seq: 2, ev: { t: "text" } }, CHAT)).toBe(false);
    expect(isChatTileEvent({ chat: CHAT, epoch: 1, seq: 2, ev: null }, CHAT)).toBe(false);
    expect(isChatTileEvent(null, CHAT)).toBe(false);
  });

  it("통로는 그 채팅의 아는 사건만 넘긴다", () => {
    const got: ChatTileEvent[] = [];
    const ch = chatTileChannel(CHAT, (e) => got.push(e));
    ch.onmessage(ev("textDelta"));
    ch.onmessage(ev("textDelta", "ct-other"));
    ch.onmessage(ev("bogus"));
    expect(got).toHaveLength(1);
  });
});

describe("invoke 인자 이름 — Rust 명령의 JS 이름 그대로", () => {
  it("open · send · decide · unsubscribe", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await chatTileOpen({ chat: CHAT, cli: "claude", model: "", mode: { kind: "fresh", cwd: null } });
    await chatTileSend(CHAT, 2, "안녕", "c-17");
    await chatTileDecide(CHAT, 2, "r1", "allow");
    await chatTileUnsubscribe(CHAT, 5);
    await chatTileInterrupt(CHAT, 2);
    await chatTileSetModel(CHAT, 2, "opus");
    await chatTileSetEffort(CHAT, 2, null);
    await chatTileClose(CHAT);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["chat_tile_open", { chat: CHAT, cli: "claude", model: "", effort: null, mode: { kind: "fresh", cwd: null }, permMode: null, tier: null }],
      ["chat_tile_send", { chat: CHAT, epoch: 2, text: "안녕", clientId: "c-17", images: [], files: [], skills: [] }],
      ["chat_tile_decide", { chat: CHAT, epoch: 2, requestId: "r1", decision: "allow", message: null, answers: null }],
      ["chat_tile_unsubscribe", { chat: CHAT, subGen: 5 }],
      ["chat_tile_interrupt", { chat: CHAT, epoch: 2 }],
      ["chat_tile_set_model", { chat: CHAT, epoch: 2, model: "opus" }],
      ["chat_tile_set_effort", { chat: CHAT, epoch: 2, effort: null }],
      ["chat_tile_close", { chat: CHAT }],
    ]);
  });

  it("권한 모드 · 결정 넷 · open 의 permMode — 제안 · 규칙 · 목적지 칸은 없다", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await chatTileSetPermMode(CHAT, 3, "acceptEdits");
    await chatTileDecide(CHAT, 3, "r9", "allowSession");
    await chatTileDecide(CHAT, 3, "r8", "deny", "둘로 나눠 줘");
    await chatTileDecide(CHAT, 3, "r10", "answer", null, { "Which color?": "Red, Green" });
    await chatTileOpen({ chat: CHAT, cli: "codex", model: "", mode: { kind: "fresh", cwd: null }, permMode: "plan" });
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls[0]).toEqual(["chat_tile_set_perm_mode", { chat: CHAT, epoch: 3, mode: "acceptEdits" }]);
    expect(calls[1]).toEqual(["chat_tile_decide", { chat: CHAT, epoch: 3, requestId: "r9", decision: "allowSession", message: null, answers: null }]);
    expect(calls[2][1]).toMatchObject({ decision: "deny", message: "둘로 나눠 줘", answers: null });
    expect(calls[3][1]).toMatchObject({ decision: "answer", message: null, answers: { "Which color?": "Red, Green" } });
    for (const [cmd, args] of calls.slice(1, 4)) {
      expect(cmd).toBe("chat_tile_decide");
      expect(Object.keys(args as object).sort()).toEqual(["answers", "chat", "decision", "epoch", "message", "requestId"]);
    }
    expect(calls[4][1]).toMatchObject({ permMode: "plan" });
  });

  it("검토 · 목표 · 속도 · MCP 상태 — 명령 이름 · 열쇠(목표 시작 · 멈춤은 명령이 다르다)", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await chatTileReview(CHAT, 3, { type: "baseBranch", branch: "main" });
    await chatTileGoal(CHAT, 3, "set", "모든 시험이 지날 때까지", 500_000);
    await chatTileGoal(CHAT, 3, "resume");
    await chatTileGoal(CHAT, 3, "pause");
    await chatTileGoal(CHAT, 3, "clear");
    await chatTileSetTier(CHAT, 3, "priority");
    await chatTileSetTier(CHAT, 3, null);
    await chatTileMcpStatus(CHAT, 3);
    await chatTileOpen({ chat: CHAT, cli: "codex", model: "", mode: { kind: "fresh", cwd: null }, tier: "priority" });
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["chat_tile_review", { chat: CHAT, epoch: 3, target: { type: "baseBranch", branch: "main" } }],
      ["chat_tile_goal_start", { chat: CHAT, epoch: 3, action: "set", objective: "모든 시험이 지날 때까지", tokenBudget: 500_000 }],
      ["chat_tile_goal_start", { chat: CHAT, epoch: 3, action: "resume", objective: null, tokenBudget: null }],
      ["chat_tile_goal_stop", { chat: CHAT, epoch: 3, action: "pause" }],
      ["chat_tile_goal_stop", { chat: CHAT, epoch: 3, action: "clear" }],
      ["chat_tile_set_tier", { chat: CHAT, epoch: 3, tier: "priority" }],
      ["chat_tile_set_tier", { chat: CHAT, epoch: 3, tier: null }],
      ["chat_tile_mcp_status", { chat: CHAT, epoch: 3 }],
      ["chat_tile_open", { chat: CHAT, cli: "codex", model: "", effort: null, mode: { kind: "fresh", cwd: null }, permMode: null, tier: "priority" }],
    ]);
  });

  it("첨부 — 그림 · 파일 경로를 `images` · `files` 로", async () => {
    vi.mocked(invoke).mockResolvedValue({ epoch: 3 });
    await chatTileSend(CHAT, 3, "", "c-18", ["C:/a/attachments/x/shot.png"], ["C:/a/attachments/y/main.ts"]);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["chat_tile_send", { chat: CHAT, epoch: 3, text: "", clientId: "c-18", images: ["C:/a/attachments/x/shot.png"], files: ["C:/a/attachments/y/main.ts"], skills: [] }],
    ]);
  });

  it("압축 — `{chat, epoch, instructions}`(기본 null) · 보내기의 `skills` 는 이름만", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await chatTileCompact(CHAT, 4);
    await chatTileCompact(CHAT, 4, "인증 흐름 결정만 남겨 줘");
    await chatTileSend(CHAT, 4, "$docx 표 만들어 줘", "c-19", [], [], ["docx"]);
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls[0]).toEqual(["chat_tile_compact", { chat: CHAT, epoch: 4, instructions: null }]);
    expect(calls[1]).toEqual(["chat_tile_compact", { chat: CHAT, epoch: 4, instructions: "인증 흐름 결정만 남겨 줘" }]);
    expect(calls[2]).toEqual(["chat_tile_send", { chat: CHAT, epoch: 4, text: "$docx 표 만들어 줘", clientId: "c-19", images: [], files: [], skills: ["docx"] }]);
    expect(Object.keys(calls[0][1] as object).sort()).toEqual(["chat", "epoch", "instructions"]);
  });

  it("되감기 — `{chat, epoch, anchor, scope, dryRun}` 뿐(파일 경로 · 글 · 마지막 본 줄은 싣지 않는다)", async () => {
    vi.mocked(invoke).mockResolvedValue({ epoch: 5 });
    const A = "30b5bc5c-33b6-47d1-802c-c06d0d28a93a";
    expect(await chatTileRewind(CHAT, 4, A, "both", true)).toEqual({ epoch: 5 });
    await chatTileRewind(CHAT, 5, A, "files", false);
    await chatTileRewind(CHAT, 5, A, "conversation", false);
    const calls = vi.mocked(invoke).mock.calls;
    expect(calls[0]).toEqual(["chat_tile_rewind", { chat: CHAT, epoch: 4, anchor: A, scope: "both", dryRun: true }]);
    expect(calls[1]).toEqual(["chat_tile_rewind", { chat: CHAT, epoch: 5, anchor: A, scope: "files", dryRun: false }]);
    expect(calls[2]).toEqual(["chat_tile_rewind", { chat: CHAT, epoch: 5, anchor: A, scope: "conversation", dryRun: false }]);
    for (const [, args] of calls) expect(Object.keys(args as object).sort()).toEqual(["anchor", "chat", "dryRun", "epoch", "scope"]);
  });

  it("되감기 사건 둘은 통로를 지난다", () => {
    const env = (ev: unknown) => ({ chat: CHAT, epoch: 1, seq: 2, ev });
    expect(isChatTileEvent(env({ t: "rewindCaps", files: true, conversation: true }), CHAT)).toBe(true);
    expect(isChatTileEvent(env({ t: "rewind", phase: "done", anchor: "a", scope: "conversation", can: true, files: [], moreFiles: 0, insertions: null, deletions: null, turns: 2, skippedLinks: null, error: null }), CHAT)).toBe(true);
  });

  it("창 라벨을 싣지 않는다 — Rust 가 웹뷰에서 채운다", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    await chatTileOpen({ chat: CHAT, cli: "codex", model: "o3", effort: "high", mode: { kind: "resume", conv: "1b4e28ba-2fa1" } });
    for (const [, args] of vi.mocked(invoke).mock.calls) expect(args).not.toHaveProperty("window");
  });
});
